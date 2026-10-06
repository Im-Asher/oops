"use client";

/**
 * 设计画布（spec design-editor「画布与元素渲染」「选择与变换」）：
 * 固定尺寸画布矩形在可缩放视口中呈现；元素点选/拖动（多选整体移动），
 * 背景拖拽平移、滚轮/按钮/键盘缩放与适应画布。历史语义：拖动开始
 * beginHistory 快照，过程内 patch 不入历史 → 一次撤销回到拖动前。
 * 坐标换算复用 lib/canvas/coords 纯函数，本组件只做事件采集与派发。
 */
import { fitView, panView, zoomAtPoint } from "@/lib/canvas/coords";
import type { DesignElement } from "@/lib/design/doc";
import { type DesignAction, type DesignState } from "@/lib/design/design-reducer";
import { DesignElementView } from "@/components/design/design-element-view";
import { ViewToolbar } from "@/components/canvas/view-toolbar";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef } from "react";

const ZOOM_STEP = 1.2;
/** fitView 的 padding 语义是像素边距（视口两侧各留）。 */
const FIT_PADDING_PX = 48;

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  kind: "pan" | "move";
  /** move 会话：全部选中元素的拖动起点（多选整体移动）。 */
  origins: { id: string; x: number; y: number }[];
  scale: number;
}

export function DesignCanvas({
  state,
  dispatch,
}: {
  state: DesignState;
  dispatch: React.Dispatch<DesignAction>;
}) {
  const t = useTranslations("design.canvas");
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(state.view);
  const dragRef = useRef<DragSession | null>(null);
  const { doc, selection, view } = state;
  const selectedSet = new Set(selection);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  /** 画布矩形适配视口（初始与「适应画布」入口）。 */
  const fitCanvas = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const next = fitView(
      [{ x: 0, y: 0, width: doc.width, height: doc.height }],
      { width: rect.width, height: rect.height },
      FIT_PADDING_PX,
    );
    if (next) {
      viewRef.current = next;
      dispatch({ type: "setView", view: next });
    }
  }, [dispatch, doc.width, doc.height]);

  // 挂载后初始适配一次。
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current) return;
    didFitRef.current = true;
    fitCanvas();
  }, [fitCanvas]);

  const zoomBy = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = zoomAtPoint(
        viewRef.current,
        viewRef.current.scale * factor,
        { x: rect.width / 2, y: rect.height / 2 },
      );
      viewRef.current = next;
      dispatch({ type: "setView", view: next });
    },
    [dispatch],
  );

  // 滚轮缩放：React onWheel 为被动监听无法 preventDefault，手动挂非被动监听。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const next = zoomAtPoint(
        viewRef.current,
        viewRef.current.scale * Math.exp(-event.deltaY * 0.0015),
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      );
      viewRef.current = next;
      dispatch({ type: "setView", view: next });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [dispatch]);

  const handleBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      kind: "pan",
      origins: [],
      scale: 1,
    };
    dispatch({ type: "clearSelection" });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleElementPointerDown = (event: React.PointerEvent<HTMLDivElement>, element: DesignElement) => {
    if (event.button !== 0) return;
    if (event.shiftKey) {
      dispatch({ type: "toggleSelect", id: element.id });
      return;
    }
    // 已在多选内：保留现有多选整体拖动；否则收敛为单选。
    const ids = selectedSet.has(element.id) ? selection : [element.id];
    if (!selectedSet.has(element.id)) dispatch({ type: "select", ids });
    const origins = ids
      .map((id) => {
        const el = doc.elements.find((e) => e.id === id);
        return el ? { id, x: el.x, y: el.y } : null;
      })
      .filter((v): v is { id: string; x: number; y: number } => v !== null);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      kind: "move",
      origins,
      scale: viewRef.current.scale,
    };
    dispatch({ type: "beginHistory" });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "pan") {
      dispatch({
        type: "setView",
        view: panView(
          { scale: viewRef.current.scale, x: viewRef.current.x, y: viewRef.current.y },
          event.clientX - drag.startX,
          event.clientY - drag.startY,
        ),
      });
      return;
    }
    const dx = (event.clientX - drag.startX) / drag.scale;
    const dy = (event.clientY - drag.startY) / drag.scale;
    dispatch({
      type: "patchElements",
      history: false,
      patches: drag.origins.map((origin) => ({
        id: origin.id,
        patch: { x: origin.x + dx, y: origin.y + dy },
      })),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") zoomBy(1 / ZOOM_STEP);
    else if (event.key === "0") fitCanvas();
    else if (event.key === "Escape") dispatch({ type: "clearSelection" });
    else if (event.key === "Delete" || event.key === "Backspace") {
      if (selection.length > 0) dispatch({ type: "deleteSelected" });
    } else return;
    event.preventDefault();
  };

  return (
    <div
      aria-label={t("label")}
      className="absolute inset-0 touch-none overflow-hidden bg-sidebar"
      onKeyDown={handleKeyDown}
      onPointerCancel={handlePointerUp}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={containerRef}
      role="application"
      tabIndex={0}
    >
      <div
        className="absolute left-0 top-0 shadow-lg shadow-black/10"
        data-testid="design-canvas-surface"
        style={{
          background: doc.background,
          height: doc.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          width: doc.width,
        }}
      >
        {doc.elements.map((element) => (
          <DesignElementView
            element={element}
            key={element.id}
            onPointerDown={handleElementPointerDown}
            selected={selectedSet.has(element.id)}
          />
        ))}
      </div>

      <ViewToolbar
        onFit={fitCanvas}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
        onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
        scale={view.scale}
      />
    </div>
  );
}
