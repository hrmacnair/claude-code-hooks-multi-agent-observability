<template>
  <div class="status-row">
    <a class="status-row__item" href="#stats" @click.prevent="scrollTo('stats')">
      <span class="status-row__value">${{ todayDollars }}</span>
      <span class="status-row__label">today</span>
    </a>
    <span class="status-row__sep">·</span>
    <a class="status-row__item" href="#services" @click.prevent="scrollTo('services')">
      <span class="status-row__dot" :class="healthClass"></span>
      <span>{{ healthyCount }} healthy</span>
    </a>
    <span class="status-row__sep">·</span>
    <a v-if="latestBriefTitle" class="status-row__item" href="#brief" @click.prevent="scrollTo('brief')">
      <span class="status-row__brief-icon" aria-hidden="true">◐</span>
      <span class="status-row__brief-text">{{ latestBriefTitle }}</span>
    </a>
    <span v-else class="status-row__item status-row__item--muted">no brief yet</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAtlasStats } from '../../composables/useAtlasStats';

const { stats } = useAtlasStats();

const todayDollars = computed(() => stats.value?.codeburn.today?.dollars?.toFixed(2) ?? '—');
const healthyCount = computed(() => stats.value?.services.healthy ?? 0);

const healthClass = computed(() => {
  const items = stats.value?.services.items || [];
  const failing = items.filter(i => i.status === 'failing').length;
  if (failing > 0 && failing >= items.length / 2) return 'is-bad';
  if (failing > 0) return 'is-warn';
  return 'is-ok';
});

const latestBriefTitle = computed(() => {
  const first = stats.value?.briefs.recent?.[0];
  if (!first) return '';
  const t: string | undefined = (first as any).title;
  return t || first.filename?.replace(/[-_]/g, ' ') || '';
});

function scrollTo(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<style scoped>
.status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 24px 48px;
  font-size: 15px;
  font-weight: 400;
  color: var(--atlas-text-secondary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
@media (max-width: 1023px) {
  .status-row { padding: 20px 24px; gap: 10px; font-size: 14px; }
}

.status-row__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: inherit;
  text-decoration: none;
  transition: opacity 0.15s ease;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-row__item:hover { opacity: 0.7; }
.status-row__item--muted { color: var(--atlas-text-muted); cursor: default; }

.status-row__value {
  color: var(--atlas-text-primary);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.status-row__label { color: var(--atlas-text-secondary); }
.status-row__sep { color: var(--atlas-text-muted); }

.status-row__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--atlas-text-muted);
}
.status-row__dot.is-ok   { background: var(--atlas-green); }
.status-row__dot.is-warn { background: var(--atlas-yellow); }
.status-row__dot.is-bad  { background: var(--atlas-red); }

.status-row__brief-icon { color: var(--atlas-yellow); font-size: 14px; }
.status-row__brief-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}
</style>
