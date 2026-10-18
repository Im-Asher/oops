// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import { NotificationsPanel } from "./notifications-panel";

interface Row {
  id: string;
  source: string;
  category: string;
  level: string;
  title: string;
  body: string;
  i18nKey: string | null;
  i18nParams: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

const h = vi.hoisted(() => ({
  unread: 0 as number,
  rows: [] as Row[],
  listStatus: 200,
}));

const fetchMock = vi.fn();

function defaultFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url.includes("unread-count")) {
    return Promise.resolve({ ok: true, json: async () => ({ unreadCount: h.unread }) });
  }
  if (url.startsWith("/api/notifications?")) {
    return Promise.resolve({
      ok: h.listStatus < 400,
      status: h.listStatus,
      json: async () =>
        h.listStatus >= 400
          ? { error: { code: "BOOM", message: "boom" } }
          : { items: h.rows, total: h.rows.length },
    });
  }
  if (init?.method === "PATCH") {
    return Promise.resolve({ ok: true, json: async () => ({ unreadCount: 0 }) });
  }
  if (init?.method === "POST") {
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, marked: 2 }) });
  }
  return Promise.resolve({ ok: true, json: async () => ({}) });
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: "n1",
    source: "system",
    category: "credits.exhausted",
    level: "critical",
    title: "积分已耗尽",
    body: "当前余额 0，已无法继续生成，请联系管理员补充积分。",
    i18nKey: "notifications.credits.exhausted",
    i18nParams: { balance: 0 },
    createdAt: "2026-10-18T08:00:00.000Z",
    readAt: null,
    ...over,
  };
}

beforeEach(() => {
  h.unread = 0;
  h.rows = [];
  h.listStatus = 200;
  fetchMock.mockReset();
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("NotificationsPanel", () => {
  it("系统消息按词典渲染标题与正文（带 balance 插值）", async () => {
    h.rows = [row()];
    renderWithI18n(<NotificationsPanel />);

    expect(await screen.findByText("积分已耗尽")).toBeTruthy();
    expect(
      screen.getByText("当前余额 0，已无法继续生成，请联系管理员补充积分。"),
    ).toBeTruthy();
  });

  it("词典未登记的类别回退消息主体的中文原文", async () => {
    h.rows = [
      row({
        category: "credits.mystery",
        i18nKey: "notifications.credits.mystery",
        i18nParams: null,
        title: "库里的标题",
        body: "库里的正文",
      }),
    ];
    renderWithI18n(<NotificationsPanel />);

    expect(await screen.findByText("库里的标题")).toBeTruthy();
    expect(screen.getByText("库里的正文")).toBeTruthy();
  });

  it("管理员消息（无 i18nKey）原样展示", async () => {
    h.rows = [
      row({
        source: "admin",
        category: "admin.broadcast",
        i18nKey: null,
        i18nParams: null,
        title: "停机维护通知",
        body: "今晚 02:00 停机 10 分钟",
      }),
    ];
    renderWithI18n(<NotificationsPanel />);

    expect(await screen.findByText("停机维护通知")).toBeTruthy();
    expect(screen.getByText("今晚 02:00 停机 10 分钟")).toBeTruthy();
  });

  it("未读与已读可区分，点击未读条目即标记已读", async () => {
    h.rows = [row({ id: "u1" }), row({ id: "r1", readAt: "2026-10-18T09:00:00.000Z" })];
    h.unread = 1;
    renderWithI18n(<NotificationsPanel />);

    const unread = await screen.findByTestId("notification-u1");
    const read = screen.getByTestId("notification-r1");
    expect(unread.getAttribute("data-read")).toBe("unread");
    expect(read.getAttribute("data-read")).toBe("read");
    expect(screen.getAllByTestId("notification-unread-dot")).toHaveLength(1);
    expect((read as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(unread);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) => String(c[0]).endsWith("/api/notifications/u1") && c[1]?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId("notification-u1").getAttribute("data-read")).toBe("read");
    });
  });

  it("未读数为 0 时禁用全部已读；点击后清零", async () => {
    h.rows = [row()];
    h.unread = 1;
    renderWithI18n(<NotificationsPanel />);

    const button = await screen.findByTestId("notifications-mark-all");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("read-all"));
      expect(call?.[1]).toMatchObject({ method: "POST" });
    });
    await waitFor(() => {
      expect(
        (screen.getByTestId("notifications-mark-all") as HTMLButtonElement).disabled,
      ).toBe(true);
    });
    expect(screen.queryByTestId("notifications-unread")).toBeNull();
  });

  it("切来源筛选会带上 source 重新取列表", async () => {
    h.rows = [row()];
    renderWithI18n(<NotificationsPanel />);
    await screen.findByTestId("notifications-list");

    fireEvent.click(screen.getByTestId("notifications-filter-admin"));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("?page=1"));
      expect(String(calls.at(-1)?.[0])).toContain("source=admin");
    });
    expect(
      screen.getByTestId("notifications-filter-admin").getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("空态与错误态文案", async () => {
    h.rows = [];
    const { unmount } = renderWithI18n(<NotificationsPanel />);
    expect(await screen.findByText("还没有任何消息")).toBeTruthy();
    unmount();

    h.listStatus = 500;
    renderWithI18n(<NotificationsPanel />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("重试")).toBeTruthy();
  });
});
