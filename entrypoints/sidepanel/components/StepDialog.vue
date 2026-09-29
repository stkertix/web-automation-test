<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  MessageType,
  type ExtensionMessage,
  type MessageResponse,
} from '../../../shared/messages';
import type { StepType, TestStep } from '../../../shared/types';

export type StepDialogMode = 'add' | 'edit';

export interface StepDialogResult {
  stepType: StepType;
  selectors: string[];
  value: string | null;
  url: string | null;
  index: number | null;
  stepId?: string;
}

const props = defineProps<{
  open: boolean;
  mode: StepDialogMode;
  stepCount: number;
  /** Preselected insert index when adding (null = append). */
  initialIndex?: number | null;
  step?: TestStep | null;
}>();

const emit = defineEmits<{
  close: [];
  save: [result: StepDialogResult];
}>();

const STEP_TYPES: StepType[] = [
  'navigate',
  'click',
  'dblclick',
  'input',
  'change',
  'submit',
];

const stepType = ref<StepType>('click');
const target = ref('');
const value = ref('');
const index = ref('');
const error = ref('');
const picking = ref(false);
const pickedSelectors = ref<string[]>([]);
const firstField = ref<HTMLInputElement | HTMLSelectElement | null>(null);
let syncingTarget = false;

const title = computed(() =>
  props.mode === 'edit' ? 'Edit step' : 'Add step',
);
const needsTarget = computed(() => true);
const targetLabel = computed(() =>
  stepType.value === 'navigate' ? 'URL' : 'Selector',
);
const targetPlaceholder = computed(() =>
  stepType.value === 'navigate'
    ? 'https://example.com'
    : '#submit-btn or [data-testid="x"]',
);
const needsValue = computed(
  () => stepType.value === 'input' || stepType.value === 'change',
);
const showPosition = computed(() => props.mode === 'add');
const canPickElement = computed(() => stepType.value !== 'navigate');

const insertOptions = computed(() => {
  const options = [{ value: '', label: 'Append at end' }];
  for (let i = 0; i < props.stepCount; i += 1) {
    options.push({
      value: String(i),
      label: `Insert before step ${i + 1}`,
    });
  }
  return options;
});

function syncFromProps(): void {
  error.value = '';
  picking.value = false;
  syncingTarget = true;
  if (props.mode === 'edit' && props.step) {
    stepType.value = props.step.type;
    pickedSelectors.value =
      props.step.type === 'navigate' ? [] : [...props.step.selectors];
    target.value =
      props.step.type === 'navigate'
        ? (props.step.url ?? '')
        : (props.step.selectors[0] ?? '');
    value.value = props.step.value ?? '';
    index.value = '';
    syncingTarget = false;
    return;
  }

  stepType.value = 'click';
  pickedSelectors.value = [];
  target.value = '';
  value.value = '';
  syncingTarget = false;
  if (props.initialIndex == null) {
    index.value = '';
  } else if (props.initialIndex >= props.stepCount) {
    index.value = '';
  } else {
    index.value = String(props.initialIndex);
  }
}

async function cancelPick(): Promise<void> {
  if (!picking.value) return;
  picking.value = false;
  try {
    await browser.runtime.sendMessage({
      type: MessageType.CANCEL_ELEMENT_PICK,
    } satisfies ExtensionMessage);
  } catch {
    // ignore
  }
}

async function startPick(): Promise<void> {
  if (!canPickElement.value || picking.value) return;
  error.value = '';
  const response = (await browser.runtime.sendMessage({
    type: MessageType.START_ELEMENT_PICK,
  } satisfies ExtensionMessage)) as MessageResponse;

  if (!response || typeof response !== 'object' || !('ok' in response)) {
    error.value = 'Failed to start element picker.';
    return;
  }
  if (!response.ok) {
    error.value = response.error || 'Failed to start element picker.';
    return;
  }
  picking.value = true;
}

function applyPickedSelectors(selectors: string[]): void {
  if (!selectors.length) return;
  syncingTarget = true;
  pickedSelectors.value = [...selectors];
  target.value = selectors[0] ?? '';
  syncingTarget = false;
  picking.value = false;
  error.value = '';
}

function onRuntimeMessage(message: ExtensionMessage): void {
  if (!props.open) return;
  if (message.type === MessageType.ELEMENT_PICKED) {
    applyPickedSelectors(message.selectors);
    return;
  }
  if (message.type === MessageType.STATE_CHANGED) {
    if (picking.value && message.state.mode !== 'pick') {
      picking.value = false;
    }
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      await cancelPick();
      return;
    }
    syncFromProps();
    await nextTick();
    firstField.value?.focus();
  },
);

watch(stepType, async (type) => {
  if (type === 'navigate' && picking.value) {
    await cancelPick();
  }
  if (type === 'navigate') {
    pickedSelectors.value = [];
  }
});

