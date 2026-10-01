import type { AgentTool } from "@earendil-works/pi-agent-core";
import { toolRegistry, type ToolExecutionContext } from "./tools/registry";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** 前端头像徽标用 emoji（声明即所得，避免维护名称到图标的映射）。 */
  icon: string;
  /** 允许该 Agent 调用的工具名（按名授权）。 */
  tools: string[];
  systemPrompt: string;
}

/** 透出给前端的轻量元数据（不含 systemPrompt 等敏感/大字段）。 */
export interface AgentMetadata {
  id: string;
  name: string;
  description: string;
  icon: string;
  tools: string[];
}

/** 声明式 Agent 工厂：仅做结构校验与透传，无副作用。 */
export function defineAgent(def: AgentDefinition): AgentDefinition {
  return def;
}

class AgentRegistry {
  private defs = new Map<string, AgentDefinition>();

  register(def: AgentDefinition): void {
    this.defs.set(def.id, def);
  }

  get(id: string): AgentDefinition | undefined {
    return this.defs.get(id);
  }

  list(): AgentDefinition[] {
    return [...this.defs.values()];
  }

  metadata(): AgentMetadata[] {
    return this.list().map(({ id, name, description, icon, tools }) => ({
      id,
      name,
      description,
      icon,
      tools,
    }));
  }

  /** 解析该 Agent 允许的工具为 AgentTool 数组（registry 已做越权过滤），ctx 注入调用者身份。 */
  getAgentTools(id: string, ctx: ToolExecutionContext): AgentTool[] {
    const def = this.defs.get(id);
    if (!def) return [];
    return [...toolRegistry.getAgentTools(def.tools, ctx).values()];
  }
}

export const agentRegistry = new AgentRegistry();
