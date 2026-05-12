<template>
  <div class="atlas-page" v-show="!readingBrief && !talkFullscreen && !workspaceOpen">
    <WordmarkRow @open-workspace="workspaceOpen = true" />
    <div class="atlas-page__divider"></div>
    <StatusRow />
    <div class="atlas-page__divider"></div>

    <!-- Two-column page: main work on the left, brief anchors the right. -->
    <main class="atlas-page__grid">
      <section class="atlas-page__main">
        <!-- KPI tile strip — 6 small cards across the top of the work column. -->
        <div class="atlas-page__tiles" id="tiles">
          <StatTile
            label="Spend"
            :value="`$${todayDollars}`"
            :sub="`${monthDollars} mo · ${spendProjection} proj`"
            :trend="spendTrend"
            :tone="budgetTone"
            clickable
            hint="Click for spend detail"
            @click="spendOpen = true"
          />
          <StatTile
            label="Services"
            :value="serviceCount"
            :sub="serviceSub"
            :dot="serviceDot"
            :tone="serviceTone"
          />
          <StatTile
            label="Drift"
            :value="driftValue"
            :sub="driftSub"
            :tone="driftTone"
            :dot="driftDot"
            clickable
            @click="runDriftScan"
          />
          <StatTile
            label="Missions"
            :value="missionCount"
            :sub="missionSub"
            :tone="missionCount > 0 ? 'info' : 'neutral'"
          />
          <StatTile
            label="Scout"
            :value="scoutCount"
            :sub="scoutSub"
            :tone="scoutCount > 0 ? 'good' : 'neutral'"
          />
          <StatTile
            label="GitHub"
            :value="ghCount"
            :sub="ghSub"
          />
        </div>

        <!-- Talk + Today side-by-side. -->
        <div class="atlas-page__row atlas-page__row--primary">
          <TalkCard :compact="isCompact" @open-fullscreen="talkFullscreen = true" />
          <TodayCard />
        </div>

        <!-- Per-division tiles — 3 across, health pulse + key metrics. -->
        <div class="atlas-page__tiles atlas-page__tiles--divisions">
          <DivisionTile
            v-for="d in divisionRows"
            :key="d.slug"
            :name="d.slug"
            :health="d.health"
            :events24h="d.events24h"
            :active-missions="d.activeMissions"
            :last-action-ago="d.lastActionAgo"
            :last-summary="d.lastSummary"
            @open="divisionDrawer = d.slug"
          />
        </div>

        <!-- Work card (tabs: Missions / Projects / Agents / Scout / Routing / GitHub) -->
        <WorkCard :events="events" @open-division="(slug) => divisionDrawer = slug" />

        <!-- Layer 5 proposals queue (Phase 11 surface). -->
        <ProposalsCard />

        <!-- Activity strip (collapsed) -->
        <LiveActivityCard :events="events" @view-all="liveAllOpen = true" @open-search="auditOpen = true" />
      </section>

      <!-- Right column — Brief anchors the editorial side of the page. -->
      <aside class="atlas-page__aside" id="brief">
        <TodaysBriefCard :compact="isCompact" @open-full="onOpenFull" />
      </aside>
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

  <WorkspaceView
    v-if="workspaceOpen"
    @close="workspaceOpen = false"
  />

  <LiveActivityModal
    v-if="liveAllOpen"
    :events="events"
    @close="liveAllOpen = false"
  />

  <SpendDetailModal v-if="spendOpen" @close="spendOpen = false" />
  <AuditSearchModal v-if="auditOpen" @close="auditOpen = false" />
  <DivisionDrawer v-if="divisionDrawer" :slug="divisionDrawer" @close="divisionDrawer = null" />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useWebSocket } from './composables/useWebSocket';
import { useTheme } from './composables/useTheme';
import { useAtlasStats } from './composables/useAtlasStats';
import { useAtlasSpendDetail, useAtlasDrift, useAtlasMissions, useAtlasScout, useGitHubFeed } from './composables/useAtlasViews';
import { API_BASE_URL } from './config';
import WordmarkRow from './components/dashboard/WordmarkRow.vue';
import StatusRow from './components/dashboard/StatusRow.vue';
import StatTile from './components/dashboard/StatTile.vue';
import DivisionTile from './components/dashboard/DivisionTile.vue';
import TalkCard from './components/dashboard/cards/TalkCard.vue';
import LiveActivityCard from './components/dashboard/cards/LiveActivityCard.vue';
import TodaysBriefCard from './components/dashboard/cards/TodaysBriefCard.vue';
import TodayCard from './components/dashboard/cards/TodayCard.vue';
import WorkCard from './components/dashboard/cards/WorkCard.vue';
import ProposalsCard from './components/dashboard/cards/ProposalsCard.vue';
import SpendDetailModal from './components/dashboard/SpendDetailModal.vue';
import DivisionDrawer from './components/dashboard/DivisionDrawer.vue';
import AuditSearchModal from './components/dashboard/AuditSearchModal.vue';
import { useNotifications } from './composables/useNotifications';
import BriefReadingView from './views/BriefReadingView.vue';
import TalkFullscreen from './views/TalkFullscreen.vue';
import WorkspaceView from './views/WorkspaceView.vue';
import LiveActivityModal from './components/dashboard/LiveActivityModal.vue';
import { WS_URL } from './config';

