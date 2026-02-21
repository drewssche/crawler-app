import { useState } from "react";
import { getEventsFeed, type EventItem } from "../api/events";
import { useIncrementalPager } from "./useIncrementalPager";

type UseEventFeedOptions = {
  channel: "all" | "notification" | "action";
  includeDismissed: boolean;
  onlyUnread: boolean;
  securityOnly: boolean;
  pageSize?: number;
  onReset?: () => void;
  onError?: (error: unknown) => void;
};

export function useEventFeed({
  channel,
  includeDismissed,
  onlyUnread,
  securityOnly,
  pageSize = 20,
  onReset,
  onError,
}: UseEventFeedOptions) {
  const [rows, setRows] = useState<EventItem[]>([]);

  const { total, isLoading, hasMore, resetAndLoad, requestNextPage } = useIncrementalPager<EventItem>({
    fetchPage: (nextPage, signal) =>
      getEventsFeed({
        channel,
        includeDismissed,
        onlyUnread,
        securityOnly,
        page: nextPage,
        pageSize,
        signal,
      }),
    applyPage: (data, append) => {
      setRows((prev) => (append ? [...prev, ...data.items] : data.items));
    },
    onReset: () => {
      setRows([]);
      onReset?.();
    },
    onError: (e) => {
      onError?.(e);
    },
  });

  return {
    rows,
    setRows,
    total,
    isLoading,
    hasMore,
    resetAndLoad,
    requestNextPage,
  };
}
