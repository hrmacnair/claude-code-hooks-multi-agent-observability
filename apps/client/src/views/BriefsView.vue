<template>
  <div class="briefs-view">
    <header class="briefs-header">
      <div class="briefs-filters">
        <button
          v-for="topic in topics"
          :key="topic"
          class="atb-pill"
          :class="{ 'is-on': activeTopic === topic }"
          @click="activeTopic = topic"
        >{{ topic === 'all' ? 'All' : capitalize(topic) }}</button>
      </div>
      <div class="briefs-search">
        <input
          type="text"
          v-model="search"
          placeholder="Search briefs…"
          class="briefs-search__input"
        />
      </div>
    </header>

    <div class="briefs-body">
      <ul v-if="filtered.length" class="briefs-list">
        <li
          v-for="b in filtered"
          :key="b.path"
          class="briefs-list__row"
          :class="{ 'is-active': selected?.path === b.path }"
          @click="selected = b"
        >
          <span class="briefs-list__date">{{ b.date }}</span>
          <span class="briefs-list__topic">{{ b.topic }}</span>
          <span class="briefs-list__title">{{ b.title }}</span>
          <span class="briefs-list__tldr">{{ b.tldr }}</span>
        </li>
      </ul>
      <div v-else-if="loading" class="briefs-empty">Loading briefs…</div>
      <div v-else class="briefs-empty">No briefs match.</div>

      <div v-if="selected" class="briefs-detail">
        <div class="briefs-detail__bar">
          <span class="briefs-detail__meta">{{ selected.date }} · {{ selected.topic }}</span>
          <a class="briefs-detail__open" :href="proxyUrl(selected)" target="_blank" rel="noopener">Open in tab ↗</a>
          <button class="briefs-detail__close" @click="selected = null" aria-label="Close">✕</button>
        </div>
        <iframe class="briefs-detail__iframe" :src="proxyUrl(selected)" :title="selected.title"></iframe>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { API_BASE_URL } from '../config';

const briefs = ref<any[]>([]);
const loading = ref(false);
const search = ref('');
const activeTopic = ref<string>('all');
const selected = ref<any>(null);

const topics = computed(() => {
  const set = new Set<string>(['all']);
  briefs.value.forEach(b => set.add(b.topic));
  return Array.from(set);
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return briefs.value.filter(b => {
    if (activeTopic.value !== 'all' && b.topic !== activeTopic.value) return false;
    if (q && !(`${b.title} ${b.tldr}`.toLowerCase().includes(q))) return false;
    return true;
  });
});

function proxyUrl(b: any): string {
  return `${API_BASE_URL}/api/atlas/briefs/file?path=${encodeURIComponent(b.path)}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

onMounted(async () => {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/atlas/briefs`);
    if (res.ok) {
      const data = await res.json();
      briefs.value = data.briefs || [];
    }
  } catch (err) {
    console.error('[briefs] load failed', err);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.briefs-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--theme-bg-secondary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.briefs-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: var(--theme-bg-primary);
  border-bottom: 1px solid var(--theme-border-primary);
}
@media (max-width: 699px) {
  .briefs-header { padding: 10px 12px; flex-direction: column; align-items: stretch; gap: 8px; }
}

.briefs-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.atb-pill {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  background: var(--theme-bg-secondary);
  border: 1px solid var(--theme-border-primary);
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.atb-pill:hover { background: var(--theme-bg-tertiary); color: var(--theme-text-primary); }
.atb-pill.is-on {
  background: var(--theme-primary-light);
  color: var(--theme-primary);
  border-color: rgba(10, 132, 255, 0.35);
}

.briefs-search { flex: 1 1 220px; }
.briefs-search__input {
  width: 100%;
  padding: 7px 12px;
  font-size: 12px;
  font-family: inherit;
  background: var(--theme-bg-secondary);
  color: var(--theme-text-primary);
  border: 1px solid var(--theme-border-primary);
  border-radius: 8px;
  outline: none;
}
.briefs-search__input:focus {
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 3px var(--theme-primary-light);
}

.briefs-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 360px) 1fr;
  gap: 0;
  overflow: hidden;
}
@media (max-width: 899px) {
  .briefs-body { grid-template-columns: 1fr; }
}

.briefs-list {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  background: var(--theme-bg-primary);
  border-right: 1px solid var(--theme-border-primary);
}
.briefs-list__row {
  display: grid;
  grid-template-columns: 90px 80px 1fr;
  align-items: baseline;
  gap: 10px;
  padding: 12px 14px;
  font-size: 13px;
  border-bottom: 1px solid var(--theme-border-primary);
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.briefs-list__row:hover { background: var(--theme-hover-bg); }
.briefs-list__row.is-active { background: var(--theme-primary-light); }
.briefs-list__date {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11px;
  color: var(--theme-text-tertiary);
}
.briefs-list__topic {
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--theme-text-tertiary);
}
.briefs-list__title {
  grid-column: 3;
  font-weight: 500;
  color: var(--theme-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.briefs-list__tldr {
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--theme-text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.briefs-empty {
  padding: 24px;
  font-size: 13px;
  color: var(--theme-text-tertiary);
}

.briefs-detail {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--theme-bg-primary);
}
@media (max-width: 899px) {
  .briefs-detail {
    position: fixed;
    inset: 0;
    z-index: 50;
  }
}
.briefs-detail__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--theme-border-primary);
}
.briefs-detail__meta {
  font-size: 12px;
  color: var(--theme-text-tertiary);
  font-variant-numeric: tabular-nums;
  flex: 1;
}
.briefs-detail__open {
  font-size: 12px;
  color: var(--theme-primary);
  text-decoration: none;
}
.briefs-detail__open:hover { text-decoration: underline; }
.briefs-detail__close {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--theme-border-primary);
  border-radius: 6px;
  color: var(--theme-text-secondary);
  cursor: pointer;
  font-size: 11px;
}
.briefs-detail__close:hover { background: var(--theme-hover-bg); }

.briefs-detail__iframe {
  flex: 1;
  width: 100%;
  border: none;
  background: var(--theme-bg-primary);
}
</style>
