<template>
  <article class="card talk">
    <span class="card-eyebrow">Talk to Atlas</span>

    <div ref="threadEl" class="talk__thread">
      <div v-if="!messages.length" class="talk__empty">
        <p class="talk__empty-lead">What can Atlas help with?</p>
        <div class="talk__empty-suggestions">
          <button v-for="s in suggestions" :key="s" class="talk__chip" @click="send(s)" :disabled="sending">{{ s }}</button>
        </div>
      </div>

      <div v-for="(msg, i) in messages" :key="i" class="talk__msg" :class="`is-${msg.role}`">
        <div class="talk__bubble">{{ msg.text }}</div>
        <div v-if="msg.role === 'atlas' && msg.decision" class="talk__meta">
          @{{ msg.decision.agent }} · {{ msg.decision.project }} · {{ msg.decision.model }}
        </div>
        <div v-else-if="msg.role === 'error'" class="talk__meta is-error">{{ msg.detail || 'error' }}</div>
      </div>

      <div v-if="sending" class="talk__msg is-atlas">
        <div class="talk__bubble talk__bubble--pending">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
      </div>
    </div>

    <form class="talk__composer" @submit.prevent="onSubmit">
      <input
        ref="inputEl"
        type="text"
        class="talk__input"
        v-model="draft"
        placeholder="Message Atlas…"
        @keydown="onKey"
        :disabled="sending"
      />
      <button type="submit" class="talk__send" :disabled="!draft.trim() || sending">{{ sending ? '…' : 'Send' }}</button>
    </form>
  </article>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { API_BASE_URL } from '../../../config';

interface Msg {
  role: 'user' | 'atlas' | 'error';
  text: string;
  decision?: { agent: string; project: string; model: string; rationale?: string };
  detail?: string;
  ts: number;
}

const STORAGE_KEY = 'atlas.talkThread';
const MAX_MESSAGES = 100;
const suggestions = ['status check', 'what did you find this morning', 'draft a cold email'];

const messages = ref<Msg[]>(load());
const draft = ref('');
const sending = ref(false);
const threadEl = ref<HTMLDivElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);

function load(): Msg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw).slice(-MAX_MESSAGES);
  } catch {/* ignore */}
  return [];
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.value.slice(-MAX_MESSAGES))); } catch {/* ignore */}
}

async function scrollDown() {
  await nextTick();
  if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight;
}

async function send(text: string) {
  const trimmed = text.trim();
  if (!trimmed || sending.value) return;
  messages.value.push({ role: 'user', text: trimmed, ts: Date.now() });
  persist();
  scrollDown();
  sending.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/atlas/talk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: trimmed }),
    });
    const data = await res.json();
    if (!res.ok) {
      messages.value.push({ role: 'error', text: 'Atlas could not reply.', detail: data?.error || `HTTP ${res.status}`, ts: Date.now() });
    } else {
      messages.value.push({ role: 'atlas', text: data.reply || '(no reply)', decision: data.decision, ts: Date.now() });
    }
  } catch (err: any) {
    messages.value.push({ role: 'error', text: 'Network error reaching Atlas.', detail: err?.message, ts: Date.now() });
  } finally {
    sending.value = false;
    persist();
    scrollDown();
  }
}

function onSubmit() {
  const t = draft.value;
  draft.value = '';
  send(t);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    onSubmit();
  }
}

function onCmdK(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    inputEl.value?.focus();
  }
}

onMounted(() => {
  scrollDown();
  document.addEventListener('keydown', onCmdK);
});
onUnmounted(() => document.removeEventListener('keydown', onCmdK));
</script>

<style scoped>
.card {
  background: var(--atlas-card-bg);
  border-radius: 20px;
  padding: 32px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
@media (max-width: 1023px) { .card { padding: 24px; } }

.card-eyebrow {
  display: block;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--atlas-text-secondary);
}

.talk__thread {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
}

.talk__empty {
  margin: 8px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.talk__empty-lead {
  margin: 0;
  font-size: 15px;
  color: var(--atlas-text-secondary);
}
.talk__empty-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.talk__chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  color: var(--atlas-text-primary);
  background: transparent;
  border: 1px solid var(--atlas-hairline);
  border-radius: 999px;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.talk__chip:hover:not(:disabled) { opacity: 0.7; }
.talk__chip:disabled { opacity: 0.4; cursor: not-allowed; }

.talk__msg {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 80%;
}
.talk__msg.is-user { align-self: flex-end; align-items: flex-end; }
.talk__msg.is-atlas, .talk__msg.is-error { align-self: flex-start; }

.talk__bubble {
  padding: 10px 16px;
  font-size: 15px;
  font-weight: 400;
  line-height: 1.45;
  border-radius: 18px;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.is-user .talk__bubble {
  background: var(--atlas-blue);
  color: #FFFFFF;
  border-bottom-right-radius: 6px;
}
.is-atlas .talk__bubble {
  background: var(--atlas-card-bg-2);
  color: var(--atlas-text-primary);
  border-bottom-left-radius: 6px;
}
.is-error .talk__bubble {
  background: rgba(255, 59, 48, 0.10);
  color: var(--atlas-red);
  border-bottom-left-radius: 6px;
  font-size: 14px;
}

.talk__bubble--pending {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dot {
  width: 6px; height: 6px;
  background: var(--atlas-text-muted);
  border-radius: 50%;
  animation: talk-bounce 1.2s infinite ease-in-out;
}
.dot:nth-child(2) { animation-delay: 0.15s; }
.dot:nth-child(3) { animation-delay: 0.30s; }
@keyframes talk-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}

.talk__meta {
  font-size: 13px;
  color: var(--atlas-text-muted);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
.talk__meta.is-error { color: var(--atlas-red); }

.talk__composer {
  display: flex;
  gap: 8px;
  border-top: 1px solid var(--atlas-hairline);
  padding-top: 16px;
}
.talk__input {
  flex: 1;
  height: 40px;
  padding: 0 14px;
  font-size: 15px;
  font-family: inherit;
  color: var(--atlas-text-primary);
  background: var(--atlas-page-bg);
  border: 1px solid var(--atlas-hairline);
  border-radius: 12px;
  outline: none;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.talk__input:focus {
  border-color: var(--atlas-blue);
  box-shadow: 0 0 0 3px var(--atlas-blue-soft);
}
.talk__input::placeholder { color: var(--atlas-text-muted); }
.talk__input:disabled { opacity: 0.6; }

.talk__send {
  height: 40px;
  padding: 0 18px;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  color: #FFFFFF;
  background: var(--atlas-blue);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.talk__send:hover:not(:disabled) { background: var(--atlas-blue-hover); }
.talk__send:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
