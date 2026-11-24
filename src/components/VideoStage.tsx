import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { Chapter, Clip, VideoInfo } from "../types";
import type { PlayerState } from "../hooks/useYouTubePlayer";
import { PLAYBACK_RATES } from "../hooks/useYouTubePlayer";
import { formatCount, formatShortTimecode, formatTimecode } from "../utils/format";

type Player = PlayerState & {
  currentMsRef: RefObject<number>;
  loadedFractionRef: RefObject<number>;
  toggle: () => void;
  toggleMute: () => void;
  setVolume: (value: number) => void;
  setPlaybackRate: (rate: number) => void;
};

interface VideoStageProps {
  video: VideoInfo | null;
  hostRef: RefObject<HTMLDivElement | null>;
  player: Player;
  clips: Clip[];
  pendingIn: number | null;
  pendingOut: number | null;
  activeRange: { startMs: number; endMs: number } | null;
  canAddCut: boolean;
  loopEnabled: boolean;
  canLoop: boolean;
  chapters: Chapter[];
  onOpenSource: () => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onAddCut: () => void;
  onToggleLoop: () => void;
  onSeek: (ms: number) => void;
  onSkip: (deltaMs: number) => void;
  onQuickCut: (lengthMs: number) => void;
  onJumpChapter: (chapter: Chapter) => void;
  onChapterToCut: (chapter: Chapter) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const QUICK_PRESETS = [10_000, 30_000, 60_000] as const;

export const VideoStage = memo(function VideoStage({
  video,
  hostRef,
  player,
  clips,
  pendingIn,
  pendingOut,
  activeRange,
  canAddCut,
  loopEnabled,
  canLoop,
  chapters,
  onOpenSource,
  onMarkIn,
  onMarkOut,
  onAddCut,
  onToggleLoop,
  onSeek,
  onSkip,
  onQuickCut,
  onJumpChapter,
  onChapterToCut,
}: VideoStageProps) {
  const durationMs = player.durationMs || video?.durationMs || 0;
  const showPoster = Boolean(video) && !player.ready;
  const frameRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubWidthRef = useRef(0);
  const bufferedRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLElement>(null);
  const clockRef = player.currentMsRef;
  const loadedRef = player.loadedFractionRef;
  const [fullscreen, setFullscreen] = useState(false);
  const [chapterIndex, setChapterIndex] = useState(0);

  const pct = useCallback(
    (ms: number) => `${(clamp(ms, 0, Math.max(1, durationMs)) / Math.max(1, durationMs)) * 100}%`,
    [durationMs],
  );

  const msFromPointer = useCallback(
    (clientX: number) => {
      const rect = scrubRef.current?.getBoundingClientRect();
      if (!rect || durationMs <= 0) return 0;
      return clamp(Math.round(((clientX - rect.left) / Math.max(1, rect.width)) * durationMs), 0, durationMs);
    },
    [durationMs],
  );

  // Cache the scrubber width in pixels; percentage transforms move the wrong box.
  useEffect(() => {
    const strip = scrubRef.current;
    if (!strip) return;
    const measure = () => {
      scrubWidthRef.current = strip.clientWidth;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [video]);

  // One rAF loop updates the playhead and timecode without React state.
  // DOM writes are skipped when nothing changed, so a paused player costs
  // almost nothing per frame (no style invalidation, no text updates).
  useEffect(() => {
    let frame = 0;
    let lastX = -1;
    let lastBuffered = -1;
    let lastText = "";
    const tick = () => {
      const ms = clockRef.current;
      const ratio = durationMs > 0 ? clamp(ms / durationMs, 0, 1) : 0;
      const x = Math.round(ratio * scrubWidthRef.current * 10) / 10;
      if (playheadRef.current && x !== lastX) {
        lastX = x;
        playheadRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
      }
      const buffered = Math.round(clamp(loadedRef.current, 0, 1) * 1000) / 1000;
      if (bufferedRef.current && buffered !== lastBuffered) {
        lastBuffered = buffered;
        bufferedRef.current.style.transform = `scaleX(${buffered})`;
      }
      if (timeRef.current) {
        const text = formatTimecode(ms);
        if (text !== lastText) {
          lastText = text;
          timeRef.current.textContent = text;
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [clockRef, loadedRef, durationMs, video]);

  useEffect(() => {
    const handle = () => setFullscreen(document.fullscreenElement === frameRef.current);
    document.addEventListener("fullscreenchange", handle);
    return () => document.removeEventListener("fullscreenchange", handle);
  }, []);

  useEffect(() => {
    if (chapterIndex >= chapters.length) setChapterIndex(0);
  }, [chapterIndex, chapters.length]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement === frameRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void frameRef.current?.requestFullscreen().catch(() => undefined);
    }
  };

  const tooltipAt = (clientX: number) => {
    const rect = scrubRef.current?.getBoundingClientRect();
    const tip = tooltipRef.current;
    if (!rect || !tip) return;
    const local = clamp(clientX - rect.left, 0, rect.width);
    tip.textContent = formatTimecode(msFromPointer(clientX));
    tip.style.transform = `translate3d(${clamp(local - 44, 0, Math.max(0, rect.width - 88))}px, 0, 0)`;
  };

  // Scrubbing is throttled with rAF; the playhead updates above.
  const draggingRef = useRef(false);
  const dragXRef = useRef(0);
  const dragFrameRef = useRef(0);
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (durationMs <= 0) return;
    draggingRef.current = true;
    dragXRef.current = event.clientX;
    onSeek(msFromPointer(event.clientX));
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      dragXRef.current = event.clientX;
      if (dragFrameRef.current) return;
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = 0;
        if (draggingRef.current) onSeek(msFromPointer(dragXRef.current));
      });
    };
    const stop = () => {
      draggingRef.current = false;
      if (dragFrameRef.current) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = 0;
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (dragFrameRef.current) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, [msFromPointer, onSeek]);

  const selectedChapter = chapters[chapterIndex] ?? null;

  return (
    <section className="stage" aria-label="Video preview">
      <div className="video-head">
        <div className="video-head-text">
          <span className="eyebrow eyebrow-sm">{video ? `Video · ${video.id}` : "Preview"}</span>
          <h2 className="video-title" title={video?.title}>
            {video ? video.title : "No video loaded"}
          </h2>
          {video ? (
            <div className="video-meta">
              {video.uploader ? <span>{video.uploader}</span> : null}
              {video.uploadDate ? <span>{video.uploadDate}</span> : null}
              {video.viewCount != null ? <span>{formatCount(video.viewCount)}</span> : null}
              {video.maxHeight > 0 ? (
                <span className="video-badge">{video.maxHeight}p max</span>
              ) : null}
            </div>
          ) : (
            <div className="video-meta">
              <span>Paste a link above and press Load video.</span>
            </div>
          )}
        </div>

        {video ? (
          <button
            type="button"
            className="btn btn-quiet video-source"
            onClick={onOpenSource}
            title="Open the source video on YouTube"
          >
            Open on YouTube <ExternalLink size={12} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <div className={`player-frame${video ? "" : " is-empty"}`} ref={frameRef}>
        <div className={`frame${video ? "" : " is-empty"}`}>
          <div className="player-host-wrap" ref={hostRef} aria-hidden={!video} />
          {video ? <span className="player-brand-mask" aria-hidden="true" /> : null}

          {showPoster && !player.error ? (
            <div className="frame-overlay">
              {video?.thumbnail ? (
                <img className="frame-poster" src={video.thumbnail} alt="" draggable={false} />
              ) : null}
              <div className="frame-overlay-inner">
                <Loader2 className="spin" size={18} strokeWidth={2} />
                <span>Loading player</span>
              </div>
            </div>
          ) : null}

          {video && player.error ? (
            <div className="frame-fallback">
              {video.thumbnail ? (
                <img className="frame-poster" src={video.thumbnail} alt="" draggable={false} />
              ) : null}
              <div className="frame-fallback-inner">
                <span className="frame-fallback-label">Preview unavailable</span>
                <p className="frame-fallback-text">{player.error}</p>
                <div className="frame-fallback-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={onOpenSource}>
                    Watch on YouTube
                  </button>
                  <span className="frame-fallback-note">Clip downloads still work.</span>
                </div>
              </div>
            </div>
          ) : null}

          {!video ? (
            <div className="frame-empty">
              <span className="frame-empty-mark" aria-hidden="true" />
              <span className="frame-empty-label">Paste a link to begin</span>
              <span className="frame-empty-hint">
                Mark in and out points, then download only those moments.
              </span>
            </div>
          ) : null}
        </div>

        {video ? (
          <div className="editorial-deck">
            <div
              className="deck-scrub"
              ref={scrubRef}
              onPointerDown={startDrag}
              onPointerMove={(event) => tooltipAt(event.clientX)}
              onPointerLeave={() => {
                if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
              }}
              onPointerEnter={() => {
                if (tooltipRef.current) tooltipRef.current.style.opacity = "1";
              }}
              role="slider"
              aria-label="Playback position"
              aria-valuemin={0}
              aria-valuemax={durationMs}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") onSkip(-1000);
                if (event.key === "ArrowRight") onSkip(1000);
              }}
            >
              <div className="deck-buffered" ref={bufferedRef} />
              {clips.map((clip, index) => (
                <span
                  key={clip.id}
                  className={`deck-cut-mark${
                    activeRange != null &&
                    clip.startMs === activeRange.startMs &&
                    clip.endMs === activeRange.endMs
                      ? " is-active"
                      : ""
                  }`}
                  style={{ left: pct(clip.startMs) }}
                  title={`Cut ${String(index + 1).padStart(2, "0")} · ${formatShortTimecode(clip.startMs)}`}
                />
              ))}
              {activeRange ? (
                <div
                  className="deck-zone"
                  style={{ left: pct(activeRange.startMs), width: pct(activeRange.endMs - activeRange.startMs) }}
                />
              ) : null}
              <div className="deck-playhead" ref={playheadRef} aria-hidden="true" />
              <span className="deck-scrub-tip" ref={tooltipRef} aria-hidden="true">
                {formatTimecode(0)}
              </span>
            </div>

            <div className="deck-transport">
              <div className="deck-group deck-group-left">
                <button
                  type="button"
                  className={`deck-play${player.playing ? " is-playing" : ""}`}
                  onClick={player.toggle}
                  disabled={!player.ready}
                  aria-label={player.playing ? "Pause" : "Play"}
                  title={`${player.playing ? "Pause" : "Play"} [Space]`}
                >
                  {player.playing ? (
                    <Pause size={15} strokeWidth={2.2} fill="currentColor" />
                  ) : (
                    <Play size={15} strokeWidth={2.2} fill="currentColor" />
                  )}
                </button>
                <button
                  type="button"
                  className="deck-skip"
                  onClick={() => onSkip(-5000)}
                  disabled={!player.ready}
                  title="Back 5 seconds"
                  aria-label="Skip back 5 seconds"
                >
                  <SkipBack size={14} strokeWidth={2} />
                  <b>5</b>
                </button>
                <button
                  type="button"
                  className="deck-skip"
                  onClick={() => onSkip(5000)}
                  disabled={!player.ready}
                  title="Forward 5 seconds"
                  aria-label="Skip forward 5 seconds"
                >
                  <SkipForward size={14} strokeWidth={2} />
                  <b>5</b>
                </button>
                <div className="deck-volume">
                  <button
                    type="button"
                    className="deck-mute"
                    onClick={player.toggleMute}
                    disabled={!player.ready}
                    aria-label={player.muted ? "Unmute" : "Mute"}
                    title={player.muted ? "Unmute" : "Mute"}
                  >
                    {player.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                  <input
                    className="deck-volume-range"
                    type="range"
                    min={0}
                    max={100}
                    value={player.muted ? 0 : player.volume}
                    disabled={!player.ready}
                    aria-label="Volume"
                    onChange={(event) => player.setVolume(Number(event.target.value))}
                  />
                </div>
                <label className="deck-speed">
                  <select
                    className="input input-compact"
                    value={player.playbackRate}
                    disabled={!player.ready}
                    aria-label="Playback speed"
                    title="Playback speed"
                    onChange={(event) => player.setPlaybackRate(Number(event.target.value))}
                  >
                    {PLAYBACK_RATES.map((rate) => (
                      <option key={rate} value={rate}>
                        {rate === 1 ? "1x" : `${rate}x`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="deck-time" aria-label="Playback time">
                <b ref={timeRef}>{formatTimecode(0)}</b>
                <span>/</span>
                <span>{formatTimecode(durationMs)}</span>
                {player.buffering ? <em>BUF</em> : null}
              </div>

              <div className="deck-group deck-group-right">
                <button
                  type="button"
                  className={`deck-chip${loopEnabled ? " is-on" : ""}`}
                  onClick={onToggleLoop}
                  disabled={!canLoop}
                  title="Loop the active in/out range [L]"
                >
                  <Repeat size={12} strokeWidth={2} /> Loop <kbd>L</kbd>
                </button>
                <button
                  type="button"
                  className={`deck-chip${pendingIn != null ? " is-set" : ""}`}
                  onClick={onMarkIn}
                  disabled={!player.ready}
                  title="Set mark in at the playhead [I]"
                >
                  In {pendingIn != null ? <b>{formatShortTimecode(pendingIn)}</b> : <kbd>I</kbd>}
                </button>
                <button
                  type="button"
                  className={`deck-chip${pendingOut != null ? " is-set" : ""}`}
                  onClick={onMarkOut}
                  disabled={!player.ready}
                  title="Set mark out at the playhead [O]"
                >
                  Out {pendingOut != null ? <b>{formatShortTimecode(pendingOut)}</b> : <kbd>O</kbd>}
                </button>
                <button
                  type="button"
                  className="deck-add"
                  onClick={onAddCut}
                  disabled={!canAddCut}
                  title="Add the marked range as a cut [C]"
                >
                  <Plus size={13} strokeWidth={2.4} /> Add cut <kbd>C</kbd>
                </button>
                <button
                  type="button"
                  className="deck-fullscreen"
                  onClick={toggleFullscreen}
                  title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                  aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
            </div>

            <div className="deck-utility">
              <span className="deck-utility-label">Quick cut</span>
              {QUICK_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="deck-preset"
                  onClick={() => onQuickCut(preset)}
                  disabled={!player.ready}
                  title={`Create a ${preset / 1000}s cut from the mark-in point or playhead`}
                >
                  +{preset / 1000}s
                </button>
              ))}
              {chapters.length > 0 ? (
                <div className="deck-chapters">
                  <span className="deck-utility-sep" aria-hidden="true" />
                  <span className="deck-utility-label">Chapters</span>
                  <select
                    className="input input-compact"
                    value={chapterIndex}
                    aria-label="Jump to chapter"
                    onChange={(event) => {
                      const index = Number(event.target.value);
                      setChapterIndex(index);
                      const chapter = chapters[index];
                      if (chapter) onJumpChapter(chapter);
                    }}
                  >
                    {chapters.map((chapter, index) => (
                      <option key={`${chapter.startMs}-${index}`} value={index}>
                        {String(index + 1).padStart(2, "0")} · {chapter.title} ·{" "}
                        {formatShortTimecode(chapter.startMs)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="deck-preset deck-preset-strong"
                    disabled={!selectedChapter}
                    onClick={() => {
                      if (selectedChapter) onChapterToCut(selectedChapter);
                    }}
                    title="Turn the selected chapter into a cut"
                  >
                    + Chapter cut
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
});
