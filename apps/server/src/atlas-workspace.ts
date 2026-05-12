// Atlas Workspace — Phase 1
//
// Kanban + parallel-task spawning. Each task fires a Claude/Codex/Ollama
// subprocess against a registered project directory, streams stdout/stderr
// to a log file, and broadcasts new log chunks over the existing WebSocket
// channel (type: 'workspace.log').
//
// Schema:
//   workspace_projects(id, name, path, created_at)
//   workspace_tasks(id, project_id, title, prompt, model, mode,
//                   status, pid, exit_code, created_at, started_at,
//                   finished_at, log_path)
//
// Status lifecycle: backlog → running → review → done (+ failed)
// Mode: 'safe' (acceptEdits) | 'auto' (bypassPermissions)

import { Database } from 'bun:sqlite';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { randomUUID } from 'crypto';

const DB_PATH = 'events.db';
const WORKSPACE_HOME = '/Users/hrmacnair/atlas/workspace';
const RUNS_DIR = `${WORKSPACE_HOME}/runs`;
const PROJECTS_DIR = `${WORKSPACE_HOME}/projects`;
const CLAUDE_BIN = '/Users/hrmacnair/.local/bin/claude';
const CODEX_BIN  = '/Users/hrmacnair/.npm-global/bin/codex';

if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });
if (!existsSync(PROJECTS_DIR)) mkdirSync(PROJECTS_DIR, { recursive: true });

let db: Database | null = null;
function getDB(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
  }
  return db;
}

let inited = false;
export function initWorkspaceTables(): void {
  if (inited) return;
  inited = true;
  const d = getDB();
  d.exec(`
    CREATE TABLE IF NOT EXISTS workspace_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )
  `);
  d.exec(`
    CREATE TABLE IF NOT EXISTS workspace_tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'sonnet',
      mode TEXT NOT NULL DEFAULT 'safe',
      status TEXT NOT NULL DEFAULT 'backlog',
      pid INTEGER,
      exit_code INTEGER,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      log_path TEXT,
      cost_usd REAL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_create_tokens INTEGER,
      session_id TEXT,
      parent_task_id TEXT
    )
  `);
  // Migration: add cost + session columns if missing (must run before indexes
  // that reference the new columns, since CREATE TABLE IF NOT EXISTS is a no-op
  // when the table already exists from an older schema).
  const cols = d.prepare(`PRAGMA table_info(workspace_tasks)`).all() as any[];
  const have = new Set(cols.map(c => c.name));
  for (const col of ['cost_usd REAL', 'input_tokens INTEGER', 'output_tokens INTEGER', 'cache_read_tokens INTEGER', 'cache_create_tokens INTEGER', 'session_id TEXT', 'parent_task_id TEXT']) {
    const name = col.split(' ')[0];
    if (!have.has(name)) d.exec(`ALTER TABLE workspace_tasks ADD COLUMN ${col}`);
  }

  d.exec('CREATE INDEX IF NOT EXISTS idx_ws_tasks_project ON workspace_tasks(project_id)');
  d.exec('CREATE INDEX IF NOT EXISTS idx_ws_tasks_status ON workspace_tasks(status)');
  d.exec('CREATE INDEX IF NOT EXISTS idx_ws_tasks_parent ON workspace_tasks(parent_task_id)');

  d.exec(`
    CREATE TABLE IF NOT EXISTS workspace_pins (
      task_id TEXT PRIMARY KEY,
      pinned_at INTEGER NOT NULL
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS workspace_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'custom',
      description TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS workspace_archive (
      task_id TEXT PRIMARY KEY,
      archived_at INTEGER NOT NULL
    )
  `);

  // Seed built-in templates on first init
  const count = d.prepare(`SELECT COUNT(*) AS n FROM workspace_templates WHERE builtin = 1`).get() as { n: number };
  if (count.n === 0) seedBuiltinTemplates();
}

// ---- Per-project memory (CLAUDE.md auto-injection) ----

function projectMemoryDir(projectId: string): string {
  return `${PROJECTS_DIR}/${projectId}`;
}
function projectMemoryPath(projectId: string): string {
  return `${projectMemoryDir(projectId)}/CLAUDE.md`;
}

