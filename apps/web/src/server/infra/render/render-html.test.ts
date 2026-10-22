import { describe, expect, it } from "vitest";
import { RenderError, renderHtml } from "./render-html";

/**
 * 无浏览器渲染测试：全部确定性断言，不依赖任何浏览器二进制。
 * 字体来自 assets/fonts/（子集产物），若缺失会在字体加载处明确抛错而非静默降级。
 */

/** 合规海报 HTML：仅 flex 布局 + 受支持属性 + 内联 data URI 图片。 */
function posterHtml(height: number): string {
  return `<!doctype html><html><head><style>
body{margin:0;width:750px;height:${height}px;overflow:hidden;background:linear-gradient(160deg,#FFF7ED,#FED7AA);display:flex;flex-direction:column;padding:60px;box-sizing:border-box}
.t{font-size:80px;font-weight:700;color:#1F2937;letter-spacing:4px}
.s{font-size:32px;color:#4B5563;margin-top:16px}
.p{font-size:96px;color:#DC2626;margin-top:auto}
img{width:200px;height:200px;object-fit:cover;border-radius:24px}
</style></head><body>
<div class="t">双十一大促</div>
<div class="s">全场五折起</div>
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="/>
<div class="p">¥299</div>
</body></html>`;
}

describe("renderHtml（无浏览器确定性）", () => {
  it("合规 HTML 渲染出定宽定高的 PNG", async () => {
    const out = await renderHtml({ html: posterHtml(1334), width: 750, height: 1334 });
    expect(out.width).toBe(750);
    expect(out.height).toBe(1334);
    // PNG 魔数
    expect(Array.from(out.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
    expect(out.png.byteLength).toBeGreaterThan(1000);
  });

  it("三个高度档位均可渲染", async () => {
    for (const height of [1000, 1334, 1654]) {
      const out = await renderHtml({ html: posterHtml(height), width: 750, height });
      expect(out.height).toBe(height);
      expect(Array.from(out.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
    }
  });

  it("grid 布局被拒绝并归入 invalid_html（不回退到静默降级）", async () => {
    const html = posterHtml(1000).replace("display:flex;flex-direction:column", "display:grid");
    await expect(
      renderHtml({ html, width: 750, height: 1000 }),
    ).rejects.toMatchObject({ kind: "invalid_html", name: "RenderError" });
  });

  it("float 布局被拒绝并归入 invalid_html", async () => {
    const html = posterHtml(1000).replace(".t{", ".t{float:left;");
    await expect(
      renderHtml({ html, width: 750, height: 1000 }),
    ).rejects.toMatchObject({ kind: "invalid_html", name: "RenderError" });
  });

  it("伪元素选择器被拒绝并归入 invalid_html", async () => {
    const html = posterHtml(1000).replace(".t{", ".t::before{content:'x'}.t{");
    await expect(
      renderHtml({ html, width: 750, height: 1000 }),
    ).rejects.toMatchObject({ kind: "invalid_html", name: "RenderError" });
  });

  it("白名单外图片被剥离且渲染继续（不致命）", async () => {
    const html = posterHtml(1000).replace(
      "</head>",
      '<img src="https://blocked.invalid/x.png"></head>',
    );
    const out = await renderHtml({ html, width: 750, height: 1000 });
    expect(Array.from(out.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });

  it("回归：无 src 的 img 不得让整次渲染失败（旧浏览器方案下图裂仍出图）", async () => {
    // 无浏览器迁移的回退：satori 遇到无 src 的 img 会抛
    // "Image source is not provided" 让整次渲染失败，且被误报成「版式非法」。
    // 必须降级为「该图缺席」，其余版式照常出图。
    const cases = [
      '<img style="width:200px;height:200px">', // Agent 写的占位符，无 src 属性
      '<img src="">',                            // 内联读取失败后残留的空 src
      '<img src="   ">',                         // 全空白 src
    ];
    for (const badImg of cases) {
      const html = posterHtml(1000).replace("</head>", `${badImg}</head>`);
      const out = await renderHtml({ html, width: 750, height: 1000 });
      expect(Array.from(out.png.slice(0, 4)), badImg).toEqual([137, 80, 78, 71]);
      // 剥离计数应反映「有图没进去」，供上层告知 Agent
      expect(out.droppedImages, badImg).toBeGreaterThan(0);
    }
  });

  it("坏图引用不影响同一次渲染里的合法图片", async () => {
    const html = posterHtml(1000).replace(
      "</head>",
      '<img src=""><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="></head>',
    );
    const out = await renderHtml({ html, width: 750, height: 1000 });
    expect(Array.from(out.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
    expect(out.droppedImages).toBe(1);
  });

  it("白名单内图片引用被保留", async () => {
    const html = posterHtml(1000).replace(
      "</head>",
      '<img src="https://cdn.example.com/x.png"></head>',
    );
    // 走 allowedHosts 注入路径，验证闸门放行（图片本身加载失败不致命）
    const out = await renderHtml({
      html,
      width: 750,
      height: 1000,
      allowedHosts: ["example.com"],
    });
    expect(Array.from(out.png.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });

  it("超时判定失败（RenderError timeout）", async () => {
    // 已 settle 的 promise 在 race 中总是赢过 setTimeout，故不能靠 timeoutMs=1
    // 与 20ms 的真实渲染竞速（那样由调度顺序决定，不确定）。注入慢渲染替身，
    // 让渲染真的慢于超时上限，从而确定性地走超时分支。
    await expect(
      renderHtml({
        html: posterHtml(1000),
        width: 750,
        height: 1000,
        timeoutMs: 20,
        renderer: () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ png: new Uint8Array([137, 80, 78, 71]), width: 750, height: 1000 }),
              500,
            ),
          ),
      }),
    ).rejects.toMatchObject({ kind: "timeout", name: "RenderError" });
  });

  it("外部 signal abort 时归类 timeout", async () => {
    const ac = new AbortController();
    const p = renderHtml({
      html: posterHtml(1000),
      width: 750,
      height: 1000,
      signal: ac.signal,
      // 渲染慢于 abort 到达的时刻，使外部信号成为 race 的胜者
      renderer: () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ png: new Uint8Array([137, 80, 78, 71]), width: 750, height: 1000 }),
            500,
          ),
        ),
    });
    ac.abort();
    await expect(p).rejects.toMatchObject({ kind: "timeout", name: "RenderError" });
  });

  it("非法 HTML 结构要么渲染出图要么归入 invalid_html（不得归 unknown）", async () => {
    let outcome: "resolved" | RenderError;
    try {
      await renderHtml({ html: "<div>未闭合", width: 750, height: 1000 });
      outcome = "resolved";
    } catch (e) {
      expect(e).toBeInstanceOf(RenderError);
      expect((e as RenderError).kind).toBe("invalid_html");
      outcome = e as RenderError;
    }
    expect(["resolved"]).toContain(typeof outcome === "string" ? "resolved" : "");
    if (outcome !== "resolved") expect(outcome.kind).toBe("invalid_html");
  });
});
