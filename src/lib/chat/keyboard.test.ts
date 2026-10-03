import { shouldSendOnEnter } from "@/lib/chat/keyboard";
import { describe, expect, it } from "vitest";

describe("shouldSendOnEnter（composer 键盘行为）", () => {
  it("Enter 发送；Shift+Enter 换行不发送", () => {
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
  });

  it("非 Enter 键不发送", () => {
    expect(shouldSendOnEnter({ key: "a", shiftKey: false })).toBe(false);
    expect(shouldSendOnEnter({ key: "Escape", shiftKey: false })).toBe(false);
  });

  it("IME 组合期间不发送（原生 isComposing 与本地标记任一命中）", () => {
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(shouldSendOnEnter({ key: "Enter", shiftKey: false, composing: true })).toBe(false);
    expect(
      shouldSendOnEnter({ key: "Enter", shiftKey: false, isComposing: true, composing: true }),
    ).toBe(false);
  });

  it("组合结束后恢复发送", () => {
    expect(
      shouldSendOnEnter({ key: "Enter", shiftKey: false, isComposing: false, composing: false }),
    ).toBe(true);
  });
});
