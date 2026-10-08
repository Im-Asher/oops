"use client";

/**
 * 设计画布（spec design-editor「画布与元素渲染」「选择与变换」）：
 * 固定尺寸画布矩形在可缩放视口中呈现；元素点选/拖动（多选整体移动），
 * 背景拖拽平移、滚轮/按钮/键盘缩放与适应画布；单选手柄等比（角）/
 * 单轴（边）缩放与旋转，多选渲染合并选择框；双击文本行内编辑
 * （blur/Esc 提交）。历史语义：拖动/编辑开始快照（beginHistory），
 * 过程内 patch 不入历史 → 一次撤销回到操作前。
 * 坐标换算复用 lib/canvas/coords 纯函数，本组件只做事件采集与派发。
 */
import { fitView, panView, zoomAtPoint } from "@/lib/canvas/coords";
import type { DesignElement } from "@/lib/design/doc";
import { type DesignAction, type DesignState } from "@/lib/design/design-reducer";
import { DesignElementView } from "@/components/design/design-element-view";
import { type HandleId, DesignHandles } from "@/components/design/design-handles";
import { ViewToolbar } from "@/components/canvas/view-toolbar";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

const ZOOM_STEP = 1.2;
/** fitView 的 padding 语义是像素边距（视口两侧各留）。 */
const FIT_PADDING_PX = 48;
/** 元素最小边长（缩放钳制下限）。 */
const MIN_ELEMENT_SIZE = 8;

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  kind: "pan" | "move" | "scale" | "rotate";
  /** 拖动/手柄会话的作用元素起点（多选整体移动取多条）。 */
  origins: { id: string; x: number; y: number }[];
  /** 屏幕→画布坐标换算基（会话期间视图不变）。 */
  scale: number;
  viewX: number;
  viewY: number;
  /** 容器视口原点：client 坐标先减容器偏移再减视图偏移。 */
  rectLeft: number;
  rectTop: number;
  // scale 会话：对面锚点固定模型（proj0 = 初始投影 = 对角距或轴宽）。
  anchor?: { x: number; y: number };
  /** 画布系拖拽方向单位向量（本地拖拽方向随元素旋转）。 */
  uAxis?: { x: number; y: number };
  proj0?: number;
  proportional?: boolean;
  axis?: "x" | "y";
  w0?: number;
  h0?: number;
  fontSize0?: number | null;
  // rotate 会话
  center?: { x: number; y: number };
  angle0?: number;
  rotation0?: number;
}

/** 手柄→本地几何：拖拽点 p 与对面锚点 a（以元素中心为原点的半宽高系数）。 */
const HANDLE_LOCAL: Record<HandleId, { p: { x: number; y: number }; a: { x: number; y: number }; axis: "x" | "y" }> = {
  nw: { p: { x: -1, y: -1 }, a: { x: 1, y: 1 }, axis: "x" },
  n: { p: { x: 0, y: -1 }, a: { x: 0, y: 1 }, axis: "y" },
  ne: { p: { x: 1, y: -1 }, a: { x: -1, y: 1 }, axis: "x" },
  e: { p: { x: 1, y: 0 }, a: { x: -1, y: 0 }, axis: "x" },
  se: { p: { x: 1, y: 1 }, a: { x: -1, y: -1 }, axis: "x" },
  s: { p: { x: 0, y: 1 }, a: { x: 0, y: -1 }, axis: "y" },
  sw: { p: { x: -1, y: 1 }, a: { x: 1, y: -1 }, axis: "x" },
  w: { p: { x: -1, y: 0 }, a: { x: 1, y: 0 }, axis: "x" },
};

/** 多选合并选择框：取各元素旋转后四角的包围盒（画布坐标系）。 */
function MergedSelectionBox({ elements }: { elements: DesignElement[] }) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    const rad = (el.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    for (const dx of [-el.w / 2, el.w / 2]) {
      for (const dy of [-el.h / 2, el.h / 2]) {
        minX = Math.min(minX, cx + dx * cos - dy * sin);
        minY = Math.min(minY, cy + dx * sin + dy * cos);
        maxX = Math.max(maxX, cx + dx * cos - dy * sin);
        maxY = Math.max(maxY, cy + dx * sin + dy * cos);
      }
    }
  }
  return (
    <div
      className="absolute border border-dashed border-violet-400"
      data-testid="design-selection-box"
      style={{
        height: maxY - minY,
        left: minX,
        pointerEvents: "none",
        top: minY,
        width: maxX - minX,
      }}
    />
  );
}

