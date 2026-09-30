import { describe, expect, it } from "vitest";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { isSerializedTranscript, sanitizeTranscript, toUIMessage } from "./transcript";
describe("toUIMessage", () => {
  it("纯文本消息重建为单文本 part", () => {
    const msg = toUIMessage("m1", "user", "你好", undefined);
    expect(msg).toEqual({ id: "m1", role: "user", parts: [{ type: "text", text: "你好" }] });
  });

  it("助手消息：文本 + 生图工具结果重建为图片 part（零转换，可直接渲染）", () => {
    const msg = toUIMessage("m2", "assistant", "已生成", [
      {
        type: "generate_image",
        url: "/files/assets/x.png",
        assetId: "a1",
        prompt: "苹果",
        model: "wan2.7-image",
        size: "1024*1024",
      },
    ]);
    expect(msg.parts).toContainEqual({
      type: "image",
      url: "/files/assets/x.png",
      assetId: "a1",
      prompt: "苹果",
      model: "wan2.7-image",
      size: "1024*1024",
    });
  });

  it("未声明的工具类型不产生额外 part", () => {
    const msg = toUIMessage("m3", "assistant", "完成", [{ type: "other", url: "/x" }]);
    expect(msg.parts).toEqual([{ type: "text", text: "完成" }]);
  });

  it("画布导出消息（edited_image）同样重建为图片 part，且 sourceAssetId 不影响渲染", () => {
    const msg = toUIMessage("m4", "assistant", "已导出为新图片", [
      {
        type: "edited_image",
        url: "/files/assets/y.png",
        assetId: "a2",
        sourceAssetId: "a0",
      },
    ]);
    expect(msg.parts).toContainEqual({
      type: "image",
      url: "/files/assets/y.png",
      assetId: "a2",
    });
    // sourceAssetId 不进入前端 part（聊天与画布不展示派生标识）。
    const imagePart = msg.parts.find((p) => p.type === "image");
    expect((imagePart as { sourceAssetId?: string }).sourceAssetId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LLM 视图写侧：sanitizeTranscript
// ---------------------------------------------------------------------------

const BIG_BASE64 = "iVBORw0KGgoAAAANSUhEUg==".repeat(64);

function makeAssistant(): AssistantMessage {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "内部推理过程 " + BIG_BASE64 },
      { type: "text", text: "好的，我来生成" },
      { type: "toolCall", id: "tc1", name: "generate_image", arguments: { prompt: "海边" } },
    ],
    api: "openai-completions",
    provider: "dashscope",
    model: "test-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 1,
  };
}

function makeToolResult(): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "tc1",
    toolName: "generate_image",
    content: [
      { type: "image", data: BIG_BASE64, mimeType: "image/png" },
      { type: "text", text: "已生成" },
    ],
    details: { assetId: "a1", url: "/files/assets/x.png", prompt: "海边" },
    isError: false,
    timestamp: 2,
  };
}

function makeUserWithImage(): UserMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: "看看这张图" },
      { type: "image", data: BIG_BASE64, mimeType: "image/png" },
    ],
    timestamp: 0,
  };
}

describe("sanitizeTranscript（写侧清洗）", () => {
  it("assistant 消息剥离 thinking 块，保留 text 与 toolCall", () => {
    const out = sanitizeTranscript([makeAssistant()]);
    const [assistant] = out.messages as AssistantMessage[];
    expect(assistant.content.map((c) => c.type)).toEqual(["text", "toolCall"]);
  });

  it("toolResult 图片替换为含 url/assetId 的文本占位", () => {
    const out = sanitizeTranscript([makeToolResult()]);
    const [tr] = out.messages as ToolResultMessage[];
    expect(tr.content).toEqual([
      { type: "text", text: "[已生成图片: /files/assets/x.png (assetId: a1)]" },
      { type: "text", text: "已生成" },
    ]);
  });

  it("user 图片附件替换为文本占位", () => {
    const out = sanitizeTranscript([makeUserWithImage()]);
    const [user] = out.messages as UserMessage[];
    expect(user.content).toEqual([
      { type: "text", text: "看看这张图" },
      { type: "text", text: "[图片附件]" },
    ]);
  });

  it("输出带 v:1 版本标记，isSerializedTranscript 校验通过", () => {
    const out = sanitizeTranscript([makeAssistant(), makeToolResult()]);
    expect(out.v).toBe(1);
    expect(isSerializedTranscript(out)).toBe(true);
    expect(isSerializedTranscript({ v: 2, messages: [] })).toBe(false);
    expect(isSerializedTranscript(null)).toBe(false);
    expect(isSerializedTranscript({ v: 1 })).toBe(false);
  });

  it("任意输出不含 base64 图片数据（清洗不漏）", () => {
    const messages: Message[] = [makeUserWithImage(), makeAssistant(), makeToolResult()];
    const serialized = JSON.stringify(sanitizeTranscript(messages));
    expect(serialized).not.toContain("iVBORw0KGgo");
  });

  it("深拷贝：清洗不改动输入对象", () => {
    const input = [makeAssistant()];
    sanitizeTranscript(input);
    expect((input[0] as AssistantMessage).content.map((c) => c.type)).toEqual([
      "thinking",
      "text",
      "toolCall",
    ]);
  });

  it("user string content 原样透传（不走数组分支）", () => {
    const out = sanitizeTranscript([
      { role: "user", content: "纯文本输入", timestamp: 0 } as UserMessage,
    ]);
    expect((out.messages[0] as UserMessage).content).toBe("纯文本输入");
  });

  it("toolResult 图片但 details 无 url/assetId 时回退为无引用占位", () => {
    const out = sanitizeTranscript([
      {
        role: "toolResult",
        toolCallId: "tc2",
        toolName: "generate_image",
        content: [{ type: "image", data: BIG_BASE64, mimeType: "image/png" }],
        isError: false,
        timestamp: 3,
      } as ToolResultMessage,
    ]);
    const [tr] = out.messages as ToolResultMessage[];
    expect(tr.content).toEqual([{ type: "text", text: "[已生成图片: (无引用信息)]" }]);
  });
});
