import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeError } from "../utils/errors";

type GuardedContext = {
  isCurrent: () => boolean;
  setError: (message: string) => void;
};

type GuardedTask = (ctx: GuardedContext) => Promise<void>;

export function useGuardedAsyncState() {
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (task: GuardedTask) => {
    const requestSeq = ++requestSeqRef.current;
    const isCurrent = () => mountedRef.current && requestSeq === requestSeqRef.current;
    const setErrorIfCurrent = (message: string) => {
      if (!isCurrent()) return;
      setError(message);
    };

    setIsLoading(true);
    setError("");

    try {
      await task({
        isCurrent,
        setError: setErrorIfCurrent,
      });
    } catch (e) {
      if (!isCurrent()) return;
      setError(normalizeError(e));
    } finally {
      if (!isCurrent()) return;
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    requestSeqRef.current += 1;
    if (!mountedRef.current) return;
    setIsLoading(false);
    setError("");
  }, []);

  const setErrorMessage = useCallback((message: string) => {
    setError(message);
  }, []);

  return {
    isLoading,
    error,
    run,
    reset,
    setErrorMessage,
  };
}
