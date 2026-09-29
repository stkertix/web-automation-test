<script lang="ts" setup>
import { computed, provide, ref, toRef } from 'vue';
import {
  getChildFolders,
  getFolderPath,
  wouldCreateFolderCycle,
} from '../../../shared/folders';
import type { LibraryTest, TestFolder } from '../../../shared/types';
import ConfirmDialog from './ConfirmDialog.vue';
import FolderDialog, { type FolderDialogMode } from './FolderDialog.vue';
import FolderTree from './FolderTree.vue';
import Icon from './Icon.vue';
import {
  LIBRARY_DRAG_MIME,
  libraryDnDKey,
  parseLibraryDragPayload,
  targetKeyForFolder,
  type LibraryDragKind,
  type LibraryDragPayload,
} from '../libraryDnD';

const props = defineProps<{
  folders: TestFolder[];
  tests: LibraryTest[];
  activeTestId: string | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  createFolder: [name: string, parentId: string | null];
  renameFolder: [folderId: string, name: string];
  deleteFolder: [folderId: string];
  createTest: [folderId: string | null];
  openTest: [testId: string];
  deleteTest: [testId: string];
  duplicateTest: [testId: string];
  exportFolder: [folderId: string];
  exportLibrary: [];
  importLibrary: [];
  importFolder: [parentId: string | null];
  moveTest: [testId: string, folderId: string | null];
  moveFolder: [folderId: string, parentId: string | null];
}>();

const collapsed = ref<Record<string, boolean>>({});
const unfiledCollapsed = ref(false);
const dragging = ref<LibraryDragPayload | null>(null);
const dropTargetKey = ref<string | null>(null);

type PendingDelete =
  | { kind: 'folder'; folder: TestFolder }
  | { kind: 'test'; test: LibraryTest };

const confirmOpen = ref(false);
const pendingDelete = ref<PendingDelete | null>(null);

const folderDialogOpen = ref(false);
const folderDialogMode = ref<FolderDialogMode>('create');
const folderDialogParentId = ref<string | null>(null);
const folderDialogTarget = ref<TestFolder | null>(null);

const confirmTitle = computed(() => {
  if (pendingDelete.value?.kind === 'folder') return 'Delete folder';
  if (pendingDelete.value?.kind === 'test') return 'Delete test';
  return 'Confirm';
});

const confirmMessage = computed(() => {
  const pending = pendingDelete.value;
  if (!pending) return '';
  if (pending.kind === 'folder') {
    const parentLabel =
      pending.folder.parentId == null
        ? 'Unfiled'
        : getFolderPath(props.folders, pending.folder.parentId);
    return `Delete folder "${pending.folder.name}"? Subfolders and tests inside move to "${parentLabel}".`;
  }
  return `Delete test "${pending.test.name}"? This cannot be undone.`;
});

const rootFolders = computed(() => getChildFolders(props.folders, null));
const rootTests = computed(() =>
  props.tests.filter((test) => test.folderId == null),
);

const folderDialogContext = computed(() => {
  if (folderDialogMode.value === 'rename') return null;
  if (folderDialogParentId.value == null) return 'Create at top level';
  return `Inside: ${getFolderPath(props.folders, folderDialogParentId.value)}`;
});

const unfiledTargetKey = targetKeyForFolder(null);

function toggleFolder(folderId: string): void {
  collapsed.value = {
    ...collapsed.value,
    [folderId]: !collapsed.value[folderId],
  };
}

function openCreateFolder(parentId: string | null = null): void {
  folderDialogMode.value = 'create';
  folderDialogParentId.value = parentId;
  folderDialogTarget.value = null;
  folderDialogOpen.value = true;
}

function openRenameFolder(folder: TestFolder): void {
  folderDialogMode.value = 'rename';
  folderDialogParentId.value = folder.parentId ?? null;
  folderDialogTarget.value = folder;
  folderDialogOpen.value = true;
}

