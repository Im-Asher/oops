import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateImageSchema, generateImageTool } from "./generate-image";

interface SubmitCall {
  type: string;
  payload: object;
  opts: object;
}

interface FakeAsset {
  id: string;
  userId: string;
  sessionId: string;
}

// 路由级单测：mock 任务队列与资产仓储，验证引用参数的归属校验与血缘透传。
const h = vi.hoisted(() => ({
  submitCalls: [] as SubmitCall[],
  submitResult: null as object | null,
  submitThrows: false,
  assetRow: undefined as FakeAsset | undefined,
}));

vi.mock("@/server/domain/tasks/task-executor", () => ({
  submitAndWait: vi.fn(async (type: string, payload: Record<string, unknown>, opts: Record<string, unknown>) => {
    if (h.submitThrows) throw new Error("图像服务超时");
    h.submitCalls.push({ type, payload, opts });
    return h.submitResult;
  }),
}));

vi.mock("@/server/db/asset.repo", () => ({
  createAssetRepo: () => ({
    get: async (id: string) => (h.assetRow?.id === id ? h.assetRow : undefined),
  }),
}));

const ctx = { userId: "u1", sessionId: "s1" };

const outcome = {
  assetId: "a-new",
  url: "/files/new.png",
  data: "base64",
  mimeType: "image/png",
  prompt: "海边",
  model: "m",
  size: "1024*1024",
  provider: "p",
  taskId: "t1",
};

describe("generate_image 工具：引用参数与血缘", () => {
  beforeEach(() => {
    h.submitCalls = [];
    h.submitResult = outcome;
    h.submitThrows = false;
    h.assetRow = { id: "a1", userId: "u1", sessionId: "s1" };
  });

  it("schema：referenceAssetId 可选；无引用时 payload 不携带该字段", async () => {
    expect(generateImageSchema.safeParse({ prompt: "x", size: "1024*1024", aspectRatio: "1:1" }).success).toBe(true);
    await generateImageTool.execute({ prompt: "x", size: "1024*1024", aspectRatio: "1:1" }, ctx);
    expect(h.submitCalls[0].payload).not.toHaveProperty("referenceAssetId");
  });

  it("合法引用：血缘写入任务 payload，并透出到 details", async () => {
    // 真实 executor 会把 payload.referenceAssetId 回传到 outcome
    h.submitResult = { ...outcome, referenceAssetId: "a1" };
    const result = await generateImageTool.execute(
      { prompt: "x", size: "1024*1024", aspectRatio: "1:1", referenceAssetId: "a1" },
      ctx,
    );
    expect(h.submitCalls[0].payload).toMatchObject({ referenceAssetId: "a1" });
    expect(result.details).toMatchObject({ assetId: "a-new", referenceAssetId: "a1" });
  });

  it("归属校验：引用不存在/他人/跨会话资产 → 结构化 invalid_reference，不进任务队列", async () => {
    h.assetRow = undefined; // 不存在
    let result = await generateImageTool.execute(
      { prompt: "x", size: "1024*1024", aspectRatio: "1:1", referenceAssetId: "missing" },
      ctx,
    );
    expect(result.details).toMatchObject({ error: "invalid_reference" });
    expect(h.submitCalls).toHaveLength(0);

    h.assetRow = { id: "a1", userId: "u2", sessionId: "s1" }; // 他人资产
    result = await generateImageTool.execute(
      { prompt: "x", size: "1024*1024", aspectRatio: "1:1", referenceAssetId: "a1" },
      ctx,
    );
    expect(result.details).toMatchObject({ error: "invalid_reference" });

    h.assetRow = { id: "a1", userId: "u1", sessionId: "s-other" }; // 跨会话
    result = await generateImageTool.execute(
      { prompt: "x", size: "1024*1024", aspectRatio: "1:1", referenceAssetId: "a1" },
      ctx,
    );
    expect(result.details).toMatchObject({ error: "invalid_reference" });
    expect(h.submitCalls).toHaveLength(0);
  });

  it("生成失败路径不受引用影响：结构化 generation_failed", async () => {
    h.submitThrows = true;
    const result = await generateImageTool.execute(
      { prompt: "x", size: "1024*1024", aspectRatio: "1:1", referenceAssetId: "a1" },
      ctx,
    );
    expect(result.details).toMatchObject({ error: "generation_failed" });
  });
});
