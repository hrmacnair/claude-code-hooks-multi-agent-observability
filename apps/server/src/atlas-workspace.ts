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
import { existsSync, mkdirSync, statSync } from 'fs';
import { randomUUID } from 'crypto';

const DB_PATH = 'events.db';
const RUNS_DIR = '/Users/hrmacnair/atlas/workspace/runs';
const CLAUDE_BIN = '/Users/hrmacnair/.local/bin/claude';
const CODEX_BIN  = '/Users/hrmacnair/.npm-global/bin/codex';

if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });

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
      log_path TEXT
    )
  `);
  d.exec('CREATE INDEX IF NOT EXISTS idx_ws_tasks_project ON workspace_tasks(project_id)');
  d.exec('CREATE INDEX IF NOT EXISTS idx_ws_tasks_status ON workspace_tasks(status)');
}

// ---- Projects ----

export interface WorkspaceProject {
  id: string;
  name: string;
  path: string;
  created_at: number;
  task_counts?: { backlog: number; running: number; review: number; done: number };
}

export function listProjects(): WorkspaceProject[] {
  const d = getDB();
  const rows = d.prepare(`
    SELECT id, name, path, created_at FROM workspace_projects ORDER BY created_at ASC
  `).all() as WorkspaceProject[];
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
  for (const r of rows) {
    const c = byProj[r.id] || {};
    r.task_counts = {
      backlog: c.backlog || 0,
      running: c.running || 0,
      review:  c.review  || 0,
      done:    c.done    || 0,
    };
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
  status: 'backlog' | 'running' | 'review' | 'done' | 'failed';
  pid: number | null;
  exit_code: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  log_path: string | null;
  project_name?: string;
  project_path?: string;
}

export function listTasks(opts: { projectId?: string } = {}): WorkspaceTask[] {
  const d = getDB();
  let sql = `
    SELECT t.*, p.name AS project_name, p.path AS project_path
    FROM workspace_tasks t
    JOIN workspace_projects p ON p.id = t.project_id
  `;
  const args: any[] = [];
  if (opts.projectId) { sql += ` WHERE t.project_id = ?`; args.push(opts.projectId); }
  sql += ` ORDER BY t.created_at DESC LIMIT 500`;
  return d.prepare(sql).all(...args) as WorkspaceTask[];
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

  d.prepare(`
    INSERT INTO workspace_tasks
      (id, project_id, title, prompt, model, mode, status, created_at, log_path)
    VALUES (?, ?, ?, ?, ?, ?, 'backlog', ?, ?)
  `).run(id, input.project_id, input.title.trim(), input.prompt.trim(), model, mode, now, logPath);

  return { ok: true, task: getTask(id)! };
}

export function moveTask(id: string, status: WorkspaceTask['status']): { ok: boolean; error?: string } {
  const valid = ['backlog', 'running', 'review', 'done', 'failed'];
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

type BroadcastFn = (msg: { type: string; data: any }) => void;
let broadcast: BroadcastFn = () => {};
export function setBroadcast(fn: BroadcastFn): void { broadcast = fn; }

export function spawnTask(id: string): { ok: boolean; pid?: number; error?: string } {
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

  if (cfg.backend === 'anthropic') {
    // claude --print: non-interactive, applies tool calls per permission mode.
    // safe = acceptEdits (auto-apply edits but prompt for shell/network)
    // auto = bypassPermissions (fully autonomous — vibe-coding mode)
    delete env.ANTHROPIC_API_KEY; // prefer subscription auth
    const permMode = task.mode === 'auto' ? 'bypassPermissions' : 'acceptEdits';
    cmd = CLAUDE_BIN;
    args = [
      '--print',
      '--model', cfg.model,
      '--permission-mode', permMode,
      '--verbose',
      task.prompt,
    ];
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
    args.push(task.prompt);
  } else {
    return { ok: false, error: `unsupported backend: ${cfg.backend}` };
  }

  // Open a writable file descriptor for the log via Bun
  const writer = Bun.file(logPath).writer();
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

  const onChunk = (kind: 'out' | 'err', buf: Buffer) => {
    const text = buf.toString('utf8');
    writer.write(text);
    broadcast({ type: 'workspace.log', data: { taskId: id, kind, text } });
  };
  child.stdout?.on('data', (b: Buffer) => onChunk('out', b));
  child.stderr?.on('data', (b: Buffer) => onChunk('err', b));

  child.on('exit', (code) => {
    const exitCode = code ?? -1;
    writer.write(`\n----\n# exited: ${new Date().toISOString()} (code ${exitCode})\n`);
    writer.end();
    liveProcs.delete(id);
    const d = getDB();
    const nextStatus: WorkspaceTask['status'] = exitCode === 0 ? 'review' : 'failed';
    d.prepare(`
      UPDATE workspace_tasks
      SET status = ?, exit_code = ?, finished_at = ?
      WHERE id = ?
    `).run(nextStatus, exitCode, Date.now(), id);
    broadcast({ type: 'workspace.task', data: { taskId: id, status: nextStatus, exit_code: exitCode } });
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
