#!/usr/bin/env bun
// Atlas Workspace — MCP server
//
// Speaks JSON-RPC 2.0 over stdio. Each line is one JSON message.
// Implements just enough of the Model Context Protocol for Claude Code,
// Cursor, Codex (any MCP client) to drive the workspace:
//
// Methods: initialize, tools/list, tools/call, ping
//
// Tools call into the existing HTTP API at localhost:4000 so the live state
// (DB, worktrees, broadcasts) stays single-sourced through the dashboard server.
//
// Install (Claude Code):
//   add to ~/.claude/mcp.json (or the equivalent for your client):
//   {
//     "mcpServers": {
//       "atlas-workspace": {
//         "command": "bun",
//         "args": ["/Users/hrmacnair/atlas/observability/apps/server/src/mcp-server.ts"]
//       }
//     }
//   }

const API = process.env.ATLAS_API || 'http://localhost:4000';
const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'atlas-workspace', version: '1.0.0' };

// ---- Tool definitions ----

interface Tool {
  name: string;
  description: string;
  inputSchema: any;
  handler: (args: any) => Promise<any>;
}

async function api(method: string, path: string, body?: any): Promise<any> {
  const opts: any = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { ok: false, error: text.slice(0, 500) }; }
}

const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    description: 'List registered Atlas workspace projects, with task counts and spend.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => (await api('GET', '/api/atlas/workspace/projects')).projects || [],
  },
  {
    name: 'list_tasks',
    description: 'List tasks across all projects (or filter to one).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Optional — filter to one project.' },
        includeArchived: { type: 'boolean', default: false },
      },
    },
    handler: async (args) => {
      const qs = new URLSearchParams();
      if (args?.projectId) qs.set('projectId', args.projectId);
      if (args?.includeArchived) qs.set('archived', '1');
      return (await api('GET', `/api/atlas/workspace/tasks?${qs}`)).tasks || [];
    },
  },
  {
    name: 'get_task',
    description: 'Fetch a single task by id (with status, branch, worktree path, cost, session id).',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args) => (await api('GET', `/api/atlas/workspace/tasks/${args.id}`)).task,
  },
  {
    name: 'create_task',
    description: 'Create a new task on a project. Does NOT spawn — call spawn_task next.',
    inputSchema: {
      type: 'object',
      required: ['project_id', 'title', 'prompt'],
      properties: {
        project_id: { type: 'string' },
        title:      { type: 'string' },
        prompt:     { type: 'string' },
        model:      { type: 'string', enum: ['haiku', 'sonnet', 'opus', 'gpt5', 'gpt5-mini', 'gemma'], default: 'sonnet' },
        mode:       { type: 'string', enum: ['safe', 'auto'], default: 'safe' },
      },
    },
    handler: async (args) => (await api('POST', '/api/atlas/workspace/tasks', args)).task,
  },
  {
    name: 'spawn_task',
    description: 'Spawn a backlog task. If concurrent limit reached, the task is queued (auto-drained on next exit).',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args) => api('POST', `/api/atlas/workspace/tasks/${args.id}/spawn`),
  },
  {
    name: 'kill_task',
    description: 'SIGTERM a running task (SIGKILL after 5s).',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args) => api('POST', `/api/atlas/workspace/tasks/${args.id}/kill`),
  },
  {
    name: 'get_task_log',
    description: 'Return the parsed pretty log (ANSI codes) for a task — tail by bytes if needed.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, tail: { type: 'integer', default: 50000 } },
    },
    handler: async (args) => (await api('GET', `/api/atlas/workspace/tasks/${args.id}/log?tail=${args.tail || 50000}`)).log || '',
  },
  {
    name: 'get_task_diff',
    description: 'Git diff for a task that has a worktree branch. Empty string if no changes.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args) => (await api('GET', `/api/atlas/workspace/tasks/${args.id}/diff`)).diff || '',
  },
  {
    name: 'merge_task',
    description: 'FF-merge the task branch into the project (local only). Cleans up worktree + branch.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args) => api('POST', `/api/atlas/workspace/tasks/${args.id}/merge`),
  },
  {
    name: 'merge_and_push_task',
    description: 'FF-merge + git push origin <currentBranch>. Confirm before invoking — affects the remote.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args) => api('POST', `/api/atlas/workspace/tasks/${args.id}/merge-push`),
  },
  {
    name: 'open_pr_for_task',
    description: 'Push the workspace branch and open a GitHub PR (gh pr create). Requires gh CLI authed.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args) => api('POST', `/api/atlas/workspace/tasks/${args.id}/pr`),
  },
  {
    name: 'discard_task_worktree',
    description: 'Drop the worktree + branch for a task. The task itself stays in the DB.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args) => api('POST', `/api/atlas/workspace/tasks/${args.id}/discard`),
  },
  {
    name: 'follow_up_task',
    description: 'Continue an existing task with a follow-up prompt. Resumes the parent claude session.',
    inputSchema: {
      type: 'object',
      required: ['parent_id', 'prompt'],
      properties: { parent_id: { type: 'string' }, prompt: { type: 'string' } },
    },
    handler: async (args) => api('POST', `/api/atlas/workspace/tasks/${args.parent_id}/follow-up`, { prompt: args.prompt }),
  },
  {
    name: 'get_project_memory',
    description: 'Read the per-project CLAUDE.md memory (auto-injected into spawns).',
    inputSchema: { type: 'object', required: ['project_id'], properties: { project_id: { type: 'string' } } },
    handler: async (args) => (await api('GET', `/api/atlas/workspace/projects/${args.project_id}/memory`)).body || '',
  },
  {
    name: 'set_project_memory',
    description: 'Replace the per-project CLAUDE.md memory.',
    inputSchema: {
      type: 'object',
      required: ['project_id', 'body'],
      properties: { project_id: { type: 'string' }, body: { type: 'string' } },
    },
    handler: async (args) => api('PUT', `/api/atlas/workspace/projects/${args.project_id}/memory`, { body: args.body }),
  },
  {
    name: 'list_templates',
    description: 'List vibe templates (built-in + custom).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => (await api('GET', '/api/atlas/workspace/templates')).templates || [],
  },
];

