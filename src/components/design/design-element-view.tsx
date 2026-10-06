"use client";

/**
 * 设计元素渲染（text/image/shape 三类，spec design-editor「画布与元素渲染」）。
 * 外层负责几何（x/y/w/h/旋转/透明度/选中描边），内层按类型铺内容；
 * 模版缩略图直接以更小视口复用同一渲染（零额外实现）。
 */
import type { DesignElement, ImageElement, ShapeElement, TextElement } from "@/lib/design/doc";

function TextInner({ el }: { el: TextElement }) {
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
        className="w-full"
        style={{
          color: el.color,
          fontFamily: el.fontFamily,
          fontSize: el.fontSize,
          fontWeight: el.fontWeight,
          lineHeight: el.lineHeight,
          textAlign: el.align,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
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
  selected,
  onPointerDown,
}: {
  element: DesignElement;
  selected: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, element: DesignElement) => void;
}) {
  return (
    <div
      className={`absolute ${selected ? "outline-2 outline-violet-400 outline-solid" : ""} ${
        element.type === "image" ? "overflow-hidden" : ""
      }`}
      data-design-element={element.id}
      onPointerDown={(event) => {
        // 阻断冒泡：否则背景 handler 清空选中并把拖动覆盖为平移
        event.stopPropagation();
        onPointerDown(event, element);
      }}
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
        <TextInner el={element} />
      ) : element.type === "image" ? (
        <ImageInner el={element} />
      ) : (
        <ShapeInner el={element} />
      )}
    </div>
  );
}
