// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { takePendingHandoffFiles } from "@/lib/chat/home-handoff";
import { APP_VERSION } from "@/lib/version";
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
  takePendingHandoffFiles();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function imageFile(name: string): File {
  return new File(["data"], name, { type: "image/png" });
}

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

  it("创作直发：提交携带文本 + send 标记跳 /canvas（空输入不可提交）", async () => {
    render(<HomePage />);
    const input = await screen.findByLabelText("消息输入");
    // 空输入：发送禁用，回车不跳转
    expect((screen.getByLabelText("发送") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();

    await userEvent.type(input, "为保温杯拍一张主图");
    await userEvent.click(screen.getByLabelText("发送"));
    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(push.mock.calls[0][0], "http://localhost");
    expect(url.pathname).toBe("/canvas");
    expect(url.searchParams.get("draft")).toBe("为保温杯拍一张主图");
    expect(url.searchParams.get("send")).toBe("1");
    expect(url.searchParams.get("t")).not.toBeNull();
  });

  it("直发乐观态：提交后输入锁定（路由锁），不可重复触发", async () => {
    render(<HomePage />);
    const input = await screen.findByLabelText("消息输入");
    await userEvent.type(input, "为保温杯拍一张主图");
    await userEvent.click(screen.getByLabelText("发送"));
    expect((screen.getByLabelText("消息输入") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByLabelText("发送") as HTMLButtonElement).disabled).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("附件：添加图片出现可移除 chip；非图片与超 5 张被拒绝并提示", async () => {
    render(<HomePage />);
    await screen.findByLabelText("消息输入");
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, {
      target: { files: [imageFile("a.png"), new File(["x"], "b.pdf", { type: "application/pdf" })] },
    });
    expect(screen.getByTestId("composer-pending-files")).toBeTruthy();
    expect(screen.getByText("附件：a.png")).toBeTruthy();
    expect(screen.getByTestId("home-file-error").textContent).toContain("仅支持图片");

    // 移除 chip
    await userEvent.click(screen.getByLabelText("移除附件 a.png"));
    expect(screen.queryByTestId("composer-pending-files")).toBeNull();

    // 超 5 张：第 6 张被拒
    fireEvent.change(fileInput, {
      target: {
        files: [
          imageFile("1.png"),
          imageFile("2.png"),
          imageFile("3.png"),
          imageFile("4.png"),
          imageFile("5.png"),
          imageFile("6.png"),
        ],
      },
    });
    expect(screen.getByTestId("home-file-error").textContent).toContain("最多 5 个附件");
    expect(screen.getAllByText(/^附件：/).length).toBe(5);
  });

  it("携带附件直发：附件经 handoff store 交接给画布侧", async () => {
    render(<HomePage />);
    const input = await screen.findByLabelText("消息输入");
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [imageFile("ref.png")] } });
    await userEvent.type(input, "带参考图生成");
    await userEvent.click(screen.getByLabelText("发送"));
    const handed = takePendingHandoffFiles();
    expect(handed).toHaveLength(1);
    expect(handed[0].name).toBe("ref.png");
  });

  it("侧栏品牌区在 logo 旁展示版本徽标", async () => {
    render(<HomePage />);
    const badge = await screen.findByTestId("app-version-badge");
    expect(badge.textContent).toBe(`v${APP_VERSION}`);
    expect(screen.getByText("oops")).toBeTruthy();
  });
});
