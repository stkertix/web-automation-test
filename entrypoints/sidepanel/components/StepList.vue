<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  normalizeDelayMs,
  normalizeStepName,
  normalizeWaitMs,
  type StepType,
  type TestStep,
} from '../../../shared/types';
import ConfirmDialog from './ConfirmDialog.vue';
import Icon from './Icon.vue';
import StepDialog, {
  type StepDialogMode,
  type StepDialogResult,
} from './StepDialog.vue';

const props = defineProps<{
  steps: TestStep[];
  currentStepIndex: number | null;
  failedStepId: string | null;
  editable: boolean;
  testName: string;
}>();

const emit = defineEmits<{
  updateStep: [
    stepId: string,
    patch: Partial<
      Pick<
        TestStep,
        'name' | 'type' | 'selectors' | 'value' | 'url' | 'delayMs' | 'variableName'
      >
    >,
  ];
  deleteStep: [stepId: string];
  reorderSteps: [fromIndex: number, toIndex: number];
  addStep: [
    payload: {
      stepType: StepType;
      name?: string | null;
      selectors?: string[];
      value?: string | null;
      url?: string | null;
      delayMs?: number;
      variableName?: string | null;
      index?: number | null;
    },
  ];
  renameTest: [name: string];
  playStep: [stepId: string];
}>();

const dialogOpen = ref(false);
const dialogMode = ref<StepDialogMode>('add');
const editingStep = ref<TestStep | null>(null);
const insertIndex = ref<number | null>(null);
const dragFromIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const confirmOpen = ref(false);
const pendingDeleteStep = ref<TestStep | null>(null);
const pendingDeleteIndex = ref<number | null>(null);
const menu = ref<{
  stepId: string;
  top: number;
  left: number;
} | null>(null);

const everyStepNamed = computed(() => {
  const details = props.steps.filter((step) => step.type !== 'divider');
  return details.length > 0 && details.every((step) => stepName(step) != null);
});

const tableColumnCount = computed(() => {
  let count = 2;
  count += everyStepNamed.value ? 1 : 3;
  if (props.editable) count += 2;
  return count;
});

const confirmMessage = computed(() => {
  const step = pendingDeleteStep.value;
  const index = pendingDeleteIndex.value;
  if (!step || index == null) return 'Delete this step?';
  if (step.type === 'divider') {
    const named = stepName(step);
    return named
      ? `Delete divider ${index + 1} (${named})?`
      : `Delete divider ${index + 1}?`;
  }
  const named = stepName(step);
  if (named) return `Delete step ${index + 1} (${named})?`;
  const label = targetValue(step) || step.type;
  return `Delete step ${index + 1} (${typeLabel(step)}: ${label})?`;
});

function stepName(step: TestStep): string | null {
  return normalizeStepName(step.name);
}

function targetValue(step: TestStep): string {
  if (step.type === 'navigate') return step.url ?? '';
  if (step.type === 'script') {
    return (step.value ?? '').replace(/\s+/g, ' ').trim();
  }
  return step.selectors[0] ?? '';
}

function delayLabel(step: TestStep): string {
  return `${normalizeDelayMs(step.delayMs)} ms`;
}

function valueLabel(step: TestStep): string {
  if (step.type === 'input' || step.type === 'change') {
    return step.value ?? '—';
  }
  if (step.type === 'wait') {
    return `${normalizeWaitMs(step.value)} ms`;
  }
  if (step.type === 'script' && step.variableName) {
    return `{{${step.variableName}}}`;
  }
  return '—';
}

function typeLabel(step: TestStep): string {
  return step.type === 'wait' ? 'wait element' : step.type;
}

function closeMenu(): void {
  menu.value = null;
}

function menuStep(): { step: TestStep; index: number } | null {
  const open = menu.value;
  if (!open) return null;
  const index = props.steps.findIndex((step) => step.id === open.stepId);
  const step = props.steps[index];
  if (!step || index < 0) return null;
  return { step, index };
}

