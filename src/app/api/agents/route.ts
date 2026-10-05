import { requireUser } from "@/server/auth/require-user";
import { agentRegistry } from "@/server/agent";

export const dynamic = "force-dynamic";

/** 返回已注册 Agent 列表（供前端选择）。 */
export async function GET(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  return Response.json({ agents: agentRegistry.metadata() });
}
