import { describe, expect, it } from "vitest";
import { collectFailures, extractFilePaths, toFailureCode } from "./execute";
import { parseCase } from "./case";
import type { RunArtifacts } from "./run";

const CASE = parseCase(`
id: t
message: hi
assert:
  size: [750, 1334]
`);

function artifacts(over: Partial<RunArtifacts>): RunArtifacts {
  return {
    html: null,
    assetUrl: null,
    size: null,
    toolErrors: [],
    toolCalls: [],
    stopReason: null,
    fatal: null,
    text: "",
    ...over,
  };
}

describe("extractFilePaths", () => {
  it("抽出 /files/ 路径并去重", () => {
    const html = `<img src="/files/a.png"><div style="background:url(/files/b.webp)"></div><img src="/files/a.png">`;
    expect(extractFilePaths(html).sort()).toEqual(["/files/a.png", "/files/b.webp"]);
  });

  it("忽略外链", () => {
    expect(extractFilePaths(`<img src="https://cdn.x/a.png">`)).toEqual([]);
  });
});

describe("collectFailures", () => {
  const retriedThenOk = [
    { code: "render_failed", message: "第一次渲染失败" },
    { code: "timeout", message: "重试前的一次超时" },
  ];

  it("有产物 + 有 toolErrors → 不产生工具失败（重试成功不算失败）", () => {
    const out = collectFailures(
      artifacts({ assetUrl: "/files/p.png", toolErrors: retriedThenOk }),
      CASE,
    );
    expect(out).toEqual([]);
  });

  it("只有 html 也算有产物", () => {
    const out = collectFailures(artifacts({ html: "<html></html>", toolErrors: retriedThenOk }), CASE);
    expect(out).toEqual([]);
  });

  it("无产物 + 有 toolErrors → 产生工具失败并收敛错误码", () => {
    const out = collectFailures(
      artifacts({ toolErrors: [{ code: "render_failed", message: "boom" }, { code: "timeout", message: "慢" }] }),
      CASE,
    );
    expect(out).toEqual([
      { code: "render_error", detail: "boom" },
      { code: "timeout", detail: "慢" },
    ]);
  });

  it("无产物也无 toolErrors → 空", () => {
    expect(collectFailures(artifacts({}), CASE)).toEqual([]);
  });
});

describe("toFailureCode", () => {
  it("已知码透传，未知码收敛到 render_error", () => {
    expect(toFailureCode("invalid_reference")).toBe("render_error");
    expect(toFailureCode("render_failed")).toBe("render_error");
    expect(toFailureCode("timeout")).toBe("timeout");
  });
});
