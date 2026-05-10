<template>
  <article class="card live-activity">
    <span class="card-eyebrow">Live activity</span>
    <ul v-if="rows.length" class="la__list">
      <li v-for="e in rows" :key="`${e.id}-${e.timestamp}`" class="la__row">
        <span class="la__time">{{ formatHM(e.timestamp) }}</span>
        <span class="la__dot" :class="dotClass(e)"></span>
        <span class="la__app">{{ e.source_app }}</span>
        <span class="la__type">{{ labelFor(e.hook_event_type) }}</span>
        <span v-if="summaryOf(e)" class="la__sum">{{ summaryOf(e) }}</span>
      </li>
    </ul>
    <div v-else class="la__empty">Stream is quiet.</div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { HookEvent } from '../../../types';
import { useEventEmojis } from '../../../composables/useEventEmojis';

const props = defineProps<{ events: HookEvent[] }>();
const { getLabelForEventType, getToneForEventType } = useEventEmojis();

const rows = computed(() => props.events.slice(-18).reverse());

function labelFor(t: string): string { return getLabelForEventType(t); }

function dotClass(e: HookEvent): string {
  const tone = getToneForEventType(e.hook_event_type);
  if (tone === 'success') return 'is-ok';
  if (tone === 'error') return 'is-bad';
  if (tone === 'warning') return 'is-warn';
  return '';
}

function summaryOf(e: HookEvent): string {
  if (e.summary) return e.summary;
  const p: any = e.payload || {};
  if (p.tool_name && p.tool_input) {
    const i = p.tool_input;
    if (i.command) return String(i.command).slice(0, 60);
    if (i.file_path) return String(i.file_path).split('/').pop() || '';
    if (i.url) return String(i.url).slice(0, 60);
  }
  return '';
}

function formatHM(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

.la__list {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.la__row {
  display: grid;
  grid-template-columns: 64px 10px auto auto 1fr;
  align-items: baseline;
  gap: 10px;
  font-size: 14px;
  line-height: 1.4;
  color: var(--atlas-text-secondary);
  overflow: hidden;
}
.la__time {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 12.5px;
  color: var(--atlas-text-muted);
  font-variant-numeric: tabular-nums;
}
.la__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--atlas-text-muted);
  align-self: center;
}
.la__dot.is-ok { background: var(--atlas-green); }
.la__dot.is-bad { background: var(--atlas-red); }
.la__dot.is-warn { background: var(--atlas-yellow); }
.la__app {
  font-weight: 500;
  color: var(--atlas-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
.la__type {
  color: var(--atlas-text-secondary);
  font-size: 13px;
  white-space: nowrap;
}
.la__sum {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 12.5px;
  color: var(--atlas-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.la__empty {
  margin-top: 16px;
  font-size: 15px;
  color: var(--atlas-text-secondary);
}
</style>
