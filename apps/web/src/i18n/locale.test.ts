import { describe, expect, it } from "vitest";
import { resolveLocale } from "./locale";

describe("resolveLocale（cookie → Accept-Language → 默认 zh）", () => {
  describe("cookie 显式选择优先", () => {
    it.each([
      ["en", "zh-CN,zh", "en"],
      ["zh", "en-US,en", "zh"],
      [" en ", "en-US,en", "en"],
    ])("cookie=%s 时忽略 Accept-Language=%s → %s", (cookie, al, expected) => {
      expect(resolveLocale(cookie, al)).toBe(expected);
    });

    it("无 Accept-Language 时仅凭 cookie 生效", () => {
      expect(resolveLocale("en", undefined)).toBe("en");
      expect(resolveLocale("en", null)).toBe("en");
    });
  });

  describe("cookie 非法回落 Accept-Language", () => {
    it("cookie=fr + AL=en → en", () => {
      expect(resolveLocale("fr", "en-US,en;q=0.9")).toBe("en");
    });

    it("cookie=fr + AL=zh → zh", () => {
      expect(resolveLocale("fr", "zh-CN,zh")).toBe("zh");
    });

    it("cookie=fr + AL 无关语言 → 默认 zh", () => {
      expect(resolveLocale("fr", "fr-FR,fr;q=0.9")).toBe("zh");
    });

    it("cookie=空串按缺失处理", () => {
      expect(resolveLocale("", "en")).toBe("en");
    });
  });

  describe("无 cookie 按 Accept-Language 推断", () => {
    it("en 系归 en", () => {
      expect(resolveLocale(undefined, "en-US,en;q=0.9")).toBe("en");
    });

    it("zh 系归 zh", () => {
      expect(resolveLocale(undefined, "zh-CN,zh")).toBe("zh");
    });

    it("按 q 值取首选（zh 声明更高 q → zh）", () => {
      expect(resolveLocale(undefined, "en;q=0.5,zh;q=0.9")).toBe("zh");
      expect(resolveLocale(undefined, "zh;q=0.5,en;q=0.9")).toBe("en");
    });

    it("q 非法视作 1，保持声明顺序", () => {
      expect(resolveLocale(undefined, "zh;q=abc,en")).toBe("zh");
    });

    it("无关语言/通配符/空头 → 默认 zh", () => {
      expect(resolveLocale(undefined, "fr-FR,fr;q=0.9")).toBe("zh");
      expect(resolveLocale(undefined, "*")).toBe("zh");
      expect(resolveLocale(undefined, "")).toBe("zh");
    });
  });

  describe("两者皆缺 → 默认 zh", () => {
    it("cookie 与 AL 均缺失", () => {
      expect(resolveLocale(undefined, undefined)).toBe("zh");
      expect(resolveLocale(null, null)).toBe("zh");
    });
  });
});
