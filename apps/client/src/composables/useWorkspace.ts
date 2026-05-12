// Workspace state — fetch projects/tasks, listen for ws.* events on the
// existing dashboard WebSocket, expose mutating actions.
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { API_BASE_URL, WS_URL } from '../config';

export interface WSProject {
  id: string;
  name: string;
  path: string;
  created_at: number;
  task_counts: { backlog: number; running: number; review: number; done: number };
}
export interface WSTask {
  id: string;
  project_id: string;
  project_name?: string;
  project_path?: string;
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
}

export function useWorkspace() {
  const projects = ref<WSProject[]>([]);
  const tasks = ref<WSTask[]>([]);
  const error = ref<string | null>(null);
  const loading = ref(false);
  // Live log buffers per task: taskId → string (rolling tail)
  const liveLogs = ref<Record<string, string>>({});

  async function refresh() {
    loading.value = true;
    try {
      const [pr, tr] = await Promise.all([
        fetch(`${API_BASE_URL}/api/atlas/workspace/projects`).then(r => r.json()),
        fetch(`${API_BASE_URL}/api/atlas/workspace/tasks`).then(r => r.json()),
      ]);
      projects.value = pr.projects || [];
      tasks.value = tr.tasks || [];
      error.value = null;
    } catch (e: any) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function createProject(name: string, path: string) {
    const r = await fetch(`${API_BASE_URL}/api/atlas/workspace/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path }),
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'create failed');
    await refresh();
    return r.project as WSProject;
  }

  async function deleteProject(id: string) {
    const r = await fetch(`${API_BASE_URL}/api/atlas/workspace/projects/${id}`, { method: 'DELETE' }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'delete failed');
    await refresh();
  }

  async function createTask(input: { project_id: string; title: string; prompt: string; model: string; mode: 'safe' | 'auto' }) {
    const r = await fetch(`${API_BASE_URL}/api/atlas/workspace/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || 'create failed');
    tasks.value = [r.task, ...tasks.value];
    return r.task as WSTask;
  }

  async function taskAction(id: string, action: 'spawn' | 'kill' | 'move' | 'delete', body: any = {}) {
    const r = await fetch(`${API_BASE_URL}/api/atlas/workspace/tasks/${id}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());
    if (!r.ok) throw new Error(r.error || `${action} failed`);
    return r;
  }

  async function fetchTaskLog(id: string): Promise<string> {
    const r = await fetch(`${API_BASE_URL}/api/atlas/workspace/tasks/${id}/log`).then(r => r.json());
    return r.log || '';
  }

  // Subscribe to workspace WebSocket events. Reuse the same /stream socket
  // the dashboard already opens — but we want our own subscription so we
  // get every event independent of useWebSocket's filter.
  let ws: WebSocket | null = null;
  function attachWS() {
    try {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (ev) => {
        let m: any;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m?.type === 'workspace.log') {
          const tid = m.data?.taskId;
          if (!tid) return;
          const prev = liveLogs.value[tid] || '';
          const next = (prev + m.data.text).slice(-200_000);
          liveLogs.value = { ...liveLogs.value, [tid]: next };
        } else if (m?.type === 'workspace.task') {
          const tid = m.data?.taskId;
          if (!tid) return;
          const t = tasks.value.find(t => t.id === tid);
          if (t) {
            if (m.data.status) t.status = m.data.status;
            if (typeof m.data.pid === 'number') t.pid = m.data.pid;
            if (typeof m.data.exit_code === 'number') t.exit_code = m.data.exit_code;
            // mutate triggers reactivity via array replacement
            tasks.value = [...tasks.value];
          } else {
            refresh();
          }
        }
      };
    } catch (e: any) {
      console.warn('[workspace] WS attach failed:', e.message);
    }
  }

  onMounted(() => {
    refresh();
    attachWS();
  });
  onUnmounted(() => { try { ws?.close(); } catch {} });

  const tasksByProject = computed(() => {
    const m: Record<string, WSTask[]> = {};
    for (const t of tasks.value) {
      if (!m[t.project_id]) m[t.project_id] = [];
      m[t.project_id].push(t);
    }
    return m;
  });

  return {
    projects, tasks, tasksByProject, liveLogs, error, loading,
    refresh, createProject, deleteProject, createTask, taskAction, fetchTaskLog,
  };
}
