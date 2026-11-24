import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotice, ToastTone } from "../types";
import { useSoundEffects, type SoundCue } from "./useSoundEffects";

export const noticeLifetime = (tone: ToastTone) => (tone === "error" ? 10_000 : 7_000);

interface NotifyOptions {
  /** Suppress the cue for a message that already has its own sound. */
  silent?: boolean;
  /** Override the automatic lifetime in milliseconds. */
  lifetime?: number;
}

/**
 * One global message bus. Every caller publishes through `notify`; the topbar
 * center and the toast stack are just two views of the same queue.
 */
export function useNotifications(soundEnabled: boolean) {
  const [items, setItems] = useState<AppNotice[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef(new Map<number, number>());
  const dismissRef = useRef<(id: number) => void>(() => undefined);
  const playSound = useSoundEffects(soundEnabled);

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setItems((previous) => previous.filter((notice) => notice.id !== id));
  }, []);

  dismissRef.current = dismiss;

  const notify = useCallback(
    (message: string, tone: ToastTone = "info", options: NotifyOptions = {}) => {
      const id = ++counterRef.current;
      setItems((previous) => [
        ...previous.slice(-5),
        { id, message, tone, createdAt: Date.now() },
      ]);
      const lifetime = options.lifetime ?? noticeLifetime(tone);
      const timer = window.setTimeout(() => dismissRef.current(id), lifetime);
      timersRef.current.set(id, timer);
      if (!options.silent) playSound(tone === "info" ? "info" : (tone as SoundCue));
      return id;
    },
    [playSound],
  );

  const clear = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    setItems([]);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { items, notify, dismiss, clear, playSound };
}
