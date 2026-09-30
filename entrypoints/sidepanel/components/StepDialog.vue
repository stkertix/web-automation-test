<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  MessageType,
  type ExtensionMessage,
  type MessageResponse,
} from '../../../shared/messages';
import {
  DEFAULT_STEP_DELAY_MS,
  DEFAULT_WAIT_MS,
  MAX_SCRIPT_CHARS,
  MAX_STEP_DELAY_MS,
  MAX_STEP_NAME_CHARS,
  MAX_WAIT_MS,
  normalizeDelayMs,
  normalizeWaitMs,
  type StepType,
  type TestStep,
} from '../../../shared/types';

export type StepDialogMode = 'add' | 'edit';

export interface StepDialogResult {
  stepType: StepType;
  name: string | null;
  selectors: string[];
  value: string | null;
  url: string | null;
  delayMs: number;
  variableName: string | null;
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
  'wait',
  'script',
  'divider',
];

const STEP_TYPE_LABELS: Record<StepType, string> = {
  navigate: 'navigate',
  click: 'click',
  dblclick: 'dblclick',
  input: 'input',
  change: 'change',
  submit: 'submit',
  wait: 'wait element',
  script: 'script',
  divider: 'divider',
};

const stepType = ref<StepType>('click');
const stepName = ref('');
const target = ref('');
const value = ref('');
const timeoutMs = ref(String(DEFAULT_WAIT_MS));
const delayMs = ref(String(DEFAULT_STEP_DELAY_MS));
const variableName = ref('');
const index = ref('');
const error = ref('');
const picking = ref(false);
const pickedSelectors = ref<string[]>([]);
const firstField = ref<HTMLInputElement | null>(null);
let syncingTarget = false;

