<template>
  <div class="ws-page">
    <header class="ws-page__head">
      <button class="ws-page__back" @click="$emit('close')">← Atlas</button>
      <div class="ws-page__title-block">
        <span class="ws-page__eyebrow">Atlas · Workspace</span>
        <h1 class="ws-page__title">Vibe kanban</h1>
      </div>
      <button class="ws-page__add" @click="newTaskOpen = true" :disabled="!projects.length">+ New task</button>
    </header>

    <main class="ws-page__body">
      <!-- Project selector strip -->
      <section class="ws-projects">
        <div
          v-for="p in projects"
          :key="p.id"
          class="ws-projects__chip"
          :class="{ 'is-active': activeProject === p.id }"
          @click="activeProject = p.id"
          :title="p.path"
        >
          <span class="ws-projects__name">{{ p.name }}</span>
          <span class="ws-projects__count" v-if="p.task_counts">
            {{ p.task_counts.running + p.task_counts.backlog }}
          </span>
          <span v-if="(p.spend?.cost_usd ?? 0) > 0" class="ws-projects__spend" :title="`${p.spend?.tasks} task(s) costed`">
            ${{ (p.spend?.cost_usd ?? 0).toFixed(2) }}
          </span>
          <button class="ws-projects__memory" @click.stop="onEditMemory(p)" title="Edit project memory (CLAUDE.md)">📝</button>
        </div>
        <button class="ws-projects__chip ws-projects__chip--new" @click="addProjectOpen = true">+ Project</button>
      </section>

      <p v-if="!projects.length" class="ws-empty">
        No projects yet. Register one — a folder on disk you want agents to work in.
      </p>

      <Kanban
        v-else
        :tasks="visibleTasks"
        :pinned-ids="pinnedIds"
        @open="(t) => openTask = t"
        @spawn="onSpawn"
        @kill="onKill"
        @done="onDone"
        @delete="onDelete"
        @toggle-pin="onTogglePin"
        @drop-task="onDropTask"
      />

      <PaneGrid
        v-if="pinnedTasks.length > 0"
        :pinned-tasks="pinnedTasks"
        :live-logs="liveLogs"
        @kill="onKill"
        @rerun="onRerun"
        @expand="(t) => openTask = t"
        @unpin="onTogglePin"
        @unpin-all="unpinAllRemote()"
      />

      <BroadcastDock
        v-if="projects.length > 0"
        :candidates="pinnedTasks"
        @broadcast="onBroadcast"
      />
    </main>

    <NewTaskDialog
      v-if="newTaskOpen"
      :projects="projects"
      :default-project-id="activeProject"
      :templates="templates"
      @close="newTaskOpen = false"
      @create="onCreateTask"
    />

    <ProjectMemoryDialog
      v-if="memoryFor"
      :project="memoryFor"
      :load="() => getProjectMemory(memoryFor!.id)"
      :save="(b: string) => setProjectMemory(memoryFor!.id, b)"
      @close="memoryFor = null"
    />

    <TaskDetailDrawer
      v-if="openTask"
      :task="openTask"
      :live-log="liveLogs[openTask.id] || ''"
      @close="openTask = null"
    />

    <!-- Project add inline dialog -->
    <div v-if="addProjectOpen" class="proj-dialog-bg" @click.self="addProjectOpen = false">
      <div class="proj-dialog">
        <header class="proj-dialog__head">
          <h3>Register project</h3>
          <button class="proj-dialog__x" @click="addProjectOpen = false">✕</button>
        </header>
        <label class="proj-dialog__field">
          <span>Name</span>
          <input v-model="newProjName" placeholder="Margin" />
        </label>
        <label class="proj-dialog__field">
          <span>Path</span>
          <input v-model="newProjPath" placeholder="/Users/hrmacnair/margin or ~/atlas/projects/industry" />
        </label>
        <p v-if="projError" class="proj-dialog__err">{{ projError }}</p>
        <footer class="proj-dialog__foot">
          <button class="proj-dialog__btn proj-dialog__btn--ghost" @click="addProjectOpen = false">Cancel</button>
          <button class="proj-dialog__btn proj-dialog__btn--primary" :disabled="!newProjName || !newProjPath" @click="onAddProject">Register</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useWorkspace, type WSTask, type WSProject } from '../composables/useWorkspace';
import Kanban from '../components/workspace/Kanban.vue';
import NewTaskDialog from '../components/workspace/NewTaskDialog.vue';
import TaskDetailDrawer from '../components/workspace/TaskDetailDrawer.vue';
import PaneGrid from '../components/workspace/PaneGrid.vue';
import BroadcastDock from '../components/workspace/BroadcastDock.vue';
import ProjectMemoryDialog from '../components/workspace/ProjectMemoryDialog.vue';

defineEmits<{ (e: 'close'): void }>();

const {
  projects, tasks, pinnedIds, templates, liveLogs,
  createProject, createTask, taskAction,
  pinTaskRemote, unpinTaskRemote, unpinAllRemote,
  getProjectMemory, setProjectMemory,
} = useWorkspace();

