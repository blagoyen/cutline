import { useEffect, useState } from "react";
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
    // Private/blocked storage still gets the in-memory and bundled notice.
  }
}

/**
 * Polls the repo-owned notice file. The bundled copy is the offline fallback;
 * the last successful fetch is cached so a restart before the first check still
 * shows the newest message the user has seen.
 */
export function useGlobalInfo() {
  const [info, setInfo] = useState<GlobalInfo>(() => readCached() ?? BUNDLED_GLOBAL_INFO);
  const [status, setStatus] = useState<GlobalInfoStatus>(() => (readCached() ? "cached" : "local"));
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(`${GLOBAL_INFO_URL}?t=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = normalizeGlobalInfo(await response.json());
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
