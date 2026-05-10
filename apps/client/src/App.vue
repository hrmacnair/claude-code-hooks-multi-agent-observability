<template>
  <div class="h-screen flex flex-col bg-[var(--theme-bg-secondary)]">
    <!-- Apple-minimal flat header -->
    <header class="atlas-header short:hidden">
      <div class="atlas-header__inner">
        <h1 class="atlas-header__title mobile:hidden">Observability</h1>

        <div class="atlas-header__status" :title="isConnected ? 'Connected' : 'Disconnected'">
          <span class="atlas-status-dot" :class="isConnected ? 'is-online' : 'is-offline'"></span>
          <span class="atlas-header__status-label mobile:hidden">{{ isConnected ? 'Live' : 'Offline' }}</span>
        </div>

        <div class="atlas-header__actions">
          <span class="atlas-counter">{{ events.length }}</span>

          <button class="atlas-iconbtn" @click="handleClearClick" title="Clear events" aria-label="Clear events">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.5 9.5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 4M6.5 6.5v6M9.5 6.5v6"/></svg>
          </button>

          <button class="atlas-iconbtn" @click="showFilters = !showFilters" :title="showFilters ? 'Hide filters' : 'Show filters'" :aria-pressed="showFilters">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M4 8h8M6 12h4"/></svg>
          </button>

          <button class="atlas-iconbtn" @click="handleThemeManagerClick" title="Theme" aria-label="Theme">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 2v12M2 8h12"/></svg>
          </button>
        </div>
      </div>
    </header>
    
    <!-- Filters -->
    <FilterPanel
      v-if="showFilters"
      class="short:hidden"
      :filters="filters"
      @update:filters="filters = $event"
    />
    
    <!-- Live Pulse Chart -->
    <LivePulseChart
      :events="events"
      :filters="filters"
      @update-unique-apps="uniqueAppNames = $event"
      @update-all-apps="allAppNames = $event"
      @update-time-range="currentTimeRange = $event"
    />

    <!-- Agent Swim Lane Container (below pulse chart, full width, hidden when empty) -->
    <div v-if="selectedAgentLanes.length > 0" class="w-full bg-[var(--theme-bg-secondary)] px-3 py-3 mobile:px-2 mobile:py-2 overflow-hidden border-t border-[var(--theme-border-primary)]">
      <AgentSwimLaneContainer
        :selected-agents="selectedAgentLanes"
        :events="events"
        :time-range="currentTimeRange"
        @update:selected-agents="selectedAgentLanes = $event"
      />
    </div>
    
    <!-- Timeline -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <EventTimeline
        :events="events"
        :filters="filters"
        :unique-app-names="uniqueAppNames"
        :all-app-names="allAppNames"
        v-model:stick-to-bottom="stickToBottom"
        @select-agent="toggleAgentLane"
      />
    </div>
    
    <!-- Stick to bottom button -->
    <StickScrollButton
      class="short:hidden"
      :stick-to-bottom="stickToBottom"
      @toggle="stickToBottom = !stickToBottom"
    />
    
    <!-- Error message -->
    <div
      v-if="error"
      class="fixed bottom-4 left-4 mobile:bottom-3 mobile:left-3 mobile:right-3 bg-red-100 border border-red-400 text-red-700 px-3 py-2 mobile:px-2 mobile:py-1.5 rounded mobile:text-xs"
    >
      {{ error }}
    </div>
    
    <!-- Theme Manager -->
    <ThemeManager
      :is-open="showThemeManager"
      @close="showThemeManager = false"
    />

    <!-- Toast Notifications -->
    <ToastNotification
      v-for="(toast, index) in toasts"
      :key="toast.id"
      :index="index"
      :agent-name="toast.agentName"
      :agent-color="toast.agentColor"
      @dismiss="dismissToast(toast.id)"
    />

    <!-- Atlas stats sidebar (Phase 9) -->
    <AtlasStatsPanel />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { TimeRange } from './types';
