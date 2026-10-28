import { describe, expect, it } from "vitest";
import { assertLayoutSupport, describeLayoutViolations } from "./assert-layout-support";

describe("assertLayoutSupport", () => {
  it("仅 flex 布局的 HTML 通过", () => {
    const html = `<style>
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px}
.h{font-size:80px;font-weight:700;line-height:1.2;letter-spacing:4px}
.b{position:absolute;top:0;left:0;border-radius:24px;background:linear-gradient(#f00,#00f);box-shadow:0 4px 12px rgba(0,0,0,.3);opacity:.9;transform:rotate(3deg)}
img{object-fit:cover;overflow:hidden;white-space:pre-wrap;text-overflow:ellipsis}
</style><div class="h">标题</div>`;
    expect(assertLayoutSupport(html).ok).toBe(true);
  });

  it("display:grid 被拒绝", () => {
    const html = '<style>.g{display:grid;grid-template-columns:1fr 1fr}</style>';
    const r = assertLayoutSupport(html);
    expect(r.ok).toBe(false);
    expect(r.violations[0]?.property).toContain("grid");
  });

  it("display:inline-grid 被拒绝", () => {
    const r = assertLayoutSupport('<style>.g{display:inline-grid}</style>');
    expect(r.ok).toBe(false);
  });

  it("float 被拒绝", () => {
    const r = assertLayoutSupport('<style>.f{float:left}</style>');
    expect(r.ok).toBe(false);
    expect(r.violations[0]?.property).toContain("float");
  });

  it("var() CSS 变量被拒绝", () => {
    const r = assertLayoutSupport('<style>.c{color:var(--brand)}</style>');
    expect(r.ok).toBe(false);
    expect(r.violations[0]?.property).toContain("var()");
  });

  it("position:sticky 被拒绝", () => {
    const r = assertLayoutSupport('<style>.s{position:sticky;top:0}</style>');
    expect(r.ok).toBe(false);
  });

  it("伪元素选择器被拒绝", () => {
    const r = assertLayoutSupport("<style>.a::before{content:'x'}</style>");
    expect(r.ok).toBe(false);
    expect(r.violations[0]?.property).toContain("伪元素");
  });

  it("position:relative / absolute 允许（渲染器支持）", () => {
    const r = assertLayoutSupport('<style>.a{position:relative;top:0}.b{position:absolute;z-index:5}</style>');
    expect(r.ok).toBe(true);
  });

  it("flex-* / gap / object-fit 允许", () => {
    const r = assertLayoutSupport('<style>.a{flex:1;flex-direction:row;gap:12px}img{object-fit:cover}</style>');
    expect(r.ok).toBe(true);
  });

  it("命中清单计数准确，且消息可回喂（不含 HTML 原文）", () => {
    const html = "<style>.a{display:grid}.b{display:grid}.c{float:left}</style>";
    const r = assertLayoutSupport(html);
    expect(r.ok).toBe(false);
    const grid = r.violations.find((v) => v.property.includes("grid"));
    expect(grid?.count).toBe(2);
    const msg = describeLayoutViolations(r);
    expect(msg).toContain("flex");
    expect(msg).toContain("grid");
    expect(msg).not.toContain("style");
  });

  it("通过时描述为空串", () => {
    expect(describeLayoutViolations({ ok: true, violations: [] })).toBe("");
  });
});
