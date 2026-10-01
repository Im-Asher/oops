import { Type, type ImageContent, type JsonValue, type TextContent } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { z } from "zod";

/** 工具执行结果：content 回传给模型，details 用于持久化 / 前端渲染（不进模型上下文）。 */
export interface ToolHandlerResult {
  content: (TextContent | ImageContent)[];
  details?: Record<string, unknown>;
}

export interface ToolExecutionContext {
  signal?: AbortSignal;
  // 每次运行注入的调用者身份：工具据此把任务/资产归属到真实用户
  userId: string;
  sessionId?: string;
}

/** 工具声明：zod schema 为入参校验权威；jsonSchema 仅用于生成 LLM 可用的 typebox 参数。 */
export interface ToolDefinition<T = unknown> {
  name: string;
  label: string;
  description: string;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  execute: (args: T, ctx: ToolExecutionContext) => Promise<ToolHandlerResult>;
}

function buildAgentTool(def: ToolDefinition, ctx: ToolExecutionContext): AgentTool {
  const parameters = Type.Unsafe(def.jsonSchema);
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    parameters,
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal): Promise<AgentToolResult> => {
      const parsed = def.schema.safeParse(params);
      if (!parsed.success) {
        return {
          content: [{ type: "text", text: `参数校验失败：${parsed.error.message}` }],
          details: { error: "invalid_args", toolCallId },
        };
      }
      const result = await def.execute(parsed.data, {
        signal,
        userId: ctx.userId,
        sessionId: ctx.sessionId,
      });
      return { content: result.content, details: (result.details ?? {}) as unknown as JsonValue };
    },
  };
}

/**
 * 工具注册表：单一注册点。按名授权在 Agent 装配时通过 getAgentTools(allowedNames) 实现；
 * 越权工具由 runtime 的 beforeToolCall 拦截（registry.has 判断）。
 */
export class ToolRegistry {
  private defs = new Map<string, ToolDefinition>();

  register<T>(def: ToolDefinition<T>): void {
    this.defs.set(def.name, def as ToolDefinition);
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  getZodSchema(name: string): z.ZodType | undefined {
    return this.defs.get(name)?.schema;
  }

  // 每次构建携带当次运行的 ctx（userId 不同）；构建成本极低，不做跨运行缓存
  getAgentTool(name: string, ctx: ToolExecutionContext): AgentTool | undefined {
    const def = this.defs.get(name);
    if (!def) return undefined;
    return buildAgentTool(def, ctx);
  }

  /** 仅返回已登记且在 allowedNames 中的工具，天然实现按名授权。 */
  getAgentTools(allowedNames: string[], ctx: ToolExecutionContext): Map<string, AgentTool> {
    const map = new Map<string, AgentTool>();
    for (const name of allowedNames) {
      const tool = this.getAgentTool(name, ctx);
      if (tool) map.set(name, tool);
    }
    return map;
  }
}

export const toolRegistry = new ToolRegistry();