import { useWebSocket } from './composables/useWebSocket';
import { useThemes } from './composables/useThemes';
import { useEventColors } from './composables/useEventColors';
import EventTimeline from './components/EventTimeline.vue';
import FilterPanel from './components/FilterPanel.vue';
import StickScrollButton from './components/StickScrollButton.vue';
import LivePulseChart from './components/LivePulseChart.vue';
import ThemeManager from './components/ThemeManager.vue';
import ToastNotification from './components/ToastNotification.vue';
import AgentSwimLaneContainer from './components/AgentSwimLaneContainer.vue';
import AtlasStatsPanel from './components/AtlasStatsPanel.vue';
import { WS_URL } from './config';

// WebSocket connection
const { events, isConnected, error, clearEvents } = useWebSocket(WS_URL);

// Theme management (sets up theme system)
useThemes();

// Event colors
const { getHexColorForApp } = useEventColors();

// Filters
const filters = ref({
  sourceApp: '',
  sessionId: '',
  eventType: ''
});

// UI state
const stickToBottom = ref(true);
const showThemeManager = ref(false);
const showFilters = ref(false);
const uniqueAppNames = ref<string[]>([]); // Apps active in current time window
const allAppNames = ref<string[]>([]); // All apps ever seen in session
const selectedAgentLanes = ref<string[]>([]);
const currentTimeRange = ref<TimeRange>('1m'); // Current time range from LivePulseChart

// Toast notifications
interface Toast {
  id: number;
  agentName: string;
  agentColor: string;
}
const toasts = ref<Toast[]>([]);
let toastIdCounter = 0;
const seenAgents = new Set<string>();

// Watch for new agents and show toast
watch(uniqueAppNames, (newAppNames) => {
  // Find agents that are new (not in seenAgents set)
  newAppNames.forEach(appName => {
    if (!seenAgents.has(appName)) {
      seenAgents.add(appName);
      // Show toast for new agent
      const toast: Toast = {
        id: toastIdCounter++,
        agentName: appName,
        agentColor: getHexColorForApp(appName)
      };
      toasts.value.push(toast);
    }
  });
}, { deep: true });

const dismissToast = (id: number) => {
  const index = toasts.value.findIndex(t => t.id === id);
  if (index !== -1) {
    toasts.value.splice(index, 1);
  }
};

// Handle agent tag clicks for swim lanes
const toggleAgentLane = (agentName: string) => {
  const index = selectedAgentLanes.value.indexOf(agentName);
  if (index >= 0) {
    // Remove from comparison
    selectedAgentLanes.value.splice(index, 1);
  } else {
    // Add to comparison
    selectedAgentLanes.value.push(agentName);
  }
};

// Handle clear button click
const handleClearClick = () => {
  clearEvents();
  selectedAgentLanes.value = [];
};

// Debug handler for theme manager
const handleThemeManagerClick = () => {
  showThemeManager.value = true;
};
</script>

<style scoped>
.atlas-header {
  background: var(--theme-bg-primary);
  border-bottom: 1px solid var(--theme-border-primary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
.atlas-header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
}
@media (max-width: 699px) {
  .atlas-header__inner { padding: 8px 12px; gap: 8px; }
}

.atlas-header__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--theme-text-primary);
}

.atlas-header__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
  margin-left: 8px;
}
.atlas-header__status-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-tertiary);
  letter-spacing: 0.01em;
}
.atlas-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.atlas-status-dot.is-online {
  background: var(--theme-accent-success);
  box-shadow: 0 0 0 3px rgba(48, 209, 88, 0.18);
}
.atlas-status-dot.is-offline {
  background: var(--theme-accent-error);
  box-shadow: 0 0 0 3px rgba(255, 59, 48, 0.18);
}

.atlas-header__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.atlas-counter {
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--theme-text-secondary);
  background: var(--theme-bg-secondary);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--theme-border-primary);
  min-width: 28px;
  text-align: center;
}

.atlas-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--theme-text-secondary);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.atlas-iconbtn:hover {
  background: var(--theme-hover-bg);
  color: var(--theme-text-primary);
}
.atlas-iconbtn[aria-pressed="true"] {
  background: var(--theme-primary-light);
  color: var(--theme-primary);
}
@media (max-width: 699px) {
  .atlas-iconbtn { width: 32px; height: 32px; }
}
</style>