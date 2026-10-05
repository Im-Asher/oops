"use client";

import type { CropRect } from "@/lib/canvas/canvas-reducer";
import { useRef } from "react";

export interface CropArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CropOverlayProps {
  /** 与图片显示区域重合的定位信息（容器坐标） */
  area: CropArea;
  /** 归一化裁剪草稿；null 表示尚未框选 */
  draft: CropRect | null;
  onDraftChange: (rect: CropRect | null) => void;
}

/**
 * 裁剪蒙层：pointer 框选，选区外压暗、选区内保持原亮度。
 * 组件被定位到与图片显示区域完全重合，故百分比坐标即归一化图像坐标。
 */
export function CropOverlay({ area, draft, onDraftChange }: CropOverlayProps) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerRef = useRef<number | null>(null);

  const toNormalized = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || activePointerRef.current !== null) return;
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = toNormalized(event);
    onDraftChange(null);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || activePointerRef.current !== event.pointerId) return;
    const current = toNormalized(event);
    onDraftChange({
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    startRef.current = null;
  };

  return (
    <div
      className="absolute z-10 cursor-crosshair overflow-hidden touch-none"
      onPointerCancel={handlePointerUp}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ left: area.left, top: area.top, width: area.width, height: area.height }}
    >
      {draft ? (
        <div
          className="pointer-events-none absolute border-2 border-white"
          style={{
            left: `${draft.x * 100}%`,
            top: `${draft.y * 100}%`,
            width: `${draft.width * 100}%`,
            height: `${draft.height * 100}%`,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)",
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/40" />
      )}
    </div>
  );
}
