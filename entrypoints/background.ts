import { MessageType, type ExtensionMessage } from '../shared/messages';
import { duplicateLibraryTest, wouldCreateFolderCycle } from '../shared/folders';
import {
  getActiveTest,
  loadLibrary,
  saveLibrary,
  syncActiveTest,
} from '../shared/storage';
import {
  createEmptyLibrary,
  createEmptyTestCase,
  createFolder,
  createLibraryTest,
  createStep,
  toTestCase,
  type ExtensionState,
  type TestCase,
  type TestLibrary,
  type TestStep,
} from '../shared/types';

const STEP_DELAY_MS = 200;

let state: ExtensionState = {
  mode: 'idle',
  status: 'Idle',
  testCase: createEmptyTestCase(),
  activeTestId: null,
  library: createEmptyLibrary(),
  activeTabId: null,
  currentStepIndex: null,
  lastError: null,
  failedStepId: null,
};

let playbackCancelled = false;

function applyLibrary(library: TestLibrary): void {
  const active = getActiveTest(library);
  state = {
    ...state,
    library,
    activeTestId: library.activeTestId,
    testCase: active ? toTestCase(active) : createEmptyTestCase(),
  };
}

async function persistAndBroadcast(): Promise<void> {
  const library = syncActiveTest(state.library, state.testCase);
  state = {
    ...state,
    library,
    activeTestId: library.activeTestId,
  };
  await saveLibrary(library);
  broadcastState();
}

function broadcastState(): void {
  void browser.runtime
    .sendMessage({
      type: MessageType.STATE_CHANGED,
      state,
    } satisfies ExtensionMessage)
    .catch(() => {
      // Side panel may be closed.
    });
}

function setState(patch: Partial<ExtensionState>): void {
  state = { ...state, ...patch };
  broadcastState();
}

function guardIdleEdit(): { ok: false; error: string } | null {
  if (state.mode !== 'idle') {
    return {
      ok: false,
      error: 'Stop recording, playback, or element picking before managing the library.',
    };
  }
  return null;
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

async function sendToTab(
  tabId: number,
  message: ExtensionMessage,
): Promise<unknown> {
  try {
    return await browser.tabs.sendMessage(tabId, message);
  } catch {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
    return await browser.tabs.sendMessage(tabId, message);
  }
}

async function setContentMode(
  tabId: number,
  mode: ExtensionState['mode'],
): Promise<void> {
  await sendToTab(tabId, { type: MessageType.SET_MODE, mode });
}

async function setPickActive(tabId: number, active: boolean): Promise<void> {
  await sendToTab(tabId, { type: MessageType.SET_PICK_ACTIVE, active });
}

function broadcastElementPicked(selectors: string[]): void {
  void browser.runtime
    .sendMessage({
      type: MessageType.ELEMENT_PICKED,
      selectors,
    } satisfies ExtensionMessage)
    .catch(() => {
      // Side panel may be closed.
    });
}

async function startElementPick(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (state.mode === 'record' || state.mode === 'play') {
    return {
      ok: false,
      error: 'Stop recording or playback before picking an element.',
    };
  }
  if (state.mode === 'pick') {
    return { ok: true };
  }

  const tabId = await getActiveTabId();
  if (tabId == null) {
    return { ok: false, error: 'No active tab found.' };
  }

  const tab = await browser.tabs.get(tabId);
  if (
    tab.url?.startsWith('chrome://') ||
    tab.url?.startsWith('chrome-extension://')
  ) {
    return {
      ok: false,
      error: 'Cannot pick elements on browser internal pages.',
    };
  }

  try {
    await setPickActive(tabId, true);
  } catch {
    return { ok: false, error: 'Failed to start element picker on this page.' };
  }

  setState({
    mode: 'pick',
    activeTabId: tabId,
    lastError: null,
  });
  return { ok: true };
}

async function cancelElementPick(): Promise<{ ok: true }> {
  const tabId = state.activeTabId ?? (await getActiveTabId());
  if (tabId != null) {
    try {
      await setPickActive(tabId, false);
    } catch {
      // ignore
    }
  }
  if (state.mode === 'pick') {
    setState({ mode: 'idle' });
  }
  return { ok: true };
}

async function finishElementPick(selectors: string[]): Promise<void> {
  const tabId = state.activeTabId ?? (await getActiveTabId());
  if (tabId != null) {
    try {
      await setPickActive(tabId, false);
    } catch {
      // ignore
    }
  }
  if (state.mode === 'pick') {
    setState({ mode: 'idle' });
  }
  broadcastElementPicked(selectors);
}

async function startRecording(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (state.mode === 'play') {
    return { ok: false, error: 'Cannot record while playback is running.' };
  }
  if (state.mode === 'pick') {
    return { ok: false, error: 'Finish or cancel element picking first.' };
  }

  const tabId = await getActiveTabId();
  if (tabId == null) {
    return { ok: false, error: 'No active tab found.' };
  }

  const tab = await browser.tabs.get(tabId);
  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
    return {
      ok: false,
      error: 'Cannot record on browser internal pages.',
    };
  }

  playbackCancelled = false;
  setState({
    mode: 'record',
    status: 'Recording',
    activeTabId: tabId,
    currentStepIndex: null,
    lastError: null,
    failedStepId: null,
  });

  try {
    await setContentMode(tabId, 'record');
  } catch {
    setState({
      mode: 'idle',
      status: 'Failed',
      lastError: 'Failed to start recording on this page.',
    });
    return { ok: false, error: 'Failed to start recording on this page.' };
  }

  return { ok: true };
}

