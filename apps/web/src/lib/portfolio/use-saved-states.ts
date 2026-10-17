"use client";

/**
 * 画布作品的收藏态与加工出口（spec portfolio「收藏状态查询」）。
 * 星标状态一次批量查得而非逐张查询：画布上可能有几十张图，N 个请求不可接受。
 * 查不到时按未收藏渲染，属降级不阻断（design.md D9）。
 */
import { useCallback, useEffect, useState } from "react";

/** assetId → 是否已收藏。未命中的 id 视为未收藏。 */
export type SavedMap = Record<string, boolean>;

export function useSavedStates(assetIds: string[]): {
  saved: SavedMap;
  loading: boolean;
  toggle: (assetId: string) => Promise<void>;
  isSaved: (assetId: string) => boolean;
} {
  const [saved, setSaved] = useState<SavedMap>({});
  const [loading, setLoading] = useState(false);
  // 排序+去重后的稳定串：顺序变化或重复 id 不应触发重复请求。
  // 依赖数组只接受简单表达式，故在渲染期直接算出串（O(n log n)，n为画布条目数，
  // 远小于网络往返；memo 的依赖本身就得是稳定标量）。
  const key = [...new Set(assetIds.filter(Boolean))].sort().join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 清空上一次查询结果，非渲染期同步 setState
      setSaved({});
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/assets?saved&ids=${encodeURIComponent(key)}`);
        if (!res.ok) throw new Error("query failed");
        const body = (await res.json()) as { items: { id: string; saved: boolean }[] };
        if (cancelled) return;
        const next: SavedMap = {};
        for (const item of body.items) next[item.id] = item.saved;
        setSaved(next);
      } catch {
        // 降级：查不到就按未收藏渲染，不阻断画布
        if (!cancelled) setSaved({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  const toggle = useCallback(async (assetId: string) => {
    if (!assetId) return;
    // 乐观更新，失败后回滚
    const prev = saved[assetId] ?? false;
    setSaved((cur) => ({ ...cur, [assetId]: !prev }));
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ savedAt: prev ? null : new Date().toISOString() }),
      });
      if (!res.ok) throw new Error("toggle failed");
    } catch {
      setSaved((cur) => ({ ...cur, [assetId]: prev }));
    }
  }, [saved]);

  const isSaved = useCallback((assetId: string) => saved[assetId] ?? false, [saved]);

  return { saved, loading, toggle, isSaved };
}