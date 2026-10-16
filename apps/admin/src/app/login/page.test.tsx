// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import LoginPage from "./page";

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

const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: vi.fn() }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// antd 按钮的可访问名受内部 span 包裹影响，按 type 定位最稳
function submitButton(): HTMLElement {
  const el = document.querySelector("button[type=submit]");
  if (!el) throw new Error("登录按钮未渲染");
  return el as HTMLElement;
}

describe("管理端登录页", () => {
  it("渲染用户名/密码表单", () => {
    renderWithI18n(<LoginPage />);
    expect(screen.getByPlaceholderText("请输入用户名")).toBeTruthy();
    expect(screen.getByPlaceholderText("请输入密码")).toBeTruthy();
    // antd 会在两个中文字之间插入字距空格（"登 录"），断言前归一化
    expect(submitButton().textContent?.replace(/\s+/g, "")).toBe("登录");
  });

  it("提交成功后进入管理布局（刷新以重跑布局层门卫）", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: { id: "owner" } }), { status: 200 }));
    renderWithI18n(<LoginPage />);

    await userEvent.type(screen.getByPlaceholderText("请输入用户名"), "owner");
    await userEvent.type(screen.getByPlaceholderText("请输入密码"), "pw");
    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/");
      expect(refreshMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ username: "owner", password: "pw" });
  });

  it("凭证错误展示服务端人话文案", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "INVALID_CREDENTIALS", message: "用户名或密码不正确" } }),
        { status: 401 },
      ),
    );
    renderWithI18n(<LoginPage />);

    await userEvent.type(screen.getByPlaceholderText("请输入用户名"), "owner");
    await userEvent.type(screen.getByPlaceholderText("请输入密码"), "bad");
    await userEvent.click(submitButton());

    await waitFor(() => {
      expect(screen.getByText("用户名或密码不正确")).toBeTruthy();
    });
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
