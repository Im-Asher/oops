import { requireUser } from "@/server/auth/require-user";
import { agentRegistry } from "@/server/agent";
import { resolvePresets } from "@/server/agent/presets";
import { getMessages } from "next-intl/server";

export const dynamic = "force-dynamic";

/** 返回已注册 Agent 列表（供前端选择）；灵感卡 presets 按请求 locale 解析为文案。 */
export async function GET(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const messages = await getMessages();
  const agents = agentRegistry
    .metadata()
    .map((agent) => ({ ...agent, presets: resolvePresets(messages, agent.id, agent.presets) }));
  return Response.json({ agents });
}
