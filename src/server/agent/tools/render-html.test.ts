import { beforeEach, describe, expect, it, vi } from "vitest";
import { POSTER_WIDTH, renderHtmlSchema, renderHtmlTool } from "./render-html";

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

// 工具级单测：mock 任务队列与资产仓储，验证 schema 约束、归属校验与血缘透传。
const h = vi.hoisted(() => ({
  submitCalls: [] as SubmitCall[],
  submitResult: null as object | null,
  submitThrows: false,
  assetRow: undefined as FakeAsset | undefined,
}));

vi.mock("@/server/domain/tasks/task-executor", () => ({
  submitAndWait: vi.fn(
    async (type: string, payload: Record<string, unknown>, opts: Record<string, unknown>) => {
      if (h.submitThrows) throw new Error("渲染超过 30000ms 未完成");
      h.submitCalls.push({ type, payload, opts });
      return h.submitResult;
    },
  ),
}));

vi.mock("@/server/db/asset.repo", () => ({
  createAssetRepo: () => ({
    get: async (id: string) => (h.assetRow?.id === id ? h.assetRow : undefined),
  }),
}));

const ctx = { userId: "u1", sessionId: "s1" };

const outcome = {
  assetId: "a-poster",
  url: "/files/poster.png",
  data: "base64png",
  mimeType: "image/png",
  width: POSTER_WIDTH,
  height: 1334,
  taskId: "t1",
};

const validArgs = { html: "<html><body>x</body></html>", height: 1334 };

describe("render_html 工具：schema 约束与血缘", () => {
  beforeEach(() => {
    h.submitCalls = [];
    h.submitResult = outcome;
    h.submitThrows = false;
    h.assetRow = { id: "a1", userId: "u1", sessionId: "s1" };
  });

  it("schema：高度档位受限；宽度不出现在入参（服务端固定）", () => {
    expect(renderHtmlSchema.safeParse(validArgs).success).toBe(true);
    expect(renderHtmlSchema.safeParse({ ...validArgs, height: 999 }).success).toBe(false);
    expect(renderHtmlSchema.safeParse({ ...validArgs, height: 2000 }).success).toBe(false);
  });

  it("schema：HTML 超上限被拒", () => {
    const big = { html: "x".repeat(200_001), height: 1334 };
    expect(renderHtmlSchema.safeParse(big).success).toBe(false);
  });

  it("成功：宽 750 固定写入 payload，ImageContent 回喂 + details 透出", async () => {
    const result = await renderHtmlTool.execute(validArgs, ctx);
    expect(h.submitCalls[0].type).toBe("render_html");
    expect(h.submitCalls[0].payload).toMatchObject({
      html: validArgs.html,
      width: POSTER_WIDTH,
      height: 1334,
    });
    const content = result.content as { type: string; data?: string }[];
    expect(content[0]).toMatchObject({ type: "image", data: "base64png" });
    expect(result.details).toMatchObject({
      assetId: "a-poster",
      url: "/files/poster.png",
      width: POSTER_WIDTH,
      height: 1334,
    });
  });

  it("合法引用：血缘写入任务 payload 并透出到 details", async () => {
    h.submitResult = { ...outcome, referenceAssetId: "a1" };
    const result = await renderHtmlTool.execute({ ...validArgs, referenceAssetId: "a1" }, ctx);
    expect(h.submitCalls[0].payload).toMatchObject({ referenceAssetId: "a1" });
    expect(result.details).toMatchObject({ referenceAssetId: "a1" });
  });

  it("归属校验：引用不存在/他人/跨会话 → invalid_reference，不进任务队列", async () => {
    h.assetRow = undefined;
    let result = await renderHtmlTool.execute({ ...validArgs, referenceAssetId: "missing" }, ctx);
    expect(result.details).toMatchObject({ error: "invalid_reference" });
    expect(h.submitCalls).toHaveLength(0);

    h.assetRow = { id: "a1", userId: "u2", sessionId: "s1" };
    result = await renderHtmlTool.execute({ ...validArgs, referenceAssetId: "a1" }, ctx);
    expect(result.details).toMatchObject({ error: "invalid_reference" });

    h.assetRow = { id: "a1", userId: "u1", sessionId: "s-other" };
    result = await renderHtmlTool.execute({ ...validArgs, referenceAssetId: "a1" }, ctx);
    expect(result.details).toMatchObject({ error: "invalid_reference" });
    expect(h.submitCalls).toHaveLength(0);
  });

  it("渲染失败：结构化 render_failed 回喂（含超时等原始信息）", async () => {
    h.submitThrows = true;
    const result = await renderHtmlTool.execute(validArgs, ctx);
    expect(result.details).toMatchObject({ error: "render_failed" });
    expect((result.content as { text: string }[])[0].text).toContain("海报渲染失败");
  });
});
