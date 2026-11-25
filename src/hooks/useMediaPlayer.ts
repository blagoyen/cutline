import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { VideoSource } from "../types";

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

interface TwitchPlayerInstance {
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  setMuted: (muted: boolean) => void;
  getMuted: () => boolean;
  addEventListener: (event: string, listener: () => void) => void;
  destroy?: () => void;
}

interface TwitchApi {
  Player: {
    new (element: HTMLElement | string, options: Record<string, unknown>): TwitchPlayerInstance;
    READY: string;
    PLAY: string;
    PLAYING: string;
    PAUSE: string;
    ENDED: string;
    OFFLINE: string;
  };
}

declare global {
  interface Window {
    YT?: YtApi;
    onYouTubeIframeAPIReady?: () => void;
    Twitch?: TwitchApi;
  }
}

interface PlayerAdapter {
  play: () => void;
  pause: () => void;
  seekSeconds: (seconds: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getLoadedFraction: () => number;
  isMuted: () => boolean;
  setMuted: (muted: boolean) => void;
  setVolume: (volumePercent: number) => void;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
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
  supportsPlaybackRate: boolean;
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
  supportsPlaybackRate: true,
};

let ytApiPromise: Promise<YtApi> | null = null;
let twitchApiPromise: Promise<TwitchApi> | null = null;

function loadYouTubeApi(): Promise<YtApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<YtApi>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      ytApiPromise = null;
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
      ytApiPromise = null;
      reject(new Error("The YouTube player script could not be loaded. Check your connection."));
    };
    document.head.appendChild(script);
  });

  return ytApiPromise;
}

function loadTwitchApi(): Promise<TwitchApi> {
  if (window.Twitch?.Player) return Promise.resolve(window.Twitch);
  if (twitchApiPromise) return twitchApiPromise;

  twitchApiPromise = new Promise<TwitchApi>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      twitchApiPromise = null;
      reject(new Error("The Twitch player took too long to load."));
    }, 15000);

    const script = document.createElement("script");
    script.src = "https://player.twitch.tv/js/embed/v1.js";
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.Twitch?.Player) resolve(window.Twitch);
      else {
        twitchApiPromise = null;
        reject(new Error("The Twitch player could not be initialised."));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      twitchApiPromise = null;
      reject(new Error("The Twitch player script could not be loaded. Check your connection."));
    };
    document.head.appendChild(script);
  });

  return twitchApiPromise;
}

const YT_ERROR_TEXT: Record<number, string> = {
  2: "This video link is invalid.",
  5: "The YouTube player could not start in this app.",
  100: "This video was removed or is private.",
  101: "The uploader does not allow this video to be embedded.",
  150: "The uploader does not allow this video to be embedded.",
};

