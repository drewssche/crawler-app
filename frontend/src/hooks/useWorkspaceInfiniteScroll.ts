import { useEffect, useRef } from "react";

type UseWorkspaceInfiniteScrollOptions = {
  canLoadMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  thresholdPx?: number;
  contentKey?: string | number;
};

export function useWorkspaceInfiniteScroll({
  canLoadMore,
  isLoading,
  onLoadMore,
  thresholdPx = 96,
  contentKey,
}: UseWorkspaceInfiniteScrollOptions) {
  const onLoadMoreRef = useRef(onLoadMore);
  const canLoadMoreRef = useRef(canLoadMore);
  const isLoadingRef = useRef(isLoading);
  const thresholdPxRef = useRef(thresholdPx);
  const targetRef = useRef<HTMLElement | Window | null>(null);
  const rafRef = useRef<number | null>(null);
  const scheduleCheckRef = useRef<() => void>(() => {});

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    canLoadMoreRef.current = canLoadMore;
  }, [canLoadMore]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    thresholdPxRef.current = thresholdPx;
  }, [thresholdPx]);

  useEffect(() => {
    const tryLoadMore = () => {
      if (!canLoadMoreRef.current || isLoadingRef.current) return;
      onLoadMoreRef.current();
    };

    const runCheck = () => {
      const target = targetRef.current;
      if (!target) return;

      if (target === window) {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const viewport = window.innerHeight;
        const fullHeight = document.documentElement.scrollHeight;
        const nearBottom = fullHeight - (scrollTop + viewport) < thresholdPxRef.current;
        if (nearBottom) tryLoadMore();
        return;
      }

      const el = target as HTMLElement;
      const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < thresholdPxRef.current;
      if (nearBottom) tryLoadMore();

      if (el.scrollHeight <= el.clientHeight + 8) {
        tryLoadMore();
      }
    };

    const scheduleCheck = () => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        runCheck();
      });
    };

    scheduleCheckRef.current = scheduleCheck;

    const workspace = document.getElementById("workspace-scroll-container");
    const target: HTMLElement | Window = workspace || window;
    targetRef.current = target;

    const onScroll = () => {
      scheduleCheck();
    };

    target.addEventListener("scroll", onScroll, { passive: true });
    scheduleCheck();

    return () => {
      target.removeEventListener("scroll", onScroll as EventListener);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      targetRef.current = null;
    };
  }, []);

  useEffect(() => {
    scheduleCheckRef.current();
  }, [contentKey, canLoadMore, isLoading, thresholdPx]);
}