function toggleMenu(stepId: string, event: MouseEvent): void {
  if (menu.value?.stepId === stepId) {
    closeMenu();
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const width = 196;
  const height = 188;
  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 4);
  }
  let left = rect.right - width;
  if (left < 8) left = 8;
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - width - 8);
  }
  menu.value = { stepId, top, left };
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    closeMenu();
    return;
  }
  if (
    target.closest('[data-step-menu]') ||
    target.closest('[data-step-menu-trigger]')
  ) {
    return;
  }
  closeMenu();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu();
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeydown);
  document.addEventListener('scroll', closeMenu, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeydown);
  document.removeEventListener('scroll', closeMenu, true);
});

function openAdd(index: number | null = null): void {
  closeMenu();
  dialogMode.value = 'add';
  editingStep.value = null;
  insertIndex.value = index;
  dialogOpen.value = true;
}

function openEdit(step: TestStep): void {
  closeMenu();
  dialogMode.value = 'edit';
  editingStep.value = step;
  insertIndex.value = null;
  dialogOpen.value = true;
}

function duplicateStep(): void {
  const current = menuStep();
  closeMenu();
  if (!current) return;
  emit('addStep', {
    stepType: current.step.type,
    name: current.step.name ?? null,
    selectors: [...current.step.selectors],
    value: current.step.value,
    url: current.step.url,
    delayMs: current.step.delayMs,
    variableName: current.step.variableName ?? null,
    index: current.index + 1,
  });
}

function editFromMenu(): void {
  const current = menuStep();
  if (!current) return;
  openEdit(current.step);
}

function addAfterFromMenu(): void {
  const current = menuStep();
  if (!current) return;
  const nextIndex = current.index + 1;
  openAdd(nextIndex >= props.steps.length ? null : nextIndex);
}

function deleteFromMenu(): void {
  const current = menuStep();
  if (!current) return;
  requestDeleteStep(current.step, current.index);
}

function closeDialog(): void {
  dialogOpen.value = false;
  editingStep.value = null;
}

function requestDeleteStep(step: TestStep, index: number): void {
  closeMenu();
  pendingDeleteStep.value = step;
  pendingDeleteIndex.value = index;
  confirmOpen.value = true;
}

function closeConfirm(): void {
  confirmOpen.value = false;
  pendingDeleteStep.value = null;
  pendingDeleteIndex.value = null;
}

function confirmDeleteStep(): void {
  const step = pendingDeleteStep.value;
  if (step) {
    emit('deleteStep', step.id);
  }
  closeConfirm();
}

function onDialogSave(result: StepDialogResult): void {
  if (dialogMode.value === 'edit' && result.stepId) {
    const patch: Partial<
      Pick<
        TestStep,
        'name' | 'type' | 'selectors' | 'value' | 'url' | 'delayMs' | 'variableName'
      >
    > = {
      name: result.name,
      type: result.stepType,
      selectors: result.selectors,
      value: result.value,
      url: result.url,
      delayMs: result.delayMs,
      variableName: result.variableName,
    };
    emit('updateStep', result.stepId, patch);
  } else {
    emit('addStep', {
      stepType: result.stepType,
      name: result.name,
      selectors: result.selectors,
      value: result.value,
      url: result.url,
      delayMs: result.delayMs,
      variableName: result.variableName,
      index: result.index,
    });
  }
  closeDialog();
}

