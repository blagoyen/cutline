import { memo, useCallback, useMemo, useRef } from "react";
import { ArrowRight, ClipboardPaste, Link2, Loader2, PlaySquare, Tv, X } from "lucide-react";
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

function detectInputSource(raw: string): VideoSource | null {
  const lower = raw.trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes("twitch.tv")) return "twitch";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
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
      aria-label="Load a YouTube video or Twitch VOD"
    >
      <form
        className={`urlbar${detected ? ` urlbar-${detected}` : ""}${compact ? " urlbar-compact" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!loading && value.trim()) onSubmit();
        }}
      >
        <span className="urlbar-icon" aria-hidden="true">
          {detected === "twitch" ? (
            <Tv size={16} strokeWidth={1.85} />
          ) : detected === "youtube" ? (
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
          placeholder={isMobile ? "Paste YouTube or Twitch link…" : "Paste a YouTube video, Shorts, or Twitch VOD URL…"}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          aria-label="YouTube video or Twitch VOD URL"
          aria-invalid={Boolean(error)}
          disabled={loading || disabled}
        />
        {detected ? (
          <span className={`urlbar-badge urlbar-badge-${detected}`}>
            {detected === "twitch" ? "Twitch" : "YouTube"}
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
            {error ?? "youtube.com · youtu.be · Shorts · twitch.tv/videos · clips.twitch.tv"}
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
