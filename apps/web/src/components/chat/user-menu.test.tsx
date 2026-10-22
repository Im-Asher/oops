// @vitest-environment jsdom
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { renderWithI18n } from "@/test/render-with-i18n";
import { screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserMenuContent } from "./user-menu";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

/** Radix 触发器在 pointerdown 里调 hasPointerCapture/releasePointerCapture，jsdom 未实现。 */
function stubRadixEnvironment() {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

beforeEach(() => {
  stubRadixEnvironment();
});

afterEach(() => {
  // 本项目未开 vitest globals，RTL 不会自动 cleanup；不显式卸载就抹掉 body，
  // 残留的 Radix 树会在下一条用例里报「要移除的节点不是该节点的子节点」
  cleanup();
  document.body.innerHTML = "";
  // Radix 菜单把 body 的 pointer-events 恢复交给卸载；DOM 已被抹掉，
  // 残留的 pointer-events:none 会让下一条用例点不动任何元素
  document.body.removeAttribute("style");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** UserMenuContent 须渲染在 DropdownMenu 根内（时钟下拉/UserMenu 均满足），测试用受控根模拟。 */
function renderContent() {
  return renderWithI18n(
    <DropdownMenu open>
      <DropdownMenuContent className="w-52">
        <UserMenuContent />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

function stubProfile(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })),
  );
}

describe("UserMenuContent 用户区", () => {
  it("渲染昵称/oops ID 摘要与个人信息、退出登录入口", async () => {
    stubProfile({ username: "u1", oopsId: "AB12CD34", displayName: "小王" });
    renderContent();
    await waitFor(() => expect(screen.getByText("小王")).toBeTruthy());
    expect(screen.getByText("oops_AB12CD34")).toBeTruthy();
    expect(screen.getByText("个人信息")).toBeTruthy();
    expect(screen.getByText("退出登录")).toBeTruthy();
  });

  it("点击退出登录调用登出接口", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(null) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderContent();
    await userEvent.click(await screen.findByText("退出登录"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" }),
    );
  });
});
