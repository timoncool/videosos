// The journal as the service keeps it: what agents changed and what the window told the person, newest first.
import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { onServerEvent } from "@/infrastructure/desktop/server-events";

export interface JournalLine {
  id: number;
  /** Seconds since 1970. */
  at: number;
  /** `agent` for a change an agent made, `studio` for a message the window showed. */
  source: "agent" | "studio";
  tone: string;
  verb: string;
  kind: string;
  target: string;
  text: string;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
  return response;
}

/** The journal's latest lines, read again whenever the service says it changed. */
export function useJournal(): { lines: JournalLine[]; error: string | null } {
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      send("/api/journal")
        .then((response) => response.json() as Promise<JournalLine[]>)
        .then((read) => {
          if (!alive) return;
          setLines(read);
          setError(null);
        })
        .catch((problem: unknown) => {
          if (alive) setError(problem instanceof Error ? problem.message : String(problem));
        });
    void read();
    const unsubscribe = onServerEvent((event) => {
      if (event.kind === "journal" || event.kind === "resync") void read();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return { lines, error };
}

/** A message the window showed goes into the journal, so it can be read after it is gone. */
export function noteMessage(text: string, tone: string): void {
  if (!text.trim()) return;
  send("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "studio", text, tone }) })
    .catch((problem: Error) => console.error("[ERROR] the journal did not take a message:", problem.message));
}

export async function clearJournal(): Promise<void> {
  await send("/api/journal", { method: "DELETE" });
}

export async function removeJournalLine(id: number): Promise<void> {
  await send(`/api/journal/${id}`, { method: "DELETE" });
}

/** A line in the window's words: an agent's change from its facts, never a tool's name; a message as it was shown. */
export function journalSentence(t: TFunction, line: JournalLine): string {
  if (line.source !== "agent") return line.text;
  const verb = t(`journal.verb.${line.verb}`, { defaultValue: line.verb });
  const kind = t(`journal.kind.${line.kind}`, { defaultValue: line.kind });
  return line.target
    ? t("journal.line", { verb, kind, name: line.target, interpolation: { escapeValue: false } })
    : t("journal.lineNoName", { verb, kind, interpolation: { escapeValue: false } });
}
