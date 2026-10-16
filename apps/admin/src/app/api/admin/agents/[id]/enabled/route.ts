import { requireAdmin } from "@oops/auth";
import { db } from "@oops/db";
import { createAdminAuditRepo } from "@oops/db/admin-audit.repo";
import { createAppConfigRepo } from "@oops/db/app-config.repo";
import {
  bumpRuntimeConfigGeneration,
  resolveAgentEnabled,
  type OverlayReader,
} from "@oops/llm";
import { z } from "zod";
import { ADMIN_AGENT_CATALOG } from "@/lib/agent-catalog";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  enabled: z.boolean(),
  note: z.string().max(200).optional(),
});

/**
 * PATCH /api/admin/agents/[id]/enabled：切换 Agent 启停。
 * 写 overlay（app_config）+ 审计同一事务；返回前 bump 进程内代数使本进程
 * 立即读到新值（web 异进程靠 30s TTL 过期，design D2）。
 * before 审计取切换前的生效值（含来源层），after 固定 overlay 层。
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const { id } = await ctx.params;
  const entry = ADMIN_AGENT_CATALOG.find((a) => a.id === id);
  if (!entry) {
    return Response.json(
      { error: { code: "AGENT_UNKNOWN", message: "未登记的 Agent" } },
      { status: 422 },
    );
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_BODY", message: "请求体不合法" } },
      { status: 400 },
    );
  }
  const { enabled, note } = parsed.data;

  const reader: OverlayReader = {
    readOverlay: (keys: readonly string[]) => createAppConfigRepo(db).getMany(keys),
  };
  const before = await resolveAgentEnabled(id, reader);

  await db.transaction(async (tx) => {
    await createAppConfigRepo(tx).set({
      key: `agent.${id}.enabled`,
      value: enabled,
      updatedBy: guard.userId,
    });
    await createAdminAuditRepo(tx).record({
      adminUserId: guard.userId,
      action: "agent.toggle",
      targetType: "agent",
      targetId: id,
      before: { enabled: before.enabled, source: before.source },
      after: { enabled },
      ...(note !== undefined && { note }),
    });
  });
  bumpRuntimeConfigGeneration();

  return Response.json({ agent: { id, name: entry.name, enabled, source: "overlay" } });
}
