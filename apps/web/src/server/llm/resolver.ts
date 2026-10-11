import {
  DEFAULT_TEXT_PROVIDER_ID,
  TEXT_PROVIDERS,
  type LlmRole,
  type ModelCapability,
  type TextProviderEntry,
} from "./catalog";
import { LLM_MAIN_MODEL, LLM_PROVIDER, LLM_SUMMARIZER_MODEL } from "@/lib/config";

/** Agent 侧模型能力需求（AgentDefinition.models 的载荷）。 */
export interface AgentModelRequirement {
  capabilities: readonly ModelCapability[];
}

/** AgentDefinition.models 声明（按角色；仅 main 受 Agent 约束）。 */
export interface AgentModelDeclaration {
  main?: AgentModelRequirement;
}

/** 解析输入（依赖注入：默认取 config 常量，测试可注入）。 */
export interface ResolverEnv {
  provider: string;
  mainModel?: string;
  summarizerModel?: string;
}

export type ModelConfigErrorKind =
  | "unknown_provider"
  | "unknown_model"
  | "capability_unmet";

export class ModelConfigError extends Error {
  constructor(
    message: string,
    public readonly kind: ModelConfigErrorKind,
  ) {
    super(message);
    this.name = "ModelConfigError";
  }
}

export interface ResolvedTextModel {
  providerId: string;
  modelId: string;
}

function currentEnv(): ResolverEnv {
  return {
    provider: LLM_PROVIDER ?? DEFAULT_TEXT_PROVIDER_ID,
    mainModel: LLM_MAIN_MODEL,
    summarizerModel: LLM_SUMMARIZER_MODEL,
  };
}

function envOverride(role: LlmRole, env: ResolverEnv): string | undefined {
  if (role === "main") return env.mainModel;
  if (role === "summarizer") return env.summarizerModel;
  return undefined;
}

/**
 * 解析文本域角色模型（llm-assembly spec 优先级链）：
 * 候选模型 = 角色级 env 覆盖 ?? 目录 roleDefaults；Agent 能力声明为约束层——
 * 候选模型不满足声明时显式报错，MUST NOT 静默降级（spec「能力需求校验」）。
 */
export function resolveTextModel(
  role: LlmRole,
  declaration?: AgentModelDeclaration,
  env: ResolverEnv = currentEnv(),
  providers: readonly TextProviderEntry[] = TEXT_PROVIDERS,
): ResolvedTextModel {
  const provider = providers.find((p) => p.providerId === env.provider);
  if (!provider) {
    throw new ModelConfigError(
      `未登记的 LLM 供应商：${env.provider}`,
      "unknown_provider",
    );
  }

  const override = envOverride(role, env);
  let modelId: string;
  if (override) {
    if (!provider.models.some((m) => m.id === override)) {
      throw new ModelConfigError(
        `供应商 ${provider.providerId} 未登记角色 ${role} 的覆盖模型：${override}`,
        "unknown_model",
      );
    }
    modelId = override;
  } else {
    modelId = provider.roleDefaults[role];
  }

  if (role === "main") {
    const required = declaration?.main?.capabilities ?? [];
    if (required.length > 0) {
      const entry = provider.models.find((m) => m.id === modelId);
      const missing = required.filter((c) => !entry?.capabilities.includes(c));
      if (missing.length > 0) {
        throw new ModelConfigError(
          `供应商 ${provider.providerId} 的模型 ${modelId} 缺少所需能力：${missing.join(", ")}`,
          "capability_unmet",
        );
      }
    }
  }

  return { providerId: provider.providerId, modelId };
}
