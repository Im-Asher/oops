/**
 * 模版：电商主图 800×800。
 * 模版即预填好的 DesignDoc；首层为全幅背景 rect（画布背景色保持用户设置）。
 * 样例文案随模版交付（资产数据，非 UI chrome），名称走词典。
 */
import type { DesignDoc } from "@/lib/design/doc";
import { imageElement, shapeElement, textElement } from "@/lib/design/elements";
import { MATERIALS_DIR } from "@/lib/design/materials";

export function buildEcomMainTemplate(): DesignDoc {
  return {
    version: 1,
    width: 800,
    height: 800,
    background: "#ffffff",
    elements: [
      shapeElement({ kind: "rect", fill: "#fff7ed", x: 0, y: 0, w: 800, h: 800 }),
      imageElement({
        src: `/${MATERIALS_DIR}/badge-starburst.svg`,
        x: 560,
        y: 60,
        w: 180,
        h: 180,
        rotation: 10,
      }),
      textElement({
        content: "新品上市",
        x: 60,
        y: 80,
        w: 240,
        h: 56,
        fontSize: 28,
        fontWeight: 700,
        color: "#ffffff",
        background: { color: "#ef4444", radius: 999, paddingX: 16, paddingY: 8 },
      }),
      textElement({
        content: "夏日清爽系列",
        x: 60,
        y: 170,
        w: 560,
        h: 92,
        fontSize: 64,
        fontWeight: 700,
        fontFamily: "'Smiley Sans'",
        align: "left",
        color: "#1f2937",
      }),
      textElement({
        content: "轻盈质地 · 持久留香",
        x: 60,
        y: 276,
        w: 460,
        h: 42,
        fontSize: 28,
        align: "left",
        color: "#6b7280",
      }),
      textElement({
        content: "¥59",
        x: 60,
        y: 540,
        w: 300,
        h: 112,
        fontSize: 96,
        fontWeight: 700,
        fontFamily: "'Smiley Sans'",
        align: "left",
        color: "#dc2626",
      }),
      textElement({
        content: "日常价 ¥99",
        x: 62,
        y: 668,
        w: 220,
        h: 36,
        fontSize: 24,
        align: "left",
        color: "#9ca3af",
      }),
      shapeElement({ kind: "rect", fill: "#1f2937", x: 0, y: 740, w: 800, h: 60 }),
      textElement({
        content: "SHOP NOW",
        x: 60,
        y: 754,
        w: 220,
        h: 32,
        fontSize: 24,
        fontWeight: 700,
        align: "left",
        color: "#ffffff",
      }),
    ],
  };
}