function onDragStart(event: DragEvent, index: number): void {
  dragFromIndex.value = index;
  dragOverIndex.value = index;
  event.dataTransfer?.setData('text/plain', String(index));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function onDragOver(event: DragEvent, index: number): void {
  if (dragFromIndex.value == null) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  dragOverIndex.value = index;
}

function onDrop(event: DragEvent, toIndex: number): void {
  event.preventDefault();
  const fromIndex = dragFromIndex.value;
  dragFromIndex.value = null;
  dragOverIndex.value = null;
  if (fromIndex == null || fromIndex === toIndex) return;
  emit('reorderSteps', fromIndex, toIndex);
}

function onDragEnd(): void {
  dragFromIndex.value = null;
  dragOverIndex.value = null;
}
</script>

<template>
  <section class="steps">
    <label class="test-title">
      <span class="test-title-label">Active test</span>
      <input
        class="test-title-input"
        type="text"
        :value="testName"
        :disabled="!editable"
        aria-label="Test name"
        placeholder="Untitled test"
        @change="$emit('renameTest', ($event.target as HTMLInputElement).value)"
      />
    </label>

    <div class="steps-head">
      <h2>Steps</h2>
      <div class="head-actions">
        <span v-if="editable && steps.length > 1" class="hint">Drag handle to reorder</span>
        <button
          v-if="editable"
          class="primary btn-sm"
          type="button"
          @click="openAdd(null)"
        >
          <Icon name="fi-rr-plus" />
          Add step
        </button>
      </div>
    </div>

    <p v-if="steps.length === 0" class="empty">
      No steps yet. Click Record, or use Add step.
    </p>

    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th v-if="editable" class="col-drag"></th>
            <th class="col-num">#</th>
            <th v-if="everyStepNamed" class="col-name">Name</th>
            <template v-else>
              <th class="col-type">Type</th>
              <th class="col-target">Target</th>
              <th class="col-value">Value</th>
            </template>
            <th class="col-delay">Delay</th>
            <th v-if="editable" class="col-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(step, index) in steps"
            :key="step.id"
            :class="{
              active: currentStepIndex === index,
              failed: failedStepId === step.id,
              divider: step.type === 'divider',
              dragging: dragFromIndex === index,
              'drag-over': dragOverIndex === index && dragFromIndex !== index,
            }"
            @dragover="editable && onDragOver($event, index)"
            @drop="editable && onDrop($event, index)"
          >
            <td
              v-if="step.type === 'divider'"
              class="divider-cell"
              :colspan="tableColumnCount"
            >
              <div class="divider-inner">
                <button
                  v-if="editable"
                  class="drag-handle btn-icon"
                  type="button"
                  draggable="true"
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  @dragstart="onDragStart($event, index)"
                  @dragend="onDragEnd"
                >
                  <Icon name="fi-rr-grip-dots-vertical" />
                </button>
                <div class="divider-line">
                  <span v-if="stepName(step)">{{ stepName(step) }}</span>
                </div>
                <button
                  v-if="editable"
                  class="btn-icon"
                  type="button"
                  data-step-menu-trigger
                  title="Step actions"
                  aria-label="Step actions"
                  aria-haspopup="menu"
                  :aria-expanded="menu?.stepId === step.id"
                  @click.stop="toggleMenu(step.id, $event)"
                >
                  <Icon name="fi-rr-menu-dots" />
                </button>
              </div>
            </td>
            <template v-else>
            <td v-if="editable" class="col-drag">
              <button
                class="drag-handle btn-icon"
                type="button"
                draggable="true"
                title="Drag to reorder"
                aria-label="Drag to reorder"
                @dragstart="onDragStart($event, index)"
                @dragend="onDragEnd"
              >
                <Icon name="fi-rr-grip-dots-vertical" />
              </button>
            </td>
            <td class="col-num">{{ index + 1 }}</td>
            <td
              v-if="stepName(step)"
              class="col-name"
              :colspan="everyStepNamed ? 1 : 3"
            >
              <span class="cell-text name-text" :title="stepName(step) ?? ''">
                {{ stepName(step) }}
              </span>
            </td>
            <template v-else>
              <td class="col-type">
                <span class="type-label">{{ typeLabel(step) }}</span>
              </td>
              <td class="col-target">
                <span class="cell-text" :title="targetValue(step)">
                  {{ targetValue(step) || '—' }}
                </span>
              </td>
              <td class="col-value">
                <span class="cell-text" :title="valueLabel(step)">
                  {{ valueLabel(step) }}
                </span>
              </td>
            </template>
            <td class="col-delay">{{ delayLabel(step) }}</td>
            <td v-if="editable" class="col-actions">
              <button
                class="btn-icon"
                type="button"
                title="Run this step"
                @click="emit('playStep', step.id)"
              >
                <Icon name="fi-rr-play" />
              </button>
              <button
                class="btn-icon"
                type="button"
                data-step-menu-trigger
                title="Step actions"
                aria-label="Step actions"
                aria-haspopup="menu"
                :aria-expanded="menu?.stepId === step.id"
                @click.stop="toggleMenu(step.id, $event)"
              >
                <Icon name="fi-rr-menu-dots" />
              </button>
            </td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <Teleport to="body">
      <div
        v-if="menu"
        class="step-menu"
        data-step-menu
        role="menu"
        :style="{ top: `${menu.top}px`, left: `${menu.left}px` }"
        @click.stop
      >
        <button type="button" role="menuitem" @click="editFromMenu">
          <Icon name="fi-rr-pencil" />
          Edit
        </button>
        <button type="button" role="menuitem" @click="duplicateStep">
          <Icon name="fi-rr-copy" />
          Duplicate
        </button>
        <button type="button" role="menuitem" @click="addAfterFromMenu">
          <Icon name="fi-rr-plus" />
          Add step after
        </button>
        <div class="menu-sep" role="separator"></div>
        <button
          class="danger"
          type="button"
          role="menuitem"
          @click="deleteFromMenu"
        >
          <Icon name="fi-rr-trash" />
          Delete
        </button>
      </div>
    </Teleport>

    <StepDialog
      :open="dialogOpen"
      :mode="dialogMode"
      :step-count="steps.length"
      :initial-index="insertIndex"
      :step="editingStep"
      @close="closeDialog"
      @save="onDialogSave"
    />

    <ConfirmDialog
      :open="confirmOpen"
      title="Delete step"
      :message="confirmMessage"
      confirm-label="Delete"
      @close="closeConfirm"
      @confirm="confirmDeleteStep"
    />
  </section>
