import { afterEach, describe, expect, it, vi } from "vitest";

const KEY = "NEXT_PUBLIC_APP_VERSION";
const original = process.env[KEY];

function setEnv(value: string | undefined) {
  if (value === undefined) {
    delete process.env[KEY];
  } else {
    process.env[KEY] = value;
  }
}

/** 模块在导入时读取 env，测试需重置模块注册表后重新加载。 */
async function loadVersion(): Promise<string> {
  vi.resetModules();
  const mod = await import("./version");
  return mod.APP_VERSION;
}

afterEach(() => {
  setEnv(original);
  vi.resetModules();
});

describe("APP_VERSION", () => {
  it("未注入构建版本时回退 package.json version", async () => {
    setEnv(undefined);
    expect(await loadVersion()).toBe("0.1.0");
  });

  it("构建注入的 NEXT_PUBLIC_APP_VERSION 优先", async () => {
    setEnv("2.3.4-beta.1");
    expect(await loadVersion()).toBe("2.3.4-beta.1");
  });

  it("注入空白值视为未注入", async () => {
    setEnv("   ");
    expect(await loadVersion()).toBe("0.1.0");
  });
});
