/**
 * 花字预设目录：预定义元素组（文本胶囊底色 + 角标形状等），松散插入 + 自动多选。
 * 默认文案来自词典（design.fancy.<id>.<key>），由面板组件按 locale 解析后传入 build。
 * 元素在局部坐标系布局（约从 0,0 起），插入时由 centerFragmentAt 落到视口中心。
 */
import { newElementId, type DesignElement, type ShapeElement, type TextElement } from "@/lib/design/doc";
import { shapeElement, textElement } from "@/lib/design/elements";

export interface FancyTextPreset {
  id: string;
  /** 默认文案词典 key 后缀：design.fancy.<id>.<key>，按序传给 build。 */
  contentKeys: readonly string[];
  build: (contents: string[]) => DesignElement[];
}

function pillText(opts: Partial<TextElement> & Pick<TextElement, "content" | "x" | "y" | "w" | "h" | "fontSize" | "background">): TextElement {
  return textElement({ fontWeight: 700, color: "#ffffff", ...opts });
}

const BULLET: Pick<ShapeElement, "kind" | "fill"> = { kind: "ellipse", fill: "#22c55e" };

export const FANCY_TEXT_PRESETS: FancyTextPreset[] = [
  {
    id: "pill",
    contentKeys: ["text"],
    build: ([text]) => [
      pillText({
        content: text,
        x: 0,
        y: 0,
        w: 320,
        h: 72,
        fontSize: 40,
        align: "center",
        background: { color: "#f97316", radius: 999, paddingX: 28, paddingY: 10 },
      }),
    ],
  },
  {
    id: "point",
    contentKeys: ["text"],
    build: ([text]) => [
      shapeElement({ ...BULLET, x: 0, y: 14, w: 28, h: 28 }),
      textElement({
        content: text,
        x: 44,
        y: 0,
        w: 380,
        h: 56,
        fontSize: 32,
        align: "left",
      }),
    ],
  },
  {
    id: "blast",
    contentKeys: ["label", "price"],
    build: ([label, price]) => [
      pillText({
        content: label,
        x: 0,
        y: 0,
        w: 180,
        h: 44,
        fontSize: 24,
        background: { color: "#ef4444", radius: 999, paddingX: 16, paddingY: 6 },
      }),
      textElement({
        content: price,
        x: 0,
        y: 56,
        w: 360,
        h: 110,
        fontSize: 96,
        fontWeight: 700,
        color: "#dc2626",
        align: "left",
      }),
    ],
  },
];

/** 花字预设 id 唯一守卫（词典 key 依赖）。 */
export function findFancyTextPreset(id: string): FancyTextPreset | null {
  return FANCY_TEXT_PRESETS.find((preset) => preset.id === id) ?? null;
}
