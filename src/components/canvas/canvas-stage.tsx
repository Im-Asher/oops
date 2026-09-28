"use client";

import { CanvasEmptyState } from "@/components/canvas/canvas-empty-state";
import type { CanvasImage, CanvasView } from "@/lib/canvas/canvas-reducer";

interface CanvasStageProps {
  image: CanvasImage | null;
  view: CanvasView;
}

/**
 * 全屏画布：无激活图时空态引导，有激活图时 contain 居中展示。
 * 视图变换只作用于 transform（GPU 合成），不触碰图片数据。
 */
export function CanvasStage({ image, view }: CanvasStageProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[#0A0A0A]">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt="激活图"
          className="max-h-full max-w-full object-contain"
          src={image.url}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      ) : (
        <CanvasEmptyState />
      )}
    </div>
  );
}
