// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Message, MessageContent } from "./message";

describe("Message/MessageContent 形态", () => {
  it("assistant 分支为卡片：zinc 底色 + 边框圆角；user 分支保持气泡不动", () => {
    const { rerender } = render(
      <Message from="assistant">
        <MessageContent data-testid="content">你好</MessageContent>
      </Message>,
    );
    const assistantContent = screen.getByTestId("content");
    expect(assistantContent.textContent).toBe("你好");
    expect(assistantContent?.className).toContain("group-[.is-assistant]:bg-zinc-900/60");
    expect(assistantContent?.className).toContain("group-[.is-assistant]:border-zinc-800");
    expect(assistantContent?.className).toContain("group-[.is-assistant]:rounded-lg");

    rerender(
      <Message from="user">
        <MessageContent>我要一张主图</MessageContent>
      </Message>,
    );
    expect(screen.getByText("我要一张主图").className).toContain(
      "group-[.is-user]:bg-secondary",
    );
  });
});
