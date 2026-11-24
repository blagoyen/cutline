import { AlertTriangle } from "lucide-react";
import type { DependencyReport } from "../types";

interface DependencyBannerProps {
  dependencies: DependencyReport;
  onOpenSettings: () => void;
}

export function DependencyBanner({ dependencies, onOpenSettings }: DependencyBannerProps) {
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
        {missing.length === 1 ? "is" : "are"} required to load and cut videos. Set the executable
        path in Settings — YT Cutter never installs tools without asking.
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenSettings}>
        Open settings
      </button>
    </div>
  );
}
