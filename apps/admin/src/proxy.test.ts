import { describe, expect, it } from "vitest";
import { hasSessionCookie } from "./proxy";

describe("hasSessionCookie（入口层存在性判定）", () => {
  it("无头 / 空头 → false", () => {
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasSessionCookie("")).toBe(false);
  });

  it("含非空 oops_session → true", () => {
    expect(hasSessionCookie("oops_session=abc.def.ghi")).toBe(true);
    expect(hasSessionCookie("other=1; oops_session=abc; extra=2")).toBe(true);
  });

  it("只有其他 cookie → false", () => {
    expect(hasSessionCookie("other=1; extra=2")).toBe(false);
  });

  it("oops_session 值为空 → false（存在性 = 有值）", () => {
    expect(hasSessionCookie("oops_session=")).toBe(false);
    expect(hasSessionCookie("oops_session=; other=1")).toBe(false);
  });
});
