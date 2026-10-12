// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import UsersView from "./users-view";

// antd 在 jsdom 缺失的浏览器 API 打桩（Table 响应式观察 / 样式断点）
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const fetchMock = vi.fn();

const ROWS = [
  {
    id: "u1",
    username: "alice",
    oopsId: "ab12cd34",
    displayName: "Alice",
    status: "active",
    role: "user",
    creditBalance: 120,
    createdAt: "2026-10-01T08:00:00.000Z",
  },
  {
    id: "u2",
    username: "bob",
    oopsId: "ef56gh78",
    displayName: null,
    status: "disabled",
    role: "admin",
    creditBalance: 0,
    createdAt: "2026-10-02T08:00:00.000Z",
  },
];

const PAGE_FIXTURE = { items: ROWS, total: 2, page: 1, pageSize: 20 };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("UsersView（用户管理页）", () => {
  it("首屏渲染列表行，取数带默认分页参数", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => PAGE_FIXTURE,
    });
    renderWithI18n(<UsersView />);

    await screen.findByText("alice");
    expect(screen.getByText("oops_ab12cd34")).toBeTruthy();
    expect(screen.getByText("管理员")).toBeTruthy(); // bob 的角色
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/users?page=1&pageSize=20",
    );
  });

  it("搜索提交：按已应用态重新取数并回到第一页", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => PAGE_FIXTURE,
    });
    const user = userEvent.setup();
    renderWithI18n(<UsersView />);
    await screen.findByText("alice");

    await user.type(screen.getByPlaceholderText("搜索用户名 / oops ID / 昵称"), "ali");
    await user.click(screen.getByRole("button", { name: /查\s*询/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/admin/users?search=ali&page=1&pageSize=20",
      );
    });
  });

  it("确认停用：开关点击先弹确认，确认后 PATCH 并以服务端返回更新行", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/status")) {
        return {
          ok: true,
          json: async () => ({ user: { ...ROWS[0], status: "disabled" } }),
        };
      }
      return { ok: true, json: async () => PAGE_FIXTURE };
    });
    const user = userEvent.setup();
    renderWithI18n(<UsersView />);
    await screen.findByText("alice");

    const switches = screen.getAllByRole("switch");
    expect(switches[0].getAttribute("aria-checked")).toBe("true"); // alice active
    await user.click(switches[0]);

    // 确认弹层出现且开关尚未翻转
    expect(await screen.findByText("确定停用该用户？停用后其登录与会话请求将立即被拒。")).toBeTruthy();
    expect(switches[0].getAttribute("aria-checked")).toBe("true");

    // antd 两字中文按钮自动插入空隙（"确 定"），可访问名用正则匹配
    await user.click(await screen.findByRole("button", { name: /确\s*定/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/u1/status", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "disabled" }),
      });
    });
    // 重渲染可能替换 DOM 节点，须重查而非引用旧节点
    await waitFor(() => {
      expect(screen.getAllByRole("switch")[0].getAttribute("aria-checked")).toBe("false");
    });
  });

  it("自禁拒绝 422：按 code 映射词典文案提示", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/status")) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            error: { code: "SELF_DISABLE_FORBIDDEN", message: "不能停用自己的账号" },
          }),
        };
      }
      return { ok: true, json: async () => PAGE_FIXTURE };
    });
    const user = userEvent.setup();
    renderWithI18n(<UsersView />);
    await screen.findByText("alice");

    const switches = screen.getAllByRole("switch");
    await user.click(switches[0]);
    await user.click(await screen.findByRole("button", { name: /确\s*定/ }));

    expect(await screen.findByText("不能停用自己的账号")).toBeTruthy();
    await waitFor(() => {
      expect(switches[0].getAttribute("aria-checked")).toBe("true"); // 行状态不变
    });
  });

  it("加载失败：展示错误提示", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    renderWithI18n(<UsersView />);
    expect(await screen.findByText("加载用户列表失败")).toBeTruthy();
  });
});