function closeFolderDialog(): void {
  folderDialogOpen.value = false;
  folderDialogTarget.value = null;
}

function onFolderDialogSave(name: string): void {
  if (folderDialogMode.value === 'rename' && folderDialogTarget.value) {
    emit('renameFolder', folderDialogTarget.value.id, name);
  } else {
    emit('createFolder', name, folderDialogParentId.value);
  }
  closeFolderDialog();
}

function requestDeleteFolder(folder: TestFolder): void {
  pendingDelete.value = { kind: 'folder', folder };
  confirmOpen.value = true;
}

function requestDeleteTest(test: LibraryTest): void {
  pendingDelete.value = { kind: 'test', test };
  confirmOpen.value = true;
}

function closeConfirm(): void {
  confirmOpen.value = false;
  pendingDelete.value = null;
}

function confirmDelete(): void {
  const pending = pendingDelete.value;
  if (!pending) return;
  if (pending.kind === 'folder') {
    emit('deleteFolder', pending.folder.id);
  } else {
    emit('deleteTest', pending.test.id);
  }
  closeConfirm();
}

function onMoveTest(test: LibraryTest, folderId: string | null): void {
  if (folderId === test.folderId) return;
  emit('moveTest', test.id, folderId);
}

function canDropOn(
  payload: LibraryDragPayload,
  folderId: string | null,
): boolean {
  if (payload.kind === 'test') {
    const test = props.tests.find((item) => item.id === payload.id);
    if (!test) return false;
    return (test.folderId ?? null) !== folderId;
  }
  if (folderId === payload.id) return false;
  if (wouldCreateFolderCycle(props.folders, payload.id, folderId)) {
    return false;
  }
  const folder = props.folders.find((item) => item.id === payload.id);
  if (!folder) return false;
  return (folder.parentId ?? null) !== folderId;
}

function onDragStart(
  event: DragEvent,
  kind: LibraryDragKind,
  id: string,
): void {
  if (props.disabled) {
    event.preventDefault();
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target?.closest?.('.actions')) {
    event.preventDefault();
    return;
  }
  const payload: LibraryDragPayload = { kind, id };
  const raw = JSON.stringify(payload);
  event.dataTransfer?.setData(LIBRARY_DRAG_MIME, raw);
  event.dataTransfer?.setData('text/plain', raw);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
  dragging.value = payload;
}

function onDragEnd(): void {
  dragging.value = null;
  dropTargetKey.value = null;
}

