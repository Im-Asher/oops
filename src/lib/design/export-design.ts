/**
 * 导出封装（spec design-editor D5）：@zumer/snapdom 客户端快照。
 * document.fonts.ready 保证 webfont 落定后再截图；width/height 为绝对
 * 输出尺寸（优先于 scale）——画布 surface 处于 fit 缩放视口内，视觉
 * rect ≠ doc 尺寸，必须显式传 doc.width×height 才能还原画布像素。
 * Blob 下载接口隔离——若 snapdom 实现期暴露兼容性问题，可整体替换
 * （如 html2canvas-pro）而不动 UI 层。
 */
import { snapdom } from "@zumer/snapdom";

/** 截图目标节点（画布 surface）+ 画布逻辑尺寸 → PNG Blob。 */
export async function exportDesignToBlob(
  node: HTMLElement,
  size: { width: number; height: number },
): Promise<Blob> {
  if (typeof document !== "undefined" && document.fonts) {
    await document.fonts.ready;
  }
  const result = await snapdom(node, { height: size.height, width: size.width });
  return result.toBlob({ format: "png" });
}

/** Blob → a[download] 触发浏览器下载（文件名由调用方按尺寸拼装）。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
