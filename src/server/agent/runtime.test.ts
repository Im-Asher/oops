import { beforeEach, describe, expect, it, vi } from "vitest";

// 用脚本化 Agent 验证 runtime 桥接逻辑（事件→SSE 映射 + 回合级持久化），
// 不依赖真实 LLM：Agent 被 mock 为按脚本派发 AgentEvent，state.messages 由测试注入。
const h = vi.hoisted(() => ({
  scripted: [] as Record<string, unknown>[],
  stateMessages: [] as unknown[],
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    private cb: (e: unknown) => void = () => {};
    state: { messages: unknown[] } = { messages: [] };
    subscribe(cb: (e: unknown) => void) {
      this.cb = cb;
    }
    async prompt() {
      this.state = { messages: [...h.stateMessages] };
      for (const ev of h.scripted) this.cb(ev);
    }
  },
}));

vi.mock("@/server/infra/providers/llm", () => ({
  getChatModel: () => ({ id: "test" }) as never,
  getChatModels: () => ({ streamSimple: async function* () {} }) as never,
}));

import { runAgent } from "./runtime";
import { agentRegistry, defineAgent } from "./agents/registry";
import type { MessageRepo } from "@/server/db/message.repo";

interface ToolEndDetails {
  assetId?: string;
  error?: string;
}

function makeRepo() {
  const calls: Record<string, unknown>[] = [];
  const create = vi.fn(async (input: Record<string, unknown>) => {
    calls.push(input);
    return { ...input, id: `m${calls.length}` };
  });
  const repo = {
    create,
    list: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
  } as unknown as MessageRepo;
  return { calls, create, repo };
}

async function run(script: Record<string, unknown>[], repo: MessageRepo, agentId = "test-agent") {
  h.scripted = script;
  const events: Record<string, unknown>[] = [];
  agentRegistry.register(
    defineAgent({
      id: agentId,
      name: "test",
      description: "test",
      tools: ["generate_image"],
      systemPrompt: "x",
    }),
  );
  await runAgent({
    sessionId: "s1",
    agentId,
    userText: "hi",
    userMessageId: "mu1",
    signal: new AbortController().signal,
    onEvent: (e: Record<string, unknown>) => events.push(e),
    repos: { message: repo },
  });
  return events;
}

