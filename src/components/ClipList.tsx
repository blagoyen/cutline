import { memo, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Crosshair,
  Download,
  FileVideo,
  Loader2,
  Minus,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Clip, DownloadTask } from "../types";
import {
  formatDuration,
  formatEta,
  formatSpeed,
  formatTimecode,
  parseTimecode,
} from "../utils/format";

export type ClipEdge = "start" | "end";

interface ClipListProps {
  clips: Clip[];
  durationMs: number;
  activeClipId: string | null;
  tasksByClip: Map<string, DownloadTask>;
  busy: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Clip>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onPreview: (clip: Clip) => void;
  onLoop: (clip: Clip) => void;
  onDownload: (clip: Clip) => void;
  onCancelDownload?: (taskId: string) => void;
  onOpenFile?: (path: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onNudge: (id: string, edge: ClipEdge, deltaMs: number) => void;
  onSnap: (id: string, edge: ClipEdge) => void;
  onAdd: () => void;
  onFixOverlaps: () => void;
}

interface TimeFieldProps {
  label: string;
  edge: ClipEdge;
  valueMs: number;
  commit: (ms: number) => string | null;
  onErrorChange: (message: string | null) => void;
  onNudge: (edge: ClipEdge, deltaMs: number) => void;
  onSnap: (edge: ClipEdge) => void;
}

function TimeField({
  label,
  edge,
  valueMs,
  commit,
  onErrorChange,
  onNudge,
  onSnap,
}: TimeFieldProps) {
  const [text, setText] = useState(() => formatTimecode(valueMs));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(formatTimecode(valueMs));
      setInvalid(false);
    }
  }, [valueMs, focused]);

  const apply = () => {
    const parsed = parseTimecode(text);
    if (parsed.ms == null) {
      setInvalid(true);
      onErrorChange(parsed.error);
      setText(formatTimecode(valueMs));
      return;
    }
    const error = commit(parsed.ms);
    if (error) {
      setInvalid(true);
      onErrorChange(error);
      setText(formatTimecode(valueMs));
      return;
    }
    setInvalid(false);
    onErrorChange(null);
    setText(formatTimecode(parsed.ms));
  };

  return (
    <div className="time-field">
      <span className="field-label">{label}</span>
      <div className="time-control">
        <input
          className={`time-input${invalid ? " is-invalid" : ""}`}
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-label={`${label} timestamp`}
          onChange={(event) => {
            setText(event.target.value);
            if (invalid) {
              setInvalid(false);
              onErrorChange(null);
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            apply();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setText(formatTimecode(valueMs));
              setInvalid(false);
              onErrorChange(null);
              event.currentTarget.blur();
            }
          }}
        />
        <div className="time-segment" role="group" aria-label={`${label} adjustments`}>
          <button
            type="button"
            className="time-seg-btn"
            title={`Nudge ${label.toLowerCase()} back 0.1s`}
            aria-label={`Nudge ${label.toLowerCase()} back 0.1 seconds`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onNudge(edge, -100)}
          >
            <Minus size={11} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="time-seg-btn"
            title={`Nudge ${label.toLowerCase()} forward 0.1s`}
            aria-label={`Nudge ${label.toLowerCase()} forward 0.1 seconds`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onNudge(edge, 100)}
          >
            <Plus size={11} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="time-seg-btn time-seg-snap"
            title={`Snap ${label.toLowerCase()} to the current playhead`}
            aria-label={`Snap ${label.toLowerCase()} to the current playhead`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSnap(edge)}
          >
            <Crosshair size={11} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

function statusLabel(task: DownloadTask): string {
  switch (task.status) {
    case "queued":
      return "Queued";
    case "fetching":
      return `Downloading ${Math.round(task.progress * 100)}%`;
    case "processing":
      return "Processing";
    case "completed":
      return "Saved";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "";
  }
}

interface ClipIssue {
  message: string;
  kind: "overlap" | "invalid";
}

type ClipRowProps = {
  clip: Clip;
  index: number;
  count: number;
  durationMs: number;
  active: boolean;
  task: DownloadTask | undefined;
  busy: boolean;
  issue: ClipIssue | undefined;
} & Pick<
  ClipListProps,
  | "onSelect"
  | "onChange"
  | "onDelete"
  | "onDuplicate"
  | "onPreview"
  | "onLoop"
  | "onDownload"
  | "onCancelDownload"
  | "onOpenFile"
  | "onMove"
  | "onNudge"
  | "onSnap"
  | "onFixOverlaps"
>;

const ClipRow = memo(function ClipRow({
  clip,
  index,
  count,
  durationMs,
  active,
  task,
  busy,
  issue,
  onSelect,
  onChange,
  onDelete,
  onDuplicate,
  onPreview,
  onLoop,
  onDownload,
  onCancelDownload,
  onOpenFile,
  onMove,
  onNudge,
  onSnap,
  onFixOverlaps,
}: ClipRowProps) {
  const [error, setError] = useState<string | null>(null);

  const commitStart = (ms: number): string | null => {
    if (ms < 0) return "Start cannot be negative.";
    if (ms > durationMs) return "Start is beyond the video duration.";
    if (clip.endMs - ms < 100) return "Start must be at least 0.1s before the end.";
    onChange(clip.id, { startMs: ms });
    return null;
  };

  const commitEnd = (ms: number): string | null => {
    if (ms > durationMs) return `End can't exceed the video length (${formatTimecode(durationMs)}).`;
    if (ms - clip.startMs < 100) return "End must be at least 0.1s after the start.";
    onChange(clip.id, { endMs: ms });
    return null;
  };

  const isWorking =
    task?.status === "fetching" || task?.status === "processing" || task?.status === "queued";
  const isCompleted = task?.status === "completed";
  const knownProgress = Boolean(
    task && (task.status === "completed" || (task.totalBytes != null && task.totalBytes > 0) || task.progress > 0),
  );
  const percent = task ? Math.min(100, Math.round(task.progress * 100)) : 0;
  const localIssue = error ? { message: error, kind: "invalid" as const } : undefined;
  const message = localIssue ?? issue;

  return (
    <div
      className={`clip-card${active ? " is-active" : ""}${message ? " has-error" : ""}${isWorking ? " is-downloading" : ""}${isCompleted ? " is-saved" : ""}`}
      style={{ animationDelay: `${Math.min(index, 8) * 20}ms` }}
      onPointerDown={() => onSelect(clip.id)}
    >
      <div className="clip-card-top">
        <span className="clip-index">{String(index + 1).padStart(2, "0")}</span>

        <div className="clip-identity">
          <div className="clip-name-wrap">
            <input
              className="clip-name"
              value={clip.name}
              onChange={(event) => onChange(clip.id, { name: event.target.value })}
              onBlur={() => {
                if (!clip.name.trim()) {
                  onChange(clip.id, { name: `Clip ${String(index + 1).padStart(2, "0")}` });
                }
              }}
              aria-label="Clip name"
              title="Click to rename this output file"
              spellCheck={false}
            />
            <Pencil className="rename-pencil" size={10} strokeWidth={2} aria-hidden="true" />
          </div>
          {message ? (
            <span className="clip-issue" role="alert">
              <b className={`clip-issue-badge badge-${message.kind}`}>
                <TriangleAlert size={9} strokeWidth={2.4} />
                {message.kind === "overlap" ? "OVERLAP" : "CHECK"}
              </b>
              <span className="clip-issue-text">{message.message}</span>
              <button
                type="button"
                className="clip-fix"
                title="Trim this cut so it no longer overlaps the previous one"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onFixOverlaps();
                }}
              >
                Fix
              </button>
            </span>
          ) : (
            <span className={`clip-sub${task ? ` clip-sub-${task.status}` : ""}`}>
              {task ? statusLabel(task) : formatDuration(clip.endMs - clip.startMs)}
            </span>
          )}
        </div>

        <span className="clip-length-pill">{formatDuration(clip.endMs - clip.startMs)}</span>
      </div>

      <div className="clip-card-controls">
        <TimeField
          label="In"
          edge="start"
          valueMs={clip.startMs}
          commit={commitStart}
          onErrorChange={setError}
          onNudge={(edge, delta) => onNudge(clip.id, edge, delta)}
          onSnap={(edge) => onSnap(clip.id, edge)}
        />
        <TimeField
          label="Out"
          edge="end"
          valueMs={clip.endMs}
          commit={commitEnd}
          onErrorChange={setError}
          onNudge={(edge, delta) => onNudge(clip.id, edge, delta)}
          onSnap={(edge) => onSnap(clip.id, edge)}
        />
      </div>

      {isWorking && task ? (
        <div className="clip-inline-progress" aria-label={`Download progress for ${clip.name}`}>
          <div className={`progress progress-sm${knownProgress ? "" : " progress-indeterminate"}`}>
            <div
              className={`progress-fill${task.status === "processing" ? " is-processing" : ""}`}
              style={knownProgress ? { width: `${Math.max(2, percent)}%` } : undefined}
            />
          </div>
          <div className="clip-inline-progress-meta">
            <span>
              {task.status === "queued"
                ? "Queued"
                : task.status === "processing"
                  ? knownProgress
                    ? `Trimming ${percent}%`
                    : "Processing…"
                  : knownProgress
                    ? `${percent}%`
                    : "Downloading…"}
              {task.speedBps && task.speedBps > 0 ? ` · ${formatSpeed(task.speedBps)}` : ""}
              {task.etaSecs && task.etaSecs > 0 ? ` · ETA ${formatEta(task.etaSecs)}` : ""}
            </span>
            {onCancelDownload ? (
              <button
                type="button"
                className="clip-inline-cancel"
                onClick={(event) => {
                  event.stopPropagation();
                  onCancelDownload(task.id);
                }}
              >
                <X size={11} strokeWidth={2.2} /> Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="clip-card-foot">
        <div className="clip-action-group">
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title="Preview from the in point"
            aria-label="Preview clip"
            onClick={(event) => {
              event.stopPropagation();
              onPreview(clip);
            }}
          >
            <Play size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title="Loop this cut [L]"
            aria-label="Preview and loop clip"
            onClick={(event) => {
              event.stopPropagation();
              onLoop(clip);
            }}
          >
            <Repeat size={13} strokeWidth={2} />
          </button>
          {isCompleted && task?.outputPath && onOpenFile ? (
            <button
              type="button"
              className="btn btn-quiet btn-xs clip-open-btn"
              title="Open saved clip"
              onClick={(event) => {
                event.stopPropagation();
                onOpenFile(task.outputPath as string);
              }}
            >
              <Check size={11} strokeWidth={2.4} />
              <FileVideo size={11} strokeWidth={2} /> Open
            </button>
          ) : (
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              title="Download this cut on its own"
              aria-label="Download clip"
              disabled={busy || isWorking}
              onClick={(event) => {
                event.stopPropagation();
                onDownload(clip);
              }}
            >
              {isWorking ? (
                <Loader2 className="spin" size={13} />
              ) : (
                <Download size={13} strokeWidth={2} />
              )}
            </button>
          )}
        </div>

        <div className="clip-action-group">
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title="Move up"
            aria-label="Move clip up"
            disabled={index === 0}
            onClick={(event) => {
              event.stopPropagation();
              onMove(clip.id, -1);
            }}
          >
            <ArrowUp size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title="Move down"
            aria-label="Move clip down"
            disabled={index === count - 1}
            onClick={(event) => {
              event.stopPropagation();
              onMove(clip.id, 1);
            }}
          >
            <ArrowDown size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            title="Duplicate cut"
            aria-label="Duplicate clip"
            onClick={(event) => {
              event.stopPropagation();
              onDuplicate(clip.id);
            }}
          >
            <Copy size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm icon-btn-danger"
            title="Delete cut"
            aria-label="Delete clip"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(clip.id);
            }}
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
});

export const ClipList = memo(function ClipList(props: ClipListProps) {
  const { clips, tasksByClip } = props;

  const issues = useMemo(() => {
    const found = new Map<string, ClipIssue>();
    clips.forEach((clip, index) => {
      if (clip.endMs <= clip.startMs) {
        found.set(clip.id, { message: "Start must be before end.", kind: "invalid" });
      }
      clips.forEach((other, otherIndex) => {
        if (otherIndex <= index) return;
        if (clip.startMs < other.endMs && other.startMs < clip.endMs) {
          const label = String(otherIndex + 1).padStart(2, "0");
          found.set(clip.id, { message: `Overlaps cut ${label}.`, kind: "overlap" });
          found.set(other.id, {
            message: `Overlaps cut ${String(index + 1).padStart(2, "0")}.`,
            kind: "overlap",
          });
        }
      });
    });
    return found;
  }, [clips]);

  return (
    <section className="clips" aria-label="Selected cuts">
      <div className="section-head">
        <div className="section-head-left">
          <h3 className="section-title">Cuts</h3>
          <span className="section-count">
            {clips.length} {clips.length === 1 ? "clip" : "clips"}
          </span>
        </div>
        {clips.length > 0 ? (
          <span className="section-note">Click a name to rename · [I] [O] [C]</span>
        ) : (
          <span className="section-note">You can also type exact times below</span>
        )}
        <button type="button" className="btn btn-quiet btn-xs" onClick={props.onAdd}>
          <Plus size={12} strokeWidth={2} /> Add cut
        </button>
      </div>

      {clips.length === 0 ? (
        <div className="clips-empty">
          <span className="clips-empty-mark" aria-hidden="true" />
          <div>
            <p className="clips-empty-title">No cuts yet</p>
            <p className="clips-empty-text">
              Play the video, press <b>Mark in</b> and <b>Mark out</b>, then <b>Add cut</b>. Use the
              quick presets for fixed-length clips, or <b>←</b> / <b>→</b> (hold <b>Shift</b> for 0.1s).
            </p>
          </div>
        </div>
      ) : (
        <div className="clip-list">
          {clips.map((clip, index) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              index={index}
              count={clips.length}
              durationMs={props.durationMs}
              active={clip.id === props.activeClipId}
              task={tasksByClip.get(clip.id)}
              busy={props.busy}
              issue={issues.get(clip.id)}
              onSelect={props.onSelect}
              onChange={props.onChange}
              onDelete={props.onDelete}
              onDuplicate={props.onDuplicate}
              onPreview={props.onPreview}
              onLoop={props.onLoop}
              onDownload={props.onDownload}
              onCancelDownload={props.onCancelDownload}
              onOpenFile={props.onOpenFile}
              onMove={props.onMove}
              onNudge={props.onNudge}
              onSnap={props.onSnap}
              onFixOverlaps={props.onFixOverlaps}
            />
          ))}
        </div>
      )}
    </section>
  );
});
