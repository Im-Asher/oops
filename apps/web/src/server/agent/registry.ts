import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ModelCapability } from "@/server/llm/catalog";
import type { AgentModelDeclaration } from "@/server/llm/resolver";
import { toolRegistry, type ToolExecutionContext } from "./tools/registry";

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** 前端头像徽标用 emoji（声明即所得，避免维护名称到图标的映射）。 */
  icon: string;
  /** 空会话灵感卡示例需求的词典 key（chat.presets.<agentId>.<key>），API 层按 locale 解析为文案。 */
  presets: string[];
  /** 允许该 Agent 调用的工具名（按名授权）。 */
  tools: string[];
  systemPrompt: string;
  /** 按角色的模型能力需求声明（llm-assembly spec）；未声明走全局装配，行为不变。 */
  models?: AgentModelDeclaration;
}

/** 合法能力位（与 catalog 字面量联合同步；defineAgent 校验用）。 */
const VALID_CAPABILITIES: readonly ModelCapability[] = ["vision"];

/** 透出给前端的轻量元数据（不含 systemPrompt 等敏感/大字段）。 */
export interface AgentMetadata {
  id: string;
  name: string;
  description: string;
  icon: string;
  presets: string[];
  tools: string[];
}

/** 声明式 Agent 工厂：结构校验（含模型能力声明）后透传，无副作用。 */
export function defineAgent(def: AgentDefinition): AgentDefinition {
  const declared = def.models?.main?.capabilities;
  if (declared !== undefined) {
    if (!Array.isArray(declared) || declared.length === 0) {
      throw new Error(`Agent ${def.id} 的 models.main.capabilities 必须为非空数组`);
    }
    const invalid = declared.filter((c) => !VALID_CAPABILITIES.includes(c));
    if (invalid.length > 0) {
      throw new Error(`Agent ${def.id} 声明了未知模型能力：${invalid.join(", ")}`);
    }
  }
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
    return this.list().map(({ id, name, description, icon, presets, tools }) => ({
      id,
      name,
      description,
      icon,
      presets,
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
