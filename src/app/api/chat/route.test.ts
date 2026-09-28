import { describe, expect, it, vi } from "vitest";

// 路由级测试：mock runtime / 仓储 / 初筛，验证 SSE 行为、敏感词拦截与会话校验，
// 不依赖真实 LLM 与数据库。
const h = vi.hoisted(() => ({
  events: [] as string[],
  sessionExists: true,
  runAgentCalls: 0,
}));

vi.mock("@/server/agent/agents", () => ({ default: {} }));
vi.mock("@/server/agent/runtime", () => ({
  runAgent: vi.fn(async (args: { onEvent: (e: unknown) => void }) => {
    h.runAgentCalls += 1;
    for (const e of h.events) args.onEvent(JSON.parse(e));
  }),
}));
vi.mock("@/server/db/session.repo", () => ({
  createSessionRepo: () => ({
    get: async () => (h.sessionExists ? { id: "s1", agentId: "atmosphere-designer" } : undefined),
  }),
}));
vi.mock("@/server/db/message.repo", () => ({
  createMessageRepo: () => ({ create: vi.fn(async (i: Record<string, unknown>) => ({ ...i, id: "m1" })) }),
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
});
