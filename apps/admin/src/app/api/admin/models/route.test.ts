import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminMock, resolveModelMock, layersMock, bumpMock, repoMock, auditMock } =
  vi.hoisted(() => ({
    requireAdminMock: vi.fn(),
    resolveModelMock: vi.fn(),
    layersMock: vi.fn(),
    bumpMock: vi.fn(),
    repoMock: {
      get: vi.fn(),
      getMany: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    auditMock: { record: vi.fn() },
  }));

vi.mock("@oops/auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@oops/db", () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(Symbol("tx")) },
}));
vi.mock("@oops/db/app-config.repo", () => ({
  createAppConfigRepo: vi.fn(() => repoMock),
  assertConfigKeyValue: vi.fn(),
}));
vi.mock("@oops/db/admin-audit.repo", () => ({
  createAdminAuditRepo: vi.fn(() => auditMock),
}));
vi.mock("@oops/llm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oops/llm")>()),
  resolveModelEnabled: resolveModelMock,
  resolveRoleDefaultLayers: layersMock,
  bumpRuntimeConfigGeneration: bumpMock,
}));

import { GET } from "./route";
import { PATCH } from "./[providerId]/[modelId]/enabled/route";
import { DELETE, PUT } from "./role-defaults/[role]/route";

const admin = { ok: true, userId: "admin-op" };
const catalogLayers = {
  effective: { providerId: "qwen-token-plan-cn", modelId: "qwen3.8-max", source: "catalog" },
  overlay: null,
  env: null,
  catalog: "qwen3.8-max",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/models", () => {
  it("401/403：守卫拒绝", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" });
    expect((await GET(new Request("http://x") as never)).status).toBe(401);
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" });
    expect((await GET(new Request("http://x") as never)).status).toBe(403);
  });

  it("200：目录条目（文本+图像）+ 生效态 + 角色默认三层明细", async () => {
    requireAdminMock.mockResolvedValueOnce(admin);
    resolveModelMock.mockImplementation(
      async (_p: string, m: string) =>
        m === "qwen3.7-plus"
          ? { enabled: false, source: "overlay" }
          : { enabled: true, source: "catalog" },
    );
    layersMock.mockImplementation(async (role: string) =>
      role === "main"
        ? {
            effective: { providerId: "qwen-token-plan-cn", modelId: "qwen3.7-plus", source: "env" },
            overlay: null,
            env: "qwen3.7-plus",
            catalog: "qwen3.8-max",
          }
        : catalogLayers,
    );
    const res = await GET(new Request("http://x") as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      textProviders: Array<{ providerId: string; models: Array<{ id: string; enabled: boolean; source: string }> }>;
      imageProviders: Array<{ providerId: string; defaultModelId: string }>;
      roleDefaults: Record<string, { env: string | null }>;
    };
    expect(body.textProviders[0].models.find((m) => m.id === "qwen3.7-plus")).toMatchObject({
      enabled: false,
      source: "overlay",
    });
    expect(body.imageProviders[0]).toMatchObject({ providerId: "dashscope-token-plan", defaultModelId: "wan2.7-image" });
    expect(body.roleDefaults.main).toMatchObject({ env: "qwen3.7-plus" });
    expect(body.roleDefaults.summarizer).toMatchObject({ env: null });
  });
});

