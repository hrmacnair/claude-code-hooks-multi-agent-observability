<template>
  <div class="atlas-shell">
    <AtlasTopBar class="atlas-shell__topbar" />

    <nav class="atlas-shell__nav" aria-label="Atlas sections">
      <a href="#today">Today</a>
      <a href="#activity">Activity</a>
      <a href="#briefs">Briefs</a>
      <a href="#talk">Talk</a>
    </nav>

    <section id="today" class="atlas-shell__today">
      <TodayPanel :events="events" />
    </section>

    <section id="activity" class="atlas-shell__activity">
      <ActivityPanel :events="events" @clear-events="clearEvents" />
    </section>

    <section id="briefs" class="atlas-shell__briefs">
      <BriefsPanel @open-brief="openBrief" />
    </section>

    <section id="talk" class="atlas-shell__talk">
      <TalkDock />
    </section>

    <BriefViewerModal
      v-if="openBriefData"
      :brief="openBriefData"
      @close="openBriefData = null"
    />

    <div v-if="error" class="atlas-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useWebSocket } from './composables/useWebSocket';
import { useThemes } from './composables/useThemes';
import AtlasTopBar from './components/AtlasTopBar.vue';
import TodayPanel from './views/TodayView.vue';
import ActivityPanel from './views/ActivityView.vue';
import BriefsPanel from './views/BriefsView.vue';
import TalkDock from './views/TalkView.vue';
import BriefViewerModal from './components/BriefViewerModal.vue';
import { WS_URL } from './config';

const { events, error, clearEvents } = useWebSocket(WS_URL);
useThemes();

const openBriefData = ref<any>(null);
const openBrief = (brief: any) => { openBriefData.value = brief; };
</script>

<style scoped>
.atlas-shell {
  display: grid;
  grid-template-rows: 48px 32px minmax(0, 1fr) auto;
  grid-template-columns: 340px minmax(0, 1fr) 320px;
  grid-template-areas:
    "top    top      top"
    "nav    nav      nav"
    "today  activity briefs"
    "talk   talk     talk";
  height: 100vh;
  background: var(--theme-bg-secondary);
  color: var(--theme-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.atlas-shell__topbar { grid-area: top; }
.atlas-shell__nav    { grid-area: nav; }
.atlas-shell__today  { grid-area: today; overflow: hidden; border-right: 1px solid var(--theme-border-primary); background: var(--theme-bg-secondary); }
.atlas-shell__activity { grid-area: activity; overflow: hidden; background: var(--theme-bg-secondary); }
.atlas-shell__briefs { grid-area: briefs; overflow: hidden; border-left: 1px solid var(--theme-border-primary); background: var(--theme-bg-primary); }
.atlas-shell__talk   { grid-area: talk; }

/* Section nav (jump anchors, not tabs) */
.atlas-shell__nav {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  background: var(--theme-bg-primary);
  border-bottom: 1px solid var(--theme-border-primary);
  overflow-x: auto;
}
.atlas-shell__nav a {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--theme-text-tertiary);
  text-decoration: none;
  border-radius: 999px;
  transition: color 0.12s ease, background-color 0.12s ease;
}
.atlas-shell__nav a:hover { color: var(--theme-text-primary); background: var(--theme-hover-bg); }
@media (min-width: 700px) {
  .atlas-shell__nav { display: none; }
  .atlas-shell {
    grid-template-rows: 48px minmax(0, 1fr) auto;
    grid-template-areas:
      "top    top      top"
      "today  activity briefs"
      "talk   talk     talk";
  }
}

/* Mobile: single column, panels stack, nav becomes anchors */
@media (max-width: 699px) {
  .atlas-shell {
    height: auto;
    min-height: 100vh;
    grid-template-rows: 48px 32px auto auto auto auto;
    grid-template-columns: 1fr;
    grid-template-areas:
      "top"
      "nav"
      "today"
      "activity"
      "briefs"
      "talk";
  }
  .atlas-shell__nav { position: sticky; top: 48px; z-index: 30; }
  .atlas-shell__today, .atlas-shell__activity, .atlas-shell__briefs {
    overflow: visible;
    border-right: none;
    border-left: none;
    border-bottom: 1px solid var(--theme-border-primary);
  }
}

.atlas-error {
  position: fixed;
  bottom: 70px;
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
