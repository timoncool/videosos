/**
 * When something happened, as a list shows it: "5 min ago", "yesterday", and a
 * date for anything older; the exact moment goes into the tooltip.
 */
export function relativeMoment(when: Date, language: string, now: Date = new Date()): string {
  const seconds = Math.round((when.getTime() - now.getTime()) / 1000);
  const words = new Intl.RelativeTimeFormat(language, { numeric: "auto", style: "short" });
  const past = Math.abs(seconds);
  // whole units that have passed, as a clock counts them: 59 minutes never read
  // as an hour, nor 40 hours as two days
  if (past < 60) return words.format(0, "second");
  if (past < 3600) return words.format(Math.trunc(seconds / 60), "minute");
  if (past < 86400) return words.format(Math.trunc(seconds / 3600), "hour");
  if (past < 2 * 86400) return words.format(Math.trunc(seconds / 86400), "day");
  const sameYear = when.getFullYear() === now.getFullYear();
  return when.toLocaleDateString(language, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

/** The exact moment, for a tooltip. */
export function exactMoment(when: Date, language: string): string {
  return when.toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });
}
