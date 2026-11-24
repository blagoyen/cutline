import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

interface YtPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVideoLoadedFraction: () => number;
  destroy: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
}

interface YtApi {
  Player: new (element: HTMLElement | string, options: Record<string, unknown>) => YtPlayer;
}

declare global {
  interface Window {
    YT?: YtApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface PlayerState {
  ready: boolean;
  playing: boolean;
  buffering: boolean;
  durationMs: number;
  error: string | null;
  muted: boolean;
  volume: number;
  playbackRate: number;
}

export interface LoopRange {
  enabled: boolean;
  startMs: number;
  endMs: number;
}

export const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const;

const INITIAL: PlayerState = {
  ready: false,
  playing: false,
  buffering: false,
  durationMs: 0,
  error: null,
  muted: false,
  volume: 100,
  playbackRate: 1,
};

let apiPromise: Promise<YtApi> | null = null;

function loadYouTubeApi(): Promise<YtApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YtApi>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      apiPromise = null;
      reject(new Error("The YouTube player took too long to load."));
    }, 15000);

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("The YouTube player could not be initialised."));
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timer);
      apiPromise = null;
      reject(new Error("The YouTube player script could not be loaded. Check your connection."));
    };
    document.head.appendChild(script);
  });

  return apiPromise;
}

const ERROR_TEXT: Record<number, string> = {
  2: "This video link is invalid.",
  5: "The YouTube player could not start in this app.",
  100: "This video was removed or is private.",
  101: "The uploader does not allow this video to be embedded.",
  150: "The uploader does not allow this video to be embedded.",
};

