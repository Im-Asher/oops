// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import InviteCodesView from "./invite-codes-view";

// antd 在 jsdom 缺失的浏览器 API 打桩（同 users-view.test）
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
    id: "c1",
    code: "abcd2345",
    maxUses: 1,
    usedCount: 0,
    expiresAt: null,
    revokedAt: null,
    note: "M2 冒烟",
    createdAt: "2026-10-12T08:00:00.000Z",
    status: "active",
  },
  {
    id: "c2",
    code: "efgh5678",
    maxUses: 5,
    usedCount: 5,
    expiresAt: null,
    revokedAt: null,
    note: null,
    createdAt: "2026-10-11T08:00:00.000Z",
    status: "revoked",
  },
];

const PAGE_FIXTURE = { items: ROWS, total: 2, page: 1, pageSize: 20 };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => PAGE_FIXTURE });
});

afterEach(() => {
  // 只用 cleanup：antd 静态 message 的模块级容器不能手动摘除，
  // 否则下一次 message 渲染进 detached 容器导致文案查询失败。
  cleanup();
  vi.unstubAllGlobals();
});

describe("InviteCodesView（邀请码管理页）", () => {
  it("首屏渲染列表行：码/派生状态/用量", async () => {
    renderWithI18n(<InviteCodesView />);

    await screen.findByText("abcd2345");
    expect(screen.getByText("已作废")).toBeTruthy();
    // 用量展示 usedCount / maxUses
    expect(screen.getByText("5 / 5")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/invite-codes?page=1&pageSize=20",
    );
  });

  it("批量生成：表单缺省值提交 POST，成功后提示并刷新列表", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/admin/invite-codes" ) {
        return { ok: true, json: async () => ({ codes: ["newcode1"] }) };
      }
      return { ok: true, json: async () => PAGE_FIXTURE };
    });
    renderWithI18n(<InviteCodesView />);
    await screen.findByText("abcd2345");
    const listCallsBefore = fetchMock.mock.calls.length;

    // count/maxUses 有缺省值（10/1），直接提交
    await user.click(screen.getByRole("button", { name: /批\s*量\s*生\s*成/ }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([u, init]) =>
          String(u) === "/api/admin/invite-codes" && (init as RequestInit)?.method === "POST",
      );
      expect(postCall).toBeTruthy();
    });
    const [, init] = fetchMock.mock.calls.find(
      ([u, i]) =>
        String(u) === "/api/admin/invite-codes" && (i as RequestInit)?.method === "POST",
    )!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      count: 10,
      maxUses: 1,
      expiresAt: null,
      note: null,
    });
    expect(await screen.findByText("已生成 1 个邀请码")).toBeTruthy();
    // 成功后触发列表重拉
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(listCallsBefore);
    });
  });

  it("作废确认：确认后 POST revoke，行内状态提示成功", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/revoke")) {
        return { ok: true, json: async () => ({ inviteCode: {}, alreadyRevoked: false }) };
      }
      return { ok: true, json: async () => PAGE_FIXTURE };
    });
    renderWithI18n(<InviteCodesView />);
    await screen.findByText("abcd2345");

    // 第一行（active）的作废按钮；第二行 revoked 的作废按钮 disabled
    const revokeButtons = screen.getAllByRole("button", { name: /作\s*废/ });
    expect(revokeButtons[1]).toHaveProperty("disabled", true);
    await user.click(revokeButtons[0]);

    expect(
      await screen.findByText("确定作废该邀请码？作废后立即无法用于注册，且不可恢复。"),
    ).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /确\s*定/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/admin/invite-codes/c1/revoke", {
        method: "POST",
      });
    });
    expect(await screen.findByText("邀请码已作废")).toBeTruthy();
  });
});