describe("runAgent (runtime bridge)", () => {
  beforeEach(() => {
    h.stateMessages = [];
  });

  it("纯文字回复：message_delta + finish，并落库 assistant 文本", async () => {
    const { repo, create } = makeRepo();
    const events = await run(
      [
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "你好" } },
        { type: "agent_end" },
      ],
      repo as never,
    );
    expect(events.map((e) => e.type)).toEqual(["message_delta", "finish"]);
    expect(events[0].text).toBe("你好");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ role: "assistant", content: "你好", toolCalls: undefined }),
    );
  });

  it("带工具调用：tool_start / tool_end(含 details) / finish，且 toolCalls 落库", async () => {
    const { repo, create } = makeRepo();
    const events = await run(
      [
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "生成中" } },
        {
          type: "tool_execution_start",
          toolCallId: "c1",
          toolName: "generate_image",
          args: { prompt: "苹果" },
        },
        {
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "generate_image",
          result: {
            content: [{ type: "image", data: "x", mimeType: "image/png" }],
            details: { assetId: "a1", url: "/files/x.png" },
          },
        },
        { type: "agent_end" },
      ],
      repo as never,
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_start");
    expect(types).toContain("tool_end");
    expect(types[types.length - 1]).toBe("finish");
    const te = events.find((e) => e.type === "tool_end") as { details: ToolEndDetails };
    expect(te.details.assetId).toBe("a1");
    const persisted = create.mock.calls[0][0] as Record<string, unknown>;
    expect((persisted.toolCalls as { assetId: string }[])[0].assetId).toBe("a1");
  });

  it("工具失败不崩会话：tool_end 带 error details，仍收到 finish，结果随 assistant 落库", async () => {
    const { repo, create } = makeRepo();
    const events = await run(
      [
        {
          type: "tool_execution_start",
          toolCallId: "c2",
          toolName: "generate_image",
          args: { prompt: "苹果" },
        },
        {
          type: "tool_execution_end",
          toolCallId: "c2",
          toolName: "generate_image",
          result: {
            content: [{ type: "text", text: "图像生成失败：审核拒绝" }],
            details: { error: "generation_failed", message: "content rejected" },
          },
        },
        { type: "agent_end" },
      ],
      repo as never,
    );
    expect(events[events.length - 1].type).toBe("finish");
    const te = events.find((e) => e.type === "tool_end") as { details: ToolEndDetails };
    expect(te.details.error).toBe("generation_failed");
    expect(create).toHaveBeenCalled();
  });

  it("assistant 行 transcript 含本轮 assistant 与 toolResult（无 thinking、无图片 base64、排除 system/user）", async () => {
    const { repo, create } = makeRepo();
    h.stateMessages = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hi", timestamp: 0 },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret reasoning LEAKMARK" },
          { type: "text", text: "生成中" },
          { type: "toolCall", id: "c1", name: "generate_image", arguments: { prompt: "苹果" } },
        ],
        api: "openai-completions",
        provider: "test",
        model: "m",
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "generate_image",
        content: [{ type: "image", data: "IMGDATA_LEAKMARK", mimeType: "image/png" }],
        details: { assetId: "a1", url: "/files/x.png" },
        isError: false,
        timestamp: 2,
      },
    ];
    await run(
      [
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "生成中" } },
        {
          type: "tool_execution_end",
          toolCallId: "c1",
          toolName: "generate_image",
          result: {
            content: [{ type: "image", data: "IMGDATA_LEAKMARK", mimeType: "image/png" }],
            details: { assetId: "a1", url: "/files/x.png" },
          },
        },
        { type: "agent_end" },
      ],
      repo as never,
    );
    const persisted = create.mock.calls[0][0] as {
      transcript: { v: number; messages: { role: string; content: { type: string }[] }[] };
    };
    expect(persisted.transcript.v).toBe(1);
    const roles = persisted.transcript.messages.map((m) => m.role);
    expect(roles).toEqual(["assistant", "toolResult"]); // user 消息不重复落库
    const serialized = JSON.stringify(persisted.transcript);
    expect(serialized).not.toContain("LEAKMARK"); // thinking 与 base64 均被清洗
    expect(persisted.transcript.messages[0].content.map((c) => c.type)).toEqual(["text", "toolCall"]);
  });

  it("多工具回合：transcript 保留全部 toolResult（toolCallId/toolName/details 不丢）", async () => {
    const { repo, create } = makeRepo();
    h.stateMessages = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "c1", name: "generate_image", arguments: { prompt: "a" } },
          { type: "toolCall", id: "c2", name: "generate_image", arguments: { prompt: "b" } },
        ],
        api: "openai-completions",
        provider: "test",
        model: "m",
        stopReason: "toolUse",
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "generate_image",
        content: [{ type: "text", text: "ok1" }],
        details: { assetId: "a1", url: "/files/1.png" },
        isError: false,
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "c2",
        toolName: "generate_image",
        content: [{ type: "text", text: "ok2" }],
        details: { assetId: "a2", url: "/files/2.png" },
        isError: false,
        timestamp: 3,
      },
    ];
    await run(
      [
        {
          type: "tool_execution_end",
          toolCallId: "c2",
          toolName: "generate_image",
          result: { content: [{ type: "text", text: "ok2" }], details: { assetId: "a2" } },
        },
        { type: "agent_end" },
      ],
      repo as never,
    );
    const persisted = create.mock.calls[0][0] as {
      transcript: { messages: { role: string; toolCallId?: string; details?: unknown }[] };
    };
    const toolResults = persisted.transcript.messages.filter((m) => m.role === "toolResult");
    expect(toolResults).toHaveLength(2);
    expect(toolResults.map((m) => m.toolCallId)).toEqual(["c1", "c2"]);
    expect(toolResults[1].details).toMatchObject({ assetId: "a2", url: "/files/2.png" });
  });
});
