import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  createSessionCookieValue,
  parseSessionCookieValue,
  readSessionCookie,
  sessionCookieAttributes,
  sessionCookieHeader,
} from "./session-cookie";

const SECRET = "unit-test-secret-0123456789abcdef-unit-test";

function payloadOf(header: string): Record<string, unknown> {
  const token = header.split(";")[0].split("=").slice(1).join("=");
  const [body] = token.split(".");
  return JSON.parse(Buffer.from(body, "base64url").toString()) as Record<
    string,
    unknown
  >;
}

describe("session cookie", () => {
  it("roundtrips a valid payload with a token version", () => {
    const value = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000, tv: 3 },
      SECRET,
    );
    expect(parseSessionCookieValue(value, SECRET)).toEqual({
      userId: "u1",
      exp: 1_800_000_000,
      tv: 3,
    });
  });

  it("treats a legacy payload without tv as version 0", () => {
    // 存量 cookie 载荷无 tv：视为版本 0，部署后不强制全员重登
    const legacy = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000 },
      SECRET,
    );
    expect(parseSessionCookieValue(legacy, SECRET)).toEqual({
      userId: "u1",
      exp: 1_800_000_000,
      tv: 0,
    });
  });

  it("rejects a non-numeric tv", () => {
    const body = Buffer.from(
      JSON.stringify({ userId: "u1", exp: 1_800_000_000, tv: "x" }),
    ).toString("base64url");
    const sig = createSessionCookieValue(
      { userId: "u1", exp: 1_800_000_000, tv: 0 },
      SECRET,
    ).split(".")[1];
    expect(parseSessionCookieValue(`${body}.${sig}`, SECRET)).toBeUndefined();
  });

  it("embeds the token version in the issued header", () => {
    const header = sessionCookieHeader("u1", SECRET, 2);
    expect(payloadOf(header)).toMatchObject({ userId: "u1", tv: 2 });
    expect(header).toContain("HttpOnly");
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
