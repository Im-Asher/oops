import { agentRegistry } from "@/server/agent";

export const dynamic = "force-dynamic";

/** 返回已注册 Agent 列表（供前端选择）。 */
export async function GET(): Promise<Response> {
  const agents = agentRegistry.list().map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    tools: a.tools,
  }));
  return Response.json({ agents });
}
