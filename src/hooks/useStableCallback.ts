import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Returns a function with a permanent identity that always calls the latest `fn`.
 *
 * Use it for event handlers passed to memoised children: the child never
 * re-renders because the handler changed, yet the handler still sees fresh
 * state. Do not call the returned function during render.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
