import { describe, expect, it } from "vitest";
import { RenderError } from "@/server/infra/render/render-html";
import { renderTaskError } from "./handlers";
import { TaskError } from "@oops/domain/tasks/executor";

describe("renderTaskError", () => {
  it("unknown RenderError 的 cause 拼入 message（根因可落库排查）", () => {
    const cause = new Error("browserType.launch: Executable doesn't exist");
    const te = renderTaskError(new RenderError("unknown", "渲染失败", cause));
    expect(te).toBeInstanceOf(TaskError);
    expect(te.kind).toBe("unknown");
    expect(te.message).toBe("渲染失败：browserType.launch: Executable doesn't exist");
  });

  it("timeout / invalid_html 消息自解释，不改写", () => {
    expect(renderTaskError(new RenderError("timeout", "渲染超过 30000ms 未完成")).message).toBe(
      "渲染超过 30000ms 未完成",
    );
    expect(renderTaskError(new RenderError("invalid_html", "HTML 含 script 标签，拒绝渲染")).kind).toBe(
      "invalid_html",
    );
  });

  it("unknown 无 cause 时保持原 message", () => {
    expect(renderTaskError(new RenderError("unknown", "渲染失败")).message).toBe("渲染失败");
  });

  it("非 RenderError 异常也保留 message（原实现丢弃）", () => {
    expect(renderTaskError(new Error("signal aborted")).message).toBe("渲染失败：signal aborted");
  });

  it("超长 cause 截断到 300 字符，防内部堆栈全文进用户可见文案", () => {
    const te = renderTaskError(new RenderError("unknown", "渲染失败", new Error("x".repeat(500))));
    expect(te.message).toBe(`渲染失败：${"x".repeat(300)}…`);
  });
});