export function useYouTubePlayer(
  hostRef: RefObject<HTMLDivElement | null>,
  videoId: string | null,
  loopRef: RefObject<LoopRange | null>,
) {
  const [state, setState] = useState<PlayerState>(INITIAL);
  const playerRef = useRef<YtPlayer | null>(null);
  const stateRef = useRef<PlayerState>(INITIAL);
  const currentMsRef = useRef(0);
  const loadedFractionRef = useRef(0);
  const volumeRef = useRef(INITIAL.volume);
  const rateRef = useRef(INITIAL.playbackRate);
  const lastLoopRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyState = useCallback((partial: Partial<PlayerState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    if (!videoId) {
      setState(INITIAL);
      currentMsRef.current = 0;
      loadedFractionRef.current = 0;
      return;
    }

    let disposed = false;
    let created: YtPlayer | null = null;
    let readyTimer: number | undefined;

    const create = async () => {
      try {
        const api = await loadYouTubeApi();
        if (disposed || !hostRef.current) return;

        hostRef.current.innerHTML = "";
        const host = document.createElement("div");
        host.className = "player-host";
        hostRef.current.appendChild(host);

        readyTimer = window.setTimeout(() => {
          if (!disposed && !stateRef.current.ready) {
            applyState({
              error:
                "The embedded player did not start. This video may not allow embedding — you can still download clips.",
            });
          }
        }, 12000);

        const player = new api.Player(host, {
          videoId,
          playerVars: {
            autoplay: 0,
            // Hide YouTube controls; the app draws its own.
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            iv_load_policy: 3,
            fs: 0,
          },
          events: {
            onReady: () => {
              if (disposed) return;
              window.clearTimeout(readyTimer);
              let duration = 0;
              try {
                duration = player.getDuration();
              } catch {
                duration = 0;
              }
              try {
                player.setVolume(volumeRef.current);
                player.setPlaybackRate(rateRef.current);
              } catch {
                /* Some players lack these methods. */
              }
              applyState({
                ready: true,
                error: null,
                durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : 0,
              });
            },
            onStateChange: (event: { data: number }) => {
              if (disposed) return;
              applyState({
                playing: event.data === 1,
                buffering: event.data === 3,
                ready: true,
              });
            },
            onError: (event: { data: number }) => {
              if (disposed) return;
              applyState({
                ready: false,
                error:
                  ERROR_TEXT[event.data] ??
                  "This video cannot be played in the embedded player.",
              });
            },
          },
        });

        created = player;
        playerRef.current = player;
      } catch (err) {
        if (!disposed) {
          applyState({
            ready: false,
            error:
              err instanceof Error
                ? err.message
                : "The preview could not be loaded. You can still download clips.",
          });
        }
      }
    };

    void create();

    return () => {
      disposed = true;
      window.clearTimeout(readyTimer);
      try {
        created?.destroy();
      } catch {
        /* The iframe may already be gone. */
      }
      if (playerRef.current === created) playerRef.current = null;
    };
  }, [videoId, hostRef, applyState]);

  /* Keep the playhead in a ref so playback does not re-render React. */
  useEffect(() => {
    if (!videoId) return;
    let frame = 0;
    const tick = () => {
      const player = playerRef.current;
      if (player) {
        try {
          const current = player.getCurrentTime();
          const duration = player.getDuration();
          let ms = Number.isFinite(current) ? Math.max(0, Math.round(current * 1000)) : 0;
          try {
            const buffered = player.getVideoLoadedFraction();
            if (Number.isFinite(buffered)) {
              loadedFractionRef.current = Math.min(1, Math.max(0, buffered));
            }
          } catch {
            /* Buffering info may be missing. */
          }

          const loop = loopRef.current;
          if (
            loop?.enabled &&
            loop.endMs > loop.startMs &&
            ms >= loop.endMs &&
            performance.now() - lastLoopRef.current > 350
          ) {
            lastLoopRef.current = performance.now();
            player.seekTo(loop.startMs / 1000, true);
            ms = loop.startMs;
          }
          currentMsRef.current = ms;

          const nextDuration = Number.isFinite(duration) ? Math.round(duration * 1000) : 0;
          if (Math.abs(nextDuration - stateRef.current.durationMs) > 40) {
            applyState({ durationMs: nextDuration });
          }
        } catch {
          /* Player not ready yet. */
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [videoId, loopRef, applyState]);

  const play = useCallback(() => {
    try {
      playerRef.current?.playVideo();
    } catch {
      /* noop */
    }
  }, []);

  const pause = useCallback(() => {
    try {
      playerRef.current?.pauseVideo();
    } catch {
      /* noop */
    }
  }, []);

  const toggle = useCallback(() => {
    try {
      if (stateRef.current.playing) playerRef.current?.pauseVideo();
      else playerRef.current?.playVideo();
    } catch {
      /* noop */
    }
  }, []);

  const seekMs = useCallback((ms: number) => {
    const safe = Math.max(0, Math.round(ms));
    try {
      playerRef.current?.seekTo(safe / 1000, true);
    } catch {
      /* noop */
    }
    currentMsRef.current = safe;
  }, []);

  /** Skip relative to the playhead, clamped to the video duration. */
  const skipMs = useCallback(
    (deltaMs: number) => {
      let limit = stateRef.current.durationMs;
      try {
        const duration = playerRef.current?.getDuration();
        if (Number.isFinite(duration) && duration && duration * 1000 > limit) {
          limit = Math.round(duration * 1000);
        }
      } catch {
        /* Player not ready; use the reported duration. */
      }
      const next = currentMsRef.current + deltaMs;
      seekMs(limit > 0 ? Math.min(limit, Math.max(0, next)) : Math.max(0, next));
    },
    [seekMs],
  );

  const toggleMute = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (player.isMuted()) {
        player.unMute();
        applyState({ muted: false });
      } else {
        player.mute();
        applyState({ muted: true });
      }
    } catch {
      /* noop */
    }
  }, [applyState]);

  const setVolume = useCallback(
    (value: number) => {
      const safe = Math.min(100, Math.max(0, Math.round(value)));
      volumeRef.current = safe;
      try {
        playerRef.current?.setVolume(safe);
      } catch {
        /* noop */
      }
      applyState({ volume: safe, muted: safe === 0 });
    },
    [applyState],
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const safe = PLAYBACK_RATES.includes(rate as (typeof PLAYBACK_RATES)[number]) ? rate : 1;
      rateRef.current = safe;
      try {
        playerRef.current?.setPlaybackRate(safe);
      } catch {
        /* noop */
      }
      applyState({ playbackRate: safe });
    },
    [applyState],
  );

  return {
    ...state,
    currentMsRef,
    loadedFractionRef,
    play,
    pause,
    toggle,
    seekMs,
    skipMs,
    toggleMute,
    setVolume,
    setPlaybackRate,
  };
}
