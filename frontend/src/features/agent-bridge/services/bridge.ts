/**
 * The page's side of the MCP bridge: an agent connected to VideoSOS's MCP server sees this window and works
 * in it like the person, who watches every step - a picture of the window, its controls, clicks and typing,
 * and the editor's own commands (the timeline, the media library, the playhead). The server streams each
 * command here and waits for the answer this page posts back by the command's id.
 *
 * Commands of the editor are registered by `editor-commands.ts`; the controls of any screen are reached
 * through the built-in ui_* commands. What the agent is told is English, as the tools' own descriptions
 * are; what the person sees of it goes through i18n in the components.
 */
import { domToJpeg } from "modern-screenshot";


export type BridgeArgs = Record<string, unknown>;
type Handler = (args: BridgeArgs) => unknown;

const handlers = new Map<string, Handler>();

/** Answers a command for as long as the page lives (the editor's commands, registered at start). */
export function registerBridgeCommand(command: string, handler: Handler): void {
  handlers.set(command, handler);
}

// ---------------------------------------------------------------- what the agent is told

const MESSAGES = {
  no_ref: (a: BridgeArgs) => `No element ${a.ref} on the page now; call ui_read_page again, refs change when the page does.`,
  no_label: (a: BridgeArgs) => `No control labelled "${a.text}" is visible; call ui_read_page to see what is.`,
  no_target: () => "Name the control by ref (from ui_read_page) or by its label in text.",
  not_text: () => "That element does not take text.",
  not_list: () => "That element is not a list; use ui_click on its options.",
  no_option: (a: BridgeArgs) => `The list has no option ${JSON.stringify(a.value)}; it has ${a.options}.`,
  hidden: () => "The VideoSOS window is hidden - minimised or covered by other windows - so it draws nothing to copy. Ask the person to bring it to the front, or use ui_read_page, which works either way.",
  no_screen: (a: BridgeArgs) => `The window cannot do "${a.command}" on the screen it shows now; open a project first (project_open).`,
  no_project: () => "No project is open in the editor; project_open opens one (projects_list names them).",
  unknown_field: (a: BridgeArgs) => `${a.command} does not take ${a.field}; it takes ${a.known}.`,
  missing: (a: BridgeArgs) => `${a.command} needs ${a.field}.`,
  bad_value: (a: BridgeArgs) => `${a.field} of ${a.command} must be ${a.expected}.`,
  nothing_to_undo: () => "There is nothing to undo in the editor.",
  nothing_to_redo: () => "There is nothing to redo in the editor.",
  failed: (a: BridgeArgs) => `${a.command} failed: ${a.reason}`,
} as const;

export type BridgeErrorCode = keyof typeof MESSAGES;

/** An error the agent reads as the tool's answer. */
export function bridgeError(code: BridgeErrorCode, params: BridgeArgs = {}): Error {
  return new Error(MESSAGES[code](params));
}

/** The command's arguments, refusing one it does not take: a misspelt field must not pass unseen. */
export function takeArgs(command: string, args: BridgeArgs, known: readonly string[]): BridgeArgs {
  for (const field of Object.keys(args)) {
    if (!known.includes(field)) throw bridgeError("unknown_field", { command, field, known: known.join(", ") || "nothing" });
  }
  return args;
}

/** A number argument, or undefined when it is not given. */
export function numberArg(command: string, args: BridgeArgs, field: string): number | undefined {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw bridgeError("bad_value", { command, field, expected: "a number" });
  return value;
}

/** A text argument, or undefined when it is not given. */
export function textArg(command: string, args: BridgeArgs, field: string): string | undefined {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw bridgeError("bad_value", { command, field, expected: "text" });
  return value;
}

/** A failure of the program (a refused edit, a lost connection) as the command's answer. */
export function failed(command: string, problem: unknown): Error {
  return bridgeError("failed", { command, reason: problem instanceof Error ? problem.message : String(problem) });
}

// ---------------------------------------------------------------- showing the user what the agent does

