// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import { MessageList } from "./message-list";
import type { UIMessage } from "@/types/chat";

// jsdom 未实现 Element.scrollTo（message-list 自动滚底 effect 使用）
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function optionsMessage(): UIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "text", text: "请选择海报用途" },
      {
        type: "options",
        question: "海报主要用在哪里？",
        options: [
          { label: "促销主图" },
          { label: "上新海报", description: "新品上架推广" },
        ],
      },
    ],
  };
}

describe("MessageList 选项卡（present_options）", () => {
  it("渲染问题与候选选项按钮，description 作为补充说明", () => {
    renderWithI18n(
      <MessageList messages={[optionsMessage()]} onPickOption={vi.fn()} />,
    );
    expect(screen.getByTestId("options-card")).toBeTruthy();
    expect(screen.getByText("海报主要用在哪里？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "促销主图" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /上新海报/ })).toBeTruthy();
    expect(screen.getByText("新品上架推广")).toBeTruthy();
  });

  it("点击选项触发 onPickOption（label 原样上抛），不触发其他回调", async () => {
    const onPickOption = vi.fn();
    renderWithI18n(
      <MessageList messages={[optionsMessage()]} onPickOption={onPickOption} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "促销主图" }));
    expect(onPickOption).toHaveBeenCalledTimes(1);
    expect(onPickOption).toHaveBeenCalledWith("促销主图");
  });

  it("busy 中选项按钮禁用，点击不上抛", async () => {
    const onPickOption = vi.fn();
    renderWithI18n(
      <MessageList busy messages={[optionsMessage()]} onPickOption={onPickOption} />,
    );
    const button = screen.getByRole("button", { name: "促销主图" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.click(button);
    expect(onPickOption).not.toHaveBeenCalled();
  });

  it("无 onPickOption 回调时按钮禁用（纯展示兜底）", () => {
    renderWithI18n(<MessageList messages={[optionsMessage()]} />);
    expect(
      (screen.getByRole("button", { name: "促销主图" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
