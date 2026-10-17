/**
 * 画布/作品集转交创建设计的接收端（spec portfolio「画布图片转交创建设计」）。
 * 以 assetId 而非 url 传入：服务端校验归属后才给地址，避免用户手改参数注入
 * 任意外部图片源（design.md D7）。以新增图层落地，既有元素不动，可撤销。
 */
import { newElementId, type ImageElement } from "@/lib/design/doc";
import { useEffect } from "react";

/** 图层最大占画布的比例——避免大图铺满后无法操作其他元素。 */
const MAX_RATIO = 0.8;

export interface HandoffAsset {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

/**
 * 由资产构造图片图层：以画布中心为落点，按资产宽高比等比缩放到画布内。
 * 宽高未知时按 1:1 处理，插入后仍可手动调整。
 */
export function assetImageElement(
  asset: HandoffAsset,
  canvas: { width: number; height: number; center: { x: number; y: number } },
): ImageElement {
  const ar =
    asset.width && asset.height && asset.height > 0 ? asset.width / asset.height : 1;
  const bound = Math.min(canvas.width, canvas.height) * MAX_RATIO;
  let w = bound;
  let h = w / ar;
  if (h > bound) {
    h = bound;
    w = h * ar;
  }
  return {
    id: newElementId(),
    type: "image",
    x: Math.round(canvas.center.x - w / 2),
    y: Math.round(canvas.center.y - h / 2),
    w: Math.round(w),
    h: Math.round(h),
    rotation: 0,
    opacity: 1,
    src: asset.url,
    fit: "contain",
    radius: 0,
  };
}

interface AssetDetail {
  item: {
    id: string;
    url: string;
    width: number | null;
    height: number | null;
  } | null;
}

/**
 * 读取 ?assetId= 拉取资产并作为图层插入。
 * - 资产不存在（404）：提示且设计稿保持不变，不出现空白稿
 *
 * 去重靠依赖数组而非 ref 守卫：StrictMode 下 effect 会双跑（mount → cleanup →
 * 再次 mount），ref 守卫会让第二次直接返回，而第一次的请求已被 cancelled，
 * 结果是图层永不插入。请求自带 cancelled 标志，重复的那次安全作废。
 */
export function useAssetHandoff({
  assetId,
  canvasSize,
  getViewportCenter,
  onInsert,
  onMissing,
}: {
  assetId: string | null;
  canvasSize: { width: number; height: number };
  /**
   * 视口中心取值函数（而非坐标）：容器 ref 在首帧后才可量，
   * 渲染期取到的会是 0。图层落下时现调。
   */
  getViewportCenter: () => { x: number; y: number };
  onInsert: (element: ImageElement) => void;
  onMissing: () => void;
}): void {
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}`);
        if (cancelled) return;
        if (!res.ok) {
          onMissing();
          return;
        }
        const body = (await res.json()) as AssetDetail;
        if (cancelled) return;
        if (!body.item) {
          onMissing();
          return;
        }
        onInsert(
          assetImageElement(
            {
              id: body.item.id,
              url: body.item.url,
              width: body.item.width,
              height: body.item.height,
            },
            { ...canvasSize, center: getViewportCenter() },
          ),
        );
      } catch {
        if (!cancelled) onMissing();
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只在 assetId 变化时取一次；尺寸/视口在插入瞬间取值即可。
    // 资产 id 变了才需要再插一张，同 id 重复渲染不重复插入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);
}