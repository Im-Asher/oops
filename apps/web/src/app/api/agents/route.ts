import { requireUser } from "@oops/auth/require-user";
import { getMessages } from "next-intl/server";
import { listAgents } from "@/server/creation/client";
import { resolvePresets } from "@/server/presets";

export const dynamic = "force-dynamic";

/**
 * 返回已注册 Agent 列表（来自 creation 的 `/v1/agents`）；灵感卡 presets 按请求 locale
 * 解析为文案——i18n 词典只在 web 侧，所以解析这一步留在 BFF。
 */
export async function GET(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }

  let agents;
  try {
    agents = await listAgents();
  } catch (err) {
    console.error("[agents] creation 不可达:", err);
    return Response.json(
      { error: { code: "CREATION_UNAVAILABLE", message: "创作服务不可用，请稍后重试" } },
      { status: 503 },
    );
  }

  const messages = await getMessages();
  return Response.json({
    agents: agents.map((agent) => ({
      ...agent,
      presets: resolvePresets(messages, agent.id, agent.presets),
    })),
  });
}