function onDragOverTarget(event: DragEvent, targetKey: string): void {
  if (props.disabled || !dragging.value) return;
  const folderId = targetKey === 'unfiled' ? null : targetKey.slice('folder:'.length);
  if (!canDropOn(dragging.value, folderId)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTargetKey.value = targetKey;
}

function onDragLeaveTarget(event: DragEvent, targetKey: string): void {
  const related = event.relatedTarget as Node | null;
  if (related && (event.currentTarget as Node).contains(related)) return;
  if (dropTargetKey.value === targetKey) {
    dropTargetKey.value = null;
  }
}

function onDropOnTarget(event: DragEvent, folderId: string | null): void {
  event.preventDefault();
  if (props.disabled) {
    onDragEnd();
    return;
  }
  const payload = parseLibraryDragPayload(event) ?? dragging.value;
  onDragEnd();
  if (!payload || !canDropOn(payload, folderId)) return;

  if (payload.kind === 'test') {
    emit('moveTest', payload.id, folderId);
    return;
  }
  emit('moveFolder', payload.id, folderId);
}

provide(libraryDnDKey, {
  disabled: toRef(props, 'disabled'),
  dragging,
  dropTargetKey,
  onDragStart,
  onDragEnd,
  onDragOverTarget,
  onDragLeaveTarget,
  onDropOnTarget,
});
</script>

<template>
  <section class="library">
    <div class="library-head">
      <h2>Library</h2>
      <div class="head-actions">
        <button
          class="btn-sm"
          type="button"
          :disabled="disabled"
          title="Export entire library"
          @click="$emit('exportLibrary')"
        >
          <Icon name="fi-rr-file-export" />
          Export
        </button>
        <button
          class="btn-sm"
          type="button"
          :disabled="disabled"
          title="Import library from JSON"
          @click="$emit('importLibrary')"
        >
          <Icon name="fi-rr-file-import" />
          Import
        </button>
        <button
          class="btn-sm"
          type="button"
          :disabled="disabled"
          title="New test in Unfiled"
          @click="$emit('createTest', null)"
        >
          <Icon name="fi-rr-add-document" />
          New test
        </button>
        <button
          class="btn-sm"
          type="button"
          :disabled="disabled"
          title="New top-level folder"
          @click="openCreateFolder(null)"
        >
          <Icon name="fi-rr-add-folder" />
          New folder
        </button>
      </div>
    </div>

    <p v-if="!disabled" class="dnd-hint">Drag tests or folders onto a folder</p>

    <div class="tree" role="tree" aria-label="Test library">
      <div class="node" role="treeitem" :aria-expanded="!unfiledCollapsed">
        <div
          class="row folder-row drop-target"
          :class="{ 'drop-over': dropTargetKey === unfiledTargetKey }"
          @dragover="onDragOverTarget($event, unfiledTargetKey)"
          @dragleave="onDragLeaveTarget($event, unfiledTargetKey)"
          @drop="onDropOnTarget($event, null)"
        >
          <button
            class="label"
            type="button"
            :disabled="disabled"
            :title="unfiledCollapsed ? 'Expand' : 'Collapse'"
            @click="unfiledCollapsed = !unfiledCollapsed"
          >
            <span class="chevron" aria-hidden="true">
              <Icon
                :name="
                  unfiledCollapsed
                    ? 'fi-rr-angle-small-right'
                    : 'fi-rr-angle-small-down'
                "
              />
            </span>
            <span class="icon" aria-hidden="true">
              <Icon
                :name="unfiledCollapsed ? 'fi-rr-folder' : 'fi-rr-folder-open'"
              />
            </span>
            <span class="name">Unfiled</span>
            <span class="count">{{ rootTests.length }}</span>
          </button>
          <div class="actions">
            <button
              class="btn-icon"
              type="button"
              :disabled="disabled"
              title="New test"
              @click="$emit('createTest', null)"
            >
              <Icon name="fi-rr-plus" />
            </button>
            <button
              class="btn-icon"
              type="button"
              :disabled="disabled"
              title="Import folder at top level"
              @click="$emit('importFolder', null)"
            >
              <Icon name="fi-rr-file-import" />
            </button>
          </div>
        </div>

        <div v-if="!unfiledCollapsed" class="children" role="group">
          <p v-if="rootTests.length === 0" class="empty">No unfiled tests</p>
          <div
            v-for="test in rootTests"
            :key="test.id"
            class="row test-row"
            :class="{
              active: test.id === activeTestId,
              dragging:
                dragging?.kind === 'test' && dragging.id === test.id,
            }"
            :draggable="!disabled"
            @dragstart="onDragStart($event, 'test', test.id)"
            @dragend="onDragEnd"
          >
            <button
              class="label test-label"
              type="button"
              :disabled="disabled"
              @click="$emit('openTest', test.id)"
            >
              <span class="leaf-spacer" aria-hidden="true"></span>
              <span class="icon" aria-hidden="true">
                <Icon name="fi-rr-document" />
              </span>
              <span class="name">{{ test.name }}</span>
              <span class="meta">{{ test.steps.length }}</span>
            </button>
            <div class="actions">
              <button
                class="btn-icon"
                type="button"
                :disabled="disabled"
                title="Duplicate"
                @click="$emit('duplicateTest', test.id)"
              >
                <Icon name="fi-rr-duplicate" />
              </button>
              <button
                class="btn-icon danger"
                type="button"
                :disabled="disabled || tests.length <= 1"
                title="Delete"
                @click="requestDeleteTest(test)"
              >
                <Icon name="fi-rr-trash" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <FolderTree
        v-for="folder in rootFolders"
        :key="folder.id"
        :folder="folder"
        :folders="folders"
        :tests="tests"
        :active-test-id="activeTestId"
        :disabled="disabled"
        :depth="0"
        :collapsed-map="collapsed"
        @toggle="toggleFolder"
        @create-test="(id) => $emit('createTest', id)"
        @open-test="(id) => $emit('openTest', id)"
        @create-folder="openCreateFolder"
        @rename-folder="openRenameFolder"
        @delete-folder="requestDeleteFolder"
        @delete-test="requestDeleteTest"
        @duplicate-test="(id) => $emit('duplicateTest', id)"
        @export-folder="(id) => $emit('exportFolder', id)"
        @import-folder="(id) => $emit('importFolder', id)"
        @move-test="onMoveTest"
      />
    </div>

    <FolderDialog
      :open="folderDialogOpen"
      :mode="folderDialogMode"
      :initial-name="folderDialogTarget?.name ?? ''"
      :context-label="folderDialogContext"
      @close="closeFolderDialog"
      @save="onFolderDialogSave"
    />

    <ConfirmDialog
      :open="confirmOpen"
      :title="confirmTitle"
      :message="confirmMessage"
      confirm-label="Delete"
      @close="closeConfirm"
      @confirm="confirmDelete"
    />
  </section>
