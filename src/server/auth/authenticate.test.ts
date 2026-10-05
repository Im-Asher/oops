import { describe, expect, it, vi } from "vitest";
import { hashPassword } from "./password";

vi.mock("@/server/db/user.repo", () => ({
  createUserRepo: () => ({ findByUsername: findByUsernameMock }),
}));

const findByUsernameMock = vi.fn<(username: string) => Promise<unknown>>();

import { authenticate } from "./authenticate";

describe("authenticate", () => {
  it("returns the userId and token version for correct credentials", async () => {
    const hash = await hashPassword("correct-password");
    findByUsernameMock.mockResolvedValue({
      id: "u1",
      username: "alice",
      passwordHash: hash,
      tokenVersion: 0,
    });
    await expect(authenticate("alice", "correct-password")).resolves.toEqual({
      userId: "u1",
      tokenVersion: 0,
    });
  });

  it("returns null for a wrong password", async () => {
    const hash = await hashPassword("correct-password");
    findByUsernameMock.mockResolvedValue({ id: "u1", passwordHash: hash });
    await expect(authenticate("alice", "wrong")).resolves.toBeNull();
  });

  it("returns null for an unknown user without throwing", async () => {
    findByUsernameMock.mockResolvedValue(undefined);
    await expect(authenticate("ghost", "whatever")).resolves.toBeNull();
  });
});
