import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCookieValue } from "./session-cookie";
import { requireUser } from "./require-user";

vi.mock("@/server/db/user.repo", () => ({
  createUserRepo: vi.fn(() => ({ findById: findByIdMock })),
}));

const findByIdMock = vi.fn<(id: string) => Promise<unknown>>();

const SECRET = "unit-test-secret-0123456789abcdef-unit-test";

function requestWithCookie(value?: string): Request {
  const headers = new Headers();
  if (value !== undefined) headers.set("cookie", `oops_session=${value}`);
  return new Request("http://localhost/api/sessions", { headers });
}

beforeEach(() => {
  findByIdMock.mockReset();
});

describe("requireUser", () => {
  it("returns the userId for a legacy cookie (no tv) against token_version 0", async () => {
    findByIdMock.mockResolvedValue({
      id: "u1",
      status: "active",
      tokenVersion: 0,
    });
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000 },
      SECRET,
    );
    await expect(requireUser(requestWithCookie(value))).resolves.toBe("u1");
  });

  it("returns the userId when the token version matches", async () => {
    findByIdMock.mockResolvedValue({
      id: "u1",
      status: "active",
      tokenVersion: 2,
    });
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000, tv: 2 },
      SECRET,
    );
    await expect(requireUser(requestWithCookie(value))).resolves.toBe("u1");
  });

  it("rejects a cookie whose token version lags behind the user (kicked session)", async () => {
    findByIdMock.mockResolvedValue({
      id: "u1",
      status: "active",
      tokenVersion: 1,
    });
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000, tv: 0 },
      SECRET,
    );
    await expect(requireUser(requestWithCookie(value))).resolves.toBeNull();
  });

  it("rejects a legacy cookie for a user whose version has advanced", async () => {
    findByIdMock.mockResolvedValue({
      id: "u1",
      status: "active",
      tokenVersion: 3,
    });
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000 },
      SECRET,
    );
    await expect(requireUser(requestWithCookie(value))).resolves.toBeNull();
  });

  it("returns null when the user is disabled", async () => {
    findByIdMock.mockResolvedValue({
      id: "u1",
      status: "disabled",
      tokenVersion: 0,
    });
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000 },
      SECRET,
    );
    await expect(requireUser(requestWithCookie(value))).resolves.toBeNull();
  });

  it("returns null when the user no longer exists", async () => {
    findByIdMock.mockResolvedValue(undefined);
    const value = createSessionCookieValue(
      { userId: "ghost", exp: 1_800_000_000 },
      SECRET,
    );
    await expect(requireUser(requestWithCookie(value))).resolves.toBeNull();
  });

  it("returns null for an expired cookie without hitting the DB", async () => {
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_000 },
      SECRET,
    );
    await expect(requireUser(requestWithCookie(value))).resolves.toBeNull();
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("returns null for a forged cookie and missing cookie", async () => {
    await expect(requireUser(requestWithCookie("forged.value"))).resolves.toBeNull();
    await expect(requireUser(requestWithCookie(undefined))).resolves.toBeNull();
    expect(findByIdMock).not.toHaveBeenCalled();
  });
});
