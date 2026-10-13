import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { HUB_GRADIENTS, HUB_TEXT, hubChanged, hubText, reportNotice, stackTheme, type HubItem } from "../services/studio-hub";

const MAX_VISIBLE = 3;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const id = `${key}-${index++}`;
    if (match[1]) out.push(<strong key={id} className="font-semibold">{match[1]}</strong>);
    else out.push(<a key={id} href={match[3]} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:opacity-90">{match[2]}</a>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The hub's strips across the top of the window: full width, centred text with links, a close button; at most three. */
export function HubBars({ items }: { items: HubItem[] }) {
  const { t, i18n } = useTranslation();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const visible = items
    .filter((item) => item.kind === "bar" && item.eligible && !closed.has(item.id) && elapsed >= (item.rules?.delay_s ?? 0))
    .slice(0, MAX_VISIBLE);
  const shownIds = visible.map((item) => item.id).join(",");
  useEffect(() => {
    for (const id of shownIds ? shownIds.split(",") : []) reportNotice(id, "shown").catch((e: Error) => console.warn("[hub] shown not recorded:", e.message));
  }, [shownIds]);
  if (!visible.length) return null;
  const close = (id: string) => {
    setClosed((previous) => new Set(previous).add(id));
    reportNotice(id, "dismissed").catch((e: Error) => console.warn("[hub] close not recorded:", e.message)).finally(hubChanged);
  };
  return (
    <div role="region" aria-label={t("hub.notices")} className="shrink-0">
      {visible.map((item, index) => {
        const theme = stackTheme(item.theme, index);
        const content = hubText(item, i18n.language.split("-")[0] ?? "en");
        return (
          <div key={item.id} className="flex items-start justify-between gap-3 px-6 py-2 text-[13px] leading-6"
               style={{ background: HUB_GRADIENTS[theme], color: HUB_TEXT[theme] }}
               onClick={(e) => { if ((e.target as HTMLElement).closest("a")) reportNotice(item.id, "clicked", "link").catch(() => undefined); }}>
            <div className="w-full text-center">{inline((content?.body || content?.title || "").replace(/\s*\n\s*/g, " "), item.id)}</div>
            {item.dismissible && (
              <button type="button" onClick={() => close(item.id)} aria-label={t("hub.close")} className="shrink-0 rounded-md p-0.5 opacity-85 hover:opacity-100">
                <X size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
