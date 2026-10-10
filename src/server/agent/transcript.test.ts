import { describe, expect, it } from "vitest";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import {
  buildReplayHistory,
  isSerializedTranscript,
  sanitizeTranscript,
  toUIMessage,
} from "./transcript";
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

  it("user 图片附件替换为引用占位文本（无引用线索时无 assetId）", () => {
    const out = sanitizeTranscript([makeUserWithImage()]);
    const [user] = out.messages as UserMessage[];
    expect(user.content).toEqual([
      { type: "text", text: "看看这张图" },
      { type: "text", text: "[图片附件: (无引用信息)]" },
    ]);
  });

  it("user 图片附件带引用扩展字段时留存 assetId 与 url（引用线索不丢失）", () => {
    const out = sanitizeTranscript([
      {
        role: "user",
        content: [
          { type: "text", text: "看看这张图" },
          {
            type: "image",
            data: BIG_BASE64,
            mimeType: "image/png",
            assetId: "a1",
            url: "/files/assets/x.png",
          },
        ],
        timestamp: 0,
      } as UserMessage,
    ]);
    const [user] = out.messages as UserMessage[];
    expect(user.content).toEqual([
      { type: "text", text: "看看这张图" },
      { type: "text", text: "[图片附件: /files/assets/x.png (assetId: a1)]" },
    ]);
    expect(JSON.stringify(out)).not.toContain("iVBORw0KGgo");
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

describe("buildReplayHistory（读取侧重建）", () => {
  const userMsg = (text: string): Message => ({ role: "user", content: text, timestamp: 1 });

  function row(id: string, messages: Message[]) {
    return { id, transcript: { v: 1, messages } };
  }

  it("按行序拼接 transcript", () => {
    const rows = [row("m1", [userMsg("a")]), row("m2", [userMsg("b")])];
    expect(buildReplayHistory(rows).map((m) => m.content)).toEqual(["a", "b"]);
  });

  it("排除本轮行；跳过无 transcript 与非法版本的行", () => {
    const rows = [
      row("m1", [userMsg("a")]),
      { id: "mu1", transcript: { v: 1, messages: [userMsg("本轮")] } },
      { id: "m3" },
      { id: "m4", transcript: { v: 99, messages: [userMsg("未来版本")] } },
    ];
    expect(buildReplayHistory(rows, "mu1").map((m) => m.content)).toEqual(["a"]);
  });

  it("maxMessages 硬上限：从最新往旧截取，对齐行边界（不拆行内消息组）", () => {
    // 三行：行内分别 1 / 39 / 1 条消息，上限 40 → 保留最新的两行（1+39），
    // 最老的一行整行丢弃（哪怕只差 1 条）
    const rows = [
      row("m1", [userMsg("oldest")]),
      row("m2", Array.from({ length: 39 }, (_, i) => userMsg(`mid${i}`))),
      row("m3", [userMsg("newest")]),
    ];
    const history = buildReplayHistory(rows, undefined, 40);
    expect(history).toHaveLength(40);
    expect(history.map((m) => m.content)).toContain("newest");
    expect(history.map((m) => m.content)).not.toContain("oldest");
  });

  it("不指定 maxMessages 时全量回放", () => {
    const rows = [row("m1", [userMsg("a")]), row("m2", [userMsg("b")])];
    expect(buildReplayHistory(rows)).toHaveLength(2);
  });

  it("单行自身超限时仍整行保留（宁超不缺，避免空历史退化）", () => {
    const rows = [row("m1", Array.from({ length: 50 }, (_, i) => userMsg(`m${i}`)))];
    const history = buildReplayHistory(rows, undefined, 40);
    expect(history).toHaveLength(50);
  });

  it("排除本轮行与连续 user 行组合", () => {
    const rows = [
      row("m1", [userMsg("失败前问句1")]),
      row("m2", [userMsg("失败前问句2")]),
      { id: "mu1", transcript: { v: 1, messages: [userMsg("本轮")] } },
    ];
    const history = buildReplayHistory(rows, "mu1", 40);
    expect(history.map((m) => m.content)).toEqual(["失败前问句1", "失败前问句2"]);
  });
});
