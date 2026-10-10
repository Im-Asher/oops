import {
  createModels,
  type Api,
  type Model,
  type Models,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { qwenTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn";
import type { LlmRole } from "@/server/llm/catalog";
import { resolveTextModel, type AgentModelDeclaration } from "@/server/llm/resolver";

/**
 * 文本侧模型现状别名（Qwen Token Plan China）。
 * 与 catalog 的 qwen 条目 roleDefaults 对应（catalog.test 锁一致性）；保留导出兼容既有引用。
 */
export const CHAT_MODEL_ID = "qwen3.8-max";
export const CHAT_PROVIDER_ID = "qwen-token-plan-cn";

/** catalog 已登记供应商 → pi-ai provider 装配工厂。未接入适配的供应商取模时显式报错。 */
const providerFactories: Record<string, () => Provider> = {
  "qwen-token-plan-cn": qwenTokenPlanCnProvider,
};

let models: MutableModels | undefined;
const registeredProviders = new Set<string>();

/** 惰性装配 LLM Models 实例（单例容器；provider 按解析结果注册）。 */
function getModelsInstance(): MutableModels {
  models ??= createModels();
  return models;
}

/**
 * Models 容器出口（streamSimple / completeSimple 消费）。
 * 前置约定：provider 注册由 getChatModel 的 ensureProvider 完成——
 * 调用方必须先经 getChatModel / getChatModelForRole 取模，再使用本实例。
 */
export function getChatModels(): Models {
  return getModelsInstance();
}

function ensureProvider(providerId: string): void {
  if (registeredProviders.has(providerId)) return;
  const factory = providerFactories[providerId];
  if (!factory) {
    throw new Error(`供应商 ${providerId} 已登记模型目录但未接入适配`);
  }
  getModelsInstance().setProvider(factory());
  registeredProviders.add(providerId);
}

/** 解析当前会话使用的聊天模型；未登记模型直接抛错（provider 配置校验）。 */
export function getChatModel(
  id: string = CHAT_MODEL_ID,
  providerId: string = CHAT_PROVIDER_ID,
): Model<Api> {
  ensureProvider(providerId);
  const model = getModelsInstance().getModel(providerId, id);
  if (!model) {
    throw new Error(`未登记的聊天模型：${providerId}/${id}`);
  }
  return model;
}

/**
 * 按角色解析并装配模型（llm-assembly 装配出口）：
 * 优先级链与能力校验在 resolver，能力不满足/供应商未登记时抛 ModelConfigError。
 */
export function getChatModelForRole(
  role: LlmRole,
  declaration?: AgentModelDeclaration,
): Model<Api> {
  const resolved = resolveTextModel(role, declaration);
  return getChatModel(resolved.modelId, resolved.providerId);
}
