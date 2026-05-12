<template>
  <div class="kanban">
    <section v-for="col in COLUMNS" :key="col.key" class="kanban__col">
      <header class="kanban__col-head">
        <span class="kanban__col-name">{{ col.name }}</span>
        <span class="kanban__col-count">{{ countFor(col.key) }}</span>
      </header>
      <div class="kanban__col-body">
        <TaskCard
          v-for="t in tasksFor(col.key)"
          :key="t.id"
          :task="t"
          @open="(t) => $emit('open', t)"
          @spawn="(t) => $emit('spawn', t)"
          @kill="(t) => $emit('kill', t)"
          @done="(t) => $emit('done', t)"
          @delete="(t) => $emit('delete', t)"
        />
        <div v-if="tasksFor(col.key).length === 0" class="kanban__empty">
          <span v-if="col.key === 'backlog'">No tasks. Add one.</span>
          <span v-else>—</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import TaskCard from './TaskCard.vue';
import type { WSTask } from '../../composables/useWorkspace';

const props = defineProps<{ tasks: WSTask[] }>();
defineEmits<{
  (e: 'open' | 'spawn' | 'kill' | 'done' | 'delete', t: WSTask): void;
}>();

const COLUMNS = [
  { key: 'backlog', name: 'Backlog' },
  { key: 'running', name: 'Running' },
  { key: 'review',  name: 'Review' },
  { key: 'done',    name: 'Done' },
] as const;

function tasksFor(status: string): WSTask[] {
  // Treat 'failed' as 'review' visually (they need human attention).
  if (status === 'review') return props.tasks.filter(t => t.status === 'review' || t.status === 'failed');
  return props.tasks.filter(t => t.status === status);
}
function countFor(status: string): number {
  return tasksFor(status).length;
}
</script>

<style scoped>
.kanban {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  min-height: 400px;
}
@media (max-width: 1023px) {
  .kanban { grid-template-columns: 1fr; gap: 12px; }
}

.kanban__col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.kanban__col-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 4px;
}
.kanban__col-name {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--atlas-text-secondary);
}
.kanban__col-count {
  font-size: 11.5px;
  font-family: ui-monospace, Menlo, monospace;
  color: var(--atlas-text-secondary);
  opacity: 0.7;
}
.kanban__col-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(127,127,127,0.04);
  border-radius: 12px;
  padding: 10px;
  min-height: 320px;
}
.kanban__empty {
  font-size: 12px;
  color: var(--atlas-text-secondary);
  text-align: center;
  padding: 20px 8px;
  opacity: 0.55;
}
</style>
