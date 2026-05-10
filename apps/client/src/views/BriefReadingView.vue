<template>
  <div class="bread">
    <header class="bread__bar">
      <button class="bread__back" @click="$emit('close')" aria-label="Back">← Back</button>
    </header>
    <div class="bread__content">
      <span class="card-eyebrow">Today's brief · {{ formatDate(brief?.date) }}</span>
      <h1 class="bread__title">{{ brief?.title }}</h1>
      <div v-if="brief?.htmlBody" class="bread__body" v-html="brief.htmlBody"></div>
      <p v-else class="bread__loading">Loading…</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ brief: any }>();
defineEmits<{ (e: 'close'): void }>();

function formatDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}
</script>

<style scoped>
.bread {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: var(--atlas-page-bg);
  color: var(--atlas-text-primary);
  overflow-y: auto;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.bread__bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  padding: 16px 24px;
  background: var(--atlas-page-bg);
  border-bottom: 1px solid var(--atlas-hairline);
}
.bread__back {
  font-family: inherit;
  font-size: 15px;
  font-weight: 500;
  color: var(--atlas-blue);
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}
.bread__back:hover { opacity: 0.7; }

.bread__content {
  max-width: 680px;
  margin: 0 auto;
  padding: 32px 24px 80px;
}
.card-eyebrow {
  display: block;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--atlas-text-secondary);
  margin-bottom: 12px;
}
.bread__title {
  margin: 0 0 24px;
  font-size: 32px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: var(--atlas-text-strong);
}

.bread__body :deep(p) {
  margin: 0 0 24px;
  font-size: 17px;
  line-height: 1.6;
  color: var(--atlas-text-primary);
}
.bread__body :deep(h2) {
  margin: 40px 0 16px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--atlas-text-strong);
}
.bread__body :deep(ul),
.bread__body :deep(ol) {
  margin: 0 0 24px;
  padding-left: 22px;
  font-size: 17px;
  line-height: 1.6;
}
.bread__body :deep(li) { margin-bottom: 6px; }
.bread__body :deep(a) { color: var(--atlas-blue); text-decoration: none; }
.bread__body :deep(a:hover) { opacity: 0.7; }
.bread__body :deep(code) {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 0.92em;
  background: var(--atlas-card-bg);
  padding: 2px 6px;
  border-radius: 4px;
}
.bread__body :deep(.brief-eyebrow),
.bread__body :deep(.brief-meta) { display: none; }

.bread__loading { font-size: 15px; color: var(--atlas-text-secondary); }
</style>
