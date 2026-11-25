import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import type { Clip } from "../types";
import { formatDuration, formatShortTimecode, formatTimecode } from "../utils/format";

interface TimelineProps {
  durationMs: number;
  currentMsRef: RefObject<number>;
  clips: Clip[];
  activeClipId: string | null;
  pendingIn: number | null;
  pendingOut: number | null;
  onSeek: (ms: number) => void;
  onChangeClip: (id: string, startMs: number, endMs: number) => void;
  onSelectClip: (id: string) => void;
}

type DragMode = "start" | "end" | "move";

interface DragState {
  mode: DragMode;
  clipId: string;
  startMs: number;
  endMs: number;
  originX: number;
}

const MIN_CLIP_MS = 100;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const Timeline = memo(function Timeline({
  durationMs,
  currentMsRef,
  clips,
  activeClipId,
  pendingIn,
  pendingOut,
  onSeek,
  onChangeClip,
  onSelectClip,
}: TimelineProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const playedRef = useRef<HTMLDivElement>(null);
  const hoverLineRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragFrameRef = useRef(0);
  const dragXRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [zoom, setZoom] = useState(1);

  const { majorTicks, minorTicks } = useMemo(() => {
    if (durationMs <= 0) return { majorTicks: [] as number[], minorTicks: [] as number[] };
    const visibleSeconds = durationMs / 1000 / zoom;
    const step = TICK_STEPS.find((candidate) => visibleSeconds / candidate <= 8) ?? 7200;
    const stepMs = Math.round(step * 1000);
    const majors: number[] = [];
    for (let second = 0; second * 1000 <= durationMs; second += step) {
      majors.push(Math.round(second * 1000));
    }

    const minors: number[] = [];
    const subCount = 4;
    const subStep = stepMs / subCount;
    if (subStep >= 50) {
      for (let i = 0; i < majors.length; i += 1) {
        const base = majors[i];
        for (let s = 1; s < subCount; s += 1) {
          const candidate = Math.round(base + subStep * s);
          if (candidate > 0 && candidate < durationMs) {
            minors.push(candidate);
          }
        }
      }
    }

    return { majorTicks: majors, minorTicks: minors.slice(0, 96) };
  }, [durationMs, zoom]);

  const pct = (ms: number) => `${(ms / Math.max(1, durationMs)) * 100}%`;
  const widthPct = (start: number, end: number) =>
    `${Math.max(0.08, ((end - start) / Math.max(1, durationMs)) * 100)}%`;

  const msAt = useCallback(
    (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || durationMs <= 0) return 0;
      const ratio = (clientX - rect.left) / Math.max(1, rect.width);
      return clamp(Math.round(ratio * durationMs), 0, durationMs);
    },
    [durationMs],
  );

  const msPerPixel = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || durationMs <= 0) return 1;
    return durationMs / Math.max(1, rect.width);
  }, [durationMs]);

  const changeZoom = useCallback(
    (next: number) => {
      const safe = clamp(next, 1, 8);
      const viewport = viewportRef.current;
      const ratio = durationMs > 0 ? clamp(currentMsRef.current / durationMs, 0, 1) : 0;
      setZoom(safe);
      if (viewport) {
        window.requestAnimationFrame(() => {
          const target = ratio * viewport.clientWidth * safe - viewport.clientWidth / 2;
          viewport.scrollLeft = clamp(target, 0, Math.max(0, viewport.scrollWidth - viewport.clientWidth));
        });
      }
    },
    [currentMsRef, durationMs],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      changeZoom(zoom + (event.deltaY < 0 ? 0.35 : -0.35));
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [changeZoom, zoom]);

  // Move the playhead and played trail with GPU transforms; zero React renders per frame.
  useEffect(() => {
    if (durationMs <= 0) return;
    const canvas = canvasRef.current;
    let width = canvas?.clientWidth ?? 0;
    let lastX = -1;
    const observer = canvas
      ? new ResizeObserver(() => {
          width = canvas.clientWidth;
          lastX = -1;
        })
      : null;
    if (canvas) observer?.observe(canvas);

    let frame = 0;
    const tick = () => {
      const ratio = clamp(currentMsRef.current / durationMs, 0, 1);
      const x = Math.round(ratio * width * 10) / 10;
      if (x !== lastX) {
        lastX = x;
        if (playheadRef.current) {
          playheadRef.current.style.transform = `translate3d(${x}px, 0, 0)`;
        }
        if (playedRef.current) {
          playedRef.current.style.transform = `scaleX(${ratio})`;
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [currentMsRef, durationMs]);

  const applyDrag = useCallback(
    (clientX: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = Math.round((clientX - drag.originX) * msPerPixel());
      if (drag.mode === "start") {
        const next = clamp(drag.startMs + delta, 0, drag.endMs - MIN_CLIP_MS);
        onChangeClip(drag.clipId, next, drag.endMs);
      } else if (drag.mode === "end") {
        const next = clamp(drag.endMs + delta, drag.startMs + MIN_CLIP_MS, durationMs);
        onChangeClip(drag.clipId, drag.startMs, next);
      } else {
        const length = drag.endMs - drag.startMs;
        const next = clamp(drag.startMs + delta, 0, Math.max(0, durationMs - length));
        onChangeClip(drag.clipId, next, next + length);
      }
    },
    [durationMs, msPerPixel, onChangeClip],
  );

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (event: PointerEvent) => {
      dragXRef.current = event.clientX;
      if (dragFrameRef.current) return;
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = 0;
        applyDrag(dragXRef.current);
      });
    };
    const handleUp = () => {
      if (dragFrameRef.current) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = 0;
      }
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      if (dragFrameRef.current) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, [dragging, applyDrag]);

  const beginDrag = (event: ReactPointerEvent, clip: Clip, mode: DragMode) => {
    if (durationMs <= 0) return;
    event.stopPropagation();
    event.preventDefault();
    onSelectClip(clip.id);
    dragRef.current = {
      mode,
      clipId: clip.id,
      startMs: clip.startMs,
      endMs: clip.endMs,
      originX: event.clientX,
    };
    dragXRef.current = event.clientX;
    setDragging(true);
  };

  const moveTooltip = (clientX: number) => {
    const canvas = canvasRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas || !tooltip || durationMs <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const local = clamp(clientX - rect.left, 0, rect.width);
    const tipX = clamp(local, 42, Math.max(42, rect.width - 42));
    tooltip.textContent = formatTimecode(msAt(clientX));
    tooltip.style.transform = `translate3d(${tipX}px, 0, 0) translateX(-50%)`;
    tooltip.style.opacity = "1";
    if (hoverLineRef.current) {
      hoverLineRef.current.style.transform = `translate3d(${local}px, 0, 0)`;
      hoverLineRef.current.style.opacity = "1";
    }
  };

  const hideTooltip = () => {
    if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
    if (hoverLineRef.current) hoverLineRef.current.style.opacity = "0";
  };

  const pendingVisible =
    pendingIn != null && pendingOut != null && pendingOut - pendingIn >= MIN_CLIP_MS;

  return (
    <section className={`timeline${dragging ? " is-dragging" : ""}`} aria-label="Timeline">
      <div className="timeline-head">
        <div className="timeline-title-group">
          <span className="timeline-dot" aria-hidden="true" />
          <span className="section-title">Timeline</span>
          <span className="timeline-count">
            {clips.length > 0 ? `${clips.length} ${clips.length === 1 ? "cut" : "cuts"}` : "Ready"}
          </span>
        </div>

        <div className="timeline-readout">
          <span className={`timeline-readout-cell${pendingIn != null ? " is-set" : ""}`}>
            <span className="timeline-readout-dot" aria-hidden="true" />
            In <b>{pendingIn != null ? formatShortTimecode(pendingIn) : "—"}</b>
          </span>
          <span className="timeline-readout-sep" aria-hidden="true" />
          <span className={`timeline-readout-cell${pendingOut != null ? " is-set" : ""}`}>
            <span className="timeline-readout-dot" aria-hidden="true" />
            Out <b>{pendingOut != null ? formatShortTimecode(pendingOut) : "—"}</b>
          </span>
          <span className="timeline-readout-sep" aria-hidden="true" />
          <span className={`timeline-readout-cell${pendingVisible ? " is-accent" : " timeline-readout-muted"}`}>
            {pendingVisible ? "Span" : "Length"}{" "}
            <b>
              {pendingVisible
                ? formatDuration((pendingOut as number) - (pendingIn as number))
                : durationMs > 0
                  ? formatDuration(durationMs)
                  : "—"}
            </b>
          </span>
        </div>

        <div className="timeline-zoom">
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => changeZoom(zoom - 0.5)}
            disabled={zoom <= 1}
            title="Zoom out"
            aria-label="Zoom out timeline"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            className="timeline-zoom-val"
            onClick={() => changeZoom(1)}
            disabled={zoom <= 1}
            title={zoom > 1 ? "Reset zoom to 1.0x" : "Timeline zoom"}
          >
            {zoom.toFixed(1)}x
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            onClick={() => changeZoom(zoom + 0.5)}
            disabled={zoom >= 8}
            title="Zoom in"
            aria-label="Zoom in timeline"
          >
            <ZoomIn size={13} />
          </button>
        </div>
      </div>

      <div className="timeline-deck">
        <div className="timeline-viewport" ref={viewportRef}>
          <div className="timeline-canvas" ref={canvasRef} style={{ width: `${zoom * 100}%` }}>
            <div className="timeline-ruler" aria-hidden="true">
              {minorTicks.map((tick) => (
                <span key={`m-${tick}`} className="tick-minor" style={{ left: pct(tick) }} />
              ))}
              {majorTicks.map((tick, index) => (
                <span
                  key={tick}
                  className={`tick${index === 0 ? " tick-first" : ""}${
                    tick === majorTicks[majorTicks.length - 1] ? " tick-last" : ""
                  }`}
                  style={{ left: pct(tick) }}
                >
                  {formatDuration(tick)}
                </span>
              ))}
            </div>

            <div
              className="track"
              ref={trackRef}
              onPointerDown={(event) => {
                if (durationMs <= 0) return;
                onSeek(msAt(event.clientX));
              }}
              onPointerMove={(event) => moveTooltip(event.clientX)}
              onPointerLeave={hideTooltip}
              role="slider"
              aria-label="Video timeline"
              aria-valuemin={0}
              aria-valuemax={durationMs}
              aria-valuenow={Math.round(currentMsRef.current)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (durationMs <= 0) return;
                if (event.key === "ArrowLeft") onSeek(clamp(currentMsRef.current - 1000, 0, durationMs));
                if (event.key === "ArrowRight") onSeek(clamp(currentMsRef.current + 1000, 0, durationMs));
              }}
            >
              <div className="track-grid" aria-hidden="true">
                {majorTicks.map((tick, index) =>
                  index === 0 ? null : (
                    <span key={`g-${tick}`} className="track-grid-line" style={{ left: pct(tick) }} />
                  ),
                )}
              </div>

              <div className="track-rail" aria-hidden="true" />

              {durationMs > 0 ? (
                <div className="track-played" ref={playedRef} aria-hidden="true" />
              ) : null}

              {clips.map((clip, index) => {
                const active = clip.id === activeClipId;
                return (
                  <div
                    key={clip.id}
                    className={`selection${active ? " is-active" : ""}`}
                    style={{ left: pct(clip.startMs), width: widthPct(clip.startMs, clip.endMs) }}
                    onPointerDown={(event) => beginDrag(event, clip, "move")}
                    title={`${String(index + 1).padStart(2, "0")} · ${clip.name} · ${formatDuration(clip.endMs - clip.startMs)}`}
                  >
                    <span className="selection-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="selection-label">{formatDuration(clip.endMs - clip.startMs)}</span>
                    <span
                      className="handle handle-left"
                      onPointerDown={(event) => beginDrag(event, clip, "start")}
                      role="presentation"
                    />
                    <span
                      className="handle handle-right"
                      onPointerDown={(event) => beginDrag(event, clip, "end")}
                      role="presentation"
                    />
                  </div>
                );
              })}

              {pendingIn != null && !pendingVisible ? (
                <div className="pending-pin pending-pin-in" style={{ left: pct(pendingIn) }} aria-hidden="true">
                  <span>IN</span>
                </div>
              ) : null}

              {pendingOut != null && !pendingVisible ? (
                <div className="pending-pin pending-pin-out" style={{ left: pct(pendingOut) }} aria-hidden="true">
                  <span>OUT</span>
                </div>
              ) : null}

              {pendingVisible ? (
                <div
                  className="pending"
                  style={{
                    left: pct(pendingIn as number),
                    width: widthPct(pendingIn as number, pendingOut as number),
                  }}
                >
                  <span className="pending-label">
                    New cut · {formatDuration((pendingOut as number) - (pendingIn as number))}
                  </span>
                </div>
              ) : null}

              <div className="timeline-hover-line" ref={hoverLineRef} aria-hidden="true" />

              {durationMs > 0 ? (
                <div className="playhead" ref={playheadRef} aria-hidden="true">
                  <span className="playhead-cap" />
                </div>
              ) : null}

              <span className="timeline-scrub-tip" ref={tooltipRef} aria-hidden="true">
                {formatTimecode(0)}
              </span>

              {durationMs <= 0 ? (
                <div className="track-empty">
                  <span>Load a video to start marking cuts</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="timeline-foot">
        <p className="timeline-hint">
          Click to seek · drag cut blocks or trim edges · <kbd>Ctrl</kbd> + scroll to zoom
        </p>
        <div className="timeline-keys" aria-hidden="true">
          <span>
            <kbd>I</kbd> In
          </span>
          <span>
            <kbd>O</kbd> Out
          </span>
          <span>
            <kbd>C</kbd> Cut
          </span>
        </div>
      </div>
    </section>
  );
});
