import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, FolderDown, FolderOpen, Loader2, Minimize2, Move, X } from "lucide-react";
import { onSaving, revealOnDisk, type SavingFile } from "@/infrastructure/desktop";
import { dockSlot, useFloatable } from "../services/use-floatable";

/**
 * The files saved this session, from Dub Studio's files panel as the music studios have it: a chip in the
 * toolbar, or a panel dragged anywhere over the window. Each save shows while it is written and a way to it
 * in the file manager once it is.
 */

const size = (bytes?: number) => {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
};

export default function FilesPanel() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<SavingFile[]>([]);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const panel = useFloatable("files", { x: window.innerWidth - 360, y: 64 });
  const shown = useRef(0);

  useEffect(() => onSaving((change) => {
    setFiles((current) => {
      if (change.state === "cancelled") return current.filter((file) => file.id !== change.id);
      const known = current.some((file) => file.id === change.id);
      return known ? current.map((file) => (file.id === change.id ? { ...file, ...change } : file)) : [change, ...current];
    });
  }), []);

  // the toolbar's slot exists once the toolbar has drawn
  useEffect(() => { redraw((n) => n + 1); }, []);

  // the first save opens the panel, so the person sees where it went
  useEffect(() => {
    if (shown.current === 0 && files.length > 0 && !panel.floating) panel.pop();
    shown.current = files.length;
  }, [files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!files.length) return null;
  const busy = files.some((file) => file.state === "saving");

  if (!panel.floating) {
    const slot = dockSlot();
    if (!slot) return null;
    return createPortal(
      <button type="button" onClick={panel.pop} title={t("files.title")} aria-label={t("files.title")}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]">
        {busy ? <Loader2 size={14} className="animate-spin text-[var(--color-accent)]" /> : <FolderDown size={14} className="text-[var(--color-accent)]" />}
        <span className="tabnum text-[11px]">{files.length}</span>
      </button>,
      slot,
    );
  }

  return (
    <div className="fixed z-[45] w-[min(90vw,340px)]" style={{ left: panel.pos.x, top: panel.pos.y }}>
      <div className="glass-panel w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
        <div onPointerDown={panel.onDragStart}
             className={`flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 ${panel.dragging ? "cursor-grabbing" : "cursor-grab"}`}>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            <Move size={12} />
            {t("files.title")}
          </span>
          <button type="button" onClick={panel.dock} title={t("float.dock")} aria-label={t("float.dock")} className="text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <Minimize2 size={14} />
          </button>
        </div>
        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto p-2">
          {revealError && <p role="alert" className="px-1 text-[11px] text-[var(--color-danger)]">{revealError}</p>}
          {files.map((file) => (
            <div key={file.id} className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
              <div className="flex items-center gap-2">
                {file.state === "saving" ? (
                  <Loader2 size={14} className="shrink-0 animate-spin text-[var(--color-accent)]" />
                ) : file.state === "error" ? (
                  <X size={14} className="shrink-0 text-[var(--color-danger)]" />
                ) : (
                  <Check size={14} className="shrink-0 text-[var(--color-accent)]" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text)]" title={file.path ?? file.name}>{file.name}</span>
                <span className="tabnum shrink-0 text-[11px] text-[var(--color-muted)]">{size(file.size)}</span>
              </div>
              {file.state === "saving" && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--color-overlay)]">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--color-accent)]" />
                </div>
              )}
              {file.path && <div className="mt-1 truncate text-[11px] text-[var(--color-muted)]" title={file.path}>{file.path}</div>}
              {file.state === "done" && file.path && (
                <button type="button"
                        onClick={() => {
                          setRevealError(null);
                          revealOnDisk(file.path as string).catch((problem: unknown) => setRevealError(problem instanceof Error ? problem.message : String(problem)));
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[12px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-text)]">
                  <FolderOpen size={13} /> {t("files.showInFolder")}
                </button>
              )}
              {file.state === "error" && file.error && <div className="mt-1 break-words text-[11px] text-[var(--color-danger)]">{file.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