/** Every command the agent runs in the window, for the page to show it (see BridgeHost). */
export const AGENT_ACTION = "videosos:agent-action";

const FLASH = "mcp-agent-target";

/** Marks an element the agent acts on, for a moment, so the user sees where it acts. */
function flash(element: Element | null | undefined): void {
  if (!element) return;
  element.classList.remove(FLASH);
  void (element as HTMLElement).offsetWidth;
  element.classList.add(FLASH);
  window.setTimeout(() => element.classList.remove(FLASH), 1800);
}

// ---------------------------------------------------------------- what is on screen

const INTERACTIVE = 'button, a[href], input, textarea, select, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [role="slider"], [contenteditable="true"], [data-mcp-context]';

function visible(element: Element): boolean {
  const box = element.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** The name of a lucide icon a button shows instead of words. */
function iconName(element: Element): string {
  const classes = element.querySelector("svg")?.getAttribute("class") ?? "";
  const icon = classes.split(/\s+/).find((name) => name.startsWith("lucide-"));
  return icon ? `${icon.slice("lucide-".length).replace(/-/g, " ")} icon` : "";
}

/** The text written next to a field: a label, a heading, a caption before it. */
function nearbyText(element: Element): string {
  let node: Element | null = element;
  for (let depth = 0; depth < 2 && node; depth += 1) {
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.matches(INTERACTIVE) || sibling.querySelector(INTERACTIVE) || sibling.matches("h1, h2") || sibling.querySelector("h1, h2")) continue;
      const text = (sibling.textContent || "").replace(/\s+/g, " ").trim();
      if (text && text.length <= 80) return text;
    }
    node = node.parentElement;
  }
  return "";
}

/** An element's words, its parts apart: a title and its caption in two spans read as two words, not one. */
function textOf(element: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

function label(element: Element): string {
  const own = element.getAttribute("aria-label") || element.getAttribute("title") || "";
  if (own) return own.slice(0, 80);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    const tied = element.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim();
    return (tied || nearbyText(element) || element.getAttribute("placeholder") || "").slice(0, 80);
  }
  return (textOf(element) || iconName(element) || nearbyText(element)).slice(0, 80);
}

let nextRef = 1;

function refOf(element: Element): string {
  const existing = element.getAttribute("data-mcp-ref");
  if (existing) return existing;
  const ref = `e${nextRef++}`;
  element.setAttribute("data-mcp-ref", ref);
  return ref;
}

/** The dialog on top, when one is open: its controls are what the user can reach. A backdrop without controls is none. */
function openDialog(): Element | null {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .fixed.inset-0'))
    .filter((element) => visible(element) && element.querySelector(INTERACTIVE) !== null);
  return dialogs[dialogs.length - 1] ?? null;
}

/** The mark of a field whose value the agent never reads, even while its show button reveals it to the user. */
const SECRET = "data-mcp-secret";

/**
 * A key or a password: the agent's answers go to its model's provider, so of such a field it learns only
 * whether it is filled.
 */
function secret(element: Element): boolean {
  return (element instanceof HTMLInputElement && element.type === "password") || element.hasAttribute(SECRET);
}

/**
 * Marks the chosen option of every list in a copy of the page: the copy carries a list's value only as its
 * value attribute, which a drawn list ignores, so it would show its first option.
 */
function showChosenOptions(cloned: Node): void {
  if (!(cloned instanceof Element)) return;
  const lists = cloned instanceof HTMLSelectElement ? [cloned] : Array.from(cloned.querySelectorAll("select"));
  for (const list of lists) {
    const value = list.getAttribute("value");
    if (value === null) continue;
    for (const option of Array.from(list.options)) {
      if (option.value === value) option.setAttribute("selected", "");
      else option.removeAttribute("selected");
    }
  }
}

/** Draws a secret field of a copy of the page masked, as a password field is. */
function maskSecret(cloned: Node): void {
  if (cloned instanceof HTMLInputElement && cloned.hasAttribute(SECRET)) cloned.setAttribute("type", "password");
}

