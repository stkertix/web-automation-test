export type StepType =
  | 'navigate'
  | 'click'
  | 'dblclick'
  | 'input'
  | 'change'
  | 'submit'
  | 'wait'
  | 'script'
  | 'divider';

export type ExtensionMode = 'idle' | 'record' | 'play' | 'pick';

export type ExtensionStatus = 'Idle' | 'Recording' | 'Playing' | 'Failed';

/** Pause after a step finishes, before the next one starts. */
export const DEFAULT_STEP_DELAY_MS = 200;
export const MAX_STEP_DELAY_MS = 60_000;

/** How long a wait step polls for its element. Stored on the step as `value`. */
export const DEFAULT_WAIT_MS = 10_000;
export const MAX_WAIT_MS = 120_000;

/** JavaScript source stored on a script step as `value`. */
export const MAX_SCRIPT_CHARS = 50_000;

/** Optional label shown in the step list instead of type and target. */
export const MAX_STEP_NAME_CHARS = 80;

/** UUID that also works on plain http pages, where randomUUID is missing. */
export function createId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const b6 = bytes[6] ?? 0;
  const b8 = bytes[8] ?? 0;
  bytes[6] = (b6 & 0x0f) | 0x40;
  bytes[8] = (b8 & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function normalizeWaitMs(value: unknown): number {
  if (value == null || value === '') return DEFAULT_WAIT_MS;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_WAIT_MS;
  return Math.min(MAX_WAIT_MS, Math.max(0, Math.round(n)));
}

export interface TestStep {
  id: string;
  /** Optional label. When set, the step list shows this instead of type and target. */
  name?: string | null;
  type: StepType;
  selectors: string[];
  value: string | null;
  url: string | null;
  /** Milliseconds to wait after this step. Missing values use the default. */
  delayMs?: number;
  /**
   * Script steps only. When set, the script's return value is stored
   * under this name for later `{{name}}` placeholders.
   */
  variableName?: string | null;
}

const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function normalizeStepName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  return name.slice(0, MAX_STEP_NAME_CHARS);
}

export function normalizeVariableName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > 64 || !VARIABLE_NAME_PATTERN.test(name)) {
    return null;
  }
  return name;
}

const VARIABLE_PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Replaces `{{name}}` with saved variable text. */
export function applyVariables(
  template: string,
  variables: ReadonlyMap<string, string>,
): { ok: true; value: string } | { ok: false; error: string } {
  const missing = new Set<string>();
  const value = template.replace(VARIABLE_PLACEHOLDER, (_match, name: string) => {
    if (!variables.has(name)) {
      missing.add(name);
      return '';
    }
    return variables.get(name) ?? '';
  });
  if (missing.size > 0) {
    return {
      ok: false,
      error: `Unknown variable: ${[...missing].join(', ')}.`,
    };
  }
  return { ok: true, value };
}

export function normalizeDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_STEP_DELAY_MS;
  }
  return Math.min(MAX_STEP_DELAY_MS, Math.max(0, Math.round(value)));
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

export interface EnvironmentVariable {
  name: string;
  value: string;
}

/** Named server or deployment, with values shared by every test. */
export interface TestEnvironment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
}

export interface TestLibrary {
  version: 1;
  folders: TestFolder[];
  tests: LibraryTest[];
  activeTestId: string | null;
  environments: TestEnvironment[];
  activeEnvironmentId: string | null;
}

export function createEnvironment(name: string): TestEnvironment {
  return {
    id: createId(),
    name: name.trim() || 'New environment',
    variables: [],
  };
}

export function normalizeEnvironments(value: unknown): TestEnvironment[] {
  if (!Array.isArray(value)) return [];
  const environments: TestEnvironment[] = [];
  const seenIds = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const env = item as TestEnvironment;
    if (typeof env.id !== 'string' || !env.id || seenIds.has(env.id)) continue;
    seenIds.add(env.id);

    const name =
      typeof env.name === 'string' && env.name.trim()
        ? env.name.trim().slice(0, 64)
        : 'Environment';
    const variables: EnvironmentVariable[] = [];
    const seenNames = new Set<string>();
    if (Array.isArray(env.variables)) {
      for (const variable of env.variables) {
        if (!variable || typeof variable !== 'object') continue;
        const entry = variable as EnvironmentVariable;
        const varName = normalizeVariableName(entry.name);
        if (!varName || seenNames.has(varName) || typeof entry.value !== 'string') {
          continue;
        }
        seenNames.add(varName);
        variables.push({ name: varName, value: entry.value });
      }
    }

    environments.push({ id: env.id, name, variables });
  }

  return environments;
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
    environments: [],
    activeEnvironmentId: null,
  };
}

export function createLibraryTest(
  testCase: TestCase,
  folderId: string | null = null,
  id?: string,
): LibraryTest {
  return {
    ...testCase,
    id: id ?? createId(),
    folderId,
  };
}

export function createFolder(
  name: string,
  parentId: string | null = null,
): TestFolder {
  return {
    id: createId(),
    name: name.trim() || 'New folder',
    parentId,
  };
}

export function createStep(
  partial: Omit<TestStep, 'id'> & { id?: string },
): TestStep {
  return {
    id: partial.id ?? createId(),
    name: normalizeStepName(partial.name),
    type: partial.type,
    selectors: partial.selectors,
    value: partial.value,
    url: partial.url,
    delayMs: normalizeDelayMs(partial.delayMs),
    variableName: normalizeVariableName(partial.variableName),
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
