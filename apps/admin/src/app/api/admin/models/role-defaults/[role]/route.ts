import { requireAdmin } from "@oops/auth";
import { db } from "@oops/db";
import { createAdminAuditRepo } from "@oops/db/admin-audit.repo";
import { assertConfigKeyValue, createAppConfigRepo } from "@oops/db/app-config.repo";
import {
  bumpRuntimeConfigGeneration,
  resolveRoleDefaultLayers,
  type OverlayReader,
} from "@oops/llm";
import { TEXT_PROVIDERS } from "@oops/llm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const putBodySchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  note: z.string().max(200).optional(),
});

function isLlmRole(role: string): role is "main" | "summarizer" {
  return role === "main" || role === "summarizer";
}

/**
 * PUT /api/admin/models/role-defaults/[role]：设置角色默认模型（写 overlay）。
 * 仅允许目录登记的文本模型（422 MODEL_UNKNOWN）；overlay + 同事务审计
 * （model.role_default.update，before 含切换前生效值与来源层）+ bump。
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ role: string }> },
): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const { role } = await ctx.params;
  if (!isLlmRole(role)) {
    return Response.json(
      { error: { code: "ROLE_UNKNOWN", message: "未知的调用角色" } },
      { status: 422 },
    );
  }
  const parsed = putBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_BODY", message: "请求体不合法" } },
      { status: 400 },
    );
  }
  const { providerId, modelId, note } = parsed.data;
  if (
    !TEXT_PROVIDERS.some(
      (p) => p.providerId === providerId && p.models.some((m) => m.id === modelId),
    )
  ) {
    return Response.json(
      { error: { code: "MODEL_UNKNOWN", message: "角色默认须指向已登记的文本模型" } },
      { status: 422 },
    );
  }

  const reader: OverlayReader = {
    readOverlay: (keys: readonly string[]) => createAppConfigRepo(db).getMany(keys),
  };
  const before = await resolveRoleDefaultLayers(role, reader);
  const key = `model.roleDefaults.${role}`;
  const value = { providerId, modelId };
  assertConfigKeyValue(key, value); // route 层预检（repo set 内还会校验一次）

  await db.transaction(async (tx) => {
    await createAppConfigRepo(tx).set({ key, value, updatedBy: guard.userId });
    await createAdminAuditRepo(tx).record({
      adminUserId: guard.userId,
      action: "model.config",
      targetType: "model_config",
      targetId: `role:${role}`,
      before: {
        providerId: before.effective.providerId,
        modelId: before.effective.modelId,
        source: before.effective.source,
      },
      after: { ...value },
      ...(note !== undefined && { note }),
    });
  });
  bumpRuntimeConfigGeneration();

  return Response.json({ roleDefault: { role, ...value, source: "overlay" } });
}

/**
 * DELETE /api/admin/models/role-defaults/[role]：清除 overlay 角色默认，
 * 回落 env/catalog。before 记录被清除的 overlay 值（无则为 null）。
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ role: string }> },
): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const { role } = await ctx.params;
  if (!isLlmRole(role)) {
    return Response.json(
      { error: { code: "ROLE_UNKNOWN", message: "未知的调用角色" } },
      { status: 422 },
    );
  }

  const key = `model.roleDefaults.${role}`;
  const current = await createAppConfigRepo(db).get(key);
  if (current === null) {
    return Response.json(
      { error: { code: "NOT_SET", message: "该角色未设置后台默认" } },
      { status: 422 },
    );
  }

  await db.transaction(async (tx) => {
    await createAppConfigRepo(tx).remove(key);
    await createAdminAuditRepo(tx).record({
      adminUserId: guard.userId,
      action: "model.config",
      targetType: "model_config",
      targetId: `role:${role}`,
      before: { overlay: current },
      after: { overlay: null },
    });
  });
  bumpRuntimeConfigGeneration();

  return Response.json({ roleDefault: { role, cleared: true } });
}
