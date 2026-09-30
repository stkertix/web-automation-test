import {
  createEmptyLibrary,
  createEmptyTestCase,
  createLibraryTest,
  normalizeDelayMs,
  normalizeEnvironments,
  normalizeStepName,
  normalizeVariableName,
  type LibraryTest,
  type TestCase,
  type TestEnvironment,
  type TestFolder,
  type TestLibrary,
  type TestStep,
} from './types';
import {
  normalizeFolders,
  type EnvironmentExportPayload,
  type FolderExportNode,
  type FolderExportPayload,
  type LibraryExportPayload,
} from './folders';

const LIBRARY_KEY = 'automationLibrary';
const LEGACY_DRAFT_KEY = 'automationDraft';

function isValidTestCase(value: unknown): value is TestCase {
  if (!value || typeof value !== 'object') return false;
  const draft = value as TestCase;
  return (
    draft.version === 1 &&
    typeof draft.name === 'string' &&
    Array.isArray(draft.steps)
  );
}

/** Loose shape check for data already in chrome.storage. */
function isValidStoredLibrary(value: unknown): value is TestLibrary {
  if (!value || typeof value !== 'object') return false;
  const lib = value as TestLibrary;
  return (
    lib.version === 1 &&
    Array.isArray(lib.folders) &&
    Array.isArray(lib.tests)
  );
}

function isValidStep(value: unknown): value is TestStep {
  if (!value || typeof value !== 'object') return false;
  const step = value as TestStep;
  return (
    typeof step.id === 'string' &&
    typeof step.type === 'string' &&
    Array.isArray(step.selectors) &&
    step.selectors.every((selector) => typeof selector === 'string') &&
    (step.value === null || typeof step.value === 'string') &&
    (step.url === null || typeof step.url === 'string') &&
    (step.name == null || typeof step.name === 'string') &&
    (step.variableName == null || typeof step.variableName === 'string')
  );
}

function isValidImportFolder(value: unknown): value is TestFolder {
  if (!value || typeof value !== 'object') return false;
  const folder = value as TestFolder;
  return (
    typeof folder.id === 'string' &&
    typeof folder.name === 'string' &&
    (folder.parentId === null || typeof folder.parentId === 'string')
  );
}

function isValidImportLibraryTest(value: unknown): value is LibraryTest {
  if (!value || typeof value !== 'object') return false;
  const test = value as LibraryTest;
  return (
    test.version === 1 &&
    typeof test.id === 'string' &&
    typeof test.name === 'string' &&
    typeof test.createdAt === 'string' &&
    typeof test.updatedAt === 'string' &&
    Array.isArray(test.steps) &&
    test.steps.every(isValidStep) &&
    (test.folderId === null || typeof test.folderId === 'string')
  );
}

function isValidImportLibrary(value: unknown): value is TestLibrary {
  if (!value || typeof value !== 'object') return false;
  const lib = value as TestLibrary;
  return (
    lib.version === 1 &&
    Array.isArray(lib.folders) &&
    Array.isArray(lib.tests) &&
    lib.folders.every(isValidImportFolder) &&
    lib.tests.every(isValidImportLibraryTest) &&
    (lib.activeTestId === null || typeof lib.activeTestId === 'string')
  );
}

function isValidLibraryExport(value: unknown): value is LibraryExportPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as LibraryExportPayload;
  return (
    payload.version === 1 &&
    payload.type === 'library-export' &&
    typeof payload.exportedAt === 'string' &&
    isValidImportLibrary(payload.library)
  );
}

function isValidFolderExportNode(value: unknown): value is FolderExportNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as FolderExportNode;
  return (
    typeof node.name === 'string' &&
    Array.isArray(node.tests) &&
    node.tests.every(isValidTestCase) &&
    Array.isArray(node.folders) &&
    node.folders.every(isValidFolderExportNode)
  );
}

function isValidEnvironmentExport(
  value: unknown,
): value is EnvironmentExportPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as EnvironmentExportPayload;
  return (
    payload.version === 1 &&
    payload.type === 'environment-export' &&
    typeof payload.exportedAt === 'string' &&
    Array.isArray(payload.environments) &&
    (payload.activeEnvironmentId === null ||
      typeof payload.activeEnvironmentId === 'string')
  );
}

function isValidFolderExport(value: unknown): value is FolderExportPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as FolderExportPayload;
  return (
    payload.version === 1 &&
    payload.type === 'folder-export' &&
    typeof payload.exportedAt === 'string' &&
    isValidFolderExportNode(payload.folder)
  );
}

function normalizeSteps(steps: TestStep[]): TestStep[] {
  return steps.map((step) => ({
    ...step,
    name: normalizeStepName(step.name),
    delayMs: normalizeDelayMs(step.delayMs),
    variableName: normalizeVariableName(step.variableName),
  }));
}

