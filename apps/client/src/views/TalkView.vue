<template>
  <div class="talk-view">
    <div ref="scrollEl" class="talk-thread">
      <div v-if="!messages.length" class="talk-empty">
        <h3>What can Atlas help with?</h3>
        <div class="talk-empty__suggestions">
          <button
            v-for="s in suggestions"
            :key="s"
            class="atb-pill"
            @click="sendMessage(s)"
            :disabled="sending"
          >{{ s }}</button>
        </div>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        class="talk-msg"
        :class="`is-${msg.role}`"
      >
        <div class="talk-bubble">
          {{ msg.text }}
        </div>
        <div v-if="msg.role === 'atlas' && msg.decision" class="talk-meta">
          @{{ msg.decision.agent }} · {{ msg.decision.project }} · {{ msg.decision.model }}
        </div>
        <div v-else-if="msg.role === 'error'" class="talk-meta is-error">{{ msg.detail || 'error' }}</div>
      </div>

      <div v-if="sending" class="talk-msg is-atlas is-pending">
        <div class="talk-bubble talk-bubble--pending">
          <span class="talk-dot"></span><span class="talk-dot"></span><span class="talk-dot"></span>
        </div>
      </div>
    </div>

    <form class="talk-composer" @submit.prevent="onSubmit">
      <textarea
        ref="inputEl"
        v-model="draft"
        class="talk-composer__input"
        placeholder="Talk to Atlas…"
        rows="1"
        @keydown="onKeyDown"
        :disabled="sending"
      ></textarea>
      <button
        type="submit"
        class="btn btn--primary"
        :disabled="!draft.trim() || sending"
      >{{ sending ? 'Routing…' : 'Send' }}</button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { API_BASE_URL } from '../config';

interface Msg {
  role: 'user' | 'atlas' | 'error';
  text: string;
  decision?: { agent: string; project: string; model: string; rationale?: string };
  detail?: string;
  ts: number;
}

const STORAGE_KEY = 'atlas.talkThread';
const MAX_MESSAGES = 100;

const suggestions = [
  'status check',
  'what did you find this morning',
  'draft a cold email',
];

const messages = ref<Msg[]>(loadThread());
const draft = ref('');
const sending = ref(false);
const scrollEl = ref<HTMLDivElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);

function loadThread(): Msg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw).slice(-MAX_MESSAGES);
  } catch {/* ignore */}
  return [];
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.value.slice(-MAX_MESSAGES)));
  } catch {/* ignore */}
}

async function scrollToBottom() {
  await nextTick();
  if (scrollEl.value) {
    scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
  }
}

async function sendMessage(text: string) {
  const trimmed = text.trim();
  if (!trimmed || sending.value) return;
  messages.value.push({ role: 'user', text: trimmed, ts: Date.now() });
  persist();
  scrollToBottom();
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
    scrollToBottom();
  }
}

function onSubmit() {
  const text = draft.value;
  draft.value = '';
  sendMessage(text);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    onSubmit();
  }
}

onMounted(() => { scrollToBottom(); });
</script>

<style scoped>
.talk-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--theme-bg-secondary);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.talk-thread {
  flex: 1;
  overflow-y: auto;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
@media (max-width: 699px) { .talk-thread { padding: 16px 12px 88px; } }

.talk-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  margin: auto;
  gap: 14px;
  color: var(--theme-text-tertiary);
}
.talk-empty h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 500;
  color: var(--theme-text-secondary);
}
.talk-empty__suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.atb-pill {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  background: var(--theme-bg-primary);
  border: 1px solid var(--theme-border-primary);
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.atb-pill:hover:not(:disabled) { background: var(--theme-bg-tertiary); color: var(--theme-text-primary); }
.atb-pill:disabled { opacity: 0.5; cursor: not-allowed; }

.talk-msg {
  display: flex;
  flex-direction: column;
  max-width: 70%;
  gap: 4px;
}
.talk-msg.is-user {
  align-self: flex-end;
  align-items: flex-end;
}
.talk-msg.is-atlas, .talk-msg.is-error {
  align-self: flex-start;
}
@media (max-width: 699px) {
  .talk-msg { max-width: 88%; }
}

.talk-bubble {
  padding: 10px 14px;
  font-size: 15px;
  line-height: 1.45;
  border-radius: 18px;
  white-space: pre-wrap;
  word-wrap: break-word;
}
.is-user .talk-bubble {
  background: var(--theme-primary);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.is-atlas .talk-bubble {
  background: var(--theme-bg-primary);
  color: var(--theme-text-primary);
  border: 1px solid var(--theme-border-primary);
  border-bottom-left-radius: 4px;
}
.is-error .talk-bubble {
  background: rgba(255, 69, 58, 0.10);
  color: var(--theme-accent-error);
  border: 1px solid rgba(255, 69, 58, 0.30);
  border-bottom-left-radius: 4px;
  font-size: 13px;
}

.talk-bubble--pending {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.talk-dot {
  width: 5px;
  height: 5px;
  background: var(--theme-text-tertiary);
  border-radius: 50%;
  animation: talk-bounce 1.2s infinite ease-in-out;
}
.talk-dot:nth-child(2) { animation-delay: 0.15s; }
.talk-dot:nth-child(3) { animation-delay: 0.30s; }
@keyframes talk-bounce {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-3px); }
}

.talk-meta {
  font-size: 11px;
  color: var(--theme-text-tertiary);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
}
.talk-meta.is-error { color: var(--theme-accent-error); }

.talk-composer {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  background: var(--theme-bg-primary);
  border-top: 1px solid var(--theme-border-primary);
}
@media (max-width: 699px) {
  .talk-composer { padding: 8px 10px calc(60px + env(safe-area-inset-bottom)); }
}

.talk-composer__input {
  flex: 1;
  min-height: 38px;
  max-height: 200px;
  padding: 9px 12px;
  font-size: 14px;
  font-family: inherit;
  color: var(--theme-text-primary);
  background: var(--theme-bg-secondary);
  border: 1px solid var(--theme-border-primary);
  border-radius: 18px;
  outline: none;
  resize: none;
  line-height: 1.4;
}
.talk-composer__input:focus {
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 3px var(--theme-primary-light);
}
.talk-composer__input:disabled { opacity: 0.6; }

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  border-radius: 18px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.btn--primary {
  background: var(--theme-primary);
  color: #fff;
  border-color: var(--theme-primary);
}
.btn--primary:hover:not(:disabled) { background: var(--theme-primary-hover); }
.btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
