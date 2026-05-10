<template>
  <div class="flex-1 mobile:h-[50vh] overflow-hidden flex flex-col">
    <!-- Apple-minimal flat header -->
    <div class="atlas-stream-header relative z-10">
      <div class="atlas-stream-header__title-row">
        <h2 class="atlas-stream-header__title">Event stream</h2>
        <span class="atlas-stream-header__hint mobile:hidden" v-if="displayedAgentIds.length > 0">
          tap an agent to open a swim lane
        </span>
      </div>

      <!-- Agent pill row -->
      <div v-if="displayedAgentIds.length > 0" class="atlas-pill-row">
        <button
          v-for="agentId in displayedAgentIds"
          :key="agentId"
          @click="emit('selectAgent', agentId)"
          class="atlas-pill"
          :class="{ 'is-inactive': !isAgentActive(agentId) }"
          :style="{
            '--pill-accent': getHexColorForApp(getAppNameFromAgentId(agentId))
          }"
          :title="`${isAgentActive(agentId) ? 'Active' : 'Idle'} — ${agentId}`"
        >
          <span class="atlas-pill__dot"></span>
          <span class="atlas-pill__label">{{ agentId }}</span>
        </button>
      </div>

      <!-- Search Bar -->
      <div class="atlas-search">
        <div class="atlas-search__wrap">
          <svg class="atlas-search__icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="4.5"/><path d="m12 12-2.5-2.5"/></svg>
          <input
            type="text"
            :value="searchPattern"
            @input="updateSearchPattern(($event.target as HTMLInputElement).value)"
            placeholder="Search events — regex supported (e.g. ^GET)"
            class="atlas-search__input"
            :class="{ 'is-error': searchError }"
            aria-label="Search events with regex pattern"
          />
          <button
            v-if="searchPattern"
            @click="clearSearch"
            class="atlas-search__clear"
            title="Clear search"
            aria-label="Clear search"
          >✕</button>
        </div>
        <div v-if="searchError" class="atlas-search__error" role="alert">{{ searchError }}</div>
      </div>
    </div>
    
    <!-- Scrollable Event List -->
    <div 
      ref="scrollContainer"
      class="flex-1 overflow-y-auto px-3 py-3 mobile:px-2 mobile:py-1.5 relative"
      @scroll="handleScroll"
    >
      <TransitionGroup
        name="event"
        tag="div"
        class="space-y-2 mobile:space-y-1.5"
      >
        <EventRow
          v-for="event in filteredEvents"
          :key="`${event.id}-${event.timestamp}`"
          :event="event"
          :gradient-class="getGradientForSession(event.session_id)"
          :color-class="getColorForSession(event.session_id)"
          :app-gradient-class="getGradientForApp(event.source_app)"
          :app-color-class="getColorForApp(event.source_app)"
          :app-hex-color="getHexColorForApp(event.source_app)"
        />
      </TransitionGroup>
      
      <div v-if="filteredEvents.length === 0" class="atlas-empty-state">
        <p class="atlas-empty-state__title">No events</p>
        <p class="atlas-empty-state__sub">Events stream in here as agents fire hooks.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import type { HookEvent } from '../types';
import EventRow from './EventRow.vue';
import { useEventColors } from '../composables/useEventColors';
import { useEventSearch } from '../composables/useEventSearch';

const props = defineProps<{
  events: HookEvent[];
  filters: {
    sourceApp: string;
    sessionId: string;
    eventType: string;
  };
  stickToBottom: boolean;
  uniqueAppNames?: string[]; // Agent IDs (app:session) active in current time window
  allAppNames?: string[]; // All agent IDs (app:session) ever seen in session
}>();

const emit = defineEmits<{
  'update:stickToBottom': [value: boolean];
  selectAgent: [agentName: string];
}>();

const scrollContainer = ref<HTMLElement>();
const { getGradientForSession, getColorForSession, getGradientForApp, getColorForApp, getHexColorForApp } = useEventColors();
const { searchPattern, searchError, searchEvents, updateSearchPattern, clearSearch } = useEventSearch();

// Use all agent IDs, preferring allAppNames if available (all ever seen), fallback to uniqueAppNames (active in time window)
const displayedAgentIds = computed(() => {
  return props.allAppNames?.length ? props.allAppNames : (props.uniqueAppNames || []);
});

