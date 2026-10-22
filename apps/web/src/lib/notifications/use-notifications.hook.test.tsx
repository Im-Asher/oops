// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_INTERVAL_MS, useNotifications, type NotificationItem } from "./use-notifications";

function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "n1",
    source: "system",
    category: "credits.exhausted",
    level: "critical",
    title: "积分已耗尽",
    body: "当前余额 0",
    i18nKey: "notifications.credits.exhausted",
    i18nParams: { balance: 0 },
    createdAt: "2026-10-18T08:00:00.000Z",
    readAt: null,
    ...over,
  };
}

/** 可变的 fetch 桩：列表与未读数分开控制，便于分别断言调用次数。 */
const h = vi.hoisted(() => ({
  unread: 2 as number,
  items: [] as unknown[],
  listStatus: 200,
}));

const fetchMock = vi.fn();

/** 默认桩：列表与未读数分开控制，便于分别断言调用次数。 */
function defaultFetch(input: RequestInfo | URL) {
  const url = String(input);
  if (url.startsWith("/api/notifications/unread-count")) {
    return Promise.resolve({ ok: true, json: async () => ({ unreadCount: h.unread }) });
  }
  if (url.startsWith("/api/notifications?")) {
    return Promise.resolve({
      ok: h.listStatus >= 200 && h.listStatus < 300,
      status: h.listStatus,
      json: async () =>
        h.listStatus >= 400
          ? { error: { code: "BOOM", message: "列表炸了" } }
          : { items: h.items, total: h.items.length },
    });
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, unreadCount: 0 }) });
}

/** jsdom 的 document.hidden 是只读访问器，这里换成可写桩以驱动暂停/恢复。 */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

function unreadCalls(): number {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes("unread-count")).length;
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.unread = 2;
  h.items = [item()];
  h.listStatus = 200;
  setHidden(false);
  fetchMock.mockReset();
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // 未开 vitest globals 时 RTL 不会自动卸载，残留 hook 的定时器会污染下一例计数
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useNotifications", () => {
  it("挂载即取列表与未读数，两份状态同源", async () => {
    const { result } = renderHook(() => useNotifications(() => "加载失败"));
    await flush();

    expect(result.current.state).toBe("ready");
    expect(result.current.items).toHaveLength(1);
    expect(result.current.unreadCount).toBe(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/notifications?page=1");
  });

  it("按 60s 节奏轮询未读计数", async () => {
    const { result } = renderHook(() => useNotifications(() => "加载失败"));
    await flush();
    expect(unreadCalls()).toBe(1);

    // 未到间隔不重复请求
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    });
    expect(unreadCalls()).toBe(1);

    h.unread = 5;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(unreadCalls()).toBe(2);
    expect(result.current.unreadCount).toBe(5);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(unreadCalls()).toBe(3);
  });

  it("页面隐藏时暂停轮询，切回可见立即补拉一次", async () => {
    renderHook(() => useNotifications(() => "加载失败"));
    await flush();
    expect(unreadCalls()).toBe(1);

    setHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(unreadCalls()).toBe(1);

    // 切回可见：不等间隔，立刻补拉
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(unreadCalls()).toBe(2);
  });

  it("切来源筛选重新取列表并带上 source 参数", async () => {
    const { result } = renderHook(() => useNotifications(() => "加载失败"));
    await flush();

    await act(async () => {
      result.current.setSource("system");
      await vi.advanceTimersByTimeAsync(0);
    });
    const listCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("?page=1"));
    expect(String(listCalls.at(-1)?.[0])).toContain("source=system");
  });

  it("首屏失败进入 error 态并可用 retry 重试", async () => {
    h.listStatus = 500;
    const { result } = renderHook(() => useNotifications(() => "加载失败"));
    await flush();
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBeTruthy();

    h.listStatus = 200;
    await act(async () => {
      result.current.retry();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe("ready");
    expect(result.current.items).toHaveLength(1);
  });

  it("markRead 就地置已读并采用服务端返回的未读数", async () => {
    const { result } = renderHook(() => useNotifications(() => "加载失败"));
    await flush();

    await act(async () => {
      await result.current.markRead("n1");
    });
    expect(result.current.items[0].readAt).toBeTruthy();
    const patchCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/api/notifications/n1"),
    );
    expect(patchCall?.[1]).toMatchObject({ method: "PATCH" });
    // 桩对 PATCH 返回 unreadCount: 0 —— 未读数以服务端为准
    expect(result.current.unreadCount).toBe(0);
  });

  it("markRead 命中 404（消息已被撤回）时把该条移出列表", async () => {
    // 仅让 PATCH 命中 404（撤回后的消息），列表与未读数仍走默认桩
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/notifications/n1") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: { code: "NOT_FOUND" } }),
        });
      }
      return defaultFetch(input);
    });

    const { result } = renderHook(() => useNotifications(() => "加载失败"));
    await flush();
    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      await result.current.markRead("n1");
    });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.total).toBe(0);
  });

  it("markAllRead 把全部条目标为已读并清零角标", async () => {
    h.items = [item(), item({ id: "n2", readAt: "2026-10-18T08:00:00.000Z" })];
    const { result } = renderHook(() => useNotifications(() => "加载失败"));
    await flush();
    expect(result.current.unreadCount).toBe(2);

    await act(async () => {
      await result.current.markAllRead();
    });
    expect(result.current.items.every((i) => Boolean(i.readAt))).toBe(true);
    expect(result.current.unreadCount).toBe(0);
    const allCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("read-all"));
    expect(allCall?.[1]).toMatchObject({ method: "POST" });
  });
});
