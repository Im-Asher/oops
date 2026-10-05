// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanelHeader } from "./chat-panel-header";

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function renderHeader(overrides: Partial<Parameters<typeof ChatPanelHeader>[0]> = {}) {
  const props = {
    agentIcon: "📸",
    agentName: "产品摄影师",
    sessionTitle: "保温杯主图",
    canRename: true,
    onRename: vi.fn(),
    onCollapse: vi.fn(),
    ...overrides,
  };
  render(<ChatPanelHeader {...props} />);
  return props;
}

describe("ChatPanelHeader 任务化头部", () => {
  it("渲染 Agent 头像、名称与会话标题 + AI 徽章", () => {
    renderHeader();
    expect(screen.getByText("产品摄影师")).toBeTruthy();
    expect(screen.getByText("保温杯主图")).toBeTruthy();
    expect(screen.getByText("AI")).toBeTruthy();
  });

  it("点击收起按钮触发 onCollapse", async () => {
    const props = renderHeader();
    await userEvent.click(screen.getByRole("button", { name: "收起聊天面板" }));
    expect(props.onCollapse).toHaveBeenCalledTimes(1);
  });

  it("重命名：铅笔进入行内编辑，Enter 提交修剪后的标题", async () => {
    const props = renderHeader();
    await userEvent.click(screen.getByRole("button", { name: "重命名会话" }));
    const input = screen.getByLabelText("会话标题") as HTMLInputElement;
    expect(input.value).toBe("保温杯主图");
    await userEvent.clear(input);
    await userEvent.type(input, "  新标题  ");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRename).toHaveBeenCalledWith("新标题");
  });

  it("重命名：Escape 取消编辑且不回调；空标题不回调", async () => {
    const props = renderHeader();
    await userEvent.click(screen.getByRole("button", { name: "重命名会话" }));
    const input = screen.getByLabelText("会话标题");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("会话标题")).toBeNull();
    expect(props.onRename).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "重命名会话" }));
    const input2 = screen.getByLabelText("会话标题") as HTMLInputElement;
    await userEvent.clear(input2);
    fireEvent.keyDown(input2, { key: "Enter" });
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("无会话时重命名禁用；未接下拉时时钟禁用", () => {
    renderHeader({ canRename: false, sessionTitle: undefined, onOpenHistory: undefined });
    expect(
      (screen.getByRole("button", { name: "重命名会话" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "会话历史" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("接入时钟下拉回调后可点击触发 onOpenHistory", async () => {
    const onOpenHistory = vi.fn();
    renderHeader({ onOpenHistory });
    await userEvent.click(screen.getByRole("button", { name: "会话历史" }));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });
});
