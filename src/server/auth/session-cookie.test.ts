import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  createSessionCookieValue,
  parseSessionCookieValue,
  readSessionCookie,
  sessionCookieAttributes,
} from "./session-cookie";

const SECRET = "unit-test-secret-0123456789abcdef-unit-test";

describe("session cookie", () => {
  it("roundtrips a valid payload", () => {
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000 },
      SECRET,
    );
    expect(parseSessionCookieValue(value, SECRET)).toEqual({
      userId: "u1",
      exp: 1_800_000_000,
    });
  });

  it("rejects a tampered payload", () => {
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000 },
      SECRET,
    );
    const [body, sig] = value.split(".");
    // 同长度篡改：把 base64url 末位换掉
    const tampered = `${body.slice(0, -1)}A.${sig}`;
    expect(parseSessionCookieValue(tampered, SECRET)).toBeUndefined();
  });

  it("rejects a forged signature", () => {
    const body = Buffer.from(JSON.stringify({ userId: "u1", exp: 1_800_000_000 })).toString("base64url");
    expect(parseSessionCookieValue(`${body}.forged-signature`, SECRET)).toBeUndefined();
  });

  it("rejects an expired payload", () => {
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_000 },
      SECRET,
    );
    expect(parseSessionCookieValue(value, SECRET)).toBeUndefined();
  });

  it("rejects structurally invalid values", () => {
    expect(parseSessionCookieValue(undefined, SECRET)).toBeUndefined();
    expect(parseSessionCookieValue("", SECRET)).toBeUndefined();
    expect(parseSessionCookieValue("no-dot", SECRET)).toBeUndefined();
    expect(
      parseSessionCookieValue(
        `${Buffer.from('{"userId":1}').toString("base64url")}.x`,
        SECRET,
      ),
    ).toBeUndefined();
  });

  it("reads the session cookie from a Cookie header", () => {
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=abc; other=1`)).toBe("abc");
    expect(readSessionCookie("other=1")).toBeUndefined();
  });

  it("builds hardened Set-Cookie attributes", () => {
    expect(sessionCookieAttributes(100)).toBe(
      "HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=100",
    );
  });
});
