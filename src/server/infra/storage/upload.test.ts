import { describe, expect, it, vi } from "vitest";
import {
  handleDerivedUpload,
  handleReferenceUpload,
  handleUpload,
  validateUpload,
} from "./upload";
import type { DerivedUploadDeps } from "./upload";

function mockDeps() {
  const putObject = vi.fn().mockResolvedValue(undefined);
  const createAsset = vi.fn().mockResolvedValue({ id: "asset-1" });
  const createMessage = vi.fn().mockResolvedValue({ id: "msg-1" });
  const deps = {
    storage: { putObject },
    assets: { create: createAsset },
    messages: { create: createMessage },
  } as unknown as DerivedUploadDeps;
  return { deps, putObject, createAsset, createMessage };
}

describe("validateUpload", () => {
  it("拒绝非图片类型与超限文件", () => {
    expect(validateUpload("text/plain", 10)?.code).toBe("UNSUPPORTED_TYPE");
    expect(validateUpload("image/png", 11 * 1024 * 1024)?.code).toBe("TOO_LARGE");
    expect(validateUpload("image/png", 10)).toBeNull();
  });
});

describe("handleUpload", () => {
  it("走普通上传：仅落库 asset（kind 由仓储默认），不写会话消息", async () => {
    const { deps, createAsset, createMessage } = mockDeps();
    const res = await handleUpload(
      { bytes: new Uint8Array([1, 2, 3]), type: "image/png", name: "a.png", userId: "u1" },
      deps as never,
    );
    expect(res.status).toBe(201);
    const assetArg = createAsset.mock.calls[0]?.[0] as {
      mimeType: string;
      sessionId?: string;
      userId?: string;
    };
    expect(assetArg.mimeType).toBe("image/png");
    expect(assetArg.sessionId).toBeUndefined();
    expect(assetArg.userId).toBe("u1");
    expect(createMessage).not.toHaveBeenCalled();
  });
});

describe("handleDerivedUpload", () => {
  it("另存为 edited 资产并记录血缘，同时追加助手图片消息", async () => {
    const { deps, createAsset, createMessage } = mockDeps();
    const res = await handleDerivedUpload(
      {
        bytes: new Uint8Array([1, 2, 3]),
        type: "image/png",
        sessionId: "sess-1",
        sourceAssetId: "src-1",
        edits: { crop: null, filters: { brightness: 105 } },
        width: 800,
        height: 600,
        userId: "u1",
      },
      deps,
    );
    expect(res.status).toBe(201);

    const assetArg = createAsset.mock.calls[0]?.[0] as {
      kind: string;
      sessionId: string;
      width: number;
      userId: string;
      meta: { sourceAssetId: string; edits: unknown };
    };
    expect(assetArg.kind).toBe("edited");
    expect(assetArg.sessionId).toBe("sess-1");
    expect(assetArg.width).toBe(800);
    expect(assetArg.userId).toBe("u1");
    expect(assetArg.meta).toEqual({
      sourceAssetId: "src-1",
      edits: { crop: null, filters: { brightness: 105 } },
    });

    const msgArg = createMessage.mock.calls[0]?.[0] as {
      role: string;
      toolCalls: Array<{ type: string; assetId: string; sourceAssetId: string }>;
    };
    expect(msgArg.role).toBe("assistant");
    expect(msgArg.toolCalls[0]?.type).toBe("edited_image");
    expect(msgArg.toolCalls[0]?.assetId).toBe("asset-1");
    expect(msgArg.toolCalls[0]?.sourceAssetId).toBe("src-1");

    const body = (await res.json()) as { assetId: string };
    expect(body.assetId).toBe("asset-1");
  });

  it("拒绝不支持的类型（与普通上传共用校验）", async () => {
    const { deps, createAsset } = mockDeps();
    const res = await handleDerivedUpload(
      { bytes: new Uint8Array([1]), type: "text/plain", sessionId: "s", sourceAssetId: "x", userId: "u1" },
      deps,
    );
    expect(res.status).toBe(415);
    expect(createAsset).not.toHaveBeenCalled();
  });
});

describe("handleReferenceUpload", () => {
  it("落库绑定会话的 kind=image 资产，不追加聊天消息", async () => {
    const { deps, createAsset, createMessage } = mockDeps();
    const res = await handleReferenceUpload(
      { bytes: new Uint8Array([1, 2, 3]), type: "image/jpeg", name: "ref.jpg", sessionId: "sess-1", userId: "u1" },
      deps as never,
    );
    expect(res.status).toBe(201);
    const assetArg = createAsset.mock.calls[0]?.[0] as {
      kind: string;
      sessionId: string;
      userId: string;
      meta: Record<string, unknown>;
    };
    expect(assetArg.kind).toBe("image");
    expect(assetArg.sessionId).toBe("sess-1");
    expect(assetArg.userId).toBe("u1");
    expect(assetArg.meta.purpose).toBe("reference");
    expect(assetArg.meta.originalName).toBe("ref.jpg");
    expect(createMessage).not.toHaveBeenCalled();
    const body = (await res.json()) as { url: string; assetId: string };
    expect(body.assetId).toBe("asset-1");
    expect(body.url).toMatch(/^\/files\//);
  });

  it("拒绝超限文件（复用同一套校验），不落库", async () => {
    const { deps, createAsset } = mockDeps();
    const res = await handleReferenceUpload(
      { bytes: new Uint8Array(11 * 1024 * 1024), type: "image/png", sessionId: "s", userId: "u1" },
      deps as never,
    );
    expect(res.status).toBe(413);
    expect(createAsset).not.toHaveBeenCalled();
  });
});
