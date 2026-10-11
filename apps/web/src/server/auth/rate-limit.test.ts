import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, rateLimit, resetRateLimits } from "./rate-limit";

afterEach(() => {
  vi.useRealTimers();
  resetRateLimits();
});

describe("rateLimit", () => {
  it("allows requests under the threshold", () => {
    expect([1, 2, 3].map(() => rateLimit("k", 3))).toEqual([true, true, true]);
  });

  it("blocks requests over the threshold", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3);
    expect(rateLimit("k", 3)).toBe(false);
    expect(rateLimit("k", 3)).toBe(false);
  });

  it("re-opens after the sliding window passes", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) rateLimit("k", 3);
    expect(rateLimit("k", 3)).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit("k", 3)).toBe(true);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 3; i++) rateLimit("a", 3);
    expect(rateLimit("a", 3)).toBe(false);
    expect(rateLimit("b", 3)).toBe(true);
  });
});

describe("clientIp", () => {
  it("prefers the first x-forwarded-for entry", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(clientIp(req)).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip then unknown", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "3.3.3.3" } }))).toBe("3.3.3.3");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
