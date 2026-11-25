export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isMobilePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return isIosDevice() || window.matchMedia("(max-width: 768px)").matches;
}
