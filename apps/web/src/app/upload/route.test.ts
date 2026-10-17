import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由级测试：mock 上传处理器 / 仓储 / 认证 / 存储，验证 purpose=reference 的
// 分流与会话归属校验，不触真实存储与数据库。
const h = vi.hoisted(() => ({
  userId: null as string | null,
  sessionExists: true,
  calls: { reference: 0, derived: 0, plain: 0, design: 0 },
  designArgs: null as { width?: number; height?: number } | null,
}));

vi.mock("@oops/auth/require-user", () => ({
  requireUser: vi.fn(async () => h.userId),
}));

vi.mock("@oops/db/session.repo", () => ({
  createSessionRepo: () => ({
    get: async (sessionId: string, userId: string) =>
      h.sessionExists ? { id: sessionId, userId, agentId: "atmosphere-designer", title: null } : undefined,
  }),
}));

vi.mock("@/server/infra/storage/upload", () => ({
  handleDesignUpload: vi.fn(async (input: { width?: number; height?: number }) => {
    h.calls.design += 1;
    h.designArgs = { width: input.width, height: input.height };
    return new Response(JSON.stringify({ url: "/files/dz.png", assetId: "a-dz" }), { status: 201 });
  }),
  handleReferenceUpload: vi.fn(async () => {
    h.calls.reference += 1;
    return new Response(JSON.stringify({ url: "/files/ref.png", assetId: "a-ref" }), { status: 201 });
  }),
  handleDerivedUpload: vi.fn(async () => {
    h.calls.derived += 1;
    return new Response(JSON.stringify({ url: "/files/d.png", assetId: "a-d" }), { status: 201 });
  }),
  handleUpload: vi.fn(async () => {
    h.calls.plain += 1;
    return new Response(JSON.stringify({ url: "/files/p.png", assetId: "a-p" }), { status: 201 });
  }),
}));

vi.mock("@/server/infra/storage/s3", () => ({
  createStorage: vi.fn(() => ({ putObject: async () => undefined })),
  defaultS3Client: {},
}));

vi.mock("@oops/db/asset.repo", () => ({ createAssetRepo: () => ({}) }));
vi.mock("@oops/db/message.repo", () => ({ createMessageRepo: () => ({}) }));

import { POST } from "./route";

function post(fields: Record<string, string>, fileName = "a.png", type = "image/png") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1])], fileName, { type }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://localhost/upload", { method: "POST", body: form });
}

describe("POST /upload purpose=reference", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.sessionExists = true;
    h.calls = { reference: 0, derived: 0, plain: 0, design: 0 };
    h.designArgs = null;
  });

  it("成功：分流到 handleReferenceUpload，不触发导出/普通上传", async () => {
    const res = await POST(post({ purpose: "reference", sessionId: "s1" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetId: string };
    expect(body.assetId).toBe("a-ref");
    expect(h.calls).toEqual({ reference: 1, derived: 0, plain: 0, design: 0 });
  });

  it("缺 sessionId 返回 400，不进任何处理分支", async () => {
    const res = await POST(post({ purpose: "reference" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NO_SESSION");
    expect(h.calls.reference).toBe(0);
  });

  it("会话不存在或不属于当前用户返回 404", async () => {
    h.sessionExists = false;
    const res = await POST(post({ purpose: "reference", sessionId: "s-other" }));
    expect(res.status).toBe(404);
    expect(h.calls.reference).toBe(0);
  });

  it("purpose 缺省回落普通上传；sessionId 无 purpose 仍走画布导出", async () => {
    await POST(post({}));
    expect(h.calls.plain).toBe(1);
    await POST(post({ sessionId: "s1", sourceAssetId: "src-1", width: "10", height: "10" }));
    expect(h.calls.derived).toBe(1);
    expect(h.calls.reference).toBe(0);
  });
});

describe("POST /upload purpose=design", () => {
  beforeEach(() => {
    h.userId = "u1";
    h.sessionExists = true;
    h.calls = { reference: 0, derived: 0, plain: 0, design: 0 };
    h.designArgs = null;
  });

  it("成功：分流到 handleDesignUpload 并回传 assetId", async () => {
    const res = await POST(post({ purpose: "design", width: "1080", height: "1440" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetId: string };
    expect(body.assetId).toBe("a-dz");
    expect(h.calls.design).toBe(1);
    // 不触碰参考图/画布导出/普通上传分支
    expect(h.calls).toMatchObject({ reference: 0, derived: 0, plain: 0 });
  });

  it("设计稿宽高透传给 handler（作品集网格据此算宽高比）", async () => {
    await POST(post({ purpose: "design", width: "1080", height: "1440" }));
    expect(h.designArgs).toEqual({ width: 1080, height: 1440 });
  });

  it("宽高缺失或非法时传 undefined，不传 NaN 也不传 0", async () => {
    await POST(post({ purpose: "design" }));
    expect(h.designArgs).toEqual({ width: undefined, height: undefined });
    await POST(post({ purpose: "design", width: "abc", height: "xyz" }));
    expect(h.designArgs).toEqual({ width: undefined, height: undefined });
    // Number(null) === 0：若不做空串与 >0 校验，缺省宽高会被记成 0×0
    await POST(post({ purpose: "design", width: "0", height: "0" }));
    expect(h.designArgs).toEqual({ width: undefined, height: undefined });
    await POST(post({ purpose: "design", width: "  ", height: "  " }));
    expect(h.designArgs).toEqual({ width: undefined, height: undefined });
  });

  it("purpose=design 不需要 sessionId，且不查会话", async () => {
    const res = await POST(post({ purpose: "design" }));
    expect(res.status).toBe(201);
    expect(h.sessionExists).toBe(true); // 会话存在性未被触碰（reference 分支才会查）
    expect(h.calls.design).toBe(1);
  });

  it("purpose=design 优先于 sessionId 分支（带 sessionId 也走设计）", async () => {
    await POST(post({ purpose: "design", sessionId: "s1" }));
    expect(h.calls.design).toBe(1);
    expect(h.calls.derived).toBe(0);
  });
});