export function getProjectMemory(projectId: string): string {
  const p = projectMemoryPath(projectId);
  if (!existsSync(p)) return '';
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

export function setProjectMemory(projectId: string, body: string): { ok: boolean; error?: string } {
  const dir = projectMemoryDir(projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(projectMemoryPath(projectId), body, 'utf8');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ---- Pinned task set (persisted, single operator) ----

export function listPinnedIds(): string[] {
  const d = getDB();
  const rows = d.prepare(`SELECT task_id FROM workspace_pins ORDER BY pinned_at ASC`).all() as any[];
  return rows.map(r => r.task_id);
}

export function pinTask(id: string): { ok: boolean; error?: string } {
  const d = getDB();
  const task = getTask(id);
  if (!task) return { ok: false, error: 'task not found' };
  d.prepare(`INSERT OR IGNORE INTO workspace_pins (task_id, pinned_at) VALUES (?, ?)`).run(id, Date.now());
  return { ok: true };
}
export function unpinTask(id: string): { ok: boolean } {
  const d = getDB();
  d.prepare(`DELETE FROM workspace_pins WHERE task_id = ?`).run(id);
  return { ok: true };
}
export function unpinAll(): { ok: boolean } {
  const d = getDB();
  d.prepare(`DELETE FROM workspace_pins`).run();
  return { ok: true };
}

// ---- Vibe templates (static catalog) ----

export interface VibeTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  body: string;
  builtin?: boolean;
  created_at?: number;
  updated_at?: number;
}

const BUILTIN_TEMPLATES: Omit<VibeTemplate, 'created_at' | 'updated_at' | 'builtin'>[] = [
  { id: 'next-page', name: 'New Next.js page', category: 'web', description: 'Scaffold a route + page component + tests.',
    body: 'Add a new Next.js page at app/<PATH>/page.tsx. Use server components. Read styling from existing pages. Add a smoke test in __tests__/.' },
  { id: 'fix-bug', name: 'Fix a specific bug', category: 'general', description: 'Diagnose + minimal-diff fix.',
    body: 'There is a bug: <DESCRIBE>. Investigate root cause, then apply the minimal fix. Add a regression test if there is a test harness.' },
  { id: 'add-tests', name: 'Add tests for a module', category: 'general', description: 'Cover untested paths in a target file.',
    body: 'Add tests for <FILE>. Use the existing test framework (detect from package.json or pyproject). Cover the public functions, happy path + at least one error case each.' },
  { id: 'refactor', name: 'Refactor without behavior change', category: 'general', description: 'Clean up a file/function in place.',
    body: 'Refactor <FILE> to <GOAL — e.g. extract pure helpers, reduce nesting, remove dead code>. Behavior must not change; preserve every public signature and existing test result.' },
  { id: 'swift-view', name: 'New SwiftUI view', category: 'swift', description: 'Margin-style minimalist Apple view.',
    body: 'Add a new SwiftUI view named <NAME> in the MarginUI module. Follow the project conventions (12pt corner radius, hairline borders, SF Pro text). Add a #Preview.' },
  { id: 'design-pass', name: 'Design polish pass', category: 'design', description: 'Apple-minimalist tightening pass.',
    body: 'Do a polish pass on <SCOPE>. Standardize on 8/12/16/24/32/48 spacing, 12px radii, hairline borders, no movement on hover (only bg swaps). Match Apple HIG.' },
  { id: 'doc-readme', name: 'Write/update README', category: 'general', description: 'Crisp README for the project.',
    body: 'Write or refresh README.md. Sections: one-line description, install, run dev, run tests, deploy, project layout. Read package.json or pyproject.toml for the actual scripts.' },
];

function seedBuiltinTemplates(): void {
  const d = getDB();
  const now = Date.now();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO workspace_templates
      (id, name, category, description, body, builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);
  for (const t of BUILTIN_TEMPLATES) {
    stmt.run(t.id, t.name, t.category, t.description, t.body, now, now);
  }
}

export function listTemplates(): VibeTemplate[] {
  const d = getDB();
  const rows = d.prepare(`
    SELECT id, name, category, description, body, builtin, created_at, updated_at
    FROM workspace_templates
    ORDER BY builtin DESC, name ASC
  `).all() as any[];
  return rows.map(r => ({ ...r, builtin: !!r.builtin }));
}

export function createTemplate(input: { name: string; category?: string; description?: string; body: string }): { ok: boolean; template?: VibeTemplate; error?: string } {
  if (!input.name?.trim()) return { ok: false, error: 'name required' };
  if (!input.body?.trim()) return { ok: false, error: 'body required' };
  const d = getDB();
  const id = `t-${randomUUID().slice(0, 8)}`;
  const now = Date.now();
  d.prepare(`
    INSERT INTO workspace_templates (id, name, category, description, body, builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, input.name.trim(), (input.category || 'custom').trim(), (input.description || '').trim(), input.body.trim(), now, now);
  const row = d.prepare(`SELECT * FROM workspace_templates WHERE id = ?`).get(id) as any;
  return { ok: true, template: { ...row, builtin: !!row.builtin } };
}

export function updateTemplate(id: string, input: { name?: string; category?: string; description?: string; body?: string }): { ok: boolean; error?: string } {
  const d = getDB();
  const row = d.prepare(`SELECT builtin FROM workspace_templates WHERE id = ?`).get(id) as any;
  if (!row) return { ok: false, error: 'template not found' };
  if (row.builtin) return { ok: false, error: 'built-in templates are read-only' };
  const fields: string[] = [];
  const args: any[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v == null) continue;
    fields.push(`${k} = ?`);
    args.push(String(v).trim());
  }
  if (!fields.length) return { ok: true };
  fields.push(`updated_at = ?`);
  args.push(Date.now(), id);
  d.prepare(`UPDATE workspace_templates SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  return { ok: true };
}

export function deleteTemplate(id: string): { ok: boolean; error?: string } {
  const d = getDB();
  const row = d.prepare(`SELECT builtin FROM workspace_templates WHERE id = ?`).get(id) as any;
  if (!row) return { ok: false, error: 'template not found' };
  if (row.builtin) return { ok: false, error: 'built-in templates are read-only' };
  d.prepare(`DELETE FROM workspace_templates WHERE id = ?`).run(id);
  return { ok: true };
}

// Kept for back-compat with index.ts import. Now hydrated from DB.
export const TEMPLATES: VibeTemplate[] = [];

// ---- Cost capture from claude stream-json ----

interface CostUsage {
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_create_tokens: number;
}

function parseStreamJsonSession(jsonlText: string): string | null {
  // First system:init message carries session_id
  const lines = jsonlText.split('\n').filter(l => l.trim().startsWith('{'));
  for (const line of lines) {
    try {
      const m = JSON.parse(line);
      if (m?.type === 'system' && m.session_id) return m.session_id;
      if (m?.session_id) return m.session_id;
    } catch {}
  }
  return null;
}

function parseStreamJsonCost(logText: string): CostUsage | null {
  // Claude --output-format stream-json emits one JSON object per line. The
  // final 'result' message includes total_cost_usd + usage. We scan from the
  // end for the latest such message.
  const lines = logText.split('\n').filter(l => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const m = JSON.parse(lines[i]);
      if (m && (m.type === 'result' || typeof m.total_cost_usd === 'number' || m.usage)) {
        const u = m.usage || {};
        const cost = typeof m.total_cost_usd === 'number' ? m.total_cost_usd : 0;
        return {
          cost_usd: cost,
          input_tokens: u.input_tokens || 0,
          output_tokens: u.output_tokens || 0,
          cache_read_tokens: u.cache_read_input_tokens || 0,
          cache_create_tokens: u.cache_creation_input_tokens || 0,
        };
      }
    } catch { /* skip non-JSON line */ }
  }
  return null;
}

// ---- Project spend rollup ----

export interface ProjectSpend { project_id: string; cost_usd: number; tasks: number; tokens_input: number; tokens_output: number }

export function spendByProject(): Record<string, ProjectSpend> {
  const d = getDB();
  const rows = d.prepare(`
    SELECT project_id,
           COUNT(*) AS tasks,
           COALESCE(SUM(cost_usd), 0) AS cost_usd,
           COALESCE(SUM(input_tokens), 0) AS tokens_input,
           COALESCE(SUM(output_tokens), 0) AS tokens_output
    FROM workspace_tasks
    WHERE cost_usd IS NOT NULL
    GROUP BY project_id
  `).all() as any[];
  const out: Record<string, ProjectSpend> = {};
  for (const r of rows) out[r.project_id] = r;
  return out;
}

// ---- Projects ----

export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  created_at: number;
  task_counts?: { backlog: number; running: number; review: number; done: number };
}

export interface WorkspaceProjectSpend { cost_usd: number; tasks: number }

export function listProjects(): (WorkspaceProject & { spend?: WorkspaceProjectSpend })[] {
  const d = getDB();
  const rows = d.prepare(`
    SELECT id, name, path, created_at FROM workspace_projects ORDER BY created_at ASC
  `).all() as (WorkspaceProject & { spend?: WorkspaceProjectSpend })[];
  const counts = d.prepare(`
    SELECT project_id, status, COUNT(*) AS n
    FROM workspace_tasks
    GROUP BY project_id, status
  `).all() as Array<{ project_id: string; status: string; n: number }>;
  const byProj: Record<string, Record<string, number>> = {};
  for (const c of counts) {
    if (!byProj[c.project_id]) byProj[c.project_id] = {};
    byProj[c.project_id][c.status] = c.n;
  }
  const spend = spendByProject();
  for (const r of rows) {
    const c = byProj[r.id] || {};
    r.task_counts = {
      backlog: c.backlog || 0,
      running: c.running || 0,
      review:  c.review  || 0,
      done:    c.done    || 0,
    };
    const s = spend[r.id];
    r.spend = { cost_usd: s?.cost_usd || 0, tasks: s?.tasks || 0 };
  }
  return rows;
}

export function createProject(name: string, path: string): { ok: boolean; project?: WorkspaceProject; error?: string } {
  if (!name?.trim()) return { ok: false, error: 'name required' };
  if (!path?.trim()) return { ok: false, error: 'path required' };
  const resolved = path.replace(/^~/, process.env.HOME || '');
  if (!existsSync(resolved)) return { ok: false, error: `path does not exist: ${resolved}` };
  try { if (!statSync(resolved).isDirectory()) return { ok: false, error: 'path is not a directory' }; }
  catch { return { ok: false, error: 'path stat failed' }; }

  const d = getDB();
  const id = randomUUID();
  const now = Date.now();
  try {
    d.prepare(`
      INSERT INTO workspace_projects (id, name, path, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, name.trim(), resolved, now);
  } catch (err: any) {
    if (String(err.message).includes('UNIQUE')) {
      const existing = d.prepare(`SELECT id, name, path, created_at FROM workspace_projects WHERE path = ?`)
        .get(resolved) as WorkspaceProject;
      return { ok: true, project: { ...existing, task_counts: { backlog: 0, running: 0, review: 0, done: 0 } } };
    }
    return { ok: false, error: err.message };
  }
  return {
    ok: true,
    project: { id, name: name.trim(), path: resolved, created_at: now, task_counts: { backlog: 0, running: 0, review: 0, done: 0 } },
  };
}

export function deleteProject(id: string): { ok: boolean; error?: string } {
  const d = getDB();
  const tasks = d.prepare(`SELECT id, status, pid FROM workspace_tasks WHERE project_id = ?`).all(id) as any[];
  const running = tasks.filter(t => t.status === 'running');
  if (running.length > 0) {
    return { ok: false, error: `${running.length} task(s) still running — kill them first` };
  }
  d.prepare(`DELETE FROM workspace_tasks WHERE project_id = ?`).run(id);
  d.prepare(`DELETE FROM workspace_projects WHERE id = ?`).run(id);
  return { ok: true };
}

// ---- Tasks ----

export interface WorkspaceTask {
  id: string;
  project_id: string;
  title: string;
  prompt: string;
  model: string;
  mode: 'safe' | 'auto';
  status: 'backlog' | 'queued' | 'running' | 'review' | 'done' | 'failed';
  pid: number | null;
  exit_code: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  log_path: string | null;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_create_tokens: number | null;
  session_id: string | null;
  parent_task_id: string | null;
  project_name?: string;
  project_path?: string;
}

const ARCHIVE_TTL_MS = 24 * 60 * 60 * 1000;

export function listTasks(opts: { projectId?: string; includeArchived?: boolean } = {}): WorkspaceTask[] {
  const d = getDB();
  let sql = `
    SELECT t.*, p.name AS project_name, p.path AS project_path
    FROM workspace_tasks t
    JOIN workspace_projects p ON p.id = t.project_id
    LEFT JOIN workspace_archive a ON a.task_id = t.id
    WHERE 1=1
  `;
  const args: any[] = [];
  if (!opts.includeArchived) sql += ` AND a.task_id IS NULL`;
  if (opts.projectId) { sql += ` AND t.project_id = ?`; args.push(opts.projectId); }
  sql += ` ORDER BY t.created_at DESC LIMIT 500`;
  return d.prepare(sql).all(...args) as WorkspaceTask[];
}

export function archiveTask(id: string): { ok: boolean; error?: string } {
  const d = getDB();
  d.prepare(`INSERT OR IGNORE INTO workspace_archive (task_id, archived_at) VALUES (?, ?)`).run(id, Date.now());
  d.prepare(`DELETE FROM workspace_pins WHERE task_id = ?`).run(id);
  return { ok: true };
}

export function archiveDoneTasks(opts: { projectId?: string; olderThanMs?: number } = {}): { archived: number } {
  const d = getDB();
  const cutoff = Date.now() - (opts.olderThanMs ?? 0);
  let sql = `
    SELECT t.id FROM workspace_tasks t
    LEFT JOIN workspace_archive a ON a.task_id = t.id
    WHERE t.status = 'done' AND a.task_id IS NULL AND t.finished_at <= ?
  `;
  const args: any[] = [cutoff];
  if (opts.projectId) { sql += ` AND t.project_id = ?`; args.push(opts.projectId); }
  const rows = d.prepare(sql).all(...args) as any[];
  for (const r of rows) archiveTask(r.id);
  return { archived: rows.length };
}

// Auto-archive sweep: done tasks older than 24h.
export function autoArchiveSweep(): { archived: number } {
  return archiveDoneTasks({ olderThanMs: ARCHIVE_TTL_MS });
}

export function getTask(id: string): WorkspaceTask | null {
  const d = getDB();
  return d.prepare(`
    SELECT t.*, p.name AS project_name, p.path AS project_path
    FROM workspace_tasks t
    JOIN workspace_projects p ON p.id = t.project_id
    WHERE t.id = ?
  `).get(id) as WorkspaceTask | null;
}

export function createTask(input: {
  project_id: string;
  title: string;
  prompt: string;
  model?: string;
  mode?: 'safe' | 'auto';
  parent_task_id?: string | null;
}): { ok: boolean; task?: WorkspaceTask; error?: string } {
  if (!input.project_id) return { ok: false, error: 'project_id required' };
  if (!input.title?.trim()) return { ok: false, error: 'title required' };
  if (!input.prompt?.trim()) return { ok: false, error: 'prompt required' };

  const d = getDB();
  const proj = d.prepare(`SELECT id FROM workspace_projects WHERE id = ?`).get(input.project_id);
  if (!proj) return { ok: false, error: 'project not found' };

  const id = randomUUID();
  const now = Date.now();
  const model = input.model || 'sonnet';
  const mode = input.mode === 'auto' ? 'auto' : 'safe';
  const logPath = `${RUNS_DIR}/${id}.log`;
  const parentId = input.parent_task_id || null;

  d.prepare(`
    INSERT INTO workspace_tasks
      (id, project_id, title, prompt, model, mode, status, created_at, log_path, parent_task_id)
    VALUES (?, ?, ?, ?, ?, ?, 'backlog', ?, ?, ?)
  `).run(id, input.project_id, input.title.trim(), input.prompt.trim(), model, mode, now, logPath, parentId);

  return { ok: true, task: getTask(id)! };
}

export function followUpTask(parentId: string, prompt: string): { ok: boolean; task?: WorkspaceTask; error?: string } {
  if (!prompt?.trim()) return { ok: false, error: 'prompt required' };
  const parent = getTask(parentId);
  if (!parent) return { ok: false, error: 'parent task not found' };
  if (parent.status === 'running') return { ok: false, error: 'parent still running — wait for it to finish' };
  if (!parent.session_id) return { ok: false, error: 'parent has no session_id (only Claude tasks can be resumed)' };

  const title = `↳ ${prompt.slice(0, 60).trim()}${prompt.length > 60 ? '…' : ''}`;
  return createTask({
    project_id: parent.project_id,
    title,
    prompt,
    model: parent.model,
    mode: parent.mode,
    parent_task_id: parentId,
  });
}

export function moveTask(id: string, status: WorkspaceTask['status']): { ok: boolean; error?: string } {
  const valid = ['backlog', 'queued', 'running', 'review', 'done', 'failed'];
  if (!valid.includes(status)) return { ok: false, error: 'invalid status' };
  const d = getDB();
  const task = getTask(id);
  if (!task) return { ok: false, error: 'task not found' };
  // Don't allow manual transition out of running — must kill first
  if (task.status === 'running' && status !== 'running') {
    return { ok: false, error: 'task is running — kill first' };
  }
  d.prepare(`UPDATE workspace_tasks SET status = ? WHERE id = ?`).run(status, id);
  return { ok: true };
}

export function deleteTask(id: string): { ok: boolean; error?: string } {
  const d = getDB();
  const task = getTask(id);
  if (!task) return { ok: false, error: 'task not found' };
  if (task.status === 'running') return { ok: false, error: 'kill before delete' };
  d.prepare(`DELETE FROM workspace_tasks WHERE id = ?`).run(id);
  return { ok: true };
}

// ---- Spawn ----

type Backend = 'anthropic' | 'openai' | 'ollama';

const MODEL_BACKEND: Record<string, { backend: Backend; model: string }> = {
  opus:        { backend: 'anthropic', model: 'opus' },
  sonnet:      { backend: 'anthropic', model: 'sonnet' },
  haiku:       { backend: 'anthropic', model: 'haiku' },
  'gpt5':      { backend: 'openai',    model: 'gpt-5.5' },
  'gpt5-mini': { backend: 'openai',    model: 'gpt-5.5' },
  'gemma':     { backend: 'ollama',    model: 'gemma4:e4b' },
};

interface LiveProc {
  child: ReturnType<typeof spawn>;
  taskId: string;
  startedAt: number;
}
const liveProcs = new Map<string, LiveProc>();

// Bounded concurrency: prevent runaway parallel Claude spawns from
// pegging the subscription / disk. Queue overflow.
const MAX_CONCURRENT_SPAWNS = parseInt(process.env.WORKSPACE_MAX_CONCURRENT || '4', 10);
const spawnQueue: string[] = [];

type BroadcastFn = (msg: { type: string; data: any }) => void;
let broadcast: BroadcastFn = () => {};
export function setBroadcast(fn: BroadcastFn): void { broadcast = fn; }

function tryDrainSpawnQueue(): void {
  while (liveProcs.size < MAX_CONCURRENT_SPAWNS && spawnQueue.length > 0) {
    const id = spawnQueue.shift()!;
    const t = getTask(id);
    if (!t || t.status !== 'queued') continue;
    // Reset to backlog briefly then spawn (spawnTask checks for !running)
    const d = getDB();
    d.prepare(`UPDATE workspace_tasks SET status = 'backlog' WHERE id = ?`).run(id);
    spawnTaskNow(id);
  }
}

export function spawnTask(id: string): { ok: boolean; pid?: number; error?: string; queued?: boolean } {
  if (liveProcs.size >= MAX_CONCURRENT_SPAWNS) {
    const t = getTask(id);
    if (!t) return { ok: false, error: 'task not found' };
    if (t.status === 'running' || t.status === 'queued') return { ok: false, error: `already ${t.status}` };
    const d = getDB();
    d.prepare(`UPDATE workspace_tasks SET status = 'queued' WHERE id = ?`).run(id);
    spawnQueue.push(id);
    broadcast({ type: 'workspace.task', data: { taskId: id, status: 'queued' } });
    return { ok: true, queued: true };
  }
  return spawnTaskNow(id);
}

function spawnTaskNow(id: string): { ok: boolean; pid?: number; error?: string } {
  const task = getTask(id);
  if (!task) return { ok: false, error: 'task not found' };
  if (task.status === 'running') return { ok: false, error: 'already running' };
  if (!task.project_path) return { ok: false, error: 'project path missing' };
  if (!existsSync(task.project_path)) return { ok: false, error: `cwd missing: ${task.project_path}` };

  const cfg = MODEL_BACKEND[task.model] || MODEL_BACKEND.sonnet;
  const logPath = task.log_path || `${RUNS_DIR}/${id}.log`;

  let cmd: string;
  let args: string[];
  const env: any = { ...process.env };

  // Per-project memory: append CLAUDE.md to system prompt if present
  const memory = getProjectMemory(task.project_id);

  if (cfg.backend === 'anthropic') {
    // claude --print: non-interactive, applies tool calls per permission mode.
    // safe = acceptEdits (auto-apply edits but prompt for shell/network)
    // auto = bypassPermissions (fully autonomous — vibe-coding mode)
    // --output-format=stream-json gives us per-step events + final cost.
    delete env.ANTHROPIC_API_KEY; // prefer subscription auth
    const permMode = task.mode === 'auto' ? 'bypassPermissions' : 'acceptEdits';
    cmd = CLAUDE_BIN;
    args = [
      '--print',
      '--model', cfg.model,
      '--permission-mode', permMode,
      '--output-format', 'stream-json',
      '--verbose',
    ];
    // Follow-up: resume the parent's session so context carries over
    if (task.parent_task_id) {
      const parent = getTask(task.parent_task_id);
      if (parent?.session_id) args.push('--resume', parent.session_id);
    }
    if (memory) args.push('--append-system-prompt', memory);
    args.push(task.prompt);
  } else if (cfg.backend === 'openai' || cfg.backend === 'ollama') {
    const sandbox = task.mode === 'auto' ? 'workspace-write' : 'read-only';
    cmd = CODEX_BIN;
    args = [
      'exec',
      '--skip-git-repo-check',
      '--sandbox', sandbox,
      '-m', cfg.model,
    ];
    if (cfg.backend === 'ollama') args.push('--oss', '--local-provider', 'ollama');
    // codex has no append-system-prompt flag; prepend memory inline.
    const fullPrompt = memory ? `${memory}\n\n---\n\n${task.prompt}` : task.prompt;
    args.push(fullPrompt);
  } else {
    return { ok: false, error: `unsupported backend: ${cfg.backend}` };
  }

  // Open a writable file descriptor for the log via Bun.
  // Claude stream-json: parse on the fly. Pretty text → .log; raw JSON → .jsonl sidecar.
  // Codex / Ollama: stdout is already human text — pass through verbatim.
  const writer = Bun.file(logPath).writer();
  const jsonlPath = `${logPath}.jsonl`;
  const isStreamJson = cfg.backend === 'anthropic';
  const jsonlWriter = isStreamJson ? Bun.file(jsonlPath).writer() : null;

  writer.write(
    `# task ${id}\n` +
    `# project: ${task.project_name}\n` +
    `# cwd: ${task.project_path}\n` +
    `# model: ${task.model} (${cfg.backend})\n` +
    `# mode: ${task.mode}\n` +
    `# started: ${new Date().toISOString()}\n` +
    `# cmd: ${cmd} ${args.map(a => a.length > 200 ? a.slice(0, 200) + '…' : a).join(' ')}\n` +
    `\n----\n`
  );

  const child = spawn(cmd, args, {
    cwd: task.project_path,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Line buffer for stream-json (chunks may split mid-line)
  let stdoutBuf = '';

  function renderStreamJsonLine(line: string): string {
    // Render a single stream-json message into a one-line-or-block of pretty text.
    let m: any;
    try { m = JSON.parse(line); } catch { return ''; }
    if (!m || typeof m !== 'object') return '';
    const t = m.type;
    if (t === 'system' && m.subtype === 'init') {
      const tools = (m.tools || []).slice(0, 6).join(', ') + ((m.tools || []).length > 6 ? '…' : '');
      return `\x1b[2m· system: model=${m.model || '?'}  cwd=${m.cwd || '?'}  tools=[${tools}]\x1b[0m\n`;
    }
    if (t === 'assistant' && m.message?.content) {
      const parts: string[] = [];
      for (const c of m.message.content) {
        if (c.type === 'text' && c.text) parts.push(c.text);
        else if (c.type === 'tool_use') {
          const name = c.name || '?';
          const inp = c.input ? JSON.stringify(c.input).slice(0, 140) : '';
          parts.push(`\x1b[36m▸ ${name}\x1b[0m ${inp}`);
        }
      }
      return parts.join('\n') + (parts.length ? '\n' : '');
    }
    if (t === 'user' && m.message?.content) {
      // Tool results
      const parts: string[] = [];
      for (const c of m.message.content) {
        if (c.type === 'tool_result') {
          let r = '';
          if (typeof c.content === 'string') r = c.content;
          else if (Array.isArray(c.content)) {
            r = c.content.map((x: any) => x.text || '').join('').trim();
          }
          if (r) {
            const trimmed = r.length > 1200 ? r.slice(0, 1200) + `\n  …(+${r.length - 1200} chars)` : r;
            parts.push(`\x1b[2m  ${trimmed.split('\n').join('\n  ')}\x1b[0m`);
          }
        }
      }
      return parts.join('\n') + (parts.length ? '\n' : '');
    }
    if (t === 'result') {
      const cost = typeof m.total_cost_usd === 'number' ? `$${m.total_cost_usd.toFixed(4)}` : '?';
      const dur = m.duration_ms ? `${(m.duration_ms / 1000).toFixed(1)}s` : '?';
      const ok = m.is_error ? '\x1b[31m✗ error\x1b[0m' : '\x1b[32m✓ done\x1b[0m';
      return `\x1b[2m· ${ok}  ${dur}  ${cost}\x1b[0m\n`;
    }
    return '';
  }

  const onChunk = (kind: 'out' | 'err', buf: Buffer) => {
    const text = buf.toString('utf8');
    if (kind === 'err' || !isStreamJson) {
      // Pass through unchanged
      writer.write(text);
      broadcast({ type: 'workspace.log', data: { taskId: id, kind, text } });
      return;
    }
    // stream-json: split into lines, archive each as JSONL, render pretty
    stdoutBuf += text;
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() || ''; // keep incomplete last line
    let pretty = '';
    for (const line of lines) {
      if (!line.trim()) continue;
      jsonlWriter?.write(line + '\n');
      const out = renderStreamJsonLine(line);
      if (out) pretty += out;
    }
    if (pretty) {
      writer.write(pretty);
      broadcast({ type: 'workspace.log', data: { taskId: id, kind, text: pretty } });
    }
  };
  child.stdout?.on('data', (b: Buffer) => onChunk('out', b));
  child.stderr?.on('data', (b: Buffer) => onChunk('err', b));

  child.on('exit', async (code) => {
    const exitCode = code ?? -1;
    // Flush trailing partial line if any
    if (isStreamJson && stdoutBuf.trim()) {
      jsonlWriter?.write(stdoutBuf + '\n');
      const out = renderStreamJsonLine(stdoutBuf);
      if (out) { writer.write(out); broadcast({ type: 'workspace.log', data: { taskId: id, kind: 'out', text: out } }); }
      stdoutBuf = '';
    }
    writer.write(`\n----\n# exited: ${new Date().toISOString()} (code ${exitCode})\n`);
    writer.end();
    jsonlWriter?.end();
    liveProcs.delete(id);
    const d = getDB();
    const nextStatus: WorkspaceTask['status'] = exitCode === 0 ? 'review' : 'failed';

    // Parse cost from sidecar JSONL (Claude backend only)
    let cost: CostUsage | null = null;
    if (cfg.backend === 'anthropic') {
      try {
        const jsonlText = await Bun.file(jsonlPath).text();
        cost = parseStreamJsonCost(jsonlText);
      } catch { /* non-fatal */ }
    }

    // Parse session_id from sidecar too (only meaningful for Claude)
    let sessionId: string | null = null;
    if (cfg.backend === 'anthropic') {
      try {
        const jsonlText = await Bun.file(jsonlPath).text();
        sessionId = parseStreamJsonSession(jsonlText);
      } catch {}
    }

    if (cost) {
      d.prepare(`
        UPDATE workspace_tasks
        SET status = ?, exit_code = ?, finished_at = ?,
            cost_usd = ?, input_tokens = ?, output_tokens = ?,
            cache_read_tokens = ?, cache_create_tokens = ?,
            session_id = COALESCE(?, session_id)
        WHERE id = ?
      `).run(nextStatus, exitCode, Date.now(),
             cost.cost_usd, cost.input_tokens, cost.output_tokens,
             cost.cache_read_tokens, cost.cache_create_tokens, sessionId, id);
    } else {
      d.prepare(`
        UPDATE workspace_tasks
        SET status = ?, exit_code = ?, finished_at = ?,
            session_id = COALESCE(?, session_id)
        WHERE id = ?
      `).run(nextStatus, exitCode, Date.now(), sessionId, id);
    }
    broadcast({
      type: 'workspace.task',
      data: { taskId: id, status: nextStatus, exit_code: exitCode, cost_usd: cost?.cost_usd, session_id: sessionId },
    });
    // Drain the spawn queue now that a slot freed up
    tryDrainSpawnQueue();
  });

  child.on('error', (err) => {
    writer.write(`\n# spawn error: ${err.message}\n`);
    writer.end();
    liveProcs.delete(id);
    const d = getDB();
    d.prepare(`UPDATE workspace_tasks SET status = 'failed', exit_code = -1, finished_at = ? WHERE id = ?`)
      .run(Date.now(), id);
    broadcast({ type: 'workspace.task', data: { taskId: id, status: 'failed', error: err.message } });
  });

  const pid = child.pid || null;
  const d = getDB();
  d.prepare(`UPDATE workspace_tasks SET status = 'running', pid = ?, started_at = ? WHERE id = ?`)
    .run(pid, Date.now(), id);

  liveProcs.set(id, { child, taskId: id, startedAt: Date.now() });
  broadcast({ type: 'workspace.task', data: { taskId: id, status: 'running', pid } });
  return { ok: true, pid: pid || undefined };
}

export function killTask(id: string): { ok: boolean; error?: string } {
  const live = liveProcs.get(id);
  if (!live) {
    // Maybe orphaned: clean DB state
    const task = getTask(id);
    if (task?.status === 'running') {
      const d = getDB();
      d.prepare(`UPDATE workspace_tasks SET status = 'failed', exit_code = -2, finished_at = ? WHERE id = ?`)
        .run(Date.now(), id);
      return { ok: true };
    }
    return { ok: false, error: 'not running' };
  }
  try {
    live.child.kill('SIGTERM');
    // SIGKILL after 5s if still alive
    setTimeout(() => {
      if (liveProcs.has(id)) {
        try { live.child.kill('SIGKILL'); } catch {}
      }
    }, 5000);
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
  return { ok: true };
}

export async function getTaskLog(id: string, opts: { tail?: number } = {}): Promise<{ ok: boolean; log?: string; error?: string }> {
  const task = getTask(id);
  if (!task) return { ok: false, error: 'task not found' };
  if (!task.log_path || !existsSync(task.log_path)) return { ok: true, log: '' };
  try {
    const max = opts.tail || 200_000;
    const text = await Bun.file(task.log_path).text();
    return { ok: true, log: text.length > max ? text.slice(-max) : text };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