const { events, error } = useWebSocket(WS_URL);
useTheme();
useNotifications(events);

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
// `?workspace=1` URL param auto-opens the Workspace overlay — useful for
// headless screenshots and direct deep-links from external dashboards.
const workspaceOpen = ref(
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('workspace') === '1'
);
const liveAllOpen = ref(false);
const spendOpen = ref(false);
const auditOpen = ref(false);
const divisionDrawer = ref<string | null>(null);

function onOpenFull(brief: any) { readingBrief.value = brief; }

// ===== KPI tile data =====
const { stats } = useAtlasStats();
const { spend: spendDaily } = useAtlasSpendDetail();
const { drift } = useAtlasDrift();
const { missions } = useAtlasMissions();
const { scout } = useAtlasScout();
const { feed: ghFeed } = useGitHubFeed();

const todayDollars = computed(() => stats.value?.codeburn.today?.dollars?.toFixed(2) ?? '—');
const monthDollars = computed(() => '$' + (stats.value?.codeburn.month?.dollars?.toFixed(0) ?? '—'));
const spendProjection = computed(() => {
  const m = stats.value?.codeburn.month;
  if (!m || !m.dollars) return '—';
  const now = new Date();
  const daySoFar = now.getDate();
  const rate = m.dollars / Math.max(1, daySoFar);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return '$' + (rate * daysInMonth).toFixed(0);
});
const spendTrend = computed<'up' | 'down' | 'flat' | null>(() => {
  const s = spendDaily.value?.sparkline || [];
  if (s.length < 4) return null;
  const today = s[s.length - 1].calls;
  const prior = s.slice(Math.max(0, s.length - 8), -1);
  if (!prior.length) return null;
  const avg = prior.reduce((a, b) => a + b.calls, 0) / prior.length;
  if (avg < 1) return today > 1 ? 'up' : null;
  const r = today / avg;
  if (r > 1.25) return 'up';
  if (r < 0.75) return 'down';
  return null;
});
const budgetTone = computed<'good' | 'warn' | 'bad' | 'neutral'>(() => {
  const v = localStorage.getItem('atlas.monthlyBudget');
  const b = v ? parseFloat(v) : NaN;
  const m = stats.value?.codeburn.month?.dollars;
  if (!Number.isFinite(b) || !m) return 'neutral';
  const pct = m / b;
  if (pct >= 1.0) return 'bad';
  if (pct >= 0.8) return 'warn';
  return 'good';
});

const serviceCount = computed(() => `${stats.value?.services.healthy ?? 0}/${stats.value?.services.total ?? 0}`);
const serviceSub = computed(() => {
  const h = stats.value?.services.healthy ?? 0;
  const t = stats.value?.services.total ?? 0;
  if (!t) return '—';
  return h === t ? 'all green' : `${t - h} down`;
});
const serviceDot = computed<'green' | 'yellow' | 'red' | null>(() => {
  const h = stats.value?.services.healthy ?? 0;
  const t = stats.value?.services.total ?? 0;
  if (!t) return null;
  if (h === t) return 'green';
  return (t - h) >= t / 2 ? 'red' : 'yellow';
});
const serviceTone = computed<'good' | 'warn' | 'bad' | 'neutral'>(() => {
  const d = serviceDot.value;
  if (d === 'green') return 'good';
  if (d === 'yellow') return 'warn';
  if (d === 'red') return 'bad';
  return 'neutral';
});

