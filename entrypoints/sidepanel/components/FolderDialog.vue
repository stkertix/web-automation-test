<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue';

export type FolderDialogMode = 'create' | 'rename';

const props = defineProps<{
  open: boolean;
  mode: FolderDialogMode;
  initialName?: string;
  /** Shown as context, e.g. parent folder name. */
  contextLabel?: string | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [name: string];
}>();

const name = ref('');
const error = ref('');
const inputEl = ref<HTMLInputElement | null>(null);

const title = computed(() =>
  props.mode === 'rename' ? 'Rename folder' : 'New folder',
);
const submitLabel = computed(() =>
  props.mode === 'rename' ? 'Save' : 'Create folder',
);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    error.value = '';
    name.value = props.mode === 'rename' ? (props.initialName ?? '') : '';
    await nextTick();
    inputEl.value?.focus();
    inputEl.value?.select();
  },
);

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    emit('close');
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close');
  }
}

function onSubmit(): void {
  const trimmed = name.value.trim();
  if (!trimmed) {
    error.value = 'Folder name is required.';
    return;
  }
  emit('save', trimmed);
}
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    role="presentation"
    @click="onBackdropClick"
    @keydown="onKeydown"
  >
    <div class="dialog" role="dialog" aria-modal="true" :aria-label="title">
      <header class="dialog-head">
        <h3>{{ title }}</h3>
        <button type="button" class="icon-btn" aria-label="Close" @click="$emit('close')">
          <i class="fi fi-rr-cross-small" aria-hidden="true"></i>
        </button>
      </header>

      <form class="dialog-body" @submit.prevent="onSubmit">
        <p v-if="contextLabel" class="context">{{ contextLabel }}</p>

        <label class="field">
          <span>Folder name</span>
          <input
            ref="inputEl"
            v-model="name"
            type="text"
            placeholder="e.g. Auth"
            required
          />
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <footer class="dialog-actions">
          <button type="button" @click="$emit('close')">Cancel</button>
          <button class="primary" type="submit">
            <i
              class="fi"
              :class="mode === 'rename' ? 'fi-rr-check' : 'fi-rr-add-folder'"
              aria-hidden="true"
            ></i>
            {{ submitLabel }}
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgba(28, 35, 48, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.dialog {
  width: min(100%, 340px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(28, 35, 48, 0.18);
  overflow: hidden;
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.7rem 0.85rem;
  border-bottom: 1px solid var(--border);
}

.dialog-head h3 {
  margin: 0;
  font-size: 0.95rem;
}

.icon-btn {
  border: 0;
  background: transparent;
  font-size: 1.25rem;
  line-height: 1;
  padding: 0.15rem 0.4rem;
  color: var(--muted);
}

.dialog-body {
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.context {
  margin: 0;
  font-size: 0.78rem;
  color: var(--muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--muted);
}

.field input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.55rem;
  color: var(--text);
  background: #fff;
  font: inherit;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8rem;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.2rem;
}
</style>
