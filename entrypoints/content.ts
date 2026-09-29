import { MessageType, type ExtensionMessage } from '../shared/messages';
import { buildSelectors, resolveElement } from '../shared/selector';
import { createStep, type ExtensionMode, type TestStep } from '../shared/types';

const INPUT_DEBOUNCE_MS = 400;

let mode: ExtensionMode = 'idle';
let pickActive = false;
let pickOverlay: HTMLDivElement | null = null;
let inputTimer: ReturnType<typeof setTimeout> | null = null;
let pendingInput: { el: Element; value: string } | null = null;
let suppressRecording = false;
let clickTimer: ReturnType<typeof setTimeout> | null = null;
let pendingClickEl: Element | null = null;

function ensurePickOverlay(): HTMLDivElement {
  if (pickOverlay?.isConnected) return pickOverlay;
  const el = document.createElement('div');
  el.setAttribute('data-automation-pick-overlay', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    border: '2px solid #2563eb',
    background: 'rgba(37, 99, 235, 0.12)',
    borderRadius: '2px',
    display: 'none',
    boxSizing: 'border-box',
  });
  document.documentElement.appendChild(el);
  pickOverlay = el;
  return el;
}

function updatePickHighlight(target: Element | null): void {
  const overlay = ensurePickOverlay();
  if (!target || target === document.documentElement || target === document.body) {
    overlay.style.display = 'none';
    return;
  }
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    overlay.style.display = 'none';
    return;
  }
  overlay.style.display = 'block';
  overlay.style.top = `${Math.max(0, rect.top)}px`;
  overlay.style.left = `${Math.max(0, rect.left)}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

function removePickOverlay(): void {
  pickOverlay?.remove();
  pickOverlay = null;
}

function onPickMove(event: MouseEvent): void {
  if (!pickActive) return;
  const target = event.target;
  if (!(target instanceof Element)) {
    updatePickHighlight(null);
    return;
  }
  updatePickHighlight(target);
}

function onPickClick(event: MouseEvent): void {
  if (!pickActive) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target === document.documentElement || target === document.body) return;

  const selectors = buildSelectors(target);
  setPickActive(false);
  void browser.runtime.sendMessage({
    type: MessageType.ELEMENT_PICKED,
    selectors,
  } satisfies ExtensionMessage);
}

function onPickKeydown(event: KeyboardEvent): void {
  if (!pickActive) return;
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  setPickActive(false);
  void browser.runtime.sendMessage({
    type: MessageType.CANCEL_ELEMENT_PICK,
  } satisfies ExtensionMessage);
}

function setPickActive(active: boolean): void {
  if (pickActive === active) {
    if (!active) {
      updatePickHighlight(null);
      removePickOverlay();
    }
    return;
  }
  pickActive = active;
  if (active) {
    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKeydown, true);
    document.documentElement.style.cursor = 'crosshair';
    ensurePickOverlay();
  } else {
    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKeydown, true);
    document.documentElement.style.cursor = '';
    updatePickHighlight(null);
    removePickOverlay();
  }
}

function isEditable(
  el: Element,
): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

function getInputValue(el: Element): string {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      return el.checked ? 'true' : 'false';
    }
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  return '';
}

function emitStep(step: TestStep): void {
  void browser.runtime.sendMessage({
    type: MessageType.STEP_RECORDED,
    step,
  } satisfies ExtensionMessage);
}

function flushPendingInput(): void {
  if (!pendingInput) return;
  const { el, value } = pendingInput;
  pendingInput = null;
  emitStep(
    createStep({
      type: 'input',
      selectors: buildSelectors(el),
      value,
      url: null,
    }),
  );
}

function scheduleInput(el: Element): void {
  pendingInput = { el, value: getInputValue(el) };
  if (inputTimer) clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    inputTimer = null;
    flushPendingInput();
  }, INPUT_DEBOUNCE_MS);
}

function onClick(event: MouseEvent): void {
  if (mode !== 'record' || suppressRecording) return;
  const target = event.target;
  if (!(target instanceof Element)) return;

  // Prefer the closest interactive element.
  const el =
    target.closest('button, a, input, select, textarea, [role="button"]') ??
    target;

  if (
    el instanceof HTMLInputElement &&
    (el.type === 'checkbox' || el.type === 'radio')
  ) {
    return;
  }
  if (el instanceof HTMLSelectElement) return;

  if (event.detail === 2) {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      pendingClickEl = null;
    }
    emitStep(
      createStep({
        type: 'dblclick',
        selectors: buildSelectors(el),
        value: null,
        url: null,
      }),
    );
    return;
  }

  if (event.detail === 1) {
    pendingClickEl = el;
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      const clickEl = pendingClickEl;
      pendingClickEl = null;
      if (!clickEl || mode !== 'record' || suppressRecording) return;
      emitStep(
        createStep({
          type: 'click',
          selectors: buildSelectors(clickEl),
          value: null,
          url: null,
        }),
      );
    }, 250);
  }
}

function onInput(event: Event): void {
  if (mode !== 'record' || suppressRecording) return;
  const target = event.target;
  if (!(target instanceof Element) || !isEditable(target)) return;
  if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio')) {
    return;
  }
  if (target instanceof HTMLSelectElement) return;
  scheduleInput(target);
}

function onChange(event: Event): void {
  if (mode !== 'record' || suppressRecording) return;
  const target = event.target;
  if (!(target instanceof Element)) return;

  if (
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement &&
      (target.type === 'checkbox' || target.type === 'radio'))
  ) {
    if (inputTimer) {
      clearTimeout(inputTimer);
      inputTimer = null;
      pendingInput = null;
    }
    emitStep(
      createStep({
        type: 'change',
        selectors: buildSelectors(target),
        value: getInputValue(target),
        url: null,
      }),
    );
  }
}

function onSubmit(event: Event): void {
  if (mode !== 'record' || suppressRecording) return;
  const target = event.target;
  if (!(target instanceof HTMLFormElement)) return;
  emitStep(
    createStep({
      type: 'submit',
      selectors: buildSelectors(target),
      value: null,
      url: null,
    }),
  );
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as {
    value?: PropertyDescriptor;
  };
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function runStep(step: TestStep): Promise<{
  ok: boolean;
  error?: string;
  navigated?: boolean;
}> {
  suppressRecording = true;
  try {
    if (step.type === 'navigate') {
      // Handled by background.
      return { ok: true, navigated: true };
    }

    const el = resolveElement(step.selectors);
    if (!el) {
      return {
        ok: false,
        error: `Element not found for selectors: ${step.selectors.join(', ')}`,
      };
    }

    switch (step.type) {
      case 'click': {
        (el as HTMLElement).click();
        return { ok: true };
      }
      case 'dblclick': {
        el.dispatchEvent(
          new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }),
        );
        return { ok: true };
      }
      case 'input': {
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement
        ) {
          setNativeValue(el, step.value ?? '');
          return { ok: true };
        }
        return { ok: false, error: 'Target is not an input element.' };
      }
      case 'change': {
        if (el instanceof HTMLSelectElement) {
          el.value = step.value ?? '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        }
        if (el instanceof HTMLInputElement) {
          if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = step.value === 'true';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
          }
          setNativeValue(el, step.value ?? '');
          return { ok: true };
        }
        return { ok: false, error: 'Target does not support change.' };
      }
      case 'submit': {
        if (el instanceof HTMLFormElement) {
          if (typeof el.requestSubmit === 'function') {
            el.requestSubmit();
          } else {
            el.submit();
          }
          return { ok: true, navigated: true };
        }
        const form = el.closest('form');
        if (form) {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.submit();
          }
          return { ok: true, navigated: true };
        }
        return { ok: false, error: 'No form found to submit.' };
      }
      default:
        return { ok: false, error: `Unsupported step type: ${step.type}` };
    }
  } finally {
    // Keep suppress briefly so synthetic events are ignored if mode flips.
    setTimeout(() => {
      suppressRecording = false;
    }, 50);
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('submit', onSubmit, true);

    browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
      switch (message.type) {
        case MessageType.SET_MODE:
          if (mode === 'record' && message.mode !== 'record') {
            flushPendingInput();
          }
          if (message.mode !== 'pick' && pickActive) {
            setPickActive(false);
          }
          mode = message.mode;
          suppressRecording = message.mode === 'play';
          return Promise.resolve({ ok: true });

        case MessageType.SET_PICK_ACTIVE:
          setPickActive(message.active);
          return Promise.resolve({ ok: true });

        case MessageType.RUN_STEP:
          return runStep(message.step);

        case MessageType.CANCEL_PLAYBACK:
          mode = 'idle';
          suppressRecording = false;
          setPickActive(false);
          return Promise.resolve({ ok: true });

        default:
          return undefined;
      }
    });
  },
});
