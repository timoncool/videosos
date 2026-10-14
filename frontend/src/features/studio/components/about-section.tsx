import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bug, Check, CodeXml, Copy, FolderOpen, Scale, Tag } from "lucide-react";
import { api, type AppPaths } from "../services/studio-api";
import { DONATE, LINKS } from "../services/links";
import { ProgramFamily } from "./program-family";

/** The author's crypto addresses, the same as in DONATE.md and Bulka's support tab. */
const CRYPTO = [
  { name: "BTC — Bitcoin", address: "1E7dHL22RpyhJGVpcvKdbyZgksSYkYeEBC" },
  { name: "ETH — Ethereum (ERC20)", address: "0xb5db65adf478983186d4897ba92fe2c25c594a0c" },
  { name: "USDT — Tether (TRC20)", address: "TQST9Lp2TjK6FiVkn4fwfGUee7NmkxEE7C" },
] as const;
const TIERS = ["5", "25", "100", "500"] as const;

function CryptoRow({ name, address }: { name: string; address: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-40 shrink-0 text-[12px] text-[var(--color-muted)]">{name}</span>
        <span className="mono min-w-0 flex-1 truncate text-[11px]" title={address}>{address}</span>
        <button type="button" onClick={() => void copy()} aria-label={t("help.copy")} title={copied ? t("prefs.copied") : t("help.copy")}
          className="shrink-0 rounded-md p-1 text-[var(--color-muted)] hover:text-[var(--color-text)]">
          {copied ? <Check size={13} className="text-[var(--color-accent)]" /> : <Copy size={13} />}
        </button>
      </div>
      {error && <p role="alert" className="mono mt-1 break-words text-[10px] text-[var(--color-warn)]">{error}</p>}
    </div>
  );
}

function PathRow({ label, path }: { label: string; path: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-[12px] text-[var(--color-muted)]">{label}</span>
        <span className="mono text-[11px] truncate flex-1 min-w-0" title={path}>{path}</span>
        <button type="button" onClick={() => { void copy(); }} aria-label={t("prefs.copyPath")} title={copied ? t("prefs.copied") : t("prefs.copyPath")}
          className="shrink-0 p-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)]">
          {copied ? <Check size={13} className="text-[var(--color-accent)]" /> : <Copy size={13} />}
        </button>
        <button type="button" onClick={() => { setError(null); api.reveal(path).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }}
          aria-label={t("prefs.openFolder")} title={t("prefs.openFolder")}
          className="shrink-0 p-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)]">
          <FolderOpen size={13} />
        </button>
      </div>
      {error && <p role="alert" className="mt-1 mono text-[10px] text-[var(--color-warn)] break-words">{error}</p>}
    </div>
  );
}

// About: the version, the links to the repository, issues and license, where the data lives, the author and support.
export default function AboutSection() {
  const { t } = useTranslation();
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [pathsError, setPathsError] = useState<string | null>(null);
  useEffect(() => {
    api.appPaths()
      .then(setPaths)
      .catch((e: unknown) => setPathsError(t("prefs.pathsFailed", { error: e instanceof Error ? e.message : String(e) })));
  }, [t]);

  const link = "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[12px] text-[var(--color-text)] hover:border-[var(--color-accent)] transition-colors";
  const heading = "text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted)] mb-2";
  return (
    <div className="w-full min-w-0 space-y-6">
      <div className="flex items-center gap-3">
        <img src="/videosos-icon.svg" alt="" width={36} height={36} className="rounded-lg" />
        <div>
          <div className="font-semibold text-[16px]">{t("app.name")} <span className="mono text-[12px] font-normal text-[var(--color-muted)]">v{__APP_VERSION__}</span></div>
          <div className="text-[13px] text-[var(--color-muted)]">{t("app.tagline")}</div>
        </div>
      </div>

      <section>
        <h4 className={heading}>{t("prefs.links")}</h4>
        <div className="flex flex-wrap gap-2">
          <a href={LINKS.repo} target="_blank" rel="noreferrer" className={link}><CodeXml size={13} />{t("prefs.repo")}</a>
          <a href={LINKS.issues} target="_blank" rel="noreferrer" className={link}><Bug size={13} />{t("prefs.issues")}</a>
          <a href={LINKS.releases} target="_blank" rel="noreferrer" className={link}><Tag size={13} />{t("prefs.releases")}</a>
          <a href={LINKS.license} target="_blank" rel="noreferrer" className={link}><Scale size={13} />{t("prefs.license")}</a>
        </div>
      </section>

      <section>
        <h4 className={`${heading} flex items-center gap-1.5`}><FolderOpen size={12} />{t("prefs.dataTitle")}</h4>
        <p className="mb-2 text-[12px] text-[var(--color-muted)]">{t("prefs.dataHint")}</p>
        {pathsError && <p role="alert" className="mono text-[11px] text-[var(--color-warn)] break-words">{pathsError}</p>}
        {paths && (
          <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)] bg-[var(--color-surface-2)]/40">
            <PathRow label={t("prefs.dataDir")} path={paths.data_dir} />
            <PathRow label={t("prefs.projectsDir")} path={paths.projects_dir} />
            <PathRow label={t("prefs.generationsDir")} path={paths.generations_dir} />
            <PathRow label={t("prefs.exportsDir")} path={paths.exports_dir} />
            <PathRow label={t("prefs.logsDir")} path={paths.logs_dir} />
          </div>
        )}
      </section>

      <ProgramFamily />

      <section>
        <h4 className={heading}>{t("help.donateTitle")}</h4>
        <p className="text-[12px] leading-relaxed text-[var(--color-muted)]">
          {t("help.madeBy")} <a className="text-[var(--color-text)] hover:text-[var(--color-accent)]" href={DONATE.telegram} target="_blank" rel="noreferrer">Nerual Dreming</a> — {t("help.founder")} <a className="text-[var(--color-text)] hover:text-[var(--color-accent)]" href="https://artgeneration.me" target="_blank" rel="noreferrer">ArtGeneration.me</a>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href={DONATE.dalink} target="_blank" rel="noreferrer" className={link}>{t("help.card")}</a>
          <a href={DONATE.boosty} target="_blank" rel="noreferrer" className={link}>{t("help.boostySub")}</a>
          <a href={DONATE.telegram} target="_blank" rel="noreferrer" className={link}>Telegram</a>
        </div>
        <p className="mt-3 mb-1 text-[12px] font-medium text-[var(--color-text)]">{t("help.crypto")}</p>
        <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)] bg-[var(--color-surface-2)]/40">
          {CRYPTO.map((coin) => <CryptoRow key={coin.address} name={coin.name} address={coin.address} />)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          {TIERS.map((tier) => (
            <div key={tier} className="rounded-md border border-[var(--color-border)] p-2 text-center">
              <div className="font-medium text-[var(--color-text)]">${tier}</div>
              <div className="text-[var(--color-muted)]">{t(`help.tier${tier}`)}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">{t("help.thanks")}</p>
      </section>
    </div>
  );
}
