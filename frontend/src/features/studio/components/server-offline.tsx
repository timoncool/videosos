import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlugZap, RefreshCw } from "lucide-react";
import { api } from "../services/studio-api";

const RETRY_MS = 2000;

// The program's service does not answer on its port: shown only on a network failure, never on a slow answer.
// The window checks every 2 s and reloads as soon as the service answers, so it comes back by itself.
export default function ServerOffline() {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      if (await api.serverReachable()) window.location.reload();
      else setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const started = Date.now();
    const tick = window.setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    const retry = window.setInterval(() => { void check(); }, RETRY_MS);
    return () => { window.clearInterval(tick); window.clearInterval(retry); };
  }, [check]);

  return (
    <div className="flex-1 grid place-items-center px-6 py-10">
      <div role="alert" className="w-full max-w-md text-center">
        <div className="mx-auto grid place-items-center w-12 h-12 rounded-full bg-[color-mix(in_oklab,var(--color-warn)_14%,transparent)] text-[var(--color-warn)]">
          <PlugZap size={22} />
        </div>
        <h2 className="mt-4 text-2xl font-extrabold tracking-tight">{t("offline.title")}</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--color-muted)]">{t("offline.body")}</p>
        <p className="mt-2 mono tabnum text-[12px] text-[var(--color-muted)]">{t("offline.retrying", { seconds })}</p>
        {error && <p className="mt-2 mono text-[11px] text-[var(--color-warn)] break-words">{error}</p>}
        <button type="button" onClick={() => { void check(); }} disabled={checking}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[13px] font-semibold hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-60 transition-colors">
          <RefreshCw size={14} className={checking ? "animate-spin" : undefined} />{t("offline.retry")}
        </button>
      </div>
    </div>
  );
}
