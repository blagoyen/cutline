import { useCallback, useEffect, useRef } from "react";

export type SoundCue = "info" | "success" | "error" | "tick";

type Note = {
  freq: number;
  at: number;
  duration: number;
  type: OscillatorType;
  gain: number;
};

/** Web Audio cues generated in code. */
const CUES: Record<SoundCue, Note[]> = {
  info: [
    { freq: 620, at: 0, duration: 0.08, type: "sine", gain: 0.04 },
    { freq: 830, at: 0.07, duration: 0.1, type: "sine", gain: 0.03 },
  ],
  success: [
    { freq: 523.25, at: 0, duration: 0.09, type: "triangle", gain: 0.045 },
    { freq: 659.25, at: 0.075, duration: 0.1, type: "triangle", gain: 0.045 },
    { freq: 783.99, at: 0.15, duration: 0.14, type: "triangle", gain: 0.04 },
  ],
  error: [
    { freq: 220, at: 0, duration: 0.14, type: "sawtooth", gain: 0.028 },
    { freq: 174.61, at: 0.1, duration: 0.18, type: "sawtooth", gain: 0.024 },
  ],
  tick: [{ freq: 880, at: 0, duration: 0.045, type: "square", gain: 0.018 }],
};

/** Create the AudioContext on first use and close it on unmount. */
export function useSoundEffects(enabled: boolean) {
  const contextRef = useRef<AudioContext | null>(null);
  const lastPlayRef = useRef(0);

  useEffect(() => {
    return () => {
      const context = contextRef.current;
      contextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };
  }, []);

  return useCallback(
    (cue: SoundCue) => {
      if (!enabled || typeof window === "undefined") return;
      const now = performance.now();
      if (now - lastPlayRef.current < 110) return;
      lastPlayRef.current = now;

      const Ctor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;

      let context = contextRef.current;
      if (!context || context.state === "closed") {
        context = new Ctor();
        contextRef.current = context;
      }
      if (context.state === "suspended") void context.resume().catch(() => undefined);

      const origin = context.currentTime + 0.005;
      for (const note of CUES[cue]) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const start = origin + note.at;
        const end = start + note.duration;

        oscillator.type = note.type;
        oscillator.frequency.setValueAtTime(note.freq, start);
        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(note.gain, start + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end);

        oscillator.connect(envelope);
        envelope.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end + 0.01);
        oscillator.onended = () => {
          oscillator.disconnect();
          envelope.disconnect();
        };
      }
    },
    [enabled],
  );
}
