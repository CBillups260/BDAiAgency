import { useEffect, useRef, useState } from "react";

/**
 * useState that mirrors its value into sessionStorage so it survives a tab
 * reload / Chrome tab-discard. Clears automatically when the tab is closed.
 *
 * Falls back to in-memory state if storage is unavailable or quota is hit.
 */
export function usePersistedState<T>(
  key: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const storageKey = `bdai:${key}`;

  const [state, setState] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  // Skip the very first write — value just came from storage.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Quota exceeded or storage disabled — keep in-memory state.
    }
  }, [storageKey, state]);

  return [state, setState];
}