/** A field's value, as a line of the page shows it. */
function valueOf(element: Element): string | null {
  if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) return element.checked ? "checked" : "unchecked";
  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && secret(element)) return element.value ? "filled" : "empty";
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return JSON.stringify(element.value.slice(0, 160));
  return null;
}

/**
 * Every visible control, one line each, with the ref the other commands take. The controls of a row of a
 * list (a line of the transcript, a blur box, a title, a project) read as one line named by the row.
 */
function readPage(): string {
  const lines: string[] = [];
  const title = document.querySelector("h1, h2")?.textContent?.trim();
  if (title) lines.push(`Page: ${title}`);
  const dialog = openDialog();
  if (dialog) lines.push("A dialog is open; its controls are listed first, then the page behind it.");
  const scope = dialog ? [dialog, document.body] : [document.body];
  const seen = new Set<Element>();
  const rows = new Map<string, { at: number; parts: string[] }>();
  for (const root of scope) {
    for (const element of Array.from(root.querySelectorAll(INTERACTIVE))) {
      if (seen.has(element) || !visible(element)) continue;
      seen.add(element);
      const tag = element.tagName.toLowerCase();
      const kind = element.getAttribute("role") || (tag === "input" ? `input ${(element as HTMLInputElement).type}` : tag);
      const context = element.closest("[data-mcp-context]")?.getAttribute("data-mcp-context");
      const pressed = element.getAttribute("aria-checked") ?? element.getAttribute("aria-pressed") ?? element.getAttribute("aria-selected");
      const state = pressed ? (pressed === "true" ? " on" : " off") : "";
      const disabled = (element as HTMLButtonElement).disabled ? " (disabled)" : "";
      if (context) {
        const row = rows.get(context) ?? { at: lines.length, parts: [] };
        if (!rows.has(context)) {
          rows.set(context, row);
          lines.push("");
        }
        const value = valueOf(element);
        const name = element.hasAttribute("data-mcp-context") ? "open" : label(element) || kind;
        row.parts.push(`${refOf(element)} ${name}${value === null ? "" : `=${value}`}${state}${disabled}`);
        continue;
      }
      const parts = [refOf(element), kind, JSON.stringify(label(element))];
      if (element instanceof HTMLInputElement && element.type === "range") {
        parts.push(`value=${element.value}`, `range=${element.min || 0}..${element.max || 100}`, `step=${element.step || 1}`);
      } else if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
        parts.push(element.checked ? "checked" : "unchecked");
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        if (element.value) parts.push(secret(element) ? "filled" : `value=${JSON.stringify(element.value.slice(0, 160))}`);
        else parts.push("empty", ...(element.placeholder ? [`placeholder=${JSON.stringify(element.placeholder.slice(0, 80))}`] : []));
      }
      if (element instanceof HTMLSelectElement) {
        parts.push(`value=${JSON.stringify(element.value)}`, `options=${JSON.stringify(Array.from(element.options).map((option) => option.value))}`);
      }
      lines.push(parts.join(" ") + state + disabled);
    }
  }
  for (const [context, row] of rows) lines[row.at] = `${context}: ${row.parts.join(", ")}`;
  return lines.join("\n");
}

function find(args: BridgeArgs): HTMLElement {
  const ref = typeof args.ref === "string" ? args.ref : "";
  const text = typeof args.text === "string" ? args.text.trim().toLowerCase() : "";
  if (!ref && !text) throw bridgeError("no_target");
  let element: Element | null = null;
  if (ref) element = document.querySelector(`[data-mcp-ref="${CSS.escape(ref)}"]`);
  if (!element && text) {
    // an open dialog covers the page: a label is looked for among its controls, as the user can reach only those
    const root = openDialog() ?? document.body;
    const candidates = Array.from(root.querySelectorAll(INTERACTIVE)).filter(visible);
    element = candidates.find((candidate) => label(candidate).toLowerCase() === text) ?? candidates.find((candidate) => label(candidate).toLowerCase().includes(text)) ?? null;
  }
  if (!element) throw ref ? bridgeError("no_ref", { ref }) : bridgeError("no_label", { text: args.text });
  return element as HTMLElement;
}

