import { useCallback, useEffect, useRef } from "react";

export function useScheduledResetAndLoad(resetAndLoad: () => void) {
  const rafRef = useRef<number | null>(null);

  const scheduleResetAndLoad = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      resetAndLoad();
    });
  }, [resetAndLoad]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return { scheduleResetAndLoad };
}

