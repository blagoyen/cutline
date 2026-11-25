import { memo } from "react";
import { Clapperboard, Clock3, PlaySquare, Tv } from "lucide-react";
import type { VideoSource } from "../types";
import { formatDuration, qualityLabel } from "../utils/format";

interface HeroPanelProps {
  clipCount: number;
  totalDurationMs: number;
  quality: string;
  format: string;
  activeSource: VideoSource | null;
}

const STEPS = [
  { index: "01", text: "Paste a YouTube video or Twitch VOD link." },
  { index: "02", text: "Mark in / out points and stack multiple cuts." },
  { index: "03", text: "Pick quality and export straight to your drive." },
];

export const HeroPanel = memo(function HeroPanel({
  clipCount,
  totalDurationMs,
  quality,
  format,
  activeSource,
}: HeroPanelProps) {
  return (
    <aside className="editorial">
      <p className="eyebrow">Cutline Studio</p>

      <h1 className="headline">
        Clip only the moments you need
        <br />
        <em>from YouTube &amp; Twitch.</em>
      </h1>

      <p className="lede">
        Import any YouTube video or Twitch VOD, scrub to the exact frame, and export clean clips or
        merged highlights locally.
      </p>

      <div className="source-pills" aria-label="Supported video sources">
        <span className={`source-pill source-pill-youtube${activeSource === "youtube" ? " is-active" : ""}`}>
          <PlaySquare size={13} strokeWidth={2} aria-hidden="true" />
          YouTube
        </span>
        <span className={`source-pill source-pill-twitch${activeSource === "twitch" ? " is-active" : ""}`}>
          <Tv size={13} strokeWidth={2} aria-hidden="true" />
          Twitch VODs
        </span>
      </div>

      <ol className="steps">
        {STEPS.map((step) => (
          <li className="step" key={step.index}>
            <span className="step-index">{step.index}</span>
            <span className="step-text">{step.text}</span>
          </li>
        ))}
      </ol>

      <div className="summary-card" aria-label="Current export summary">
        <div className="summary-card-head">
          <span className="eyebrow eyebrow-sm">Session deck</span>
          <span className="summary-live">
            <span className="dot dot-ok" aria-hidden="true" /> Local
          </span>
        </div>
        <div className="summary-stat">
          <span className="summary-icon">
            <Clapperboard size={14} strokeWidth={1.8} />
          </span>
          <span>Clips queued</span>
          <b>{String(clipCount).padStart(2, "0")}</b>
        </div>
        <div className="summary-stat">
          <span className="summary-icon">
            <Clock3 size={14} strokeWidth={1.8} />
          </span>
          <span>Total duration</span>
          <b>{formatDuration(totalDurationMs)}</b>
        </div>
        <div className="summary-stat">
          <span className="summary-icon summary-icon-text">{format.toUpperCase()}</span>
          <span>Output</span>
          <b>{qualityLabel(quality)}</b>
        </div>
        <p className="summary-foot">Zero cloud uploads · powered by local FFmpeg &amp; yt-dlp.</p>
      </div>
    </aside>
  );
});
