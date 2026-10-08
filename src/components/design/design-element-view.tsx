"use client";

/**
 * 设计元素渲染（text/image/shape 三类，spec design-editor「画布与元素渲染」）。
 * 外层负责几何（x/y/w/h/旋转/透明度/选中描边），内层按类型铺内容；
 * 文本支持行内编辑：双击进入（contentEditable），blur/Esc 提交为一次
 * 内容 patch（历史粒度由画布层控制），编辑期间 DOM 文本不走 React 受控。
 * 模版缩略图直接以更小视口复用同一渲染（零额外实现）。
 */
import type { DesignElement, ImageElement, ShapeElement, TextElement } from "@/lib/design/doc";
import { useEffect, useRef } from "react";

/** 读编辑态纯文本：innerText 保留 <br> 换行，退化 textContent；去掉编辑产生的尾部换行。 */
function readEditableText(node: HTMLElement): string {
  const text = typeof node.innerText === "string" ? node.innerText : (node.textContent ?? "");
  return text.replace(/\n+$/, "");
}

function TextInner({
  el,
  editing,
  onEditCommit,
}: {
  el: TextElement;
  editing: boolean;
  onEditCommit?: (element: TextElement, content: string) => void;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);

  // 进入编辑：聚焦并全选，便于直接替换内容。
  useEffect(() => {
    if (!editing) return;
    const node = spanRef.current;
    if (!node) return;
    node.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {
      // 无选区 API 的环境（部分 jsdom 场景）只 focus 即可。
    }
  }, [editing]);

  const commit = () => {
    if (!editing) return;
    const node = spanRef.current;
    if (!node) return;
    onEditCommit?.(el, readEditableText(node));
  };

  return (
    <div
      className="flex size-full flex-col"
      style={{
        background: el.background?.color ?? undefined,
        borderRadius: el.background?.radius,
        padding: el.background ? `${el.background.paddingY}px ${el.background.paddingX}px` : undefined,
      }}
    >
      <span
        className="w-full outline-none"
        contentEditable={editing}
        onBlur={editing ? commit : undefined}
        onKeyDown={(event) => {
          if (!editing) return;
          // 编辑中的按键不冒泡到画布快捷键（Delete 删除 / Esc 清选 / +−0 缩放）。
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            commit();
          }
        }}
        ref={spanRef}
        spellCheck={false}
        style={{
          color: el.color,
          cursor: editing ? "text" : undefined,
          fontFamily: el.fontFamily,
          fontSize: el.fontSize,
          fontWeight: el.fontWeight,
          lineHeight: el.lineHeight,
          textAlign: el.align,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
        suppressContentEditableWarning
      >
        {el.content}
      </span>
    </div>
  );
}

function ImageInner({ el }: { el: ImageElement }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      className="size-full"
      draggable={false}
      src={el.src}
      style={{ borderRadius: el.radius, objectFit: el.fit }}
    />
  );
}

function ShapeInner({ el }: { el: ShapeElement }) {
  return (
    <div
      className="size-full"
      style={{
        background: el.fill,
        borderRadius: el.kind === "ellipse" ? "50%" : (el.radius ?? 0),
      }}
    />
  );
}

export function DesignElementView({
  element,
  selected = false,
  editing = false,
  onPointerDown,
  onElementDoubleClick,
  onEditCommit,
}: {
  element: DesignElement;
  selected?: boolean;
  /** 行内编辑态（仅文本元素有意义）。 */
  editing?: boolean;
  /** 不传 = 纯展示（模版缩略图复用，无选中/拖动交互）。 */
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>, element: DesignElement) => void;
  onElementDoubleClick?: (element: DesignElement) => void;
  onEditCommit?: (element: DesignElement, content: string) => void;
}) {
  return (
    <div
      className={`absolute ${selected ? "outline-2 outline-violet-400 outline-solid" : ""} ${
        element.type === "image" ? "overflow-hidden" : ""
      }`}
      data-design-element={element.id}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onElementDoubleClick?.(element);
      }}
      onPointerDown={
        onPointerDown
          ? (event) => {
              // 阻断冒泡：否则背景 handler 清空选中并把拖动覆盖为平移
              event.stopPropagation();
              onPointerDown(event, element);
            }
          : undefined
      }
      style={{
        height: element.h,
        left: element.x,
        opacity: element.opacity,
        top: element.y,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        width: element.w,
      }}
    >
      {element.type === "text" ? (
        <TextInner el={element} editing={editing} onEditCommit={onEditCommit} />
      ) : element.type === "image" ? (
        <ImageInner el={element} />
      ) : (
        <ShapeInner el={element} />
      )}
    </div>
  );
}
