<template>
  <article class="card waad">
    <span class="card-eyebrow">What Atlas did</span>
    <ul v-if="rows.length" class="waad__list">
      <li v-for="e in rows" :key="`${e.id}-${e.timestamp}`" class="waad__row">
        <span class="waad__time">{{ formatHM(e.timestamp) }}</span>
        <span class="waad__body">
          <span class="waad__app">{{ e.source_app }}</span>
          <span class="waad__sep">·</span>
          <span class="waad__text">{{ rowText(e) }}</span>
        </span>
      </li>
    </ul>
    <div v-else class="waad__empty">No recent activity yet.</div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { HookEvent } from '../../../types';
import { useEventEmojis } from '../../../composables/useEventEmojis';

const props = defineProps<{ events: HookEvent[] }>();
const { getLabelForEventType } = useEventEmojis();

const importantTypes = new Set([
  'SubagentStop',
  'ResearchBriefCompleted',
  'PostToolUseFailure',
  'Stop',
]);

const rows = computed(() => {
  return props.events
    .filter(e => importantTypes.has(e.hook_event_type) || !!e.summary)
    .slice(-10)
    .reverse();
});

function formatHM(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function rowText(e: HookEvent): string {
  if (e.summary) return e.summary;
  const label = getLabelForEventType(e.hook_event_type);
  const p: any = e.payload || {};
  if (p.tool_name) return `${label} · ${p.tool_name}`;
  return label;
}
</script>

<style scoped>
.card {
  background: var(--atlas-card-bg);
  border-radius: 20px;
  padding: 32px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
@media (max-width: 1023px) { .card { padding: 24px; } }

.card-eyebrow {
  display: block;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--atlas-text-secondary);
}

.waad__list {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.waad__row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 16px;
  align-items: baseline;
}
.waad__time {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 13px;
  color: var(--atlas-text-muted);
  font-variant-numeric: tabular-nums;
}
.waad__body {
  font-size: 15px;
  color: var(--atlas-text-primary);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
}
.waad__app {
  color: var(--atlas-text-strong);
  font-weight: 500;
}
.waad__sep { color: var(--atlas-text-muted); margin: 0 6px; }
.waad__text { color: var(--atlas-text-secondary); }

.waad__empty {
  margin-top: 16px;
  font-size: 15px;
  color: var(--atlas-text-secondary);
}
</style>
