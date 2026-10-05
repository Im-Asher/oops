// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const AGENTS = {
  agents: [
    {
      id: "product-photographer",
      name: "产品摄影师",
      description: "电商主图与摆拍",
      icon: "📸",
      presets: [],
      tools: [],
    },
    {
      id: "atmosphere-designer",
      name: "氛围图设计师",
      description: "场景与氛围图",
      icon: "🌄",
      presets: [],
      tools: [],
    },
  ],
};

beforeEach(() => {
  // 路由感知桩：仅 /api/agents 返回列表，其余接口按空数据处理
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/agents") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(AGENTS) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    }),
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("首页落地页", () => {
  it("侧栏：AI 画布可用、创建设计与其余导航项置灰禁用", async () => {
    render(<HomePage />);
    const canvasLink = await screen.findByText("AI 画布");
    expect(canvasLink.closest("a")?.getAttribute("href")).toBe("/canvas");
    const designBtn = screen.getByText("创建设计") as HTMLButtonElement;
    expect(designBtn.disabled).toBe(true);
    for (const label of ["作品集", "素材库", "消息中心", "设置"]) {
      expect((screen.getByText(label) as HTMLButtonElement).disabled).toBe(true);
    }
    // 用户入口（头像触发）可达
    expect(screen.getByRole("button", { name: "用户菜单" })).toBeTruthy();
  });

  it("创作输入提交携带草稿跳 /canvas 且不自动发送；空输入不可提交", async () => {
    render(<HomePage />);
    const input = await screen.findByLabelText("创作输入");
    // 空输入：按钮禁用，回车不跳转
    expect(((await screen.findByLabelText("去画布生成")) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();

    await userEvent.type(input, "为保温杯拍一张主图");
    await userEvent.click(screen.getByLabelText("去画布生成"));
    expect(push).toHaveBeenCalledWith(
      `/canvas?draft=${encodeURIComponent("为保温杯拍一张主图")}`,
    );
  });

  it("Agent 卡片点击跳 /canvas 并预选该 Agent", async () => {
    render(<HomePage />);
    await userEvent.click(await screen.findByText("氛围图设计师"));
    expect(push).toHaveBeenCalledWith("/canvas?agent=atmosphere-designer");
  });
});
