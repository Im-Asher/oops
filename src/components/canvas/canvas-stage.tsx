"use client";

import { CanvasEmptyState } from "@/components/canvas/canvas-empty-state";
import { ViewToolbar } from "@/components/canvas/view-toolbar";
import {
  clampScale,
  type CanvasImage,
  type CanvasView,
} from "@/lib/canvas/canvas-reducer";
import { useCallback, useEffect, useRef, useState } from "react";

const ZOOM_STEP = 1.2;

interface CanvasStageProps {
  image: CanvasImage | null;
  view: CanvasView;
  onViewChange: (view: CanvasView) => void;
  onResetView: () => void;
}

/**
 * 全屏画布：无激活图时空态引导，有激活图时 contain 居中展示。
 * 缩放平移只改 view（transform 走 GPU 合成），不触碰图片数据。
 */
export function CanvasStage({ image, view, onViewChange, onResetView }: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewRef = useRef(view);
  const [dragging, setDragging] = useState(false);
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
    if (!el || !image) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      zoomAt(viewRef.current.scale * Math.exp(-event.deltaY * 0.0015), dx, dy);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [image, zoomAt]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!image || event.button !== 0) return;
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
              dragging && image ? "cursor-grabbing" : "cursor-grab"
            }`}
            draggable={false}
            ref={imgRef}
            src={image.url}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          />
          <ViewToolbar
            onActualSize={handleActualSize}
            onFit={onResetView}
            onZoomIn={() => zoomAt(view.scale * ZOOM_STEP, 0, 0)}
            onZoomOut={() => zoomAt(view.scale / ZOOM_STEP, 0, 0)}
            scale={view.scale}
          />
        </>
      ) : (
        <CanvasEmptyState />
      )}
    </div>
  );
}
