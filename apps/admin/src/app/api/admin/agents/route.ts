import { requireAdmin } from "@oops/auth";
import { db } from "@oops/db";
import { createAppConfigRepo } from "@oops/db/app-config.repo";
import { resolveAgentEnabled, type OverlayReader } from "@oops/llm";
import { ADMIN_AGENT_CATALOG } from "@/lib/agent-catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/agents：注册 agent 清单 + 生效启停态与来源层。
 * 清单来自 admin 静态目录（web registry 在另一进程，配置约定同步）；
 * 生效值走 @oops/llm runtime-config 三层解析（overlay ?? env ?? catalog）。
 */
export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const reader: OverlayReader = {
    readOverlay: (keys: readonly string[]) => createAppConfigRepo(db).getMany(keys),
  };
  const agents = await Promise.all(
    ADMIN_AGENT_CATALOG.map(async (entry) => {
      const resolution = await resolveAgentEnabled(entry.id, reader);
      return { ...entry, ...resolution };
    }),
  );
  return Response.json({ agents });
}