export function DesignCanvas({
  state,
  dispatch,
  surfaceRef,
}: {
  state: DesignState;
  dispatch: React.Dispatch<DesignAction>;
  /** 画布 surface 外部引用：导出（6.1）截图目标节点。 */
  surfaceRef?: React.Ref<HTMLDivElement>;
}) {
  const t = useTranslations("design.canvas");
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(state.view);
  const dragRef = useRef<DragSession | null>(null);
  /** 行内编辑中的文本元素 id（UI 态，不入 reducer/历史）。 */
  const [editingIdRaw, setEditingId] = useState<string | null>(null);
  const { doc, selection, view } = state;
  const selectedSet = new Set(selection);
  // 派生：编辑目标被删除/模版替换后自然失效（渲染期收敛，避免 effect 内 setState）。
  const editingId =
    editingIdRaw != null && doc.elements.some((el) => el.id === editingIdRaw) ? editingIdRaw : null;

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

  /** 视口原点换算基：client 坐标 → 画布坐标（scale/viewX/viewY + 容器原点）。 */
  const viewBasis = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      scale: viewRef.current.scale,
      viewX: viewRef.current.x,
      viewY: viewRef.current.y,
      rectLeft: rect?.left ?? 0,
      rectTop: rect?.top ?? 0,
    };
  };

  const handleBackgroundPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      kind: "pan",
      origins: [],
      ...viewBasis(),
    };
    dispatch({ type: "clearSelection" });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleElementPointerDown = (event: React.PointerEvent<HTMLDivElement>, element: DesignElement) => {
    if (event.button !== 0) return;
    // 编辑中：不启动移动会话也不重复快照（点击只调整光标，blur 提交内容）。
    if (editingId === element.id) return;
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
      ...viewBasis(),
    };
    dispatch({ type: "beginHistory" });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /** 手柄会话起点：角=对面角锚点等比缩放；边=对面边中点锚点单轴缩放。 */
  const handleHandlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    element: DesignElement,
    kind: "scale" | "rotate",
    handle?: HandleId,
  ) => {
    if (event.button !== 0) return;
    const base = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      ...viewBasis(),
    };
    const toCanvas = (clientX: number, clientY: number) => ({
      x: (clientX - base.rectLeft - base.viewX) / base.scale,
      y: (clientY - base.rectTop - base.viewY) / base.scale,
    });
    const center = { x: element.x + element.w / 2, y: element.y + element.h / 2 };
    const drag: DragSession = {
      kind,
      origins: [{ id: element.id, x: element.x, y: element.y }],
      ...base,
    };

    if (kind === "scale" && handle) {
      const spec = HANDLE_LOCAL[handle];
      const rad = (element.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      // 本地拖拽方向随元素旋转到画布系（对角向量归一）。
      const lx = (spec.p.x * element.w) / 2;
      const ly = (spec.p.y * element.h) / 2;
      const len = Math.hypot(lx, ly) || 1;
      const anchor = {
        x: center.x + (spec.a.x * element.w * cos - spec.a.y * element.h * sin) / 2,
        y: center.y + (spec.a.x * element.w * sin + spec.a.y * element.h * cos) / 2,
      };
      const p0 = toCanvas(event.clientX, event.clientY);
      drag.anchor = anchor;
      drag.uAxis = { x: (lx * cos - ly * sin) / len, y: (lx * sin + ly * cos) / len };
      drag.proj0 = (p0.x - anchor.x) * drag.uAxis.x + (p0.y - anchor.y) * drag.uAxis.y;
      drag.proportional = spec.p.x !== 0 && spec.p.y !== 0;
      drag.axis = spec.axis;
      drag.w0 = element.w;
      drag.h0 = element.h;
      drag.fontSize0 = element.type === "text" ? element.fontSize : null;
    } else {
      const p0 = toCanvas(event.clientX, event.clientY);
      drag.center = center;
      drag.angle0 = Math.atan2(p0.y - center.y, p0.x - center.x);
      drag.rotation0 = element.rotation;
    }
    dragRef.current = drag;
    dispatch({ type: "beginHistory" });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /** 双击文本进入行内编辑（多选收敛为该元素单选）。 */
  const handleElementDoubleClick = (element: DesignElement) => {
    if (element.type !== "text") return;
    dispatch({ type: "select", ids: [element.id] });
    setEditingId(element.id);
  };

  /** 行内编辑提交（blur/Esc）：内容变化才 patch；历史粒度复用双击前 pointerdown 的快照。 */
  const handleEditCommit = (element: DesignElement, content: string) => {
    setEditingId(null);
    const current = doc.elements.find((el) => el.id === element.id);
    if (!current || current.type !== "text" || current.content === content) return;
    dispatch({ type: "patchElements", history: false, patches: [{ id: element.id, patch: { content } }] });
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
    const target = drag.origins[0];
    if (!target) return;
    const px = (event.clientX - drag.rectLeft - drag.viewX) / drag.scale;
    const py = (event.clientY - drag.rectTop - drag.viewY) / drag.scale;

    if (drag.kind === "move") {
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
      return;
    }
    if (drag.kind === "scale" && drag.anchor && drag.uAxis) {
      const proj = (px - drag.anchor.x) * drag.uAxis.x + (py - drag.anchor.y) * drag.uAxis.y;
      // 比例钳到最小边长，避免拖过锚点后元素翻转。
      const minRatio = drag.proportional
        ? MIN_ELEMENT_SIZE / Math.min(drag.w0!, drag.h0!)
        : MIN_ELEMENT_SIZE / (drag.axis === "x" ? drag.w0! : drag.h0!);
      const ratio = Math.max(proj / drag.proj0!, minRatio);
      const w = drag.proportional || drag.axis === "x" ? drag.w0! * ratio : drag.w0!;
      const h = drag.proportional || drag.axis === "y" ? drag.h0! * ratio : drag.h0!;
      // 锚点固定：中心 = 锚点 + uAxis·(新半径)，角的新半径 = 新对角/2，边 = 新边宽/2。
      const cx = drag.anchor.x + drag.uAxis.x * ((drag.proj0! * ratio) / 2);
      const cy = drag.anchor.y + drag.uAxis.y * ((drag.proj0! * ratio) / 2);
      // fontSize 仅存在于 TextElement，用交叉类型承载可选字号。
      const patch: Partial<DesignElement> & { fontSize?: number } = { h, w, x: cx - w / 2, y: cy - h / 2 };
      if (drag.proportional && drag.fontSize0 != null) patch.fontSize = drag.fontSize0 * ratio;
      dispatch({ type: "patchElements", history: false, patches: [{ id: target.id, patch }] });
      return;
    }
    if (drag.kind === "rotate" && drag.center) {
      const angle = Math.atan2(py - drag.center.y, px - drag.center.x);
      dispatch({
        type: "patchElements",
        history: false,
        patches: [
          { id: target.id, patch: { rotation: drag.rotation0! + ((angle - drag.angle0!) * 180) / Math.PI } },
        ],
      });
    }
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

  const selectedElement =
    selection.length === 1 ? doc.elements.find((el) => el.id === selection[0]) : undefined;
  const selectedElements =
    selection.length > 1 ? doc.elements.filter((el) => selectedSet.has(el.id)) : [];

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
        ref={surfaceRef}
        style={{
          background: doc.background,
          height: doc.height,
          // 左上角锚定：与 lib/canvas/coords 的 screen↔canvas 换算模型一致
          // （默认 center origin 会在缩放时引入 origin·(1-scale) 的渲染偏移）。
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: "top left",
          width: doc.width,
        }}
      >
        {doc.elements.map((element) => (
          <DesignElementView
            editing={editingId === element.id}
            element={element}
            key={element.id}
            // 多选时高亮收敛到合并选择框，各元素不再单独描边。
            onEditCommit={handleEditCommit}
            onElementDoubleClick={handleElementDoubleClick}
            onPointerDown={handleElementPointerDown}
            selected={selectedSet.has(element.id) && selection.length === 1}
          />
        ))}
        {selectedElement && (
          <DesignHandles
            element={selectedElement}
            onHandlePointerDown={handleHandlePointerDown}
            viewScale={view.scale}
          />
        )}
        {selectedElements.length > 1 && <MergedSelectionBox elements={selectedElements} />}
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
