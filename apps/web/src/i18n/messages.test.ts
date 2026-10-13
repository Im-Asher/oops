import { describe, expect, it } from "vitest";
import zh from "../../messages/zh.json";
import en from "../../messages/en.json";
import {
  deepMerge,
  defaultLocale,
  getMessages,
  isSupportedLocale,
  locales,
  LOCALE_COOKIE,
} from "./messages";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return prefix ? [prefix] : [];
  return entries.flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("i18n messages", () => {
  it("zh 与 en 词典键集合对齐（防回流门槛）", () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(zh).sort());
  });

  it("en 形状与 zh 逐类型一致（编译期断言：叶子类型漂移在 tsc 报错）", () => {
    const enShape: typeof zh = en;
    void enShape;
  });

  it("常量：locale 集合、默认值与 cookie 名", () => {
    expect(locales).toEqual(["zh", "en"]);
    expect(defaultLocale).toBe("zh");
    expect(LOCALE_COOKIE).toBe("oops-locale");
  });

  it("isSupportedLocale 仅接受受支持语言", () => {
    expect(isSupportedLocale("zh")).toBe(true);
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("fr")).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
  });

  describe("deepMerge（en 缺失回落 zh）", () => {
    const base = {
      kept: "zh-kept",
      nested: { a: "zh-a", b: { c: "zh-c" } },
    };

    it("override 值胜出、缺失 key 回落 base", () => {
      const merged = deepMerge(base, {
        kept: "en-kept",
        nested: { b: { d: "en-d" } },
      });
      expect(merged).toEqual({
        kept: "en-kept",
        nested: { a: "zh-a", b: { c: "zh-c", d: "en-d" } },
      });
    });

    it("数组整体替换而非按下标合并；null 值胜出；override 新增 key 保留", () => {
      const merged = deepMerge(
        { list: ["a"], flag: "zh-flag", nested: { x: "zh-x" } },
        { list: ["b", "c"], flag: null, nested: { y: "en-y" } },
      );
      expect(merged).toEqual({
        list: ["b", "c"],
        flag: null,
        nested: { x: "zh-x", y: "en-y" },
      });
    });

    it("不修改输入对象", () => {
      const baseCopy = structuredClone(base);
      const override = { nested: { b: { d: "en-d" } } };
      const overrideCopy = structuredClone(override);
      deepMerge(base, override);
      expect(base).toEqual(baseCopy);
      expect(override).toEqual(overrideCopy);
    });
  });

  it("getMessages('zh') 返回基准词典；getMessages('en') 覆盖全部 zh 键", () => {
    expect(getMessages("zh")).toEqual(zh);
    const enMessages = getMessages("en");
    for (const path of keyPaths(zh)) {
      expect(enMessages, `en 缺失 key: ${path}`).toHaveProperty(path);
    }
  });
});
