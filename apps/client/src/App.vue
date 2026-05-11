<template>
  <div class="atlas-page" v-show="!readingBrief && !talkFullscreen">
    <WordmarkRow />
    <div class="atlas-page__divider"></div>
    <StatusRow />
    <div class="atlas-page__divider"></div>

    <main class="atlas-page__grid">
      <section class="atlas-page__left">
        <div id="stats" class="atlas-page__stats-row">
          <TokenSpendCard />
          <ServicesCard id="services" />
        </div>
        <WhatAtlasDidCard :events="events" />
        <TalkCard :compact="isCompact" @open-fullscreen="talkFullscreen = true" />
        <LiveActivityCard :events="events" @view-all="liveAllOpen = true" />
      </section>

      <section id="brief" class="atlas-page__right">
        <TodaysBriefCard :compact="isCompact" @open-full="onOpenFull" />
      </section>
    </main>

    <p v-if="error" class="atlas-page__error">{{ error }}</p>
  </div>

  <BriefReadingView
    v-if="readingBrief"
    :brief="readingBrief"
    @close="readingBrief = null"
  />

  <TalkFullscreen
    v-if="talkFullscreen"
    @close="talkFullscreen = false"
  />

  <LiveActivityModal
    v-if="liveAllOpen"
    :events="events"
    @close="liveAllOpen = false"
  />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useWebSocket } from './composables/useWebSocket';
import { useTheme } from './composables/useTheme';
import WordmarkRow from './components/dashboard/WordmarkRow.vue';
import StatusRow from './components/dashboard/StatusRow.vue';
import TokenSpendCard from './components/dashboard/cards/TokenSpendCard.vue';
import ServicesCard from './components/dashboard/cards/ServicesCard.vue';
import WhatAtlasDidCard from './components/dashboard/cards/WhatAtlasDidCard.vue';
import TalkCard from './components/dashboard/cards/TalkCard.vue';
import LiveActivityCard from './components/dashboard/cards/LiveActivityCard.vue';
import TodaysBriefCard from './components/dashboard/cards/TodaysBriefCard.vue';
import BriefReadingView from './views/BriefReadingView.vue';
import TalkFullscreen from './views/TalkFullscreen.vue';
import LiveActivityModal from './components/dashboard/LiveActivityModal.vue';
import { WS_URL } from './config';

const { events, error } = useWebSocket(WS_URL);
useTheme();

const isCompact = ref(false);
function recomputeCompact() {
  isCompact.value = window.matchMedia('(max-width: 1023px)').matches;
}
onMounted(() => {
  recomputeCompact();
  window.addEventListener('resize', recomputeCompact);
});
onUnmounted(() => window.removeEventListener('resize', recomputeCompact));

const readingBrief = ref<any>(null);
const talkFullscreen = ref(false);
const liveAllOpen = ref(false);

function onOpenFull(brief: any) {
  readingBrief.value = brief;
}
</script>

<style scoped>
.atlas-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--atlas-page-bg);
  color: var(--atlas-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  overflow: hidden;
}
@media (max-width: 1023px) {
  .atlas-page { height: auto; min-height: 100vh; overflow: visible; }
}

.atlas-page__divider {
  height: 1px;
  background: var(--atlas-hairline);
  margin: 0 48px;
  flex: none;
}
@media (max-width: 1023px) {
  .atlas-page__divider { margin: 0 24px; }
}

.atlas-page__grid {
  display: grid;
  grid-template-columns: minmax(0, 40fr) minmax(0, 60fr);
  gap: 32px;
  padding: 32px 48px 48px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
@media (max-width: 1023px) {
  .atlas-page__grid {
    grid-template-columns: 1fr;
    padding: 24px 24px 48px;
    gap: 16px;
    overflow: visible;
    flex: none;
  }
}

.atlas-page__left {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}
@media (max-width: 1023px) {
  .atlas-page__left { overflow-y: visible; padding-right: 0; }
}

.atlas-page__right {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.atlas-page__stats-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

@media (max-width: 1023px) {
  .atlas-page__right { order: -1; }
}

.atlas-page__error {
  position: fixed;
  bottom: 16px;
  left: 16px;
  z-index: 60;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--atlas-red);
  background: var(--atlas-card-bg);
  border: 1px solid rgba(255, 59, 48, 0.40);
  border-radius: 8px;
}
</style>
