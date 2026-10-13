import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAppEnv } from "./load-env";

// 唯一键名避免污染真实 env；每例前后快照恢复。
const KEY = "TEST_LOAD_ENV_PROBE";

let root: string;
let app: string;
let saved: string | undefined;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "oops-env-root-"));
  app = mkdtempSync(path.join(tmpdir(), "oops-env-app-"));
  saved = process.env[KEY];
  delete process.env[KEY];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(app, { recursive: true, force: true });
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe("loadAppEnv", () => {
  it("仅根层有键时读到根值", () => {
    writeFileSync(path.join(root, ".env.local"), `${KEY}=from-root\n`);
    loadAppEnv(root, app);
    expect(process.env[KEY]).toBe("from-root");
  });

  it("根与 app 同键时 app 层胜出（override 方向断言）", () => {
    writeFileSync(path.join(root, ".env.local"), `${KEY}=from-root\n`);
    writeFileSync(path.join(app, ".env.local"), `${KEY}=from-app\n`);
    loadAppEnv(root, app);
    expect(process.env[KEY]).toBe("from-app");
  });

  it("app 层内 .env.local 胜出 .env（与 Next 优先级一致）", () => {
    writeFileSync(path.join(app, ".env"), `${KEY}=from-app-env\n`);
    writeFileSync(path.join(app, ".env.local"), `${KEY}=from-app-local\n`);
    loadAppEnv(root, app);
    expect(process.env[KEY]).toBe("from-app-local");
  });

  it("process.env 已有值不被根层覆盖（Next builtin 先行加载的语义）", () => {
    process.env[KEY] = "preinjected";
    writeFileSync(path.join(root, ".env.local"), `${KEY}=from-root\n`);
    loadAppEnv(root, app);
    expect(process.env[KEY]).toBe("preinjected");
  });

  it("文件缺失静默跳过", () => {
    expect(() => loadAppEnv(root, app)).not.toThrow();
    expect(process.env[KEY]).toBeUndefined();
  });

  it("省略 appDir 时仅加载根层（脚本类入口如 drizzle-kit）", () => {
    writeFileSync(path.join(app, ".env.local"), `${KEY}=from-app\n`);
    loadAppEnv(root);
    expect(process.env[KEY]).toBeUndefined();
  });
});
