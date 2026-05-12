<template>
  <component
    :is="clickable ? 'button' : 'div'"
    class="tile"
    :class="[`tile--${tone || 'neutral'}`, { 'tile--clickable': clickable }]"
    :title="hint || ''"
    @click="$emit('click')"
  >
    <div class="tile__head">
      <span class="tile__eyebrow">{{ label }}</span>
      <span v-if="trend" class="tile__trend" :class="`tile__trend--${trend}`">{{ trendLabel }}</span>
      <span v-else-if="dot" class="tile__dot" :class="`tile__dot--${dot}`"></span>
    </div>
    <div class="tile__value">{{ value }}</div>
    <div v-if="sub" class="tile__sub">{{ sub }}</div>
  </component>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
  trend?: 'up' | 'down' | 'flat' | null;
  dot?: 'green' | 'yellow' | 'red' | 'gray' | null;
  hint?: string;
  clickable?: boolean;
}>(), { tone: 'neutral', clickable: false });
defineEmits<{ (e: 'click'): void }>();

const trendLabel: any = {
  up: '↑', down: '↓', flat: '≈',
};
</script>

<style scoped>
.tile {
  background: var(--atlas-card-bg);
  border: 1px solid transparent;
  border-radius: 14px;
  padding: 16px 18px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  min-width: 0;
  overflow: hidden;
  transition: transform 120ms ease, border-color 120ms ease;
}
.tile--clickable { cursor: pointer; }
.tile--clickable:hover { transform: translateY(-1px); border-color: var(--atlas-hairline); }

/* Subtle left rail for tone */
.tile--good { box-shadow: inset 3px 0 0 var(--atlas-green); }
.tile--warn { box-shadow: inset 3px 0 0 var(--atlas-yellow); }
.tile--bad  { box-shadow: inset 3px 0 0 var(--atlas-red); }
.tile--info { box-shadow: inset 3px 0 0 var(--atlas-blue); }

.tile__head { display: flex; align-items: center; gap: 6px; min-height: 14px; }
.tile__eyebrow {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--atlas-text-secondary);
}
.tile__trend {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--atlas-text-muted, var(--atlas-text-secondary));
}
.tile__trend--up   { color: var(--atlas-red); }
.tile__trend--down { color: var(--atlas-green); }
.tile__dot { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: var(--atlas-text-muted); }
.tile__dot--green  { background: var(--atlas-green); }
.tile__dot--yellow { background: var(--atlas-yellow); }
.tile__dot--red    { background: var(--atlas-red); }

.tile__value {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--atlas-text-strong);
  font-variant-numeric: tabular-nums;
  line-height: 1.05;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile__sub {
  font-size: 12px;
  color: var(--atlas-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1023px) {
  .tile { padding: 14px 14px; border-radius: 12px; }
  .tile__value { font-size: 24px; }
}
@media (max-width: 480px) {
  .tile__value { font-size: 22px; }
}
</style>
