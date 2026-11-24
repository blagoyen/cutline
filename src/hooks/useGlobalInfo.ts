import { useEffect, useRef, useState } from "react";
import {
  BUNDLED_GLOBAL_INFO,
  GLOBAL_INFO_POLL_MS,
  GLOBAL_INFO_URL,
  normalizeGlobalInfo,
  sameGlobalInfo,
  type GlobalInfo,
} from "../config/globalInfo";

export type GlobalInfoStatus = "local" | "cached" | "live";

const CACHE_KEY = "ytcutter.globalInfo.v1";
const FETCH_TIMEOUT_MS = 8_000;
const MIN_CHECK_GAP_MS = 30_000;

function readCached(): GlobalInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalizeGlobalInfo(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCached(info: GlobalInfo) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(info));
  } catch {
    // Storage may be unavailable; keep the bundled notice.
  }
}

/** Loads the shared notice, falling back to cached or bundled copy. */
export function useGlobalInfo() {
  const [initial] = useState<{ info: GlobalInfo; status: GlobalInfoStatus }>(() => {
    const cached = readCached();
    return cached
      ? { info: cached, status: "cached" }
      : { info: BUNDLED_GLOBAL_INFO, status: "local" };
  });
  const [info, setInfo] = useState<GlobalInfo>(initial.info);
  const [status, setStatus] = useState<GlobalInfoStatus>(initial.status);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const lastAttemptRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      const now = Date.now();
      if (now - lastAttemptRef.current < MIN_CHECK_GAP_MS) return;
      lastAttemptRef.current = now;

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(`${GLOBAL_INFO_URL}?t=${now}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as { content?: string };
        if (typeof payload.content !== "string") throw new Error("Missing content");
        const binary = atob(payload.content.replace(/\s/g, ""));
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const parsed = normalizeGlobalInfo(JSON.parse(new TextDecoder().decode(bytes)));
        if (disposed || !parsed) return;
        setInfo((previous) => (sameGlobalInfo(previous, parsed) ? previous : parsed));
        writeCached(parsed);
        setStatus("live");
        setLastChecked(Date.now());
      } catch {
        if (!disposed) setStatus(readCached() ? "cached" : "local");
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), GLOBAL_INFO_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { info, status, lastChecked };
}
