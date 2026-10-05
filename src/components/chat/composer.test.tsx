// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  render(<Composer {...props} />);
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
