import { createModels, type Api, type Model, type Models } from "@earendil-works/pi-ai";
import { qwenTokenPlanCnProvider } from "@earendil-works/pi-ai/providers/qwen-token-plan-cn";

/** 文本侧模型（Qwen Token Plan China）。 */
export const CHAT_MODEL_ID = "qwen3.8-max";
export const CHAT_PROVIDER_ID = "qwen-token-plan-cn";

let models: Models | undefined;

/** 惰性装配 LLM Models 实例（仅注册 qwen-token-plan-cn，读取 QWEN_TOKEN_PLAN_CN_API_KEY）。 */
export function getChatModels(): Models {
  if (!models) {
    const m = createModels();
    m.setProvider(qwenTokenPlanCnProvider());
    models = m;
  }
  return models;
}

/** 解析当前会话使用的聊天模型；未登记模型直接抛错（provider 配置校验）。 */
export function getChatModel(id: string = CHAT_MODEL_ID): Model<Api> {
  const model = getChatModels().getModel(CHAT_PROVIDER_ID, id);
  if (!model) {
    throw new Error(`未登记的聊天模型：${CHAT_PROVIDER_ID}/${id}`);
  }
  return model;
}
