import { beforeEach, describe, expect, it, vi } from "vitest";

// 用脚本化 Agent 验证 runtime 桥接逻辑（事件→SSE 映射 + 回合级持久化），
// 不依赖真实 LLM：Agent 被 mock 为按脚本派发 AgentEvent，state.messages 由测试注入。
const h = vi.hoisted(() => ({
  scripted: [] as Record<string, unknown>[],
  stateMessages: [] as unknown[],
  capturedInitialState: undefined as Record<string, unknown> | undefined,
  session: null as { summary: string | null; summarizedUpTo: string | null } | null,
  completeSimple: vi.fn(),
  updateSummary: vi.fn(async () => ({})),
  // 中断测试用闸门：非空时 prompt 在每个事件派发前等待，测试可在此窗口触发 abort
  gate: null as Promise<void> | null,
}));

vi.mock("@/server/db/session.repo", () => ({
  createSessionRepo: () => ({
    get: vi.fn(async () => h.session),
    updateSummary: h.updateSummary,
  }),
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    private cb: (e: unknown) => void = () => {};
    private abortRequested = false;
    state: { messages: unknown[] } = { messages: [] };
    constructor(opts: {
      initialState?: { messages?: unknown[] };
    }) {
      h.capturedInitialState = opts as Record<string, unknown>;
      // 贴近真实 Agent：构造时 initialState.messages 成为 state 起始内容
      this.state = { messages: [...(opts.initialState?.messages ?? [])] };
    }
    subscribe(cb: (e: unknown) => void) {
      this.cb = cb;
    }
    // 贴近真实 Agent.abort()（探针结论）：中断后循环截断，state 留下
    // stopReason="aborted" 的部分 assistant 消息，prompt 正常返回
    abort() {
      this.abortRequested = true;
    }
    async prompt() {
      // 贴近真实 Agent：prompt 将本轮消息追加到历史之后（不整体替换）
      this.state = { messages: [...this.state.messages, ...h.stateMessages] };
      for (const ev of h.scripted) {
        if (this.abortRequested) break;
        this.cb(ev);
        // 让出微任务 + 闸门（非空时挂起）：测试可在事件间触发 abort
        await new Promise((r) => setTimeout(r, 0));
        if (h.gate) await h.gate;
      }
      if (this.abortRequested) {
        // 探针结论：真实库中断后仍以 agent_end 收尾，state 留部分 assistant 消息。
        // 注入式用例（h.stateMessages 非空）已自带中断消息，不再重复合成
        if (h.stateMessages.length === 0) {
          this.state.messages.push({
            role: "assistant",
            stopReason: "aborted",
            content: [{ type: "text", text: "部分回答" }],
            timestamp: Date.now(),
          });
        }
        this.cb({ type: "agent_end" });
      }
    }
  },
}));

vi.mock("@/server/infra/providers/llm", () => ({
  // 模拟装配层：Agent 声明 vision 而装配结果不满足时抛配置错误（ModelConfigError 语义）
  getChatModelForRole: (
    role: string,
    declaration?: { main?: { capabilities?: string[] } },
  ) => {
    if (role === "main" && declaration?.main?.capabilities?.includes("vision")) {
      throw new Error("供应商 fixture 的模型 m 缺少所需能力：vision");
    }
    return { id: "test", role } as never;
  },
  getChatModels: () =>
    ({ streamSimple: async function* () {}, completeSimple: h.completeSimple }) as never,
}));

import { runAgent } from "./runtime";
import { agentRegistry, defineAgent } from "./registry";
import type { MessageRepo } from "@/server/db/message.repo";

interface ToolEndDetails {
  assetId?: string;
  error?: string;
}

