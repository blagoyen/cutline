import { memo, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Minus,
  Settings2,
  Square,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useGlobalInfo } from "../hooks/useGlobalInfo";
import type { DependencyReport } from "../types";

interface TopBarProps {
  dependencies: DependencyReport | null;
  onOpenSettings: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

function dependencySummary(dependencies: DependencyReport | null) {
  if (!dependencies) {
    return { tone: "idle", label: "Checking tools" };
  }
  const missing = [
    dependencies.ytDlp.ready ? null : "yt-dlp",
    dependencies.ffmpeg.ready ? null : "FFmpeg",
    dependencies.ffprobe.ready ? null : "FFprobe",
  ].filter(Boolean);
  if (missing.length === 0) {
    return { tone: "ok", label: "Tools ready" };
  }
  return {
    tone: missing.length >= 2 ? "error" : "warn",
    label: `${missing.join(" + ")} missing`,
  };
}

const GLOBAL_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
} as const;

/** Tauri window API is available only in the native build. */
const isNative = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Window methods used by the title bar. */
type WindowHandle = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
};

export const TopBar = memo(function TopBar({ dependencies, onOpenSettings, soundEnabled, onToggleSound }: TopBarProps) {
  const summary = dependencySummary(dependencies);
  const { info: globalInfo, status: infoStatus } = useGlobalInfo();
  const [maximized, setMaximized] = useState(false);
  const versions = [
    dependencies?.ytDlp.version ? `yt-dlp ${dependencies.ytDlp.version}` : null,
    dependencies?.ffmpeg.version ? `FFmpeg ${dependencies.ffmpeg.version}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    if (!isNative) return;
    let disposed = false;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      if (disposed) return;
      const win = getCurrentWindow();
      void win.isMaximized().then(setMaximized).catch(() => undefined);
    });
    return () => {
      disposed = true;
    };
  }, []);

  const withWindow = useCallback(
    (action: (win: WindowHandle) => void | Promise<void>) => {
      if (!isNative) return;
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => action(getCurrentWindow()))
        .catch(() => undefined);
    },
    [],
  );

  const GlobalIcon = GLOBAL_ICONS[globalInfo.tone];
  const infoTitle =
    infoStatus === "live"
      ? `Synced from repository${globalInfo.updatedAt ? ` · ${globalInfo.updatedAt}` : ""}`
      : infoStatus === "cached"
        ? "Cached notice · offline"
        : "Bundled notice · offline";

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="brand-mark" aria-hidden="true" data-tauri-drag-region />
        <span className="brand-name" data-tauri-drag-region>CUTLINE</span>
        <span className="brand-sep" aria-hidden="true" data-tauri-drag-region />
        <span className="brand-tag" data-tauri-drag-region>YouTube · Twitch</span>
      </div>

      <div className="topbar-center">
        {globalInfo.enabled ? (
          <div
            key={`${globalInfo.message}-${globalInfo.updatedAt}`}
            className={`global-info global-info-${globalInfo.tone}`}
            role="note"
            aria-live="polite"
            title={infoTitle}
          >
            <GlobalIcon className="global-info-icon" size={12} strokeWidth={2} aria-hidden="true" />
            <span className="global-info-kicker">{globalInfo.label}</span>
            <span className="global-info-text" title={globalInfo.message}>
              {globalInfo.message}
            </span>
            <span className={`global-info-pulse global-info-pulse-${infoStatus}`} aria-hidden="true" />
          </div>
        ) : (
          <div className="global-info global-info-idle" role="note" title={infoTitle}>
            <span className={`global-info-pulse global-info-pulse-${infoStatus}`} aria-hidden="true" />
            <span className="global-info-text">Ready</span>
          </div>
        )}
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className={`icon-btn topbar-sound${soundEnabled ? " is-on" : ""}`}
          onClick={onToggleSound}
          aria-label={soundEnabled ? "Mute interface sounds" : "Enable interface sounds"}
          title={soundEnabled ? "Interface sounds on" : "Interface sounds off"}
        >
          {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
        <button
          type="button"
          className={`dep-pill dep-${summary.tone}`}
          onClick={onOpenSettings}
          title={versions || "Open settings to configure yt-dlp and FFmpeg"}
        >
          <span className={`dot dot-${summary.tone}`} aria-hidden="true" />
          <span>{summary.label}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onOpenSettings}
          aria-label="Open settings"
          title="Settings"
        >
          <Settings2 size={16} strokeWidth={1.75} />
        </button>

        {isNative ? (
          <div className="window-controls" aria-label="Window controls">
            <button
              type="button"
              className="window-control"
              onClick={() => withWindow((win) => win.minimize())}
              title="Minimize"
              aria-label="Minimize window"
            >
              <Minus size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="window-control"
              onClick={() =>
                withWindow(async (win) => {
                  await win.toggleMaximize();
                  setMaximized(await win.isMaximized());
                })
              }
              title={maximized ? "Restore" : "Maximize"}
              aria-label={maximized ? "Restore window" : "Maximize window"}
            >
              {maximized ? <Square size={11} strokeWidth={1.8} /> : <Square size={12} strokeWidth={1.8} />}
            </button>
            <button
              type="button"
              className="window-control window-control-close"
              onClick={() => withWindow((win) => win.close())}
              title="Close"
              aria-label="Close window"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
});
