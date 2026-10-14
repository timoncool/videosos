import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";

/** The author's other programs for the About page, as the music studios show their family. */
const PROGRAMS = [
  { id: "dub", name: "Dub Studio", page: "https://timoncool.github.io/dub-studio/" },
  { id: "yue2", name: "YuE2 Studio", page: "https://timoncool.github.io/YuE2-Studio/" },
  { id: "minimax", name: "MiniMax Music3 Studio", page: "https://timoncool.github.io/MiniMax-Music3-Studio/" },
  { id: "ace", name: "ACE-Step Studio", page: "https://timoncool.github.io/ACE-Step-Studio/" },
  { id: "bulka", name: "Bulka", page: "https://bulka.app/" },
  { id: "dungeon", name: "Dungeon Ultimate", page: "https://github.com/timoncool/dungeon-ultimate" },
] as const;

export function ProgramFamily() {
  const { t } = useTranslation();
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{t("family.title")}</h4>
      <div className="grid gap-2">
        {PROGRAMS.map((program) => (
          <a key={program.id} href={program.page} target="_blank" rel="noopener noreferrer"
             className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2 transition-colors hover:border-[var(--color-accent)]">
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-[var(--color-text)]">{program.name}</span>
              <span className="block text-[11px] leading-4 text-[var(--color-muted)]">{t(`family.${program.id}`)}</span>
            </span>
            <ExternalLink size={13} className="mt-0.5 shrink-0 text-[var(--color-muted)]" />
          </a>
        ))}
      </div>
    </section>
  );
}