</template>

<style scoped>
.library {
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 8px;
  padding: 0.55rem 0.55rem 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0;
}

.library-head,
.head-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.library-head {
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 0 0.15rem 0.2rem;
  border-bottom: 1px solid #eef2f6;
}

.library-head h2 {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.dnd-hint {
  margin: 0;
  padding: 0 0.15rem;
  color: var(--muted);
  font-size: 0.68rem;
}

.tree {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.node {
  min-width: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  min-height: 1.7rem;
  border-radius: 5px;
  padding-right: 0.2rem;
}

.row:hover {
  background: #f3f5f8;
}

.row.active {
  background: var(--active-bg);
}

.row.active:hover {
  background: #e4f8ec;
}

.row.dragging {
  opacity: 0.45;
}

.row.drop-over {
  background: #e8f1ff;
  outline: 1px dashed #5b8def;
  outline-offset: -1px;
}

.test-row[draggable='true'] {
  cursor: grab;
}

.test-row[draggable='true']:active {
  cursor: grabbing;
}

.label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none;
  padding: 0.15rem 0.2rem;
  min-height: 1.7rem;
  height: auto;
  text-align: left;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
  justify-content: flex-start;
  white-space: nowrap;
}

.label:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.chevron,
.icon,
.leaf-spacer {
  flex: 0 0 auto;
  width: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 0.78rem;
}

.folder-row .icon {
  color: #c9852a;
}

.test-row .icon {
  color: var(--muted);
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8rem;
  font-weight: 600;
}

.test-label .name {
  font-weight: 500;
}

.count,
.meta {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.actions {
  display: none;
  align-items: center;
  gap: 0.1rem;
  flex: 0 0 auto;
}

.row:hover .actions,
.row:focus-within .actions {
  display: inline-flex;
}

.actions :deep(button.btn-icon) {
  min-height: 1.45rem;
  min-width: 1.45rem;
  font-size: 0.75rem;
  border-color: transparent;
  background: transparent;
}

.actions :deep(button.btn-icon:hover:not(:disabled)) {
  background: #fff;
  border-color: var(--border);
}

.empty {
  margin: 0;
  padding: 0.15rem 0.35rem;
  color: var(--muted);
  font-size: 0.72rem;
  font-style: italic;
}

.children {
  margin-left: 0.55rem;
  padding-left: 0.35rem;
  border-left: 1px solid #e4e8ef;
}
</style>
