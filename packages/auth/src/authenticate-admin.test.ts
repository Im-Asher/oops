import { describe, expect, it, vi } from "vitest";
import { hashPassword } from "./password";

vi.mock("@oops/db/user.repo", () => ({
  createUserRepo: () => ({ findByUsername: findByUsernameMock }),
}));

const findByUsernameMock = vi.fn<(username: string) => Promise<unknown>>();

import { authenticateAdmin } from "./authenticate-admin";

describe("authenticateAdmin", () => {
  it("returns the identity for an active admin", async () => {
    const hash = await hashPassword("correct-password");
    findByUsernameMock.mockResolvedValue({
      id: "owner",
      username: "owner",
      passwordHash: hash,
      role: "admin",
      status: "active",
      tokenVersion: 3,
    });
    await expect(authenticateAdmin("owner", "correct-password")).resolves.toEqual({
      userId: "owner",
      tokenVersion: 3,
    });
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-password");
    findByUsernameMock.mockResolvedValue({
      id: "owner",
      passwordHash: hash,
      role: "admin",
      status: "active",
    });
    await expect(authenticateAdmin("owner", "wrong")).resolves.toBeNull();
  });

  it("rejects an unknown user", async () => {
    findByUsernameMock.mockResolvedValue(undefined);
    await expect(authenticateAdmin("ghost", "whatever")).resolves.toBeNull();
  });

  it("rejects a non-admin account with the same null result (no role leakage)", async () => {
    const hash = await hashPassword("correct-password");
    findByUsernameMock.mockResolvedValue({
      id: "u1",
      passwordHash: hash,
      role: "user",
      status: "active",
    });
    // 与密码错误返回相同形状——路由据此给出统一文案，无从区分"账号非管理员"
    await expect(authenticateAdmin("u1", "correct-password")).resolves.toBeNull();
  });

  it("rejects a disabled admin", async () => {
    const hash = await hashPassword("correct-password");
    findByUsernameMock.mockResolvedValue({
      id: "owner",
      passwordHash: hash,
      role: "admin",
      status: "disabled",
    });
    await expect(authenticateAdmin("owner", "correct-password")).resolves.toBeNull();
  });
});
