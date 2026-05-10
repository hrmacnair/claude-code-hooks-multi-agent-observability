<template>
  <div class="atlas-page" v-show="!readingBrief">
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
        <TalkCard />
        <LiveActivityCard :events="events" />
      </section>

      <section id="brief" class="atlas-page__right">
        <TodaysBriefCard
          :compact="isCompact"
          @open-full="onOpenFull"
          @open-prior="onOpenPrior"
        />
      </section>
    </main>

    <p v-if="error" class="atlas-page__error">{{ error }}</p>
  </div>

  <BriefReadingView
    v-if="readingBrief"
    :brief="readingBrief"
    @close="readingBrief = null"
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
import { API_BASE_URL, WS_URL } from './config';

const { events, error } = useWebSocket(WS_URL);
useTheme();

// Responsive: compact brief preview on phone-ish widths
const isCompact = ref(false);
function recomputeCompact() {
  isCompact.value = window.matchMedia('(max-width: 1023px)').matches;
}
onMounted(() => {
  recomputeCompact();
  window.addEventListener('resize', recomputeCompact);
});
onUnmounted(() => window.removeEventListener('resize', recomputeCompact));

// Brief reading view (push-nav on mobile)
const readingBrief = ref<any>(null);

async function onOpenFull(brief: any) {
  readingBrief.value = brief;
}

async function onOpenPrior(b: { date: string; slug: string; title: string }) {
  // load the prior brief body via /api/atlas/briefs file proxy
  try {
    const all = await fetch(`${API_BASE_URL}/api/atlas/briefs`).then(r => r.json());
    const match = (all?.briefs || []).find((x: any) => x.date === b.date && x.slug === b.slug);
    if (!match) return;
    const html = await fetch(`${API_BASE_URL}/api/atlas/briefs/file?path=${encodeURIComponent(match.path)}`).then(r => r.text());
    const body = html.match(/<article[^>]*class="content"[^>]*>([\s\S]*?)<\/article>/i)?.[1] || html;
    readingBrief.value = { date: match.date, title: match.title, slug: match.slug, htmlBody: body };
  } catch (err) {
    console.error('[brief] open-prior failed', err);
  }
}
</script>

<style scoped>
.atlas-page {
  min-height: 100vh;
  background: var(--atlas-page-bg);
  color: var(--atlas-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.atlas-page__divider {
  height: 1px;
  background: var(--atlas-hairline);
  margin: 0 48px;
}
@media (max-width: 1023px) {
  .atlas-page__divider { margin: 0 24px; }
}

.atlas-page__grid {
  display: grid;
  grid-template-columns: 40fr 60fr;
  gap: 32px;
  padding: 32px 48px 64px;
}
@media (max-width: 1023px) {
  .atlas-page__grid {
    grid-template-columns: 1fr;
    padding: 24px 24px 64px;
    gap: 16px;
  }
}

.atlas-page__left {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.atlas-page__right {
  min-width: 0;
}

.atlas-page__stats-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* On mobile, brief comes BEFORE left column. Reorder. */
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
