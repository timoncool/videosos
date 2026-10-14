import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollText } from "lucide-react";
import { JournalPanel } from "./journal-panel";

/** The journal's button for a toolbar, and the panel it opens. */
export default function JournalButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((value) => !value)} title={t("journal.title")} aria-label={t("journal.title")} aria-pressed={open}
              className={`relative rounded-md p-1.5 transition-colors ${open ? "text-[var(--color-accent)]" : "text-[var(--color-muted)] hover:text-[var(--color-text)]"}`}>
        <ScrollText size={16} />
      </button>
      {open && <JournalPanel onClose={() => setOpen(false)} />}
    </>
  );
}
