import { describe, expect, it } from "vitest";
import type { TextProviderEntry } from "./catalog";
import { ModelConfigError, resolveTextModel } from "./resolver";

const baseEnv = { provider: "qwen-token-plan-cn" };

/** fixture：带 vision 模型的供应商（验证能力满足路径）。 */
const visionProvider: TextProviderEntry = {
  providerId: "fixture-vision",
  label: "Fixture Vision",
  configEnvNames: ["FIXTURE_API_KEY"],
  models: [
    { id: "vision-model", capabilities: ["vision"] },
    { id: "text-only-model", capabilities: [] },
  ],
  roleDefaults: { main: "vision-model", summarizer: "text-only-model" },
};

describe("resolveTextModel 优先级链", () => {
  it("未配置时 main 与 summarizer 解析为同一默认模型（默认行为零回归）", () => {
    const main = resolveTextModel("main", undefined, baseEnv);
    const summarizer = resolveTextModel("summarizer", undefined, baseEnv);
    expect(main).toEqual({ providerId: "qwen-token-plan-cn", modelId: "qwen3.8-max" });
    expect(summarizer.modelId).toBe("qwen3.8-max");
  });

  it("角色级 env 只覆盖对应角色（摘要用覆盖模型，main 不变）", () => {
    const env = { ...baseEnv, summarizerModel: "qwen3.8-max" };
    const summarizer = resolveTextModel("summarizer", undefined, env);
    const main = resolveTextModel("main", undefined, env);
    expect(summarizer.modelId).toBe("qwen3.8-max");
    expect(main.modelId).toBe("qwen3.8-max");
  });

  it("env 覆盖的模型必须登记在目录中", () => {
    const env = { ...baseEnv, mainModel: "no-such-model" };
    expect(() => resolveTextModel("main", undefined, env)).toThrowError(ModelConfigError);
    expect(() => resolveTextModel("main", undefined, env)).toThrowError(/no-such-model/);
  });

  it("未登记的供应商显式报错", () => {
    expect(() => resolveTextModel("main", undefined, { provider: "glm" })).toThrowError(
      /未登记的 LLM 供应商：glm/,
    );
  });
});

describe("vision 模型解析（真实 qwen 目录）", () => {
  const visionDecl = { main: { capabilities: ["vision"] as const } };

  it("env 指向已登记 vision 模型时声明满足", () => {
    const resolved = resolveTextModel("main", visionDecl, {
      ...baseEnv,
      mainModel: "qwen3-vl-plus",
    });
    expect(resolved.modelId).toBe("qwen3-vl-plus");
  });

  it("默认纯文本模型不满足 vision 声明时 fail-fast（含能力名与模型）", () => {
    expect(() => resolveTextModel("main", visionDecl, baseEnv)).toThrowError(
      /qwen3\.8-max[\s\S]*vision/,
    );
  });
});

describe("resolveTextModel 能力需求校验", () => {
  it("声明满足：候选模型具备所需能力时解析通过", () => {
    const resolved = resolveTextModel(
      "main",
      { main: { capabilities: ["vision"] } },
      { provider: "fixture-vision" },
      [visionProvider],
    );
    expect(resolved).toEqual({ providerId: "fixture-vision", modelId: "vision-model" });
  });

  it("声明不满足：默认模型缺能力时显式报错（含能力名与供应商）", () => {
    const textOnlyDefault: TextProviderEntry = {
      ...visionProvider,
      roleDefaults: { main: "text-only-model", summarizer: "text-only-model" },
    };
    expect(() =>
      resolveTextModel(
        "main",
        { main: { capabilities: ["vision"] } },
        { provider: "fixture-vision" },
        [textOnlyDefault],
      ),
    ).toThrowError(/fixture-vision[\s\S]*text-only-model[\s\S]*vision/);
  });

  it("env 覆盖模型不满足声明时同样报错，不静默降级", () => {
    expect(() =>
      resolveTextModel(
        "main",
        { main: { capabilities: ["vision"] } },
        { provider: "fixture-vision", mainModel: "text-only-model" },
        [visionProvider],
      ),
    ).toThrowError(ModelConfigError);
  });

  it("summarizer 不受 main 声明约束", () => {
    const resolved = resolveTextModel(
      "summarizer",
      { main: { capabilities: ["vision"] } },
      { provider: "fixture-vision" },
      [visionProvider],
    );
    expect(resolved.modelId).toBe("text-only-model");
  });
});
