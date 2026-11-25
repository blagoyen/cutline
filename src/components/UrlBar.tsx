import { memo, useMemo, useRef } from "react";
import { ArrowRight, Link2, Loader2, PlaySquare, Tv } from "lucide-react";
import type { VideoSource } from "../types";

interface UrlBarProps {
  value: string;
  loading: boolean;
  error: string | null;
  disabled?: boolean;
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
  isMobile = false,
  onChange,
  onSubmit,
}: UrlBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const detected = useMemo(() => detectInputSource(value), [value]);

  return (
    <section className="urlbar-wrap" aria-label="Load a YouTube video or Twitch VOD">
      <form
        className={`urlbar${detected ? ` urlbar-${detected}` : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!loading && value.trim()) onSubmit();
        }}
      >
        <span className="urlbar-icon" aria-hidden="true">
          {detected === "twitch" ? (
            <Tv size={17} strokeWidth={1.85} />
          ) : detected === "youtube" ? (
            <PlaySquare size={17} strokeWidth={1.85} />
          ) : (
            <Link2 size={17} strokeWidth={1.75} />
          )}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={isMobile ? "Paste YouTube or Twitch link…" : "Paste a YouTube video or Twitch VOD link..."}
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

      <div className="urlbar-meta">
        <span className={error ? "error-text" : "urlbar-hint"}>
          {error ?? "youtube.com · youtu.be · Shorts · twitch.tv/videos · clips.twitch.tv"}
        </span>
        <span className="urlbar-meta-sep" aria-hidden="true" />
        <span className="urlbar-privacy">Nothing uploaded · runs locally</span>
      </div>
    </section>
  );
});