// ---- JSON-RPC plumbing ----

interface RpcRequest { jsonrpc: '2.0'; id?: number | string; method: string; params?: any }
interface RpcResponse { jsonrpc: '2.0'; id?: number | string | null; result?: any; error?: { code: number; message: string; data?: any } }

function ok(id: any, result: any): RpcResponse { return { jsonrpc: '2.0', id, result }; }
function err(id: any, code: number, message: string, data?: any): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

async function handle(req: RpcRequest): Promise<RpcResponse | null> {
  if (req.method === 'initialize') {
    return ok(req.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  }
  if (req.method === 'notifications/initialized') {
    return null; // notification, no response
  }
  if (req.method === 'ping') {
    return ok(req.id, {});
  }
  if (req.method === 'tools/list') {
    return ok(req.id, {
      tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });
  }
  if (req.method === 'tools/call') {
    const name = req.params?.name;
    const args = req.params?.arguments || {};
    const tool = TOOLS.find(t => t.name === name);
    if (!tool) return err(req.id, -32601, `Unknown tool: ${name}`);
    try {
      const result = await tool.handler(args);
      return ok(req.id, {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
      });
    } catch (e: any) {
      return ok(req.id, {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      });
    }
  }
  return err(req.id, -32601, `Method not found: ${req.method}`);
}

// ---- stdio loop ----

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk: string) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let req: RpcRequest;
    try { req = JSON.parse(line); }
    catch (e: any) {
      process.stdout.write(JSON.stringify(err(null, -32700, `Parse error: ${e.message}`)) + '\n');
      continue;
    }
    const res = await handle(req);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));

// Log startup banner to stderr (stdout reserved for JSON-RPC).
process.stderr.write(`[atlas-mcp] ready · ${TOOLS.length} tools · API=${API}\n`);
