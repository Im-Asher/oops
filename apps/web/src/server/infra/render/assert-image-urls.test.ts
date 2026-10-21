import { describe, expect, it } from "vitest";
import { assertImageUrls } from "./assert-image-urls";

/**
 * 出网闸门单测：重点是**剥离计数**（不含 URL 原文），以及
 * 各绕过写法（大小写、协议相对、编码、无引号、CSS url()）是否被覆盖。
 */

describe("assertImageUrls", () => {
  it("内联 data URI 全部放行", () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo="><div>x</div>';
    const r = assertImageUrls(html, []);
    expect(r.strippedCount).toBe(0);
    expect(r.html).toBe(html);
  });

  it("白名单 host 放行（精确匹配与子域名）", () => {
    const html = '<img src="https://cdn.example.com/a.png"><img src="https://img.example.com/b.png">';
    const r = assertImageUrls(html, ["example.com"]);
    expect(r.strippedCount).toBe(0);
    expect(r.html).toBe(html);
  });

  it("白名单外公网地址被剥离", () => {
    const html = '<div><img src="https://evil.invalid/x.png">尾</div>';
    const r = assertImageUrls(html, ["example.com"]);
    expect(r.strippedCount).toBe(1);
    expect(r.html).not.toContain("evil.invalid");
    // 整标签移除（含尾随的 >），其余 HTML 结构保持原样
    expect(r.html).toBe("<div>尾</div>");
  });

  it("云元数据地址被剥离（SSRF 经典目标）", () => {
    const html = '<img src="http://169.254.169.254/latest/meta-data/">';
    const r = assertImageUrls(html, []);
    expect(r.strippedCount).toBe(1);
    expect(r.html).not.toContain("169.254");
  });

  it("内网地址被剥离", () => {
    const html = '<img src="http://127.0.0.1:6379/"><img src="http://localhost:8080/">';
    const r = assertImageUrls(html, []);
    expect(r.strippedCount).toBe(2);
    expect(r.html).not.toContain("127.0.0.1");
    expect(r.html).not.toContain("localhost");
  });

  it("协议相对 URL //host/x 被剥离（无 scheme 也会出网）", () => {
    const html = '<img src="//evil.invalid/x.png">';
    const r = assertImageUrls(html, []);
    expect(r.strippedCount).toBe(1);
    expect(r.html).not.toContain("evil.invalid");
  });

  it("协议相对 URL 不受白名单豁免", () => {
    const html = '<img src="//evil.invalid/x.png">';
    const r = assertImageUrls(html, ["evil.invalid"]);
    // 即便 host 在白名单里，// 开头的引用也无从确定 scheme，一律剥离
    expect(r.strippedCount).toBe(1);
  });

  it("大写协议与混合大小写 host 均被识别并剥离", () => {
    const html = '<img src="HTTPS://EVIL.INVALID/x.png">';
    const r = assertImageUrls(html, []);
    expect(r.strippedCount).toBe(1);
    expect(r.html).not.toContain("EVIL.INVALID");
  });

  it("file: 与其它危险协议被剥离", () => {
    const html = '<img src="file:///etc/passwd"><img src="ftp://x.invalid/a">';
    const r = assertImageUrls(html, []);
    expect(r.strippedCount).toBe(2);
  });

  it("CSS background url() 外链被剥离为 none", () => {
    const html = '<div style="background-image:url(https://evil.invalid/a.png)">x</div>';
    const r = assertImageUrls(html, []);
    expect(r.strippedCount).toBe(1);
    expect(r.html).toContain("none");
    expect(r.html).not.toContain("evil.invalid");
  });

  it("CSS url() 白名单内放行", () => {
    const html = '<div style="background-image:url(https://cdn.example.com/a.png)">x</div>';
    const r = assertImageUrls(html, ["example.com"]);
    expect(r.strippedCount).toBe(0);
    expect(r.html).toBe(html);
  });

  it("相对路径放行（由 inlineFileRefs 负责后续处理，不会出网）", () => {
    const html = '<img src="/files/abc.png"><img src="./x.png"><img src="y.png">';
    const r = assertImageUrls(html, []);
    expect(r.strippedCount).toBe(0);
  });

  it("空 src 的 img 不会出网（正则要求非空属性体）", () => {
    const html = '<img src="">';
    const r = assertImageUrls(html, []);
    // 空 src 无 URL 可请求，不出网也不计数；这里锁定「不误报」而非「计数」
    expect(r.strippedCount).toBe(0);
  });

  it("无 src 属性的 img 不被计数（不是外链）", () => {
    const html = '<img alt="商品图">';
    const r = assertImageUrls(html, []);
    expect(r.strippedCount).toBe(0);
  });

  it("无图片引用的 HTML 原样返回", () => {
    const html = "<div>纯文字海报</div>";
    const r = assertImageUrls(html, ["example.com"]);
    expect(r.strippedCount).toBe(0);
    expect(r.html).toBe(html);
  });

  it("多个引用混合：仅统计被剥离的数量", () => {
    const html =
      '<img src="data:image/png;base64,AA=">' +
      '<img src="https://cdn.example.com/a.png">' +
      '<img src="https://evil.invalid/b.png">' +
      '<img src="/files/c.png">';
    const r = assertImageUrls(html, ["example.com"]);
    expect(r.strippedCount).toBe(1);
    expect(r.html).toContain("cdn.example.com");
    expect(r.html).toContain("data:image/png");
    expect(r.html).toContain("/files/c.png");
  });

  it("扫描结果不含被剥离的 URL 原文（日志安全）", () => {
    const html = '<img src="https://secret-token.evil.invalid/leak">';
    const r = assertImageUrls(html, []);
    expect(r.html).not.toContain("secret-token");
    expect(JSON.stringify(r)).not.toContain("secret-token");
  });
});
