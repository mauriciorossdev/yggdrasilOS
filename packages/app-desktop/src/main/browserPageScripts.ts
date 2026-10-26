// Source for the scripts the Browser tab runs inside the loaded page
// (webContents.executeJavaScript) on behalf of an agent: read, click, type.
// Kept as plain strings built from JSON-encoded arguments — never string
// concatenation of raw input — so a selector or text containing quotes,
// backticks or `</script>` can't break out of its literal. Each script is an
// async IIFE that resolves with a JSON-serializable result and never throws:
// failures come back as `{ ok: false, error }`.
//
// The page is untrusted. Whatever these return is page-controlled data.

/** Shared helper source: best-effort readable CSS selector for an element (same idea as browserTabPickerPreload.ts's, which can't be imported into a page). */
const SELECTOR_HELPER = `
function __yggSelector(el) {
  if (el.id) return "#" + CSS.escape(el.id);
  var parts = [];
  var node = el;
  for (var depth = 0; node && node.nodeType === 1 && depth < 5; depth++) {
    var part = node.tagName.toLowerCase();
    var parent = node.parentElement;
    if (parent) {
      var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
    }
    parts.unshift(part);
    if (node.id) { parts[0] = "#" + CSS.escape(node.id); break; }
    node = parent;
  }
  return parts.join(" > ");
}
`;

export const DEFAULT_READ_MAX_CHARS = 20_000;
export const MAX_READ_MAX_CHARS = 100_000;

export function clampMaxChars(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_READ_MAX_CHARS;
  return Math.min(Math.floor(value), MAX_READ_MAX_CHARS);
}

/** Visible text of the page plus a list of its interactive elements (with selectors browser_click/browser_type accept). */
export function buildReadScript(maxChars: number): string {
  return `(async function () {
${SELECTOR_HELPER}
  try {
    var max = ${JSON.stringify(maxChars)};
    var body = document.body;
    var full = body ? (body.innerText || "") : "";
    var text = full.length > max ? full.slice(0, max) : full;
    var nodes = document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [role="link"], [contenteditable=""], [contenteditable="true"]');
    var elements = [];
    for (var i = 0; i < nodes.length && elements.length < 80; i++) {
      var el = nodes[i];
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      var item = { tag: el.tagName.toLowerCase(), selector: __yggSelector(el) };
      var label = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().replace(/\\s+/g, " ").slice(0, 80);
      if (label) item.text = label;
      if (el.tagName === "A" && el.href) item.href = el.href;
      if (el.tagName === "INPUT") item.type = el.type;
      if (el.placeholder) item.placeholder = el.placeholder;
      elements.push(item);
    }
    return { ok: true, url: location.href, title: document.title, text: text, truncated: full.length > max, totalChars: full.length, elements: elements };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
})()`;
}

/** Scrolls the element into view and clicks it. */
export function buildClickScript(selector: string): string {
  return `(async function () {
  try {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: "No element matches the selector." };
    el.scrollIntoView({ block: "center", inline: "center" });
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    el.click();
    return { ok: true, tag: el.tagName.toLowerCase(), text: (el.innerText || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 80) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
})()`;
}

/** Replaces the value of an input/textarea/contenteditable (firing the events frameworks listen for), optionally submitting. */
export function buildTypeScript(selector: string, text: string, submit: boolean): string {
  return `(async function () {
  try {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: "No element matches the selector." };
    var text = ${JSON.stringify(text)};
    el.scrollIntoView({ block: "center", inline: "center" });
    el.focus();
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      // The native setter, not el.value = ...: React/Vue track the value
      // through the property descriptor and would otherwise ignore the change.
      var proto = tag === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, text);
    } else {
      return { ok: false, error: "Element is not a text input, textarea or contenteditable." };
    }
    if (${JSON.stringify(submit)}) {
      var init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", init));
      el.dispatchEvent(new KeyboardEvent("keypress", init));
      el.dispatchEvent(new KeyboardEvent("keyup", init));
      if (el.form && typeof el.form.requestSubmit === "function") el.form.requestSubmit();
    }
    return { ok: true, tag: tag.toLowerCase() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
})()`;
}
