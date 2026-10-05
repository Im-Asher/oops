"use client";

import { CanvasEmptyState } from "@/components/canvas/canvas-empty-state";
import { CropOverlay } from "@/components/canvas/crop-overlay";
import { EditToolbar } from "@/components/canvas/edit-toolbar";
import { FilterPanel } from "@/components/canvas/filter-panel";
import { ViewToolbar } from "@/components/canvas/view-toolbar";
import { Button } from "@/components/ui/button";
import {
  isItemDirty,
  normalizeCrop,
  selectedItem,
  type CanvasAction,
  type CanvasItem,
  type CanvasState,
  type CropRect,
  type Filters,
} from "@/lib/canvas/canvas-reducer";
import { centerViewOn, fitView, panView, zoomAtPoint } from "@/lib/canvas/coords";
import { filtersToCssOrNone } from "@/lib/canvas/filter-string";
import { itemRect } from "@/lib/canvas/layout";
import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const ZOOM_STEP = 1.2;
/** 点阵网格间距（屏幕 px，随视角缩放）。 */
const GRID_SIZE = 24;

interface CanvasStageProps {
  state: CanvasState;
  dispatch: React.Dispatch<CanvasAction>;
  exportError: string | null;
  /** 定位请求：nonce 变化时把该 asset 条目平移到视口中心并选中（聊天摘要联动）。 */
  focus?: { assetId: string; nonce: number } | null;
  onResetEdits: () => void;
  /** 失败占位卡重试：以卡内保存的原始意图重新发起一轮对话。 */
  onRetryItem?: (item: CanvasItem) => void;
}

