<template>
  <div class="dialog-bg" @click.self="$emit('close')">
    <div class="dialog">
      <header class="dialog__head">
        <h3>New task</h3>
        <button class="dialog__x" @click="$emit('close')">✕</button>
      </header>

      <label class="field">
        <span class="field__label">Project</span>
        <select v-model="projectId" class="field__input">
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }} · {{ p.path }}</option>
        </select>
      </label>

      <label class="field">
        <span class="field__label">Title</span>
        <input v-model="title" class="field__input" placeholder="e.g. fix autosave bug" />
      </label>

      <label class="field">
        <span class="field__label">Prompt</span>
        <textarea v-model="prompt" class="field__input field__input--textarea" rows="6"
          placeholder="Describe what you want the agent to do. Be specific — files, behavior, tests."></textarea>
      </label>

      <div class="field-row">
        <label class="field">
          <span class="field__label">Model</span>
          <select v-model="model" class="field__input">
            <option value="haiku">Claude · Haiku 4.5</option>
            <option value="sonnet">Claude · Sonnet 4.6</option>
            <option value="opus">Claude · Opus 4.7</option>
            <option value="gpt5">GPT-5.5 (Codex)</option>
            <option value="gemma">Gemma (local)</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Mode</span>
          <select v-model="mode" class="field__input">
            <option value="safe">Safe · accept edits, ask for shell</option>
            <option value="auto">Auto · bypass all prompts (vibe)</option>
          </select>
        </label>
      </div>

      <p v-if="error" class="dialog__error">{{ error }}</p>

      <footer class="dialog__foot">
        <button class="dialog__btn dialog__btn--ghost" @click="$emit('close')">Cancel</button>
        <button class="dialog__btn dialog__btn--primary" :disabled="!canSubmit || saving" @click="submit">
          {{ saving ? 'Creating…' : 'Add to Backlog' }}
        </button>
        <button class="dialog__btn dialog__btn--primary" :disabled="!canSubmit || saving" @click="submitAndRun">
          {{ saving ? '…' : 'Create + Run' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { WSProject } from '../../composables/useWorkspace';

const props = defineProps<{ projects: WSProject[]; defaultProjectId?: string | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'create', payload: { project_id: string; title: string; prompt: string; model: string; mode: 'safe' | 'auto' }, runImmediately: boolean): void;
}>();

const projectId = ref(props.defaultProjectId || props.projects[0]?.id || '');
const title = ref('');
const prompt = ref('');
const model = ref('sonnet');
const mode = ref<'safe' | 'auto'>('safe');
const saving = ref(false);
const error = ref<string | null>(null);

watch(() => props.projects, (p) => {
  if (!projectId.value && p.length) projectId.value = p[0].id;
});

const canSubmit = computed(() => projectId.value && title.value.trim() && prompt.value.trim());

async function submit() { doSubmit(false); }
async function submitAndRun() { doSubmit(true); }
function doSubmit(run: boolean) {
  if (!canSubmit.value) return;
  error.value = null;
  saving.value = true;
  emit('create', {
    project_id: projectId.value,
    title: title.value.trim(),
    prompt: prompt.value.trim(),
    model: model.value,
    mode: mode.value,
  }, run);
}
</script>

<style scoped>
.dialog-bg {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.45);
  display: grid; place-items: center;
  z-index: 200;
  padding: 40px;
}
.dialog {
  background: var(--atlas-page-bg);
  border-radius: 14px;
  padding: 24px;
  width: 100%; max-width: 580px;
  display: flex; flex-direction: column; gap: 14px;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  box-shadow: 0 30px 80px rgba(0,0,0,0.45);
}
.dialog__head {
  display: flex; justify-content: space-between; align-items: center;
}
.dialog__head h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--atlas-text-strong);
}
.dialog__x {
  background: transparent; border: none;
  font-size: 16px; color: var(--atlas-text-secondary);
  cursor: pointer; padding: 4px 8px;
}

.field { display: flex; flex-direction: column; gap: 6px; }
.field__label {
  font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--atlas-text-secondary);
}
.field__input {
  background: var(--atlas-card-bg);
  border: 1px solid var(--atlas-hairline);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 14px;
  color: var(--atlas-text-primary);
  outline: none;
}
.field__input:focus {
  border-color: var(--atlas-blue);
}
.field__input--textarea {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.dialog__foot {
  display: flex; gap: 10px; justify-content: flex-end; margin-top: 6px;
}
.dialog__btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--atlas-hairline);
  background: transparent;
  color: var(--atlas-text-primary);
  cursor: pointer;
}
.dialog__btn:hover { background: var(--atlas-card-bg); }
.dialog__btn--primary {
  background: var(--atlas-blue);
  border-color: var(--atlas-blue);
  color: white;
}
.dialog__btn--primary:hover { opacity: 0.9; }
.dialog__btn--primary:disabled { opacity: 0.4; cursor: not-allowed; }
.dialog__btn--ghost { color: var(--atlas-text-secondary); }

.dialog__error {
  margin: 0;
  font-size: 13px;
  color: var(--atlas-red, #ff453a);
}
</style>
