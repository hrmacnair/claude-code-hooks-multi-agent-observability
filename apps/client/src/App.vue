<template>
  <div class="atlas-shell">
    <AtlasTopBar />
    <AtlasTabBar v-model="activeTab" />

    <main class="atlas-main">
      <KeepAlive>
        <component
          :is="viewComponent"
          :events="events"
          @clear-events="clearEvents"
        />
      </KeepAlive>
    </main>

    <ThemeManager :is-open="false" @close="() => {}" />

    <div v-if="error" class="atlas-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWebSocket } from './composables/useWebSocket';
import { useThemes } from './composables/useThemes';
import AtlasTopBar from './components/AtlasTopBar.vue';
import AtlasTabBar from './components/AtlasTabBar.vue';
import ThemeManager from './components/ThemeManager.vue';
import TodayView from './views/TodayView.vue';
import ActivityView from './views/ActivityView.vue';
import BriefsView from './views/BriefsView.vue';
import TalkView from './views/TalkView.vue';
import { WS_URL } from './config';

// WebSocket — kept here so events stay live across tab switches
const { events, error, clearEvents } = useWebSocket(WS_URL);

// Theme system (defaults to dark-only per useThemes init)
useThemes();

const TAB_STORAGE = 'atlas.activeTab';
const validTabs = ['today', 'activity', 'briefs', 'talk'] as const;
type Tab = typeof validTabs[number];

const initialTab: Tab = (() => {
  // ?tab=foo wins, then localStorage, then default
  try {
    const qs = new URLSearchParams(window.location.search).get('tab');
    if (qs && validTabs.includes(qs as Tab)) return qs as Tab;
  } catch {/* ignore */}
  const saved = localStorage.getItem(TAB_STORAGE);
  return validTabs.includes(saved as Tab) ? (saved as Tab) : 'today';
})();

const activeTab = ref<Tab>(initialTab);

watch(activeTab, (v) => {
  try { localStorage.setItem(TAB_STORAGE, v); } catch {/* ignore */}
});

const viewComponent = computed(() => {
  switch (activeTab.value) {
    case 'today':    return TodayView;
    case 'activity': return ActivityView;
    case 'briefs':   return BriefsView;
    case 'talk':     return TalkView;
    default:         return TodayView;
  }
});
</script>

<style scoped>
.atlas-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--theme-bg-secondary);
  color: var(--theme-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.atlas-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.atlas-error {
  position: fixed;
  bottom: 14px;
  left: 14px;
  z-index: 60;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--theme-accent-error);
  background: var(--theme-bg-primary);
  border: 1px solid rgba(255, 69, 58, 0.40);
  border-radius: 8px;
}
</style>
