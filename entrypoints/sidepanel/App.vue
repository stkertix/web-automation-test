<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { MessageType, type ExtensionMessage } from '../../shared/messages';
import {
  downloadFolderExportJson,
  downloadLibraryExportJson,
  downloadTestCaseJson,
  parseFolderExportJson,
  parseLibraryExportJson,
  parseTestCaseJson,
  syncActiveTest,
} from '../../shared/storage';
import {
  buildFolderExport,
  buildLibraryExport,
  materializeFolderImport,
} from '../../shared/folders';
import {
  createEmptyLibrary,
  createEmptyTestCase,
  type ExtensionState,
  type StepType,
  type TestLibrary,
  type TestStep,
} from '../../shared/types';
import ConfirmDialog from './components/ConfirmDialog.vue';
import LibraryPanel from './components/LibraryPanel.vue';
import StatusBar from './components/StatusBar.vue';
import StepList from './components/StepList.vue';
import Toolbar from './components/Toolbar.vue';

const state = ref<ExtensionState>({
  mode: 'idle',
  status: 'Idle',
  testCase: createEmptyTestCase(),
  activeTestId: null,
  library: createEmptyLibrary(),
  activeTabId: null,
  currentStepIndex: null,
  lastError: null,
  failedStepId: null,
});

const busy = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const libraryFileInput = ref<HTMLInputElement | null>(null);
const folderFileInput = ref<HTMLInputElement | null>(null);
const folderImportParentId = ref<string | null>(null);
const pendingLibraryImport = ref<TestLibrary | null>(null);
const importLibraryConfirmOpen = ref(false);

const canRecord = computed(
  () => state.value.mode === 'idle' || state.value.mode === 'record',
);
const isRecording = computed(() => state.value.mode === 'record');
const isPlaying = computed(() => state.value.mode === 'play');
const isPicking = computed(() => state.value.mode === 'pick');
const libraryLocked = computed(
  () =>
    busy.value || isRecording.value || isPlaying.value || isPicking.value,
);

async function send<T = { ok: boolean; error?: string }>(
  message: ExtensionMessage,
): Promise<T> {
  return (await browser.runtime.sendMessage(message)) as T;
}

async function refreshState(): Promise<void> {
  const next = await send<ExtensionState>({ type: MessageType.GET_STATE });
  if (next?.testCase && next.library) {
    state.value = next;
  }
}

async function withBusy(action: () => Promise<void>): Promise<void> {
  busy.value = true;
  try {
    await action();
  } finally {
    busy.value = false;
  }
}

function applyError(res: { ok: boolean; error?: string }): void {
  if (!res.ok && res.error) {
    state.value = {
      ...state.value,
      status: 'Failed',
      lastError: res.error,
    };
  }
}

async function onRecord(): Promise<void> {
  await withBusy(async () => {
    const res = await send({ type: MessageType.START_RECORDING });
    applyError(res);
    await refreshState();
  });
}

async function onStop(): Promise<void> {
  await withBusy(async () => {
    if (isPlaying.value) {
      await send({ type: MessageType.STOP_PLAYBACK });
    } else {
      await send({ type: MessageType.STOP_RECORDING });
    }
    await refreshState();
  });
}

async function onPlay(): Promise<void> {
  await withBusy(async () => {
    const res = await send({ type: MessageType.START_PLAYBACK });
    applyError(res);
    await refreshState();
  });
}

async function onClear(): Promise<void> {
  await withBusy(async () => {
    await send({ type: MessageType.CLEAR_STEPS });
    await refreshState();
  });
}

async function onNameChange(name: string): Promise<void> {
  await send({ type: MessageType.UPDATE_TEST_NAME, name });
  await refreshState();
}

async function onUpdateStep(
  stepId: string,
  patch: Partial<Pick<TestStep, 'type' | 'selectors' | 'value' | 'url'>>,
): Promise<void> {
  await send({ type: MessageType.UPDATE_STEP, stepId, patch });
  await refreshState();
}

async function onDeleteStep(stepId: string): Promise<void> {
  await send({ type: MessageType.DELETE_STEP, stepId });
  await refreshState();
}

async function onAddStep(payload: {
  stepType: StepType;
  selectors?: string[];
  value?: string | null;
  url?: string | null;
  index?: number | null;
}): Promise<void> {
  await withBusy(async () => {
    const res = await send({
      type: MessageType.ADD_STEP,
      stepType: payload.stepType,
      selectors: payload.selectors,
      value: payload.value,
      url: payload.url,
      index: payload.index,
    });
    applyError(res);
    await refreshState();
  });
}

