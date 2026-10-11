import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_PROVIDER_ID,
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  findImageProvider,
  findTextProvider,
  type TextProviderEntry,
} from "./catalog";

describe("catalog 目录结构校验", () => {
  it("默认供应商存在于文本域目录", () => {
    expect(findTextProvider(DEFAULT_TEXT_PROVIDER_ID)).toBeDefined();
  });

  it("roleDefaults 引用的模型 id 均登记在该条目内", () => {
    for (const p of TEXT_PROVIDERS as readonly TextProviderEntry[]) {
      for (const role of ["main", "summarizer"] as const) {
        expect(
          p.models.some((m) => m.id === p.roleDefaults[role]),
          `${p.providerId}.${role} 默认模型 ${p.roleDefaults[role]} 未登记`,
        ).toBe(true);
      }
    }
  });

  it("图像域 defaultModelId 均登记在该条目内", () => {
    for (const p of IMAGE_PROVIDERS) {
      expect(p.models.some((m) => m.id === p.defaultModelId)).toBe(true);
    }
  });
});

describe("qwen 默认条目与现状一致", () => {
  it("providerId 与 configEnvNames 映射现状", () => {
    const qwen = findTextProvider("qwen-token-plan-cn");
    expect(qwen).toBeDefined();
    expect(qwen?.configEnvNames).toContain("QWEN_TOKEN_PLAN_CN_API_KEY");
  });

  it("roleDefaults main/summarizer 均为 qwen3.8-max（默认行为零回归）", () => {
    const qwen = findTextProvider("qwen-token-plan-cn");
    expect(qwen?.roleDefaults.main).toBe("qwen3.8-max");
    expect(qwen?.roleDefaults.summarizer).toBe("qwen3.8-max");
  });
});

describe("vision 模型条目", () => {
  it("qwen 目录登记 vision 能力模型（海报 Agent 能力供给）", () => {
    const qwen = findTextProvider("qwen-token-plan-cn");
    const vision = qwen?.models.find((m) => m.capabilities.includes("vision"));
    expect(vision?.id).toBe("qwen3.7-plus");
  });

  it("roleDefaults 仍指向纯文本模型（默认行为零回归）", () => {
    const qwen = findTextProvider("qwen-token-plan-cn");
    expect(qwen?.models.find((m) => m.id === qwen?.roleDefaults.main)?.capabilities).toEqual([]);
  });
});

describe("dashscope 图像条目与现状一致", () => {
  it("providerId 与 defaultModelId 为现状常量值", () => {
    const dashscope = findImageProvider("dashscope-token-plan");
    expect(dashscope).toBeDefined();
    expect(dashscope?.defaultModelId).toBe("wan2.7-image");
    expect(dashscope?.configEnvNames).toContain("QWEN_TOKEN_PLAN_CN_API_KEY");
  });
});
