<template>
  <button class="div-tile" :class="`div-tile--${health}`" @click="$emit('open')">
    <div class="dt__head">
      <span class="dt__name">{{ name }}</span>
      <span class="dt__dot" :class="`dt__dot--${health}`"></span>
    </div>
    <div class="dt__metrics">
      <div class="dt__metric">
        <span class="dt__num">{{ events24h }}</span>
        <span class="dt__lbl">events 24h</span>
      </div>
      <div class="dt__metric">
        <span class="dt__num">{{ activeMissions }}</span>
        <span class="dt__lbl">missions</span>
      </div>
      <div class="dt__metric">
        <span class="dt__num">{{ lastActionAgo }}</span>
        <span class="dt__lbl">last action</span>
      </div>
    </div>
    <div v-if="lastSummary" class="dt__last">{{ lastSummary }}</div>
  </button>
</template>

<script setup lang="ts">
defineProps<{
  name: string;
  health: 'active' | 'idle';
  events24h: number;
  activeMissions: number;
  lastActionAgo: string;
  lastSummary?: string;
}>();
defineEmits<{ (e: 'open'): void }>();
</script>

<style scoped>
.div-tile {
  background: var(--atlas-card-bg);
  border: 1px solid var(--atlas-hairline);
  border-radius: 14px;
  padding: 14px 16px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
  cursor: pointer;
  min-width: 0;
  overflow: hidden;
  transition: transform 120ms ease, border-color 120ms ease;
}
.div-tile:hover { transform: translateY(-1px); border-color: var(--atlas-text-secondary); }

.dt__head { display: flex; align-items: center; gap: 8px; }
.dt__name { font-size: 14px; font-weight: 600; color: var(--atlas-text-strong); }
.dt__dot { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: var(--atlas-hairline); }
.dt__dot--active { background: var(--atlas-green); animation: dt-pulse 2s ease-in-out infinite; }
@keyframes dt-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(48,209,88,0.30); }
  50%      { box-shadow: 0 0 0 4px rgba(48,209,88,0); }
}

.dt__metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.dt__metric { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dt__num {
  font-size: 18px; font-weight: 600;
  color: var(--atlas-text-strong);
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
}
.dt__lbl {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--atlas-text-muted, var(--atlas-text-secondary));
}

.dt__last {
  font-size: 11.5px;
  color: var(--atlas-text-secondary);
  font-family: ui-monospace, Menlo, monospace;
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