async function onReorderSteps(
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  await withBusy(async () => {
    const res = await send({
      type: MessageType.REORDER_STEPS,
      fromIndex,
      toIndex,
    });
    applyError(res);
    await refreshState();
  });
}

async function onCreateFolder(
  name: string,
  parentId: string | null = null,
): Promise<void> {
  await withBusy(async () => {
    const res = await send({
      type: MessageType.CREATE_FOLDER,
      name,
      parentId,
    });
    applyError(res);
    await refreshState();
  });
}

async function onRenameFolder(folderId: string, name: string): Promise<void> {
  await withBusy(async () => {
    const res = await send({
      type: MessageType.RENAME_FOLDER,
      folderId,
      name,
    });
    applyError(res);
    await refreshState();
  });
}

async function onDeleteFolder(folderId: string): Promise<void> {
  await withBusy(async () => {
    const res = await send({ type: MessageType.DELETE_FOLDER, folderId });
    applyError(res);
    await refreshState();
  });
}

async function onCreateTest(folderId: string | null): Promise<void> {
  await withBusy(async () => {
    const res = await send({ type: MessageType.CREATE_TEST, folderId });
    applyError(res);
    await refreshState();
  });
}

async function onOpenTest(testId: string): Promise<void> {
  await withBusy(async () => {
    const res = await send({ type: MessageType.OPEN_TEST, testId });
    applyError(res);
    await refreshState();
  });
}

async function onDeleteTest(testId: string): Promise<void> {
  await withBusy(async () => {
    const res = await send({ type: MessageType.DELETE_TEST, testId });
    applyError(res);
    await refreshState();
  });
}

async function onDuplicateTest(testId: string): Promise<void> {
  await withBusy(async () => {
    const res = await send({ type: MessageType.DUPLICATE_TEST, testId });
    applyError(res);
    await refreshState();
  });
}

function onExportFolder(folderId: string): void {
  const payload = buildFolderExport(
    state.value.library.folders,
    state.value.library.tests,
    folderId,
  );
  if (!payload) {
    state.value = {
      ...state.value,
      status: 'Failed',
      lastError: 'Folder not found.',
    };
    return;
  }
  downloadFolderExportJson(payload);
}

function onExportLibrary(): void {
  const library = syncActiveTest(state.value.library, state.value.testCase);
  downloadLibraryExportJson(buildLibraryExport(library));
}

function onImportLibraryClick(): void {
  libraryFileInput.value?.click();
}

async function onImportLibraryFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    pendingLibraryImport.value = parseLibraryExportJson(text);
    importLibraryConfirmOpen.value = true;
  } catch (error) {
    state.value = {
      ...state.value,
      status: 'Failed',
      lastError:
        error instanceof Error
          ? error.message
          : 'Failed to import library JSON.',
    };
  } finally {
    input.value = '';
  }
}

function closeImportLibraryConfirm(): void {
  importLibraryConfirmOpen.value = false;
  pendingLibraryImport.value = null;
}

async function confirmImportLibrary(): Promise<void> {
  const library = pendingLibraryImport.value;
  closeImportLibraryConfirm();
  if (!library) return;

  await withBusy(async () => {
    const res = await send({
      type: MessageType.IMPORT_LIBRARY,
      library,
    });
    applyError(res);
    await refreshState();
  });
}

function onImportFolderClick(parentId: string | null): void {
  folderImportParentId.value = parentId;
  folderFileInput.value?.click();
}

async function onImportFolderFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  const parentId = folderImportParentId.value;
  if (!file) return;

  try {
    const text = await file.text();
    const payload = parseFolderExportJson(text);
    const { folders, tests } = materializeFolderImport(
      payload.folder,
      parentId,
    );
    await withBusy(async () => {
      const res = await send({
        type: MessageType.IMPORT_FOLDER,
        parentId,
        folders,
        tests,
      });
      applyError(res);
      await refreshState();
    });
  } catch (error) {
    state.value = {
      ...state.value,
      status: 'Failed',
      lastError:
        error instanceof Error
          ? error.message
          : 'Failed to import folder JSON.',
    };
  } finally {
    input.value = '';
    folderImportParentId.value = null;
  }
}

