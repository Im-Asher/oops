// @vitest-environment jsdom
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMenuContent } from "./user-menu";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** UserMenuContent 须渲染在 DropdownMenu 根内（时钟下拉/UserMenu 均满足），测试用受控根模拟。 */
function renderContent() {
  return render(
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
