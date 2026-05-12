import { initDatabase, insertEvent, getFilterOptions, getRecentEvents, updateEventHITLResponse } from './db';
import type { HookEvent, HumanInTheLoopResponse } from './types';
import {
  createTheme,
  updateThemeById,
  getThemeById,
  searchThemes,
  deleteThemeById,
  exportThemeById,
  importTheme,
  getThemeStats
} from './theme';
import {
  listProposals,
  loadProposal,
  approveProposal,
  rejectProposal,
  deferProposal,
  rollbackProposal,
} from './atlas-proposals';
import {
  getToday,
  addOperatorItem,
  markDone,
  pinItem,
  deferItem,
  approveItem,
  rejectItem,
  archiveDoneAndRefresh,
  renderTelegramDigest,
} from './atlas-today';
import {
  handleGitHubWebhook,
  handleStripeWebhook,
  handleNtfyWebhook,
  handleManualEvent,
  dispatchLocal,
} from './atlas-events';
import {
  listCandidates,
  getCandidate,
  listTrials,
  listSweeps,
  installCandidate,
  declineCandidate,
  markTrialConcern,
  dailyTrialMaintenance,
} from './atlas-scout';
import { analyzeDrift, getLatestDriftReport } from './atlas-drift';
import { regenerateWhitepaper, whitepaperMeta } from './atlas-whitepaper';
import { portabilityState, backupNow } from './atlas-portability';
import { listMissions, getDivisionDetail, recentRoutingLog, recentCorrections, searchAudit, spendDetail, spendByModel, githubFeed, listAllAgents, generateSuggestions } from './atlas-views';

// Initialize database
initDatabase();

// Store WebSocket clients
const wsClients = new Set<any>();