</template>

<style scoped>
.test-title {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.55rem;
}

.test-title-label {
  font-size: 0.72rem;
  color: var(--muted);
}

.test-title-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 0.45rem 0.6rem;
  background: #fff;
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--text);
}

.test-title-input:focus {
  outline: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
  outline-offset: 1px;
  border-color: var(--accent);
}

.test-title-input:disabled {
  opacity: 0.7;
}

.steps-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.hint {
  color: var(--muted);
  font-size: 0.72rem;
}

.steps h2 {
  margin: 0;
  font-size: 0.9rem;
}

.empty {
  margin: 0 0 0.75rem;
  color: var(--muted);
  font-size: 0.85rem;
}

.table-wrap {
  overflow-x: auto;
  margin-bottom: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
}

th,
td {
  padding: 0.4rem 0.45rem;
  border-bottom: 1px solid #eef2f6;
  text-align: left;
  vertical-align: middle;
}

thead th {
  background: #f3f5f8;
  color: var(--muted);
  font-weight: 650;
  white-space: nowrap;
}

tbody tr:last-child td {
  border-bottom: 0;
}

tbody tr.active {
  background: var(--active-bg);
}

tbody tr.failed {
  background: var(--failed-bg);
}

tbody tr.dragging {
  opacity: 0.55;
}

tbody tr.drag-over td {
  box-shadow: inset 0 2px 0 0 var(--accent);
}

tbody tr.divider td {
  background: #f8fafc;
}

.divider-inner {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.divider-line {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex: 1;
  min-width: 0;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.divider-line::before,
.divider-line::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--border);
}

.divider-line span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}

.col-drag {
  width: 2rem;
}

.col-num {
  width: 2rem;
  text-align: center;
  font-weight: 600;
  color: var(--muted);
}

.col-type {
  width: 7rem;
}

.col-name {
  min-width: 8rem;
}

.name-text {
  max-width: none;
  font-weight: 650;
}

.col-actions {
  width: 4.6rem;
  white-space: nowrap;
}

.step-menu {
  position: fixed;
  z-index: 40;
  width: 12.25rem;
  padding: 0.3rem;
  background: var(--panel, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(28, 35, 48, 0.16);
  display: flex;
  flex-direction: column;
}

.step-menu button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.45rem;
  width: 100%;
  min-height: 2rem;
  border: 0;
  background: transparent;
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  color: var(--text, #1c2330);
  text-align: left;
}

.step-menu button:hover {
  background: #f3f5f8;
}

.step-menu button.danger {
  color: var(--danger, #d92d20);
}

.menu-sep {
  height: 1px;
  margin: 0.25rem 0.2rem;
  background: var(--border, #e5e7eb);
}

.col-target,
.col-value {
  min-width: 4.5rem;
}

.col-delay {
  width: 4.5rem;
  white-space: nowrap;
  color: var(--muted);
}

.type-label {
  text-transform: uppercase;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.cell-text {
  display: block;
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drag-handle {
  cursor: grab;
  border: 1px solid transparent;
  background: #eef2f6;
  color: var(--muted);
  border-radius: 5px;
  padding: 0.2rem 0.35rem;
  line-height: 1;
  user-select: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle:hover {
  border-color: var(--border);
  color: var(--text);
}
</style>
