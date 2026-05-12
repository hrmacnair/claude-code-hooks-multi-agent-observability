<template>
  <header class="wordmark-row">
    <span class="wordmark-row__brand">atlas</span>
    <div class="wordmark-row__actions">
      <button
        type="button"
        class="wordmark-row__nav"
        @click="$emit('open-workspace')"
        title="Workspace — kanban + parallel agents"
      >Workspace</button>
      <ThemeToggle class="wordmark-row__toggle" />
    </div>
  </header>
</template>

<script setup lang="ts">
import ThemeToggle from './ThemeToggle.vue';
defineEmits<{ (e: 'open-workspace'): void }>();
</script>

<style scoped>
.wordmark-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 48px 48px 32px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
@media (max-width: 1023px) {
  .wordmark-row { padding: 32px 24px 24px; }
}

.wordmark-row__brand {
  font-size: 36px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--atlas-text-strong);
  line-height: 1;
}

.wordmark-row__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.wordmark-row__nav {
  background: transparent;
  border: 1px solid var(--atlas-hairline);
  color: var(--atlas-text-primary);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  padding: 7px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 100ms ease, border-color 100ms ease;
}
.wordmark-row__nav:hover {
  background: var(--atlas-card-bg);
  border-color: var(--atlas-text-secondary);
}
</style>