// --- Load Atlas bot env (router needs ANTHROPIC_API_KEY) ---
try {
  const envText = await Bun.file('/Users/hrmacnair/atlas/bot-tg/.env').text();
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (err) {
  console.warn('[atlas] bot-tg/.env not loaded, talk endpoint may fail:', (err as Error).message);
}

// --- Division inference for inbound events --------------------------------
//
// Every Claude Code hook fires `send_event.py --source-app atlas`, so the
// raw event payload doesn't tell us WHICH project the session is in. We
// derive a `division` field by matching payload.cwd against
// ~/atlas/divisions/*/division.yaml#scope.paths. Cached + refreshed on
// division.yaml mtime change.

import { readFileSync as _readFileSync, existsSync as _existsSync, readdirSync as _readdirSync, statSync as _statSync } from 'fs';
import { join as _join } from 'path';

const _DIVISIONS_DIR = '/Users/hrmacnair/atlas/divisions';
let _divisionPathCache: { mtime: number; map: Array<{ division: string; path: string }> } = { mtime: 0, map: [] };

function _refreshDivisionPaths() {
  let newest = 0;
  let dirs: string[] = [];
  try {
    dirs = _readdirSync(_DIVISIONS_DIR).filter(n => _existsSync(_join(_DIVISIONS_DIR, n, 'division.yaml')));
  } catch { return; }
  for (const n of dirs) {
    try { const t = _statSync(_join(_DIVISIONS_DIR, n, 'division.yaml')).mtimeMs; if (t > newest) newest = t; } catch {}
  }
  if (newest === _divisionPathCache.mtime && _divisionPathCache.map.length > 0) return;
  // Re-parse via uv-pyyaml. Simple ad-hoc shell to avoid taking on async work here.
  const { spawnSync } = require('child_process');
  const map: Array<{ division: string; path: string }> = [];
  for (const n of dirs) {
    const r = spawnSync('/opt/homebrew/bin/uv',
      ['run', '--quiet', '--with', 'pyyaml', 'python3', '-c',
       'import sys,json,yaml; d=yaml.safe_load(open(sys.argv[1])); print(json.dumps((d or {}).get("scope",{}).get("paths",[])))',
       _join(_DIVISIONS_DIR, n, 'division.yaml')],
      { encoding: 'utf8' });
    if (r.status !== 0) continue;
    let paths: string[] = [];
    try { paths = JSON.parse(r.stdout); } catch { continue; }
    for (const p of paths) {
      if (typeof p !== 'string') continue;
      const resolved = p.replace(/^~/, process.env.HOME || '').replace(/\/\*\*$/, '');
      map.push({ division: n, path: resolved });
    }
  }
  // Sort longest-path-first so more specific scope wins (atlas-meta's
  // ~/atlas catches everything, but ~/atlas/projects/margin matches first).
  map.sort((a, b) => b.path.length - a.path.length);
  _divisionPathCache = { mtime: newest, map };
}

function inferDivision(cwd?: string): string | null {
  if (!cwd) return null;
  _refreshDivisionPaths();
  for (const m of _divisionPathCache.map) {
    if (cwd === m.path || cwd.startsWith(m.path + '/')) return m.division;
  }
  return null;
}

function enrichEventDivision(event: any): void {
  if (!event?.payload) return;
  if (event.payload.division) return;  // already set by upstream
  const cwd = event.payload.cwd;  // Claude Code sets this on PreToolUse/PostToolUse
  if (!cwd || typeof cwd !== 'string') return;
  const div = inferDivision(cwd);
  if (div) event.payload.division = div;
}

// --- Atlas dashboard stats ---
// Cached briefly to avoid hammering codeburn / disk on every dashboard refresh.
let atlasStatsCache: { ts: number; data: any } | null = null;
const ATLAS_STATS_TTL_MS = 30_000;

let atlasPendingCache: { ts: number; data: any[] } | null = null;
const ATLAS_PENDING_TTL_MS = 10_000;

let atlasBriefsCache: { ts: number; data: any[] } | null = null;
const ATLAS_BRIEFS_TTL_MS = 60_000;

const ATLAS_HOME = '/Users/hrmacnair/atlas';
const BRIEFS_ARCHIVE = `${ATLAS_HOME}/briefs/archive`;
const ROUTING_LOG = `${ATLAS_HOME}/memory/routing.log`;

// Stub: future approval queue (cold email drafts, invoice approvals, etc.)
async function getAtlasPending(): Promise<any[]> {
  if (atlasPendingCache && Date.now() - atlasPendingCache.ts < ATLAS_PENDING_TTL_MS) {
    return atlasPendingCache.data;
  }
  const items: any[] = []; // wiring TBD — see decisions.md 2026-05-10 Phase 9b
  atlasPendingCache = { ts: Date.now(), data: items };
  return items;
}

// Walk briefs archive, parse title + tldr first line
async function getAtlasBriefs(): Promise<any[]> {
  if (atlasBriefsCache && Date.now() - atlasBriefsCache.ts < ATLAS_BRIEFS_TTL_MS) {
    return atlasBriefsCache.data;
  }
  const briefs: any[] = [];
  try {
    const proc = Bun.spawn(['bash', '-c', `find "${BRIEFS_ARCHIVE}" -maxdepth 2 -type f -name '*.html' -not -name 'index.html' | sort -r`], { stdout: 'pipe' });
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    const paths = out.split('\n').filter(Boolean);
    for (const p of paths) {
      const parts = p.split('/');
      const slug = (parts[parts.length - 1] || '').replace(/\.html$/, '');
      const date = parts[parts.length - 2] || '';
      let title = slug;
      let tldr = '';
      let topic = slug;
      try {
        const html = await Bun.file(p).text();
        const h1 = html.match(/<h1[^>]*class="brief-title"[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1) title = stripTags(h1[1]).slice(0, 200);
        else {
          const t = html.match(/<title>([^<]+)<\/title>/i);
          if (t) title = t[1].replace(/\s·\satlas$/i, '').trim().slice(0, 200);
        }
        // First bullet or paragraph after TL;DR
        const tldrBlock = html.match(/<h2[^>]*>\s*TL[^<]*<\/h2>([\s\S]*?)(?:<h2|<\/article>)/i);
        if (tldrBlock) {
          const inner = tldrBlock[1];
          const firstLi = inner.match(/<li[^>]*>([\s\S]*?)<\/li>/i);
          const firstP  = inner.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
          tldr = stripTags((firstLi?.[1] || firstP?.[1] || '')).slice(0, 240).trim();
        }
        // Topic: derive from slug prefix
        if (slug.startsWith('margin')) topic = 'margin';
        else if (slug.startsWith('industry')) topic = 'industry';
        else if (slug.startsWith('hollywood')) topic = 'hollywood';
        else topic = slug.split('-')[0] || 'other';
      } catch {/* skip parse failure */}

      briefs.push({
        date,
        topic,
        slug,
        title,
        tldr,
        path: p,
        url: `http://localhost:5174/${date}/${slug}.html`,
      });
    }
  } catch (err: any) {
    console.error('[atlas/briefs] walk failed:', err.message);
  }
  atlasBriefsCache = { ts: Date.now(), data: briefs };
  return briefs;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

let todaysBriefCache: { ts: number; data: any } | null = null;
const TODAYS_BRIEF_TTL_MS = 60_000;

async function getTodaysBriefs(): Promise<any> {
  if (todaysBriefCache && Date.now() - todaysBriefCache.ts < TODAYS_BRIEF_TTL_MS) {
    return todaysBriefCache.data;
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const all = await getAtlasBriefs();
  const todays = all.filter(b => b.date === today);

  let data: any;
  if (todays.length > 0) {
    const briefs = await Promise.all(todays.map(async (b) => ({
      date: b.date,
      topic: b.topic,
      slug: b.slug,
      title: b.title,
      tldr: b.tldr,
      htmlBody: await extractBriefBody(b.path),
      recommendedAction: null,
      prompts: [],
      time: '', // future: parse fired-at time from html or mtime
    })));
    data = { briefs };
  } else {
    const latest = all[0];
    data = {
      briefs: [],
      latestPriorBrief: latest
        ? {
            date: latest.date,
            slug: latest.slug,
            title: latest.title,
            topic: latest.topic,
            tldr: latest.tldr,
            htmlBody: await extractBriefBody(latest.path),
          }
        : null,
    };
  }

  todaysBriefCache = { ts: Date.now(), data };
  return data;
}

async function extractBriefBody(path: string): Promise<string> {
  try {
    const html = await Bun.file(path).text();
    // Pull just the <article class="content">…</article> if present;
    // otherwise fall back to <div class="wrap">…</div> minus the brief-head.
    const article = html.match(/<article[^>]*class="content"[^>]*>([\s\S]*?)<\/article>/i);
    if (article) return article[1];
    const wrap = html.match(/<div[^>]*class="wrap"[^>]*>([\s\S]*?)<\/div>\s*<\/body>/i);
    if (wrap) {
      // strip the brief-head block if it exists, since we render title separately
      return wrap[1].replace(/<header[^>]*class="brief-head"[^>]*>[\s\S]*?<\/header>/i, '');
    }
    // last-resort: return the body content
    const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return body ? body[1] : html;
  } catch (err) {
    return `<p>Brief content unavailable: ${(err as Error).message}</p>`;
  }
}

// ---- Talk attachments ----
const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TALK_TMP_ROOT = '/tmp/atlas-talk';

const TEXT_EXTS = new Set('txt md rtf js ts tsx jsx py swift json yaml yml html css'.split(' '));
const IMAGE_EXTS = new Set('jpg jpeg png heic heif webp gif'.split(' '));
const PDF_EXT = 'pdf';

interface SavedFile {
  name: string;
  ext: string;
  mime: string;
  path: string;
  size: number;
}

function extOf(name: string): string {
  return (name.split('.').pop() || '').toLowerCase();
}

function isAllowedFile(f: File): boolean {
  const ext = extOf(f.name);
  if (TEXT_EXTS.has(ext) || IMAGE_EXTS.has(ext) || ext === PDF_EXT) return true;
  if (f.type.startsWith('image/')) return true;
  if (f.type.startsWith('text/')) return true;
  if (f.type === 'application/pdf') return true;
  return false;
}

async function saveUploads(files: File[]): Promise<SavedFile[]> {
  if (!files.length) return [];
  const session = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = `${TALK_TMP_ROOT}/${session}`;
  await Bun.spawn(['mkdir', '-p', dir]).exited;
  const out: SavedFile[] = [];
  for (const f of files) {
    const ext = extOf(f.name);
    const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${dir}/${safeName}`;
    const buffer = await f.arrayBuffer();
    await Bun.write(path, buffer);
    out.push({ name: f.name, ext, mime: f.type, path, size: f.size });
  }
  return out;
}

// Sweep /tmp/atlas-talk/* older than 24h on server startup
async function cleanupOldTalkUploads() {
  try {
    await Bun.spawn(['bash', '-c', `find ${TALK_TMP_ROOT} -mindepth 1 -maxdepth 1 -type d -mtime +0 -exec rm -rf {} + 2>/dev/null || true`]).exited;
  } catch {/* non-fatal */}
}
cleanupOldTalkUploads();

// Anthropic Messages API for vision (when images attached)
const ANTHROPIC_MODEL_IDS: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-1-20250805',
};

async function callAnthropicVision(opts: {
  model: string;
  systemPrompt: string;
  message: string;
  images: SavedFile[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  const modelId = ANTHROPIC_MODEL_IDS[opts.model] || ANTHROPIC_MODEL_IDS.sonnet;

  const content: any[] = [];
  for (const img of opts.images) {
    const bytes = await Bun.file(img.path).arrayBuffer();
    const b64 = Buffer.from(bytes).toString('base64');
    const mediaType = img.mime || (img.ext === 'png' ? 'image/png' : 'image/jpeg');
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: b64 },
    });
  }
  content.push({ type: 'text', text: opts.message || 'Describe the attached image(s).' });

  const body = JSON.stringify({
    model: modelId,
    max_tokens: 1024,
    system: opts.systemPrompt,
    messages: [{ role: 'user', content }],
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const parsed = await res.json() as any;
  const reply = (parsed.content || []).map((b: any) => b.text || '').join('').trim();
  return reply || '(empty reply)';
}

// Dynamic-import the bot-tg router. routeMessage classifies the prompt,
// backendFor maps tier → CLI backend. atlasTalk handles attachments by
// inlining text/code/markdown into the message, sending images via the
// Anthropic Messages API (vision), and falling back to claude --print
// for pure-text turns.
async function atlasTalk(
  message: string,
  files: SavedFile[] = [],
  forceModel?: string,
  priorTurns: Array<{ role: 'user' | 'atlas' | 'error'; text: string }> = []
): Promise<{ reply: string; decision: any; attachments_processed: string[] }> {
  const router = await import('/Users/hrmacnair/atlas/bot-tg/router.js');

  // Categorize attachments
  const images = files.filter(f => IMAGE_EXTS.has(f.ext) || f.mime.startsWith('image/'));
  const textFiles = files.filter(f =>
    TEXT_EXTS.has(f.ext) || (f.mime.startsWith('text/') && !TEXT_EXTS.has(f.ext) === false)
  );
  const pdfFiles = files.filter(f => f.ext === PDF_EXT || f.mime === 'application/pdf');

  // Build a routing-aware message (with attachment hints so the router
  // can pick the right agent / project / model).
  let routedMessage = message;
  for (const f of [...textFiles, ...pdfFiles, ...images]) {
    routedMessage += `\n[Attached: ${f.name}]`;
  }

  // Prepend prior chat turns so claude --print sees the conversation history
  // (each --print call is a fresh process; we manually feed context).
  let enrichedMessage = '';
  if (priorTurns && priorTurns.length > 0) {
    enrichedMessage += '## Prior conversation\n\n';
    for (const t of priorTurns) {
      const role = t.role === 'user' ? 'Operator' : (t.role === 'atlas' ? 'Atlas' : 'Error');
      enrichedMessage += `${role}: ${(t.text || '').slice(0, 2000)}\n\n`;
    }
    enrichedMessage += '## New message\n\n';
  }
  enrichedMessage += message;
  for (const f of textFiles) {
    try {
      const content = await Bun.file(f.path).text();
      enrichedMessage += `\n\n[Attached: ${f.name}]\n${content.slice(0, 50_000)}\n`;
    } catch (err: any) {
      enrichedMessage += `\n\n[Attached: ${f.name} — read failed: ${err.message}]\n`;
    }
  }
  // PDF: stub (no pdf-parse installed). Acknowledge the attachment.
  for (const f of pdfFiles) {
    enrichedMessage += `\n\n[Attached PDF: ${f.name} (text extraction not yet wired — please describe what you'd like to do with it)]\n`;
  }

  let decision = await router.routeMessage(routedMessage);

  // forceModel override (operator picked a specific model in the dashboard)
  const VALID = new Set(['opus','sonnet','haiku','gpt5','gpt5-mini','gemma']);
  if (forceModel && VALID.has(forceModel)) {
    decision = { ...decision, model: forceModel, rationale: `forced to ${forceModel} via dashboard picker` };
  }

  // Auto-upgrade for vision
  if (images.length > 0 && decision.model === 'haiku') {
    decision = { ...decision, model: 'sonnet', rationale: `${decision.rationale} (upgraded for vision)` };
  }

  const { backend, model } = router.backendFor(decision.model);
  const cwd = router.workingDirFor(decision.agent, decision.project);
  const systemPrompt = router.systemPromptFor(decision.agent, decision.project, 'dashboard');

  let reply: string;
  try {
    if (images.length > 0) {
      // Use Anthropic Messages API directly for vision
      reply = await callAnthropicVision({
        model: decision.model,
        systemPrompt,
        message: enrichedMessage,
        images,
      });
    } else if (backend === 'anthropic') {
      reply = await runClaudeCLI({ model, prompt: enrichedMessage, systemPrompt, cwd });
    } else if (backend === 'openai' || backend === 'ollama') {
      reply = await runCodexCLI({ backend, model, prompt: enrichedMessage, systemPrompt, cwd });
    } else {
      reply = `(unsupported backend: ${backend})`;
    }
  } catch (err: any) {
    reply = `(model error: ${err.message?.slice(0, 240) || err})`;
  }

  // Log routing decision
  try {
    router.logRoutingDecision({
      surface: 'dashboard',
      message: routedMessage,
      decision,
      ...(files.length ? { attachments: files.map(f => f.name) } : {}),
    } as any);
  } catch {/* non-fatal */}

  return { reply, decision, attachments_processed: files.map(f => f.name) };
}

const CLAUDE_BIN = '/Users/hrmacnair/.local/bin/claude';
const CODEX_BIN  = '/Users/hrmacnair/.npm-global/bin/codex';

async function runClaudeCLI(opts: { model: string; prompt: string; systemPrompt: string; cwd: string }): Promise<string> {
  const childEnv: any = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY; // claude CLI prefers subscription auth
  const proc = Bun.spawn(
    [CLAUDE_BIN, '--print', '--model', opts.model, '--append-system-prompt', opts.systemPrompt, opts.prompt],
    { cwd: opts.cwd, env: childEnv, stdout: 'pipe', stderr: 'pipe' }
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code === 0) return stdout.trim();
  throw new Error(`claude exited ${code}: ${(stderr || stdout).slice(0, 400)}`);
}

async function runCodexCLI(opts: { backend: string; model: string; prompt: string; systemPrompt: string; cwd: string }): Promise<string> {
  const tmpFile = `/tmp/atlas-codex-${Date.now()}-${Math.random().toString(36).slice(2,8)}.txt`;
  const fullPrompt = `${opts.systemPrompt}\n\n---\n\n${opts.prompt}`;
  const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-m', opts.model, '--output-last-message', tmpFile];
  if (opts.backend === 'ollama') args.push('--oss', '--local-provider', 'ollama');
  args.push(fullPrompt);
  const proc = Bun.spawn([CODEX_BIN, ...args], { cwd: opts.cwd, env: { ...process.env }, stdout: 'pipe', stderr: 'pipe' });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code === 0) {
    try {
      const text = await Bun.file(tmpFile).text();
      try { await Bun.write(tmpFile, ''); } catch {}
      return text.trim();
    } catch (err: any) {
      throw new Error(`codex output parse failed: ${err.message}`);
    }
  }
  throw new Error(`codex exited ${code}: ${(stderr || stdout).slice(0, 400)}`);
}

async function getAtlasStats() {
  if (atlasStatsCache && Date.now() - atlasStatsCache.ts < ATLAS_STATS_TTL_MS) {
    return atlasStatsCache.data;
  }

  const data: any = {
    generated_at: new Date().toISOString(),
    codeburn: { today: null, month: null, error: null },
    caveman: { sessions: 0, error: null },
    briefs: { recent: [], error: null },
    services: { healthy: 0, total: 0, items: [], error: null },
  };

  // Atlas LaunchAgent health — parse `launchctl list | grep ^com.atlas.`
  try {
    const proc = Bun.spawn(['bash', '-c', `launchctl list 2>/dev/null | awk '$3 ~ /^com\\.atlas\\./'`], { stdout: 'pipe' });
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    const items = out.split('\n').filter(Boolean).map((line) => {
      const parts = line.split(/\s+/);
      const pid = parts[0];
      const lastExit = parts[1];
      const name = parts[2];
      return {
        name,
        pid: pid === '-' ? null : parseInt(pid),
        last_exit: parseInt(lastExit),
        status: pid !== '-' && parseInt(lastExit) === 0 ? 'running'
              : pid === '-' && parseInt(lastExit) === 0 ? 'idle'
              : 'failing',
      };
    });
    data.services.items = items;
    data.services.total = items.length;
    data.services.healthy = items.filter(i => i.status === 'running' || i.status === 'idle').length;
  } catch (err: any) {
    data.services.error = err.message;
  }

  // codeburn status: "Today  $19.14  191 calls    Month  $1467.41  6000 calls"
  try {
    const proc = Bun.spawn(['/Users/hrmacnair/.npm-global/bin/codeburn', 'status'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const todayMatch = out.match(/Today\s+\$([\d.]+)\s+(\d+)\s+calls/);
    const monthMatch = out.match(/Month\s+\$([\d.]+)\s+(\d+)\s+calls/);
    if (todayMatch) data.codeburn.today = { dollars: parseFloat(todayMatch[1]), calls: parseInt(todayMatch[2]) };
    if (monthMatch) data.codeburn.month = { dollars: parseFloat(monthMatch[1]), calls: parseInt(monthMatch[2]) };
  } catch (err: any) {
    data.codeburn.error = err.message;
  }

  // caveman session count: jsonl files in ~/.claude/projects/-Users-hrmacnair-atlas/
  try {
    const projDir = '/Users/hrmacnair/.claude/projects/-Users-hrmacnair-atlas';
    const proc = Bun.spawn(['bash', '-c', `ls "${projDir}" 2>/dev/null | grep -c '\\.jsonl$' || echo 0`], {
      stdout: 'pipe',
    });
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    data.caveman.sessions = parseInt(out) || 0;
  } catch (err: any) {
    data.caveman.error = err.message;
  }

  // recent briefs: pull top 5 from full archive list (already parsed)
  try {
    const all = await getAtlasBriefs();
    data.briefs.recent = all.slice(0, 5).map((b) => ({
      path: b.path,
      filename: b.slug,
      date: b.date,
      title: b.title,
      topic: b.topic,
      url: `/api/atlas/briefs/file?path=${encodeURIComponent(b.path)}`,
    }));
  } catch (err: any) {
    data.briefs.error = err.message;
  }

  atlasStatsCache = { ts: Date.now(), data };
  return data;
}

// Helper function to send response to agent via WebSocket
async function sendResponseToAgent(
  wsUrl: string,
  response: HumanInTheLoopResponse
): Promise<void> {
  console.log(`[HITL] Connecting to agent WebSocket: ${wsUrl}`);

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let isResolved = false;

    const cleanup = () => {
      if (ws) {
        try {
          ws.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    };

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (isResolved) return;
        console.log('[HITL] WebSocket connection opened, sending response...');

        try {
          ws!.send(JSON.stringify(response));
          console.log('[HITL] Response sent successfully');

          // Wait longer to ensure message fully transmits before closing
          setTimeout(() => {
            cleanup();
            if (!isResolved) {
              isResolved = true;
              resolve();
            }
          }, 500);
        } catch (error) {
          console.error('[HITL] Error sending message:', error);
          cleanup();
          if (!isResolved) {
            isResolved = true;
            reject(error);
          }
        }
      };

      ws.onerror = (error) => {
        console.error('[HITL] WebSocket error:', error);
        cleanup();
        if (!isResolved) {
          isResolved = true;
          reject(error);
        }
      };

      ws.onclose = () => {
        console.log('[HITL] WebSocket connection closed');
      };

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!isResolved) {
          console.error('[HITL] Timeout sending response to agent');
          cleanup();
          isResolved = true;
          reject(new Error('Timeout sending response to agent'));
        }
      }, 5000);

    } catch (error) {
      console.error('[HITL] Error creating WebSocket:', error);
      cleanup();
      if (!isResolved) {
        isResolved = true;
        reject(error);
      }
    }
  });
}

// Create Bun server with HTTP and WebSocket support
const server = Bun.serve({
  port: parseInt(process.env.SERVER_PORT || '4000'),
  
  async fetch(req: Request) {
    const url = new URL(req.url);
    
    // Handle CORS
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers });
    }
    
    // POST /events - Receive new events
    if (url.pathname === '/events' && req.method === 'POST') {
      try {
        const event: HookEvent = await req.json();

        // Validate required fields
        if (!event.source_app || !event.session_id || !event.hook_event_type || !event.payload) {
          return new Response(JSON.stringify({ error: 'Missing required fields' }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        // Enrich with division derived from cwd / transcript_path so Margin /
        // Industry / atlas-meta work surfaces in the dashboard's per-project
        // filters even though every Claude Code hook fires source_app: "atlas".
        enrichEventDivision(event);

        // Insert event into database
        const savedEvent = insertEvent(event);
        
        // Broadcast to all WebSocket clients
        const message = JSON.stringify({ type: 'event', data: savedEvent });
        wsClients.forEach(client => {
          try {
            client.send(message);
          } catch (err) {
            // Client disconnected, remove from set
            wsClients.delete(client);
          }
        });
        
        return new Response(JSON.stringify(savedEvent), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error processing event:', error);
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // GET /events/filter-options - Get available filter options
    if (url.pathname === '/events/filter-options' && req.method === 'GET') {
      const options = getFilterOptions();
      return new Response(JSON.stringify(options), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // GET /events/recent - Get recent events
    if (url.pathname === '/events/recent' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '300');
      const events = getRecentEvents(limit);
      return new Response(JSON.stringify(events), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/atlas/stats - Atlas-specific dashboard stats
    // (codeburn token spend, caveman session count, recent auto-research briefs)
    if (url.pathname === '/api/atlas/stats' && req.method === 'GET') {
      const stats = await getAtlasStats();
      return new Response(JSON.stringify(stats), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/atlas/pending - stub for future approval queue
    if (url.pathname === '/api/atlas/pending' && req.method === 'GET') {
      const items = await getAtlasPending();
      return new Response(JSON.stringify({ items }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/atlas/pending/:id/approve
    if (url.pathname.match(/^\/api\/atlas\/pending\/[^\/]+\/approve$/) && req.method === 'POST') {
      return new Response(JSON.stringify({ approved: true, id: url.pathname.split('/')[4] }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/atlas/pending/:id/reject
    if (url.pathname.match(/^\/api\/atlas\/pending\/[^\/]+\/reject$/) && req.method === 'POST') {
      return new Response(JSON.stringify({ rejected: true, id: url.pathname.split('/')[4] }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ---- Layer 5a: proposal queue ----
    // GET /api/atlas/proposals — list all proposals across pending/queued/applied/rejected.
    if (url.pathname === '/api/atlas/proposals' && req.method === 'GET') {
      try {
        const items = listProposals();
        return new Response(JSON.stringify({ items }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/atlas/proposals/:id — single proposal (partial-prefix ID match)
    const propGet = url.pathname.match(/^\/api\/atlas\/proposals\/([^\/]+)$/);
    if (propGet && req.method === 'GET') {
      const found = loadProposal(propGet[1]);
      if (!found) {
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: 404, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ id: propGet[1], status: found.status, data: found.data }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ---- New views (12-features pass) ----
    if (url.pathname === '/api/atlas/missions' && req.method === 'GET') {
      return new Response(JSON.stringify({ missions: listMissions() }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    const divMatch = url.pathname.match(/^\/api\/atlas\/divisions\/([^\/]+)$/);
    if (divMatch && req.method === 'GET') {
      const data = getDivisionDetail(divMatch[1]);
      if (!data) {
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: 404, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(data), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/routing/log' && req.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '7');
      const limit = parseInt(url.searchParams.get('limit') || '200');
      return new Response(JSON.stringify({ entries: recentRoutingLog(days, limit) }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/routing/corrections' && req.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '14');
      return new Response(JSON.stringify({ entries: recentCorrections(days, 50) }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/audit/search' && req.method === 'GET') {
      const filter = {
        division: url.searchParams.get('division') || undefined,
        agent: url.searchParams.get('agent') || undefined,
        outcome: url.searchParams.get('outcome') || undefined,
        action: url.searchParams.get('action') || undefined,
        q: url.searchParams.get('q') || undefined,
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        limit: parseInt(url.searchParams.get('limit') || '200'),
      };
      return new Response(JSON.stringify({ entries: searchAudit(filter), filter }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/spend/detail' && req.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '14');
      return new Response(JSON.stringify(spendDetail(days)), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/spend/models' && req.method === 'GET') {
      const days = parseInt(url.searchParams.get('days') || '14');
      return new Response(JSON.stringify(spendByModel(days)), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/github/feed' && req.method === 'GET') {
      const data = await githubFeed();
      return new Response(JSON.stringify(data), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/agents' && req.method === 'GET') {
      return new Response(JSON.stringify({ agents: listAllAgents() }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/suggestions' && req.method === 'POST') {
      let body: any = {};
      try { body = await req.json(); } catch {}
      const suggestions = await generateSuggestions(body.last_user || '', body.last_reply || '');
      return new Response(JSON.stringify({ suggestions }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ---- Portability + backups ----
    if (url.pathname === '/api/atlas/portability' && req.method === 'GET') {
      return new Response(JSON.stringify(portabilityState()), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/portability/backup-now' && req.method === 'POST') {
      const r = await backupNow();
      return new Response(JSON.stringify(r), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ---- White paper auto-publish ----
    if (url.pathname === '/api/atlas/whitepaper' && req.method === 'GET') {
      return new Response(JSON.stringify(whitepaperMeta()), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/whitepaper/regenerate' && req.method === 'POST') {
      let body: any = {};
      try { body = await req.json(); } catch {}
      const r = regenerateWhitepaper(body.trigger || 'manual');
      return new Response(JSON.stringify(r), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ---- Layer 5b: drift detection ----
    if (url.pathname === '/api/atlas/drift/latest' && req.method === 'GET') {
      const r = getLatestDriftReport();
      if (!r) return new Response(JSON.stringify({ report: null }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
      return new Response(JSON.stringify({ report: r }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/drift/run' && req.method === 'POST') {
      let body: any = {};
      try { body = await req.json(); } catch {}
      const days = Number.isFinite(body.days) ? body.days : 7;
      const r = analyzeDrift(days);
      return new Response(JSON.stringify(r), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ---- Layer 5c: Scout (ecosystem discovery) ----
    if (url.pathname === '/api/atlas/scout' && req.method === 'GET') {
      try {
        const candidates = listCandidates();
        const trials = listTrials();
        const sweeps = listSweeps();
        return new Response(JSON.stringify({ candidates, trials, sweeps }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    const scoutGet = url.pathname.match(/^\/api\/atlas\/scout\/([^\/]+)$/);
    if (scoutGet && req.method === 'GET') {
      const c = getCandidate(scoutGet[1]);
      if (!c) {
        return new Response(JSON.stringify({ error: 'not found' }), {
          status: 404, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ data: c.data }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    const scoutAction = url.pathname.match(/^\/api\/atlas\/scout\/([^\/]+)\/(install|decline|concern)$/);
    if (scoutAction && req.method === 'POST') {
      const id = scoutAction[1];
      const action = scoutAction[2];
      let body: any = {};
      try { body = await req.json(); } catch {}
      const surface = body.surface || 'dashboard';
      const approver = body.approver || 'operator';
      const note = body.note || '';
      let result: { ok: boolean; message: string; install_command?: string };
      if (action === 'install')      result = installCandidate(id, approver, surface);
      else if (action === 'decline') result = declineCandidate(id, approver, surface, note);
      else if (action === 'concern') result = markTrialConcern(id, note || 'unspecified');
      else                            result = { ok: false, message: 'unknown action' };
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    if (url.pathname === '/api/atlas/scout/maintenance' && req.method === 'POST') {
      const r = dailyTrialMaintenance();
      return new Response(JSON.stringify({ ok: true, ...r }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ---- Layer 3: inbound webhooks (GitHub / Stripe / ntfy / manual) ----
    if (url.pathname === '/api/atlas/events/inbound/github' && req.method === 'POST') {
      return await handleGitHubWebhook(req);
    }
    if (url.pathname === '/api/atlas/events/inbound/stripe' && req.method === 'POST') {
      return await handleStripeWebhook(req);
    }
    const ntfyMatch = url.pathname.match(/^\/api\/atlas\/events\/inbound\/ntfy\/([^\/]+)$/);
    if (ntfyMatch && req.method === 'POST') {
      return await handleNtfyWebhook(req, decodeURIComponent(ntfyMatch[1]));
    }
    if (url.pathname === '/api/atlas/events/inbound/manual' && req.method === 'POST') {
      const tgChat = req.headers.get('x-telegram-chat-id');
      return await handleManualEvent(req, tgChat);
    }
    // POST /api/atlas/events/dispatch — internal-only, called by the file watcher
    // subprocess and by Scout (Layer 5c). No auth — relies on localhost-only port.
    if (url.pathname === '/api/atlas/events/dispatch' && req.method === 'POST') {
      let body: any = {};
      try { body = await req.json(); } catch {}
      const r = dispatchLocal(body.event || '', body.payload || {});
      return new Response(JSON.stringify(r), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ---- Layer 4: Today queue ----
    // GET /api/atlas/today — ranked queue + completed-today + (optional) deferred
    if (url.pathname === '/api/atlas/today' && req.method === 'GET') {
      try {
        const includeDeferred = url.searchParams.get('deferred') === '1';
        const data = getToday({ includeDeferred });
        return new Response(JSON.stringify(data), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/atlas/today/digest — terse Telegram-format string
    if (url.pathname === '/api/atlas/today/digest' && req.method === 'GET') {
      const digest = renderTelegramDigest();
      return new Response(JSON.stringify({ digest }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/atlas/today/add — operator adds a free-text item
    if (url.pathname === '/api/atlas/today/add' && req.method === 'POST') {
      let body: any = {};
      try { body = await req.json(); } catch {}
      const text = body.text || body.message || '';
      const urgency = body.urgency || 'green';
      const surface = body.surface || 'unknown';
      const r = addOperatorItem(text, urgency, surface);
      return new Response(JSON.stringify(r), {
        status: r.ok ? 200 : 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/atlas/today/archive — manual trigger for the midnight job
    if (url.pathname === '/api/atlas/today/archive' && req.method === 'POST') {
      const r = archiveDoneAndRefresh();
      return new Response(JSON.stringify({ ok: true, ...r }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/atlas/today/:id/{approve,reject,defer,done,pin}
    const todayAction = url.pathname.match(/^\/api\/atlas\/today\/([^\/]+)\/(approve|reject|defer|done|pin)$/);
    if (todayAction && req.method === 'POST') {
      const id = todayAction[1];
      const action = todayAction[2];
      let body: any = {};
      try { body = await req.json(); } catch {}
      const surface = body.surface || 'dashboard';
      const note = body.note || '';
      let result: { ok: boolean; message: string };
      if (action === 'approve')     result = approveItem(id, surface);
      else if (action === 'reject') result = rejectItem(id, surface, note);
      else if (action === 'defer')  result = deferItem(id, surface);
      else if (action === 'done')   result = markDone(id, surface);
      else if (action === 'pin')    result = pinItem(id, surface);
      else                          result = { ok: false, message: 'unknown action' };
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/atlas/proposals/:id/{approve,reject,defer,rollback}
    const propAction = url.pathname.match(/^\/api\/atlas\/proposals\/([^\/]+)\/(approve|reject|defer|rollback)$/);
    if (propAction && req.method === 'POST') {
      const id = propAction[1];
      const action = propAction[2] as 'approve' | 'reject' | 'defer' | 'rollback';
      let body: any = {};
      try { body = await req.json(); } catch {}
      const surface = body.surface || 'dashboard';
      const approver = body.approver || 'operator';
      const note = body.note || '';
      let result: { ok: boolean; message: string; applied_path?: string };
      if (action === 'approve')      result = approveProposal(id, approver, surface);
      else if (action === 'reject')  result = rejectProposal(id, approver, surface, note);
      else if (action === 'defer')   result = deferProposal(id, approver, surface);
      else if (action === 'rollback') result = rollbackProposal(id, approver, surface);
      else                            result = { ok: false, message: 'unknown action' };
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/atlas/briefs - walk ~/atlas/briefs/archive/<date>/<slug>.html
    if (url.pathname === '/api/atlas/briefs' && req.method === 'GET') {
      const briefs = await getAtlasBriefs();
      return new Response(JSON.stringify({ briefs }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/atlas/brief/today | /api/atlas/briefs/today - today's brief(s) inline
    if ((url.pathname === '/api/atlas/brief/today' || url.pathname === '/api/atlas/briefs/today') && req.method === 'GET') {
      const data = await getTodaysBriefs();
      return new Response(JSON.stringify(data), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/atlas/events/recent - HTTP fallback for Live Activity initial load
    if (url.pathname === '/api/atlas/events/recent' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const events = getRecentEvents(limit);
      return new Response(JSON.stringify({ events }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/atlas/briefs/file?path=... - proxy a brief HTML for iframe (CORS-safe)
    if (url.pathname === '/api/atlas/briefs/file' && req.method === 'GET') {
      const filePath = url.searchParams.get('path') || '';
      if (!filePath.startsWith('/Users/hrmacnair/atlas/briefs/archive/')) {
        return new Response('forbidden', { status: 403, headers });
      }
      try {
        const html = await Bun.file(filePath).text();
        return new Response(html, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
      } catch (err: any) {
        return new Response(`not found: ${err.message}`, { status: 404, headers });
      }
    }

    // POST /api/atlas/talk - route + spawn model, return reply.
    // Accepts multipart/form-data with optional 'files' (up to 5, ≤10 MB each)
    // or JSON { message } for the no-attachment path.
    if (url.pathname === '/api/atlas/talk' && req.method === 'POST') {
      try {
        const contentType = req.headers.get('content-type') || '';
        let message = '';
        let savedFiles: SavedFile[] = [];

        let forceModel: string | undefined;
        let priorTurns: any[] = [];
        if (contentType.includes('multipart/form-data')) {
          const form = await req.formData();
          message = String(form.get('message') || '').trim();
          forceModel = (form.get('forceModel') as string) || undefined;
          const ptRaw = form.get('priorTurns');
          if (typeof ptRaw === 'string' && ptRaw) {
            try { priorTurns = JSON.parse(ptRaw); } catch {}
          }
          const fileEntries = form.getAll('files').filter((v): v is File => v instanceof File);
          if (fileEntries.length > MAX_FILES) {
            return new Response(JSON.stringify({ error: `Max ${MAX_FILES} files per message` }), {
              status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
            });
          }
          for (const f of fileEntries) {
            if (f.size > MAX_FILE_BYTES) {
              return new Response(JSON.stringify({ error: `File too large (limit 10 MB): ${f.name}` }), {
                status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
              });
            }
            if (!isAllowedFile(f)) {
              return new Response(JSON.stringify({ error: `Unsupported file type: ${f.name}` }), {
                status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
              });
            }
          }
          savedFiles = await saveUploads(fileEntries);
        } else {
          const body = await req.json() as { message?: string; forceModel?: string; priorTurns?: any[] };
          message = String(body?.message || '').trim();
          forceModel = body?.forceModel;
          priorTurns = Array.isArray(body?.priorTurns) ? body!.priorTurns : [];
        }

        if (!message && savedFiles.length === 0) {
          return new Response(JSON.stringify({ error: 'message required' }), {
            status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        const result = await atlasTalk(message, savedFiles, forceModel, priorTurns);
        return new Response(JSON.stringify(result), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (err: any) {
        console.error('[atlas/talk] error:', err);
        return new Response(JSON.stringify({ error: err.message || 'talk failed' }), {
          status: 500, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // POST /events/:id/respond - Respond to HITL request
    if (url.pathname.match(/^\/events\/\d+\/respond$/) && req.method === 'POST') {
      const id = parseInt(url.pathname.split('/')[2]);

      try {
        const response: HumanInTheLoopResponse = await req.json();
        response.respondedAt = Date.now();

        // Update event in database
        const updatedEvent = updateEventHITLResponse(id, response);

        if (!updatedEvent) {
          return new Response(JSON.stringify({ error: 'Event not found' }), {
            status: 404,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        // Send response to agent via WebSocket
        if (updatedEvent.humanInTheLoop?.responseWebSocketUrl) {
          try {
            await sendResponseToAgent(
              updatedEvent.humanInTheLoop.responseWebSocketUrl,
              response
            );
          } catch (error) {
            console.error('Failed to send response to agent:', error);
            // Don't fail the request if we can't reach the agent
          }
        }

        // Broadcast updated event to all connected clients
        const message = JSON.stringify({ type: 'event', data: updatedEvent });
        wsClients.forEach(client => {
          try {
            client.send(message);
          } catch (err) {
            wsClients.delete(client);
          }
        });

        return new Response(JSON.stringify(updatedEvent), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error processing HITL response:', error);
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // Theme API endpoints
    
    // POST /api/themes - Create a new theme
    if (url.pathname === '/api/themes' && req.method === 'POST') {
      try {
        const themeData = await req.json();
        const result = await createTheme(themeData);
        
        const status = result.success ? 201 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error creating theme:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid request body' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // GET /api/themes - Search themes
    if (url.pathname === '/api/themes' && req.method === 'GET') {
      const query = {
        query: url.searchParams.get('query') || undefined,
        isPublic: url.searchParams.get('isPublic') ? url.searchParams.get('isPublic') === 'true' : undefined,
        authorId: url.searchParams.get('authorId') || undefined,
        sortBy: url.searchParams.get('sortBy') as any || undefined,
        sortOrder: url.searchParams.get('sortOrder') as any || undefined,
        limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined,
        offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : undefined,
      };
      
      const result = await searchThemes(query);
      return new Response(JSON.stringify(result), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // GET /api/themes/:id - Get a specific theme
    if (url.pathname.startsWith('/api/themes/') && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      if (!id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Theme ID is required' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      const result = await getThemeById(id);
      const status = result.success ? 200 : 404;
      return new Response(JSON.stringify(result), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // PUT /api/themes/:id - Update a theme
    if (url.pathname.startsWith('/api/themes/') && req.method === 'PUT') {
      const id = url.pathname.split('/')[3];
      if (!id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Theme ID is required' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      try {
        const updates = await req.json();
        const result = await updateThemeById(id, updates);
        
        const status = result.success ? 200 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error updating theme:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid request body' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // DELETE /api/themes/:id - Delete a theme
    if (url.pathname.startsWith('/api/themes/') && req.method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      if (!id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Theme ID is required' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      const authorId = url.searchParams.get('authorId');
      const result = await deleteThemeById(id, authorId || undefined);
      
      const status = result.success ? 200 : (result.error?.includes('not found') ? 404 : 403);
      return new Response(JSON.stringify(result), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // GET /api/themes/:id/export - Export a theme
    if (url.pathname.match(/^\/api\/themes\/[^\/]+\/export$/) && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      
      const result = await exportThemeById(id);
      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify(result.data), {
        headers: { 
          ...headers, 
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${result.data.theme.name}.json"`
        }
      });
    }
    
    // POST /api/themes/import - Import a theme
    if (url.pathname === '/api/themes/import' && req.method === 'POST') {
      try {
        const importData = await req.json();
        const authorId = url.searchParams.get('authorId');
        
        const result = await importTheme(importData, authorId || undefined);
        
        const status = result.success ? 201 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error importing theme:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid import data' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // GET /api/themes/stats - Get theme statistics
    if (url.pathname === '/api/themes/stats' && req.method === 'GET') {
      const result = await getThemeStats();
      return new Response(JSON.stringify(result), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // WebSocket upgrade
    if (url.pathname === '/stream') {
      const success = server.upgrade(req);
      if (success) {
        return undefined;
      }
    }
    
    // Default response
    return new Response('Multi-Agent Observability Server', {
      headers: { ...headers, 'Content-Type': 'text/plain' }
    });
  },
  
  websocket: {
    open(ws) {
      console.log('WebSocket client connected');
      wsClients.add(ws);
      
      // Send recent events on connection
      const events = getRecentEvents(300);
      ws.send(JSON.stringify({ type: 'initial', data: events }));
    },
    
    message(ws, message) {
      // Handle any client messages if needed
      console.log('Received message:', message);
    },
    
    close(ws) {
      console.log('WebSocket client disconnected');
      wsClients.delete(ws);
    },
    
    error(ws, error) {
      console.error('WebSocket error:', error);
      wsClients.delete(ws);
    }
  }
});

console.log(`🚀 Server running on http://localhost:${server.port}`);
console.log(`📊 WebSocket endpoint: ws://localhost:${server.port}/stream`);
console.log(`📮 POST events to: http://localhost:${server.port}/events`);