import { describe, expect, it } from "vitest";
import { createClient } from "./http";

function fakeFetch(calls: { url: string; init?: RequestInit }[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/api/auth/login")) {
      return new Response(JSON.stringify({ user: { id: "u1" } }), {
        status: 200,
        headers: { "set-cookie": "oops_session=abc; Path=/; HttpOnly" },
      });
    }
    if (String(url).endsWith("/api/sessions")) {
      return new Response(JSON.stringify({ id: "s1" }), { status: 200 });
    }
    if (String(url).endsWith("/upload")) {
      return new Response(JSON.stringify({ url: "/files/x.png", assetId: "a1" }), { status: 201 });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("createClient", () => {
  it("登录后把 cookie 带到后续请求", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const c = createClient({ baseUrl: "http://x", fetchImpl: fakeFetch(calls) });
    await c.login("u", "p");
    await c.createSession("poster-designer");
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.cookie).toContain("oops_session=abc");
  });

  it("登录失败抛 LoginFailed", async () => {
    const c = createClient({
      baseUrl: "http://x",
      fetchImpl: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch,
    });
    await expect(c.login("u", "p")).rejects.toThrow(/登录失败/);
  });

  it("上传参考图返回 assetId 与 /files/ url", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const c = createClient({ baseUrl: "http://x", fetchImpl: fakeFetch(calls) });
    await c.login("u", "p");
    const uploaded = await c.uploadReference("s1", new Blob([new Uint8Array([1])]), "x.png");
    expect(uploaded).toEqual({ assetId: "a1", url: "/files/x.png" });
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.cookie).toContain("oops_session=abc");
  });
});
