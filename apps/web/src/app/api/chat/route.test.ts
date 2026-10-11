import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由级测试：mock runtime / 仓储 / 认证 / 初筛，验证 SSE 行为、敏感词拦截与会话校验，
// 不依赖真实 LLM 与数据库。
const h = vi.hoisted(() => ({
  events: [] as string[],
  sessionExists: true,
  sessionTitle: null as string | null,
  sessionAgentId: "atmosphere-designer" as string | null,
  renamedTitle: null as string | null,
  renameThrows: false,
  opOrder: [] as string[],
  runAgentCalls: 0,
  runAgentArgs: [] as Record<string, unknown>[],
  messageCreates: [] as Record<string, unknown>[],
  userId: null as string | null,
  assetRows: [] as { id: string; userId: string; sessionId: string; storageKey: string; prompt: string | null; mimeType: string }[],
  visionAgent: false,
  storageBytes: [137, 80, 78, 71] as number[],
}));

vi.mock("@/server/agent", () => ({ default: {} }));
vi.mock("@/server/agent/registry", () => ({
  agentRegistry: {
    // 仅 poster-designer 声明 vision（fixture 判定）
    get: (id: string) =>
      id === "poster-designer" && h.visionAgent
        ? { models: { main: { capabilities: ["vision"] } } }
        : undefined,
  },
}));
vi.mock("@/server/infra/storage/s3", () => ({
  createStorage: () => ({
    getObject: async () => ({
      Body: { transformToByteArray: async () => h.storageBytes },
    }),
  }),
}));
vi.mock("@/server/auth/require-user", () => ({
  requireUser: vi.fn(async () => h.userId),
}));
vi.mock("@/server/db/asset.repo", () => ({
  createAssetRepo: () => ({
    getManyByIds: async (ids: string[]) => h.assetRows.filter((a) => ids.includes(a.id)),
  }),
}));
vi.mock("@/server/agent/runtime", () => ({
  runAgent: vi.fn(async (args: { onEvent: (e: unknown) => void }) => {
    h.runAgentCalls += 1;
    h.runAgentArgs.push(args as Record<string, unknown>);
    for (const e of h.events) args.onEvent(JSON.parse(e));
  }),
}));
vi.mock("@/server/db/session.repo", () => ({
  createSessionRepo: () => ({
    get: async () =>
      h.sessionExists
        ? { id: "s1", agentId: h.sessionAgentId, title: h.sessionTitle }
        : undefined,
    rename: vi.fn(async (id: string, title: string) => {
      if (h.renameThrows) throw new Error("rename boom");
      h.renamedTitle = title;
      h.opOrder.push("rename");
      return { id, agentId: h.sessionAgentId, title };
    }),
  }),
}));
vi.mock("@/server/db/message.repo", () => ({
  createMessageRepo: () => ({
    create: vi.fn(async (i: Record<string, unknown>) => {
      h.messageCreates.push(i);
      h.opOrder.push("create");
      return { ...i, id: "m1" };
    }),
  }),
}));
vi.mock("@/server/agent/moderation", () => ({
  screenInput: (text: string) => (text.includes("禁用") ? "输入包含受限内容，已被系统拦截" : null),
}));

import { POST } from "./route";