async function stopRecording(): Promise<{ ok: true }> {
  const tabId = state.activeTabId;
  setState({ mode: 'idle', status: 'Idle' });
  if (tabId != null) {
    try {
      await setContentMode(tabId, 'idle');
    } catch {
      // Tab may have closed.
    }
  }
  return { ok: true };
}

function waitForTabComplete(tabId: number, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      reject(new Error('Navigation timed out.'));
    }, timeoutMs);

    function listener(
      updatedTabId: number,
      changeInfo: { status?: string },
    ): void {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    browser.tabs.onUpdated.addListener(listener);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStepOnTab(tabId: number, step: TestStep): Promise<{
  ok: boolean;
  error?: string;
  navigated?: boolean;
}> {
  if (step.type === 'navigate' && step.url) {
    await browser.tabs.update(tabId, { url: step.url });
    await waitForTabComplete(tabId);
    await delay(STEP_DELAY_MS);
    try {
      await setContentMode(tabId, 'play');
    } catch {
      // Content script will be injected on next RUN_STEP.
    }
    return { ok: true, navigated: true };
  }

  const result = (await sendToTab(tabId, {
    type: MessageType.RUN_STEP,
    step,
  })) as { ok: boolean; error?: string; navigated?: boolean };

  if (result?.navigated) {
    await waitForTabComplete(tabId);
    await delay(STEP_DELAY_MS);
    try {
      await setContentMode(tabId, 'play');
    } catch {
      // ignore
    }
  }

  return result ?? { ok: false, error: 'No response from content script.' };
}

async function startPlayback(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (state.mode === 'record') {
    return { ok: false, error: 'Stop recording before playback.' };
  }
  if (state.mode === 'pick') {
    return { ok: false, error: 'Finish or cancel element picking first.' };
  }
  if (state.testCase.steps.length === 0) {
    return { ok: false, error: 'No steps to play.' };
  }

  const tabId = await getActiveTabId();
  if (tabId == null) {
    return { ok: false, error: 'No active tab found.' };
  }

  playbackCancelled = false;
  setState({
    mode: 'play',
    status: 'Playing',
    activeTabId: tabId,
    currentStepIndex: 0,
    lastError: null,
    failedStepId: null,
  });

  try {
    await setContentMode(tabId, 'play');
  } catch {
    setState({
      mode: 'idle',
      status: 'Failed',
      lastError: 'Failed to start playback on this page.',
    });
    return { ok: false, error: 'Failed to start playback on this page.' };
  }

  void runPlayback(tabId);
  return { ok: true };
}

async function runPlayback(tabId: number): Promise<void> {
  const steps = state.testCase.steps;

  for (let i = 0; i < steps.length; i += 1) {
    if (playbackCancelled) {
      setState({
        mode: 'idle',
        status: 'Idle',
        currentStepIndex: null,
      });
      try {
        await setContentMode(tabId, 'idle');
      } catch {
        // ignore
      }
      return;
    }

    const step = steps[i];
    if (!step) continue;

    setState({ currentStepIndex: i });

    try {
      const result = await runStepOnTab(tabId, step);
      if (!result.ok) {
        setState({
          mode: 'idle',
          status: 'Failed',
          lastError: result.error ?? 'Step failed.',
          failedStepId: step.id,
          currentStepIndex: i,
        });
        try {
          await setContentMode(tabId, 'idle');
        } catch {
          // ignore
        }
        return;
      }
    } catch (error) {
      setState({
        mode: 'idle',
        status: 'Failed',
        lastError: error instanceof Error ? error.message : 'Step failed.',
        failedStepId: step.id,
        currentStepIndex: i,
      });
      try {
        await setContentMode(tabId, 'idle');
      } catch {
        // ignore
      }
      return;
    }

    await delay(STEP_DELAY_MS);
  }

  setState({
    mode: 'idle',
    status: 'Idle',
    currentStepIndex: null,
    lastError: null,
    failedStepId: null,
  });
  try {
    await setContentMode(tabId, 'idle');
  } catch {
    // ignore
  }
}

async function stopPlayback(): Promise<{ ok: true }> {
  playbackCancelled = true;
  const tabId = state.activeTabId;
  if (tabId != null) {
    try {
      await sendToTab(tabId, { type: MessageType.CANCEL_PLAYBACK });
      await setContentMode(tabId, 'idle');
    } catch {
      // ignore
    }
  }
  setState({
    mode: 'idle',
    status: 'Idle',
    currentStepIndex: null,
  });
  return { ok: true };
}

function appendRecordedStep(step: TestStep): void {
  if (state.mode !== 'record') return;

  const steps = [...state.testCase.steps];
  const last = steps[steps.length - 1];

  if (
    step.type === 'input' &&
    last?.type === 'input' &&
    last.selectors[0] &&
    step.selectors[0] === last.selectors[0]
  ) {
    steps[steps.length - 1] = {
      ...last,
      value: step.value,
    };
  } else {
    steps.push(step);
  }

  state = {
    ...state,
    testCase: {
      ...state.testCase,
      steps,
      updatedAt: new Date().toISOString(),
    },
  };
  void persistAndBroadcast();
}

function appendNavigateStep(url: string): void {
  if (state.mode !== 'record') return;
  const last = state.testCase.steps[state.testCase.steps.length - 1];
  if (last?.type === 'navigate' && last.url === url) return;

  appendRecordedStep(
    createStep({
      type: 'navigate',
      selectors: [],
      value: null,
      url,
    }),
  );
}

export default defineBackground(() => {
  void (async () => {
    const library = await loadLibrary();
    applyLibrary(library);
    broadcastState();
  })();

  if (browser.sidePanel?.setPanelBehavior) {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    if (state.mode !== 'record') return;
    if (state.activeTabId != null && details.tabId !== state.activeTabId) return;
    if (
      details.url.startsWith('chrome://') ||
      details.url.startsWith('chrome-extension://')
    ) {
      return;
    }
    appendNavigateStep(details.url);
  });

  browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
    switch (message.type) {
      case MessageType.GET_STATE:
        return Promise.resolve(state);

      case MessageType.START_RECORDING:
        return startRecording();

      case MessageType.STOP_RECORDING:
        return stopRecording();

      case MessageType.START_PLAYBACK:
        return startPlayback();

      case MessageType.STOP_PLAYBACK:
        return stopPlayback();

      case MessageType.START_ELEMENT_PICK:
        return startElementPick();

      case MessageType.CANCEL_ELEMENT_PICK:
        return cancelElementPick();

      case MessageType.ELEMENT_PICKED:
        return finishElementPick(message.selectors).then(() => ({
          ok: true as const,
        }));

      case MessageType.CLEAR_STEPS:
        state = {
          ...state,
          testCase: {
            ...state.testCase,
            steps: [],
            updatedAt: new Date().toISOString(),
          },
          lastError: null,
          failedStepId: null,
          currentStepIndex: null,
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));

      case MessageType.ADD_STEP: {
        if (state.mode !== 'idle') {
          return Promise.resolve({
            ok: false as const,
            error: 'Stop recording or playback before adding a step.',
          });
        }

        const step = createStep({
          type: message.stepType,
          selectors:
            message.stepType === 'navigate'
              ? []
              : (message.selectors ?? []).filter(Boolean),
          value:
            message.stepType === 'input' || message.stepType === 'change'
              ? (message.value ?? '')
              : null,
          url: message.stepType === 'navigate' ? (message.url ?? '') : null,
        });

        if (
          message.stepType !== 'navigate' &&
          step.selectors.length === 0
        ) {
          return Promise.resolve({
            ok: false as const,
            error: 'Selector is required for this step type.',
          });
        }
        if (message.stepType === 'navigate' && !step.url) {
          return Promise.resolve({
            ok: false as const,
            error: 'URL is required for navigate steps.',
          });
        }

        const steps = [...state.testCase.steps];
        const index =
          message.index == null || Number.isNaN(message.index)
            ? steps.length
            : Math.max(0, Math.min(message.index, steps.length));
        steps.splice(index, 0, step);

        state = {
          ...state,
          testCase: {
            ...state.testCase,
            steps,
            updatedAt: new Date().toISOString(),
          },
          lastError: null,
          failedStepId: null,
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.REORDER_STEPS: {
        if (state.mode !== 'idle') {
          return Promise.resolve({
            ok: false as const,
            error: 'Stop recording or playback before reordering steps.',
          });
        }

        const { fromIndex, toIndex } = message;
        const steps = [...state.testCase.steps];
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= steps.length ||
          toIndex >= steps.length ||
          fromIndex === toIndex
        ) {
          return Promise.resolve({ ok: true as const });
        }

        const [moved] = steps.splice(fromIndex, 1);
        if (!moved) {
          return Promise.resolve({
            ok: false as const,
            error: 'Failed to reorder steps.',
          });
        }
        steps.splice(toIndex, 0, moved);

        state = {
          ...state,
          testCase: {
            ...state.testCase,
            steps,
            updatedAt: new Date().toISOString(),
          },
          lastError: null,
          failedStepId: null,
          currentStepIndex: null,
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.UPDATE_TEST_NAME:
        state = {
          ...state,
          testCase: {
            ...state.testCase,
            name: message.name,
            updatedAt: new Date().toISOString(),
          },
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));

      case MessageType.UPDATE_STEP: {
        const steps = state.testCase.steps.map((step) => {
          if (step.id !== message.stepId) return step;
          return {
            ...step,
            ...message.patch,
            selectors: message.patch.selectors ?? step.selectors,
          };
        });
        state = {
          ...state,
          testCase: {
            ...state.testCase,
            steps,
            updatedAt: new Date().toISOString(),
          },
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.DELETE_STEP: {
        state = {
          ...state,
          testCase: {
            ...state.testCase,
            steps: state.testCase.steps.filter((s) => s.id !== message.stepId),
            updatedAt: new Date().toISOString(),
          },
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.SAVE_TEST:
      case MessageType.LOAD_TEST: {
        const testCase: TestCase = {
          ...message.testCase,
          updatedAt: new Date().toISOString(),
        };

        if (message.type === MessageType.LOAD_TEST) {
          const folderId =
            'folderId' in message ? (message.folderId ?? null) : null;
          const imported = createLibraryTest(testCase, folderId);
          const library: TestLibrary = {
            ...syncActiveTest(state.library, state.testCase),
            tests: [...state.library.tests, imported],
            activeTestId: imported.id,
          };
          applyLibrary(library);
          return persistAndBroadcast().then(() => ({
            ok: true as const,
            state,
          }));
        }

        state = {
          ...state,
          testCase,
          lastError: null,
          failedStepId: null,
          currentStepIndex: null,
        };
        return persistAndBroadcast().then(() => ({ ok: true as const, state }));
      }

      case MessageType.CREATE_FOLDER: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        const parentId = message.parentId ?? null;
        if (
          parentId != null &&
          !state.library.folders.some((folder) => folder.id === parentId)
        ) {
          return Promise.resolve({
            ok: false as const,
            error: 'Parent folder not found.',
          });
        }
        const folder = createFolder(message.name, parentId);
        state = {
          ...state,
          library: {
            ...state.library,
            folders: [...state.library.folders, folder],
          },
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.RENAME_FOLDER: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        state = {
          ...state,
          library: {
            ...state.library,
            folders: state.library.folders.map((folder) =>
              folder.id === message.folderId
                ? { ...folder, name: message.name.trim() || folder.name }
                : folder,
            ),
          },
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.DELETE_FOLDER: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        const target = state.library.folders.find(
          (folder) => folder.id === message.folderId,
        );
        if (!target) {
          return Promise.resolve({
            ok: false as const,
            error: 'Folder not found.',
          });
        }
        const fallbackParentId = target.parentId ?? null;
        state = {
          ...state,
          library: {
            ...state.library,
            folders: state.library.folders
              .filter((folder) => folder.id !== message.folderId)
              .map((folder) =>
                folder.parentId === message.folderId
                  ? { ...folder, parentId: fallbackParentId }
                  : folder,
              ),
            tests: state.library.tests.map((test) =>
              test.folderId === message.folderId
                ? { ...test, folderId: fallbackParentId }
                : test,
            ),
          },
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.CREATE_TEST: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        const synced = syncActiveTest(state.library, state.testCase);
        const test = createLibraryTest(
          createEmptyTestCase(message.name ?? 'Untitled test'),
          message.folderId ?? null,
        );
        const library: TestLibrary = {
          ...synced,
          tests: [...synced.tests, test],
          activeTestId: test.id,
        };
        applyLibrary(library);
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.OPEN_TEST: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        const exists = state.library.tests.some((t) => t.id === message.testId);
        if (!exists) {
          return Promise.resolve({ ok: false as const, error: 'Test not found.' });
        }
        const synced = syncActiveTest(state.library, state.testCase);
        const library: TestLibrary = {
          ...synced,
          activeTestId: message.testId,
        };
        applyLibrary(library);
        state = {
          ...state,
          lastError: null,
          failedStepId: null,
          currentStepIndex: null,
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.DELETE_TEST: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        if (state.library.tests.length <= 1) {
          return Promise.resolve({
            ok: false as const,
            error: 'Keep at least one test in the library.',
          });
        }
        const synced = syncActiveTest(state.library, state.testCase);
        const remaining = synced.tests.filter((t) => t.id !== message.testId);
        const activeTestId =
          synced.activeTestId === message.testId
            ? (remaining[0]?.id ?? null)
            : synced.activeTestId;
        const library: TestLibrary = {
          ...synced,
          tests: remaining,
          activeTestId,
        };
        applyLibrary(library);
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.DUPLICATE_TEST: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        const synced = syncActiveTest(state.library, state.testCase);
        const source = synced.tests.find((test) => test.id === message.testId);
        if (!source) {
          return Promise.resolve({
            ok: false as const,
            error: 'Test not found.',
          });
        }
        const copy = duplicateLibraryTest(source);
        const library: TestLibrary = {
          ...synced,
          tests: [...synced.tests, copy],
          activeTestId: copy.id,
        };
        applyLibrary(library);
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.MOVE_TEST: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        if (
          message.folderId != null &&
          !state.library.folders.some((f) => f.id === message.folderId)
        ) {
          return Promise.resolve({
            ok: false as const,
            error: 'Folder not found.',
          });
        }
        const synced = syncActiveTest(state.library, state.testCase);
        const library: TestLibrary = {
          ...synced,
          tests: synced.tests.map((test) =>
            test.id === message.testId
              ? { ...test, folderId: message.folderId }
              : test,
          ),
        };
        applyLibrary(library);
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.MOVE_FOLDER: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        if (!state.library.folders.some((f) => f.id === message.folderId)) {
          return Promise.resolve({
            ok: false as const,
            error: 'Folder not found.',
          });
        }
        if (
          message.parentId != null &&
          !state.library.folders.some((f) => f.id === message.parentId)
        ) {
          return Promise.resolve({
            ok: false as const,
            error: 'Parent folder not found.',
          });
        }
        if (
          wouldCreateFolderCycle(
            state.library.folders,
            message.folderId,
            message.parentId,
          )
        ) {
          return Promise.resolve({
            ok: false as const,
            error: 'Cannot move a folder into itself or its subfolder.',
          });
        }
        const synced = syncActiveTest(state.library, state.testCase);
        const library: TestLibrary = {
          ...synced,
          folders: synced.folders.map((folder) =>
            folder.id === message.folderId
              ? { ...folder, parentId: message.parentId }
              : folder,
          ),
        };
        applyLibrary(library);
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.RENAME_TEST: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        const synced = syncActiveTest(state.library, state.testCase);
        const library: TestLibrary = {
          ...synced,
          tests: synced.tests.map((test) =>
            test.id === message.testId
              ? {
                  ...test,
                  name: message.name.trim() || test.name,
                  updatedAt: new Date().toISOString(),
                }
              : test,
          ),
        };
        applyLibrary(library);
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.IMPORT_LIBRARY: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        if (
          !message.library ||
          message.library.version !== 1 ||
          !Array.isArray(message.library.folders) ||
          !Array.isArray(message.library.tests) ||
          message.library.tests.length === 0
        ) {
          return Promise.resolve({
            ok: false as const,
            error: 'Invalid library payload.',
          });
        }
        applyLibrary({
          version: 1,
          folders: message.library.folders,
          tests: message.library.tests,
          activeTestId: message.library.activeTestId,
        });
        state = {
          ...state,
          lastError: null,
          failedStepId: null,
          currentStepIndex: null,
          status: 'Idle',
        };
        return persistAndBroadcast().then(() => ({
          ok: true as const,
          state,
        }));
      }

      case MessageType.IMPORT_FOLDER: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        const parentId = message.parentId ?? null;
        if (
          parentId != null &&
          !state.library.folders.some((folder) => folder.id === parentId)
        ) {
          return Promise.resolve({
            ok: false as const,
            error: 'Parent folder not found.',
          });
        }
        if (
          !Array.isArray(message.folders) ||
          message.folders.length === 0 ||
          !Array.isArray(message.tests)
        ) {
          return Promise.resolve({
            ok: false as const,
            error: 'Invalid folder import payload.',
          });
        }

        const synced = syncActiveTest(state.library, state.testCase);
        const firstImportedId = message.tests[0]?.id ?? synced.activeTestId;
        const library: TestLibrary = {
          ...synced,
          folders: [...synced.folders, ...message.folders],
          tests: [...synced.tests, ...message.tests],
          activeTestId: firstImportedId,
        };
        applyLibrary(library);
        state = {
          ...state,
          lastError: null,
          failedStepId: null,
          currentStepIndex: null,
          status: 'Idle',
        };
        return persistAndBroadcast().then(() => ({
          ok: true as const,
          state,
        }));
      }

      case MessageType.STEP_RECORDED:
        appendRecordedStep(message.step);
        return Promise.resolve({ ok: true as const });

      default:
        return undefined;
    }
  });
});
