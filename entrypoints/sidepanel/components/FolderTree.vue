<script lang="ts" setup>
import { computed, inject } from 'vue';
import { getChildFolders } from '../../../shared/folders';
import type { LibraryTest, TestFolder } from '../../../shared/types';
import Icon from './Icon.vue';
import { libraryDnDKey, targetKeyForFolder } from '../libraryDnD';

defineOptions({ name: 'FolderTree' });

const props = defineProps<{
  folder: TestFolder;
  folders: TestFolder[];
  tests: LibraryTest[];
  activeTestId: string | null;
  disabled: boolean;
  depth: number;
  collapsedMap: Record<string, boolean>;
}>();

const emit = defineEmits<{
  toggle: [folderId: string];
  createTest: [folderId: string];
  openTest: [testId: string];
  createFolder: [parentId: string];
  renameFolder: [folder: TestFolder];
  deleteFolder: [folder: TestFolder];
  deleteTest: [test: LibraryTest];
  duplicateTest: [testId: string];
  exportFolder: [folderId: string];
  importFolder: [folderId: string];
  moveTest: [test: LibraryTest, folderId: string | null];
}>();

const dnd = inject(libraryDnDKey);
if (!dnd) {
  throw new Error('FolderTree requires LibraryPanel DnD context');
}

const collapsed = computed(() => Boolean(props.collapsedMap[props.folder.id]));
const childFolders = computed(() =>
  getChildFolders(props.folders, props.folder.id),
);
const folderTests = computed(() =>
  props.tests.filter((test) => test.folderId === props.folder.id),
);
const isEmpty = computed(
  () => folderTests.value.length === 0 && childFolders.value.length === 0,
);
const folderTargetKey = computed(() => targetKeyForFolder(props.folder.id));
const isDropOver = computed(
  () => dnd.dropTargetKey.value === folderTargetKey.value,
);
const isDraggingFolder = computed(
  () =>
    dnd.dragging.value?.kind === 'folder' &&
    dnd.dragging.value.id === props.folder.id,
);
</script>

<template>
  <div class="node" role="treeitem" :aria-expanded="!collapsed">
    <div
      class="row folder-row drop-target"
      :class="{
        'drop-over': isDropOver,
        dragging: isDraggingFolder,
      }"
      :draggable="!disabled"
      @dragstart="dnd.onDragStart($event, 'folder', folder.id)"
      @dragend="dnd.onDragEnd"
      @dragover="dnd.onDragOverTarget($event, folderTargetKey)"
      @dragleave="dnd.onDragLeaveTarget($event, folderTargetKey)"
      @drop="dnd.onDropOnTarget($event, folder.id)"
    >
      <button
        class="label"
        type="button"
        :disabled="disabled"
        :title="collapsed ? 'Expand' : 'Collapse'"
        @click="$emit('toggle', folder.id)"
      >
        <span class="chevron" aria-hidden="true">
          <Icon
            :name="
              collapsed ? 'fi-rr-angle-small-right' : 'fi-rr-angle-small-down'
            "
          />
        </span>
        <span class="icon" aria-hidden="true">
          <Icon :name="collapsed ? 'fi-rr-folder' : 'fi-rr-folder-open'" />
        </span>
        <span class="name">{{ folder.name }}</span>
        <span class="count">{{ folderTests.length }}</span>
      </button>

      <div class="actions">
        <button
          class="btn-icon"
          type="button"
          :disabled="disabled"
          title="New test"
          @click="$emit('createTest', folder.id)"
        >
          <Icon name="fi-rr-plus" />
        </button>
        <button
          class="btn-icon"
          type="button"
          :disabled="disabled"
          title="New subfolder"
          @click="$emit('createFolder', folder.id)"
        >
          <Icon name="fi-rr-add-folder" />
        </button>
        <button
          class="btn-icon"
          type="button"
          :disabled="disabled"
          title="Rename"
          @click="$emit('renameFolder', folder)"
        >
          <Icon name="fi-rr-pencil" />
        </button>
        <button
          class="btn-icon"
          type="button"
          :disabled="disabled"
          title="Export folder"
          @click="$emit('exportFolder', folder.id)"
        >
          <Icon name="fi-rr-file-export" />
        </button>
        <button
          class="btn-icon"
          type="button"
          :disabled="disabled"
          title="Import folder into here"
          @click="$emit('importFolder', folder.id)"
        >
          <Icon name="fi-rr-file-import" />
        </button>
        <button
          class="btn-icon danger"
          type="button"
          :disabled="disabled"
          title="Delete folder"
          @click="$emit('deleteFolder', folder)"
        >
          <Icon name="fi-rr-trash" />
        </button>
      </div>
    </div>

    <div v-if="!collapsed" class="children" role="group">
      <p v-if="isEmpty" class="empty">Empty</p>

      <div
        v-for="test in folderTests"
        :key="test.id"
        class="row test-row"
        :class="{
          active: test.id === activeTestId,
          dragging:
            dnd.dragging.value?.kind === 'test' &&
            dnd.dragging.value.id === test.id,
        }"
        :draggable="!disabled"
        @dragstart="dnd.onDragStart($event, 'test', test.id)"
        @dragend="dnd.onDragEnd"
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
            @click="$emit('deleteTest', test)"
          >
            <Icon name="fi-rr-trash" />
          </button>
        </div>
      </div>

      <FolderTree
        v-for="child in childFolders"
        :key="child.id"
        :folder="child"
        :folders="folders"
        :tests="tests"
        :active-test-id="activeTestId"
        :disabled="disabled"
        :depth="depth + 1"
        :collapsed-map="collapsedMap"
        @toggle="$emit('toggle', $event)"
        @create-test="$emit('createTest', $event)"
        @open-test="$emit('openTest', $event)"
        @create-folder="$emit('createFolder', $event)"
        @rename-folder="$emit('renameFolder', $event)"
        @delete-folder="$emit('deleteFolder', $event)"
        @delete-test="$emit('deleteTest', $event)"
        @duplicate-test="$emit('duplicateTest', $event)"
        @export-folder="$emit('exportFolder', $event)"
        @import-folder="$emit('importFolder', $event)"
        @move-test="(test, folderId) => $emit('moveTest', test, folderId)"
      />
    </div>
  </div>
</template>

<style scoped>
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

.folder-row[draggable='true'],
.test-row[draggable='true'] {
  cursor: grab;
}

.folder-row[draggable='true']:active,
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
  cursor: inherit;
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
  cursor: pointer;
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
  position: relative;
  margin-left: 0.55rem;
  padding-left: 0.35rem;
  border-left: 1px solid #e4e8ef;
}
</style>
