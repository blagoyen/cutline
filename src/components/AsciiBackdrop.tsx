import { memo, useMemo } from "react";

interface AsciiBackdropProps {
  variant?: "ambient" | "band";
}

/**
 * Deterministic sculpted ASCII art field inspired by editorial terminal textures.
 * Computed once per variant — zero animation loop, zero layout thrash.
 */
function buildAsciiArt(cols: number, rows: number, variant: "ambient" | "band"): string {
  const lines: string[] = [];
  const accentGlyphs = ["|", ":", "/", "+", "=", "#", "[", "]", ">", "0", "1"];

  for (let y = 0; y < rows; y++) {
    let row = "";
    const ny = y / Math.max(1, rows - 1);
    for (let x = 0; x < cols; x++) {
      const nx = x / Math.max(1, cols - 1);

      if (variant === "band") {
        // Sculpted dual-wave audio/video timeline silhouette rising from diagonal slashes
        const wave1 = Math.sin(nx * Math.PI * 3.2 + 0.6) * 0.28 + 0.5;
        const wave2 = Math.cos(nx * Math.PI * 5.8 - 1.1) * 0.22 + 0.52;
        const ridge = Math.min(Math.abs(ny - wave1), Math.abs(ny - wave2));
        const cluster =
          Math.sin(nx * 19.0 + ny * 7.0) * Math.cos(nx * 11.0 - ny * 13.0);

        if (ridge < 0.08 && cluster > 0.05) {
          const idx = Math.abs(Math.floor((x * 7 + y * 13) % accentGlyphs.length));
          row += accentGlyphs[idx];
        } else if (ridge < 0.19 && cluster > -0.15) {
          row += (x + y) % 5 === 0 ? ":" : "/";
        } else if ((x + y) % 3 === 0) {
          row += "/";
        } else {
          row += " ";
        }
      } else {
        // Subtle ambient architectural diagonal/dot field for the background canvas
        const signal = Math.sin(nx * 14.0 + ny * 9.0) * Math.cos(nx * 7.0 - ny * 11.0);
        if (signal > 0.72 && (x + y) % 4 === 0) {
          row += (x * 3 + y) % 2 === 0 ? ":" : "+";
        } else if ((x + y) % 6 === 0) {
          row += "/";
        } else if (x % 8 === 0 && y % 4 === 0) {
          row += ".";
        } else {
          row += " ";
        }
      }
    }
    lines.push(row);
  }
  return lines.join("\n");
}

export const AsciiBackdrop = memo(function AsciiBackdrop({
  variant = "ambient",
}: AsciiBackdropProps) {
  const art = useMemo(
    () =>
      variant === "band"
        ? buildAsciiArt(150, 14, "band")
        : buildAsciiArt(160, 48, "ambient"),
    [variant],
  );

  return (
    <pre
      className={`ascii-field ascii-field-${variant}`}
      aria-hidden="true"
    >
      {art}
    </pre>
  );
});
