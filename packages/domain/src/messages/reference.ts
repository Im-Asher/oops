/**
 * 画布引用图 → 模型可读文本块。
 *
 * 归属 `@oops/domain` 而不是某个 app：web 用它拼「本轮模型可见文本」并写入 user 行
 * transcript，creation 用它拼同一份文本注入 prompt。两侧必须逐字一致，否则回放历史
 * 与实际输入会出现无法解释的偏差——所以只留这一份实现。
 */
export interface ReferenceAssetLike {
  id: string;
  storageKey: string;
  prompt?: string | null;
}

/** 无引用时返回空串（调用方无需判断长度）。 */
export function buildReferenceBlock(assets: readonly ReferenceAssetLike[]): string {
  if (assets.length === 0) return "";
  const lines = assets.map(
    (a) => `- assetId: ${a.id}, url: /files/${a.storageKey}, 原prompt: ${a.prompt || "(无)"}`,
  );
  return `[引用画布图片]\n${lines.join("\n")}`;
}
