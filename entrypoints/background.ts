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
  applyVariables,
  normalizeDelayMs,
  normalizeEnvironments,
  normalizeStepName,
  normalizeVariableName,
  normalizeWaitMs,
  MAX_SCRIPT_CHARS,
  toTestCase,
  type ExtensionState,
  type TestCase,
  type TestLibrary,
  type TestStep,
} from '../shared/types';

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
/** Values saved by script steps during the current playback session. */
let playbackVariables = new Map<string, string>();

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

const RECORDING_SESSION_KEY = 'recordingSession';

async function getActiveTabId(): Promise<number | null> {
  const tabs = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return tabs[0]?.id ?? null;
}

async function saveRecordingSession(tabId: number | null): Promise<void> {
  if (tabId == null) {
    await browser.storage.session.remove(RECORDING_SESSION_KEY);
    return;
  }
  await browser.storage.session.set({
    [RECORDING_SESSION_KEY]: { tabId },
  });
}

async function readRecordingSession(): Promise<{ tabId: number } | null> {
  const stored = await browser.storage.session.get(RECORDING_SESSION_KEY);
  const value = stored[RECORDING_SESSION_KEY] as { tabId?: unknown } | undefined;
  if (!value || typeof value.tabId !== 'number') return null;
  return { tabId: value.tabId };
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

  await saveRecordingSession(tabId);
  return { ok: true };
}

