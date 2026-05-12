<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <header class="modal__bar">
        <h2 class="modal__title">Spend · last {{ spend.window_days }} days</h2>
        <button class="modal__close" @click="$emit('close')">×</button>
      </header>
      <div class="modal__body">
        <div class="modal__hero">
          <div class="hero__cell">
            <span class="hero__label">Today</span>
            <span class="hero__value">${{ todayDollars }}</span>
            <span class="hero__sub">{{ todayCalls }} calls</span>
          </div>
          <div class="hero__cell">
            <span class="hero__label">Month</span>
            <span class="hero__value">${{ monthDollars }}</span>
            <span class="hero__sub">{{ monthCalls }} calls</span>
          </div>
        </div>

        <h3 class="modal__h3">Daily activity (audit-event calls)</h3>
        <div class="spark">
          <div
            v-for="d in spend.sparkline"
            :key="d.date"
            class="spark__bar"
            :style="{ height: barHeight(d.calls) + '%' }"
            :title="`${d.date}: ${d.calls} events`"
          />
        </div>
        <div class="spark__labels">
          <span>{{ spend.sparkline[0]?.date }}</span>
          <span>{{ spend.sparkline[spend.sparkline.length - 1]?.date }}</span>
        </div>

        <h3 class="modal__h3">By action kind</h3>
        <ul class="kind-list">
          <li v-for="[kind, count] in sortedKinds" :key="kind">
            <span class="kind__name">{{ kind }}</span>
            <span class="kind__bar"><span :style="{ width: kindBarPct(count) + '%' }"></span></span>
            <span class="kind__count">{{ count }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAtlasSpendDetail } from '../../composables/useAtlasViews';
import { useAtlasStats } from '../../composables/useAtlasStats';

defineEmits<{ (e: 'close'): void }>();

const { spend: spendRef } = useAtlasSpendDetail();
const spend = computed(() => spendRef.value);

const { stats } = useAtlasStats();
const todayDollars = computed(() => stats.value?.codeburn.today?.dollars?.toFixed(2) ?? '—');
const todayCalls   = computed(() => stats.value?.codeburn.today?.calls ?? 0);
const monthDollars = computed(() => stats.value?.codeburn.month?.dollars?.toFixed(2) ?? '—');
const monthCalls   = computed(() => stats.value?.codeburn.month?.calls ?? 0);

const maxBar = computed(() => Math.max(1, ...(spend.value.sparkline || []).map(d => d.calls)));
function barHeight(n: number) { return Math.max(2, (n / maxBar.value) * 100); }

const sortedKinds = computed(() => Object.entries(spend.value.by_action_kind).sort((a, b) => b[1] - a[1]));
const maxKind = computed(() => Math.max(1, ...Object.values(spend.value.by_action_kind)));
function kindBarPct(n: number) { return (n / maxKind.value) * 100; }
</script>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; z-index: 90; padding: 16px;
}
.modal {
  background: var(--atlas-page-bg);
  color: var(--atlas-text-primary);
  border-radius: 16px;
  width: min(720px, 100%);
  max-height: 85vh;
  display: flex; flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
}
.modal__bar { display: flex; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--atlas-hairline); }
.modal__title { margin: 0; font-size: 18px; font-weight: 600; }
.modal__close { margin-left: auto; background: transparent; border: 0; font-size: 24px; line-height: 1; color: var(--atlas-text-secondary); cursor: pointer; padding: 0 6px; }
.modal__body { padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
.modal__h3 { margin: 8px 0 4px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--atlas-text-secondary); font-weight: 500; }

.modal__hero { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.hero__cell { display: flex; flex-direction: column; gap: 2px; padding: 16px; background: var(--atlas-card-bg); border-radius: 12px; }
.hero__label { font-size: 12px; color: var(--atlas-text-secondary); text-transform: uppercase; letter-spacing: 0.06em; }
.hero__value { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.hero__sub { font-size: 13px; color: var(--atlas-text-secondary); }

.spark { display: flex; align-items: flex-end; gap: 4px; height: 64px; padding: 0 4px; }
.spark__bar { flex: 1 1 auto; min-width: 4px; background: var(--atlas-blue); border-radius: 3px 3px 0 0; opacity: 0.85; }
.spark__labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--atlas-text-muted); margin-top: 4px; }

.kind-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.kind-list li { display: grid; grid-template-columns: 120px 1fr 40px; gap: 10px; align-items: center; font-size: 13px; }
.kind__name { font-family: ui-monospace, Menlo, monospace; }
.kind__bar { height: 6px; background: var(--atlas-card-bg); border-radius: 3px; overflow: hidden; }
.kind__bar span { display: block; height: 100%; background: var(--atlas-blue); opacity: 0.8; }
.kind__count { text-align: right; font-variant-numeric: tabular-nums; color: var(--atlas-text-secondary); }
</style>
