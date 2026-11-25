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

  return (
    <section className="editorial-hero" aria-label="Cutline overview">
      <div className="editorial-hero-top">
        <h1 className="editorial-headline">
          The clipper
          <br />
          you can cut on
        </h1>
        <p className="editorial-lede">
          <span>
            Import YouTube videos and Twitch VODs, scrub to the exact frame, and slice clean{" "}
            {isMobile ? "MP4 or M4A" : "MP4 or MP3"} clips.
          </span>{" "}
          {isMobile
            ? "Hardware-accelerated with native AVFoundation — private, fast, and 100% on your iPhone."
            : "Built on local yt-dlp & FFmpeg infrastructure that stays private, fast, and entirely on your machine."}
        </p>
      </div>

      <div className="editorial-meta-row">
        <div className="source-pills" aria-label="Supported video sources">
          <span className="source-pill source-pill-youtube">
            <PlaySquare size={12} strokeWidth={2} aria-hidden="true" />
            YOUTUBE &amp; SHORTS
          </span>
          <span className="source-pill source-pill-twitch">
            <Tv size={12} strokeWidth={2} aria-hidden="true" />
            TWITCH VODS &amp; CLIPS
          </span>
          <span className="source-pill">
            <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
            100% LOCAL
          </span>
        </div>
        <span className="editorial-kicker">
          <span className="editorial-kicker-dot" aria-hidden="true" />
          FRAME-ACCURATE · ZERO CLOUD UPLOADS
        </span>
      </div>
    </section>
  );
});
