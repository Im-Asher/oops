import { requireAdmin } from "@oops/auth";
import { db } from "@oops/db";
import { createAppConfigRepo } from "@oops/db/app-config.repo";
import {
  IMAGE_PROVIDERS,
  TEXT_PROVIDERS,
  resolveModelEnabled,
  resolveRoleDefaultLayers,
  type OverlayReader,
} from "@oops/llm";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/models：目录条目（文本+图像）生效启停态 + 角色默认三层明细。
 * 全部经 runtime-config 解析（overlay ?? env ?? catalog，30s TTL 缓存）。
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

  const toModels = async (
    providerId: string,
    models: readonly { id: string; capabilities: readonly string[] }[],
  ) =>
    Promise.all(
      models.map(async (m) => {
        const { enabled, source } = await resolveModelEnabled(providerId, m.id, reader);
        return { id: m.id, capabilities: m.capabilities, enabled, source };
      }),
    );

  const [textProviders, imageProviders, mainLayers, summarizerLayers] = await Promise.all([
    Promise.all(
      TEXT_PROVIDERS.map(async (p) => ({
        providerId: p.providerId,
        label: p.label,
        configEnvNames: p.configEnvNames,
        models: await toModels(p.providerId, p.models),
      })),
    ),
    Promise.all(
      IMAGE_PROVIDERS.map(async (p) => ({
        providerId: p.providerId,
        label: p.label,
        configEnvNames: p.configEnvNames,
        defaultModelId: p.defaultModelId,
        models: await toModels(p.providerId, p.models),
      })),
    ),
    resolveRoleDefaultLayers("main", reader),
    resolveRoleDefaultLayers("summarizer", reader),
  ]);

  return Response.json({
    textProviders,
    imageProviders,
    roleDefaults: { main: mainLayers, summarizer: summarizerLayers },
  });
}