// ---- Pin state (server-persisted) ----
const MAX_PINS = 8;
const pinnedTasks = computed(() =>
  pinnedIds.value
    .map(id => tasks.value.find(t => t.id === id))
    .filter((t): t is WSTask => !!t)
);

async function onTogglePin(t: WSTask) {
  if (pinnedIds.value.includes(t.id)) {
    try { await unpinTaskRemote(t.id); } catch (e: any) { alert(e.message); }
  } else {
    if (pinnedIds.value.length >= MAX_PINS) {
      alert(`Max ${MAX_PINS} pinned panes. Unpin one first.`);
      return;
    }
    try { await pinTaskRemote(t.id); } catch (e: any) { alert(e.message); }
  }
}

// ---- Project memory editor ----
const memoryFor = ref<WSProject | null>(null);
function onEditMemory(p: WSProject) { memoryFor.value = p; }

async function onRerun(t: WSTask) {
  // Create new task with same prompt + spawn
  try {
    const fresh = await createTask({
      project_id: t.project_id,
      title: t.title,
      prompt: t.prompt,
      model: t.model,
      mode: t.mode,
    });
    await taskAction(fresh.id, 'spawn');
    // Auto-pin: swap original pin to fresh
    const i = pinnedIds.value.indexOf(t.id);
    if (i >= 0) {
      pinnedIds.value = pinnedIds.value.map(id => id === t.id ? fresh.id : id);
    }
  } catch (e: any) { alert('Re-run failed: ' + e.message); }
}

async function onDropTask(p: { taskId: string; toColumn: string }) {
  const t = tasks.value.find(x => x.id === p.taskId);
  if (!t) return;
  // Backlog drop on running task = no-op (can't restart implicit). Running drop = error.
  if (p.toColumn === 'running') {
    if (t.status === 'backlog' || t.status === 'review' || t.status === 'failed' || t.status === 'done') {
      // Spawn or re-spawn (re-run for terminal states)
      if (t.status === 'backlog') {
        await onSpawn(t);
      } else {
        await onRerun(t);
      }
    }
    return;
  }
  if (p.toColumn === 'review' || p.toColumn === 'done' || p.toColumn === 'backlog') {
    // Skip if already there or if currently running (must kill first)
    if (t.status === 'running') { alert('Kill the task before moving.'); return; }
    if (t.status === p.toColumn) return;
    try {
      await taskAction(t.id, 'move', { status: p.toColumn });
      t.status = p.toColumn as any;
    } catch (e: any) { alert(e.message); }
  }
}

async function onBroadcast(payload: { prompt: string; titlePrefix: string; targetIds: string[] }) {
  const targets = pinnedTasks.value.filter(t => payload.targetIds.includes(t.id));
  if (!targets.length) return;
  const newPins: string[] = [];
  for (const t of targets) {
    try {
      const fresh = await createTask({
        project_id: t.project_id,
        title: `${payload.titlePrefix}: ${payload.prompt.slice(0, 40)}${payload.prompt.length > 40 ? '…' : ''}`,
        prompt: payload.prompt,
        model: t.model,
        mode: t.mode,
      });
      await taskAction(fresh.id, 'spawn');
      newPins.push(fresh.id);
    } catch (e: any) {
      console.error('[broadcast] fan-out failed for', t.id, e);
    }
  }
  // Pin all fresh tasks (replacing any over-the-limit existing pins)
  const combined = [...pinnedIds.value, ...newPins].slice(-MAX_PINS);
  pinnedIds.value = [...new Set(combined)];
}

const activeProject = ref<string | null>(null);
const newTaskOpen = ref(false);
const openTask = ref<WSTask | null>(null);

const addProjectOpen = ref(false);
const newProjName = ref('');
const newProjPath = ref('');
const projError = ref<string | null>(null);

// Auto-select first project when list loads
watch(projects, (p) => {
  if (!activeProject.value && p.length) activeProject.value = p[0].id;
}, { immediate: true });

const visibleTasks = computed(() => {
  if (!activeProject.value) return tasks.value;
  return tasks.value.filter(t => t.project_id === activeProject.value);
});

async function onAddProject() {
  projError.value = null;
  try {
    const proj = await createProject(newProjName.value.trim(), newProjPath.value.trim());
    activeProject.value = proj.id;
    addProjectOpen.value = false;
    newProjName.value = '';
    newProjPath.value = '';
  } catch (e: any) {
    projError.value = e.message;
  }
}

async function onCreateTask(payload: any, runImmediately: boolean) {
  try {
    const t = await createTask(payload);
    newTaskOpen.value = false;
    if (runImmediately) {
      await taskAction(t.id, 'spawn');
    }
  } catch (e: any) {
    alert('Failed to create task: ' + e.message);
  }
}

