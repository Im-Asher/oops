import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Drop-in 注册守卫（agent-registry spec「Drop-in 目录注册」）：
 * definitions 目录内一个定义文件一个 Agent，汇总入口 agent/index.ts 一行登记。
 * Turbopack 不支持运行时动态 import（打包不可靠），故以「index 登记 + 本守卫」实现
 * 等效 drop-in：漏登记/幽灵登记必被测试抓住。
 */

const here = dirname(fileURLToPath(import.meta.url));

/** 收集 definitions 目录的定义文件名（排除测试与本守卫辅助文件）。 */
export function listDefinitionFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
}

/** 汇总入口源码中登记的 definitions 模块名（import "./definitions/<name>"）。 */
export function listRegisteredModules(indexSource: string): string[] {
  return [...indexSource.matchAll(/import\s+"\.[\/]definitions\/([^"]+)"/g)]
    .map((m) => m[1])
    .sort();
}

/** 漏登记：目录里有文件但 index 未 import（新 Agent 忘记登记 → 本守卫报红）。 */
export function findUnregistered(files: string[], registered: string[]): string[] {
  return files.filter((f) => !registered.includes(f.replace(/\.ts$/, "")));
}

/** 幽灵登记：index import 了但文件不存在（改名/删除后忘改 index）。 */
export function findPhantom(files: string[], registered: string[]): string[] {
  return registered.filter((r) => !files.includes(`${r}.ts`));
}

describe("definitions drop-in 守卫", () => {
  it("真实目录与真实 index 一致：每个定义文件均登记，登记均有对应文件", () => {
    const files = listDefinitionFiles(join(here, "definitions"));
    const registered = listRegisteredModules(readFileSync(join(here, "index.ts"), "utf8"));
    expect(files.length).toBeGreaterThanOrEqual(2); // 内置两 Agent
    expect(findUnregistered(files, registered)).toEqual([]);
    expect(findPhantom(files, registered)).toEqual([]);
  });

  it("检出演练：漏登记的文件被识别（守卫可红）", () => {
    const files = ["atmosphere-designer.ts", "product-photographer.ts", "poster-designer.ts"];
    const registered = ["atmosphere-designer", "product-photographer"];
    expect(findUnregistered(files, registered)).toEqual(["poster-designer.ts"]);
  });

  it("检出演练：幽灵登记被识别（文件缺失仍登记 → 守卫可红）", () => {
    const files = ["atmosphere-designer.ts", "product-photographer.ts"];
    const registered = ["atmosphere-designer", "product-photographer", "removed-agent"];
    expect(findPhantom(files, registered)).toEqual(["removed-agent"]);
  });
});
