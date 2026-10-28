import { describe, expect, it } from "vitest";
import { mergeRuns } from "./repeat";
import type { CaseResult } from "./report";
import type { Failure } from "./taxonomy";

function run(over: Partial<CaseResult> = {}): CaseResult {
  return {
    id: "004",
    agent: "poster-designer",
    durationMs: 1000,
    imageUrl: null,
    failures: [],
    l4: null,
    toolCalls: [],
    rawText: "",
    ...over,
  };
}

const overflow = (detail = "溢出 60px"): Failure => ({ code: "overflow", detail });

describe("mergeRuns", () => {
  it("只有 1 次时原样返回，不改 detail", () => {
    const only = run({ failures: [overflow()], l4: { score: 4, reason: "还行" }, imageUrl: "/f/a.png" });
    const merged = mergeRuns([only]);
    expect(merged).toEqual(only);
  });

  it("空数组抛错", () => {
    expect(() => mergeRuns([])).toThrow();
  });

  it("3 次里 1 次失败：多数票不算失败", () => {
    const merged = mergeRuns([run(), run({ failures: [overflow()] }), run()]);
    expect(merged.failures).toEqual([]);
  });

  it("3 次里 2 次失败：算失败，detail 带次数", () => {
    const merged = mergeRuns([run({ failures: [overflow()] }), run(), run({ failures: [overflow()] })]);
    expect(merged.failures).toHaveLength(1);
    expect(merged.failures[0].code).toBe("overflow");
    expect(merged.failures[0].detail).toContain("60px");
    expect(merged.failures[0].detail).toContain("2/3");
  });

  it("2 次里 1 次失败：>N/2 不成立，不算失败", () => {
    const merged = mergeRuns([run({ failures: [overflow()] }), run()]);
    expect(merged.failures).toEqual([]);
  });

  it("2 次都失败才算失败", () => {
    const merged = mergeRuns([
      run({ failures: [overflow("溢出 10px")] }),
      run({ failures: [overflow("溢出 20px")] }),
    ]);
    expect(merged.failures).toHaveLength(1);
    expect(merged.failures[0].detail).toContain("2/2");
  });

  it("同一次里同码多条 detail 算一次命中", () => {
    const merged = mergeRuns([
      run({ failures: [overflow("a"), overflow("b")] }),
      run(),
      run(),
    ]);
    expect(merged.failures).toEqual([]);
  });

  it("失败顺序按首次出现顺序", () => {
    const merged = mergeRuns([
      run({ failures: [{ code: "overflow", detail: "x" }, { code: "size_mismatch", detail: "y" }] }),
      run({ failures: [{ code: "overflow", detail: "x" }, { code: "size_mismatch", detail: "y" }] }),
      run(),
    ]);
    expect(merged.failures.map((f) => f.code)).toEqual(["overflow", "size_mismatch"]);
  });

  it("durationMs 取总和", () => {
    expect(mergeRuns([run({ durationMs: 100 }), run({ durationMs: 200 })]).durationMs).toBe(300);
  });

  it("L4 取中位数（奇数）", () => {
    const merged = mergeRuns([
      run({ l4: { score: 2, reason: "低" } }),
      run({ l4: { score: 4, reason: "中" } }),
      run({ l4: { score: 5, reason: "高" } }),
    ]);
    expect(merged.l4).toEqual({ score: 4, reason: "中" });
  });

  it("L4 偶数次取中间两个的较小者（偏保守）", () => {
    const merged = mergeRuns([
      run({ l4: { score: 5, reason: "高" } }),
      run({ l4: { score: 3, reason: "偏低" } }),
    ]);
    expect(merged.l4).toEqual({ score: 3, reason: "偏低" });
  });

  it("L4 只统计有分数的几次", () => {
    const merged = mergeRuns([
      run({ l4: null }),
      run({ l4: { score: 3, reason: "a" } }),
      run({ l4: { score: 5, reason: "b" } }),
      run({ l4: { score: 4, reason: "c" } }),
    ]);
    expect(merged.l4?.score).toBe(4);
    expect(merged.l4?.reason).toBe("c");
  });

  it("L4 全为 null 时返回 null", () => {
    expect(mergeRuns([run(), run()]).l4).toBeNull();
  });

  it("L4 有 score: null 的项不影响中位数", () => {
    const merged = mergeRuns([
      run({ l4: { score: null, reason: "解析失败" } }),
      run({ l4: { score: 4, reason: "ok" } }),
    ]);
    expect(merged.l4).toEqual({ score: 4, reason: "ok" });
  });

  it("imageUrl / rawText 取第一次成功的", () => {
    const merged = mergeRuns([
      run({ imageUrl: null, rawText: "" }),
      run({ imageUrl: "/f/2.png", rawText: "第二轮" }),
      run({ imageUrl: "/f/3.png", rawText: "第三轮" }),
    ]);
    expect(merged.imageUrl).toBe("/f/2.png");
    expect(merged.rawText).toBe("第二轮");
  });

  it("没有任何一次成功产出图片时 imageUrl 为 null", () => {
    expect(mergeRuns([run(), run()]).imageUrl).toBeNull();
  });

  it("rawText 优先取没有失败的那一轮，避免采信报错轮的文字", () => {
    const merged = mergeRuns([
      run({ failures: [overflow()], rawText: "报错轮" }),
      run({ rawText: "干净轮" }),
    ]);
    expect(merged.rawText).toBe("干净轮");
  });

  it("toolCalls 取并集去重，保持首次出现顺序", () => {
    const merged = mergeRuns([
      run({ toolCalls: ["render_html", "render_image"] }),
      run({ toolCalls: ["render_html", "read_file"] }),
    ]);
    expect(merged.toolCalls).toEqual(["render_html", "render_image", "read_file"]);
  });

  it("备注只在对应失败仍是多数结论时保留（避免 PASS 却写着跳过了 L3）", () => {
    const merged = mergeRuns([
      run({ failures: [overflow()], notes: ["版式溢出会裁掉文字，跳过 L3"] }),
      run({ notes: ["版式溢出会裁掉文字，跳过 L3"] }),
      run({}),
    ]);
    expect(merged.failures).toEqual([]);
    expect(merged.notes).toBeUndefined();
  });

  it("备注与多数失败同轮时保留并去重", () => {
    const merged = mergeRuns([
      run({ failures: [overflow()], notes: ["跳过 L3"] }),
      run({ failures: [overflow()], notes: ["跳过 L3", "超时重试"] }),
      run({}),
    ]);
    expect(merged.failures.map((f) => f.code)).toEqual(["overflow"]);
    expect(merged.notes).toEqual(["跳过 L3", "超时重试"]);
  });

  it("id / agent 保持不变", () => {
    const merged = mergeRuns([run(), run({ id: "004", agent: "poster-designer" })]);
    expect(merged.id).toBe("004");
    expect(merged.agent).toBe("poster-designer");
  });
});
