import { useCallback, useEffect, useRef, useState } from "react";
import type { PagedResponse } from "../types/common";
import { isAbortError } from "../api/client";

type UseIncrementalPagerOptions<T> = {
  fetchPage: (nextPage: number, signal: AbortSignal) => Promise<PagedResponse<T>>;
  applyPage: (payload: PagedResponse<T>, append: boolean) => void;
  onReset?: () => void;
  onError?: (error: unknown) => void;
};

export function useIncrementalPager<T>({
  fetchPage,
  applyPage,
  onReset,
  onError,
}: UseIncrementalPagerOptions<T>) {
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const loadingRef = useRef(false);
  const requestSeqRef = useRef(0);
  const appendRequestedPageRef = useRef<number | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const fetchPageRef = useRef(fetchPage);
  const applyPageRef = useRef(applyPage);
  const onResetRef = useRef(onReset);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    fetchPageRef.current = fetchPage;
  }, [fetchPage]);

  useEffect(() => {
    applyPageRef.current = applyPage;
  }, [applyPage]);

  useEffect(() => {
    onResetRef.current = onReset;
  }, [onReset]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const loadPage = useCallback(
    async (nextPage: number, append: boolean) => {
      if (loadingRef.current && append) return;
      activeAbortControllerRef.current?.abort();
      const controller = new AbortController();
      activeAbortControllerRef.current = controller;
      loadingRef.current = true;
      const requestSeq = ++requestSeqRef.current;
      setIsLoading(true);
      try {
        const data = await fetchPageRef.current(nextPage, controller.signal);
        if (requestSeq !== requestSeqRef.current) return;
        applyPageRef.current(data, append);
        setTotal(data.total);
        setPage(data.page);
        setHasMore(data.page * data.page_size < data.total && data.items.length > 0);
      } catch (e) {
        if (requestSeq !== requestSeqRef.current) return;
        if (isAbortError(e)) return;
        onErrorRef.current?.(e);
      } finally {
        if (requestSeq === requestSeqRef.current) {
          if (activeAbortControllerRef.current === controller) {
            activeAbortControllerRef.current = null;
          }
          if (append) {
            appendRequestedPageRef.current = null;
          }
          loadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [],
  );

  const resetAndLoad = useCallback(() => {
    appendRequestedPageRef.current = null;
    setPage(1);
    setTotal(0);
    setHasMore(false);
    onResetRef.current?.();
    void loadPage(1, false);
  }, [loadPage]);

  const requestNextPage = useCallback(() => {
    if (!hasMore || isLoading || loadingRef.current) return;
    const nextPage = page + 1;
    if (appendRequestedPageRef.current === nextPage) return;
    appendRequestedPageRef.current = nextPage;
    void loadPage(nextPage, true);
  }, [hasMore, isLoading, loadPage, page]);

  useEffect(() => {
    return () => {
      activeAbortControllerRef.current?.abort();
      activeAbortControllerRef.current = null;
    };
  }, []);

  return {
    page,
    total,
    isLoading,
    hasMore,
    resetAndLoad,
    requestNextPage,
  };
}
