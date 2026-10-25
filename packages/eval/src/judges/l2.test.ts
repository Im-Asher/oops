import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, judgeL2, measureHtml } from "./l2";

const fit = `<html><body style="margin:0;width:750px;height:1334px;overflow:hidden">
  <div style="height:1334px;display:flex">ok</div></body></html>`;

const overflow = `<html><body style="margin:0;width:750px;height:1334px">
  <div style="height:2000px">too tall</div></body></html>`;

afterAll(async () => {
  await closeBrowser();
});

describe("measureHtml", () => {
  it("量出溢出像素", async () => {
    const m = await measureHtml(overflow, [750, 1334]);
    expect(m.overflowPx).toBeGreaterThan(600);
    expect(m.text).toContain("too tall");
  }, 60_000);

  it("不溢出时 overflowPx 为 0", async () => {
    const m = await measureHtml(fit, [750, 1334]);
    expect(m.overflowPx).toBe(0);
  }, 60_000);
});

describe("judgeL2", () => {
  it("超过 maxOverflowPx 记 overflow", async () => {
    const m = await measureHtml(overflow, [750, 1334]);
    const r = judgeL2({ metrics: m, maxOverflowPx: 0 });
    expect(r.failures.map((f) => f.code)).toContain("overflow");
  }, 60_000);

  it("图片未加载记 image_missing", () => {
    const r = judgeL2({
      metrics: { overflowPx: 0, clientHeight: 1334, scrollHeight: 1334, text: "", images: [{ src: "/files/x.png", width: 0, height: 0 }] },
      maxOverflowPx: 0,
    });
    expect(r.failures.map((f) => f.code)).toContain("image_missing");
  });
});
