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

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const workspace = document.getElementById("workspace-scroll-container");
    const target: HTMLElement | Window = workspace || window;

    const tryLoadMore = () => {
      if (!canLoadMore || isLoading) return;
      onLoadMoreRef.current();
    };

    const onScroll = () => {
      if (target === window) {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const viewport = window.innerHeight;
        const fullHeight = document.documentElement.scrollHeight;
        const nearBottom = fullHeight - (scrollTop + viewport) < thresholdPx;
        if (nearBottom) tryLoadMore();
        return;
      }

      const el = target as HTMLElement;
      const nearBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < thresholdPx;
      if (nearBottom) tryLoadMore();
    };

    target.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (workspace && workspace.scrollHeight <= workspace.clientHeight + 8) {
      tryLoadMore();
    }

    return () => {
      target.removeEventListener("scroll", onScroll as EventListener);
    };
  }, [canLoadMore, isLoading, thresholdPx, contentKey]);
}
