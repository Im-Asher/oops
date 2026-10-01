import type { AgentTool } from "@earendil-works/pi-agent-core";
import { toolRegistry } from "./tools/registry";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** 允许该 Agent 调用的工具名（按名授权）。 */
  tools: string[];
  systemPrompt: string;
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

  /** 解析该 Agent 允许的工具为 AgentTool 数组（registry 已做越权过滤）。 */
  getAgentTools(id: string): AgentTool[] {
    const def = this.defs.get(id);
    if (!def) return [];
    return [...toolRegistry.getAgentTools(def.tools).values()];
  }
}

export const agentRegistry = new AgentRegistry();
