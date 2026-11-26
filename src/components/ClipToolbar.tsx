import { memo } from "react";
import { Download } from "lucide-react";
import type { VideoInfo } from "../types";
import { NAMING_TEMPLATES, qualityLabel } from "../utils/format";

interface ClipToolbarProps {
  video: VideoInfo;
  quality: string;
  format: string;
  precise: boolean;
  namingTemplate: string;
  mergeCuts: boolean;
  clipCount: number;
  busy: boolean;
  isMobile?: boolean;
  onQuality: (quality: string) => void;
  onFormat: (format: string) => void;
  onPrecise: (precise: boolean) => void;
  onNamingTemplate: (template: string) => void;
  onMergeCuts: (merge: boolean) => void;
  onExport: () => void;
}

export const ClipToolbar = memo(function ClipToolbar({
  video,
  quality,
  format,
  precise,
  namingTemplate,
  mergeCuts,
  clipCount,
  busy,
  isMobile = false,
  onQuality,
  onFormat,
  onPrecise,
  onNamingTemplate,
  onMergeCuts,
  onExport,
}: ClipToolbarProps) {
  const canMerge = clipCount > 1;
  const displayFmt = isMobile && format === "mp3" ? "M4A" : format.toUpperCase();
  const exportLabel =
    clipCount === 0
      ? "EXPORT · NO CUTS"
      : mergeCuts && canMerge
        ? `EXPORT 1 FILE · ${clipCount} CUTS · ${displayFmt}`
        : `EXPORT ${clipCount} ${clipCount === 1 ? "CUT" : "CUTS"} · ${isMobile ? displayFmt : `${qualityLabel(quality).toUpperCase()} ${displayFmt}`}`;

  return (
    <section className="clip-toolbar" aria-label="Export options">
      <div className="toolbar-grid">
        <label className="toolbar-field">
          <span className="field-label">Quality</span>
          <select
            className="input input-compact"
            value={quality}
            onChange={(event) => onQuality(event.target.value)}
          >
            <option value="best">
              Best available{video.maxHeight > 0 ? ` (${video.maxHeight}p)` : ""}
            </option>
            {video.heights.map((height) => (
              <option key={height} value={`${height}p`}>
                {height}p
              </option>
            ))}
          </select>
        </label>

        <label className="toolbar-field">
          <span className="field-label">Format</span>
          <select
            className="input input-compact"
            value={format}
            onChange={(event) => onFormat(event.target.value)}
          >
            <option value="mp4">{isMobile ? "MP4 · Video (Photos + Files)" : "MP4 · video"}</option>
            <option value="mp3">{isMobile ? "M4A · Audio (Files)" : "MP3 / M4A · audio only"}</option>
          </select>
        </label>

        {!isMobile ? (
          <>
            <label className="toolbar-field toolbar-field-template">
              <span className="field-label">Naming pattern</span>
              <select
                className="input input-compact"
                value={NAMING_TEMPLATES.includes(namingTemplate as (typeof NAMING_TEMPLATES)[number]) ? namingTemplate : NAMING_TEMPLATES[0]}
                onChange={(event) => onNamingTemplate(event.target.value)}
              >
                {NAMING_TEMPLATES.map((template) => (
                  <option key={template} value={template}>
                    {template}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={`switch-field${precise ? " is-on" : ""}`}
              role="switch"
              aria-checked={precise}
              onClick={() => onPrecise(!precise)}
              title="Precise cutting re-encodes around the cut points so clips start exactly where marked. Slower, but frame accurate. Fast mode aligns to keyframes."
            >
              <span className="switch" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span className="switch-text">
                Precise cutting
                <small>{precise ? "Frame accurate · slower" : "Fast · keyframe aligned"}</small>
              </span>
            </button>
          </>
        ) : null}
      </div>

      <div className="toolbar-export">
        <label className={`merge-toggle${canMerge ? "" : " is-disabled"}`}>
          <input
            type="checkbox"
            checked={mergeCuts && canMerge}
            disabled={!canMerge}
            onChange={(event) => onMergeCuts(event.target.checked)}
          />
          <span className="merge-box" aria-hidden="true" />
          Merge cuts into one file
        </label>

        <button
          type="button"
          className="btn btn-primary export-cta"
          onClick={onExport}
          disabled={clipCount === 0 || busy}
        >
          <Download size={15} strokeWidth={2.2} />
          {busy ? "QUEUING…" : exportLabel}
        </button>
      </div>

      <p className="toolbar-footnote">
        {isMobile
          ? "Clips are trimmed on-device with AVFoundation and saved to Photos & Files → Cutline."
          : `Selected ranges are downloaded and checked locally.${format === "mp3" ? " Audio is converted to MP3." : ""}`}
      </p>
    </section>
  );
});
