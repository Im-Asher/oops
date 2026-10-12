import { describe, expect, it, vi, beforeEach } from "vitest";

const listForAdminMock = vi.fn();

vi.mock("@oops/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@oops/db/user.repo", () => ({
  createUserRepo: vi.fn(() => ({ listForAdmin: listForAdminMock })),
}));

import { requireAdmin } from "@oops/auth";
import { GET } from "./route";

const FIXTURE = {
  items: [{ id: "u1", username: "alice", status: "active" }],
  total: 1,
  page: 1,
  pageSize: 20,
};

describe("GET /api/admin/users（用户列表）", () => {
  beforeEach(() => {
    vi.mocked(requireAdmin).mockReset();
    listForAdminMock.mockReset();
    listForAdminMock.mockResolvedValue(FIXTURE);
  });

  it("未认证 401，不执行业务", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      message: "请先登录",
    });
    const res = await GET(new Request("http://localhost/api/admin/users"));
    expect(res.status).toBe(401);
    expect(listForAdminMock).not.toHaveBeenCalled();
  });

  it("非 admin 403，不执行业务", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      message: "需要管理员权限",
    });
    const res = await GET(new Request("http://localhost/api/admin/users"));
    expect(res.status).toBe(403);
    expect(listForAdminMock).not.toHaveBeenCalled();
  });

  it("放行：搜索与分页参数透传仓储", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: "admin1" });
    const res = await GET(
      new Request("http://localhost/api/admin/users?search=ali&page=2&pageSize=5"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FIXTURE);
    expect(listForAdminMock).toHaveBeenCalledWith({
      search: "ali",
      page: 2,
      pageSize: 5,
    });
  });

  it("非法分页参数 400", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, userId: "admin1" });
    const res = await GET(
      new Request("http://localhost/api/admin/users?page=0"),
    );
    expect(res.status).toBe(400);
    expect(listForAdminMock).not.toHaveBeenCalled();
  });
});
