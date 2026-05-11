<template>
  <article class="card token-spend">
    <span class="card-eyebrow">Token spend</span>
    <div class="token-spend__hero" :title="`Month $${monthDollars} · ${monthCalls} calls`">
      ${{ todayDollars }}
    </div>
    <div class="token-spend__meta">
      <span class="hide-mobile">today · </span>{{ todayCalls }} calls
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAtlasStats } from '../../../composables/useAtlasStats';

const { stats } = useAtlasStats();

const todayDollars = computed(() => stats.value?.codeburn.today?.dollars?.toFixed(2) ?? '—');
const todayCalls = computed(() => stats.value?.codeburn.today?.calls ?? 0);
const monthDollars = computed(() => stats.value?.codeburn.month?.dollars?.toFixed(2) ?? '—');
const monthCalls = computed(() => stats.value?.codeburn.month?.calls ?? 0);
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

.token-spend__hero {
  margin-top: 16px;
  font-size: 56px;
  font-weight: 600;
  letter-spacing: -0.03em;
  color: var(--atlas-text-strong);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
@media (max-width: 1023px) {
  .token-spend__hero { font-size: 40px; }
}
@media (max-width: 480px) {
  .token-spend__hero { font-size: 32px; }
  .hide-mobile { display: none; }
}

.token-spend__meta {
  margin-top: 8px;
  font-size: 15px;
  font-weight: 400;
  color: var(--atlas-text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
