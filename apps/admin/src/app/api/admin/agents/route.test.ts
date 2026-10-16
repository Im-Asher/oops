import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminMock, resolveMock, bumpMock, repoMock, auditMock, txMarker } =
  vi.hoisted(() => ({
    requireAdminMock: vi.fn(),
    resolveMock: vi.fn(),
    bumpMock: vi.fn(),
    repoMock: {
      getMany: vi.fn(),
      set: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(),
    },
    auditMock: { record: vi.fn() },
    txMarker: Symbol("tx"),
  }));

vi.mock("@oops/auth", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@oops/db", () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(txMarker) },
}));
vi.mock("@oops/db/app-config.repo", () => ({
  createAppConfigRepo: vi.fn(() => repoMock),
}));
vi.mock("@oops/db/admin-audit.repo", () => ({
  createAdminAuditRepo: vi.fn(() => auditMock),
}));
vi.mock("@oops/llm", () => ({
  resolveAgentEnabled: resolveMock,
  bumpRuntimeConfigGeneration: bumpMock,
}));

import { GET } from "./route";
import { PATCH } from "./[id]/enabled/route";

const admin = { ok: true, userId: "admin-op" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/agents", () => {
  it("401/403：守卫拒绝", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" });
    expect((await GET(new Request("http://x") as never)).status).toBe(401);
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" });
    expect((await GET(new Request("http://x") as never)).status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("200：返回清单 + 生效态与来源层；reader 桥接 app_config getMany", async () => {
    requireAdminMock.mockResolvedValueOnce(admin);
    resolveMock.mockImplementation(async (agentId: string) =>
      agentId === "poster-designer"
        ? { enabled: false, source: "overlay" }
        : { enabled: true, source: "catalog" },
    );
    repoMock.getMany.mockResolvedValueOnce(new Map());
    const res = await GET(new Request("http://x") as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<Record<string, unknown>> };
    expect(body.agents).toHaveLength(3);
    expect(body.agents.find((a) => a.id === "poster-designer")).toEqual({
      id: "poster-designer",
      name: "海报设计师",
      enabled: false,
      source: "overlay",
    });
    expect(body.agents.find((a) => a.id === "atmosphere-designer")).toMatchObject({
      enabled: true,
      source: "catalog",
    });
  });
});

describe("PATCH /api/admin/agents/[id]/enabled", () => {
  it("401/403/未登记 agent 422/body 非法 400", async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 401, code: "UNAUTHORIZED", message: "未登录" });
    expect(
      (await PATCH(new Request("http://x", { method: "PATCH" }) as never, { params: Promise.resolve({ id: "poster-designer" }) })).status,
    ).toBe(401);

    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 403, code: "FORBIDDEN", message: "需要管理员权限" });
    expect(
      (await PATCH(new Request("http://x", { method: "PATCH" }) as never, { params: Promise.resolve({ id: "poster-designer" }) })).status,
    ).toBe(403);

    requireAdminMock.mockResolvedValueOnce(admin);
    const unknownRes = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: true }) }) as never,
      { params: Promise.resolve({ id: "ghost-agent" }) },
    );
    expect(unknownRes.status).toBe(422);
    expect(((await unknownRes.json()) as { error: { code: string } }).error.code).toBe("AGENT_UNKNOWN");

    requireAdminMock.mockResolvedValueOnce(admin);
    const badBody = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ enabled: "yes" }) }) as never,
      { params: Promise.resolve({ id: "poster-designer" }) },
    );
    expect(badBody.status).toBe(400);
    expect(repoMock.set).not.toHaveBeenCalled();
    expect(auditMock.record).not.toHaveBeenCalled();
  });

  it("切换成功：overlay 写入 + 同事务审计（before 含来源层）+ bump 本进程缓存 + 返回生效值", async () => {
    requireAdminMock.mockResolvedValueOnce(admin);
    resolveMock.mockResolvedValueOnce({ enabled: true, source: "catalog" });
    repoMock.set.mockResolvedValueOnce(undefined);
    auditMock.record.mockResolvedValueOnce({});

    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false, note: "下线海报" }),
      }) as never,
      { params: Promise.resolve({ id: "poster-designer" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      agent: { id: "poster-designer", name: "海报设计师", enabled: false, source: "overlay" },
    });
    // 事务直通 txMarker：repo 与 audit 收到同一 tx
    expect(repoMock.set).toHaveBeenCalledWith({
      key: "agent.poster-designer.enabled",
      value: false,
      updatedBy: "admin-op",
    });
    expect(auditMock.record).toHaveBeenCalledWith({
      adminUserId: "admin-op",
      action: "agent.toggle",
      targetType: "agent",
      targetId: "poster-designer",
      before: { enabled: true, source: "catalog" },
      after: { enabled: false },
      note: "下线海报",
    });
    expect(bumpMock).toHaveBeenCalledTimes(1);
  });
});
