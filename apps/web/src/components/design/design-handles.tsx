"use client";

/**
 * 变换手柄（spec design-editor「选择与变换」）：单选元素叠加 8 向缩放点
 * （四角等比 + 四边中点单轴）与顶部旋转柄。手柄在画布面坐标系内跟随
 * 元素几何与旋转；尺寸按 1/viewScale 反缩放保持屏幕恒定大小。
 */
import type { DesignElement } from "@/lib/design/doc";

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** 手柄定位基准（元素盒百分比）与光标。 */
const HANDLE_STYLE: Record<HandleId, { left: string; top: string; cursor: string }> = {
  nw: { left: "0%", top: "0%", cursor: "nwse-resize" },
  n: { left: "50%", top: "0%", cursor: "ns-resize" },
  ne: { left: "100%", top: "0%", cursor: "nesw-resize" },
  e: { left: "100%", top: "50%", cursor: "ew-resize" },
  se: { left: "100%", top: "100%", cursor: "nwse-resize" },
  s: { left: "50%", top: "100%", cursor: "ns-resize" },
  sw: { left: "0%", top: "100%", cursor: "nesw-resize" },
  w: { left: "0%", top: "50%", cursor: "ew-resize" },
};

export function DesignHandles({
  element,
  viewScale,
  onHandlePointerDown,
}: {
  element: DesignElement;
  viewScale: number;
  onHandlePointerDown: (
    event: React.PointerEvent<HTMLDivElement>,
    element: DesignElement,
    kind: "scale" | "rotate",
    handle?: HandleId,
  ) => void;
}) {
  const size = 12 / viewScale;
  return (
    <div
      className="absolute"
      data-testid="design-handles"
      style={{
        height: element.h,
        left: element.x,
        pointerEvents: "none",
        top: element.y,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        width: element.w,
      }}
    >
      {HANDLES.map((handle) => (
        <div
          className="absolute rounded-full border border-violet-500 bg-white shadow-sm"
          data-handle={handle}
          key={handle}
          onPointerDown={(event) => {
            event.stopPropagation();
            onHandlePointerDown(event, element, "scale", handle);
          }}
          style={{
            cursor: HANDLE_STYLE[handle].cursor,
            height: size,
            left: `calc(${HANDLE_STYLE[handle].left} - ${size / 2}px)`,
            pointerEvents: "auto",
            top: `calc(${HANDLE_STYLE[handle].top} - ${size / 2}px)`,
            width: size,
          }}
        />
      ))}
      {/* 旋转柄：顶中上方，向下连线 */}
      <div
        className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center"
        style={{ pointerEvents: "none", top: `${-30 / viewScale}px` }}
      >
        <div
          className="rounded-full border border-violet-500 bg-white shadow-sm"
          data-handle="rotate"
          onPointerDown={(event) => {
            event.stopPropagation();
            onHandlePointerDown(event, element, "rotate");
          }}
          style={{
            cursor: "grab",
            height: 14 / viewScale,
            pointerEvents: "auto",
            width: 14 / viewScale,
          }}
        />
        <div
          className="bg-violet-400"
          style={{ height: 16 / viewScale, width: 1.5 / viewScale }}
        />
      </div>
    </div>
  );
}
