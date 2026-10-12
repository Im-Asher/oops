import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();

vi.mock("@oops/auth", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@oops/db/admin-audit.repo", () => ({
  // 常量与真实仓储保持一致（route 用它们构造 zod 枚举）
  ADMIN_AUDIT_ACTIONS: [
    "user.status_change",
    "invite.create",
    "invite.revoke",
    "credits.adjust",
    "pricing.update",
    "agent.toggle",
    "model.config",
  ] as const,
  ADMIN_AUDIT_TARGET_TYPES: [
    "user",
    "invite_code",
    "credit_price",
    "agent",
    "model_config",
  ] as const,
  createAdminAuditRepo: vi.fn(() => ({ list: listMock })),
}));

import { requireAdmin } from "@oops/auth";
import { GET } from "./route";

const FIXTURE = {
  items: [
    {
      id: "a1",
      adminUserId: "admin1",
      action: "credits.adjust",
      targetType: "user",
      targetId: "u1",
      before: { balance: 100 },
      after: { balance: 150 },
      createdAt: "2026-10-12T08:00:00.000Z",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
};

describe("GET /api/admin/audit（审计查询）", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    listMock.mockReset();
    listMock.mockResolvedValue(FIXTURE);
  });

  it("未认证返回 401 结构化错误", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "请先登录",
    });
    const res = await GET(new Request("http://localhost/api/admin/audit"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("非 admin 返回 403 结构化错误", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "需要管理员权限",
    });
    const res = await GET(new Request("http://localhost/api/admin/audit"));
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("放行分支：过滤参数解析为仓储查询（日期转 Date、分页数字）", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: "admin1" });
    const res = await GET(
      new Request(
        "http://localhost/api/admin/audit?action=credits.adjust&targetType=user&from=2026-01-01T00:00:00.000Z&page=2&pageSize=5",
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(FIXTURE);
    expect(listMock).toHaveBeenCalledWith({
      adminUserId: undefined,
      action: "credits.adjust",
      targetType: "user",
      targetId: undefined,
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: undefined,
      page: 2,
      pageSize: 5,
    });
  });

  it("无过滤参数：默认第一页 20 条", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: "admin1" });
    await GET(new Request("http://localhost/api/admin/audit"));
    expect(listMock).toHaveBeenCalledWith({
      adminUserId: undefined,
      action: undefined,
      targetType: undefined,
      targetId: undefined,
      from: undefined,
      to: undefined,
      page: undefined,
      pageSize: undefined,
    });
  });

  it("非法动作枚举返回 400 INVALID_QUERY", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: "admin1" });
    const res = await GET(
      new Request("http://localhost/api/admin/audit?action=not_an_action"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(listMock).not.toHaveBeenCalled();
  });
});