function makeRepo(listResult: Record<string, unknown>[] = []) {
  const calls: Record<string, unknown>[] = [];
  const create = vi.fn(async (input: Record<string, unknown>) => {
    calls.push(input);
    return { ...input, id: `m${calls.length}` };
  });
  const repo = {
    create,
    list: vi.fn(async () => listResult),
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
      icon: "🧪",
      presets: [],
      tools: ["generate_image"],
      systemPrompt: "x",
    }),
  );
  await runAgent({
    sessionId: "s1",
    userId: "u1",
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
    h.session = null;
    h.gate = null;
    h.completeSimple.mockReset();
    h.updateSummary.mockClear();
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
      expect.objectContaining({ role: "assistant", content: "你好", toolCalls: undefined, userId: "u1" }),
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
    const firstCall = (persisted.toolCalls as { assetId: string; type?: string }[])[0];
    expect(firstCall.assetId).toBe("a1");
    // toolCalls 必须带工具名 type：toUIMessage 按 type 识别图片 part，缺失则刷新后图片丢失
    expect(firstCall.type).toBe("generate_image");
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

  it("含思考回合：thinking 三段事件按序桥接（id=contentIndex），落库 transcript 仍无 thinking", async () => {
    const { repo, create } = makeRepo();
    h.stateMessages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "secret reasoning LEAKMARK" },
          { type: "text", text: "回答" },
        ],
        api: "openai-completions",
        provider: "test",
        model: "m",
        stopReason: "stop",
        timestamp: 1,
      },
    ];
    const events = await run(
      [
        { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
        { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "思考中" } },
        { type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "思考中" } },
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "回答" } },
        { type: "agent_end" },
      ],
      repo as never,
    );
    expect(events.map((e) => e.type)).toEqual([
      "thinking_start",
      "thinking_delta",
      "thinking_end",
      "message_delta",
      "finish",
    ]);
    expect((events[0] as { id: string }).id).toBe("0");
    expect((events[1] as { text: string }).text).toBe("思考中");
    // 桥接不改变持久化清洗：thinking 不出现在落库 transcript
    const persisted = create.mock.calls[0][0] as { transcript?: unknown };
    expect(JSON.stringify(persisted.transcript)).not.toContain("LEAKMARK");
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

  it("历史重建：transcript 拼接后注入 initialState.messages（场景 1）", async () => {
    const { repo } = makeRepo([
      {
        id: "m1",
        transcript: { v: 1, messages: [{ role: "user", content: "做张海报", timestamp: 1 }] },
      },
      {
        id: "m2",
        transcript: {
          v: 1,
          messages: [
            { role: "assistant", content: [{ type: "text", text: "好的" }], timestamp: 2 },
            {
              role: "toolResult",
              toolCallId: "c1",
              toolName: "generate_image",
              content: [{ type: "text", text: "[已生成图片: /files/x.png]" }],
              isError: false,
              timestamp: 3,
            },
          ],
        },
      },
    ]);
    await run([{ type: "agent_end" }], repo as never);
    const initial = (h.capturedInitialState?.initialState ?? {}) as {
      messages: { role: string }[];
      systemPrompt: string;
    };
    expect(initial.systemPrompt).toBe("x");
    expect(initial.messages.map((m) => m.role)).toEqual(["user", "assistant", "toolResult"]);
  });

  it("本轮排除：userMessageId 对应行不进入回放历史（场景 2，不重复注入）", async () => {
    const { repo } = makeRepo([
      { id: "m1", transcript: { v: 1, messages: [{ role: "user", content: "第一轮", timestamp: 1 }] } },
      // 本轮 user 行（route.ts 刚落库）
      { id: "mu1", transcript: { v: 1, messages: [{ role: "user", content: "hi", timestamp: 9 }] } },
    ]);
    await run([{ type: "agent_end" }], repo as never);
    const initial = (h.capturedInitialState?.initialState ?? {}) as {
      messages: { role: string; content: unknown }[];
    };
    expect(initial.messages).toHaveLength(1);
    expect(initial.messages[0]).toMatchObject({ role: "user", content: "第一轮" });
  });

  it("坏数据容错：无 transcript 行与非法版本行跳过；连续 user 行不抛错", async () => {    const { repo } = makeRepo([
      { id: "m1" }, // 旧数据：无 transcript
      { id: "m2", transcript: { v: 99, messages: [] } }, // 未来版本：跳过
      { id: "m3", transcript: { v: 1, messages: [{ role: "user", content: "第一句", timestamp: 1 }] } },
      { id: "m4", transcript: { v: 1, messages: [{ role: "user", content: "第二句", timestamp: 2 }] } },
    ]);
    await run([{ type: "agent_end" }], repo as never);
    const initial = (h.capturedInitialState?.initialState ?? {}) as {
      messages: { role: string; content: string }[];
    };
    expect(initial.messages.map((m) => m.content)).toEqual(["第一句", "第二句"]);
  });

  it("回放历史非空时，落库 transcript 只含本轮增量（baseline 隔离历史）", async () => {
    const { repo, create } = makeRepo([
      { id: "m1", transcript: { v: 1, messages: [{ role: "user", content: "历史轮", timestamp: 1 }] } },
      {
        id: "m2",
        transcript: {
          v: 1,
          messages: [{ role: "assistant", content: [{ type: "text", text: "历史回复" }], timestamp: 2 }],
        },
      },
    ]);
    h.stateMessages = [
      { role: "user", content: "本轮输入", timestamp: 9 },
      {
        role: "assistant",
        content: [{ type: "text", text: "本轮回复" }],
        api: "openai-completions",
        provider: "test",
        model: "m",
        stopReason: "stop",
        timestamp: 10,
      },
    ];
    await run(
      [
        { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "本轮回复" } },
        { type: "agent_end" },
      ],
      repo as never,
    );
    const persisted = create.mock.calls[0][0] as {
      transcript: { messages: { role: string; content: unknown }[] };
    };
    // 只含本轮 assistant（user 属于 user 行；历史 assistant 不重复落库）
    expect(persisted.transcript.messages).toHaveLength(1);
    expect(persisted.transcript.messages[0].role).toBe("assistant");
  });

  it("compact 集成：摘要作为前缀注入，水位线前的行不再回放", async () => {
    h.session = { summary: "此前轮次摘要内容", summarizedUpTo: "m1" };
    const { repo } = makeRepo([
      { id: "m1", transcript: { v: 1, messages: [{ role: "user", content: "被摘要的历史", timestamp: 1 }] } },
      { id: "m2", transcript: { v: 1, messages: [{ role: "user", content: "近期原文", timestamp: 2 }] } },
    ]);
    await run([{ type: "agent_end" }], repo as never);
    const initial = (h.capturedInitialState?.initialState ?? {}) as {
      messages: { role: string; content: unknown }[];
    };
    expect(initial.messages).toHaveLength(2);
    const [prefix, firstReplay] = initial.messages;
    expect(JSON.stringify(prefix.content)).toContain("<会话摘要>");
    expect(JSON.stringify(prefix.content)).toContain("此前轮次摘要内容");
    expect(JSON.stringify(firstReplay.content)).toContain("近期原文");
    // 水位线前的内容不再进入回放
    expect(JSON.stringify(initial.messages)).not.toContain("被摘要的历史");
  });

  it("无摘要/无水位线时回放全部行（等价于 compact 未生效路径）", async () => {
    h.session = null;
    const { repo } = makeRepo([
      { id: "m1", transcript: { v: 1, messages: [{ role: "user", content: "a", timestamp: 1 }] } },
    ]);
    await run([{ type: "agent_end" }], repo as never);
    const initial = (h.capturedInitialState?.initialState ?? {}) as {
      messages: { role: string; content: unknown }[];
    };
    expect(initial.messages).toHaveLength(1);
    expect(JSON.stringify(initial.messages[0].content)).toContain("a");
  });

  it("compact 触发：调用摘要 LLM 并落库新摘要与水位线，前缀生效", async () => {
    h.completeSimple.mockResolvedValue({
      stopReason: "stop",
      content: [{ type: "text", text: "新摘要内容" }],
    });
    const { repo } = makeRepo([
      { id: "m1", transcript: { v: 1, messages: [{ role: "user", content: "字".repeat(46_500), timestamp: 1 }] } },
      { id: "m2", transcript: { v: 1, messages: [{ role: "user", content: "近期原文", timestamp: 2 }] } },
    ]);
    await run([{ type: "agent_end" }], repo as never);
    expect(h.completeSimple).toHaveBeenCalledTimes(1);
    expect(h.updateSummary).toHaveBeenCalledWith("s1", {
      summary: "新摘要内容",
      summarizedUpTo: "m1",
    });
    const initial = (h.capturedInitialState?.initialState ?? {}) as {
      messages: { role: string; content: unknown }[];
    };
    expect(JSON.stringify(initial.messages[0].content)).toContain("新摘要内容");
    expect(JSON.stringify(initial.messages[1].content)).toContain("近期原文");
  });

  it("compact 失败降级：stopReason error 时回合照常完成，按现有摘要/水位线回放", async () => {
    h.completeSimple.mockResolvedValue({
      stopReason: "error",
      errorMessage: "LLM down",
      content: [],
    });
    h.session = { summary: "旧摘要", summarizedUpTo: "m1" };
    const { repo } = makeRepo([
      { id: "m1", transcript: { v: 1, messages: [{ role: "user", content: "字".repeat(46_500), timestamp: 1 }] } },
      { id: "m2", transcript: { v: 1, messages: [{ role: "user", content: "近期原文", timestamp: 2 }] } },
    ]);
    const events = await run([{ type: "agent_end" }], repo as never);
    // 回合未被 compact 失败中断
    expect(events.some((e) => e.type === "finish")).toBe(true);
    // 摘要未落库更新
    expect(h.updateSummary).not.toHaveBeenCalled();
    // 按现有摘要/水位线回放
    const initial = (h.capturedInitialState?.initialState ?? {}) as {
      messages: { role: string; content: unknown }[];
    };
    expect(JSON.stringify(initial.messages[0].content)).toContain("旧摘要");
    expect(JSON.stringify(initial.messages)).toContain("近期原文");
  });

  it("中断：abort 后停止累积，部分文本落库（无结果工具不落 toolCalls）", async () => {
    const { repo, create } = makeRepo();
    h.scripted = [
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "部分回答" } },
      {
        type: "tool_execution_start",
        toolCallId: "c9",
        toolName: "generate_image",
        args: { prompt: "x" },
      },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "不应累积" } },
      { type: "agent_end" },
    ];
    let release!: () => void;
    h.gate = new Promise<void>((r) => (release = r));
    const ac = new AbortController();
    const events: Record<string, unknown>[] = [];
    const p = runAgent({
      sessionId: "s1",
      userId: "u1",
      agentId: "test-agent",
      userText: "hi",
      userMessageId: "mu1",
      signal: ac.signal,
      onEvent: (e: Record<string, unknown>) => events.push(e),
      repos: { message: repo as never },
    });
    // 等首个 delta 事件送达后，在闸门窗口内触发中断
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "message_delta")).toBe(true);
    });
    ac.abort();
    release();
    await p;
    h.gate = null;
    // finish 如实标记 aborted；中断点之后的 delta 不再累积
    expect(events[events.length - 1]).toMatchObject({ type: "finish", stopReason: "aborted" });
    expect(JSON.stringify(events)).not.toContain("不应累积");
    // 部分落库：已生成文本入库，无结果 tool-start 不产生 toolCalls
    const persisted = create.mock.calls[0][0] as {
      content: string;
      toolCalls?: unknown;
      transcript: { messages: { role: string; stopReason?: string }[] };
    };
    expect(persisted.content).toBe("部分回答");
    expect(persisted.toolCalls).toBeUndefined();
    expect(persisted.transcript.messages.at(-1)?.stopReason).toBe("aborted");
  });

  it("中断于工具执行中：transcript 保留带 toolCall 的 assistant 消息（无对应 toolResult）", async () => {
    const { repo, create } = makeRepo();
    h.stateMessages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "我来生成" },
          { type: "toolCall", id: "c8", name: "generate_image", arguments: { prompt: "x" } },
        ],
        api: "openai-completions",
        provider: "test",
        model: "m",
        stopReason: "aborted",
        timestamp: 5,
      },
    ];
    h.scripted = [
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "我来生成" } },
      {
        type: "tool_execution_start",
        toolCallId: "c8",
        toolName: "generate_image",
        args: { prompt: "x" },
      },
      { type: "agent_end" },
    ];
    let release!: () => void;
    h.gate = new Promise<void>((r) => (release = r));
    const ac = new AbortController();
    const p = runAgent({
      sessionId: "s1",
      userId: "u1",
      agentId: "test-agent",
      userText: "hi",
      userMessageId: "mu1",
      signal: ac.signal,
      onEvent: () => {},
      repos: { message: repo as never },
    });
    // 等待 runtime 完成异步准备并派发首个事件（prompt 已挂起在闸门）
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    release();
    await p;
    h.gate = null;
    const persisted = create.mock.calls[0][0] as {
      transcript: { messages: { role: string; content: { type: string }[] }[] };
    };
    expect(persisted.transcript.messages.map((m) => m.role)).toEqual(["assistant"]);
    expect(persisted.transcript.messages[0].content.map((c) => c.type)).toEqual(["text", "toolCall"]);
  });

  it("下游容忍：被中断回合的 toolCall 无 toolResult，下一轮回放不抛错且原样保留", async () => {
    const { repo } = makeRepo([
      {
        id: "m1",
        transcript: {
          v: 1,
          messages: [
            {
              role: "assistant",
              content: [
                { type: "text", text: "生成中" },
                { type: "toolCall", id: "c7", name: "generate_image", arguments: { prompt: "被中断" } },
              ],
              api: "openai-completions",
              provider: "test",
              model: "m",
              stopReason: "aborted",
              timestamp: 1,
            },
            // 注意：没有对应 toolResult 行（中断遗留的不完整回合）
          ],
        },
      },
    ]);
    await run([{ type: "agent_end" }], repo as never);
    const initial = (h.capturedInitialState?.initialState ?? {}) as {
      messages: { role: string; content: { type: string }[] }[];
    };
    expect(initial.messages).toHaveLength(1);
    expect(initial.messages[0].role).toBe("assistant");
    expect(initial.messages[0].content.map((c) => c.type)).toEqual(["text", "toolCall"]);
  });

  it("装配错误可见：能力声明不满足时 SSE error 事件回喂，回合不执行", async () => {
    agentRegistry.register(
      defineAgent({
        id: "vision-unmet",
        name: "测试",
        description: "test",
        icon: "🧪",
        presets: [],
        tools: [],
        systemPrompt: "x",
        models: { main: { capabilities: ["vision"] } },
      }),
    );
    const { repo, create } = makeRepo();
    const events: Record<string, unknown>[] = [];
    await runAgent({
      sessionId: "s1",
      userId: "u1",
      agentId: "vision-unmet",
      userText: "hi",
      userMessageId: "mu1",
      signal: new AbortController().signal,
      onEvent: (e: Record<string, unknown>) => events.push(e),
      repos: { message: repo as never },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error" });
    expect(events[0].message).toContain("vision");
    // 回合未执行：无落库
    expect(create).not.toHaveBeenCalled();
  });
});
