import { memo } from "react";
import { PlaySquare, Scissors, ShieldCheck, Tv } from "lucide-react";
import type { VideoSource } from "../types";
import { formatDuration, qualityLabel } from "../utils/format";

interface HeroPanelProps {
  clipCount: number;
  totalDurationMs: number;
  quality: string;
  format: string;
  activeSource: VideoSource | null;
  compact?: boolean;
  isMobile?: boolean;
}

export const HeroPanel = memo(function HeroPanel({
  clipCount,
  totalDurationMs,
  quality,
  format,
  activeSource,
  compact = false,
  isMobile = false,
}: HeroPanelProps) {
  if (compact) {
    return (
      <div className="session-strip" aria-label="Current session summary">
        <span className="session-dot" aria-hidden="true" />
        <span className="session-pill">
          <Scissors size={12} strokeWidth={2} />
          <b>{String(clipCount).padStart(2, "0")}</b> {clipCount === 1 ? "CUT" : "CUTS"}
        </span>
        <span className="session-sep" aria-hidden="true" />
        <span className="session-pill">
          DURATION <b>{formatDuration(totalDurationMs)}</b>
        </span>
        <span className="session-sep" aria-hidden="true" />
        <span className="session-pill">
          <b>{qualityLabel(quality).toUpperCase()}</b> · {format.toUpperCase()}
        </span>
        {activeSource ? (
          <>
            <span className="session-sep" aria-hidden="true" />
            <span className={`session-source session-source-${activeSource}`}>
              {activeSource === "twitch" ? "TWITCH VOD" : "YOUTUBE"}
            </span>
          </>
        ) : null}
      </div>
    );
  }

  if (isMobile) {
    return (
      <section className="ios-home-head" aria-label="Cutline overview">
        <h1 className="ios-home-title">Clip any video</h1>
        <p className="ios-home-sub">
          Paste a YouTube or Twitch link to trim and save clips directly on your iPhone.
        </p>
      </section>
    );
  }

  return (
    <section className="launcher-hero" aria-label="Cutline overview">
      <div className="launcher-hero-head">
        <h1 className="launcher-title">Clip YouTube &amp; Twitch locally</h1>
        <p className="launcher-sub">
          Paste a link to scrub frame-by-frame, mark multiple cuts, and export clean MP4 or MP3
          files with local yt-dlp &amp; FFmpeg.
        </p>
      </div>
      <div className="launcher-tags" aria-label="Supported video sources">
        <span className="source-pill source-pill-youtube">
          <PlaySquare size={12} strokeWidth={2} aria-hidden="true" />
          YouTube &amp; Shorts
        </span>
        <span className="source-pill source-pill-twitch">
          <Tv size={12} strokeWidth={2} aria-hidden="true" />
          Twitch VODs &amp; Clips
        </span>
        <span className="source-pill">
          <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
          100% Local · No Uploads
        </span>
      </div>
    </section>
  );
});
