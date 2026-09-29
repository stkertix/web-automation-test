<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive confirm styling (default). Set false for non-destructive actions. */
  danger?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();

const confirmBtn = ref<HTMLButtonElement | null>(null);
const isDanger = computed(() => props.danger !== false);

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    confirmBtn.value?.focus();
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
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop"
    role="presentation"
    @click="onBackdropClick"
    @keydown="onKeydown"
  >
    <div
      class="dialog"
      role="alertdialog"
      aria-modal="true"
      :aria-label="title ?? 'Confirm'"
    >
      <header class="dialog-head">
        <h3>{{ title ?? 'Confirm' }}</h3>
        <button type="button" class="icon-btn" aria-label="Close" @click="$emit('close')">
          <i class="fi fi-rr-cross-small" aria-hidden="true"></i>
        </button>
      </header>

      <div class="dialog-body">
        <p class="message">{{ message }}</p>
        <footer class="dialog-actions">
          <button type="button" @click="$emit('close')">
            {{ cancelLabel ?? 'Cancel' }}
          </button>
          <button
            ref="confirmBtn"
            type="button"
            :class="{ danger: isDanger, solid: isDanger, primary: !isDanger }"
            @click="$emit('confirm')"
          >
            <i
              v-if="isDanger"
              class="fi fi-rr-trash"
              aria-hidden="true"
            ></i>
            {{ confirmLabel ?? (isDanger ? 'Delete' : 'Confirm') }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
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
  gap: 0.85rem;
}

.message {
  margin: 0;
  font-size: 0.88rem;
  color: var(--text);
  line-height: 1.45;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}

.solid {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}

.solid:hover:not(:disabled) {
  filter: brightness(0.92);
  border-color: var(--danger);
}

.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.primary:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
</style>
