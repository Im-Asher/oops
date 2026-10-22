/**
 * 排版设计导出成果入作品集（spec portfolio「创建设计成果入库」）。
 * 两步：先 purpose=design 上传得到无会话归属的资产，再标记收藏。
 * 任一步失败都抛出，由调用方降级为提示——不影响浏览器下载。
 */
export async function uploadDesignToPortfolio(
  blob: Blob,
  width: number,
  height: number,
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new File([blob], `design-${width}x${height}.png`, { type: blob.type || "image/png" }),
  );
  form.append("purpose", "design");
  form.append("width", String(width));
  form.append("height", String(height));

  const res = await fetch("/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error("design upload failed");
  const body = (await res.json()) as { assetId?: string };
  const assetId = body.assetId;
  if (!assetId) throw new Error("missing assetId");

  // 立刻收藏：设计成果没有别的地方会替用户做这个动作
  const patch = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ savedAt: new Date().toISOString() }),
  });
  if (!patch.ok) throw new Error("save failed");
  return assetId;
}