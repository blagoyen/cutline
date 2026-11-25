import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "./hooks/useSettings";
import { useDownloads } from "./hooks/useDownloads";
import { useNotifications } from "./hooks/useNotifications";
import { useStableCallback } from "./hooks/useStableCallback";
import { useMediaPlayer, type LoopRange } from "./hooks/useMediaPlayer";
import { api, errorMessage } from "./services/api";
import type { Chapter, Clip, DownloadRequest, DownloadSection, Settings, VideoInfo } from "./types";
import { applyNamingTemplate, NAMING_TEMPLATES } from "./utils/format";
import { TopBar } from "./components/TopBar";
import { UrlBar } from "./components/UrlBar";
import { HeroPanel } from "./components/HeroPanel";
import { VideoStage } from "./components/VideoStage";
import { Timeline } from "./components/Timeline";
import { ClipToolbar } from "./components/ClipToolbar";
import { ClipList, type ClipEdge } from "./components/ClipList";
import { DownloadManager } from "./components/DownloadManager";
import { DependencyBanner } from "./components/DependencyBanner";
import { Toasts } from "./components/Toasts";
import { BrandMark } from "./components/BrandMark";

const SettingsPanel = lazy(() =>
  import("./components/SettingsPanel").then((module) => ({ default: module.SettingsPanel })),
);

const MIN_CLIP_MS = 100;
const DEFAULT_CLIP_MS = 10_000;
/** Shared empty list so memoised children keep a stable prop. */
const NO_CHAPTERS: Chapter[] = [];

