import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { apiGet } from "../api/client";
import type { PagedResponse } from "../types/common";
import { useIncrementalPager } from "./useIncrementalPager";

type UseUsersListOptions = {
  statusRef: MutableRefObject<string>;
  queryRef: MutableRefObject<string>;
  keepSelectionOnResetRef: MutableRefObject<boolean>;
  setSelectedIds: Dispatch<SetStateAction<number[]>>;
  pageSize?: number;
  onReset?: () => void;
  onError?: (error: unknown) => void;
};

export function useUsersList<T extends { id: number }>({
  statusRef,
  queryRef,
  keepSelectionOnResetRef,
  setSelectedIds,
  pageSize = 20,
  onReset,
  onError,
}: UseUsersListOptions) {
  const [rows, setRows] = useState<T[]>([]);

  const { total, isLoading, hasMore, resetAndLoad, requestNextPage } = useIncrementalPager<T>({
    fetchPage: (nextPage, signal) =>
      apiGet<PagedResponse<T>>(
        `/admin/users?status=${statusRef.current}&q=${encodeURIComponent(queryRef.current.trim())}&page=${nextPage}&page_size=${pageSize}`,
        { signal },
      ),
    applyPage: (data, append) => {
      const items = data.items || [];
      if (append) {
        setRows((prev) => {
          const next = [...prev, ...items];
          const uniqueById = new Map<number, T>();
          for (const row of next) uniqueById.set(row.id, row);
          return Array.from(uniqueById.values());
        });
        return;
      }

      setRows(items);
      if (keepSelectionOnResetRef.current) {
        const nextSet = new Set(items.map((row) => row.id));
        setSelectedIds((prev) => prev.filter((id) => nextSet.has(id)));
      } else {
        setSelectedIds([]);
      }
      keepSelectionOnResetRef.current = false;
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
