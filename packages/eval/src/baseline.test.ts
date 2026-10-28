import { describe, expect, it } from "vitest";
import { compareToBaseline, parseBaseline } from "./baseline";
import type { FailureCode } from "./taxonomy";

const run = (id: string, codes: FailureCode[]) => ({
  id,
  failures: codes.map((code) => ({ code, detail: "" })),
});

describe("parseBaseline", () => {
  it("解析合法基线", () => {
    const b = parseBaseline(JSON.stringify({ results: [run("a", ["overflow"])] }));
    expect(b.results).toHaveLength(1);
  });

  it("非法 JSON 抛错", () => {
    expect(() => parseBaseline("{oops")).toThrow(/不是合法 JSON/);
  });

  it("缺 results 数组抛错", () => {
    expect(() => parseBaseline(JSON.stringify({ runs: [] }))).toThrow(/结构不对/);
    expect(() => parseBaseline("null")).toThrow(/结构不对/);
  });

  it("results 每项结构不对抛错", () => {
    expect(() => parseBaseline(JSON.stringify({ results: [{ id: 1, failures: [] }] }))).toThrow(
      /结构不对/,
    );
    expect(() => parseBaseline(JSON.stringify({ results: [{ id: "a" }] }))).toThrow(/结构不对/);
  });
});

describe("compareToBaseline", () => {
  it("新增 L1-L3 失败 → 阻断", () => {
    const r = compareToBaseline({
      baseline: { results: [run("a", [])] },
      current: { results: [run("a", ["overflow"])] },
    });
    expect(r.blocking).toBe(true);
    expect(r.regressions).toHaveLength(1);
  });

  it("只有 judge_low 新增 → 不阻断", () => {
    const r = compareToBaseline({
      baseline: { results: [run("a", [])] },
      current: { results: [run("a", ["judge_low"])] },
    });
    expect(r.blocking).toBe(false);
  });

  it("修复了失败 → 不算回归", () => {
    const r = compareToBaseline({
      baseline: { results: [run("a", ["overflow"])] },
      current: { results: [run("a", [])] },
    });
    expect(r.blocking).toBe(false);
    expect(r.fixed).toHaveLength(1);
  });

  it("新增 case 无基线 → 记录但不阻断", () => {
    const r = compareToBaseline({
      baseline: { results: [] },
      current: { results: [run("new", ["overflow"])] },
    });
    expect(r.blocking).toBe(false);
  });
});
