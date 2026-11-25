import { memo } from "react";
import { PlaySquare, Scissors, ShieldCheck, Tv } from "lucide-react";
import type { VideoSource } from "../types";
import { formatDuration, qualityLabel } from "../utils/format";
import { BrandMark } from "./BrandMark";

interface HeroPanelProps {
  clipCount: number;
  totalDurationMs: number;
  quality: string;
  format: string;
  activeSource: VideoSource | null;
  compact?: boolean;
}

export const HeroPanel = memo(function HeroPanel({
  clipCount,
  totalDurationMs,
  quality,
  format,
  activeSource,
  compact = false,
}: HeroPanelProps) {
  if (compact) {
    return (
      <div className="session-strip" aria-label="Current session summary">
        <span className="session-pill">
          <Scissors size={12} strokeWidth={2} />
          <b>{clipCount}</b> {clipCount === 1 ? "cut" : "cuts"}
        </span>
        <span className="session-sep" aria-hidden="true" />
        <span className="session-pill">
          Total <b>{formatDuration(totalDurationMs)}</b>
        </span>
        <span className="session-sep" aria-hidden="true" />
        <span className="session-pill">
          <b>{qualityLabel(quality)}</b> · {format.toUpperCase()}
        </span>
        {activeSource ? (
          <>
            <span className="session-sep" aria-hidden="true" />
            <span className={`session-source session-source-${activeSource}`}>
              {activeSource === "twitch" ? "Twitch" : "YouTube"}
            </span>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <section className="minimal-hero" aria-label="Cutline overview">
      <div className="minimal-hero-mark">
        <BrandMark size={52} />
      </div>
      <h1 className="minimal-headline">
        Clip YouTube &amp; Twitch, locally.
      </h1>
      <p className="minimal-lede">
        Paste any video or VOD link, mark exact in and out points, and export clean MP4 or MP3 clips
        straight to your drive.
      </p>
      <div className="source-pills" aria-label="Supported video sources">
        <span className="source-pill source-pill-youtube">
          <PlaySquare size={13} strokeWidth={2} aria-hidden="true" />
          YouTube Videos &amp; Shorts
        </span>
        <span className="source-pill source-pill-twitch">
          <Tv size={13} strokeWidth={2} aria-hidden="true" />
          Twitch VODs &amp; Clips
        </span>
        <span className="source-pill">
          <ShieldCheck size={13} strokeWidth={2} aria-hidden="true" />
          100% Local
        </span>
      </div>
    </section>
  );
});
