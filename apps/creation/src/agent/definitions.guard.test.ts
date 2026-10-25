import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentRegistry } from "./index";

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

/**
 * 跨端一致性守卫：Agent 的 preset key 只存在于创作域的 definitions 里，文案却在
 * web 的 next-intl 词典里。key 改名/新增而词典没跟上时，resolvePresets 会**静默**
 * 把 key 原样透传给用户（看起来像乱码需求），所以必须在这里红。
 * 直接读兄弟 app 的词典文件：本用例是构建期守卫，不产生运行时依赖。
 */
describe("preset key ↔ web 词典一致性", () => {
  const dictionaryDir = join(here, "../../..", "web/messages");

  it("所有 definitions 的 preset key 在 zh / en 词典均有登记", () => {
    for (const locale of ["zh", "en"] as const) {
      const dict = JSON.parse(readFileSync(join(dictionaryDir, `${locale}.json`), "utf8")) as {
        chat?: { presets?: Record<string, Record<string, string>> };
      };
      for (const agent of agentRegistry.list()) {
        for (const key of agent.presets) {
          expect(dict.chat?.presets?.[agent.id]?.[key], `${locale}: ${agent.id}#${key}`).toBeTruthy();
        }
      }
    }
  });
});

describe("present_options 声明守卫（HITL 选项卡）", () => {
  it("每个注册 Agent 的 tools 均声明 present_options，且按名授权装配后可拿到（漏声明即守卫报红）", () => {
    const agents = agentRegistry.list();
    expect(agents.length).toBeGreaterThanOrEqual(3); // 内置三 Agent
    const missingDeclared = agents.filter((a) => !a.tools.includes("present_options")).map((a) => a.id);
    expect(missingDeclared).toEqual([]);
    const ctx = { userId: "u-guard", sessionId: "s-guard" };
    for (const agent of agents) {
      const assembled = agentRegistry.getAgentTools(agent.id, ctx);
      expect(assembled.some((t) => t.name === "present_options"), agent.id).toBe(true);
    }
  });
});
