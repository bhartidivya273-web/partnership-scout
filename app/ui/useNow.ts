import { useCallback, useSyncExternalStore } from "react";

/** The current time, refreshed every `intervalMs`. Returns 0 on the server and before the page is live. */
export function useNow(intervalMs: number): number {
  const subscribe = useCallback(
    (notify: () => void) => {
      const id = setInterval(notify, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0,
  );
}
