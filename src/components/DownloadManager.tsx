import { memo, useMemo } from "react";
import {
  Check,
  FileVideo,
  FolderOpen,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type { DownloadTask } from "../types";
import {
  formatBytes,
  formatDuration,
  formatEta,
  formatSpeed,
  formatTimecode,
  qualityLabel,
} from "../utils/format";

interface DownloadManagerProps {
  tasks: DownloadTask[];
  activeCount: number;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenFile: (path: string) => void;
  onReveal: (path: string) => void;
  onOpenFolder: () => void;
  onClearFinished: () => void;
}

const STATUS_LABEL: Record<DownloadTask["status"], string> = {
  queued: "Queued",
  fetching: "Fetching",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

type DownloadRowProps = {
  task: DownloadTask;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenFile: (path: string) => void;
  onReveal: (path: string) => void;
};

const DownloadRow = memo(function DownloadRow({
  task,
  onCancel,
  onRetry,
  onRemove,
  onOpenFile,
  onReveal,
}: DownloadRowProps) {
  const active = task.status === "fetching" || task.status === "processing";
  const finished = task.status === "completed";
  const retryable = task.status === "failed" || task.status === "cancelled";
  const knownProgress = task.totalBytes != null && task.totalBytes > 0;
  const percent = knownProgress ? Math.min(100, Math.round(task.progress * 100)) : 0;
  const finalSize = task.fileSize ?? (task.totalBytes && task.totalBytes > 0 ? task.totalBytes : null);

  return (
    <div className={`dl-row${finished ? " is-done" : ""}`}>
      <div className="dl-head">
        <div className="dl-title-group">
          <span className="dl-name" title={task.clipName}>
            {task.clipName}
          </span>
          {finished ? (
            <span className="dl-ready-badge">
              <Check size={10} strokeWidth={2.6} /> Ready
            </span>
          ) : null}
          <span className={`status status-${task.status}`}>
            {active ? <Loader2 className="spin" size={10} strokeWidth={2.4} /> : null}
            {STATUS_LABEL[task.status]}
          </span>
        </div>
        <div className="dl-actions">
          {finished && task.outputPath ? (
            <>
              <button
                type="button"
                className="btn btn-quiet btn-xs"
                onClick={() => onOpenFile(task.outputPath as string)}
                title="Open the exported file"
              >
                <FileVideo size={12} strokeWidth={2} /> Open file
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={() => onReveal(task.outputPath as string)}
                title="Show in folder"
                aria-label="Show exported file in folder"
              >
                <FolderOpen size={13} strokeWidth={1.9} />
              </button>
            </>
          ) : null}
          {retryable ? (
            <button
              type="button"
              className="btn btn-quiet btn-xs"
              onClick={() => onRetry(task.id)}
              title="Run this download again"
            >
              <RotateCcw size={12} strokeWidth={2} /> Retry
            </button>
          ) : null}
          {active || task.status === "queued" ? (
            <button
              type="button"
              className="btn btn-quiet btn-xs"
              onClick={() => onCancel(task.id)}
              title="Cancel this download"
            >
              <X size={12} strokeWidth={2} /> Cancel
            </button>
          ) : (
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              onClick={() => onRemove(task.id)}
              title="Remove from the list"
              aria-label="Remove download"
            >
              <Trash2 size={13} strokeWidth={1.9} />
            </button>
          )}
        </div>
      </div>

      <div className="dl-meta-line">
        <span className="dl-range">
          {formatTimecode(task.startMs)} → {formatTimecode(task.endMs)}
        </span>
        <span className="dl-dot">·</span>
        <span>{qualityLabel(task.quality)}</span>
        <span className="dl-dot">·</span>
        <span>{task.format.toUpperCase()}</span>
        <span className="dl-dot">·</span>
        <span>{formatBytes(finalSize)}</span>
        {task.durationMs ? (
          <>
            <span className="dl-dot">·</span>
            <span>{formatDuration(task.durationMs)}</span>
          </>
        ) : null}
        {task.precise ? (
          <>
            <span className="dl-dot">·</span>
            <span>precise</span>
          </>
        ) : null}
      </div>

      {active || task.status === "queued" ? (
        <div className={`progress${knownProgress ? "" : " progress-indeterminate"}`}>
          <div
            className="progress-fill"
            style={knownProgress ? { width: `${percent}%` } : undefined}
          />
        </div>
      ) : null}

      {active ? (
        <div className="dl-stats">
          <span>{formatBytes(task.downloadedBytes)} downloaded</span>
          <span>{formatSpeed(task.speedBps)}</span>
          <span>ETA {formatEta(task.etaSecs)}</span>
          {knownProgress ? <span>{percent}%</span> : null}
        </div>
      ) : null}

      {finished ? (
        <div className="dl-stats dl-stats-done">
          <span>
            {task.hasVideo && task.hasAudio
              ? "video + audio verified"
              : task.hasVideo
                ? "video only"
                : task.hasAudio
                  ? "audio only"
                  : "file verified"}
          </span>
          <span className="dl-path" title={task.outputPath ?? ""}>
            {task.outputPath?.split(/[\\/]/).pop()}
          </span>
        </div>
      ) : null}

      {task.error ? (
        <div className="dl-error">
          <p>{task.error}</p>
          {task.errorDetail ? (
            <details>
              <summary>Technical details (yt-dlp output)</summary>
              <pre>{task.errorDetail}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export function DownloadManager({
  tasks,
  activeCount,
  onCancel,
  onRetry,
  onRemove,
  onOpenFile,
  onReveal,
  onOpenFolder,
  onClearFinished,
}: DownloadManagerProps) {
  const { activeTasks, withProgress, overall, completed, hasFinished } = useMemo(() => {
    const activeTasks = tasks.filter(
      (task) => task.status === "fetching" || task.status === "processing",
    );
    const withProgress = activeTasks.filter((task) => task.totalBytes && task.totalBytes > 0);
    const overall =
      withProgress.length > 0
        ? withProgress.reduce((sum, task) => sum + task.progress, 0) / withProgress.length
        : 0;
    return {
      activeTasks,
      withProgress,
      overall,
      completed: tasks.filter((task) => task.status === "completed").length,
      hasFinished: tasks.some(
        (task) => task.status === "completed" || task.status === "failed" || task.status === "cancelled",
      ),
    };
  }, [tasks]);

  return (
    <section className="downloads" aria-label="Download manager">
      <div className="section-head">
        <div className="section-head-left">
          <h3 className="section-title">Downloads</h3>
          <span className="section-count">
            {activeCount > 0
              ? `${activeCount} active`
              : tasks.length > 0
                ? `${completed}/${tasks.length} saved`
                : "Idle"}
          </span>
        </div>
        <div className="section-actions">
          {hasFinished ? (
            <button type="button" className="btn btn-quiet btn-xs" onClick={onClearFinished}>
              Clear finished
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet btn-xs" onClick={onOpenFolder}>
            <FolderOpen size={12} strokeWidth={2} /> Output folder
          </button>
        </div>
      </div>

      {activeTasks.length > 1 ? (
        <div className="overall">
          <div className="overall-head">
            <span>Overall progress</span>
            <span>{Math.round(overall * 100)}%</span>
          </div>
          <div className={`progress${withProgress.length > 0 ? "" : " progress-indeterminate"}`}>
            <div
              className="progress-fill"
              style={withProgress.length > 0 ? { width: `${Math.round(overall * 100)}%` } : undefined}
            />
          </div>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <div className="downloads-empty">
          Queued clips appear here with live progress, speed and remaining time.
        </div>
      ) : (
        <div className="dl-list">
          {tasks.map((task) => (
            <DownloadRow
              key={task.id}
              task={task}
              onCancel={onCancel}
              onRetry={onRetry}
              onRemove={onRemove}
              onOpenFile={onOpenFile}
              onReveal={onReveal}
            />
          ))}
        </div>
      )}
    </section>
  );
}