async function onMoveTest(
  testId: string,
  folderId: string | null,
): Promise<void> {
  await withBusy(async () => {
    const res = await send({ type: MessageType.MOVE_TEST, testId, folderId });
    applyError(res);
    await refreshState();
  });
}

async function onMoveFolder(
  folderId: string,
  parentId: string | null,
): Promise<void> {
  await withBusy(async () => {
    const res = await send({
      type: MessageType.MOVE_FOLDER,
      folderId,
      parentId,
    });
    applyError(res);
    await refreshState();
  });
}

function onExport(): void {
  downloadTestCaseJson(state.value.testCase);
}

function onImportClick(): void {
  fileInput.value?.click();
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const testCase = parseTestCaseJson(text);
    await send({ type: MessageType.LOAD_TEST, testCase, folderId: null });
    await refreshState();
  } catch (error) {
    state.value = {
      ...state.value,
      status: 'Failed',
      lastError:
        error instanceof Error ? error.message : 'Failed to import JSON.',
    };
  } finally {
    input.value = '';
  }
}

function onMessage(message: ExtensionMessage): void {
  if (message.type === MessageType.STATE_CHANGED) {
    state.value = message.state;
  }
}

onMounted(() => {
  void refreshState();
  browser.runtime.onMessage.addListener(onMessage);
});

onUnmounted(() => {
  browser.runtime.onMessage.removeListener(onMessage);
});
</script>

<template>
  <div class="app">
    <header class="header">
      <p class="product">Web Automation Test</p>
    </header>

    <LibraryPanel
      :folders="state.library.folders"
      :tests="state.library.tests"
      :active-test-id="state.activeTestId"
      :disabled="libraryLocked"
      @create-folder="onCreateFolder"
      @rename-folder="onRenameFolder"
      @delete-folder="onDeleteFolder"
      @create-test="onCreateTest"
      @open-test="onOpenTest"
      @delete-test="onDeleteTest"
      @duplicate-test="onDuplicateTest"
      @export-folder="onExportFolder"
      @export-library="onExportLibrary"
      @import-library="onImportLibraryClick"
      @import-folder="onImportFolderClick"
      @move-test="onMoveTest"
      @move-folder="onMoveFolder"
    />

    <section class="workspace">
      <Toolbar
        :disabled="busy || isPicking"
        :is-recording="isRecording"
        :is-playing="isPlaying"
        :can-record="canRecord"
        :has-steps="state.testCase.steps.length > 0"
        @record="onRecord"
        @stop="onStop"
        @play="onPlay"
        @clear="onClear"
        @export="onExport"
        @import="onImportClick"
      />

      <StatusBar
        :status="state.status"
        :error="state.lastError"
        :step-count="state.testCase.steps.length"
        :current-step-index="state.currentStepIndex"
      />

      <StepList
        :steps="state.testCase.steps"
        :test-name="state.testCase.name"
        :current-step-index="state.currentStepIndex"
        :failed-step-id="state.failedStepId"
        :editable="!isRecording && !isPlaying && !isPicking"
        @update-step="onUpdateStep"
        @delete-step="onDeleteStep"
        @add-step="onAddStep"
        @reorder-steps="onReorderSteps"
        @rename-test="onNameChange"
      />
    </section>

    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      hidden
      @change="onImportFile"
    />

    <input
      ref="libraryFileInput"
      type="file"
      accept="application/json,.json,.library.json"
      hidden
      @change="onImportLibraryFile"
    />

    <input
      ref="folderFileInput"
      type="file"
      accept="application/json,.json,.folder.json"
      hidden
      @change="onImportFolderFile"
    />

    <ConfirmDialog
      :open="importLibraryConfirmOpen"
      title="Import library"
      message="Replace the current library with the imported file? Existing folders and tests will be overwritten."
      confirm-label="Replace"
      :danger="false"
      @close="closeImportLibraryConfirm"
      @confirm="confirmImportLibrary"
    />

    <p class="attribution">
      Interface icons:
      <a
        href="https://www.flaticon.com/uicons"
        target="_blank"
        rel="noopener noreferrer"
      >Uicons by Flaticon</a>
    </p>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.product {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
}

.workspace {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 10px;
  padding: 0.7rem;
}

.attribution {
  margin-top: auto;
  padding-top: 0.15rem;
}
</style>
