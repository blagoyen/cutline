import { memo } from "react";
import { Music2, PlaySquare, Scissors, ShieldCheck, Tv } from "lucide-react";
import type { VideoSource } from "../types";
import { formatDuration, qualityLabel } from "../utils/format";

interface HeroPanelProps {
  clipCount: number;
  totalDurationMs: number;
  quality: string;
  format: string;
  activeSource: VideoSource | null;
  audioOnly?: boolean;
  compact?: boolean;
  isMobile?: boolean;
}

export const HeroPanel = memo(function HeroPanel({
  clipCount,
  totalDurationMs,
  quality,
  format,
  activeSource,
  audioOnly = false,
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
          <b>{audioOnly ? "ORIGINAL AUDIO" : qualityLabel(quality).toUpperCase()}</b> · {format.toUpperCase()}
        </span>
        {activeSource ? (
          <>
            <span className="session-sep" aria-hidden="true" />
            <span className={`session-source session-source-${activeSource}`}>
              {activeSource === "twitch"
                ? "TWITCH VOD"
                : activeSource === "tiktok"
                  ? audioOnly
                    ? "TIKTOK SOUND"
                    : "TIKTOK"
                  : "YOUTUBE"}
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
          Paste a YouTube, Twitch, or TikTok link to trim and save clips directly on your device.
        </p>
      </section>
    );
  }

  return (
    <section className="launcher-hero" aria-label="Cutline overview">
      <div className="launcher-hero-head">
        <h1 className="launcher-title">Clip YouTube, Twitch &amp; TikTok</h1>
        <p className="launcher-sub">
          Paste a video or TikTok sound link to scrub frame-by-frame, mark cuts, or grab clean MP4
          videos and MP3 sounds locally with yt-dlp &amp; FFmpeg.
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
        <span className="source-pill source-pill-tiktok">
          <Music2 size={12} strokeWidth={2} aria-hidden="true" />
          TikTok Videos &amp; Sounds
        </span>
        <span className="source-pill">
          <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
          100% Local
        </span>
      </div>
    </section>
  );
});