async function onSpawn(t: WSTask) {
  try { await taskAction(t.id, 'spawn'); } catch (e: any) { alert(e.message); }
}
async function onKill(t: WSTask) {
  if (!confirm(`Kill "${t.title}"?`)) return;
  try { await taskAction(t.id, 'kill'); } catch (e: any) { alert(e.message); }
}
async function onDone(t: WSTask) {
  try { await taskAction(t.id, 'move', { status: 'done' }); t.status = 'done'; } catch (e: any) { alert(e.message); }
}
async function onDelete(t: WSTask) {
  if (!confirm(`Delete "${t.title}"?`)) return;
  try {
    await taskAction(t.id, 'delete');
    // Optimistic remove
    const i = tasks.value.findIndex(x => x.id === t.id);
    if (i >= 0) tasks.value.splice(i, 1);
  } catch (e: any) { alert(e.message); }
}
</script>

<style scoped>
.ws-page {
  position: fixed; inset: 0;
  background: var(--atlas-page-bg);
  overflow-y: auto;
  z-index: 100;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
}

.ws-page__head {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 40px 48px 24px;
  border-bottom: 1px solid var(--atlas-hairline);
}
@media (max-width: 1023px) {
  .ws-page__head { padding: 28px 24px 18px; gap: 12px; }
}

.ws-page__back {
  background: transparent;
  border: 1px solid var(--atlas-hairline);
  color: var(--atlas-text-primary);
  font-family: inherit;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.ws-page__back:hover { background: var(--atlas-card-bg); }

.ws-page__title-block { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.ws-page__eyebrow {
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--atlas-text-secondary);
}
.ws-page__title {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--atlas-text-strong);
}

.ws-page__add {
  background: var(--atlas-blue);
  color: white;
  border: none;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  padding: 10px 18px;
  border-radius: 8px;
  cursor: pointer;
}
.ws-page__add:hover { opacity: 0.9; }
.ws-page__add:disabled { opacity: 0.4; cursor: not-allowed; }

.ws-page__body {
  padding: 24px 48px 48px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
@media (max-width: 1023px) {
  .ws-page__body { padding: 18px 24px 40px; gap: 14px; }
}

.ws-projects {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ws-projects__chip {
  background: var(--atlas-card-bg);
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 13px;
  color: var(--atlas-text-primary);
  padding: 6px 8px 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background-color 100ms ease, border-color 100ms ease;
}
.ws-projects__chip:hover { background: var(--atlas-card-bg-2, rgba(127,127,127,0.08)); }
.ws-projects__chip.is-active {
  border-color: var(--atlas-blue);
  color: var(--atlas-text-strong);
  font-weight: 600;
}
.ws-projects__name { line-height: 1; }
.ws-projects__count {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
  background: rgba(94,158,255,0.15);
  color: var(--atlas-blue);
  padding: 1px 6px;
  border-radius: 4px;
}
.ws-projects__spend {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
  color: var(--atlas-text-secondary);
  opacity: 0.8;
}
.ws-projects__memory {
  background: transparent;
  border: none;
  color: var(--atlas-text-secondary);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 100ms ease, background-color 100ms ease;
}
.ws-projects__memory:hover { opacity: 1; background: rgba(127,127,127,0.12); }
.ws-projects__chip--new {
  background: transparent;
  border: 1px dashed var(--atlas-hairline);
  color: var(--atlas-text-secondary);
  padding: 6px 12px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  border-radius: 8px;
}

.ws-empty {
  font-size: 14px;
  color: var(--atlas-text-secondary);
  text-align: center;
  padding: 60px 20px;
}

/* project add dialog */
.proj-dialog-bg {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.45);
  display: grid; place-items: center;
  z-index: 200; padding: 40px;
}
.proj-dialog {
  background: var(--atlas-page-bg);
  border-radius: 14px;
  padding: 24px;
  width: 100%; max-width: 480px;
  display: flex; flex-direction: column; gap: 14px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.45);
}
.proj-dialog__head {
  display: flex; justify-content: space-between; align-items: center;
}
.proj-dialog__head h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--atlas-text-strong);
}
.proj-dialog__x {
  background: transparent; border: none;
  font-size: 16px; color: var(--atlas-text-secondary);
  cursor: pointer; padding: 4px 8px;
}
.proj-dialog__field {
  display: flex; flex-direction: column; gap: 6px;
}
.proj-dialog__field span {
  font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--atlas-text-secondary);
}
.proj-dialog__field input {
  background: var(--atlas-card-bg);
  border: 1px solid var(--atlas-hairline);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 14px;
  color: var(--atlas-text-primary);
  outline: none;
}
.proj-dialog__field input:focus { border-color: var(--atlas-blue); }
.proj-dialog__err { margin: 0; font-size: 13px; color: var(--atlas-red, #ff453a); }
.proj-dialog__foot {
  display: flex; gap: 10px; justify-content: flex-end;
}
.proj-dialog__btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--atlas-hairline);
  background: transparent;
  color: var(--atlas-text-primary);
  cursor: pointer;
}
.proj-dialog__btn:hover { background: var(--atlas-card-bg); }
.proj-dialog__btn--primary {
  background: var(--atlas-blue);
  border-color: var(--atlas-blue);
  color: white;
}
.proj-dialog__btn--primary:disabled { opacity: 0.4; cursor: not-allowed; }
.proj-dialog__btn--ghost { color: var(--atlas-text-secondary); }
</style>