async function stopRecording(): Promise<{ ok: true }> {
  const tabId = state.activeTabId;
  await saveRecordingSession(null);
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

type UserScriptInjectionResult = {
  result?: { ok?: boolean; error?: string; value?: string | null };
  error?: string;
};

function userScriptsApi(): {
  getScripts: () => Promise<unknown>;
  execute: (injection: {
    target: { tabId: number };
    js: { code: string }[];
    world: 'MAIN';
    injectImmediately: boolean;
  }) => Promise<UserScriptInjectionResult[]>;
} | null {
  const api = (
    browser as unknown as {
      userScripts?: {
        getScripts: () => Promise<unknown>;
        execute?: (injection: {
          target: { tabId: number };
          js: { code: string }[];
          world: 'MAIN';
          injectImmediately: boolean;
        }) => Promise<UserScriptInjectionResult[]>;
      };
    }
  ).userScripts;
  if (!api?.execute) return null;
  return { getScripts: api.getScripts, execute: api.execute };
}

function userScriptsUnavailableMessage(): string {
  return 'Script steps need Allow user scripts turned on. Open chrome://extensions, open this extension’s details, enable Allow user scripts, then reload the extension.';
}

async function runScriptOnTab(
  tabId: number,
  source: string,
): Promise<{ ok: boolean; error?: string; value?: string | null }> {
  const code = source.trim();
  if (!code) {
    return { ok: false, error: 'Script is empty.' };
  }
  if (code.length > MAX_SCRIPT_CHARS) {
    return {
      ok: false,
      error: `Script is longer than ${MAX_SCRIPT_CHARS} characters.`,
    };
  }

  const userScripts = userScriptsApi();
  if (!userScripts) {
    return { ok: false, error: userScriptsUnavailableMessage() };
  }

  try {
    await userScripts.getScripts();
  } catch {
    return { ok: false, error: userScriptsUnavailableMessage() };
  }

  const wrapped = `(async () => {
  const value = await (async () => {
${code}
  })();
  if (value == null) return { ok: true, value: null };
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean') {
    return { ok: true, value: String(value) };
  }
  try {
    return { ok: true, value: JSON.stringify(value) };
  } catch (error) {
    return { ok: false, error: 'Script result could not be saved.' };
  }
})()`;

  try {
    const results = await userScripts.execute({
      target: { tabId },
      js: [{ code: wrapped }],
      world: 'MAIN',
      injectImmediately: true,
    });
    const first = results[0];
    if (!first) {
      return { ok: false, error: 'Script did not run.' };
    }
    if (first.error) {
      return { ok: false, error: first.error };
    }
    if (first.result && first.result.ok === false) {
      return { ok: false, error: first.result.error || 'Script failed.' };
    }
    return { ok: true, value: first.result?.value ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Script failed.';
    if (/user script/i.test(message)) {
      return { ok: false, error: userScriptsUnavailableMessage() };
    }
    return { ok: false, error: message };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function playbackLookup(): Map<string, string> {
  const merged = new Map<string, string>();
  const active = state.library.environments.find(
    (env) => env.id === state.library.activeEnvironmentId,
  );
  if (active) {
    for (const variable of active.variables) {
      merged.set(variable.name, variable.value);
    }
  }
  for (const [name, value] of playbackVariables) {
    merged.set(name, value);
  }
  return merged;
}

function resolveTemplate(
  template: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (!template.includes('{{')) return { ok: true, value: template };
  return applyVariables(template, playbackLookup());
}

function resolveStepValue(
  step: TestStep,
): { ok: true; step: TestStep } | { ok: false; error: string } {
  if (step.type !== 'input' && step.type !== 'change') {
    return { ok: true, step };
  }
  if (!step.value || !step.value.includes('{{')) {
    return { ok: true, step };
  }
  const applied = applyVariables(step.value, playbackLookup());
  if (!applied.ok) return applied;
  return { ok: true, step: { ...step, value: applied.value } };
}

async function runStepOnTab(tabId: number, step: TestStep): Promise<{
  ok: boolean;
  error?: string;
  navigated?: boolean;
  cancelled?: boolean;
}> {
  const resolved = resolveStepValue(step);
  if (!resolved.ok) return resolved;
  step = resolved.step;

  if (step.type === 'divider') {
    return { ok: true };
  }

  if (step.type === 'script') {
    let source = step.value ?? '';
    if (source.includes('{{')) {
      const applied = applyVariables(source, playbackLookup());
      if (!applied.ok) return applied;
      source = applied.value;
    }
    const result = await runScriptOnTab(tabId, source);
    if (!result.ok) return result;
    const variableName = normalizeVariableName(step.variableName);
    if (variableName) {
      if (result.value == null) {
        return {
          ok: false,
          error: `Script did not return a value for {{${variableName}}}.`,
        };
      }
      playbackVariables.set(variableName, result.value);
    }
    return { ok: true };
  }

  if (step.type === 'navigate' && step.url) {
    const url = resolveTemplate(step.url);
    if (!url.ok) return url;
    await browser.tabs.update(tabId, { url: url.value });
    await waitForTabComplete(tabId);
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
  })) as { ok: boolean; error?: string; navigated?: boolean; cancelled?: boolean };

  if (result?.navigated) {
    await waitForTabComplete(tabId);
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
  playbackVariables = new Map();
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

async function playSingleStep(
  stepId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (state.mode === 'record') {
    return { ok: false, error: 'Stop recording before running a step.' };
  }
  if (state.mode === 'play') {
    return { ok: false, error: 'Playback is already running.' };
  }
  if (state.mode === 'pick') {
    return { ok: false, error: 'Finish or cancel element picking first.' };
  }

  const index = state.testCase.steps.findIndex((step) => step.id === stepId);
  const step = state.testCase.steps[index];
  if (!step || index < 0) {
    return { ok: false, error: 'Step not found.' };
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
    currentStepIndex: index,
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
      currentStepIndex: index,
      failedStepId: step.id,
    });
    return { ok: false, error: 'Failed to start playback on this page.' };
  }

  void runSingleStep(tabId, step);
  return { ok: true };
}

async function finishPlaybackIdle(tabId: number): Promise<void> {
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

async function failPlayback(
  tabId: number,
  stepId: string,
  index: number,
  error: string,
): Promise<void> {
  setState({
    mode: 'idle',
    status: 'Failed',
    lastError: error,
    failedStepId: stepId,
    currentStepIndex: index,
  });
  try {
    await setContentMode(tabId, 'idle');
  } catch {
    // ignore
  }
}

async function runSingleStep(tabId: number, step: TestStep): Promise<void> {
  const index = state.currentStepIndex ?? 0;
  try {
    const result = await runStepOnTab(tabId, step);
    if (playbackCancelled || result.cancelled) {
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
    if (!result.ok) {
      await failPlayback(tabId, step.id, index, result.error ?? 'Step failed.');
      return;
    }
  } catch (error) {
    await failPlayback(
      tabId,
      step.id,
      index,
      error instanceof Error ? error.message : 'Step failed.',
    );
    return;
  }

  if (playbackCancelled) return;
  if (step.type !== 'divider') {
    await delay(normalizeDelayMs(step.delayMs));
  }
  if (playbackCancelled) return;
  await finishPlaybackIdle(tabId);
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
      if (playbackCancelled || result.cancelled) {
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

    if (playbackCancelled) return;
    if (step.type !== 'divider') {
      await delay(normalizeDelayMs(step.delayMs));
    }
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

function isRecordingTab(tabId: number): boolean {
  return state.mode === 'record' && (state.activeTabId == null || state.activeTabId === tabId);
}

async function resumeRecordingOnTab(tabId: number): Promise<void> {
  if (!isRecordingTab(tabId)) return;
  try {
    await setContentMode(tabId, 'record');
  } catch {
    // The next recorded event retries injection.
  }
}

export default defineBackground(() => {
  const ready = (async () => {
    const library = await loadLibrary();
    applyLibrary(library);
    const recording = await readRecordingSession();
    if (recording) {
      state = {
        ...state,
        mode: 'record',
        status: 'Recording',
        activeTabId: recording.tabId,
      };
      await resumeRecordingOnTab(recording.tabId);
    }
    broadcastState();
  })();

  if (browser.sidePanel?.setPanelBehavior) {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  browser.webNavigation.onCommitted.addListener((details) => {
    void ready.then(() => {
      if (details.frameId !== 0) return;
      if (!isRecordingTab(details.tabId)) return;
      if (
        details.url.startsWith('chrome://') ||
        details.url.startsWith('chrome-extension://')
      ) {
        return;
      }
      appendNavigateStep(details.url);
    });
  });

  browser.webNavigation.onCompleted.addListener((details) => {
    void ready.then(() => {
      if (details.frameId !== 0) return;
      void resumeRecordingOnTab(details.tabId);
    });
  });

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
    return (async () => {
    await ready;
    switch (message.type) {
      case MessageType.GET_STATE:
        return Promise.resolve(state);

      case MessageType.GET_CONTENT_MODE: {
        const tabId = sender.tab?.id;
        const tabMatches =
          tabId != null &&
          (state.activeTabId == null || state.activeTabId === tabId);
        const mode =
          tabMatches && (state.mode === 'record' || state.mode === 'play')
            ? state.mode
            : 'idle';
        return { mode };
      }

      case MessageType.START_RECORDING:
        return startRecording();

      case MessageType.STOP_RECORDING:
        return stopRecording();

      case MessageType.START_PLAYBACK:
        return startPlayback();

      case MessageType.PLAY_STEP:
        return playSingleStep(message.stepId);

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
          name: normalizeStepName(message.name),
          type: message.stepType,
          selectors:
            message.stepType === 'navigate' ||
            message.stepType === 'script' ||
            message.stepType === 'divider'
              ? []
              : (message.selectors ?? []).filter(Boolean),
          value:
            message.stepType === 'input' || message.stepType === 'change'
              ? (message.value ?? '')
              : message.stepType === 'wait'
                ? String(normalizeWaitMs(message.value))
                : message.stepType === 'script'
                  ? (message.value ?? '').trim()
                  : null,
          url: message.stepType === 'navigate' ? (message.url ?? '') : null,
          delayMs:
            message.stepType === 'divider'
              ? 0
              : normalizeDelayMs(message.delayMs),
          variableName:
            message.stepType === 'script'
              ? normalizeVariableName(message.variableName)
              : null,
        });

        if (
          message.stepType === 'script' &&
          message.variableName?.trim() &&
          !step.variableName
        ) {
          return Promise.resolve({
            ok: false as const,
            error:
              'Variable name must start with a letter or underscore and use only letters, numbers, and underscores.',
          });
        }
        if (message.stepType === 'script' && !step.value) {
          return Promise.resolve({
            ok: false as const,
            error: 'Script is required.',
          });
        }
        if (
          message.stepType === 'script' &&
          (step.value?.length ?? 0) > MAX_SCRIPT_CHARS
        ) {
          return Promise.resolve({
            ok: false as const,
            error: `Script must be at most ${MAX_SCRIPT_CHARS} characters.`,
          });
        }
        if (
          message.stepType !== 'navigate' &&
          message.stepType !== 'script' &&
          message.stepType !== 'divider' &&
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

      case MessageType.SET_ACTIVE_ENVIRONMENT: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        const environmentId = message.environmentId;
        if (
          environmentId != null &&
          !state.library.environments.some((env) => env.id === environmentId)
        ) {
          return Promise.resolve({
            ok: false as const,
            error: 'Environment not found.',
          });
        }
        state = {
          ...state,
          library: {
            ...state.library,
            activeEnvironmentId: environmentId,
          },
        };
        return persistAndBroadcast().then(() => ({ ok: true as const }));
      }

      case MessageType.SAVE_ENVIRONMENTS: {
        const blocked = guardIdleEdit();
        if (blocked) return Promise.resolve(blocked);
        const environments = normalizeEnvironments(message.environments);
        const activeEnvironmentId =
          message.activeEnvironmentId != null &&
          environments.some((env) => env.id === message.activeEnvironmentId)
            ? message.activeEnvironmentId
            : null;
        state = {
          ...state,
          library: {
            ...state.library,
            environments,
            activeEnvironmentId,
          },
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
            delayMs: normalizeDelayMs(
              message.patch.delayMs ?? step.delayMs,
            ),
            name:
              message.patch.name === undefined
                ? normalizeStepName(step.name)
                : normalizeStepName(message.patch.name),
            variableName:
              message.patch.variableName === undefined
                ? normalizeVariableName(step.variableName)
                : normalizeVariableName(message.patch.variableName),
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
          environments: normalizeEnvironments(message.library.environments),
          activeEnvironmentId: message.library.activeEnvironmentId ?? null,
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
    })();
  });
});
