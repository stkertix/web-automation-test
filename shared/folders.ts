import type {
  LibraryTest,
  TestCase,
  TestEnvironment,
  TestFolder,
  TestLibrary,
} from './types';
import {
  createFolder,
  createId,
  createLibraryTest,
  normalizeDelayMs,
  toTestCase,
} from './types';

export function normalizeFolders(folders: TestFolder[]): TestFolder[] {
  return folders.map((folder) => ({
    ...folder,
    parentId: folder.parentId ?? null,
  }));
}

export function getChildFolders(
  folders: TestFolder[],
  parentId: string | null,
): TestFolder[] {
  return folders
    .filter((folder) => (folder.parentId ?? null) === parentId)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getFolderPath(
  folders: TestFolder[],
  folderId: string,
): string {
  const parts: string[] = [];
  let currentId: string | null = folderId;
  const guard = new Set<string>();

  while (currentId && !guard.has(currentId)) {
    guard.add(currentId);
    const folder = folders.find((item) => item.id === currentId);
    if (!folder) break;
    parts.unshift(folder.name);
    currentId = folder.parentId ?? null;
  }

  return parts.join(' / ');
}

export function listFolderOptions(
  folders: TestFolder[],
): Array<{ id: string; label: string }> {
  const options: Array<{ id: string; label: string }> = [];

  function walk(parentId: string | null, depth: number): void {
    for (const folder of getChildFolders(folders, parentId)) {
      const indent = depth > 0 ? `${'—'.repeat(depth)} ` : '';
      options.push({
        id: folder.id,
        label: `${indent}${folder.name}`,
      });
      walk(folder.id, depth + 1);
    }
  }

  walk(null, 0);
  return options;
}

/** True if moving folderId under newParentId would create a cycle. */
export function wouldCreateFolderCycle(
  folders: TestFolder[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId == null) return false;
  if (newParentId === folderId) return true;

  let currentId: string | null = newParentId;
  const guard = new Set<string>();
  while (currentId && !guard.has(currentId)) {
    if (currentId === folderId) return true;
    guard.add(currentId);
    const folder = folders.find((item) => item.id === currentId);
    currentId = folder?.parentId ?? null;
  }
  return false;
}

export interface FolderExportNode {
  name: string;
  tests: TestCase[];
  folders: FolderExportNode[];
}

export interface FolderExportPayload {
  version: 1;
  type: 'folder-export';
  exportedAt: string;
  folder: FolderExportNode;
}

export interface EnvironmentExportPayload {
  version: 1;
  type: 'environment-export';
  exportedAt: string;
  environments: TestEnvironment[];
  activeEnvironmentId: string | null;
}

export interface LibraryExportPayload {
  version: 1;
  type: 'library-export';
  exportedAt: string;
  /** Snapshot of the full library (folders + tests + active selection). */
  library: Pick<TestLibrary, 'version' | 'folders' | 'tests' | 'activeTestId'> & {
    environments?: TestEnvironment[];
    activeEnvironmentId?: string | null;
  };
}

export function buildFolderExport(
  folders: TestFolder[],
  tests: LibraryTest[],
  folderId: string,
): FolderExportPayload | null {
  const root = folders.find((folder) => folder.id === folderId);
  if (!root) return null;

  function buildNode(folder: TestFolder): FolderExportNode {
    const folderTests = tests
      .filter((test) => test.folderId === folder.id)
      .map((test) => toTestCase(test));
    const children = getChildFolders(folders, folder.id).map(buildNode);
    return {
      name: folder.name,
      tests: folderTests,
      folders: children,
    };
  }

  return {
    version: 1,
    type: 'folder-export',
    exportedAt: new Date().toISOString(),
    folder: buildNode(root),
  };
}

export function buildLibraryExport(library: TestLibrary): LibraryExportPayload {
  return {
    version: 1,
    type: 'library-export',
    exportedAt: new Date().toISOString(),
    library: {
      version: library.version,
      folders: library.folders.map((folder) => ({ ...folder })),
      tests: library.tests.map((test) => ({
        ...test,
        steps: test.steps.map((step) => ({
          ...step,
          selectors: [...step.selectors],
          delayMs: normalizeDelayMs(step.delayMs),
        })),
      })),
      activeTestId: library.activeTestId,
      environments: library.environments.map((env) => ({
        ...env,
        variables: env.variables.map((variable) => ({ ...variable })),
      })),
      activeEnvironmentId: library.activeEnvironmentId,
    },
  };
}

export function buildEnvironmentExport(
  environments: TestEnvironment[],
  activeEnvironmentId: string | null,
): EnvironmentExportPayload {
  return {
    version: 1,
    type: 'environment-export',
    exportedAt: new Date().toISOString(),
    environments: environments.map((env) => ({
      ...env,
      variables: env.variables.map((variable) => ({ ...variable })),
    })),
    activeEnvironmentId,
  };
}

/**
 * Turns a folder-export tree into new folders/tests with fresh IDs,
 * attached under `parentId` (null = top-level).
 */
export function materializeFolderImport(
  node: FolderExportNode,
  parentId: string | null,
): { folders: TestFolder[]; tests: LibraryTest[]; rootFolderId: string } {
  const folders: TestFolder[] = [];
  const tests: LibraryTest[] = [];

  function walk(current: FolderExportNode, parent: string | null): string {
    const folder = createFolder(current.name, parent);
    folders.push(folder);

    for (const testCase of current.tests) {
      const now = new Date().toISOString();
      tests.push(
        createLibraryTest(
          {
            version: 1,
            name: testCase.name,
            createdAt: testCase.createdAt || now,
            updatedAt: now,
            steps: testCase.steps.map((step) => ({
              ...step,
              id: createId(),
              selectors: [...step.selectors],
              delayMs: normalizeDelayMs(step.delayMs),
            })),
          },
          folder.id,
        ),
      );
    }

    for (const child of current.folders) {
      walk(child, folder.id);
    }

    return folder.id;
  }

  const rootFolderId = walk(node, parentId);
  return { folders, tests, rootFolderId };
}

export function duplicateLibraryTest(source: LibraryTest): LibraryTest {
  const now = new Date().toISOString();
  const copyName = / \(copy\)(\s*\d+)?$/.test(source.name)
    ? `${source.name.replace(/ \(copy\)(\s*\d+)?$/, '')} (copy)`
    : `${source.name} (copy)`;

  // If a copy already exists with the same name pattern, keep simple suffix.
  return createLibraryTest(
    {
      version: 1,
      name: copyName,
      createdAt: now,
      updatedAt: now,
      steps: source.steps.map((step) => ({
        ...step,
        id: createId(),
        selectors: [...step.selectors],
        delayMs: normalizeDelayMs(step.delayMs),
      })),
    },
    source.folderId,
  );
}
