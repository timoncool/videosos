import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Clapperboard, X } from "lucide-react";
import { exactMoment, relativeMoment } from "../services/dates";
import { clearJournal, journalSentence, removeJournalLine, useJournal, type JournalLine } from "../services/journal";

const TONE: Record<string, string> = {
  error: "text-[var(--color-danger)]",
  success: "text-[var(--color-accent)]",
  warning: "text-[var(--color-warn)]",
};

/** The journal: what agents changed and what VideoSOS said, newest first. */
export function JournalPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { lines, error } = useJournal();

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  const sentence = (line: JournalLine) => journalSentence(t, line);

  const report = (problem: unknown) => console.error("[ERROR] the journal:", problem);

  return (
    <aside aria-label={t("journal.title")}
           className="fixed inset-y-0 right-0 z-[55] flex w-[min(24rem,100vw)] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4">
        <h2 className="text-sm font-semibold text-[var(--color-text)]">{t("journal.title")}</h2>
        <span className="tabnum text-xs text-[var(--color-muted)]">{lines.length}</span>
        {lines.length > 0 && (
          <button type="button" onClick={() => void clearJournal().catch(report)}
                  className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]">
            {t("journal.clear")}
          </button>
        )}
        <button type="button" onClick={onClose} aria-label={t("hub.close")} title={t("hub.close")}
                className={`rounded-full p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] ${lines.length > 0 ? "" : "ml-auto"}`}>
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {error ? (
          <p role="alert" className="px-1 py-3 text-xs leading-5 text-[var(--color-danger)]">{t("journal.unreadable", { error })}</p>
        ) : lines.length === 0 ? (
          <p className="px-1 py-3 text-xs leading-5 text-[var(--color-muted)]">{t("journal.empty")}</p>
        ) : (
          <ul className="space-y-1">
            {lines.map((line) => {
              const when = new Date(line.at * 1000);
              const agent = line.source === "agent";
              return (
                <li key={line.id} className="group flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-[var(--color-surface-2)]">
                  <span role="img" aria-label={agent ? t("journal.agent") : t("journal.app")} title={agent ? t("journal.agent") : t("journal.app")}
                        className={`mt-0.5 shrink-0 ${agent ? "text-[var(--color-accent-2)]" : TONE[line.tone] ?? "text-[var(--color-muted)]"}`}>
                    {agent ? <Bot size={15} /> : <Clapperboard size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm leading-snug text-[var(--color-text)]">{sentence(line)}</span>
                    <time dateTime={when.toISOString()} title={exactMoment(when, i18n.language)} className="block text-[11px] text-[var(--color-muted)]">
                      {relativeMoment(when, i18n.language)}
                    </time>
                  </span>
                  <button type="button" onClick={() => void removeJournalLine(line.id).catch(report)} aria-label={t("journal.remove")} title={t("journal.remove")}
                          className="shrink-0 rounded-md p-1 text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-overlay)] hover:text-[var(--color-text)] focus-visible:opacity-100 group-hover:opacity-100">
                    <X size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