function post(message: string, referenceAssetIds?: string[], agentId = "atmosphere-designer") {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "s1",
        agentId,
        message,
        ...(referenceAssetIds ? { referenceAssetIds } : {}),
      }),
    }),
  );
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.sessionExists = true;
    h.sessionTitle = null;
    h.sessionAgentId = "atmosphere-designer";
    h.renamedTitle = null;
    h.renameThrows = false;
    h.opOrder = [];
    h.runAgentCalls = 0;
    h.runAgentArgs = [];
    h.messageCreates = [];
    h.assetRows = [];
  });

  it("未认证返回 401，不触发任何下游", async () => {
    h.userId = null;
    h.runAgentCalls = 0;
    const res = await post("画一颗苹果");
    expect(res.status).toBe(401);
    expect(h.runAgentCalls).toBe(0);
  });

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
    expect(created).toMatchObject({ sessionId: "s1", role: "user", content: "画一颗苹果", userId: "u1" });
    const transcript = created.transcript as { v: number; messages: { role: string }[] };
    expect(transcript.v).toBe(1);
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0].role).toBe("user");
    expect(h.runAgentArgs[0]).toMatchObject({ userMessageId: "m1", userText: "画一颗苹果", userId: "u1" });
  });

  it("首条消息自动命名：标题为空时截取前 20 字，且先于用户消息落库", async () => {
    h.sessionTitle = null;
    const message = "秋天树林里的木桌旁边放我们的面霜产品图，暖色调";
    await post(message);
    expect(h.renamedTitle).toBe(message.slice(0, 20));
    expect(h.opOrder).toEqual(["rename", "create"]);
  });

  it("已有标题不覆盖：标题非空时不再自动命名", async () => {
    h.sessionTitle = "手动起的标题";
    await post("画一颗苹果");
    expect(h.renamedTitle).toBeNull();
  });

  it("存量会话 agentId 为空时回退请求携带的 agentId", async () => {
    h.sessionAgentId = null;
    h.events = [JSON.stringify({ type: "finish", stopReason: "stop" })];
    await post("画一颗苹果");
    expect(h.runAgentArgs[0]).toMatchObject({ agentId: "atmosphere-designer" });
  });

  it("自动命名失败不阻断聊天：SSE 流正常建立", async () => {
    h.sessionTitle = null;
    h.renameThrows = true;
    h.events = [JSON.stringify({ type: "finish", stopReason: "stop" })];
    const res = await post("画一颗苹果");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(h.runAgentCalls).toBe(1);
    expect(h.messageCreates).toHaveLength(1);
  });

  it("引用注入：userText = 原文 + 引用块（assetId/url/原prompt），content 列保持原文，transcript 与 userText 一致", async () => {
    h.assetRows = [
      { id: "a1", userId: "u1", sessionId: "s1", storageKey: "assets/x.png", prompt: "海边日落", mimeType: "image/png" },
      { id: "a2", userId: "u1", sessionId: "s1", storageKey: "assets/y.png", prompt: null, mimeType: "image/png" },
    ];
    h.events = [JSON.stringify({ type: "finish", stopReason: "stop" })];
    await post("改成夜景", ["a1", "a2"]);
    const args = h.runAgentArgs[0] as { userText: string };
    expect(args.userText.startsWith("改成夜景")).toBe(true);
    expect(args.userText).toContain("[引用画布图片]");
    expect(args.userText).toContain("- assetId: a1, url: /files/assets/x.png, 原prompt: 海边日落");
    expect(args.userText).toContain("- assetId: a2, url: /files/assets/y.png, 原prompt: (无)");
    // content 列与 UI 文本保持原文，不携带引用块
    expect(h.messageCreates[0].content).toBe("改成夜景");
    // transcript 视图与本轮 userText 一致
    const transcript = h.messageCreates[0].transcript as {
      v: number;
      messages: { role: string; content: string }[];
    };
    expect(transcript.v).toBe(1);
    expect(transcript.messages[0].role).toBe("user");
    expect(transcript.messages[0].content).toBe(args.userText);
  });

  it("引用校验：越权（他人资产）引用整体拒绝，不落库不进 LLM", async () => {
    h.assetRows = [{ id: "a1", userId: "u2", sessionId: "s1", storageKey: "x.png", prompt: null, mimeType: "image/png" }];
    const res = await post("改成夜景", ["a1"]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_REFERENCE");
    expect(h.runAgentCalls).toBe(0);
    expect(h.messageCreates).toHaveLength(0);
  });

  it("引用校验：跨会话与不存在的引用同样拒绝", async () => {
    h.assetRows = [
      { id: "a1", userId: "u1", sessionId: "s-other", storageKey: "x.png", prompt: null, mimeType: "image/png" },
    ];
    const res = await post("改成夜景", ["a1", "missing"]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_REFERENCE");
    expect(h.runAgentCalls).toBe(0);
  });

  it("引用超过 5 个：schema 层 400", async () => {
    const res = await post("改成夜景", ["a", "b", "c", "d", "e", "f"]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID");
    expect(h.runAgentCalls).toBe(0);
  });

  it("vision Agent：引用图片字节转 base64 注入 runAgent.images，transcript 图片文本化（无 base64）", async () => {
    h.visionAgent = true;
    h.sessionAgentId = "poster-designer";
    h.assetRows = [
      { id: "a1", userId: "u1", sessionId: "s1", storageKey: "assets/x.png", prompt: null, mimeType: "image/png" },
    ];
    h.events = [JSON.stringify({ type: "finish", stopReason: "stop" })];
    await post("给这个保温杯做海报", ["a1"], "poster-designer");
    const args = h.runAgentArgs[0] as { images?: { assetId: string; url: string; data: string; mimeType: string }[] };
    expect(args.images).toHaveLength(1);
    expect(args.images?.[0]).toMatchObject({
      assetId: "a1",
      url: "/files/assets/x.png",
      data: Buffer.from(h.storageBytes).toString("base64"),
      mimeType: "image/png",
    });
    // transcript：图片块被清洗为带引用线索的占位文本，绝无 base64
    const transcript = h.messageCreates[0].transcript as {
      messages: { role: string; content: { type: string; text?: string }[] }[];
    };
    const texts = transcript.messages[0].content.filter((c) => c.type === "text").map((c) => c.text ?? "");
    expect(texts.some((t) => t.includes("[图片附件: /files/assets/x.png (assetId: a1)]"))).toBe(true);
    expect(JSON.stringify(transcript)).not.toContain(Buffer.from(h.storageBytes).toString("base64"));
  });

  it("非 vision Agent：引用仅文本注入，不传 images（行为不变）", async () => {
    h.assetRows = [
      { id: "a1", userId: "u1", sessionId: "s1", storageKey: "assets/x.png", prompt: null, mimeType: "image/png" },
    ];
    h.events = [JSON.stringify({ type: "finish", stopReason: "stop" })];
    await post("改成夜景", ["a1"]);
    const args = h.runAgentArgs[0] as { images?: unknown[] };
    expect(args.images ?? []).toHaveLength(0);
    const transcript = h.messageCreates[0].transcript as {
      messages: { content: unknown }[];
    };
    // 纯文本 transcript（引用块随 userText 落库）
    expect(typeof transcript.messages[0].content).toBe("string");
  });

  it("vision Agent 无引用：不触发 storage 读取，images 为空", async () => {
    h.visionAgent = true;
    h.sessionAgentId = "poster-designer";
    h.events = [JSON.stringify({ type: "finish", stopReason: "stop" })];
    await post("直接描述需求", undefined, "poster-designer");
    const args = h.runAgentArgs[0] as { images?: unknown[] };
    expect(args.images ?? []).toHaveLength(0);
  });
});
