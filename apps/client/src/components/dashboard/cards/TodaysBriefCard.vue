<template>
  <article class="card brief" :class="{ 'is-compact': compact }">
    <!-- Tabs row (only when ≥2 briefs today) -->
    <div v-if="!compact && briefs.length > 1" class="brief__tabs" role="tablist">
      <button
        v-for="(b, i) in briefs"
        :key="b.slug"
        class="brief__tab"
        :class="{ 'is-active': i === activeIndex }"
        role="tab"
        :aria-selected="i === activeIndex"
        @click="activeIndex = i"
      >{{ b.topic.toUpperCase() }}<span v-if="b.time"> · {{ b.time }}</span></button>
    </div>

    <header class="brief__head">
      <span class="card-eyebrow">{{ eyebrow }}</span>
      <h2 v-if="current" class="brief__title">{{ current.title }}</h2>
      <h2 v-else-if="!loading" class="brief__title brief__title--muted">No brief yet.</h2>
      <p v-if="data?.latestPriorBrief && !briefs.length" class="brief__subtitle">
        No brief today — showing the most recent.
      </p>
    </header>

    <!-- Mobile compact: tldr + tap-to-read -->
    <template v-if="compact && current">
      <p v-if="current.tldr" class="brief__lede">{{ current.tldr }}</p>
      <a class="brief__cta" href="#" @click.prevent="$emit('open-full', current)">Tap to read →</a>
    </template>

    <!-- Desktop full: scrollable body -->
    <div v-else-if="current?.htmlBody" class="brief__scroll">
      <div class="brief__body" v-html="current.htmlBody"></div>
    </div>

    <div v-if="loading" class="brief__loading">Loading…</div>
  </article>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { API_BASE_URL } from '../../../config';

const props = defineProps<{ compact?: boolean }>();
const emit = defineEmits<{
  (e: 'open-full', brief: any): void;
}>();

const data = ref<any>(null);
const loading = ref(true);
const activeIndex = ref(0);

const briefs = computed<any[]>(() => data.value?.briefs ?? []);

const current = computed<any | null>(() => {
  if (briefs.value.length) return briefs.value[activeIndex.value] ?? briefs.value[0];
  return data.value?.latestPriorBrief ?? null;
});

const eyebrow = computed(() => {
  if (briefs.value.length) {
    const c = current.value;
    return c ? `Today's brief · ${formatDate(c.date)}` : "Today's brief";
  }
  const prior = data.value?.latestPriorBrief;
  return prior ? `Brief · ${formatDate(prior.date)}` : "Today's brief";
});

async function load() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/atlas/briefs/today`);
    if (res.ok) data.value = await res.json();
  } catch (err) {
    console.error('[brief/today] failed', err);
  } finally {
    loading.value = false;
  }
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

onMounted(load);
void props;
void emit;
</script>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--atlas-card-bg);
  border-radius: 20px;
  padding: 48px;
  min-height: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
.card.is-compact {
  padding: 24px;
  height: auto;
}
@media (max-width: 1023px) {
  .card { padding: 24px; height: auto; }
}

/* Tabs */
.brief__tabs {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--atlas-hairline);
  flex: none;
}
.brief__tab {
  position: relative;
  padding: 8px 0;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--atlas-text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s ease;
}
.brief__tab:hover { color: var(--atlas-text-primary); }
.brief__tab.is-active { color: var(--atlas-text-strong); }
.brief__tab.is-active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--atlas-blue);
}

.brief__head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: none;
  margin-bottom: 24px;
}
.card-eyebrow {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--atlas-text-secondary);
}
.brief__title {
  margin: 0;
  font-size: 36px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--atlas-text-strong);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
@media (max-width: 1023px) { .brief__title { font-size: 28px; } }
.brief__title--muted { color: var(--atlas-text-secondary); font-weight: 500; }
.brief__subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--atlas-text-secondary);
}

.brief__lede {
  margin: 0 0 16px;
  font-size: 17px;
  line-height: 1.5;
  color: var(--atlas-text-primary);
}
.brief__cta {
  display: inline-block;
  color: var(--atlas-blue);
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
}

.brief__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--atlas-hairline) transparent;
  padding-right: 4px;
}
.brief__scroll::-webkit-scrollbar { width: 8px; }
.brief__scroll::-webkit-scrollbar-track { background: transparent; }
.brief__scroll::-webkit-scrollbar-thumb { background: var(--atlas-hairline); border-radius: 4px; }
.brief__scroll::-webkit-scrollbar-thumb:hover { background: var(--atlas-text-muted); }

.brief__body {
  max-width: 680px;
  color: var(--atlas-text-primary);
}
.brief__body :deep(p) {
  margin: 0 0 24px;
  font-size: 19px;
  font-weight: 400;
  line-height: 1.6;
}
.brief__body :deep(h2) {
  margin: 48px 0 16px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--atlas-text-strong);
}
.brief__body :deep(h2):first-child { margin-top: 0; }
.brief__body :deep(h3) {
  margin: 32px 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: var(--atlas-text-strong);
}
.brief__body :deep(ul),
.brief__body :deep(ol) {
  margin: 0 0 24px;
  padding-left: 24px;
  font-size: 19px;
  line-height: 1.6;
}
.brief__body :deep(li) { margin-bottom: 8px; font-weight: 400; }
.brief__body :deep(li > em) { color: var(--atlas-text-secondary); font-style: italic; }
.brief__body :deep(a) { color: var(--atlas-blue); text-decoration: none; }
.brief__body :deep(a:hover) { opacity: 0.7; }
.brief__body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 0.92em;
  background: var(--atlas-card-bg-2);
  padding: 2px 6px;
  border-radius: 4px;
}
.brief__body :deep(blockquote) {
  margin: 32px 0;
  padding-left: 20px;
  border-left: 3px solid var(--atlas-blue);
  color: var(--atlas-text-secondary);
  font-style: italic;
  font-size: 17px;
}
.brief__body :deep(hr) {
  margin: 48px 0;
  border: none;
  border-top: 1px solid var(--atlas-hairline);
}
.brief__body :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 24px 0;
  font-size: 14px;
}
.brief__body :deep(th),
.brief__body :deep(td) {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--atlas-hairline);
}
.brief__body :deep(th) { font-weight: 600; color: var(--atlas-text-strong); }
.brief__body :deep(.brief-eyebrow),
.brief__body :deep(.brief-meta) { display: none; }
.brief__body :deep(.action),
.brief__body :deep(.brief-action),
.brief__body :deep(.recommended-action) {
  margin: 32px 0;
  padding: 24px;
  background: var(--atlas-page-bg);
  border-left: 3px solid var(--atlas-blue);
  border-radius: 16px;
}

.brief__loading {
  font-size: 15px;
  color: var(--atlas-text-secondary);
}
</style>
