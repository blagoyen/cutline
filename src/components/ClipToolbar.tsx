import { memo } from "react";
import { Download, Film, Music2 } from "lucide-react";
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
  onQuickFullVideo?: () => void;
  onQuickFullSound?: () => void;
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
  onQuickFullVideo,
  onQuickFullSound,
}: ClipToolbarProps) {
  const isTiktok = video.source === "tiktok";
  const isAudioOnly = Boolean(video.audioOnly);
  const canMerge = clipCount > 1;
  const effectiveFormat = isAudioOnly ? "mp3" : format;
  const displayFmt = isMobile && effectiveFormat === "mp3" ? "M4A" : effectiveFormat.toUpperCase();
  const exportLabel =
    clipCount === 0
      ? "EXPORT · NO CUTS"
      : mergeCuts && canMerge
        ? `EXPORT 1 FILE · ${clipCount} CUTS · ${displayFmt}`
        : `EXPORT ${clipCount} ${clipCount === 1 ? "CUT" : "CUTS"} · ${isMobile || isAudioOnly ? displayFmt : `${qualityLabel(quality).toUpperCase()} ${displayFmt}`}`;

  return (
    <section className="clip-toolbar" aria-label="Export options">
      {isTiktok && (onQuickFullVideo || onQuickFullSound) ? (
        <div className="tiktok-quick-actions" aria-label="Quick TikTok download">
          {!isAudioOnly && onQuickFullVideo ? (
            <button
              type="button"
              className="btn btn-primary tiktok-quick-btn"
              onClick={onQuickFullVideo}
              disabled={busy}
            >
              <Film size={14} strokeWidth={2.1} />
              Full Video (MP4)
            </button>
          ) : null}
          {onQuickFullSound ? (
            <button
              type="button"
              className={`btn ${isAudioOnly ? "btn-primary" : "btn-ghost"} tiktok-quick-btn`}
              onClick={onQuickFullSound}
              disabled={busy}
            >
              <Music2 size={14} strokeWidth={2.1} />
              {isAudioOnly ? "Download Sound (MP3)" : "Extract Sound (MP3)"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="toolbar-grid">
        <label className="toolbar-field">
          <span className="field-label">Quality</span>
          <select
            className="input input-compact"
            value={isAudioOnly ? "best" : quality}
            disabled={isAudioOnly}
            onChange={(event) => onQuality(event.target.value)}
          >
            <option value="best">
              {isAudioOnly
                ? "Original audio"
                : `Best available${video.maxHeight > 0 ? ` (${video.maxHeight}p)` : ""}`}
            </option>
            {!isAudioOnly
              ? video.heights.map((height) => (
                  <option key={height} value={`${height}p`}>
                    {height}p
                  </option>
                ))
              : null}
          </select>
        </label>

        <label className="toolbar-field">
          <span className="field-label">Format</span>
          <select
            className="input input-compact"
            value={effectiveFormat}
            disabled={isAudioOnly}
            onChange={(event) => onFormat(event.target.value)}
          >
            {!isAudioOnly ? (
              <option value="mp4">{isMobile ? "MP4 · Video (Photos + Files)" : "MP4 · video"}</option>
            ) : null}
            <option value="mp3">{isMobile ? "M4A · Audio (Files)" : "MP3 · audio / sound"}</option>
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
