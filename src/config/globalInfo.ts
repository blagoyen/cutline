import bundled from "./global-info.json";

export type GlobalInfoTone = "info" | "success" | "warning";

export interface GlobalInfo {
  enabled: boolean;
  label: string;
  message: string;
  tone: GlobalInfoTone;
  updatedAt: string;
}

/**
 * The notice is published by editing `src/config/global-info.json` in this
 * repository and committing it. Every installed app polls this raw URL, so no
 * rebuild or reinstall is needed. Only repository owners can change the file;
 * everyone else gets read-only access to the rendered message.
 */
export const GLOBAL_INFO_URL =
  "https://raw.githubusercontent.com/blagoyen/yt-cutter/refs/heads/main/src/config/global-info.json";

export const GLOBAL_INFO_POLL_MS = 5 * 60 * 1000;

export const BUNDLED_GLOBAL_INFO: GlobalInfo = {
  enabled: bundled.enabled,
  label: bundled.label,
  message: bundled.message,
  tone: bundled.tone as GlobalInfoTone,
  updatedAt: bundled.updatedAt,
};

const TONES: GlobalInfoTone[] = ["info", "success", "warning"];

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Never trust raw remote content: validate shape, length and tone. */
export function normalizeGlobalInfo(value: unknown): GlobalInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const message = text(record.message, 240);
  if (!message) return null;

  const tone = text(record.tone, 20);
  return {
    enabled: record.enabled !== false,
    label: text(record.label, 24) || "NOTICE",
    message,
    tone: (TONES as string[]).includes(tone) ? (tone as GlobalInfoTone) : "info",
    updatedAt: text(record.updatedAt, 40),
  };
}

export function sameGlobalInfo(a: GlobalInfo, b: GlobalInfo) {
  return (
    a.enabled === b.enabled &&
    a.label === b.label &&
    a.message === b.message &&
    a.tone === b.tone &&
    a.updatedAt === b.updatedAt
  );
}