/** 单条目：图片按裁剪/滤镜预览；生成中/失败为占位卡。 */
function CanvasItemView({
  item,
  selected,
  onPointerDown,
  onImageLoad,
  onRetry,
}: {
  item: CanvasItem;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, item: CanvasItem) => void;
  onImageLoad: (item: CanvasItem, aspect: number) => void;
  onRetry?: (item: CanvasItem) => void;
}) {
  return (
    <div
      className={`absolute overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900 ${
        selected ? "ring-2 ring-violet-400" : ""
      } ${item.status === "image" ? "cursor-grab active:cursor-grabbing" : ""}`}
      data-item-id={item.id}
      onPointerDown={(event) => onPointerDown(event, item)}
      style={{ height: item.width * item.aspect, left: item.x, top: item.y, width: item.width }}
    >
      {item.status === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={item.name ?? "画布作品"}
          className="size-full object-cover"
          draggable={false}
          loading="lazy"
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              onImageLoad(item, img.naturalHeight / img.naturalWidth);
            }
          }}
          src={item.url}
          style={{
            clipPath: item.edit.crop
              ? `inset(${item.edit.crop.y * 100}% ${(1 - item.edit.crop.x - item.edit.crop.width) * 100}% ${
                  (1 - item.edit.crop.y - item.edit.crop.height) * 100
                }% ${item.edit.crop.x * 100}%)`
              : undefined,
            filter: filtersToCssOrNone(item.edit.filters),
          }}
        />
      ) : item.status === "generating" ? (
        <div className="flex size-full flex-col items-center justify-center gap-2 border-dashed p-3 text-center">
          <LoaderCircleIcon className="size-5 animate-spin text-zinc-400" />
          <p className="text-xs text-zinc-300">生成中…</p>
          {item.prompt ? <p className="line-clamp-2 text-xs text-zinc-500">{item.prompt}</p> : null}
        </div>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 border-red-900/60 p-3 text-center">
          <TriangleAlertIcon className="size-5 text-red-400" />
          <p className="text-xs text-red-200">生成失败</p>
          {item.errorMessage ? (
            <p className="line-clamp-2 text-xs text-zinc-500">{item.errorMessage}</p>
          ) : null}
          {onRetry ? (
            <Button
              aria-label="重试生成"
              className="mt-1 h-7 rounded-md bg-red-500/15 px-2.5 text-xs text-red-200 hover:bg-red-500/25"
              onClick={(event) => {
                // 阻止冒泡：重试不应触发画布拖拽/选中
                event.stopPropagation();
                onRetry(item);
              }}
              size="sm"
              variant="ghost"
            >
              重试
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * 多作品画布平面：items 统一渲染在可平移缩放的平面上，点选选中、拖动排版、
 * 滚轮/按钮缩放与适应全部；裁剪/滤镜作用于选中条目。
 * 坐标换算与几何算法在 lib/canvas（纯函数），本组件只做事件采集与结果应用。
 */
export function CanvasStage({
  state,
  dispatch,
  exportError,
  focus,
  onResetEdits,
  onRetryItem,
}: CanvasStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(state.view);
  const cropSessionRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  // 裁剪会话绑定选中条目 id + url：换选中/换图自动失效，无需 effect 重置。
  const [cropSession, setCropSession] = useState<{ itemId: string; url: string } | null>(null);
  const [draft, setDraft] = useState<CropRect | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    kind: "pan" | "item";
    itemId?: string;
    originX: number;
    originY: number;
    scale: number;
  } | null>(null);

  const { items, view, selectedId } = state;
  const selected = selectedItem(state);
  const cropItem = cropSession ? items.find((i) => i.id === cropSession.itemId) : undefined;
  const cropping =
    !!cropSession && cropItem?.url === cropSession.url && cropItem.status === "image";

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // 裁剪状态镜像到 ref：非被动 wheel 监听闭包内读取，避免每次裁剪开关都重挂监听。
  useEffect(() => {
    cropSessionRef.current = cropping;
  }, [cropping]);

  // 选中条目消失时丢弃进行中的拖拽（改 ref 不触发渲染）。
  useEffect(() => {
    const drag = dragRef.current;
    if (drag?.kind === "item" && drag.itemId && !items.some((i) => i.id === drag.itemId)) {
      dragRef.current = null;
      setDragging(false);
    }
  }, [items]);

  /** 以容器中心为锚点缩放（按钮与键盘入口）。 */
  const zoomBy = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      if (!el || cropSessionRef.current) return;
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

  /** 适应全部条目（无条目时保持当前视图）。 */
  const fitAll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = fitView(
      items.map(itemRect),
      { width: rect.width, height: rect.height },
    );
    if (next) {
      viewRef.current = next;
      dispatch({ type: "setView", view: next });
    }
  }, [dispatch, items]);

  // 定位请求：以当前缩放把目标条目平移到视口中心并选中；nonce 防重复，
  // 条目可能由消息派生稍后到达，依赖 items 使补派生后的定位仍生效。
  const lastFocusNonce = useRef(-1);
  useEffect(() => {
    if (!focus || focus.nonce === lastFocusNonce.current) return;
    const target = items.find((i) => i.assetId === focus.assetId);
    if (!target) return;
    lastFocusNonce.current = focus.nonce;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = centerViewOn(itemRect(target), { width: rect.width, height: rect.height }, viewRef.current.scale);
    viewRef.current = next;
    dispatch({ type: "select", id: target.id });
    dispatch({ type: "setView", view: next });
  }, [focus, items, dispatch]);

  // React 的 onWheel 是被动监听，无法 preventDefault，故手动挂非被动监听。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (cropSessionRef.current) return;
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

  // 高频滚轮经 viewRef 同步回写，避免基于同一旧基线重算。

  const handleImageLoad = useCallback(
    (item: CanvasItem, aspect: number) => {
      if (Number.isFinite(aspect) && aspect > 0 && Math.abs(aspect - item.aspect) > 0.01) {
        dispatch({ type: "patchItem", id: item.id, patch: { aspect } });
      }
    },
    [dispatch],
  );

  /**
   * 进入裁剪前先适应选中图：裁剪蒙层位于画布平面坐标（随视角变换），
   * 视角锁定后无需测量与重测；窗口尺寸变化只影响可视比例不影响归一化坐标。
   */
  const startCropping = () => {
    if (!selected || selected.status !== "image") return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = fitView([itemRect(selected)], { width: rect.width, height: rect.height }, 80);
    if (next) {
      viewRef.current = next;
      dispatch({ type: "setView", view: next });
    }
    setFiltersOpen(false);
    setCropSession({ itemId: selected.id, url: selected.url });
    setDraft(null);
  };

  const cancelCropping = () => {
    setCropSession(null);
    setDraft(null);
  };

  const confirmCropping = () => {
    if (!draft || !cropSession) return;
    const normalized = normalizeCrop(draft);
    if (normalized) dispatch({ type: "setCrop", id: cropSession.itemId, crop: normalized });
    cancelCropping();
  };

  const handleItemPointerDown = (event: React.PointerEvent<HTMLDivElement>, item: CanvasItem) => {
    if (event.button !== 0 || cropping) return;
    // 点下即选中；图片可拖动排版，画布平移走空白区域拖拽。
    dispatch({ type: "select", id: item.id });
    if (item.status !== "image") return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      kind: "item",
      itemId: item.id,
      originX: item.x,
      originY: item.y,
      scale: viewRef.current.scale,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || cropping) return;
    // 空白处：取消选中并拖拽平移画布。
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      kind: "pan",
      originX: viewRef.current.x,
      originY: viewRef.current.y,
      scale: 1,
    };
    dispatch({ type: "select", id: null });
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "pan") {
      dispatch({
        type: "setView",
        view: panView(
          { scale: viewRef.current.scale, x: drag.originX, y: drag.originY },
          event.clientX - drag.startX,
          event.clientY - drag.startY,
        ),
      });
    } else if (drag.itemId) {
      dispatch({
        type: "moveItem",
        id: drag.itemId,
        x: drag.originX + (event.clientX - drag.startX) / drag.scale,
        y: drag.originY + (event.clientY - drag.startY) / drag.scale,
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (cropping) {
      if (event.key === "Escape") {
        cancelCropping();
        event.preventDefault();
      }
      return;
    }
    if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") zoomBy(1 / ZOOM_STEP);
    else if (event.key === "0") fitAll();
    else if (event.key === "Escape") dispatch({ type: "select", id: null });
    else return;
    event.preventDefault();
  };

  const cropArea =
    cropItem && cropSession
      ? {
          left: cropItem.x,
          top: cropItem.y,
          width: cropItem.width,
          height: cropItem.width * cropItem.aspect,
        }
      : null;

  return (
    <div
      className={`absolute inset-0 touch-none overflow-hidden bg-[#0B0B0D] ${
        dragging ? "cursor-grabbing" : ""
      }`}
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundSize: `${GRID_SIZE * view.scale}px ${GRID_SIZE * view.scale}px`,
      }}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      ref={containerRef}
      role="application"
      aria-label="画布，可缩放、平移与拖动作品"
      tabIndex={0}
    >
      {items.length === 0 ? (
        <CanvasEmptyState />
      ) : (
        <div
          className="absolute left-0 top-0"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          {items.map((item) => (
            <CanvasItemView
              item={item}
              key={item.id}
              onImageLoad={handleImageLoad}
              onPointerDown={handleItemPointerDown}
              onRetry={onRetryItem}
              selected={item.id === selectedId}
            />
          ))}
          {cropping && cropArea ? (
            <CropOverlay area={cropArea} draft={draft} onDraftChange={setDraft} />
          ) : null}
        </div>
      )}

      {selected && selected.status === "image" ? (
        <>
          <EditToolbar
            cropping={cropping}
            dirty={isItemDirty(selected)}
            filtersOpen={filtersOpen && !cropping}
            onResetEdits={onResetEdits}
            onToggleCrop={cropping ? cancelCropping : startCropping}
            onToggleFilters={() => setFiltersOpen((open) => !open)}
          />
          {filtersOpen && !cropping ? (
            <FilterPanel
              filters={selected.edit.filters as Filters}
              onChange={(filters) =>
                dispatch({ type: "setFilters", id: selected.id, filters })
              }
              onClose={() => setFiltersOpen(false)}
              onReset={() => dispatch({ type: "resetFilters", id: selected.id })}
            />
          ) : null}
        </>
      ) : null}

      {cropping ? (
        <div
          className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-1 shadow-lg shadow-black/30"
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
          onFit={fitAll}
          onZoomIn={() => zoomBy(ZOOM_STEP)}
          onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
          scale={view.scale}
        />
      )}

      {exportError ? (
        <p
          className="absolute bottom-16 left-1/2 z-20 max-w-[90%] -translate-x-1/2 rounded-lg border border-red-900/60 bg-red-950/90 px-3 py-2 text-xs text-red-200"
          role="alert"
        >
          {exportError}
        </p>
      ) : null}
    </div>
  );
}