/** Sets a value the way typing does, so React sees it. */
function setValue(element: HTMLElement, value: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true }));
  } else {
    throw bridgeError("not_text");
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

// ---------------------------------------------------------------- what the page logged

const logged: Array<{ level: string; text: string; at: string }> = [];

function remember(level: string, parts: unknown[]): void {
  const text = parts.map((part) => (part instanceof Error ? `${part.name}: ${part.message}` : typeof part === "string" ? part : JSON.stringify(part))).join(" ");
  logged.push({ level, text: text.slice(0, 2000), at: new Date().toISOString() });
  if (logged.length > 100) logged.shift();
}

/** Keeps the page's errors and warnings for an agent to read. */
function watchConsole(): void {
  for (const level of ["error", "warn"] as const) {
    const original = console[level].bind(console);
    console[level] = (...parts: unknown[]) => {
      remember(level, parts);
      original(...parts);
    };
  }
  window.addEventListener("error", (event) => remember("error", [event.message, `${event.filename}:${event.lineno}`]));
  window.addEventListener("unhandledrejection", (event) => remember("error", ["unhandled rejection", event.reason]));
}

const builtIn: Record<string, Handler> = {
  async screenshot(args) {
    takeArgs("ui_screenshot", args, ["max_width"]);
    // a window that is minimised or covered draws no frames, and the copy waits for one
    if (document.visibilityState === "hidden") throw bridgeError("hidden");
    const scale = Math.min(1, (numberArg("ui_screenshot", args, "max_width") ?? 1600) / window.innerWidth);
    const data = await domToJpeg(document.documentElement, { scale, quality: 0.9, width: window.innerWidth, height: window.innerHeight, backgroundColor: getComputedStyle(document.body).backgroundColor, onCloneEachNode: maskSecret, onCloneNode: showChosenOptions });
    return { image: data.replace(/^data:image\/jpeg;base64,/, ""), mime: "image/jpeg", text: `${window.innerWidth}x${window.innerHeight} window` };
  },
  read_page: (args) => {
    takeArgs("ui_read_page", args, []);
    return { text: readPage() };
  },
  console: (args) => {
    takeArgs("ui_console", args, []);
    return { text: logged.length ? logged.map((entry) => `${entry.at} ${entry.level}: ${entry.text}`).join("\n") : "Nothing logged." };
  },
  async click(args) {
    takeArgs("ui_click", args, ["ref", "text"]);
    const element = find(args);
    element.scrollIntoView({ block: "center" });
    flash(element);
    // an input opens its list on focus (the language pickers), as the user's click does
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.focus();
    element.click();
    await settle();
    return { text: `Clicked ${label(element) || element.tagName.toLowerCase()}.` };
  },
  async type(args) {
    takeArgs("ui_type", args, ["ref", "text", "value", "submit"]);
    if (typeof args.value !== "string") throw bridgeError("missing", { command: "ui_type", field: "value" });
    const element = find(args);
    element.scrollIntoView({ block: "center" });
    flash(element);
    element.focus();
    setValue(element, args.value);
    if (args.submit) element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    element.blur();
    await settle();
    return { text: "Typed." };
  },
  async select(args) {
    takeArgs("ui_select", args, ["ref", "text", "value"]);
    if (typeof args.value !== "string") throw bridgeError("missing", { command: "ui_select", field: "value" });
    const element = find(args);
    if (!(element instanceof HTMLSelectElement)) throw bridgeError("not_list");
    const value = args.value;
    const options = Array.from(element.options).map((option) => option.value);
    if (!options.includes(value)) throw bridgeError("no_option", { value, options: JSON.stringify(options) });
    element.scrollIntoView({ block: "center" });
    flash(element);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    return { text: `Selected ${element.value}.` };
  },
  async press_key(args) {
    takeArgs("ui_press_key", args, ["key"]);
    if (typeof args.key !== "string" || !args.key.trim()) throw bridgeError("missing", { command: "ui_press_key", field: "key" });
    const target = (document.activeElement as HTMLElement | null) ?? document.body;
    const combo = args.key;
    // Ctrl+K, Shift+Tab: modifiers before the key, joined by +
    const parts = combo.split("+").map((part) => part.trim()).filter(Boolean);
    const key = (parts.length > 1 ? parts[parts.length - 1] : combo) ?? combo;
    const held = parts.slice(0, -1).map((part) => part.toLowerCase());
    const init = {
      key: key.length === 1 ? key.toLowerCase() : key,
      code: key === " " || key.toLowerCase() === "space" ? "Space" : key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      cancelable: true,
      ctrlKey: held.includes("ctrl") || held.includes("control"),
      shiftKey: held.includes("shift"),
      altKey: held.includes("alt"),
      metaKey: held.includes("meta") || held.includes("cmd") || held.includes("win"),
    };
    if (init.key.toLowerCase() === "space") init.key = " ";
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    await settle();
    return { text: `Pressed ${combo}.` };
  },
  async scroll(args) {
    takeArgs("ui_scroll", args, ["direction", "amount", "ref", "text"]);
    const amount = Number(args.amount ?? 600) * (args.direction === "up" ? -1 : 1);
    const element = args.ref || args.text ? find(args) : null;
    if (element) {
      element.scrollIntoView({ block: "center" });
      flash(element);
    } else {
      (document.querySelector("[data-kb-scroll]") ?? document.scrollingElement ?? document.body).scrollBy({ top: amount });
    }
    await settle();
    return { text: "Scrolled." };
  },
};

/** Commands that only look: the user is not shown them as the agent's actions. */
const LOOKING = new Set(["read_page", "console", "editor_state", "timeline_get", "media_list", "screenshot"]);

// ---------------------------------------------------------------- the connection

let started = false;

export function startBridge(): void {
  if (started || typeof window === "undefined" || typeof EventSource === "undefined") return;
  started = true;
  watchConsole();
  // the number the service gave this window, for the focus notices below
  let current: number | null = null;
  // an agent's command goes to the window the person turned to, not the one opened last
  const reportFocus = () => {
    if (current === null || document.visibilityState !== "visible" || !document.hasFocus()) return;
    void fetch("/mcp/window/focus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ window: current }) })
      .catch((problem) => console.error("[ERROR] VideoSOS did not learn which window is in front:", problem));
  };
  window.addEventListener("focus", reportFocus);
  document.addEventListener("visibilitychange", reportFocus);
  const connect = () => {
    const events = new EventSource("/mcp/window");
    // the service names this window first; a command for another window is not ours
    let ours: number | null = null;
    events.onmessage = async (message) => {
      let data: { window?: number; id?: string; command?: string; args?: BridgeArgs };
      try {
        data = JSON.parse(message.data);
      } catch (problem) {
        console.error("[ERROR] VideoSOS sent the window a message that is not JSON:", message.data, problem);
        return;
      }
      if (data.id === undefined) {
        ours = data.window ?? null;
        current = ours;
        reportFocus();
        return;
      }
      if (data.window !== ours || !data.command) return;
      const { id, command } = data;
      const handler = handlers.get(command) ?? builtIn[command];
      let body: { id: string; result?: unknown; error?: string };
      if (!handler) {
        body = { id, error: bridgeError("no_screen", { command }).message };
      } else {
        if (!LOOKING.has(command)) window.dispatchEvent(new CustomEvent(AGENT_ACTION, { detail: { command, args: data.args ?? {} } }));
        try {
          body = { id, result: (await handler(data.args ?? {})) ?? null };
        } catch (problem) {
          body = { id, error: problem instanceof Error ? problem.message : String(problem) };
        }
      }
      await fetch("/mcp/window/result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .catch((problem) => console.error("[ERROR] the answer to the agent did not reach VideoSOS:", problem));
    };
    // the service restarting closes the stream; the page subscribes again
    events.onerror = () => {
      events.close();
      setTimeout(connect, 2000);
    };
  };
  connect();
}