watch(target, (value) => {
  if (syncingTarget || stepType.value === 'navigate') return;
  const first = pickedSelectors.value[0];
  if (first != null && value.trim() !== first) {
    // User edited selector manually — keep only the typed value on save.
    pickedSelectors.value = [];
  }
});

onMounted(() => {
  browser.runtime.onMessage.addListener(onRuntimeMessage);
});

onBeforeUnmount(() => {
  browser.runtime.onMessage.removeListener(onRuntimeMessage);
  void cancelPick();
});

function closeDialog(): void {
  void cancelPick();
  emit('close');
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) {
    closeDialog();
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (picking.value) {
      void cancelPick();
      return;
    }
    closeDialog();
  }
}

function onSubmit(): void {
  const trimmedTarget = target.value.trim();
  if (!trimmedTarget) {
    error.value =
      stepType.value === 'navigate'
        ? 'URL is required.'
        : 'Selector is required.';
    return;
  }

  const parsedIndex =
    index.value === '' ? null : Number.parseInt(index.value, 10);

  const selectors =
    stepType.value === 'navigate'
      ? []
      : pickedSelectors.value.length > 0 &&
          pickedSelectors.value[0] === trimmedTarget
        ? [...pickedSelectors.value]
        : [trimmedTarget];

  emit('save', {
    stepType: stepType.value,
    selectors,
    value: needsValue.value ? value.value : null,
    url: stepType.value === 'navigate' ? trimmedTarget : null,
    index: Number.isNaN(parsedIndex as number) ? null : parsedIndex,
    stepId: props.step?.id,
  });
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
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header class="dialog-head">
        <h3>{{ title }}</h3>
        <button type="button" class="icon-btn" aria-label="Close" @click="closeDialog">
          <i class="fi fi-rr-cross-small" aria-hidden="true"></i>
        </button>
      </header>

      <form class="dialog-body" @submit.prevent="onSubmit">
        <label class="field">
          <span>Type</span>
          <select ref="firstField" v-model="stepType" :disabled="picking">
            <option v-for="type in STEP_TYPES" :key="type" :value="type">
              {{ type }}
            </option>
          </select>
        </label>

        <div v-if="needsTarget" class="field">
          <span>{{ targetLabel }}</span>
          <div class="target-row">
            <input
              v-model="target"
              :type="stepType === 'navigate' ? 'url' : 'text'"
              :placeholder="targetPlaceholder"
              :disabled="picking"
              required
            />
            <button
              v-if="canPickElement"
              type="button"
              class="pick-btn"
              :class="{ active: picking }"
              :title="picking ? 'Cancel selection' : 'Select element on page'"
              :aria-label="picking ? 'Cancel selection' : 'Select element on page'"
              @click="picking ? cancelPick() : startPick()"
            >
              <i
                class="fi"
                :class="picking ? 'fi-rr-cross-small' : 'fi-rr-cursor-finger'"
                aria-hidden="true"
              ></i>
            </button>
          </div>
          <p v-if="picking" class="pick-hint">
            Click an element on the page. Esc to cancel.
          </p>
          <p
            v-else-if="canPickElement && pickedSelectors.length > 1"
            class="pick-hint muted"
          >
            {{ pickedSelectors.length }} fallback selectors saved
          </p>
        </div>

        <label v-if="needsValue" class="field">
          <span>Value</span>
          <input
            v-model="value"
            type="text"
            placeholder="Text to type"
            :disabled="picking"
          />
        </label>

        <label v-if="showPosition" class="field">
          <span>Position</span>
          <select v-model="index" :disabled="picking">
            <option
              v-for="option in insertOptions"
              :key="option.value || 'end'"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <footer class="dialog-actions">
          <button type="button" :disabled="picking" @click="closeDialog">
            Cancel
          </button>
          <button class="primary" type="submit" :disabled="picking">
            <i
              class="fi"
              :class="mode === 'edit' ? 'fi-rr-check' : 'fi-rr-plus'"
              aria-hidden="true"
            ></i>
            {{ mode === 'edit' ? 'Save' : 'Add step' }}
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
  z-index: 50;
  background: rgba(28, 35, 48, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.dialog {
  width: min(100%, 360px);
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

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--muted);
}

.field input,
.field select {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.55rem;
  color: var(--text);
  background: #fff;
  font: inherit;
}

.target-row {
  display: flex;
  gap: 0.35rem;
  align-items: stretch;
}

.target-row input {
  flex: 1;
  min-width: 0;
}

.pick-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.1rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  padding: 0;
  font-size: 1rem;
}

.pick-btn.active {
  border-color: #2563eb;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
}

.pick-hint {
  margin: 0;
  font-size: 0.72rem;
  color: #2563eb;
}

.pick-hint.muted {
  color: var(--muted);
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
  margin-top: 0.35rem;
}
</style>
