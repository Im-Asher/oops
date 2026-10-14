import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ANTD_THEME_TOKEN } from "./theme";

/**
 * admin ↔ web 设计 token 一致性守卫（docs/DESIGN.md B7.5）。
 *
 * 两应用消费 token 的机制不同（antd ConfigProvider vs Tailwind @theme），
 * 靠人工记忆同步必然分叉；此测试把「同值」变成硬约束。
 */
const here = dirname(fileURLToPath(import.meta.url));
const webGlobalsCss = readFileSync(
  resolve(here, "../../../../apps/web/src/app/globals.css"),
  "utf-8",
);

/** 从 web 的 globals.css 里取出某个自定义属性的字面值。 */
function cssVar(name: string): string {
  const match = webGlobalsCss.match(new RegExp(`${name.replace(/-/g, "\\-")}:\\s*([^;]+);`));
  if (!match) throw new Error(`web globals.css 未声明 ${name}`);
  return match[1].trim().toLowerCase();
}

describe("admin antd token 与 web 设计 token 同源", () => {
  it("colorPrimary = --brand-violet-500", () => {
    expect(ANTD_THEME_TOKEN.colorPrimary).toBe(cssVar("--brand-violet-500"));
  });

  it("colorInfo = --brand-cyan-500", () => {
    expect(ANTD_THEME_TOKEN.colorInfo).toBe(cssVar("--brand-cyan-500"));
  });

  it("borderRadius = --radius（rem→px）", () => {
    const rem = Number.parseFloat(cssVar("--radius"));
    expect(ANTD_THEME_TOKEN.borderRadius).toBeCloseTo(rem * 16);
  });

  it("colorError 独立于品牌色（语义红不参与品牌化，B2.3）", () => {
    const brandHues = ["--brand-violet-500", "--brand-cyan-500"];
    for (const token of brandHues) {
      expect(ANTD_THEME_TOKEN.colorError).not.toBe(cssVar(token));
    }
  });
});
