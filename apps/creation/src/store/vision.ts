import { createAssetRepo } from "@oops/db/asset.repo";
import type { Asset } from "@oops/db/schema";
import { createStorage } from "@oops/storage/s3";
import type { AgentImageInput } from "../agent/runtime";

/** 引用图按 id 批量取（归属校验已在 web 完成，这里只负责取数）。 */
export async function loadReferenceAssets(ids: readonly string[]): Promise<Asset[]> {
  if (ids.length === 0) return [];
  return createAssetRepo().getManyByIds([...ids]);
}

/**
 * 引用图片字节读取：从对象存储取字节转 base64（vision 注入用）。
 * 非图片资产跳过（引用块仍让模型看到 assetId/url）。
 */
export async function loadVisionImages(assets: readonly Asset[]): Promise<AgentImageInput[]> {
  const storage = createStorage();
  const out: AgentImageInput[] = [];
  for (const a of assets) {
    if (!a.mimeType.startsWith("image/")) continue;
    const obj = await storage.getObject(a.storageKey);
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes) continue;
    out.push({
      assetId: a.id,
      url: `/files/${a.storageKey}`,
      data: Buffer.from(bytes).toString("base64"),
      mimeType: a.mimeType,
    });
  }
  return out;
}