describe("PATCH /api/admin/models/[providerId]/[modelId]/enabled", () => {
  it("401/未登记模型 422/body 非法 400", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" });
    expect(
      (await PATCH(new Request("http://x", { method: "PATCH", body: "{}" }) as never, { params: Promise.resolve({ providerId: "qwen-token-plan-cn", modelId: "qwen3.8-max" }) })).status,
    ).toBe(401);

    requireAdminMock.mockResolvedValueOnce(admin);
    expect(
      (await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: true }) }) as never, { params: Promise.resolve({ providerId: "ghost", modelId: "nope" }) })).status,
    ).toBe(422);

    requireAdminMock.mockResolvedValueOnce(admin);
    expect(
      (await PATCH(new Request("http://x", { method: "PATCH", body: "{}" }) as never, { params: Promise.resolve({ providerId: "qwen-token-plan-cn", modelId: "qwen3.8-max" }) })).status,
    ).toBe(400);
    expect(repoMock.set).not.toHaveBeenCalled();
  });

  it("停用成功：overlay 写入 + 同事务审计（before 含来源层）+ bump", async () => {
    requireAdminMock.mockResolvedValueOnce(admin);
    resolveModelMock.mockResolvedValueOnce({ enabled: true, source: "catalog" });
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: false, note: "smoke" }) }) as never,
      { params: Promise.resolve({ providerId: "qwen-token-plan-cn", modelId: "qwen3.8-max" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      model: { providerId: "qwen-token-plan-cn", modelId: "qwen3.8-max", enabled: false, source: "overlay" },
    });
    expect(repoMock.set).toHaveBeenCalledWith({
      key: "model.qwen-token-plan-cn.qwen3.8-max.enabled",
      value: false,
      updatedBy: "admin-op",
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "model.config",
        targetId: "qwen-token-plan-cn/qwen3.8-max",
        before: { enabled: true, source: "catalog" },
        after: { enabled: false },
      }),
    );
    expect(bumpMock).toHaveBeenCalledTimes(1);
  });
});

describe("PUT/DELETE /api/admin/models/role-defaults/[role]", () => {
  it("PUT 401/未知 role 422/未登记模型 422", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" });
    expect(
      (await PUT(new Request("http://x", { method: "PUT", body: "{}" }) as never, { params: Promise.resolve({ role: "main" }) })).status,
    ).toBe(401);

    requireAdminMock.mockResolvedValueOnce(admin);
    expect(
      (await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ providerId: "p", modelId: "m" }) }) as never, { params: Promise.resolve({ role: "coder" }) })).status,
    ).toBe(422);

    requireAdminMock.mockResolvedValueOnce(admin);
    expect(
      (await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ providerId: "ghost", modelId: "m" }) }) as never, { params: Promise.resolve({ role: "main" }) })).status,
    ).toBe(422);
    expect(repoMock.set).not.toHaveBeenCalled();
  });

  it("PUT 成功：overlay 写入 + 审计 before 含生效值与来源 + bump", async () => {
    requireAdminMock.mockResolvedValueOnce(admin);
    layersMock.mockResolvedValueOnce(catalogLayers);
    const res = await PUT(
      new Request("http://x", {
        method: "PUT",
        body: JSON.stringify({ providerId: "qwen-token-plan-cn", modelId: "qwen3.7-plus", note: "切 vision" }),
      }) as never,
      { params: Promise.resolve({ role: "main" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      roleDefault: { role: "main", providerId: "qwen-token-plan-cn", modelId: "qwen3.7-plus", source: "overlay" },
    });
    expect(repoMock.set).toHaveBeenCalledWith({
      key: "model.roleDefaults.main",
      value: { providerId: "qwen-token-plan-cn", modelId: "qwen3.7-plus" },
      updatedBy: "admin-op",
    });
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "model.config",
        targetId: "role:main",
        before: { providerId: "qwen-token-plan-cn", modelId: "qwen3.8-max", source: "catalog" },
        after: { providerId: "qwen-token-plan-cn", modelId: "qwen3.7-plus" },
      }),
    );
    expect(bumpMock).toHaveBeenCalledTimes(1);
  });

  it("DELETE：清除 overlay 并审计；未设置 422", async () => {
    requireAdminMock.mockResolvedValueOnce(admin);
    repoMock.get.mockResolvedValueOnce({ providerId: "qwen-token-plan-cn", modelId: "qwen3.7-plus" });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }) as never, {
      params: Promise.resolve({ role: "main" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roleDefault: { role: "main", cleared: true } });
    expect(repoMock.remove).toHaveBeenCalledWith("model.roleDefaults.main");
    expect(auditMock.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "model.config",
        before: { overlay: { providerId: "qwen-token-plan-cn", modelId: "qwen3.7-plus" } },
        after: { overlay: null },
      }),
    );

    requireAdminMock.mockResolvedValueOnce(admin);
    repoMock.get.mockResolvedValueOnce(null);
    const notSet = await DELETE(new Request("http://x", { method: "DELETE" }) as never, {
      params: Promise.resolve({ role: "main" }),
    });
    expect(notSet.status).toBe(422);
  });
});
