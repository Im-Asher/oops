"use client";

import { CanvasEmptyState } from "@/components/canvas/canvas-empty-state";
import { CropOverlay, type CropArea } from "@/components/canvas/crop-overlay";
import { EditToolbar } from "@/components/canvas/edit-toolbar";
import { ViewToolbar } from "@/components/canvas/view-toolbar";
import { Button } from "@/components/ui/button";
import {
  clampScale,
  normalizeCrop,
  type CanvasImage,
  type CanvasView,
  type CropRect,
} from "@/lib/canvas/canvas-reducer";
import { useCallback, useEffect, useRef, useState } from "react";

const ZOOM_STEP = 1.2;

interface CanvasStageProps {
  image: CanvasImage | null;
  view: CanvasView;
  crop: CropRect | null;
  onViewChange: (view: CanvasView) => void;
  onResetView: () => void;
  onCropApply: (crop: CropRect) => void;
}

/** 已应用的裁剪用 clip-path 预览：与导出共用同一套归一化坐标。 */
function clipPathOf(crop: CropRect | null): string | undefined {
  if (!crop) return undefined;
  const top = crop.y * 100;
  const right = (1 - crop.x - crop.width) * 100;
  const bottom = (1 - crop.y - crop.height) * 100;
  const left = crop.x * 100;
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

/**
 * 全屏画布：无激活图时空态引导，有激活图时 contain 居中展示。
 * 缩放平移与裁剪预览只改 view / clip，不触碰图片数据。
 */
export function CanvasStage({
  image,
  view,
  crop,
  onViewChange,
  onResetView,
  onCropApply,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewRef = useRef(view);
  const [dragging, setDragging] = useState(false);
  // 裁剪会话绑定激活图 url：换图自动失效，无需在 effect 里重置状态。
  const [cropSession, setCropSession] = useState<{ url: string; area: CropArea } | null>(null);
  const [draft, setDraft] = useState<CropRect | null>(null);
  const cropping = cropSession !== null && image?.url === cropSession.url;
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // 激活图消失时丢弃进行中的拖拽（改 ref 不触发渲染，光标由 dragging && image 推导）。
  useEffect(() => {
    if (!image) dragRef.current = null;
  }, [image]);

  /** 以容器坐标 (dx, dy) 为锚点缩放：该点下的图像内容保持不动。 */
  const zoomAt = useCallback(
    (nextScale: number, dx: number, dy: number) => {
      const current = viewRef.current;
      const clamped = clampScale(nextScale);
      if (clamped === current.scale) return;
      const ratio = clamped / current.scale;
      const next = {
        scale: clamped,
        x: dx - (dx - current.x) * ratio,
        y: dy - (dy - current.y) * ratio,
      };
      // 同步回写：高频滚轮事件会在 React commit 前连发，否则会基于同一旧基线重算。
      viewRef.current = next;
      onViewChange(next);
    },
    [onViewChange],
  );

  // React 的 onWheel 是被动监听，无法 preventDefault，故手动挂非被动监听。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !image || cropping) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      zoomAt(viewRef.current.scale * Math.exp(-event.deltaY * 0.0015), dx, dy);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [image, cropping, zoomAt]);

  const measureCropArea = useCallback((): CropArea | null => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return null;
    const imgRect = img.getBoundingClientRect();
    const baseRect = container.getBoundingClientRect();
    if (!imgRect.width || !imgRect.height) return null;
    return {
      left: imgRect.left - baseRect.left,
      top: imgRect.top - baseRect.top,
      width: imgRect.width,
      height: imgRect.height,
    };
  }, []);

  /**
   * 进入裁剪前先复位视图：缩放/平移状态下图片有部分在容器外，选区够不到。
   * 复位后的几何可直接算出（contain 居中、不放大），无需等 React 提交再测量。
   */
  const startCropping = () => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !image) return;
    const base = container.getBoundingClientRect();
    const naturalWidth = img.naturalWidth || img.offsetWidth;
    const naturalHeight = img.naturalHeight || img.offsetHeight;
    if (!naturalWidth || !naturalHeight || !base.width || !base.height) return;

    onResetView();
    const fit = Math.min(1, base.width / naturalWidth, base.height / naturalHeight);
    const width = naturalWidth * fit;
    const height = naturalHeight * fit;
    setCropSession({
      url: image.url,
      area: {
        left: (base.width - width) / 2,
        top: (base.height - height) / 2,
        width,
        height,
      },
    });
    setDraft(null);
  };

  // 裁剪中窗口尺寸变化会让快照区域与图片错位，需重测。
  useEffect(() => {
    if (!cropping) return;
    const remeasure = () => {
      const area = measureCropArea();
      if (area) setCropSession((prev) => (prev ? { ...prev, area } : null));
    };
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, [cropping, measureCropArea]);

  const cancelCropping = () => {
    setCropSession(null);
    setDraft(null);
  };

  const confirmCropping = () => {
    if (!draft) return;
    const normalized = normalizeCrop(draft);
    if (normalized) onCropApply(normalized);
    cancelCropping();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!image || cropping || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onViewChange({
      scale: view.scale,
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!image) return;
    if (cropping) {
      if (event.key === "Escape") {
        cancelCropping();
        event.preventDefault();
      }
      return;
    }
    if (event.key === "+" || event.key === "=") zoomAt(view.scale * ZOOM_STEP, 0, 0);
    else if (event.key === "-" || event.key === "_") zoomAt(view.scale / ZOOM_STEP, 0, 0);
    else if (event.key === "0") onResetView();
    else return;
    event.preventDefault();
  };

  /** 1:1：按原始像素显示（相对 contain 适配尺寸的倍率）。 */
  const handleActualSize = () => {
    const img = imgRef.current;
    if (!img?.naturalWidth || !img.offsetWidth) return;
    onViewChange({ scale: clampScale(img.naturalWidth / img.offsetWidth), x: 0, y: 0 });
  };

  return (
    <div
      className={`absolute inset-0 flex items-center justify-center overflow-hidden bg-[#0A0A0A] ${
        image ? "touch-none" : ""
      }`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      ref={containerRef}
      role={image ? "application" : undefined}
      aria-label={image ? "画布，可缩放平移" : undefined}
      tabIndex={image ? 0 : undefined}
    >
      {image ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="激活图"
            className={`max-h-full max-w-full object-contain ${
              dragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            draggable={false}
            ref={imgRef}
            src={image.url}
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              // 裁剪模式下展示整图，便于重新框选
              clipPath: cropping ? undefined : clipPathOf(crop),
            }}
          />
          {cropping && cropSession ? (
            <CropOverlay area={cropSession.area} draft={draft} onDraftChange={setDraft} />
          ) : null}
          <EditToolbar cropping={cropping} onToggleCrop={cropping ? cancelCropping : startCropping} />
          {cropping ? (
            <div
              className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/90 px-2 py-1 backdrop-blur"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Button
                className="min-h-11 px-3 text-xs text-zinc-50 hover:bg-zinc-800"
                onClick={cancelCropping}
                size="sm"
                variant="ghost"
              >
                取消
              </Button>
              <Button
                className="min-h-11 px-3 text-xs"
                disabled={!draft}
                onClick={confirmCropping}
                size="sm"
              >
                确认裁剪
              </Button>
            </div>
          ) : (
            <ViewToolbar
              onActualSize={handleActualSize}
              onFit={onResetView}
              onZoomIn={() => zoomAt(view.scale * ZOOM_STEP, 0, 0)}
              onZoomOut={() => zoomAt(view.scale / ZOOM_STEP, 0, 0)}
              scale={view.scale}
            />
          )}
        </>
      ) : (
        <CanvasEmptyState />
      )}
    </div>
  );
}
