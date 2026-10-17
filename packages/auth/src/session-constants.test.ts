import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "./session-constants";

// 本模块被 apps/admin 的 proxy.ts 深导入（Edge 运行时），引入 node:* 会直接构建失败。
// 校验方式落到源码文本断言——类型层面无法表达"必须零依赖"。
describe("session-constants（Edge-safe 常量）", () => {
  it("管理端 cookie 名与 web 端不同名（登录语义不依赖部署形态）", () => {
    expect(ADMIN_SESSION_COOKIE_NAME).toBe("oops_admin_session");
    expect(ADMIN_SESSION_COOKIE_NAME).not.toBe(SESSION_COOKIE_NAME);
  });

  it("web 端常量保持既有取值", () => {
    expect(SESSION_COOKIE_NAME).toBe("oops_session");
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("不引入 node:* 或任何运行时依赖", () => {
    const src = readFileSync(new URL("./session-constants.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/["']node:/);
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
