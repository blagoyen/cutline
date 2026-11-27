import { memo } from "react";

export const BrandMark = memo(function BrandMark({
  size = 24,
  monochrome = false,
}: {
  size?: number;
  monochrome?: boolean;
}) {
  const beamId = monochrome ? "cutline-beam-mono" : "cutline-beam";
  return (
    <svg
      className="brand-svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cutline-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1c1c1e" />
          <stop offset="100%" stopColor="#070708" />
        </linearGradient>
        <linearGradient id={beamId} x1="12" y1="44" x2="52" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={monochrome ? "#ffffff" : "#ef4444"} />
          <stop offset="100%" stopColor={monochrome ? "#a1a1aa" : "#f87171"} />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="14"
        fill="url(#cutline-bg)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1.5"
      />
      {/* Left bar (upper + lower sliced segments) */}
      <polygon points="21,19 29,19 29,33 21,37.8" fill="#ffffff" />
      <polygon points="21,41.6 29,36.8 29,49 21,49" fill="#ffffff" />
      {/* Right bar (upper + lower sliced segments) */}
      <polygon points="35,14 43,14 43,24.6 35,29.4" fill="#ffffff" />
      <polygon points="35,33.2 43,28.4 43,44 35,44" fill="#ffffff" />
      {/* Diagonal cut line */}
      <line
        x1="13"
        y1="43.5"
        x2="51"
        y2="20.5"
        stroke={`url(#${beamId})`}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
});
