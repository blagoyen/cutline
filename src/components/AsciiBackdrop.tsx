import { memo, useEffect, useRef } from "react";

interface AsciiBackdropProps {
  /**
   * "ambient": full-viewport animated Moonlit Sea background (higher opacity on landing,
   *            lower opacity while clipping via CSS).
   * "band":    framed showcase panorama on the landing screen.
   */
  variant?: "ambient" | "band";
}

/*
 * Moonlit Sea animated ASCII art — adapted from ascii-magic-art (MIT License)
 * https://www.ascii-magic.com/ascii/moonlit-sea
 */
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

function rng(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise2(x * f, y * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return v / norm;
}

function gradient(stops: string[], n: number): string[] {
  const rgb = stops.map((h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (rgb.length - 1);
    const j = Math.min(rgb.length - 2, Math.floor(t));
    const f = t - j;
    const c = rgb[j].map((v, k) => Math.round(lerp(v, rgb[j + 1][k], f)));
    out.push("#" + c.map((v) => v.toString(16).padStart(2, "0")).join(""));
  }
  return out;
}

const SKY = gradient(["#0e1838", "#24396e", "#4a6aa8", "#8aa6d6"], 10);
const SEA = gradient(["#071226", "#123063", "#2c5a9a", "#6b93cc"], 10);
const MOON = gradient(["#f7e7a8", "#fff8e0"], 4);
const STAR_COLOR = "#dfe8ff";
const PALETTE = [...SKY, ...SEA, ...MOON, STAR_COLOR];
const SHADE = " ░▒▓█";

const TARGET_FPS = 20;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;

export const AsciiBackdrop = memo(function AsciiBackdrop({
  variant = "ambient",
}: AsciiBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const cols = variant === "band" ? 116 : 96;
    const rows = variant === "band" ? 22 : 36;
    const horizon = Math.floor(rows * 0.56);
    const mx = cols * (variant === "band" ? 0.68 : 0.72);
    const my = rows * 0.26;
    const mr = variant === "band" ? 4.8 : 6.5;

    const r = rng(7);
    const stars: Array<[number, number, number]> = Array.from({ length: 55 }, () => [
      Math.floor(r() * cols),
      Math.floor(r() * Math.max(1, horizon - 4)),
      r() * 6.28,
    ]);

    let cellW = 10;
    let cellH = 18;
    let width = 0;
    let height = 0;

    const resize = () => {
      const parent = variant === "band" ? canvas.parentElement : null;
      const cssW = parent ? parent.clientWidth : window.innerWidth;
      const cssH = parent ? parent.clientHeight : window.innerHeight;
      if (cssW <= 0 || cssH <= 0) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = cssW;
      height = cssH;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      cellW = cssW / cols;
      cellH = cssH / rows;
      const fontSize = Math.max(8, Math.min(cellH * 0.96, cellW * 1.75));
      ctx.font = `${fontSize.toFixed(1)}px "Cascadia Mono", "SFMono-Regular", Consolas, monospace`;
      ctx.textBaseline = "top";
    };

    resize();
    const observer =
      variant === "band" && canvas.parentElement
        ? new ResizeObserver(resize)
        : null;
    if (observer && canvas.parentElement) observer.observe(canvas.parentElement);
    window.addEventListener("resize", resize);

    const chars = new Array<string>(cols * rows);
    const colors = new Uint8Array(cols * rows);

    const drawFrame = (t: number) => {
      if (width <= 0 || height <= 0) return;

      // Sky: gradient lit around the moon with slow cloud bands
      for (let y = 0; y < horizon; y++) {
        const yOff = y * cols;
        for (let x = 0; x < cols; x++) {
          const dm = Math.hypot((x - mx) / 2, y - my);
          const glow = Math.exp(-dm / 9);
          const cloud = fbm(x * 0.035 + t * 0.04, y * 0.16, 4);
          const v = clamp(0.25 + (y / horizon) * 0.35 + glow * 0.5 + (cloud - 0.5) * 0.6);
          chars[yOff + x] = SHADE[1 + Math.min(3, Math.floor(v * 4))];
          colors[yOff + x] = Math.min(9, Math.floor(v * 10));
        }
      }

      // Twinkling stars
      for (let i = 0; i < stars.length; i++) {
        const [sx, sy, ph] = stars[i];
        const tw = Math.sin(t * 1.6 + ph);
        if (tw > 0) {
          chars[sy * cols + sx] = tw > 0.75 ? "*" : "·";
          colors[sy * cols + sx] = 24;
        }
      }

      // Full moon with soft limb and craters
      for (let y = 0; y < horizon; y++) {
        const yOff = y * cols;
        for (let x = 0; x < cols; x++) {
          const d = Math.hypot((x - mx) / mr, (y - my) / (mr * 0.5));
          if (d < 1) {
            const crater = fbm(x * 0.4, y * 0.8, 2) > 0.62;
            chars[yOff + x] = crater ? "▓" : "█";
            colors[yOff + x] = 20 + Math.min(3, Math.max(0, Math.floor((1 - d) * 4 + (crater ? -1 : 0))));
          }
        }
      }

      // Moving sea swell with broken moonlit reflection path
      for (let y = horizon; y < rows; y++) {
        const yOff = y * cols;
        const depth = (y - horizon) / Math.max(1, rows - horizon);
        for (let x = 0; x < cols; x++) {
          const w = fbm(x * 0.07 - t * 0.3, y * 0.6 + t * 0.1, 3);
          const beam = Math.exp(-(((x - mx) / (4 + depth * 12)) ** 2));
          const glint =
            beam *
            (0.55 + 0.45 * Math.sin(t * 2.6 + x * 0.6 + y * 1.3)) *
            (w > 0.45 ? 1 : 0.4);
          if (glint > 0.5) {
            chars[yOff + x] = glint > 0.78 ? "█" : "▓";
            colors[yOff + x] = 20 + (glint > 0.78 ? 3 : 1);
          } else {
            const v = clamp(0.55 - depth * 0.35 + (w - 0.5) * 0.9);
            chars[yOff + x] = SHADE[1 + Math.min(3, Math.floor(v * 4))];
            colors[yOff + x] = 10 + Math.min(9, Math.floor(v * 10));
          }
        }
      }

      ctx.clearRect(0, 0, width, height);
      let lastColor = -1;
      for (let y = 0; y < rows; y++) {
        const py = y * cellH;
        const yOff = y * cols;
        for (let x = 0; x < cols; x++) {
          const ch = chars[yOff + x];
          if (ch === " ") continue;
          const ci = colors[yOff + x];
          if (ci !== lastColor) {
            ctx.fillStyle = PALETTE[ci];
            lastColor = ci;
          }
          ctx.fillText(ch, x * cellW, py);
        }
      }
    };

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    drawFrame(0);
    if (reducedMotion) {
      return () => {
        observer?.disconnect();
        window.removeEventListener("resize", resize);
      };
    }

    let raf = 0;
    let lastDraw = start;
    const loop = (now: number) => {
      if (!document.hidden && now - lastDraw >= FRAME_INTERVAL_MS) {
        lastDraw = now;
        drawFrame((now - start) / 1000);
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [variant]);

  return (
    <canvas
      ref={canvasRef}
      className={`ascii-field ascii-field-${variant}`}
      aria-hidden="true"
    />
  );
});
