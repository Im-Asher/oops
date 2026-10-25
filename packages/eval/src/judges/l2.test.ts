import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const { failLaunch } = vi.hoisted(() => ({ failLaunch: { pending: false } }));

vi.mock("playwright", async (importOriginal) => {
  const actual = await importOriginal<typeof import("playwright")>();
  // 用开关模拟「这台机器上浏览器彻底起不来」（自带 chromium 缺失 + 系统 Chrome 也起不来），
  // 开关关闭时走真实 launch，不影响其它用例。
  const launch = (...args: Parameters<typeof actual.chromium.launch>) => {
    if (!failLaunch.pending) return actual.chromium.launch(...args);
    return Promise.reject(new Error("Executable doesn't exist 模拟启动失败"));
  };
  return { ...actual, chromium: { ...actual.chromium, launch } };
});

// vi.mock 是静态提升的，被测模块必须用动态 import 才能拿到 mock 版本
const { closeBrowser, getBrowser, judgeL2, measureHtml } = await import("./l2");

const PRODUCT_PNG = new Uint8Array(
  readFileSync(join(import.meta.dirname, "..", "..", "fixtures", "product.png")),
);

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

  // 回归：setContent 落在 about:blank 时浏览器不会为 /files/x.png 这类相对 URL 发请求，
  // page.route 匹配不到，naturalWidth 恒为 0 → 每个带商品图的海报都被假报 image_missing。
  it("相对 /files/ 图片能被回填并计入自然尺寸", async () => {
    const bytes = new Map([["/files/p.png", PRODUCT_PNG]]);
    const m = await measureHtml(
      `<html><body style="margin:0"><img src="/files/p.png"></body></html>`,
      [750, 200],
      { fileBytes: bytes },
    );
    expect(m.images).toHaveLength(1);
    expect(m.images[0]?.width).toBeGreaterThan(0);
    expect(m.images[0]?.height).toBeGreaterThan(0);
    // 关键回归点：回填成功后不应再有 image_missing
    expect(judgeL2({ metrics: m, maxOverflowPx: 0 }).failures.map((f) => f.code)).not.toContain(
      "image_missing",
    );
  }, 60_000);

  it("回填表里没有的 /files/ 图片仍如实记 image_missing", async () => {
    const m = await measureHtml(
      `<html><body style="margin:0"><img src="/files/nope.png"></body></html>`,
      [750, 200],
      { fileBytes: new Map() },
    );
    expect(m.images[0]?.width).toBe(0);
    expect(judgeL2({ metrics: m, maxOverflowPx: 0 }).failures.map((f) => f.code)).toContain(
      "image_missing",
    );
  }, 60_000);

  it("data: 内联图片注入 base 后仍能加载", async () => {
    // 1×1 透明 PNG
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const m = await measureHtml(
      `<html><body style="margin:0"><img src="${dataUrl}"></body></html>`,
      [750, 200],
    );
    expect(m.images[0]?.width).toBe(1);
  }, 60_000);
});

describe("浏览器生命周期", () => {
  it("启动失败不缓存 rejected promise：下一次调用会重试并成功", async () => {
    // 前面的用例已把浏览器缓存下来（会直接复用），这里模拟「实例已断开」，等价于冷启动
    await (await getBrowser()).close();
    failLaunch.pending = true;
    await expect(getBrowser()).rejects.toThrow();
    failLaunch.pending = false;
    // 若 rejected promise 被永久缓存，这里会立刻再抛；修复后应成功拿到浏览器
    const b = await getBrowser();
    expect(b.isConnected()).toBe(true);
    // 关闭失败也不能抛：CLI 的 catch 分支还会调用它，不能被覆盖退出码
    await expect(closeBrowser()).resolves.toBeUndefined();
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
