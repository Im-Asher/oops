import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 路由级测试：web 侧只保留 BFF 责任（认证 / 闸门 / 校验 / 落库 / 透传），
// creation 的一切（agent 装配、模型、工具、任务、assistant 落库）都在对端，
// 因此这里 mock 内网调用与仓储，验证「拆出去之后 web 仍然答应了什么」。
const h = vi.hoisted(() => ({
  userId: "u1" as string | null,
  sessionExists: true,
  sessionTitle: null as string | null,
  sessionAgentId: "atmosphere-designer" as string | null,
  renamedTitle: null as string | null,
  renameThrows: false,
  opOrder: [] as string[],
  messageCreates: [] as Record<string, unknown>[],
  removedMessageIds: [] as string[],
  existingRows: [] as { role: string }[],
  assetRows: [] as {
    id: string;
    userId: string;
    sessionId: string;
    storageKey: string;
    prompt: string | null;
    mimeType: string;
  }[],
  vision: false as boolean | null,
  gateOpen: true,
  gateBalance: 100,
  noticeCalls: [] as Array<{ userId: string; balance: number }>,
  noticeThrows: false,
  fetchThrows: false,
  fetchCalls: [] as Array<{ url: string; init: RequestInit }>,
  upstream: null as null | (() => Response),
}));

