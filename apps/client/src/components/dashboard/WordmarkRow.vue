<template>
  <header class="wordmark-row">
    <span class="wordmark-row__brand">atlas</span>
    <ThemeToggle class="wordmark-row__toggle" />
  </header>
</template>

<script setup lang="ts">
import ThemeToggle from './ThemeToggle.vue';
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
</style>