function normalizeLibrary(library: TestLibrary): TestLibrary {
  let next: TestLibrary = {
    ...library,
    folders: normalizeFolders(library.folders),
    tests: library.tests.map((test) => ({
      ...test,
      steps: normalizeSteps(test.steps),
    })),
    environments: normalizeEnvironments(library.environments),
    activeEnvironmentId: library.activeEnvironmentId ?? null,
  };

  if (
    next.activeEnvironmentId &&
    !next.environments.some((env) => env.id === next.activeEnvironmentId)
  ) {
    next = { ...next, activeEnvironmentId: null };
  }

  if (next.tests.length === 0) {
    const test = createLibraryTest(createEmptyTestCase());
    next = {
      ...next,
      tests: [test],
      activeTestId: test.id,
    };
  }

  if (
    !next.activeTestId ||
    !next.tests.some((t) => t.id === next.activeTestId)
  ) {
    next = {
      ...next,
      activeTestId: next.tests[0]?.id ?? null,
    };
  }

  return next;
}

export async function loadLibrary(): Promise<TestLibrary> {
  const result = await browser.storage.local.get([
    LIBRARY_KEY,
    LEGACY_DRAFT_KEY,
  ]);

  if (isValidStoredLibrary(result[LIBRARY_KEY])) {
    return normalizeLibrary(result[LIBRARY_KEY] as TestLibrary);
  }

  // Migrate legacy single-draft storage.
  const legacy = result[LEGACY_DRAFT_KEY];
  if (isValidTestCase(legacy)) {
    const test = createLibraryTest(legacy);
    const library: TestLibrary = {
      version: 1,
      folders: [],
      tests: [test],
      activeTestId: test.id,
      environments: [],
      activeEnvironmentId: null,
    };
    await saveLibrary(library);
    await browser.storage.local.remove(LEGACY_DRAFT_KEY);
    return library;
  }

  const library = createEmptyLibrary();
  await saveLibrary(library);
  return library;
}

export async function saveLibrary(library: TestLibrary): Promise<void> {
  await browser.storage.local.set({ [LIBRARY_KEY]: library });
}

export function getActiveTest(library: TestLibrary): LibraryTest | null {
  if (!library.activeTestId) return null;
  return library.tests.find((t) => t.id === library.activeTestId) ?? null;
}

export function syncActiveTest(
  library: TestLibrary,
  testCase: TestCase,
): TestLibrary {
  if (!library.activeTestId) return library;
  return {
    ...library,
    tests: library.tests.map((test) => {
      if (test.id !== library.activeTestId) return test;
      return {
        ...test,
        ...testCase,
        id: test.id,
        folderId: test.folderId,
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

export function downloadTestCaseJson(testCase: TestCase): void {
  downloadJsonFile(
    testCase,
    `step.${safeFileName(testCase.name) || 'test'}-${exportStamp()}.json`,
  );
}

export function downloadFolderExportJson(
  payload: FolderExportPayload,
): void {
  downloadJsonFile(
    payload,
    `folder.${safeFileName(payload.folder.name) || 'folder'}-${exportStamp()}.json`,
  );
}

export function downloadLibraryExportJson(
  payload: LibraryExportPayload,
): void {
  downloadJsonFile(payload, `library-${exportStamp()}.json`);
}

export function downloadEnvironmentExportJson(
  payload: EnvironmentExportPayload,
): void {
  downloadJsonFile(payload, `environment-${exportStamp()}.json`);
}

/** Local time as YYYYMMDD-HHmmss, for example 20260930-135642. */
function exportStamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').toLowerCase();
}

function downloadJsonFile(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseTestCaseJson(raw: string): TestCase {
  const parsed = JSON.parse(raw) as TestCase;
  if (!isValidTestCase(parsed)) {
    throw new Error('Invalid test case JSON');
  }
  return {
    ...parsed,
    steps: normalizeSteps(parsed.steps),
  };
}

export function parseLibraryExportJson(raw: string): TestLibrary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid library export JSON');
  }
  if (!isValidLibraryExport(parsed)) {
    throw new Error('Invalid library export JSON');
  }
  return normalizeLibrary({
    version: 1,
    folders: parsed.library.folders,
    tests: parsed.library.tests,
    activeTestId: parsed.library.activeTestId,
    environments: parsed.library.environments ?? [],
    activeEnvironmentId: parsed.library.activeEnvironmentId ?? null,
  });
}

export function parseEnvironmentExportJson(raw: string): {
  environments: TestEnvironment[];
  activeEnvironmentId: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid environment export JSON');
  }
  if (!isValidEnvironmentExport(parsed)) {
    throw new Error('Invalid environment export JSON');
  }
  const environments = normalizeEnvironments(parsed.environments);
  const activeEnvironmentId =
    parsed.activeEnvironmentId != null &&
    environments.some((env) => env.id === parsed.activeEnvironmentId)
      ? parsed.activeEnvironmentId
      : null;
  return { environments, activeEnvironmentId };
}

export function parseFolderExportJson(raw: string): FolderExportPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid folder export JSON');
  }
  if (!isValidFolderExport(parsed)) {
    throw new Error('Invalid folder export JSON');
  }
  return parsed;
}
