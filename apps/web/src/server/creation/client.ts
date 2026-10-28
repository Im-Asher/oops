import { getCreationConfig } from "@oops/config";
import { agentListSchema, type AgentMetadata } from "@oops/contracts/agents";

/**
 * web → creation 的内部调用端。
 *
 * web 退化为 BFF 之后，Agent 目录不再在 web 进程内（注册表随创作域搬走），
 * 但 `/api/agents` 与会话 PATCH 的 agentId 校验仍需这份元数据。这里做一层
 * 短 TTL 缓存：Agent 集合随部署变化，不需要每次请求都打一次内网。
 */
const AGENT_CACHE_TTL_MS = 60_000;

let cache: { at: number; agents: AgentMetadata[] } | null = null;

export function creationHeaders(): Record<string, string> {
  return { "x-internal-token": getCreationConfig().internalToken };
}

/** 读取 Agent 目录；失败上抛（调用方决定是 503 还是降级）。 */
export async function listAgents(): Promise<AgentMetadata[]> {
  const now = Date.now();
  if (cache && now - cache.at < AGENT_CACHE_TTL_MS) return cache.agents;

  const { baseUrl } = getCreationConfig();
  const res = await fetch(`${baseUrl}/v1/agents`, {
    headers: creationHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`creation /v1/agents 返回 ${res.status}`);

  const parsed = agentListSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("creation /v1/agents 响应不符合契约");

  cache = { at: now, agents: parsed.data.agents };
  return parsed.data.agents;
}

/**
 * 回合是否走 vision。
 * 返回 null 表示**能力未知**（creation 不可达/该 Agent 不在目录里）：调用方退化为
 * 「非 vision」口径——宁可少存一条图片占位，也不要因为这个查询失败挡住整轮对话。
 */
export async function isVisionAgent(agentId: string): Promise<boolean | null> {
  try {
    const agents = await listAgents();
    const found = agents.find((a) => a.id === agentId);
    return found ? found.vision : null;
  } catch {
    return null;
  }
}

/** agentId 是否存在：null 表示目录不可用（调用方不该因此拒绝一次重命名）。 */
export async function isKnownAgent(agentId: string): Promise<boolean | null> {
  try {
    const agents = await listAgents();
    return agents.some((a) => a.id === agentId);
  } catch {
    return null;
  }
}

/** 测试用：清空目录缓存。 */
export function resetAgentCache(): void {
  cache = null;
}
