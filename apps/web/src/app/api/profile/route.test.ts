import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findById: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("@/server/auth/require-user", () => ({ requireUser: h.requireUser }));
vi.mock("@/server/db/user.repo", () => ({
  createUserRepo: () => ({ findById: h.findById }),
}));
vi.mock("@/server/profile/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/profile/profile")>()),
  updateProfile: h.updateProfile,
}));

import { GET, PATCH } from "./route";

const profile = {
  username: "alice",
  oopsId: "x7k9m2p4",
  displayName: "小明",
  gender: "female",
  bio: "做电商图的",
};

beforeEach(() => {
  h.requireUser.mockReset();
  h.requireUser.mockResolvedValue("u1");
  h.findById.mockReset();
  h.updateProfile.mockReset();
});

function request(method: "GET" | "PATCH", body?: unknown): Request {
  return new Request("http://localhost/api/profile", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/profile", () => {
  it("401 未认证", async () => {
    h.requireUser.mockResolvedValueOnce(null);
    const res = await GET(request("GET"));
    expect(res.status).toBe(401);
  });

  it("返回 username/oopsId/displayName/gender/bio", async () => {
    h.requireUser.mockResolvedValueOnce("u1");
    h.findById.mockResolvedValueOnce({ ...profile, passwordHash: "HASH" });
    const res = await GET(request("GET"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual(profile);
    expect(body).not.toHaveProperty("passwordHash");
  });
});

describe("PATCH /api/profile", () => {
  it("部分更新成功并返回完整资料", async () => {
    h.updateProfile.mockResolvedValueOnce({
      ok: true,
      profile: { ...profile, displayName: "新名", bio: null },
    });
    const res = await PATCH(
      request("PATCH", { displayName: " 新名 ", bio: "" }),
    );
    expect(res.status).toBe(200);
    // 空串已转换为 null（清除语义），trim 已生效
    expect(h.updateProfile).toHaveBeenCalledWith("u1", {
      displayName: "新名",
      bio: null,
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ...profile, displayName: "新名", bio: null });
  });

  it("username/oopsId 等只读与未知字段被忽略", async () => {
    h.updateProfile.mockResolvedValueOnce({
      ok: true,
      profile: { ...profile, gender: "male" },
    });
    await PATCH(
      request("PATCH", { username: "hacker", oopsId: "aaaa2222", gender: "male" }),
    );
    expect(h.updateProfile).toHaveBeenCalledWith("u1", { gender: "male" });
  });

  it.each([
    [{ displayName: "长".repeat(21) }, "昵称至多 20 个字符"],
    [{ bio: "长".repeat(61) }, "个性签名至多 60 个字符"],
    [{ gender: "other" }, null],
  ])("非法输入（%j）：400 且不触达服务层", async (body, message) => {
    const res = await PATCH(request("PATCH", body));
    expect(res.status).toBe(400);
    if (message) {
      const json = (await res.json()) as { error: { message: string } };
      expect(json.error.message).toBe(message);
    }
    expect(h.updateProfile).not.toHaveBeenCalled();
  });

  it("非 JSON 请求体：400", async () => {
    h.requireUser.mockResolvedValueOnce("u1");
    const res = await PATCH(
      new Request("http://localhost/api/profile", {
        method: "PATCH",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("401 未认证", async () => {
    h.requireUser.mockResolvedValueOnce(null);
    const res = await PATCH(request("PATCH", { gender: "male" }));
    expect(res.status).toBe(401);
  });
});
