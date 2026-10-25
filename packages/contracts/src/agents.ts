import { z } from "zod";

/**
 * `GET /v1/agents` 返回的 Agent 元数据（不含 systemPrompt 等大字段）。
 * `presets` 仍是词典 key，由 web 按请求 locale 解析为文案——i18n 词典只在 web 侧。
 */
export const agentMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  presets: z.array(z.string()),
  tools: z.array(z.string()),
  /**
   * 主模型是否声明 vision。web 需要它来决定 user 行 transcript 是否带图片块
   * （有图但非 vision Agent 时只留文本引用块），否则两侧对同一回合的留存口径会分叉。
   */
  vision: z.boolean(),
});

export type AgentMetadata = z.infer<typeof agentMetadataSchema>;

export const agentListSchema = z.object({ agents: z.array(agentMetadataSchema) });

export type AgentList = z.infer<typeof agentListSchema>;
