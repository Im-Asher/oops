import { describe, expect, it } from "vitest";
import { extractFilePaths, toFailureCode } from "./execute";

describe("extractFilePaths", () => {
  it("抽出 /files/ 路径并去重", () => {
    const html = `<img src="/files/a.png"><div style="background:url(/files/b.webp)"></div><img src="/files/a.png">`;
    expect(extractFilePaths(html).sort()).toEqual(["/files/a.png", "/files/b.webp"]);
  });

  it("忽略外链", () => {
    expect(extractFilePaths(`<img src="https://cdn.x/a.png">`)).toEqual([]);
  });
});

describe("toFailureCode", () => {
  it("已知码透传，未知码收敛到 render_error", () => {
    expect(toFailureCode("invalid_reference")).toBe("render_error");
    expect(toFailureCode("render_failed")).toBe("render_error");
    expect(toFailureCode("timeout")).toBe("timeout");
  });
});
