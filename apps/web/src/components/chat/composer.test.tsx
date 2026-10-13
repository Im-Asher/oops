// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import { Composer } from "./composer";
import type { AgentInfo } from "@/types/chat";

const agents: AgentInfo[] = [
  {
    id: "a1",
    name: "产品摄影师",
    description: "",
    icon: "📸",
    presets: ["给保温杯拍纯白主图", "木质桌面咖啡场景"],
    tools: [],
  },
];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    agents,
    agentId: "a1",
    onAgentChange: vi.fn(),
    value: "",
    onChange: vi.fn(),
    onSend: vi.fn(),
    busy: false,
    hasSession: true,
    ...overrides,
  };
  renderWithI18n(<Composer {...props} />);
  return props;
}

describe("Composer 空会话灵感卡", () => {
  it("渲染 presets 卡；点击填入草稿并聚焦输入框，不触发发送", async () => {
    const props = renderComposer({ presets: agents[0].presets });
    expect(screen.getByText("试试这样描述：")).toBeTruthy();

    await userEvent.click(screen.getByText("给保温杯拍纯白主图"));
    expect(props.onChange).toHaveBeenCalledWith("给保温杯拍纯白主图");
    expect(props.onSend).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        (document.activeElement as HTMLTextAreaElement | null)?.getAttribute("aria-label"),
      ).toBe("消息输入"),
    );
  });

  it("无 presets 时不渲染灵感卡", () => {
    renderComposer();
    expect(screen.queryByText("试试这样描述：")).toBeNull();
  });
});

describe("Composer landing 变体（首页直发）", () => {
  it("无会话也可输入，空文本时发送禁用", () => {
    renderComposer({ hasSession: false, variant: "landing" });
    expect((screen.getByLabelText("消息输入") as HTMLTextAreaElement).disabled).toBe(false);
    expect((screen.getByLabelText("发送") as HTMLButtonElement).disabled).toBe(true);
  });

  it("输入文本后 Enter 发送、按钮发送", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const props = {
      agents,
      agentId: "a1",
      onAgentChange: vi.fn(),
      value: "",
      onChange: vi.fn(),
      onSend,
      busy: false,
      hasSession: false,
      variant: "landing",
    } as const;
    const { rerender } = renderWithI18n(<Composer {...props} value="" />);
    const textarea = screen.getByLabelText("消息输入");
    await user.type(textarea, "画一张秋天树林");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledTimes(1);
    rerender(<Composer {...props} value="画一张秋天树林" />);
    await user.click(screen.getByLabelText("发送"));
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("busy 时输入与发送均禁用", () => {
    renderComposer({ busy: true, hasSession: false, value: "x", variant: "landing" });
    expect((screen.getByLabelText("消息输入") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByLabelText("发送") as HTMLButtonElement).disabled).toBe(true);
  });

  it("待传附件 chip 渲染并可移除", async () => {
    const user = userEvent.setup();
    const onRemovePendingFile = vi.fn();
    renderComposer({
      hasSession: false,
      onRemovePendingFile,
      pendingFiles: [
        { id: "f1", name: "a.png" },
        { id: "f2", name: "b.png" },
      ],
      variant: "landing",
    });
    expect(screen.getByTestId("composer-pending-files")).toBeTruthy();
    expect(screen.getByText("附件：a.png")).toBeTruthy();
    await user.click(screen.getByLabelText("移除附件 a.png"));
    expect(onRemovePendingFile).toHaveBeenCalledWith("f1");
  });

  it("landing 下附件钮文案为「添加附件」", () => {
    renderComposer({ hasSession: false, onAttach: vi.fn(), variant: "landing" });
    expect(screen.getByLabelText("添加附件")).toBeTruthy();
  });
});

describe("Composer default 变体（既有行为不回归）", () => {
  it("无会话时输入禁用且提示先创建会话", () => {
    renderComposer({ hasSession: false });
    expect((screen.getByLabelText("消息输入") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByPlaceholderText("先创建会话")).toBeTruthy();
  });

  it("有会话空文本时发送禁用", () => {
    renderComposer();
    expect((screen.getByLabelText("发送") as HTMLButtonElement).disabled).toBe(true);
  });
});
