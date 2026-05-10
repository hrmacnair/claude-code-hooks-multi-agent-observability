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

// Dynamic-import the bot-tg router (it's ESM JS). routeMessage classifies
// the prompt, backendFor maps tier → CLI backend.
async function atlasTalk(message: string): Promise<{ reply: string; decision: any }> {
  const router = await import('/Users/hrmacnair/atlas/bot-tg/router.js');
  const decision = await router.routeMessage(message);
  const { backend, model } = router.backendFor(decision.model);
  const cwd = router.workingDirFor(decision.agent, decision.project);
  const systemPrompt = router.systemPromptFor(decision.agent, decision.project, 'dashboard');

  let reply: string;
  try {
    if (backend === 'anthropic') {
      reply = await runClaudeCLI({ model, prompt: message, systemPrompt, cwd });
    } else if (backend === 'openai' || backend === 'ollama') {
      reply = await runCodexCLI({ backend, model, prompt: message, systemPrompt, cwd });
    } else {
      reply = `(unsupported backend: ${backend})`;
    }
  } catch (err: any) {
    reply = `(model error: ${err.message?.slice(0, 240) || err})`;
  }

  // Log routing decision
  try {
    router.logRoutingDecision({ surface: 'dashboard', message, decision });
  } catch {/* non-fatal */}

  return { reply, decision };
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

    // GET /api/atlas/briefs - walk ~/atlas/briefs/archive/<date>/<slug>.html
    if (url.pathname === '/api/atlas/briefs' && req.method === 'GET') {
      const briefs = await getAtlasBriefs();
      return new Response(JSON.stringify({ briefs }), {
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

    // POST /api/atlas/talk - route + spawn model, return reply
    if (url.pathname === '/api/atlas/talk' && req.method === 'POST') {
      try {
        const body = await req.json() as { message?: string };
        const message = (body.message || '').toString().trim();
        if (!message) {
          return new Response(JSON.stringify({ error: 'message required' }), {
            status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        const result = await atlasTalk(message);
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