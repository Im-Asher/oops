/**
 * 画布/作品集转交排版设计的接收端（spec portfolio「画布图片转交创建设计」）。
 * 以 assetId 而非 url 传入：服务端校验归属后才给地址，避免用户手改参数注入
 * 任意外部图片源（design.md D7）。以新增图层落地，既有元素不动，可撤销。
 */
import { newElementId, type ImageElement } from "@/lib/design/doc";
import { useEffect, useRef } from "react";

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
 * 两种重复插入要分别防住，两者机制不同：
 *
 * 1. StrictMode 双跑（同一挂载周期内 effect 跑两次）。
 *    只靠 cancelled 标志不够：两次 effect 各持独立的 cancelled，先发起的那次
 *    被 cleanup 置为 true 会安全作废，但后发起的那次正常插入 —— 单靠它其实够用，
 *    问题在于若两次都在各自cleanup 前返回，就会插入两份。故用 insertedRef 记录
 *    「本次挂载已处理过哪个 assetId」，第二次直接跳过。
 *
 * 2. 草稿恢复（刷新页面）。设计稿持久化在 localStorage，上次插入的图层还在，
 *    而 URL 里的 assetId 没变，effect 会再跑一次并再插一份。用 shouldInsert
 *    让调用方按当前稿件内容判断。
 *
 * insertedRef 只记「本次挂载」，刷新后是新 ref，因此第2 种仍需shouldInsert。
 */
export function useAssetHandoff({
  assetId,
  canvasSize,
  getViewportCenter,
  shouldInsert,
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
  /** 调用方按当前稿件内容判断是否还该插入（用于草稿恢复去重）。 */
  shouldInsert: (element: ImageElement) => boolean;
  onInsert: (element: ImageElement) => void;
  onMissing: () => void;
}): void {
  const insertedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!assetId) return;
    // 本次挂载已处理过：StrictMode 的第二次运行，或同一 assetId 的重复 effect
    if (insertedRef.current === assetId) return;
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
        const element = assetImageElement(
          {
            id: body.item.id,
            url: body.item.url,
            width: body.item.width,
            height: body.item.height,
          },
          { ...canvasSize, center: getViewportCenter() },
        );
        if (!shouldInsert(element)) return;
        insertedRef.current = assetId;
        onInsert(element);
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