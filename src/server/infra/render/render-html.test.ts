import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { RENDER_EXECUTABLE_PATH } from "@/lib/config";
import { assertNoScripts, RenderError, renderHtml } from "./render-html";

// Chromium 可执行文件缺失（playwright-core 不自带浏览器）时跳过渲染用例——
// 这些用例依赖真实浏览器，本地/冒烟环境先 `pnpm dlx playwright install chromium`。
const chromiumPath = RENDER_EXECUTABLE_PATH ?? chromium.executablePath();
const hasChromium = Boolean(chromiumPath) && existsSync(chromiumPath);

const FIXTURE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#f97316;display:flex;align-items:center;justify-content:center;height:1000px}
h1{color:#fff;font-size:64px;margin:0}</style></head>
<body><h1>双十一大促</h1></body></html>`;

describe("assertNoScripts（禁 JS 主闸门）", () => {
  it("拒绝 script 标签", () => {
    expect(() => assertNoScripts("<div><script>alert(1)</script></div>")).toThrowError(
      RenderError,
    );
  });

  it("拒绝内联事件属性", () => {
    expect(() => assertNoScripts('<img src="x.png" onerror="alert(1)">')).toThrowError(
      RenderError,
    );
  });

  it("拒绝 javascript: URL", () => {
    expect(() => assertNoScripts('<a href="javascript:alert(1)">x</a>')).toThrowError(
      RenderError,
    );
  });

  it("静态 HTML 通过", () => {
    expect(() => assertNoScripts(FIXTURE_HTML)).not.toThrow();
  });
});

describe("renderHtml（需 Chromium）", { skip: !hasChromium }, () => {
  afterEach(() => {
    // 实例复用：不主动销毁；进程退出即回收
  });

  it("自包含 HTML 渲染出正确尺寸的 PNG", async () => {
    const out = await renderHtml({ html: FIXTURE_HTML, width: 750, height: 1000 });
    expect(out.width).toBe(750);
    expect(out.height).toBe(1000);
    // PNG 魔数
    expect(Array.from(out.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
    expect(out.png.byteLength).toBeGreaterThan(1000);
  });

  it("白名单外资源缺失不致命：渲染继续并成功", async () => {
    const html = FIXTURE_HTML.replace(
      "</head>",
      '<img src="https://blocked.invalid/x.png"></head>',
    );
    const out = await renderHtml({ html, width: 750, height: 1000 });
    expect(Array.from(out.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });

  it("超时判定失败（RenderError timeout）", async () => {
    await expect(
      renderHtml({ html: FIXTURE_HTML, width: 750, height: 1000, timeoutMs: 5 }),
    ).rejects.toMatchObject({ kind: "timeout", name: "RenderError" });
  });

  it("浏览器实例复用：连续两次渲染均成功", async () => {
    const first = await renderHtml({ html: FIXTURE_HTML, width: 400, height: 300 });
    const second = await renderHtml({ html: FIXTURE_HTML, width: 400, height: 300 });
    expect(first.png.byteLength).toBeGreaterThan(0);
    expect(second.png.byteLength).toBeGreaterThan(0);
  });
});
