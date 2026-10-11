/**
 * 模型目录（llm-assembly spec）：分文本/图像两域的内置模型登记表。
 * 目录是代码资产——新供应商接入 = 新增条目 + 配置其 env，不改调用代码。
 * 能力位与角色用字面量联合类型（typed 目录模式，扩张即加联合成员）。
 */

/** 模型能力位。 */
export type ModelCapability = "vision";

/** 文本域调用角色。 */
export type LlmRole = "main" | "summarizer";

export interface ModelEntry {
  /** 目录内模型 id（与 pi-ai model id 一致）。 */
  id: string;
  capabilities: readonly ModelCapability[];
}

/** 供应商标识须与 pi-ai provider id 一致；configEnvNames 为部署方需提供的 env 名。 */
export interface TextProviderEntry {
  providerId: string;
  label: string;
  configEnvNames: readonly string[];
  models: readonly ModelEntry[];
  /** 各角色的默认模型 id（env 未覆盖时使用）。 */
  roleDefaults: Readonly<Record<LlmRole, string>>;
}

export interface ImageProviderEntry {
  providerId: string;
  label: string;
  configEnvNames: readonly string[];
  models: readonly ModelEntry[];
  defaultModelId: string;
}

/** 未声明 LLM_PROVIDER 时的默认供应商（现有部署零配置迁移）。 */
export const DEFAULT_TEXT_PROVIDER_ID = "qwen-token-plan-cn";

export const TEXT_PROVIDERS: readonly TextProviderEntry[] = [
  {
    providerId: "qwen-token-plan-cn",
    label: "Qwen Token Plan (CN)",
    configEnvNames: ["QWEN_TOKEN_PLAN_CN_API_KEY"],
    models: [
      { id: "qwen3.8-max", capabilities: [] },
      // vision 模型：海报 Agent 等声明 vision 能力时的供给条目。id 必须是
      // pi-ai qwen provider 模型数据中真实存在且带 image 输入的模型（冒烟验证：
      // 不存在的 id 会在装配层报「未登记的聊天模型」）；部署需以 LLM_MAIN_MODEL
      // 指向之（默认 main 保持 qwen3.8-max 零回归）。
      { id: "qwen3.7-plus", capabilities: ["vision"] },
    ],
    roleDefaults: { main: "qwen3.8-max", summarizer: "qwen3.8-max" },
  },
];

export const IMAGE_PROVIDERS: readonly ImageProviderEntry[] = [
  {
    providerId: "dashscope-token-plan",
    label: "DashScope Token Plan (CN)",
    configEnvNames: ["QWEN_TOKEN_PLAN_CN_API_KEY", "IMAGE_ENDPOINT", "IMAGE_MODELS"],
    models: [{ id: "wan2.7-image", capabilities: [] }],
    defaultModelId: "wan2.7-image",
  },
];

export function findTextProvider(providerId: string): TextProviderEntry | undefined {
  return TEXT_PROVIDERS.find((p) => p.providerId === providerId);
}

export function findImageProvider(providerId: string): ImageProviderEntry | undefined {
  return IMAGE_PROVIDERS.find((p) => p.providerId === providerId);
}
