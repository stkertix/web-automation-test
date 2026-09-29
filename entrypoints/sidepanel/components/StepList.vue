<script lang="ts" setup>
import { computed, ref } from 'vue';
import type { StepType, TestStep } from '../../../shared/types';
import ConfirmDialog from './ConfirmDialog.vue';
import Icon from './Icon.vue';
import StepDialog, {
  type StepDialogMode,
  type StepDialogResult,
} from './StepDialog.vue';

defineProps<{
  steps: TestStep[];
  currentStepIndex: number | null;
  failedStepId: string | null;
  editable: boolean;
  testName: string;
}>();

const emit = defineEmits<{
  updateStep: [
    stepId: string,
    patch: Partial<Pick<TestStep, 'type' | 'selectors' | 'value' | 'url'>>,
  ];
  deleteStep: [stepId: string];
  reorderSteps: [fromIndex: number, toIndex: number];
  addStep: [
    payload: {
      stepType: StepType;
      selectors?: string[];
      value?: string | null;
      url?: string | null;
      index?: number | null;
    },
  ];
  renameTest: [name: string];
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

const confirmMessage = computed(() => {
  const step = pendingDeleteStep.value;
  const index = pendingDeleteIndex.value;
  if (!step || index == null) return 'Delete this step?';
  const label =
    step.type === 'navigate'
      ? step.url || 'navigate'
      : step.selectors[0] || step.type;
  return `Delete step ${index + 1} (${step.type}: ${label})?`;
});

function targetValue(step: TestStep): string {
  return step.type === 'navigate' ? (step.url ?? '') : (step.selectors[0] ?? '');
}

function openAdd(index: number | null = null): void {
  dialogMode.value = 'add';
  editingStep.value = null;
  insertIndex.value = index;
  dialogOpen.value = true;
}

function openEdit(step: TestStep): void {
  dialogMode.value = 'edit';
  editingStep.value = step;
  insertIndex.value = null;
  dialogOpen.value = true;
}

function closeDialog(): void {
  dialogOpen.value = false;
  editingStep.value = null;
}

function requestDeleteStep(step: TestStep, index: number): void {
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
      Pick<TestStep, 'type' | 'selectors' | 'value' | 'url'>
    > = {
      type: result.stepType,
      selectors: result.selectors,
      value: result.value,
      url: result.url,
    };
    emit('updateStep', result.stepId, patch);
  } else {
    emit('addStep', {
      stepType: result.stepType,
      selectors: result.selectors,
      value: result.value,
      url: result.url,
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
            <th class="col-type">Type</th>
            <th class="col-target">Target</th>
            <th class="col-value">Value</th>
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
              dragging: dragFromIndex === index,
              'drag-over': dragOverIndex === index && dragFromIndex !== index,
            }"
            @dragover="editable && onDragOver($event, index)"
            @drop="editable && onDrop($event, index)"
          >
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
            <td class="col-type">
              <span class="type-label">{{ step.type }}</span>
            </td>
            <td class="col-target">
              <span class="cell-text" :title="targetValue(step)">
                {{ targetValue(step) || '—' }}
              </span>
            </td>
            <td class="col-value">
              <span class="cell-text" :title="step.value ?? ''">
                {{
                  step.type === 'input' || step.type === 'change'
                    ? (step.value ?? '—')
                    : '—'
                }}
              </span>
            </td>
            <td v-if="editable" class="col-actions">
              <button class="btn-icon" type="button" title="Edit step" @click="openEdit(step)">
                <Icon name="fi-rr-pencil" />
              </button>
              <button
                class="btn-icon"
                type="button"
                title="Add step after this one"
                @click="openAdd(index + 1 >= steps.length ? null : index + 1)"
              >
                <Icon name="fi-rr-plus" />
              </button>
              <button
                class="btn-icon danger"
                type="button"
                title="Delete step"
                @click="requestDeleteStep(step, index)"
              >
                <Icon name="fi-rr-trash" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

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
  width: 5.5rem;
}

.col-actions {
  width: 6.5rem;
  white-space: nowrap;
}

.col-target,
.col-value {
  min-width: 4.5rem;
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