const driftSignals = computed<string[]>(() => {
  const md: string = drift.value?.report?.markdown || '';
  const sigs: string[] = [];
  for (const l of md.split('\n')) {
    const m = l.match(/^###\s+`([^`]+)`/);
    if (m) sigs.push(m[1]);
  }
  return sigs;
});
const driftValue = computed(() => driftSignals.value.length > 0 ? `${driftSignals.value.length} signal${driftSignals.value.length > 1 ? 's' : ''}` : 'Clean');
const driftSub = computed(() => drift.value?.report?.week ? `week ${drift.value.report.week}` : 'no scan yet');
const driftTone = computed<'good' | 'bad' | 'neutral'>(() => {
  if (!drift.value?.report) return 'neutral';
  return driftSignals.value.length > 0 ? 'bad' : 'good';
});
const driftDot = computed<'green' | 'red' | null>(() => {
  if (!drift.value?.report) return null;
  return driftSignals.value.length > 0 ? 'red' : 'green';
});

async function runDriftScan() {
  try {
    await fetch(`${API_BASE_URL}/api/atlas/drift/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"days":7}',
    });
  } catch { /* silent */ }
}

const missionList = computed<any[]>(() => missions.value?.missions || []);
const activeMissionList = computed(() => missionList.value.filter(m => m.status !== 'done' && m.status !== 'abandoned'));
const missionCount = computed(() => activeMissionList.value.length);
const missionSub = computed(() => {
  if (!activeMissionList.value.length) return 'none in flight';
  const inProgress = activeMissionList.value.filter(m => m.status === 'in_progress').length;
  const review = activeMissionList.value.filter(m => m.status === 'review').length;
  if (inProgress && review) return `${inProgress} active · ${review} review`;
  if (inProgress) return `${inProgress} active`;
  if (review) return `${review} in review`;
  return `${activeMissionList.value.length} queued`;
});

const scoutCands = computed<any[]>(() =>
  (scout.value?.candidates || []).filter((c: any) => c.status === 'pending' && c.recommendation === 'install_proposed')
);
const scoutCount = computed(() => scoutCands.value.length);
const scoutSub = computed(() => {
  const t = scout.value?.trials?.length || 0;
  if (!scoutCount.value) return t ? `${t} on trial` : 'sweep Sun 04:00';
  return t ? `new · ${t} on trial` : 'new this week';
});

const ghCount = computed(() => ghFeed.value?.items?.length || 0);
const ghSub = computed(() => {
  const items = ghFeed.value?.items || [];
  if (!items.length) return ghFeed.value?.message || 'no open PRs';
  const prs = items.filter(i => i.kind === 'pr').length;
  const iss = items.length - prs;
  return `${prs} PR${prs !== 1 ? 's' : ''} · ${iss} issue${iss !== 1 ? 's' : ''}`;
});

// ===== Division tiles =====
const KNOWN_DIVISIONS = [
  { slug: 'atlas-meta' },
  { slug: 'margin' },
  { slug: 'industry' },
];
function relTimeNum(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86_400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86_400)}d`;
}
const divisionRows = computed(() => {
  const now = Date.now();
  const cutoff = now - 24 * 3600_000;
  return KNOWN_DIVISIONS.map((d) => {
    const events24h = events.value.filter(e => {
      if (!e.timestamp || e.timestamp < cutoff) return false;
      const p: any = e.payload || {};
      if (p.division === d.slug) return true;
      if ((e.source_app || '').includes(d.slug)) return true;
      return false;
    });
    const am = missionList.value.filter((m: any) =>
      m.division === d.slug && m.status !== 'done' && m.status !== 'abandoned'
    ).length;
    const last = events24h[events24h.length - 1];
    const lastTs = last?.timestamp;
    const lastSummary = (last?.summary || last?.payload?.summary || last?.payload?.tool_input?.command || '').toString();
    return {
      slug: d.slug,
      health: (events24h.length === 0 ? 'idle' : 'active') as 'idle' | 'active',
      events24h: events24h.length,
      activeMissions: am,
      lastActionAgo: lastTs ? relTimeNum(lastTs) : '—',
      lastSummary,
    };
  });
});
</script>

<style scoped>
.atlas-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--atlas-page-bg);
  color: var(--atlas-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.atlas-page__divider {
  height: 1px;
  background: var(--atlas-hairline);
  margin: 0 48px;
  flex: none;
}
@media (max-width: 1023px) { .atlas-page__divider { margin: 0 24px; } }

/* ---- Page-level 2-column grid: work column | brief column ---- */
.atlas-page__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 580px;
  gap: 32px;
  padding: 24px 48px 48px;
  align-items: start;
}
@media (max-width: 1439px) {
  .atlas-page__grid { grid-template-columns: minmax(0, 1fr) 520px; gap: 28px; padding: 20px 40px 40px; }
}
@media (max-width: 1279px) {
  .atlas-page__grid { grid-template-columns: minmax(0, 1fr) 440px; gap: 24px; padding: 20px 32px 40px; }
}
@media (max-width: 1023px) {
  .atlas-page__grid { grid-template-columns: 1fr; gap: 16px; padding: 16px 24px 40px; }
}

.atlas-page__main {
  display: flex;
  flex-direction: column;
  gap: 24px;
  min-width: 0;
}
.atlas-page__aside {
  position: sticky;
  top: 24px;
  min-width: 0;
}
@media (max-width: 1023px) { .atlas-page__aside { position: static; } }

/* ---- KPI tile strip ---- */
.atlas-page__tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.atlas-page__tiles--divisions {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
@media (min-width: 1440px) {
  .atlas-page__tiles { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .atlas-page__tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .atlas-page__tiles--divisions { grid-template-columns: 1fr; }
}

/* ---- Primary row: Talk + Today side-by-side ---- */
.atlas-page__row--primary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}
@media (max-width: 1023px) {
  .atlas-page__row--primary { grid-template-columns: 1fr; gap: 12px; }
}

.atlas-page__error {
  position: fixed; bottom: 16px; left: 16px; z-index: 60;
  padding: 8px 12px; font-size: 12px; color: var(--atlas-red);
  background: var(--atlas-card-bg); border: 1px solid rgba(255, 59, 48, 0.40); border-radius: 8px;
}
</style>
