/**
 * 模版：小红书封面 1242×1656（竖版社媒）。
 */
import type { DesignDoc } from "@/lib/design/doc";
import { shapeElement, textElement } from "@/lib/design/elements";

export function buildXhsCoverTemplate(): DesignDoc {
  return {
    version: 1,
    width: 1242,
    height: 1656,
    background: "#ffffff",
    elements: [
      shapeElement({ kind: "rect", fill: "#fef3c7", x: 0, y: 0, w: 1242, h: 1656 }),
      shapeElement({
        kind: "ellipse",
        fill: "#fca5a5",
        x: 820,
        y: 120,
        w: 320,
        h: 320,
        opacity: 0.6,
      }),
      shapeElement({
        kind: "ellipse",
        fill: "#93c5fd",
        x: 80,
        y: 1240,
        w: 220,
        h: 220,
        opacity: 0.5,
      }),
      textElement({
        content: "周末探店",
        x: 120,
        y: 420,
        w: 900,
        h: 130,
        fontSize: 96,
        fontWeight: 700,
        fontFamily: "'Smiley Sans'",
        align: "left",
        color: "#1f2937",
      }),
      textElement({
        content: "vlog 合集",
        x: 120,
        y: 580,
        w: 900,
        h: 130,
        fontSize: 96,
        fontWeight: 700,
        fontFamily: "'Smiley Sans'",
        align: "left",
        color: "#ea580c",
      }),
      textElement({
        content: "收藏不迷路",
        x: 120,
        y: 800,
        w: 380,
        h: 76,
        fontSize: 32,
        fontWeight: 700,
        color: "#ffffff",
        background: { color: "#1f2937", radius: 999, paddingX: 24, paddingY: 10 },
      }),
      textElement({
        content: "@设计小站 · 每周更新",
        x: 120,
        y: 1400,
        w: 700,
        h: 50,
        fontSize: 36,
        align: "left",
        color: "#78716c",
      }),
    ],
  };
}
