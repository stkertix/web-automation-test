export type StepType =
  | 'navigate'
  | 'click'
  | 'dblclick'
  | 'input'
  | 'change'
  | 'submit';

export type ExtensionMode = 'idle' | 'record' | 'play' | 'pick';

export type ExtensionStatus = 'Idle' | 'Recording' | 'Playing' | 'Failed';

export interface TestStep {
  id: string;
  type: StepType;
  selectors: string[];
  value: string | null;
  url: string | null;
}

export interface TestCase {
  version: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  steps: TestStep[];
}

export interface TestFolder {
  id: string;
  name: string;
  /** Null means top-level folder. */
  parentId: string | null;
}

/** A saved test case inside the library (includes folder placement). */
export interface LibraryTest extends TestCase {
  id: string;
  folderId: string | null;
}

export interface TestLibrary {
  version: 1;
  folders: TestFolder[];
  tests: LibraryTest[];
  activeTestId: string | null;
}

export interface ExtensionState {
  mode: ExtensionMode;
  status: ExtensionStatus;
  testCase: TestCase;
  activeTestId: string | null;
  library: TestLibrary;
  activeTabId: number | null;
  currentStepIndex: number | null;
  lastError: string | null;
  failedStepId: string | null;
}

export function createEmptyTestCase(name = 'Untitled test'): TestCase {
  const now = new Date().toISOString();
  return {
    version: 1,
    name,
    createdAt: now,
    updatedAt: now,
    steps: [],
  };
}

export function createEmptyLibrary(): TestLibrary {
  const test = createLibraryTest(createEmptyTestCase());
  return {
    version: 1,
    folders: [],
    tests: [test],
    activeTestId: test.id,
  };
}

export function createLibraryTest(
  testCase: TestCase,
  folderId: string | null = null,
  id?: string,
): LibraryTest {
  return {
    ...testCase,
    id: id ?? crypto.randomUUID(),
    folderId,
  };
}

export function createFolder(
  name: string,
  parentId: string | null = null,
): TestFolder {
  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'New folder',
    parentId,
  };
}

export function createStep(
  partial: Omit<TestStep, 'id'> & { id?: string },
): TestStep {
  return {
    id: partial.id ?? crypto.randomUUID(),
    type: partial.type,
    selectors: partial.selectors,
    value: partial.value,
    url: partial.url,
  };
}

export function toTestCase(test: LibraryTest): TestCase {
  return {
    version: test.version,
    name: test.name,
    createdAt: test.createdAt,
    updatedAt: test.updatedAt,
    steps: test.steps,
  };
}
