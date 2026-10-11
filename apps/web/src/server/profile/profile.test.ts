import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findById: vi.fn(),
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("@/server/db/user.repo", () => ({
  createUserRepo: () => ({
    findById: h.findById,
    updateProfile: h.updateProfile,
    updatePassword: h.updatePassword,
  }),
}));
vi.mock("@/server/auth/password", () => ({
  verifyPassword: h.verifyPassword,
  hashPassword: h.hashPassword,
}));

import { changePassword, toProfile, updateProfile } from "./profile";

const user = {
  id: "u1",
  username: "alice",
  oopsId: "x7k9m2p4",
  passwordHash: "HASH",
  displayName: "小明",
  gender: "female",
  bio: "做电商图的",
  tokenVersion: 0,
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  inviteCodeId: null,
} as const;

beforeEach(() => {
  h.findById.mockReset();
  h.updateProfile.mockReset();
  h.updatePassword.mockReset();
  h.verifyPassword.mockReset();
  h.hashPassword.mockReset();
});

describe("toProfile", () => {
  it("exposes only profile fields (no hash/status)", () => {
    expect(toProfile(user)).toEqual({
      username: "alice",
      oopsId: "x7k9m2p4",
      displayName: "小明",
      gender: "female",
      bio: "做电商图的",
    });
  });
});

describe("updateProfile", () => {
  it("applies a non-empty patch and returns the updated profile", async () => {
    h.updateProfile.mockResolvedValue({
      ...user,
      displayName: null,
      bio: null,
    });
    const result = await updateProfile("u1", { displayName: null, bio: null });
    expect(h.updateProfile).toHaveBeenCalledWith("u1", {
      displayName: null,
      bio: null,
    });
    expect(result).toEqual({
      ok: true,
      profile: expect.objectContaining({ displayName: null, bio: null }),
    });
  });

  it("returns the current profile for an empty patch without writing", async () => {
    h.findById.mockResolvedValue(user);
    const result = await updateProfile("u1", {});
    expect(h.updateProfile).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, profile: expect.anything() });
  });

  it("reports unauthorized when the user vanished mid-flight", async () => {
    h.updateProfile.mockResolvedValue(undefined);
    const result = await updateProfile("u1", { gender: "male" });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });
});

describe("changePassword", () => {
  it("rejects a wrong current password without any write", async () => {
    h.findById.mockResolvedValue(user);
    h.verifyPassword.mockResolvedValue(false);
    const result = await changePassword({
      userId: "u1",
      currentPassword: "bad",
      newPassword: "12345678",
    });
    expect(result).toEqual({ ok: false, reason: "wrong_current" });
    expect(h.updatePassword).not.toHaveBeenCalled();
    expect(h.hashPassword).not.toHaveBeenCalled();
  });

  it("writes the new hash and returns the bumped token version", async () => {
    h.findById.mockResolvedValue(user);
    h.verifyPassword.mockResolvedValue(true);
    h.hashPassword.mockResolvedValue("NEW_HASH");
    h.updatePassword.mockResolvedValue(1);
    const result = await changePassword({
      userId: "u1",
      currentPassword: "old",
      newPassword: "12345678",
    });
    expect(result).toEqual({ ok: true, tokenVersion: 1 });
    expect(h.updatePassword).toHaveBeenCalledWith("u1", "NEW_HASH");
  });

  it("reports unauthorized when the user no longer exists", async () => {
    h.findById.mockResolvedValue(undefined);
    const result = await changePassword({
      userId: "u1",
      currentPassword: "old",
      newPassword: "12345678",
    });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });
});