// Extract app name from agent ID (format: "app:session")
const getAppNameFromAgentId = (agentId: string): string => {
  return agentId.split(':')[0];
};

// Check if an agent is currently active (has events in the current time window)
const isAgentActive = (agentId: string): boolean => {
  return (props.uniqueAppNames || []).includes(agentId);
};

const filteredEvents = computed(() => {
  let filtered = props.events.filter(event => {
    if (props.filters.sourceApp && event.source_app !== props.filters.sourceApp) {
      return false;
    }
    if (props.filters.sessionId && event.session_id !== props.filters.sessionId) {
      return false;
    }
    if (props.filters.eventType && event.hook_event_type !== props.filters.eventType) {
      return false;
    }
    return true;
  });

  // Apply regex search filter
  if (searchPattern.value) {
    filtered = searchEvents(filtered, searchPattern.value);
  }

  return filtered;
});

const scrollToBottom = () => {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
  }
};

const handleScroll = () => {
  if (!scrollContainer.value) return;
  
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;
  const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
  
  if (isAtBottom !== props.stickToBottom) {
    emit('update:stickToBottom', isAtBottom);
  }
};

watch(() => props.events.length, async () => {
  if (props.stickToBottom) {
    await nextTick();
    scrollToBottom();
  }
});

watch(() => props.stickToBottom, (shouldStick) => {
  if (shouldStick) {
    scrollToBottom();
  }
});
</script>

<style scoped>
.event-enter-active,
.event-leave-active { transition: all 0.22s ease; }
.event-enter-from { opacity: 0; transform: translateY(-8px); }
.event-leave-to { opacity: 0; transform: translateY(8px); }

.atlas-stream-header {
  background: var(--theme-bg-primary);
  border-bottom: 1px solid var(--theme-border-primary);
  padding: 14px 20px 12px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}
@media (max-width: 699px) {
  .atlas-stream-header { padding: 10px 12px 8px; }
}

.atlas-stream-header__title-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.atlas-stream-header__title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-text-primary);
  letter-spacing: -0.005em;
}
.atlas-stream-header__hint {
  font-size: 11px;
  color: var(--theme-text-tertiary);
  letter-spacing: 0.01em;
}

.atlas-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.atlas-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 8px;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-weight: 500;
  color: var(--theme-text-primary);
  background: var(--theme-bg-secondary);
  border: 1px solid var(--theme-border-primary);
  border-radius: 999px;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.atlas-pill:hover {
  background: var(--theme-bg-tertiary);
  border-color: var(--theme-border-secondary);
}
.atlas-pill.is-inactive {
  color: var(--theme-text-tertiary);
  opacity: 0.6;
}
.atlas-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pill-accent, var(--theme-text-tertiary));
  flex: none;
}
.atlas-pill.is-inactive .atlas-pill__dot { opacity: 0.5; }
.atlas-pill__label { white-space: nowrap; }

.atlas-search { margin-top: 10px; }
.atlas-search__wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.atlas-search__icon {
  position: absolute;
  left: 10px;
  color: var(--theme-text-tertiary);
  pointer-events: none;
}
.atlas-search__input {
  width: 100%;
  padding: 7px 28px 7px 30px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  color: var(--theme-text-primary);
  background: var(--theme-bg-secondary);
  border: 1px solid var(--theme-border-primary);
  border-radius: 8px;
  outline: none;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}
.atlas-search__input::placeholder { color: var(--theme-text-tertiary); }
.atlas-search__input:focus {
  background: var(--theme-bg-primary);
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 3px var(--theme-primary-light);
}
.atlas-search__input.is-error { border-color: var(--theme-accent-error); }
.atlas-search__clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--theme-text-tertiary);
  cursor: pointer;
  font-size: 11px;
  border-radius: 4px;
}
.atlas-search__clear:hover { color: var(--theme-text-primary); background: var(--theme-hover-bg); }
.atlas-search__error {
  margin-top: 6px;
  font-size: 11px;
  color: var(--theme-accent-error);
}

.atlas-empty-state {
  padding: 48px 20px;
  text-align: center;
}
.atlas-empty-state__title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary);
}
.atlas-empty-state__sub {
  margin: 0;
  font-size: 12px;
  color: var(--theme-text-tertiary);
}
</style>