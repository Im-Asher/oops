// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import MessagesView from "./messages-view";

// antd 依赖浏览器 API，jsdom 未实现
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const fetchMock = vi.fn();

const ROW = {
  id: "m1",
  source: "admin",
  category: "admin.broadcast",
  level: "warning",
  title: "停机维护",
  body: "今晚 02:00 停机 10 分钟",
  audience: "all",
  createdBy: "admin-1",
  revokedAt: null,
  createdAt: "2026-10-18T08:00:00.000Z",
  targetCount: 7,
  readCount: 3,
};

const PAGE_FIXTURE = { items: [ROW], total: 1, page: 1, pageSize: 20 };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  // 只用 cleanup：antd 静态 message 的模块级容器不能手动摘除
  cleanup();
  vi.unstubAllGlobals();
});

describe("MessagesView（消息管理页）", () => {
  it("首屏渲染列表行，取数带默认筛选与分页", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => PAGE_FIXTURE });
    renderWithI18n(<MessagesView />);

    expect(await screen.findByText("停机维护")).toBeTruthy();
    expect(screen.getByText("全员广播")).toBeTruthy();
    expect(screen.getByText("重要")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/messages?revoked=active&page=1&pageSize=20",
    );
  });

  it("发送广播：提交 POST 后按服务端返回提示并刷新列表", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(input) === "/api/admin/messages") {
        return { ok: true, json: async () => ({ id: "m2", targetCount: 12 }) };
      }
      return { ok: true, json: async () => PAGE_FIXTURE };
    });
    const user = userEvent.setup();
    renderWithI18n(<MessagesView />);
    await screen.findByText("停机维护");

    await user.type(screen.getByLabelText("标题"), "国庆通知");
    await user.type(screen.getByLabelText("正文"), "十月一号全天可用");
    await user.click(screen.getByRole("button", { name: /发\s*送/ }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/admin/messages" && c[1]?.method === "POST",
      );
      expect(call?.[1]).toMatchObject({
        method: "POST",
        body: JSON.stringify({
          audience: "all",
          userIds: undefined,
          title: "国庆通知",
          body: "十月一号全天可用",
          level: "info",
          note: undefined,
        }),
      });
    });
    expect(await screen.findByText("已发送给 12 人")).toBeTruthy();
  });

  it("定向发送未选人：前端拦截并提示，不发请求", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => PAGE_FIXTURE });
    const user = userEvent.setup();
    renderWithI18n(<MessagesView />);
    await screen.findByText("停机维护");

    // 切到定向受众
    await user.click(screen.getByLabelText("受众"));
    await user.click(await screen.findByText("指定用户"));
    await user.type(screen.getByLabelText("标题"), "定向");
    await user.type(screen.getByLabelText("正文"), "只发给你");
    await user.click(screen.getByRole("button", { name: /发\s*送/ }));

    expect(await screen.findByText("定向发送须至少选择一名用户")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        (c) => String(c[0]) === "/api/admin/messages" && c[1]?.method === "POST",
      ),
    ).toBe(false);
  });

  it("撤回：先弹确认，确认后 POST 撤回接口", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/revoke")) {
        return { ok: true, json: async () => ({ ok: true, revokedAt: "2026-10-18T09:00:00.000Z" }) };
      }
      return { ok: true, json: async () => PAGE_FIXTURE };
    });
    const user = userEvent.setup();
    renderWithI18n(<MessagesView />);
    await screen.findByText("停机维护");

    await user.click(screen.getByRole("button", { name: /撤\s*回/ }));
    expect(
      await screen.findByText("确定撤回该消息？撤回后用户侧立即不可见，且不可恢复。"),
    ).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /确\s*定/ }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/api/admin/messages/m1/revoke")),
      ).toBe(true);
    });
    expect(await screen.findByText("消息已撤回")).toBeTruthy();
  });

  it("已撤回消息不再显示撤回按钮，列表挂「已撤回」标签", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...PAGE_FIXTURE,
        items: [{ ...ROW, revokedAt: "2026-10-18T09:00:00.000Z" }],
      }),
    });
    renderWithI18n(<MessagesView />);

    await screen.findByText("停机维护");
    expect(screen.getAllByText("已撤回").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /撤\s*回/ })).toBeNull();
  });

  it("筛选：关键词 + 来源提交后按已应用态重新取数并回到第一页", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => PAGE_FIXTURE });
    const user = userEvent.setup();
    renderWithI18n(<MessagesView />);
    await screen.findByText("停机维护");

    await user.type(screen.getByPlaceholderText("标题 / 正文关键词"), "维护");
    await user.click(screen.getByRole("button", { name: /查\s*询/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/admin/messages?revoked=active&keyword=%E7%BB%B4%E6%8A%A4&page=1&pageSize=20",
      );
    });
  });

  it("详情：拉取已读明细并展示统计", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/admin/messages/m1") {
        return {
          ok: true,
          json: async () => ({
            notification: ROW,
            readBy: [
              {
                userId: "u1",
                username: "alice",
                displayName: "Alice",
                readAt: "2026-10-18T08:30:00.000Z",
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => PAGE_FIXTURE };
    });
    const user = userEvent.setup();
    renderWithI18n(<MessagesView />);
    await screen.findByText("停机维护");

    await user.click(screen.getAllByRole("button", { name: "消息详情" })[0]);
    expect(await screen.findByText("目标 7 人，已读 3 人")).toBeTruthy();
    expect(await screen.findByText("alice")).toBeTruthy();
    expect(await screen.findByText("Alice")).toBeTruthy();
  });

  it("加载失败：展示错误提示", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    renderWithI18n(<MessagesView />);
    expect(await screen.findByText("加载消息列表失败")).toBeTruthy();
  });
});
