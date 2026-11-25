import { memo } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import type { DependencyReport } from "../types";

interface DependencyBannerProps {
  dependencies: DependencyReport;
  installing?: boolean;
  onInstall: () => void;
  onOpenSettings: () => void;
}

export const DependencyBanner = memo(function DependencyBanner({
  dependencies,
  installing = false,
  onInstall,
  onOpenSettings,
}: DependencyBannerProps) {
  const missing = [
    !dependencies.ytDlp.ready ? "yt-dlp" : null,
    !dependencies.ffmpeg.ready ? "FFmpeg" : null,
    !dependencies.ffprobe.ready ? "FFprobe" : null,
  ].filter(Boolean) as string[];

  if (missing.length === 0) return null;

  return (
    <div className="dep-banner" role="alert">
      <AlertTriangle size={15} strokeWidth={2} className="dep-banner-icon" />
      <div className="dep-banner-text">
        <strong>{missing.join(", ")}</strong>{" "}
        {missing.length === 1 ? "is" : "are"} required to load and cut videos. Install them from
        their official releases or set custom paths in Settings.
      </div>
      <div className="dep-banner-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onInstall}
          disabled={installing}
        >
          {installing ? (
            <>
              <Loader2 className="spin" size={13} /> Installing…
            </>
          ) : (
            <>
              <Download size={13} strokeWidth={2} /> Install tools
            </>
          )}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onOpenSettings}
          disabled={installing}
        >
          Settings
        </button>
      </div>
    </div>
  );
});
