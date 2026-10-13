// Studio Hub in the window: the anonymous statistics (the choice and what is sent) and the hub's news on top of
// the shipped news.
import { useEffect, useState } from "react";

export interface HubButton { label: string; action: "url" | "dismiss" | "open"; url?: string; style: "primary" | "secondary" }
export interface HubContent { title: string; body: string; buttons: HubButton[] }
export interface HubItem {
  id: string;
  kind: "news" | "bar" | "popup";
  priority: number;
  date: string | null;
  content: Record<string, HubContent>;
  eligible: boolean;
  dismissible: boolean;
  theme: HubTheme | null;
  rules: { delay_s: number };
}
export type HubTheme = "sunset" | "orchid" | "lime" | "graphite";
export interface HubState {
  telemetry: { enabled: boolean; acknowledged: boolean; disabledByEnv: boolean; install: string | null };
  source: string | null;
  fetchedAt: number | null;
  lastError: string | null;
  items: HubItem[];
}

const CHANGED = "videosos:hub-changed";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const hubChanged = (): void => { window.dispatchEvent(new Event(CHANGED)); };

export const setTelemetry = (enabled: boolean, acknowledge = false) =>
  call<HubState["telemetry"]>("/v1/hub/telemetry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, acknowledge }) });
export const telemetryPreview = () => call<{ enabled: boolean; report: unknown }>("/v1/hub/telemetry/preview");
export const resetInstall = () => call<unknown>("/v1/hub/telemetry/reset", { method: "POST" });
export const refreshHub = () => call<unknown>("/v1/hub/refresh", { method: "POST" });
/** `button` names a click: `b0`, `b1`... the notice's buttons in order, `link` a link in its text. */
export const reportNotice = (id: string, event: "shown" | "clicked" | "dismissed", button?: string) =>
  call<{ ok: true }>(`/v1/hub/notices/${encodeURIComponent(id)}/${event}${button ? `?button=${encodeURIComponent(button)}` : ""}`, { method: "POST" });

/** The hub's state for the window's language: one poll per window a minute and after any change of the choice. */
const listeners = new Set<(state: HubState) => void>();
let shared: { lang: string; state: HubState | null; timer: number } | null = null;

function load(lang: string): void {
  call<HubState>(`/v1/hub/state?lang=${encodeURIComponent(lang)}`)
    .then((state) => {
      if (shared?.lang !== lang) return;
      shared.state = state;
      listeners.forEach((listener) => listener(state));
    })
    .catch((e: Error) => console.warn("[hub]", e.message));
}

if (typeof window !== "undefined") window.addEventListener(CHANGED, () => { if (shared) load(shared.lang); });

export function useHubState(lang: string): HubState | null {
  const [state, setState] = useState<HubState | null>(shared?.lang === lang ? shared.state : null);
  useEffect(() => {
    if (shared?.lang !== lang) {
      if (shared) window.clearInterval(shared.timer);
      shared = { lang, state: null, timer: window.setInterval(() => load(lang), 60_000) };
      load(lang);
    } else if (shared.state) {
      setState(shared.state);
    }
    listeners.add(setState);
    return () => { listeners.delete(setState); };
  }, [lang]);
  return state;
}

export function hubText(item: HubItem, lang: string): HubContent | undefined {
  return item.content[lang] ?? item.content.en ?? Object.values(item.content)[0];
}

/** The strip gradients and text colours, the hub's own (studio-hub src/shared/themes.ts), copied by value. */
export const HUB_GRADIENTS: Record<HubTheme, string> = {
  sunset: "linear-gradient(90deg, #f97316 0%, #db2777 100%)",
  orchid: "linear-gradient(90deg, #ec4899 0%, #9333ea 100%)",
  lime: "linear-gradient(90deg, #c6f24e 0%, #5be0c8 100%)",
  graphite: "linear-gradient(90deg, #27272a 0%, #3f3f46 100%)",
};
export const HUB_TEXT: Record<HubTheme, string> = { sunset: "#ffffff", orchid: "#ffffff", lime: "#0b0c0e", graphite: "#ffffff" };
const THEMES: HubTheme[] = ["sunset", "orchid", "lime", "graphite"];
/** A strip's colour: its own theme, or the next one by its place in the stack. */
export const stackTheme = (theme: HubTheme | null, index: number): HubTheme => theme ?? THEMES[index % THEMES.length];