export function useMediaPlayer(
  hostRef: RefObject<HTMLDivElement | null>,
  videoId: string | null,
  source: VideoSource,
  loopRef: RefObject<LoopRange | null>,
) {
  const [state, setState] = useState<PlayerState>(INITIAL);
  const adapterRef = useRef<PlayerAdapter | null>(null);
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
    let created: PlayerAdapter | null = null;
    let readyTimer: number | undefined;

    setState({
      ...INITIAL,
      volume: volumeRef.current,
      playbackRate: source === "youtube" ? rateRef.current : 1,
      supportsPlaybackRate: source === "youtube",
    });
    currentMsRef.current = 0;
    loadedFractionRef.current = 0;

    const createYouTube = async () => {
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
                YT_ERROR_TEXT[event.data] ??
                "This video cannot be played in the embedded player.",
            });
          },
        },
      });

      const adapter: PlayerAdapter = {
        play: () => player.playVideo(),
        pause: () => player.pauseVideo(),
        seekSeconds: (seconds) => player.seekTo(seconds, true),
        getCurrentTime: () => player.getCurrentTime(),
        getDuration: () => player.getDuration(),
        getLoadedFraction: () => player.getVideoLoadedFraction(),
        isMuted: () => player.isMuted(),
        setMuted: (muted) => (muted ? player.mute() : player.unMute()),
        setVolume: (vol) => player.setVolume(vol),
        setPlaybackRate: (rate) => player.setPlaybackRate(rate),
        destroy: () => player.destroy(),
      };
      created = adapter;
      adapterRef.current = adapter;
    };

    const createTwitch = async () => {
      // Twitch Clips use non-numeric slugs and do not expose the VOD JS playback API.
      if (!/^\d+$/.test(videoId)) {
        applyState({
          ready: false,
          error:
            "Embedded preview is only available for Twitch VODs. Use the timeline below to mark cuts and export this clip.",
        });
        return;
      }

      const api = await loadTwitchApi();
      if (disposed || !hostRef.current) return;

      hostRef.current.innerHTML = "";
      const host = document.createElement("div");
      host.className = "player-host";
      hostRef.current.appendChild(host);

      readyTimer = window.setTimeout(() => {
        if (!disposed && !stateRef.current.ready) {
          applyState({
            error:
              "Twitch did not allow embedded preview in this window — you can still scrub the timeline, mark cuts, and export VOD clips.",
          });
        }
      }, 10000);

      const parentHost = window.location.hostname || "localhost";
      const parents = Array.from(new Set([parentHost, "localhost", "127.0.0.1"]));
      const player = new api.Player(host, {
        video: videoId,
        parent: parents,
        controls: false,
        autoplay: false,
        muted: false,
        width: "100%",
        height: "100%",
      });

      player.addEventListener(api.Player.READY, () => {
        if (disposed) return;
        window.clearTimeout(readyTimer);
        let duration = 0;
        try {
          duration = player.getDuration();
          player.setVolume(volumeRef.current / 100);
        } catch {
          /* ignore */
        }
        applyState({
          ready: true,
          error: null,
          durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : 0,
        });
      });

      player.addEventListener(api.Player.PLAY, () => {
        if (!disposed) applyState({ playing: true, buffering: false, ready: true });
      });
      player.addEventListener(api.Player.PLAYING, () => {
        if (!disposed) applyState({ playing: true, buffering: false, ready: true });
      });
      player.addEventListener(api.Player.PAUSE, () => {
        if (!disposed) applyState({ playing: false, buffering: false });
      });
      player.addEventListener(api.Player.ENDED, () => {
        if (!disposed) applyState({ playing: false, buffering: false });
      });

      const adapter: PlayerAdapter = {
        play: () => player.play(),
        pause: () => player.pause(),
        seekSeconds: (seconds) => player.seek(seconds),
        getCurrentTime: () => player.getCurrentTime(),
        getDuration: () => player.getDuration(),
        getLoadedFraction: () => 0,
        isMuted: () => player.getMuted(),
        setMuted: (muted) => player.setMuted(muted),
        setVolume: (vol) => player.setVolume(vol / 100),
        setPlaybackRate: () => undefined,
        destroy: () => {
          player.destroy?.();
          if (hostRef.current) hostRef.current.innerHTML = "";
        },
      };
      created = adapter;
      adapterRef.current = adapter;
    };

    const boot = async () => {
      try {
        if (source === "twitch") await createTwitch();
        else await createYouTube();
      } catch (err) {
        if (!disposed) {
          applyState({
            ready: false,
            error:
              err instanceof Error
                ? err.message
                : "The preview could not be loaded. You can still export clips.",
          });
        }
      }
    };

    void boot();

    return () => {
      disposed = true;
      window.clearTimeout(readyTimer);
      try {
        created?.destroy();
      } catch {
        /* The iframe may already be gone. */
      }
      if (adapterRef.current === created) adapterRef.current = null;
    };
  }, [videoId, source, hostRef, applyState]);

  /* Keep the playhead in a ref so playback does not re-render React. */
  useEffect(() => {
    if (!videoId) return;
    let frame = 0;
    const tick = () => {
      const player = adapterRef.current;
      if (player) {
        try {
          const current = player.getCurrentTime();
          const duration = player.getDuration();
          let ms = Number.isFinite(current) ? Math.max(0, Math.round(current * 1000)) : 0;
          try {
            const buffered = player.getLoadedFraction();
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
            player.seekSeconds(loop.startMs / 1000);
            ms = loop.startMs;
          }
          currentMsRef.current = ms;

          const nextDuration = Number.isFinite(duration) ? Math.round(duration * 1000) : 0;
          if (nextDuration > 0 && Math.abs(nextDuration - stateRef.current.durationMs) > 40) {
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
  }, [videoId, source, loopRef, applyState]);

  const play = useCallback(() => {
    try {
      adapterRef.current?.play();
    } catch {
      /* noop */
    }
  }, []);

  const pause = useCallback(() => {
    try {
      adapterRef.current?.pause();
    } catch {
      /* noop */
    }
  }, []);

  const toggle = useCallback(() => {
    try {
      if (stateRef.current.playing) adapterRef.current?.pause();
      else adapterRef.current?.play();
    } catch {
      /* noop */
    }
  }, []);

  const seekMs = useCallback((ms: number) => {
    const safe = Math.max(0, Math.round(ms));
    try {
      adapterRef.current?.seekSeconds(safe / 1000);
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
        const duration = adapterRef.current?.getDuration();
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
    const player = adapterRef.current;
    if (!player) return;
    try {
      const nextMuted = !player.isMuted();
      player.setMuted(nextMuted);
      applyState({ muted: nextMuted });
    } catch {
      /* noop */
    }
  }, [applyState]);

  const setVolume = useCallback(
    (value: number) => {
      const safe = Math.min(100, Math.max(0, Math.round(value)));
      volumeRef.current = safe;
      try {
        adapterRef.current?.setVolume(safe);
      } catch {
        /* noop */
      }
      applyState({ volume: safe, muted: safe === 0 });
    },
    [applyState],
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      if (!stateRef.current.supportsPlaybackRate) return;
      const safe = PLAYBACK_RATES.includes(rate as (typeof PLAYBACK_RATES)[number]) ? rate : 1;
      rateRef.current = safe;
      try {
        adapterRef.current?.setPlaybackRate(safe);
      } catch {
        /* noop */
      }
      applyState({ playbackRate: safe });
    },
    [applyState],
  );

  return useMemo(
    () => ({
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
    }),
    [state, play, pause, toggle, seekMs, skipMs, toggleMute, setVolume, setPlaybackRate],
  );
}
