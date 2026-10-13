// Open the settings on a section from anywhere in the window: the target is "section" or "section:part"
// (the part is a block of the section to scroll to). The news open the same way.
export const OPEN_SETTINGS_EVENT = "videosos:open-settings";
export const OPEN_NEWS_EVENT = "videosos:open-news";

const SETTINGS_SECTIONS = ["providers", "agents", "general", "timeline", "ai", "storage", "network", "privacy", "about"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export type SettingsTarget = { section: SettingsSection; part: string | null };

export function openSettings(target: string): void {
  window.dispatchEvent(new CustomEvent<string>(OPEN_SETTINGS_EVENT, { detail: target }));
}

export function openNews(): void {
  window.dispatchEvent(new Event(OPEN_NEWS_EVENT));
}

/** A target the settings can open: a section it has, otherwise null (never silently the first section). */
export function parseSettingsTarget(target: string | null | undefined): SettingsTarget | null {
  const [page, part] = (target ?? "").split(":");
  const section = SETTINGS_SECTIONS.find((s) => s === page);
  return section ? { section, part: part || null } : null;
}
