<template>
  <article class="card brief" :class="{ 'is-compact': compact }">
    <div class="brief__head">
      <div class="brief__eyebrow-row">
        <span class="card-eyebrow">{{ eyebrow }}</span>
        <button
          v-if="data && !data.empty && data.hasMultipleToday"
          class="brief__earlier"
          @click="showEarlier = !showEarlier"
        >Earlier today ({{ data.earlierToday.length }}) →</button>
      </div>

      <h2 v-if="effectiveBrief" class="brief__title">{{ effectiveBrief.title }}</h2>
      <h2 v-else-if="!loading" class="brief__title brief__title--muted">No brief yet.</h2>
    </div>

    <p v-if="data?.empty && data.latestPriorBrief" class="brief__subtitle">
      No brief today — showing the most recent.
    </p>

    <div v-if="effectiveBrief">
      <p v-if="compact && effectiveBrief.tldr" class="brief__lede">{{ effectiveBrief.tldr }}</p>
      <a v-if="compact" class="brief__cta" href="#" @click.prevent="$emit('open-full', effectiveBrief)">Tap to read →</a>

      <div v-else-if="effectiveBrief.htmlBody" class="brief__body" v-html="effectiveBrief.htmlBody"></div>
    </div>

    <div v-if="loading" class="brief__loading">Loading today's brief…</div>

    <div v-if="showEarlier && data?.earlierToday?.length" class="brief__popover" @click.self="showEarlier = false">
      <div class="brief__popover-inner">
        <span class="card-eyebrow">Earlier today</span>
        <ul>
          <li v-for="b in data.earlierToday" :key="b.slug">
            <a href="#" @click.prevent="emit('open-prior', b)">{{ b.title }}</a>
          </li>
        </ul>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { API_BASE_URL } from '../../../config';

const props = defineProps<{ compact?: boolean }>();
const emit = defineEmits<{
  (e: 'open-full', brief: any): void;
  (e: 'open-prior', brief: any): void;
}>();

const data = ref<any>(null);
const loading = ref(true);
const showEarlier = ref(false);

const effectiveBrief = computed<any | null>(() => {
  if (!data.value) return null;
  if (!data.value.empty) return data.value;
  return data.value.latestPriorBrief || null;
});

const eyebrow = computed(() => {
  if (!data.value) return "Today's brief";
  if (!data.value.empty) {
    return `Today's brief${data.value.date ? ` · ${formatDate(data.value.date)}` : ''}`;
  }
  const prior = data.value.latestPriorBrief;
  return prior ? `Brief · ${formatDate(prior.date)}` : "Today's brief";
});

async function load() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/atlas/brief/today`);
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
  } catch {
    return iso;
  }
}

onMounted(load);
void props;
</script>

<style scoped>
.card {
  position: relative;
  background: var(--atlas-card-bg);
  border-radius: 20px;
  padding: 48px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
@media (max-width: 1023px) { .card { padding: 32px 24px; } }
.card.is-compact { padding: 32px 24px; }

.brief__head { display: flex; flex-direction: column; gap: 12px; }

.brief__eyebrow-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.card-eyebrow {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--atlas-text-secondary);
}

.brief__earlier {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--atlas-blue);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: opacity 0.15s ease;
}
.brief__earlier:hover { opacity: 0.7; }

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
  margin: 12px 0 0;
  font-size: 15px;
  color: var(--atlas-text-secondary);
}
.brief__link { color: var(--atlas-blue); font-weight: 500; }
.brief__link:hover { opacity: 0.7; }

.brief__lede {
  margin: 24px 0 16px;
  font-size: 19px;
  font-weight: 400;
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

.brief__body {
  margin-top: 32px;
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
.brief__body :deep(li) {
  margin-bottom: 8px;
  font-weight: 400;
}
.brief__body :deep(li > em) {
  color: var(--atlas-text-secondary);
  font-style: italic;
}
.brief__body :deep(a) {
  color: var(--atlas-blue);
  text-decoration: none;
}
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
  margin-top: 16px;
  font-size: 15px;
  color: var(--atlas-text-secondary);
}

.brief__popover {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.20);
  border-radius: 20px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 60px 32px 0 0;
}
.brief__popover-inner {
  width: min(280px, 80%);
  padding: 16px;
  background: var(--atlas-page-bg);
  border: 1px solid var(--atlas-hairline);
  border-radius: 12px;
}
.brief__popover-inner ul { margin: 8px 0 0; padding: 0; list-style: none; }
.brief__popover-inner li { padding: 6px 0; }
.brief__popover-inner a { color: var(--atlas-text-primary); font-size: 14px; font-weight: 500; }
.brief__popover-inner a:hover { color: var(--atlas-blue); opacity: 1; }
</style>
