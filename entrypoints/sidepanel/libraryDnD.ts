import type { InjectionKey, Ref } from 'vue';

export type LibraryDragKind = 'test' | 'folder';

export interface LibraryDragPayload {
  kind: LibraryDragKind;
  id: string;
}

export interface LibraryDnDContext {
  disabled: Ref<boolean>;
  dragging: Ref<LibraryDragPayload | null>;
  dropTargetKey: Ref<string | null>;
  onDragStart: (
    event: DragEvent,
    kind: LibraryDragKind,
    id: string,
  ) => void;
  onDragEnd: () => void;
  onDragOverTarget: (event: DragEvent, targetKey: string) => void;
  onDragLeaveTarget: (event: DragEvent, targetKey: string) => void;
  onDropOnTarget: (event: DragEvent, folderId: string | null) => void;
}

export const libraryDnDKey: InjectionKey<LibraryDnDContext> =
  Symbol('libraryDnD');

export const LIBRARY_DRAG_MIME = 'application/x-wat-library';

export function targetKeyForFolder(folderId: string | null): string {
  return folderId == null ? 'unfiled' : `folder:${folderId}`;
}

export function parseLibraryDragPayload(
  event: DragEvent,
): LibraryDragPayload | null {
  const raw =
    event.dataTransfer?.getData(LIBRARY_DRAG_MIME) ||
    event.dataTransfer?.getData('text/plain') ||
    '';
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LibraryDragPayload;
    if (
      (parsed.kind === 'test' || parsed.kind === 'folder') &&
      typeof parsed.id === 'string'
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}
