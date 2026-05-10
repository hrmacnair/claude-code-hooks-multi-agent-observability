<template>
  <article class="card services">
    <span class="card-eyebrow">Services</span>
    <div class="services__hero">
      <span class="services__dot" :class="healthClass"></span>
      <span class="services__count">{{ heroText }}</span>
    </div>
    <ul v-if="items.length" class="services__list">
      <li v-for="s in items" :key="s.name">
        <span class="services__row-dot" :class="rowClass(s.status)"></span>
        <span class="services__row-name">{{ shortName(s.name) }}</span>
      </li>
    </ul>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAtlasStats } from '../../../composables/useAtlasStats';

const { stats } = useAtlasStats();

const items = computed(() => stats.value?.services.items ?? []);
const healthy = computed(() => stats.value?.services.healthy ?? 0);
const total = computed(() => stats.value?.services.total ?? 0);

const heroText = computed(() => {
  if (!total.value) return '—';
  if (healthy.value === total.value) return `${healthy.value} healthy`;
  return `${healthy.value} of ${total.value}`;
});

const healthClass = computed(() => {
  if (!total.value) return '';
  if (healthy.value === total.value) return 'is-ok';
  const failing = total.value - healthy.value;
  return failing >= total.value / 2 ? 'is-bad' : 'is-warn';
});

function rowClass(status: string) {
  if (status === 'running' || status === 'idle') return 'is-ok';
  return 'is-bad';
}

function shortName(name: string): string {
  return name.replace(/^com\.atlas\./, '');
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

.services__hero {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 44px;
  font-weight: 600;
  letter-spacing: -0.03em;
  color: var(--atlas-text-strong);
  line-height: 1;
}
@media (max-width: 1023px) { .services__hero { font-size: 36px; gap: 10px; } }

.services__dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--atlas-text-muted);
  flex: none;
}
.services__dot.is-ok   { background: var(--atlas-green); }
.services__dot.is-warn { background: var(--atlas-yellow); }
.services__dot.is-bad  { background: var(--atlas-red); }
.services__count { font-variant-numeric: tabular-nums; }

.services__list {
  margin: 20px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 16px;
}
.services__list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--atlas-text-secondary);
}
.services__row-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--atlas-text-muted);
  flex: none;
}
.services__row-dot.is-ok { background: var(--atlas-green); }
.services__row-dot.is-bad { background: var(--atlas-red); }
.services__row-name {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
