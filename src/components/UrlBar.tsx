import { memo, useCallback, useMemo, useRef } from "react";
import { ArrowRight, Clapperboard, ClipboardPaste, Link2, Loader2, Music2, PlaySquare, Tv, X } from "lucide-react";
import type { VideoSource } from "../types";

interface UrlBarProps {
  value: string;
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  compact?: boolean;
  isMobile?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

type DetectedKind = { source: VideoSource; sound?: boolean } | null;

function detectInputSource(raw: string): DetectedKind {
  const lower = raw.trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes("twitch.tv")) return { source: "twitch" };
  if (lower.includes("tiktok.com")) {
    return { source: "tiktok", sound: lower.includes("/music/") };
  }
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return { source: "youtube" };
  return null;
}

export const UrlBar = memo(function UrlBar({
  value,
  loading,
  error,
  disabled,
  compact = false,
  isMobile = false,
  onChange,
  onSubmit,
}: UrlBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const detected = useMemo(() => detectInputSource(value), [value]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        onChange(text.trim());
        inputRef.current?.focus();
      }
    } catch {
      inputRef.current?.focus();
    }
  }, [onChange]);

  return (
    <section
      className={`urlbar-wrap${compact ? " urlbar-wrap-compact" : ""}`}
      aria-label="Load a YouTube, Twitch, or TikTok link"
    >
      <form
        className={`urlbar${detected ? ` urlbar-${detected.source}` : ""}${compact ? " urlbar-compact" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!loading && value.trim()) onSubmit();
        }}
      >
        <span className="urlbar-icon" aria-hidden="true">
          {detected?.source === "twitch" ? (
            <Tv size={16} strokeWidth={1.85} />
          ) : detected?.source === "tiktok" ? (
            detected.sound ? (
              <Music2 size={16} strokeWidth={1.85} />
            ) : (
              <Clapperboard size={16} strokeWidth={1.85} />
            )
          ) : detected?.source === "youtube" ? (
            <PlaySquare size={16} strokeWidth={1.85} />
          ) : (
            <Link2 size={16} strokeWidth={1.75} />
          )}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={
            isMobile
              ? "Paste YouTube, Twitch, or TikTok link…"
              : "Paste a YouTube, Twitch, or TikTok video / sound URL…"
          }
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          aria-label="YouTube, Twitch, or TikTok URL"
          aria-invalid={Boolean(error)}
          disabled={loading || disabled}
        />
        {detected ? (
          <span className={`urlbar-badge urlbar-badge-${detected.source}`}>
            {detected.source === "twitch"
              ? "Twitch"
              : detected.source === "tiktok"
                ? detected.sound
                  ? "TikTok Sound"
                  : "TikTok"
                : "YouTube"}
          </span>
        ) : null}
        {value.trim() && !loading ? (
          <button
            type="button"
            className="urlbar-util-btn"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            title="Clear URL"
            aria-label="Clear URL"
          >
            <X size={14} strokeWidth={2} />
          </button>
        ) : !loading && !isMobile ? (
          <button
            type="button"
            className="urlbar-util-btn urlbar-paste-btn"
            onClick={() => void handlePaste()}
            title="Paste link from clipboard"
          >
            <ClipboardPaste size={13} strokeWidth={2} />
            <span>Paste</span>
          </button>
        ) : null}
        <button
          type="submit"
          className="btn btn-primary urlbar-submit"
          disabled={loading || disabled || !value.trim()}
        >
          {loading ? (
            <>
              <Loader2 className="spin" size={14} /> Loading
            </>
          ) : (
            <>
              Import <ArrowRight size={14} />
            </>
          )}
        </button>
      </form>

      {error ? (
        <p className="urlbar-error-mobile" role="alert">
          {error}
        </p>
      ) : null}

      {!compact ? (
        <div className="urlbar-meta">
          <span className={error ? "error-text" : "urlbar-hint"}>
            {error ?? "youtube.com · twitch.tv · tiktok.com · vm.tiktok.com · tiktok.com/music"}
          </span>
          <span className="urlbar-meta-sep" aria-hidden="true" />
          <span className="urlbar-privacy">Local yt-dlp &amp; FFmpeg</span>
        </div>
      ) : error ? (
        <div className="urlbar-meta">
          <span className="error-text">{error}</span>
        </div>
      ) : null}
    </section>
  );
});
