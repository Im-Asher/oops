import { filtersToCssOrNone, supportsCanvasFilter } from "@/lib/canvas/filter-string";
import type { CropRect, Filters } from "@/lib/canvas/canvas-reducer";

export interface ComposeParams {
  url: string;
  crop: CropRect | null;
  filters: Filters;
}

export interface ComposedImage {
  blob: Blob;
  width: number;
  height: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("源图加载失败，无法导出"));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("画布导出失败"));
    }, type);
  });
}

/**
 * 在离屏画布上按全分辨率复刻「预览」所见：先套滤镜（ctx.filter，与 CSS 同源），
 * 再按归一化裁剪矩形取原图像素区域绘制。导出是源字节的新副本，绝不修改原图。
 * 注意：源图须为同源（经由 /files 路由），否则画布会被污染而 toBlob 失败。
 */
export async function composeEditedImage({
  url,
  crop,
  filters,
}: ComposeParams): Promise<ComposedImage> {
  const img = await loadImage(url);
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;
  if (!naturalWidth || !naturalHeight) {
    throw new Error("源图尺寸无效，无法导出");
  }

  const sx = crop ? Math.round(crop.x * naturalWidth) : 0;
  const sy = crop ? Math.round(crop.y * naturalHeight) : 0;
  const sw = crop ? Math.round(crop.width * naturalWidth) : naturalWidth;
  const sh = crop ? Math.round(crop.height * naturalHeight) : naturalHeight;
  const outWidth = Math.max(1, sw);
  const outHeight = Math.max(1, sh);

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布上下文");

  // 与预览共用同一份滤镜串；不支持 ctx.filter 的浏览器（旧版 Safari）静默跳过，
  // 已在前端滤镜面板给出降级提示。
  const css = filtersToCssOrNone(filters);
  if (css && supportsCanvasFilter()) ctx.filter = css;

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outWidth, outHeight);

  const blob = await canvasToBlob(canvas, "image/png");
  return { blob, width: outWidth, height: outHeight };
}
