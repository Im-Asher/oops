import { describe, expect, it } from "vitest";
import { judgeL1, pngSize } from "./l1";

/** 最小 PNG 头：签名 + IHDR（宽高在 offset 16/20）。 */
function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(b.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

describe("pngSize", () => {
  it("读出 IHDR 宽高", () => {
    expect(pngSize(pngHeader(750, 1334))).toEqual([750, 1334]);
  });
  it("非 PNG 返回 null", () => {
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
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
});
