import { memo, useRef } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";

interface UrlBarProps {
  value: string;
  loading: boolean;
  error: string | null;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export const UrlBar = memo(function UrlBar({ value, loading, error, disabled, onChange, onSubmit }: UrlBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="urlbar-wrap" aria-label="Load a YouTube video">
      <form
        className="urlbar"
        onSubmit={(event) => {
          event.preventDefault();
          if (!loading && value.trim()) onSubmit();
        }}
      >
        <span className="urlbar-icon" aria-hidden="true">
          <Link2 size={17} strokeWidth={1.75} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Paste YouTube video URL here..."
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          aria-label="YouTube video URL"
          aria-invalid={Boolean(error)}
          disabled={loading || disabled}
        />
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
              Load video <ArrowRight size={14} />
            </>
          )}
        </button>
      </form>

      <div className="urlbar-meta">
        <span className={error ? "error-text" : "urlbar-hint"}>
          {error ?? "youtube.com/watch · youtu.be · Shorts"}
        </span>
        <span className="urlbar-meta-sep" aria-hidden="true" />
        <span className="urlbar-privacy">Nothing uploaded · runs locally</span>
      </div>
    </section>
  );
});