const title = computed(() =>
  props.mode === 'edit' ? 'Edit step' : 'Add step',
);
const needsScript = computed(() => stepType.value === 'script');
const isDivider = computed(() => stepType.value === 'divider');
const needsTarget = computed(
  () => stepType.value !== 'script' && stepType.value !== 'divider',
);
const targetLabel = computed(() =>
  stepType.value === 'navigate' ? 'URL' : 'Selector',
);
const targetPlaceholder = computed(() =>
  stepType.value === 'navigate'
    ? '{{baseUrl}}/login'
    : '#submit-btn or [data-testid="x"]',
);
const needsValue = computed(
  () => stepType.value === 'input' || stepType.value === 'change',
);
const needsTimeout = computed(() => stepType.value === 'wait');
const showPosition = computed(() => props.mode === 'add');
const canPickElement = computed(
  () =>
    stepType.value !== 'navigate' &&
    stepType.value !== 'script' &&
    stepType.value !== 'divider',
);

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
    stepName.value = props.step.name ?? '';
    pickedSelectors.value =
      props.step.type === 'navigate' ? [] : [...props.step.selectors];
    target.value =
      props.step.type === 'navigate'
        ? (props.step.url ?? '')
        : (props.step.selectors[0] ?? '');
    value.value = props.step.value ?? '';
    timeoutMs.value = String(
      props.step.type === 'wait'
        ? normalizeWaitMs(props.step.value)
        : DEFAULT_WAIT_MS,
    );
    delayMs.value = String(normalizeDelayMs(props.step.delayMs));
    variableName.value = props.step.variableName ?? '';
    index.value = '';
    syncingTarget = false;
    return;
  }

  stepType.value = 'click';
  stepName.value = '';
  pickedSelectors.value = [];
  target.value = '';
  value.value = '';
  timeoutMs.value = String(DEFAULT_WAIT_MS);
  delayMs.value = String(DEFAULT_STEP_DELAY_MS);
  variableName.value = '';
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
  if (
    (type === 'navigate' || type === 'script' || type === 'divider') &&
    picking.value
  ) {
    await cancelPick();
  }
  if (type === 'navigate' || type === 'script' || type === 'divider') {
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

function isNavigateTarget(value: string): boolean {
  if (/\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function onSubmit(): void {
  const script = value.value.trim();
  if (needsScript.value) {
    if (!script) {
      error.value = 'Script is required.';
      return;
    }
    if (script.length > MAX_SCRIPT_CHARS) {
      error.value = `Script must be at most ${MAX_SCRIPT_CHARS} characters.`;
      return;
    }
  }

  const trimmedTarget = target.value.trim();
  if (needsTarget.value && !trimmedTarget) {
    error.value =
      stepType.value === 'navigate'
        ? 'URL is required.'
        : 'Selector is required.';
    return;
  }
  if (stepType.value === 'navigate' && !isNavigateTarget(trimmedTarget)) {
    error.value =
      'Enter an http(s) URL, or a value that includes {{variable}}.';
    return;
  }

  let parsedTimeout = DEFAULT_WAIT_MS;
  if (stepType.value === 'wait') {
    parsedTimeout = Number.parseInt(timeoutMs.value, 10);
    if (
      !Number.isFinite(parsedTimeout) ||
      parsedTimeout < 0 ||
      parsedTimeout > MAX_WAIT_MS
    ) {
      error.value = `Timeout must be a whole number from 0 to ${MAX_WAIT_MS}.`;
      return;
    }
  }

  const trimmedVariable = variableName.value.trim();
  if (
    needsScript.value &&
    trimmedVariable &&
    (trimmedVariable.length > 64 ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedVariable))
  ) {
    error.value =
      'Variable name must start with a letter or underscore and use only letters, numbers, and underscores.';
    return;
  }

  const parsedDelay = isDivider.value
    ? 0
    : Number.parseInt(delayMs.value, 10);
  if (
    !isDivider.value &&
    (!Number.isFinite(parsedDelay) ||
      parsedDelay < 0 ||
      parsedDelay > MAX_STEP_DELAY_MS)
  ) {
    error.value = `Delay must be a whole number from 0 to ${MAX_STEP_DELAY_MS}.`;
    return;
  }

  const parsedIndex =
    index.value === '' ? null : Number.parseInt(index.value, 10);

  const selectors =
    stepType.value === 'navigate' || stepType.value === 'divider'
      ? []
      : pickedSelectors.value.length > 0 &&
          pickedSelectors.value[0] === trimmedTarget
        ? [...pickedSelectors.value]
        : [trimmedTarget];

  const trimmedName = stepName.value.trim().replace(/\s+/g, ' ');

  emit('save', {
    stepType: stepType.value,
    name: trimmedName || null,
    selectors,
    value: needsScript.value
      ? script
      : needsTimeout.value
        ? String(parsedTimeout)
        : needsValue.value
          ? value.value
          : null,
    url: stepType.value === 'navigate' ? trimmedTarget : null,
    delayMs: parsedDelay,
    variableName: needsScript.value && trimmedVariable ? trimmedVariable : null,
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
      :class="{ wide: needsScript }"
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
          <span>Name</span>
          <input
            ref="firstField"
            v-model="stepName"
            type="text"
            :maxlength="MAX_STEP_NAME_CHARS"
            placeholder="Optional"
            :disabled="picking"
          />
          <p class="pick-hint muted">
            {{
              isDivider
                ? 'Optional label on the divider. Playback skips this step.'
                : 'When set, the step list shows this name instead of type and target.'
            }}
          </p>
        </label>

        <label class="field">
          <span>Type</span>
          <select v-model="stepType" :disabled="picking">
            <option v-for="type in STEP_TYPES" :key="type" :value="type">
              {{ STEP_TYPE_LABELS[type] }}
            </option>
          </select>
        </label>

        <div v-if="needsTarget" class="field">
          <span>{{ targetLabel }}</span>
          <div class="target-row">
            <input
              v-model="target"
              type="text"
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
          <p v-else-if="stepType === 'navigate'" class="pick-hint muted">
            Use &#123;&#123;baseUrl&#125;&#125; for the selected environment.
          </p>
        </div>

        <label v-if="needsScript" class="field">
          <span>Script</span>
          <textarea
            v-model="value"
            rows="8"
            spellcheck="false"
            placeholder="return document.querySelector('h1')?.textContent ?? '';"
            required
          ></textarea>
          <p class="pick-hint muted">
            Runs in the page. await is allowed. return a value to save it. &#123;&#123;name&#125;&#125; inserts a saved variable. Throw an error to fail the step.
          </p>
        </label>

        <label v-if="needsScript" class="field">
          <span>Save as variable</span>
          <input
            v-model="variableName"
            type="text"
            placeholder="email"
            spellcheck="false"
            autocomplete="off"
          />
          <p class="pick-hint muted">
            Optional. An input step can insert it with &#123;&#123;email&#125;&#125;.
          </p>
        </label>

        <label v-if="needsValue" class="field">
          <span>Value</span>
          <input
            v-model="value"
            type="text"
            placeholder="Text or {{email}}"
            :disabled="picking"
          />
          <p class="pick-hint muted">
            Use &#123;&#123;name&#125;&#125; for an environment or script variable.
          </p>
        </label>

        <label v-if="needsTimeout" class="field">
          <span>Timeout (ms)</span>
          <input
            v-model="timeoutMs"
            type="number"
            min="0"
            :max="MAX_WAIT_MS"
            step="500"
            :disabled="picking"
            required
          />
          <p class="pick-hint muted">
            Playback waits until this element appears, then continues.
          </p>
        </label>

        <label v-if="!isDivider" class="field">
          <span>Delay after step (ms)</span>
          <input
            v-model="delayMs"
            type="number"
            min="0"
            :max="MAX_STEP_DELAY_MS"
            step="100"
            :disabled="picking"
            required
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

.dialog.wide {
  width: min(100%, 460px);
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
.field select,
.field textarea {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.55rem;
  color: var(--text);
  background: #fff;
  font: inherit;
}

.field textarea {
  resize: vertical;
  min-height: 8rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.4;
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
