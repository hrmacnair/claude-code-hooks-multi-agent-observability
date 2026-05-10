<template>
  <div class="activity-view">
    <!-- Filters -->
    <FilterPanel
      v-if="showFilters"
      :filters="filters"
      @update:filters="filters = $event"
    />

    <!-- Toolbar: filters toggle + clear -->
    <div class="activity-toolbar">
      <button class="atb-pill" :class="{ 'is-on': showFilters }" @click="showFilters = !showFilters">
        Filters
      </button>
      <button class="atb-pill" @click="handleClearClick">Clear</button>
      <span class="activity-toolbar__spacer"></span>
      <span class="activity-toolbar__count">{{ events.length }} events</span>
    </div>

    <!-- Live Pulse Chart -->
    <LivePulseChart
      :events="events"
      :filters="filters"
      @update-unique-apps="uniqueAppNames = $event"
      @update-all-apps="allAppNames = $event"
      @update-time-range="currentTimeRange = $event"
    />

    <!-- Swim lanes -->
    <div v-if="selectedAgentLanes.length > 0" class="swim-lanes">
      <AgentSwimLaneContainer
        :selected-agents="selectedAgentLanes"
        :events="events"
        :time-range="currentTimeRange"
        @update:selected-agents="selectedAgentLanes = $event"
      />
    </div>

    <!-- Timeline -->
    <div class="activity-timeline">
      <EventTimeline
        :events="events"
        :filters="filters"
        :unique-app-names="uniqueAppNames"
        :all-app-names="allAppNames"
        v-model:stick-to-bottom="stickToBottom"
        @select-agent="toggleAgentLane"
      />
    </div>

    <StickScrollButton
      class="short:hidden"
      :stick-to-bottom="stickToBottom"
      @toggle="stickToBottom = !stickToBottom"
    />

    <ToastNotification
      v-for="(toast, index) in toasts"
      :key="toast.id"
      :index="index"
      :agent-name="toast.agentName"
      :agent-color="toast.agentColor"
      @dismiss="dismissToast(toast.id)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { HookEvent, TimeRange } from '../types';
import { useEventColors } from '../composables/useEventColors';
import FilterPanel from '../components/FilterPanel.vue';
import LivePulseChart from '../components/LivePulseChart.vue';
import AgentSwimLaneContainer from '../components/AgentSwimLaneContainer.vue';
import EventTimeline from '../components/EventTimeline.vue';
import StickScrollButton from '../components/StickScrollButton.vue';
import ToastNotification from '../components/ToastNotification.vue';

const props = defineProps<{ events: HookEvent[] }>();
const emit = defineEmits<{ (e: 'clear-events'): void }>();

const { getHexColorForApp } = useEventColors();

const filters = ref({ sourceApp: '', sessionId: '', eventType: '' });
const showFilters = ref(false);
const stickToBottom = ref(true);
const uniqueAppNames = ref<string[]>([]);
const allAppNames = ref<string[]>([]);
const selectedAgentLanes = ref<string[]>([]);
const currentTimeRange = ref<TimeRange>('1m');

interface Toast { id: number; agentName: string; agentColor: string; }
const toasts = ref<Toast[]>([]);
let toastIdCounter = 0;
const seenAgents = new Set<string>();

watch(uniqueAppNames, (newAppNames) => {
  newAppNames.forEach(appName => {
    if (!seenAgents.has(appName)) {
      seenAgents.add(appName);
      toasts.value.push({
        id: toastIdCounter++,
        agentName: appName,
        agentColor: getHexColorForApp(appName),
      });
    }
  });
}, { deep: true });

const dismissToast = (id: number) => {
  const i = toasts.value.findIndex(t => t.id === id);
  if (i !== -1) toasts.value.splice(i, 1);
};

const toggleAgentLane = (agentName: string) => {
  const i = selectedAgentLanes.value.indexOf(agentName);
  if (i >= 0) selectedAgentLanes.value.splice(i, 1);
  else selectedAgentLanes.value.push(agentName);
};

const handleClearClick = () => {
  emit('clear-events');
  selectedAgentLanes.value = [];
};

// Keep prop reactive
void props;
</script>

<style scoped>
.activity-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--theme-bg-secondary);
}

.activity-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: var(--theme-bg-primary);
  border-bottom: 1px solid var(--theme-border-primary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
@media (max-width: 699px) {
  .activity-toolbar { padding: 8px 12px; }
}

.atb-pill {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: var(--theme-text-secondary);
  background: var(--theme-bg-secondary);
  border: 1px solid var(--theme-border-primary);
  border-radius: 999px;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.atb-pill:hover { background: var(--theme-bg-tertiary); color: var(--theme-text-primary); }
.atb-pill.is-on {
  background: var(--theme-primary-light);
  color: var(--theme-primary);
  border-color: rgba(10, 132, 255, 0.35);
}

.activity-toolbar__spacer { flex: 1 1 auto; }
.activity-toolbar__count {
  font-size: 11px;
  color: var(--theme-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.swim-lanes {
  background: var(--theme-bg-secondary);
  border-bottom: 1px solid var(--theme-border-primary);
  padding: 10px 20px;
}
@media (max-width: 699px) {
  .swim-lanes { padding: 8px 12px; }
}

.activity-timeline {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
