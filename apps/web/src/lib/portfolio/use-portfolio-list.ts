"use client";

/**
 * 作品集列表取数（client component）：游标分页 + 标签筛选。
 * 图片站是 /files/*，首屏无 SEO 需求，故客户端取数（与 /canvas、/design 一致）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage, type ApiErrorBody } from "@/lib/api-error";

const PAGE_SIZE = 24;

export interface PortfolioTag {
  tagId: string;
  name: string;
}

export interface PortfolioItem {
  id: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  prompt: string | null;
  model: string | null;
  kind: string;
  title: string | null;
  savedAt: string;
  sessionId: string | null;
  sessionTitle: string | null;
  tags: PortfolioTag[];
}

export type ListState = "loading" | "ready" | "error";

/** 一页取数结果。 */
interface PagedResult {
  items: PortfolioItem[];
  nextCursor: string | null;
}

export interface PortfolioList {
  items: PortfolioItem[];
  /** 全部已加载条目的标签并集，用于筛选 chip 行。 */
  allTags: PortfolioTag[];
  state: ListState;
  /** 首次加载失败（可重试）；翻页失败不置位，保留已加载内容。 */
  error: string | null;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
  setTag: (tagName: string | null) => void;
  activeTag: string | null;
  replace: (id: string, patch: Partial<PortfolioItem>) => void;
  remove: (id: string) => void;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorText(body: unknown, fallback: string): string {
  const e = body as ApiErrorBody | null;
  return apiErrorMessage(e, () => fallback, fallback);
}

export function usePortfolioList(
  translate: (key: "loadFailed") => string,
): PortfolioList {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [state, setState] = useState<ListState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  // 请求序号：丢弃过期响应，避免快速切标签时旧结果覆盖新结果
  const seqRef = useRef(0);

  /**
   * 取数逻辑放进 effect 而非 useCallback：调用方传的是内联箭头函数，
   * 身份每渲染都变。若把它列入 fetchPage 依赖，则 load → reload → effect
   * 每渲染都变，effect 反复重跑形成无限请求循环（页面持续闪烁）。
   * 放进 effect 后 translate 的变化不会重跑取数——它只在出错时读一次文案。
   */
  const fetchPage = useCallback(
    async (cursor: string | null, tag: string | null): Promise<PagedResult | null> => {
      const seq = ++seqRef.current;
      const params = new URLSearchParams({ saved: "true", limit: String(PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      if (tag) params.set("tag", tag);

      const res = await fetch(`/api/assets?${params.toString()}`);
      const body = await readJson(res);
      if (seq !== seqRef.current) return null;

      if (!res.ok) {
        const message = errorText(body, translate("loadFailed"));
        // 翻页失败保留已有内容，只在首屏失败时降级为错误态
        setState((prev) => (prev === "ready" ? "ready" : "error"));
        setError(message);
        return null;
      }
      return body as PagedResult;
    },
    // translate 仅用于出错文案，不影响取数结果，故不作为依赖（见上方说明）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const load = useCallback(
    async (tag: string | null) => {
      cursorRef.current = null;
      const page = await fetchPage(null, tag);
      if (!page) return;
      setItems(page.items);
      cursorRef.current = page.nextCursor;
      setHasMore(page.nextCursor !== null);
      setState("ready");
    },
    [fetchPage],
  );

  // 切标签/重试的统一入口。
  const reload = useCallback(
    (tag: string | null) => {
      setState("loading");
      setError(null);
      void load(tag);
    },
    [load],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload 内的置态紧接着 await 网络请求，非渲染期同步 setState；与 canvas/page.tsx 同构
    reload(activeTag);
  }, [activeTag, reload]);

  const setTag = useCallback((tag: string | null) => {
    setActiveTag(tag);
  }, []);

  const loadMore = useCallback(() => {
    const cursor = cursorRef.current;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    void (async () => {
      const page = await fetchPage(cursor, activeTag);
      setLoadingMore(false);
      if (!page) return;
      setItems((prev) => [...prev, ...page.items]);
      cursorRef.current = page.nextCursor;
      setHasMore(page.nextCursor !== null);
    })();
  }, [activeTag, fetchPage, loadingMore]);

  const allTags = items.reduce<PortfolioTag[]>((acc, item) => {
    for (const tag of item.tags) {
      if (!acc.some((t) => t.name === tag.name)) acc.push(tag);
    }
    return acc;
  }, []);

  const replace = useCallback((id: string, patch: Partial<PortfolioItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return {
    items,
    allTags,
    state,
    error,
    loadingMore,
    hasMore,
    loadMore,
    retry: () => reload(activeTag),
    setTag,
    activeTag,
    replace,
    remove,
  };
}