"use client";

/**
 * 消息中心取数（client component）：列表按来源筛选一次取完，未读计数走 60s 轮询。
 * 列表与未读计数同属一份状态，铃铛角标与消息中心视图因此天然一致（D11）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorMessage, type ApiErrorBody } from "@/lib/api-error";

/** 未读计数轮询间隔（ms）：新消息最迟这么久后出现在铃铛上（D11）。 */
export const POLL_INTERVAL_MS = 60_000;

/** 列表页大小：消息是低频只读场景，一屏足够，不做无限滚动。 */
const PAGE_SIZE = 20;

export type NotificationSourceFilter = "all" | "system" | "admin";

export interface NotificationItem {
  id: string;
  source: string;
  category: string;
  level: string;
  /** 中文原文：系统消息仅在词典缺键时兜底（D8） */
  title: string;
  body: string;
  i18nKey: string | null;
  i18nParams: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

export type NotificationsListState = "loading" | "ready" | "error";

export interface NotificationsFeed {
  items: NotificationItem[];
  total: number;
  /** 铃铛角标与列表红点共用：已读操作后就地更新，不必等下一轮轮询 */
  unreadCount: number;
  state: NotificationsListState;
  /** 首屏加载失败（可重试）；轮询失败不置位，保留上次计数 */
  error: string | null;
  source: NotificationSourceFilter;
  setSource: (source: NotificationSourceFilter) => void;
  /** 重新取列表（首屏失败后的重试入口） */
  retry: () => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

interface Page {
  items: NotificationItem[];
  total: number;
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

export function useNotifications(
  translate: (key: "loadFailed") => string,
): NotificationsFeed {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [state, setState] = useState<NotificationsListState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<NotificationSourceFilter>("all");
  // 请求序号：丢弃过期响应，避免快速切来源时旧结果覆盖新结果
  const seqRef = useRef(0);

  /**
   * 取数逻辑放进 useCallback 且不依赖 translate：调用方传的是内联箭头函数，
   * 身份每渲染都变；列入依赖会让 effect 每渲染重跑形成无限请求循环
   * （与 use-portfolio-list 同构）。translate 只在出错时读一次文案。
   */
  const load = useCallback(
    async (filter: NotificationSourceFilter): Promise<void> => {
      const seq = ++seqRef.current;
      const params = new URLSearchParams({ page: "1", pageSize: String(PAGE_SIZE) });
      if (filter !== "all") params.set("source", filter);

      const res = await fetch(`/api/notifications?${params.toString()}`).catch(() => null);
      if (seq !== seqRef.current) return;

      if (!res) {
        setState((prev) => (prev === "ready" ? "ready" : "error"));
        setError(translate("loadFailed"));
        return;
      }
      const body = (await readJson(res)) as Page | null;
      if (seq !== seqRef.current) return;

      if (!res.ok || !body) {
        setState((prev) => (prev === "ready" ? "ready" : "error"));
        setError(errorText(body, translate("loadFailed")));
        return;
      }
      setItems(body.items);
      setTotal(body.total);
      setState("ready");
      setError(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 见上方说明
    [],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load 内先发请求再置态，非渲染期同步 setState；与 use-portfolio-list 同构
    void load(source);
  }, [source, load]);

  /**
   * 未读计数轮询：后台标签页暂停、切回可见立即补拉一次（D11）。
   * 失败一律静默——角标停在旧值等下一轮即可，为它弹错误只会打扰用户。
   */
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (document.hidden) return;
      const res = await fetch("/api/notifications/unread-count").catch(() => null);
      if (!alive || !res || !res.ok) return;
      const body = (await readJson(res)) as { unreadCount?: number } | null;
      if (!alive) return;
      if (typeof body?.unreadCount === "number") setUnreadCount(body.unreadCount);
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const markRead = useCallback(async (id: string) => {
    const res = await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    }).catch(() => null);
    // 网络失败：保持原样，下次轮询或重新打开视图自然对账
    if (!res) return;
    if (res.status === 404) {
      // 消息已被撤回：本地一并移除，免得列表留下点不动的死条目
      setItems((prev) => prev.filter((item) => item.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      return;
    }
    if (!res.ok) return;
    const body = (await readJson(res)) as { unreadCount?: number } | null;
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
      ),
    );
    if (typeof body?.unreadCount === "number") setUnreadCount(body.unreadCount);
  }, []);

  const markAllRead = useCallback(async () => {
    const res = await fetch("/api/notifications/read-all", { method: "POST" }).catch(
      () => null,
    );
    if (!res || !res.ok) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((item) => (item.readAt ? item : { ...item, readAt: now })));
    setUnreadCount(0);
  }, []);

  return {
    items,
    total,
    unreadCount,
    state,
    error,
    source,
    setSource,
    retry: () => void load(source),
    markRead,
    markAllRead,
  };
}
