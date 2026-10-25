import { describe, expect, it } from "vitest";
import { compareToBaseline } from "./baseline";
import type { FailureCode } from "./taxonomy";

const run = (id: string, codes: FailureCode[]) => ({
  id,
  failures: codes.map((code) => ({ code, detail: "" })),
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
