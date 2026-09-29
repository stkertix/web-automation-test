function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function isUnique(selector: string, root: ParentNode = document): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function buildCssPath(el: Element, maxDepth = 5): string | null {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (current && current.nodeType === Node.ELEMENT_NODE && depth < maxDepth) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') {
      parts.unshift(tag);
      break;
    }

    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === current!.tagName,
    );
    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
    }

    const candidate = parts.join(' > ');
    if (isUnique(candidate)) {
      return candidate;
    }

    current = parent;
    depth += 1;
  }

  const path = parts.join(' > ');
  return path || null;
}

function buildXPath(el: Element): string {
  if (el.id) {
    return `//*[@id="${el.id}"]`;
  }

  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(`/${tag}`);
      break;
    }

    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === current!.tagName,
    );
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`/${tag}[${index}]`);
    current = parent;
  }

  return parts.join('');
}

/** Build ordered fallback selectors for an element. */
export function buildSelectors(el: Element): string[] {
  const selectors: string[] = [];

  if (el.id && isUnique(`#${cssEscape(el.id)}`)) {
    selectors.push(`#${cssEscape(el.id)}`);
  }

  const testId = el.getAttribute('data-testid');
  if (testId) {
    const sel = `[data-testid="${cssEscape(testId)}"]`;
    if (isUnique(sel)) selectors.push(sel);
  }

  const name = el.getAttribute('name');
  if (name) {
    const tag = el.tagName.toLowerCase();
    const sel = `${tag}[name="${cssEscape(name)}"]`;
    if (isUnique(sel)) selectors.push(sel);
  }

  const cssPath = buildCssPath(el);
  if (cssPath && !selectors.includes(cssPath)) {
    selectors.push(cssPath);
  }

  const xpath = buildXPath(el);
  if (xpath) {
    selectors.push(`xpath=${xpath}`);
  }

  return selectors.length > 0 ? selectors : [el.tagName.toLowerCase()];
}

export function queryBySelector(selector: string): Element | null {
  if (selector.startsWith('xpath=')) {
    const xpath = selector.slice('xpath='.length);
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    return (result.singleNodeValue as Element | null) ?? null;
  }

  const css = selector.startsWith('css=') ? selector.slice(4) : selector;
  try {
    return document.querySelector(css);
  } catch {
    return null;
  }
}

export function resolveElement(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const el = queryBySelector(selector);
    if (el) return el;
  }
  return null;
}
