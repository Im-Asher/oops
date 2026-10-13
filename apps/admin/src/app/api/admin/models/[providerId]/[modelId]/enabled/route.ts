import { requireAdmin } from "@oops/auth";
import { db } from "@oops/db";
import { createAdminAuditRepo } from "@oops/db/admin-audit.repo";
import { createAppConfigRepo } from "@oops/db/app-config.repo";
import {
  bumpRuntimeConfigGeneration,
  findImageProvider,
  findTextProvider,
  resolveModelEnabled,
  type OverlayReader,
} from "@oops/llm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  enabled: z.boolean(),
  note: z.string().max(200).optional(),
});

/**
 * PATCH /api/admin/models/[providerId]/[modelId]/enabled：目录模型启停。
 * 仅允许目录登记条目（422 MODEL_UNKNOWN）；写 overlay + 同事务审计
 * （model.toggle，before 含来源层）+ bump 本进程缓存。
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ providerId: string; modelId: string }> },
): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const { providerId, modelId } = await ctx.params;
  const registered =
    findTextProvider(providerId)?.models.some((m) => m.id === modelId) ||
    findImageProvider(providerId)?.models.some((m) => m.id === modelId);
  if (!registered) {
    return Response.json(
      { error: { code: "MODEL_UNKNOWN", message: "未登记的模型" } },
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
  const key = `model.${providerId}.${modelId}.enabled`;

  const reader: OverlayReader = {
    readOverlay: (keys: readonly string[]) => createAppConfigRepo(db).getMany(keys),
  };
  const before = await resolveModelEnabled(providerId, modelId, reader);

  await db.transaction(async (tx) => {
    await createAppConfigRepo(tx).set({ key, value: enabled, updatedBy: guard.userId });
    await createAdminAuditRepo(tx).record({
      adminUserId: guard.userId,
      action: "model.config",
      targetType: "model_config",
      targetId: `${providerId}/${modelId}`,
      before: { enabled: before.enabled, source: before.source },
      after: { enabled },
      ...(note !== undefined && { note }),
    });
  });
  bumpRuntimeConfigGeneration();

  return Response.json({ model: { providerId, modelId, enabled, source: "overlay" } });
}
