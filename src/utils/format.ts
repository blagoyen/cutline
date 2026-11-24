const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** `HH:MM:SS.mmm` — used by every timestamp field in the app. */
export function formatTimecode(ms: number, withMillis = true): string {
  const safe = Math.max(0, Math.round(ms));
  const millis = safe % 1000;
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const base = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return withMillis ? `${base}.${pad(millis, 3)}` : base;
}

/** Short duration, e.g. 0:33 or 1:02:03. */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const totalSeconds = Math.round(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

export interface ParsedTime {
  ms: number | null;
  error: string | null;
}

/** Accepts 75, 1:15, 01:15.5, or 00:01:15.500; returns integer ms. */
export function parseTimecode(input: string): ParsedTime {
  const raw = input.trim().replace(",", ".");
  if (!raw) {
    return { ms: null, error: "Enter a timestamp." };
  }
  if (!/^\d{1,3}(:\d{1,2}){0,2}(\.\d{1,3})?$/.test(raw)) {
    return { ms: null, error: "Use HH:MM:SS.mmm, for example 00:02:15.000." };
  }

  const [whole, fraction] = raw.split(".");
  const segments = whole.split(":").map((segment) => Number(segment));
  if (segments.some((value) => !Number.isFinite(value))) {
    return { ms: null, error: "That timestamp is not a number." };
  }
  if (segments.length > 1 && segments.slice(1).some((value) => value > 59)) {
    return { ms: null, error: "Minutes and seconds must be below 60." };
  }

  let seconds = 0;
  for (const value of segments) {
    seconds = seconds * 60 + value;
  }
  let ms = seconds * 1000;
  if (fraction) {
    ms += Math.round(Number(`0.${fraction}`) * 1000);
  }
  return { ms: Math.round(ms), error: null };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "—";
  }
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}h ${pad(mins % 60)}m`;
  }
  if (mins > 0) return `${mins}m ${pad(secs)}s`;
  return `${secs}s`;
}

export function formatCount(count: number | null | undefined): string {
  if (count == null) return "—";
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B views`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
  return `${count} views`;
}

export function qualityLabel(quality: string): string {
  if (quality === "best") return "Best available";
  if (quality === "worst") return "Smallest file";
  return quality.toUpperCase();
}

/** Short timecode for small controls, e.g. 2:42.35. */
export function formatShortTimecode(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const centis = Math.floor((safe % 1000) / 10);
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const tail = `${pad(seconds)}.${pad(centis)}`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${tail}`;
  return `${pad(minutes)}:${tail}`;
}

export const NAMING_TEMPLATES = [
  "{Title} - Clip {NN}",
  "{Title} - {Name}",
  "{Name}",
  "{Title} ({Start})",
] as const;

export type NamingTemplate = (typeof NAMING_TEMPLATES)[number];

export function applyNamingTemplate(
  template: string,
  title: string,
  clipName: string,
  index: number,
  startMs: number,
): string {
  const replacements: Record<string, string> = {
    "{Title}": title.replace(/[\\/:*?"<>|]/g, "_").trim() || "Video",
    "{Name}": clipName.trim() || `Clip ${String(index + 1).padStart(2, "0")}`,
    "{NN}": String(index + 1).padStart(2, "0"),
    "{Start}": formatShortTimecode(startMs).replace(":", "-"),
  };
  let result = template.trim() || NAMING_TEMPLATES[0];
  for (const [token, value] of Object.entries(replacements)) {
    result = result.split(token).join(value);
  }
  return result.replace(/\s+/g, " ").trim() || `Clip ${String(index + 1).padStart(2, "0")}`;
}
