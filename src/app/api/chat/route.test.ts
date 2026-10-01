import { describe, expect, it, vi } from "vitest";

// 路由级测试：mock runtime / 仓储 / 初筛，验证 SSE 行为、敏感词拦截与会话校验，
// 不依赖真实 LLM 与数据库。
const h = vi.hoisted(() => ({
  events: [] as string[],
  sessionExists: true,
  runAgentCalls: 0,
  runAgentArgs: [] as Record<string, unknown>[],
  messageCreates: [] as Record<string, unknown>[],
}));

vi.mock("@/server/agent", () => ({ default: {} }));
vi.mock("@/server/agent/runtime", () => ({
  runAgent: vi.fn(async (args: { onEvent: (e: unknown) => void }) => {
    h.runAgentCalls += 1;
    h.runAgentArgs.push(args as Record<string, unknown>);
    for (const e of h.events) args.onEvent(JSON.parse(e));
  }),
}));
vi.mock("@/server/db/session.repo", () => ({
  createSessionRepo: () => ({
    get: async () => (h.sessionExists ? { id: "s1", agentId: "atmosphere-designer" } : undefined),
  }),
}));
vi.mock("@/server/db/message.repo", () => ({
  createMessageRepo: () => ({
    create: vi.fn(async (i: Record<string, unknown>) => {
      h.messageCreates.push(i);
      return { ...i, id: "m1" };
    }),
  }),
}));
vi.mock("@/server/agent/moderation", () => ({
  screenInput: (text: string) => (text.includes("禁用") ? "输入包含受限内容，已被系统拦截" : null),
}));

import { POST } from "./route";

function post(message: string) {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", agentId: "atmosphere-designer", message }),
    }),
  );
}

describe("POST /api/chat", () => {
  it("入口敏感词初筛：命中黑名单直接 400，不进入 LLM", async () => {
    h.sessionExists = true;
    h.runAgentCalls = 0;
    const res = await post("这是一段包含禁用词的内容");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BLOCKED");
    expect(h.runAgentCalls).toBe(0);
  });

  it("会话不存在返回 404", async () => {
    h.sessionExists = false;
    const res = await post("画一颗苹果");
    expect(res.status).toBe(404);
  });

  it("正常消息：SSE 流以 finish 收尾", async () => {
    h.sessionExists = true;
    h.events = [
      JSON.stringify({ type: "message_delta", text: "正在生成" }),
      JSON.stringify({ type: "finish", stopReason: "stop" }),
    ];
    const res = await post("画一颗苹果");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: finish");
    expect(body).toContain("event: message_delta");
  });

  it("user 消息双视图落库：transcript 含 v:1 标记与 UserMessage，且 userMessageId 透传给 runAgent", async () => {
    h.sessionExists = true;
    h.events = [];
    h.messageCreates = [];
    h.runAgentArgs = [];
    await post("画一颗苹果");
    expect(h.messageCreates).toHaveLength(1);
    const created = h.messageCreates[0];
    expect(created).toMatchObject({ sessionId: "s1", role: "user", content: "画一颗苹果" });
    const transcript = created.transcript as { v: number; messages: { role: string }[] };
    expect(transcript.v).toBe(1);
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0].role).toBe("user");
    expect(h.runAgentArgs[0]).toMatchObject({ userMessageId: "m1", userText: "画一颗苹果" });
  });
});