vi.mock("@oops/auth/require-user", () => ({
  requireUser: vi.fn(async () => h.userId),
}));
vi.mock("@oops/domain/credits/service", () => ({
  creditsService: {
    checkGate: async () => ({ ok: h.gateOpen, balance: h.gateBalance }),
  },
}));
vi.mock("@oops/domain/notifications/service", () => ({
  notificationsService: {
    notifyCreditsStateSafe: async (userId: string, balance: number) => {
      h.noticeCalls.push({ userId, balance });
      if (h.noticeThrows) throw new Error("通知写入失败");
    },
  },
}));
vi.mock("@oops/db/asset.repo", () => ({
  createAssetRepo: () => ({
    getManyByIds: async (ids: string[]) => h.assetRows.filter((a) => ids.includes(a.id)),
  }),
}));
vi.mock("@oops/db/session.repo", () => ({
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
vi.mock("@oops/db/message.repo", () => ({
  createMessageRepo: () => ({
    create: vi.fn(async (i: Record<string, unknown>) => {
      h.messageCreates.push(i);
      h.opOrder.push("create");
      return { ...i, id: "m1" };
    }),
    list: vi.fn(async () => h.existingRows),
    remove: vi.fn(async (id: string) => {
      h.removedMessageIds.push(id);
    }),
  }),
}));
vi.mock("@/server/moderation", () => ({
  screenInput: (text: string) => (text.includes("禁用") ? "输入包含受限内容，已被系统拦截" : null),
}));
vi.mock("@/server/creation/client", () => ({
  isVisionAgent: vi.fn(async () => h.vision),
}));

import { POST } from "./route";

function sse(chunks: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function failure(status: number, code: string, message = "boom"): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

/** 便于断言 web 发给 creation 的请求体。 */
function sentBody(): Record<string, unknown> {
  const call = h.fetchCalls.at(-1);
  if (!call) throw new Error("没有发出内网请求");
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

describe("POST /api/chat（BFF）", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.sessionExists = true;
    h.sessionTitle = null;
    h.sessionAgentId = "atmosphere-designer";
    h.renamedTitle = null;
    h.renameThrows = false;
    h.opOrder = [];
    h.messageCreates = [];
    h.removedMessageIds = [];
    h.existingRows = [];
    h.assetRows = [];
    h.vision = false;
    h.gateOpen = true;
    h.gateBalance = 100;
    h.noticeCalls = [];
    h.noticeThrows = false;
    h.fetchThrows = false;
    h.fetchCalls = [];
    h.upstream = () => sse(["event: finish\ndata: {\"type\":\"finish\",\"v\":1}\n\n"]);

    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      h.fetchCalls.push({ url: String(url), init });
      if (h.fetchThrows) throw new TypeError("fetch failed");
      return h.upstream!();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未认证返回 401，不触发任何下游", async () => {
    h.userId = null;
    const res = await post("画一颗苹果");
    expect(res.status).toBe(401);
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.messageCreates).toHaveLength(0);
  });

  it("余额不足返回 402，不落消息不触发创作域", async () => {
    h.gateOpen = false;
    h.gateBalance = 0;
    const res = await post("画一颗苹果");
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("INSUFFICIENT_CREDITS");
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.messageCreates).toHaveLength(0);
  });

  it("余额不足时顺带投递积分通知（带当前余额）", async () => {
    h.gateOpen = false;
    h.gateBalance = 0;
    await post("画一颗苹果");
    expect(h.noticeCalls).toEqual([{ userId: "u1", balance: 0 }]);
  });

  it("闸门放行时不投递通知", async () => {
    await post("画一颗苹果");
    expect(h.noticeCalls).toHaveLength(0);
  });

  it("通知写入失败仍返回 402（best-effort 不影响拒绝结果）", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.gateOpen = false;
    h.gateBalance = 0;
    h.noticeThrows = true;
    const res = await post("画一颗苹果");
    expect(res.status).toBe(402);
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.messageCreates).toHaveLength(0);
    spy.mockRestore();
  });

  it("入口敏感词初筛：命中直接 400，不落库不转发", async () => {
    const res = await post("这是一段包含禁用词的内容");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BLOCKED");
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.messageCreates).toHaveLength(0);
  });

  it("会话不存在返回 404", async () => {
    h.sessionExists = false;
    const res = await post("画一颗苹果");
    expect(res.status).toBe(404);
  });

  it("正常消息：creation 的 SSE 原样透传（不解析不重组）", async () => {
    const res = await post("画一颗苹果");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("event: finish");
  });

  it("转发到 creation /v1/runs：带内网令牌与完整回合上下文", async () => {
    await post("画一颗苹果");
    const call = h.fetchCalls.at(-1)!;
    expect(call.url).toContain("/v1/runs");
    expect((call.init.headers as Record<string, string>)["x-internal-token"]).toBeTruthy();
    expect(sentBody()).toMatchObject({
      userId: "u1",
      sessionId: "s1",
      agentId: "atmosphere-designer",
      message: "画一颗苹果",
      referenceAssetIds: [],
    });
    expect(typeof sentBody().runId).toBe("string");
  });

  it("user 消息先落库，且 userMessageId 传给 creation（回放时排除本轮）", async () => {
    await post("画一颗苹果");
    expect(h.messageCreates).toHaveLength(1);
    const created = h.messageCreates[0];
    expect(created).toMatchObject({
      sessionId: "s1",
      role: "user",
      content: "画一颗苹果",
      userId: "u1",
    });
    const transcript = created.transcript as { v: number; messages: { role: string }[] };
    expect(transcript.v).toBe(1);
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0].role).toBe("user");
    expect(sentBody().userMessageId).toBe("m1");
  });

  it("首条消息自动命名：标题为空时截取前 20 字，且先于用户消息落库", async () => {
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
    await post("画一颗苹果");
    expect(sentBody().agentId).toBe("atmosphere-designer");
  });

  it("自动命名失败不阻断聊天：仍然落库并转发", async () => {
    h.sessionTitle = null;
    h.renameThrows = true;
    const res = await post("画一颗苹果");
    expect(res.status).toBe(200);
    expect(h.messageCreates).toHaveLength(1);
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("引用注入：transcript 的 userText = 原文 + 引用块（assetId/url/原prompt），content 列保持原文", async () => {
    h.assetRows = [
      {
        id: "a1",
        userId: "u1",
        sessionId: "s1",
        storageKey: "assets/x.png",
        prompt: "海边日落",
        mimeType: "image/png",
      },
      {
        id: "a2",
        userId: "u1",
        sessionId: "s1",
        storageKey: "assets/y.png",
        prompt: null,
        mimeType: "image/png",
      },
    ];
    await post("改成夜景", ["a1", "a2"]);

    expect(sentBody().referenceAssetIds).toEqual(["a1", "a2"]);
    expect(h.messageCreates[0].content).toBe("改成夜景");
    const transcript = h.messageCreates[0].transcript as {
      v: number;
      messages: { role: string; content: string }[];
    };
    expect(transcript.messages[0].content.startsWith("改成夜景")).toBe(true);
    expect(transcript.messages[0].content).toContain("[引用画布图片]");
    expect(transcript.messages[0].content).toContain(
      "- assetId: a1, url: /files/assets/x.png, 原prompt: 海边日落",
    );
    expect(transcript.messages[0].content).toContain(
      "- assetId: a2, url: /files/assets/y.png, 原prompt: (无)",
    );
  });

  it("引用校验：越权（他人资产）引用整体拒绝，不落库不转发", async () => {
    h.assetRows = [
      {
        id: "a1",
        userId: "u2",
        sessionId: "s1",
        storageKey: "x.png",
        prompt: null,
        mimeType: "image/png",
      },
    ];
    const res = await post("改成夜景", ["a1"]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_REFERENCE");
    expect(h.messageCreates).toHaveLength(0);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("引用校验：跨会话与不存在的引用同样拒绝", async () => {
    h.assetRows = [
      {
        id: "a1",
        userId: "u1",
        sessionId: "s-other",
        storageKey: "x.png",
        prompt: null,
        mimeType: "image/png",
      },
    ];
    const res = await post("改成夜景", ["a1", "missing"]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_REFERENCE");
  });

  it("引用超过 5 个：schema 层 400", async () => {
    const res = await post("改成夜景", ["a", "b", "c", "d", "e", "f"]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID");
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("vision Agent：transcript 带图片引用占位（只留 assetId/url，无 base64）", async () => {
    h.vision = true;
    h.assetRows = [
      {
        id: "a1",
        userId: "u1",
        sessionId: "s1",
        storageKey: "assets/x.png",
        prompt: null,
        mimeType: "image/png",
      },
    ];
    await post("给这个保温杯做海报", ["a1"], "poster-designer");
    const transcript = h.messageCreates[0].transcript as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const texts = transcript.messages[0].content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "");
    expect(texts.some((t) => t.includes("[图片附件: /files/assets/x.png (assetId: a1)]"))).toBe(
      true,
    );
    // 图片字节由 creation 读取，web 落库路径不带 base64
    expect(JSON.stringify(transcript)).not.toContain("base64");
  });

  it("非 vision Agent：引用仅文本注入，transcript 为纯文本", async () => {
    h.assetRows = [
      {
        id: "a1",
        userId: "u1",
        sessionId: "s1",
        storageKey: "assets/x.png",
        prompt: null,
        mimeType: "image/png",
      },
    ];
    await post("改成夜景", ["a1"]);
    const transcript = h.messageCreates[0].transcript as { messages: { content: unknown }[] };
    expect(typeof transcript.messages[0].content).toBe("string");
  });

  it("能力查询失败时退化为非 vision 口径，不阻断本轮", async () => {
    const { isVisionAgent } = await import("@/server/creation/client");
    vi.mocked(isVisionAgent).mockResolvedValueOnce(null);
    h.assetRows = [
      {
        id: "a1",
        userId: "u1",
        sessionId: "s1",
        storageKey: "assets/x.png",
        prompt: null,
        mimeType: "image/png",
      },
    ];
    const res = await post("改成夜景", ["a1"]);
    expect(res.status).toBe(200);
    const transcript = h.messageCreates[0].transcript as { messages: { content: unknown }[] };
    expect(typeof transcript.messages[0].content).toBe("string");
  });

  it("creation 不可达：503 + 回滚刚写的 user 行（会话无 assistant 行）", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.fetchThrows = true;
    const res = await post("画一颗苹果");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CREATION_UNAVAILABLE");
    expect(h.removedMessageIds).toEqual(["m1"]);
    spy.mockRestore();
  });

  it("creation 返回 409：状态码透传，且回滚 user 行", async () => {
    h.upstream = () => failure(409, "DUPLICATE_RUN", "同一 runId 已在执行");
    const res = await post("画一颗苹果");
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("DUPLICATE_RUN");
    expect(h.removedMessageIds).toEqual(["m1"]);
  });

  it("会话已有 assistant 行时不回滚（避免删掉上下文里的真实提问）", async () => {
    h.fetchThrows = true;
    h.existingRows = [{ role: "assistant" }];
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await post("画一颗苹果");
    expect(h.removedMessageIds).toEqual([]);
    spy.mockRestore();
  });
});
