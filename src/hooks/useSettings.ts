import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../services/api";
import type { DependencyReport, Settings } from "../types";

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [dependencies, setDependencies] = useState<DependencyReport | null>(null);
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef<Settings | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
    if (settings) {
      document.documentElement.dataset.theme = settings.theme === "dark" ? "dark" : "light";
    }
  }, [settings]);

  const refreshDependencies = useCallback(async () => {
    try {
      const report = await api.checkDependencies();
      setDependencies(report);
      return report;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const [loaded, appVersion] = await Promise.all([
          api.getSettings(),
          api.appVersion().catch(() => ""),
        ]);
        if (disposed) return;
        setSettings(loaded);
        setVersion(appVersion);
        await refreshDependencies();
      } catch (err) {
        if (!disposed) setError(errorMessage(err));
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [refreshDependencies]);

  const save = useCallback(async (next: Settings) => {
    const saved = await api.updateSettings(next);
    setSettings(saved);
    return saved;
  }, []);

  const patch = useCallback(async (partial: Partial<Settings>) => {
    const base = settingsRef.current;
    if (!base) return null;
    const saved = await api.updateSettings({ ...base, ...partial });
    setSettings(saved);
    return saved;
  }, []);

  return {
    settings,
    dependencies,
    version,
    loading,
    error,
    save,
    patch,
    refreshDependencies,
  };
}
