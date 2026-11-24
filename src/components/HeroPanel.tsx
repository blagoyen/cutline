import { Clapperboard, Clock3 } from "lucide-react";
import { formatDuration, qualityLabel } from "../utils/format";

interface HeroPanelProps {
  clipCount: number;
  totalDurationMs: number;
  quality: string;
  format: string;
}

const STEPS = [
  { index: "01", text: "Paste a YouTube link." },
  { index: "02", text: "Mark in / out points and add multiple cuts." },
  { index: "03", text: "Choose quality and export from the bar below." },
];

export function HeroPanel({ clipCount, totalDurationMs, quality, format }: HeroPanelProps) {
  return (
    <aside className="editorial">
      <p className="eyebrow">YT Cutter</p>

      <h1 className="headline">
        Cut YouTube videos in seconds —
        <br />
        <em>only the parts you want.</em>
      </h1>

      <p className="lede">
        Paste a YouTube link, mark your in and out points, and download only the moments you need.
        No unnecessary downloads. No watermark. No subscription.
      </p>

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
          <span className="eyebrow eyebrow-sm">Current set</span>
          <span className="summary-live">
            <span className="dot dot-ok" aria-hidden="true" /> Live
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
        <p className="summary-foot">Nothing is uploaded — every cut runs on this computer.</p>
      </div>
    </aside>
  );
}