const newId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export default function App() {
  const {
    settings,
    dependencies,
    version,
    loading: settingsLoading,
    error: settingsError,
    save: saveSettings,
    patch: patchSettings,
    refreshDependencies,
  } = useSettings();

  const {
    tasks: downloadTasks,
    active: activeDownloads,
    byClip,
    start: startDownload,
    startBatch,
    cancel: cancelDownload,
    retry: retryDownload,
    remove: removeDownload,
    clearFinished: clearFinishedDownloads,
  } = useDownloads();

  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [clips, setClips] = useState<Clip[]>([]);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [pendingIn, setPendingIn] = useState<number | null>(null);
  const [pendingOut, setPendingOut] = useState<number | null>(null);

  const [quality, setQuality] = useState("best");
  const [format, setFormat] = useState("mp4");
  const [precise, setPrecise] = useState(false);
  const [namingTemplate, setNamingTemplate] = useState<string>(NAMING_TEMPLATES[0]);
  const [mergeCuts, setMergeCuts] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const {
    items: toasts,
    notify: toast,
    dismiss: dismissToast,
    playSound,
  } = useNotifications(soundEnabled);

  const hostRef = useRef<HTMLDivElement>(null);
  const loopRef = useRef<LoopRange | null>(null);
  const player = useMediaPlayer(
    hostRef,
    video?.id ?? null,
    video?.source ?? "youtube",
    video?.streamUrl ?? null,
    loopRef,
  );
  const { seekMs, skipMs, play, toggle: togglePlayback } = player;

  const durationMs = player.durationMs || video?.durationMs || 0;
  const prefsInitialised = useRef(false);

  const totalDurationMs = useMemo(
    () => clips.reduce((sum, clip) => sum + Math.max(0, clip.endMs - clip.startMs), 0),
    [clips],
  );

  const activeRange = useMemo(() => {
    const clip = clips.find((entry) => entry.id === activeClipId);
    if (clip) return { startMs: clip.startMs, endMs: clip.endMs };
    if (pendingIn != null && pendingOut != null && pendingOut > pendingIn) {
      return { startMs: pendingIn, endMs: pendingOut };
    }
    return null;
  }, [clips, activeClipId, pendingIn, pendingOut]);

  useEffect(() => {
    loopRef.current =
      loopEnabled && activeRange
        ? { enabled: true, startMs: activeRange.startMs, endMs: activeRange.endMs }
        : null;
  }, [loopEnabled, activeRange]);

  useEffect(() => {
    if (!settings || prefsInitialised.current) return;
    prefsInitialised.current = true;
    setQuality(settings.defaultQuality);
    setFormat(settings.defaultFormat);
    setPrecise(settings.preciseCutting);
    setNamingTemplate(settings.namingTemplate || NAMING_TEMPLATES[0]);
    setMergeCuts(settings.mergeCuts);
    setSoundEnabled(settings.soundEffects);
  }, [settings]);

  const toggleSound = useStableCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (settings) {
      void patchSettings({ soundEffects: next }).catch((err) => toast(errorMessage(err), "error"));
    }
  });

  const seenCompleted = useRef(new Set<string>());
  useEffect(() => {
    downloadTasks.forEach((task) => {
      if (task.status === "completed" && !seenCompleted.current.has(task.id)) {
        seenCompleted.current.add(task.id);
        toast(`${task.clipName} is ready.`, "success");
      }
    });
  }, [downloadTasks, toast]);

  const handleLoadVideo = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed || loadingVideo) return;
    setLoadingVideo(true);
    setLoadError(null);
    try {
      const info = await api.probeVideo(trimmed);
      setVideo(info);
      const requested = Number.parseInt(quality, 10);
      if (Number.isFinite(requested) && !info.heights.includes(requested)) {
        setQuality("best");
      }
      setUrl(info.webpageUrl);
      setClips([]);
      setActiveClipId(null);
      setPendingIn(null);
      setPendingOut(null);
      setLoopEnabled(false);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoadingVideo(false);
    }
  }, [url, loadingVideo, quality]);

  // Handlers below that read frequently-changing state (clips, pending marks,
  // active clip) use useStableCallback: their identity never changes, so the
  // memoised children (VideoStage, ClipList rows, Timeline) are not re-rendered
  // every time a clip is dragged or a download reports progress.
  const markIn = useStableCallback(() => {
    if (!video) return;
    const now = Math.round(player.currentMsRef.current);
    setPendingIn(now);
    setPendingOut((previous) =>
      previous != null && previous - now >= MIN_CLIP_MS
        ? previous
        : Math.min(now + DEFAULT_CLIP_MS, durationMs),
    );
    playSound("tick");
  });

  const markOut = useStableCallback(() => {
    if (!video) return;
    const now = Math.round(player.currentMsRef.current);
    if (pendingIn == null) {
      const start = Math.max(0, now - DEFAULT_CLIP_MS);
      setPendingIn(start);
      setPendingOut(now);
      playSound("tick");
      return;
    }
    if (now - pendingIn < MIN_CLIP_MS) {
      toast("Mark the out point after the in point.", "error");
      return;
    }
    setPendingOut(now);
    playSound("tick");
  });

  const addCut = useStableCallback(() => {
    if (!video) return;
    const start = pendingIn ?? Math.round(player.currentMsRef.current);
    let end = pendingOut ?? Math.min(start + DEFAULT_CLIP_MS, durationMs);
    if (end - start < MIN_CLIP_MS) {
      end = Math.min(start + 1000, durationMs);
    }
    if (end - start < MIN_CLIP_MS) {
      toast("That range is too short to cut.", "error");
      return;
    }
    const clip: Clip = {
      id: newId(),
      name: `Clip ${String(clips.length + 1).padStart(2, "0")}`,
      startMs: start,
      endMs: end,
    };
    setClips((prev) => [...prev, clip]);
    setActiveClipId(clip.id);
    setPendingIn(null);
    setPendingOut(null);
  });

  const addManualCut = useStableCallback(() => {
    if (!video) return;
    const previous = clips[clips.length - 1];
    const start = previous ? Math.min(previous.endMs, Math.max(0, durationMs - 100)) : 0;
    const end = Math.min(start + DEFAULT_CLIP_MS, durationMs);
    if (end - start < MIN_CLIP_MS) {
      toast("There is no room left for another cut.", "error");
      return;
    }
    const clip: Clip = {
      id: newId(),
      name: `Clip ${String(clips.length + 1).padStart(2, "0")}`,
      startMs: start,
      endMs: end,
    };
    setClips((prev) => [...prev, clip]);
    setActiveClipId(clip.id);
  });

  const updateClip = useCallback((id: string, patch: Partial<Clip>) => {
    setClips((prev) => prev.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)));
  }, []);

  const changeClipRange = useCallback(
    (id: string, startMs: number, endMs: number) => updateClip(id, { startMs, endMs }),
    [updateClip],
  );

  const deleteClip = useStableCallback((id: string) => {
    setClips((prev) => prev.filter((clip) => clip.id !== id));
    if (activeClipId === id) {
      setActiveClipId(null);
      setLoopEnabled(false);
    }
  });

  const duplicateClip = useStableCallback((id: string) => {
    const clip = clips.find((entry) => entry.id === id);
    if (!clip) return;
    const length = clip.endMs - clip.startMs;
    const start = clamp(clip.endMs, 0, Math.max(0, durationMs - length));
    const end = Math.min(start + length, durationMs);
    if (end - start < MIN_CLIP_MS) {
      toast("There is no room left to duplicate this cut.", "error");
      return;
    }
    const copy: Clip = {
      id: newId(),
      name: `${clip.name.trim() || "Clip"} copy`,
      startMs: start,
      endMs: end,
    };
    setClips((prev) => [...prev, copy]);
    setActiveClipId(copy.id);
  });

  const moveClip = useCallback((id: string, direction: -1 | 1) => {
    setClips((prev) => {
      const index = prev.findIndex((clip) => clip.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }, []);

  const nudgeClip = useCallback(
    (id: string, edge: ClipEdge, deltaMs: number) => {
      setClips((prev) =>
        prev.map((clip) => {
          if (clip.id !== id) return clip;
          if (edge === "start") {
            return { ...clip, startMs: clamp(clip.startMs + deltaMs, 0, clip.endMs - MIN_CLIP_MS) };
          }
          return { ...clip, endMs: clamp(clip.endMs + deltaMs, clip.startMs + MIN_CLIP_MS, durationMs) };
        }),
      );
    },
    [durationMs],
  );

  const snapClip = useCallback(
    (id: string, edge: ClipEdge) => {
      const now = Math.round(player.currentMsRef.current);
      setClips((prev) =>
        prev.map((clip) => {
          if (clip.id !== id) return clip;
          if (edge === "start") {
            return { ...clip, startMs: clamp(now, 0, clip.endMs - MIN_CLIP_MS) };
          }
          return { ...clip, endMs: clamp(now, clip.startMs + MIN_CLIP_MS, durationMs) };
        }),
      );
    },
    [durationMs],
  );

  const seekToClip = useCallback(
    (clip: Clip) => {
      setActiveClipId(clip.id);
      seekMs(clip.startMs);
      play();
    },
    [seekMs, play],
  );

  const loopClip = useCallback(
    (clip: Clip) => {
      setActiveClipId(clip.id);
      setLoopEnabled(true);
      seekMs(clip.startMs);
      play();
    },
    [seekMs, play],
  );

  const toggleLoop = useCallback(() => {
    setLoopEnabled((previous) => !previous);
  }, []);

  /** Add a fixed-length cut. */
  const quickCut = useStableCallback((lengthMs: number) => {
    if (!video || durationMs <= 0) return;
    const start = clamp(pendingIn ?? Math.round(player.currentMsRef.current), 0, durationMs);
    const end = Math.min(start + lengthMs, durationMs);
    if (end - start < MIN_CLIP_MS) {
      toast("Move the playhead earlier — not enough room for that preset.", "error");
      return;
    }
    const clip: Clip = {
      id: newId(),
      name: `Clip ${String(clips.length + 1).padStart(2, "0")}`,
      startMs: start,
      endMs: end,
    };
    setClips((prev) => [...prev, clip]);
    setActiveClipId(clip.id);
    setPendingIn(null);
    setPendingOut(null);
    toast(`${Math.round(lengthMs / 1000)}s cut added.`, "success");
  });

  const jumpToChapter = useCallback(
    (chapter: Chapter) => {
      setActiveClipId(null);
      seekMs(chapter.startMs);
      play();
    },
    [seekMs, play],
  );

  const chapterToCut = useStableCallback((chapter: Chapter) => {
    const clip: Clip = {
      id: newId(),
      name: chapter.title.trim() || `Chapter ${String(clips.length + 1).padStart(2, "0")}`,
      startMs: chapter.startMs,
      endMs: chapter.endMs,
    };
    setClips((prev) => [...prev, clip]);
    setActiveClipId(clip.id);
    toast(`Chapter “${clip.name}” added as a cut.`, "success");
  });

  /** Trim cuts so they do not overlap or become zero-length. */
  const fixOverlaps = useStableCallback(() => {
    if (clips.length === 0) return;
    let cursor = 0;
    let fixed = 0;
    const next = clips.map((clip) => {
      let start = Math.max(clip.startMs, cursor);
      let end = Math.max(clip.endMs, start + MIN_CLIP_MS);
      if (durationMs > 0) {
        start = Math.min(start, Math.max(0, durationMs - MIN_CLIP_MS));
        end = Math.min(end, durationMs);
        if (end - start < MIN_CLIP_MS) {
          start = Math.max(0, end - MIN_CLIP_MS);
        }
      }
      if (start !== clip.startMs || end !== clip.endMs) fixed += 1;
      cursor = end;
      return { ...clip, startMs: Math.round(start), endMs: Math.round(end) };
    });
    setClips(next);
    toast(
      fixed > 0
        ? `Trimmed ${fixed} overlapping cut${fixed === 1 ? "" : "s"}.`
        : "All cuts are already clean.",
      fixed > 0 ? "success" : "info",
    );
  });

  const ensureToolsReady = useCallback(() => {
    if (dependencies?.ready) return true;
    toast("yt-dlp and FFmpeg are required. Set them up in Settings.", "error");
    setSettingsOpen(true);
    return false;
  }, [dependencies, toast]);

  const buildRequest = useCallback(
    (clip: Clip, index = 0): DownloadRequest => {
      if (!video) throw new Error("No video loaded.");
      const clipName = clip.name.trim() || `Clip ${String(index + 1).padStart(2, "0")}`;
      const sections: DownloadSection[] = [{ startMs: clip.startMs, endMs: clip.endMs }];
      return {
        clipId: clip.id,
        clipName,
        fileBase: applyNamingTemplate(namingTemplate, video.title, clipName, index, clip.startMs),
        url: video.webpageUrl,
        startMs: clip.startMs,
        endMs: clip.endMs,
        sections,
        quality,
        format,
        precise,
      };
    },
    [video, namingTemplate, quality, format, precise],
  );

  const buildMergedRequest = useCallback((): DownloadRequest => {
    if (!video || clips.length === 0) throw new Error("No cuts selected.");
    if (clips.length === 1) return buildRequest(clips[0], 0);
    const sections: DownloadSection[] = clips.map((clip) => ({
      startMs: clip.startMs,
      endMs: clip.endMs,
    }));
    const clipName = `Merged cuts (${clips.length})`;
    const base = applyNamingTemplate(namingTemplate, video.title, clipName, 0, clips[0].startMs);
    return {
      clipId: `merged-${newId()}`,
      clipName,
      fileBase: `${base} (merged)`,
      url: video.webpageUrl,
      startMs: sections[0].startMs,
      endMs: sections[sections.length - 1].endMs,
      sections,
      quality,
      format,
      precise,
    };
  }, [video, clips, namingTemplate, buildRequest, quality, format, precise]);

  const downloadClip = useStableCallback((clip: Clip) => {
    if (!video || !ensureToolsReady()) return;
    const index = clips.findIndex((entry) => entry.id === clip.id);
    void startDownload(buildRequest(clip, Math.max(0, index)))
      .then(() => toast(`Queued “${clip.name}”.`, "success"))
      .catch((err) => toast(errorMessage(err), "error"));
  });

  const downloadAll = useStableCallback(() => {
    if (!video || clips.length === 0 || !ensureToolsReady()) return;
    setExporting(true);
    const task = mergeCuts && clips.length > 1 ? startDownload(buildMergedRequest()) : startBatch(clips.map(buildRequest));
    void task
      .then((created) => {
        const count = Array.isArray(created) ? created.length : 1;
        toast(`Queued ${count} ${count === 1 ? "export" : "exports"}.`, "success");
      })
      .catch((err) => toast(errorMessage(err), "error"))
      .finally(() => setExporting(false));
  });

  const changeQuality = useCallback(
    (next: string) => {
      setQuality(next);
      void patchSettings({ defaultQuality: next }).catch(() => undefined);
    },
    [patchSettings],
  );

  const changeFormat = useCallback(
    (next: string) => {
      setFormat(next);
      void patchSettings({ defaultFormat: next }).catch(() => undefined);
    },
    [patchSettings],
  );

  const changePrecise = useCallback(
    (next: boolean) => {
      setPrecise(next);
      void patchSettings({ preciseCutting: next }).catch(() => undefined);
    },
    [patchSettings],
  );

  const changeNamingTemplate = useCallback(
    (next: string) => {
      setNamingTemplate(next);
      void patchSettings({ namingTemplate: next }).catch(() => undefined);
    },
    [patchSettings],
  );

  const changeMergeCuts = useCallback(
    (next: boolean) => {
      setMergeCuts(next);
      void patchSettings({ mergeCuts: next }).catch(() => undefined);
    },
    [patchSettings],
  );

  const handleSaveSettings = useCallback(
    async (next: Settings) => {
      const saved = await saveSettings(next);
      setQuality(saved.defaultQuality);
      setFormat(saved.defaultFormat);
      setPrecise(saved.preciseCutting);
      setNamingTemplate(saved.namingTemplate || NAMING_TEMPLATES[0]);
      setMergeCuts(saved.mergeCuts);
      await refreshDependencies();
      setSettingsOpen(false);
      toast("Settings saved.", "success");
    },
    [saveSettings, refreshDependencies, toast],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        settingsOpen ||
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const current = () => Math.round(player.currentMsRef.current);
      let handled = true;
      switch (key) {
        case " ":
          togglePlayback();
          break;
        case "i":
          markIn();
          break;
        case "o":
          markOut();
          break;
        case "c":
        case "enter":
          addCut();
          break;
        case "l":
          toggleLoop();
          break;
        case "arrowleft":
          seekMs(clamp(current() - (event.shiftKey ? 100 : 1000), 0, durationMs));
          break;
        case "arrowright":
          seekMs(clamp(current() + (event.shiftKey ? 100 : 1000), 0, durationMs));
          break;
        default:
          handled = false;
      }
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [settingsOpen, togglePlayback, markIn, markOut, addCut, toggleLoop, seekMs, durationMs]);

  const handleOpenFile = useCallback(
    (path: string) => {
      void api.openPath(path).catch((err) => toast(errorMessage(err), "error"));
    },
    [toast],
  );

  const handleReveal = useCallback(
    (path: string) => {
      void api.revealPath(path).catch((err) => toast(errorMessage(err), "error"));
    },
    [toast],
  );

  const handleOpenFolder = useCallback(() => {
    void api.openOutputFolder().catch((err) => toast(errorMessage(err), "error"));
  }, [toast]);

  const handleCancel = useCallback(
    (id: string) => {
      void cancelDownload(id).catch((err) => toast(errorMessage(err), "error"));
    },
    [cancelDownload, toast],
  );

  const handleRetry = useCallback(
    (id: string) => {
      void retryDownload(id)
        .then(() => toast("Download queued again.", "info"))
        .catch((err) => toast(errorMessage(err), "error"));
    },
    [retryDownload, toast],
  );

  const handleRemove = useCallback(
    (id: string) => {
      void removeDownload(id).catch((err) => toast(errorMessage(err), "error"));
    },
    [removeDownload, toast],
  );

  const handleClearFinished = useCallback(() => {
    void clearFinishedDownloads().catch((err) => toast(errorMessage(err), "error"));
  }, [clearFinishedDownloads, toast]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const handleUrlChange = useStableCallback((next: string) => {
    setUrl(next);
    if (loadError) setLoadError(null);
  });

  const handleUrlSubmit = useStableCallback(() => void handleLoadVideo());

  const handleOpenSource = useStableCallback(() => {
    void api.openUrl(video?.webpageUrl ?? "").catch((err) => toast(errorMessage(err), "error"));
  });

  if (!settings) {
    return (
      <div className="boot">
        <BrandMark size={32} />
        <span className="boot-text">
          {settingsError ?? (settingsLoading ? "Preparing Cutline…" : "Settings unavailable")}
        </span>
      </div>
    );
  }

  const activeCount = activeDownloads.length;

  return (
    <div className={`app-shell${video ? " has-video" : " is-landing"}`} data-source={video?.source ?? "none"}>
      <TopBar
        dependencies={dependencies}
        onOpenSettings={openSettings}
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
      />

      <main className="workspace">
        {!video ? (
          <HeroPanel
            clipCount={clips.length}
            totalDurationMs={totalDurationMs}
            quality={quality}
            format={format}
            activeSource={null}
          />
        ) : null}

        <UrlBar
          value={url}
          loading={loadingVideo}
          error={loadError}
          onChange={handleUrlChange}
          onSubmit={handleUrlSubmit}
        />

        {dependencies && !dependencies.ready ? (
          <DependencyBanner
            dependencies={dependencies}
            onOpenSettings={openSettings}
          />
        ) : null}

        {video ? (
          <div className="studio">
            <HeroPanel
              clipCount={clips.length}
              totalDurationMs={totalDurationMs}
              quality={quality}
              format={format}
              activeSource={video.source}
              compact
            />

            <VideoStage
              video={video}
              hostRef={hostRef}
              player={player}
              clips={clips}
              pendingIn={pendingIn}
              pendingOut={pendingOut}
              activeRange={activeRange}
              canAddCut={Boolean(video)}
              loopEnabled={loopEnabled}
              canLoop={Boolean(activeRange && player.ready)}
              onOpenSource={handleOpenSource}
              onMarkIn={markIn}
              onMarkOut={markOut}
              onAddCut={addCut}
              onToggleLoop={toggleLoop}
              onSeek={seekMs}
              onSkip={skipMs}
              onQuickCut={quickCut}
              chapters={video.chapters ?? NO_CHAPTERS}
              onJumpChapter={jumpToChapter}
              onChapterToCut={chapterToCut}
            />

            <Timeline
              durationMs={durationMs}
              currentMsRef={player.currentMsRef}
              clips={clips}
              activeClipId={activeClipId}
              pendingIn={pendingIn}
              pendingOut={pendingOut}
              onSeek={seekMs}
              onChangeClip={changeClipRange}
              onSelectClip={setActiveClipId}
            />

            <ClipToolbar
              video={video}
              quality={quality}
              format={format}
              precise={precise}
              namingTemplate={namingTemplate}
              mergeCuts={mergeCuts}
              clipCount={clips.length}
              busy={exporting}
              onQuality={changeQuality}
              onFormat={changeFormat}
              onPrecise={changePrecise}
              onNamingTemplate={changeNamingTemplate}
              onMergeCuts={changeMergeCuts}
              onExport={downloadAll}
            />

            <ClipList
              clips={clips}
              durationMs={durationMs}
              activeClipId={activeClipId}
              tasksByClip={byClip}
              busy={exporting}
              onSelect={setActiveClipId}
              onChange={updateClip}
              onDelete={deleteClip}
              onDuplicate={duplicateClip}
              onPreview={seekToClip}
              onLoop={loopClip}
              onDownload={downloadClip}
              onMove={moveClip}
              onNudge={nudgeClip}
              onSnap={snapClip}
              onAdd={addManualCut}
              onFixOverlaps={fixOverlaps}
            />
          </div>
        ) : null}

        {downloadTasks.length > 0 ? (
          <div className="studio-downloads">
            <DownloadManager
              tasks={downloadTasks}
              activeCount={activeCount}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onRemove={handleRemove}
              onOpenFile={handleOpenFile}
              onReveal={handleReveal}
              onOpenFolder={handleOpenFolder}
              onClearFinished={handleClearFinished}
            />
          </div>
        ) : null}

        <footer className="app-footer">
          <span className="footer-item">Cutline{version ? ` v${version}` : ""}</span>
          <span className="footer-sep" aria-hidden="true" />
          <span className="footer-item">YouTube &amp; Twitch · 100% local</span>
          <span className="footer-item footer-path" title={settings.outputDir}>
            {settings.outputDir}
          </span>
        </footer>
      </main>

      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsPanel
            open={settingsOpen}
            settings={settings}
            dependencies={dependencies}
            version={version}
            onClose={closeSettings}
            onSave={handleSaveSettings}
            onRefreshDependencies={refreshDependencies}
            onToast={toast}
            testVideoUrl={video?.webpageUrl ?? null}
          />
        </Suspense>
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
