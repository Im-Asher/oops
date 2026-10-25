import { describe, expect, it } from "vitest";
import { imageSize, judgeL1, pngSize } from "./l1";

/** 最小 PNG 头：签名 + IHDR（宽高在 offset 16/20）。 */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

/** 最小 JPEG：SOI + APP0（2 字节占位载荷）+ SOF0 段（宽高在段内 +3/+5）。 */
function jpegHeader(width: number, height: number, sof = 0xc0): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]; // 长度 4 = 长度字段 2 + 载荷 2
  const sofSeg = [
    0xff,
    sof,
    0x00,
    0x11, // 段长 17
    0x08, // 精度
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // 分量数
    ...new Array<number>(12).fill(0),
  ];
  const eoi = [0xff, 0xd9];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sofSeg, ...eoi]);
}

describe("pngSize", () => {
  it("读出 IHDR 宽高", () => {
    expect(pngSize(pngHeader(750, 1334))).toEqual([750, 1334]);
  });
  it("非 PNG 返回 null", () => {
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("imageSize", () => {
  it("PNG 读出宽高与格式", () => {
    expect(imageSize(pngHeader(750, 1334))).toEqual({ width: 750, height: 1334, format: "png" });
  });

  it("JPEG 扫 SOF0 段读出宽高", () => {
    expect(imageSize(jpegHeader(750, 1000))).toEqual({ width: 750, height: 1000, format: "jpeg" });
  });

  it("JPEG 渐进式（SOF2）同样能读出宽高", () => {
    expect(imageSize(jpegHeader(768, 1344, 0xc2))).toEqual({
      width: 768,
      height: 1344,
      format: "jpeg",
    });
  });

  it("其它格式返回 null", () => {
    // RIFF/WEBP 头
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
      0x20,
    ]);
    expect(imageSize(webp)).toBeNull();
    expect(imageSize(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("judgeL1", () => {
  const base = {
    expect: { size: [750, 1334] as [number, number], denyCss: ["display:grid"] },
  };

  it("尺寸不符记 size_mismatch", () => {
    const r = judgeL1({
      ...base,
      artifacts: { assetUrl: "/f", size: [750, 1000], html: "<html></html>" },
      bytes: pngHeader(750, 1000),
    });
    expect(r.failures.map((f) => f.code)).toContain("size_mismatch");
  });

  it("命中 denyCss 记 css_unsupported", () => {
    const r = judgeL1({
      ...base,
      artifacts: { assetUrl: "/f", size: [750, 1334], html: "<div style='display:grid'></div>" },
      bytes: pngHeader(750, 1334),
    });
    expect(r.failures.map((f) => f.code)).toContain("css_unsupported");
  });

  it("无产物记 image_missing", () => {
    const r = judgeL1({
      ...base,
      artifacts: { assetUrl: null, size: null, html: null },
      bytes: null,
    });
    expect(r.failures.map((f) => f.code)).toContain("image_missing");
  });

  it("全部满足时零失败", () => {
    const r = judgeL1({
      ...base,
      artifacts: { assetUrl: "/f", size: [750, 1334], html: "<div style='display:flex'></div>" },
      bytes: pngHeader(750, 1334),
    });
    expect(r.failures).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it("JPEG 产物不再被判成 render_error", () => {
    const r = judgeL1({
      ...base,
      artifacts: { assetUrl: "/f", size: [750, 1334], html: "<html></html>" },
      bytes: jpegHeader(750, 1334),
    });
    expect(r.failures).toEqual([]);
  });

  it("无法识别的格式记 render_error 并说明支持范围", () => {
    const r = judgeL1({
      ...base,
      artifacts: { assetUrl: "/f", size: null, html: null },
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
    const f = r.failures.find((x) => x.code === "render_error");
    expect(f?.detail).toContain("PNG/JPEG");
  });

  describe("allowedHeights（海报高度档位由模型自选）", () => {
    const allowed = { ...base, expect: { ...base.expect, allowedHeights: [1000, 1334, 1654] } };

    it("高度落在允许集合内 → 通过", () => {
      for (const h of [1000, 1334, 1654]) {
        const r = judgeL1({
          ...allowed,
          artifacts: { assetUrl: "/f", size: [750, h], html: "<div style='display:flex'></div>" },
          bytes: pngHeader(750, h),
        });
        expect(r.failures, `高度 ${h} 应通过`).toEqual([]);
      }
    });

    it("高度不在允许集合内 → size_mismatch", () => {
      const r = judgeL1({
        ...allowed,
        artifacts: { assetUrl: "/f", size: [750, 1200], html: "<div style='display:flex'></div>" },
        bytes: pngHeader(750, 1200),
      });
      expect(r.failures.map((f) => f.code)).toContain("size_mismatch");
    });

    it("宽度不符仍记 size_mismatch（宽固定 750）", () => {
      const r = judgeL1({
        ...allowed,
        artifacts: { assetUrl: "/f", size: [750, 1334], html: "<div style='display:flex'></div>" },
        bytes: pngHeader(900, 1334),
      });
      expect(r.failures.map((f) => f.code)).toContain("size_mismatch");
    });

    it("未给 allowedHeights 时维持精确比较", () => {
      const r = judgeL1({
        ...base,
        artifacts: { assetUrl: "/f", size: [750, 1654], html: "<div style='display:flex'></div>" },
        bytes: pngHeader(750, 1654),
      });
      expect(r.failures.map((f) => f.code)).toContain("size_mismatch");
    });
  });

  describe("allowedSizes（尺寸由模型从枚举里挑）", () => {
    const allowed = {
      ...base,
      expect: {
        ...base.expect,
        allowedSizes: [
          [1024, 1024],
          [768, 1344],
        ] as [number, number][],
      },
    };

    it("命中集合内任一尺寸 → 通过", () => {
      for (const [w, h] of [
        [1024, 1024],
        [768, 1344],
      ]) {
        const r = judgeL1({
          ...allowed,
          artifacts: { assetUrl: "/f", size: [w, h], html: null },
          bytes: pngHeader(w, h),
        });
        expect(r.failures, `${w}×${h}`).toEqual([]);
      }
    });

    it("枚举外的尺寸 → size_mismatch", () => {
      const r = judgeL1({
        ...allowed,
        artifacts: { assetUrl: "/f", size: [900, 900], html: null },
        bytes: pngHeader(900, 900),
      });
      expect(r.failures.map((f) => f.code)).toContain("size_mismatch");
    });
  });
});
