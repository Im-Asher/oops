import { describe, expect, it } from "vitest";
import { judgeL4, parseScore } from "./l4";

describe("parseScore", () => {
  it("从未知格式里抠出 1-5 分", () => {
    expect(parseScore("总分：4/5\n理由：层级清晰")).toBe(4);
    expect(parseScore("3")).toBe(3);
  });

  it("无法解析返回 null", () => {
    expect(parseScore("看不出")).toBeNull();
  });
});

describe("judgeL4", () => {
  it("低于阈值记 judge_low，但不阻断", async () => {
    const r = await judgeL4({
      image: new Uint8Array([1]),
      mustContain: [],
      vlm: async () => "总分：2/5\n理由：层级混乱",
      threshold: 3,
    });
    expect(r.score).toBe(2);
    expect(r.failures.map((f) => f.code)).toContain("judge_low");
    expect(r.blocking).toBe(false);
  });

  it("达标时无失败项", async () => {
    const r = await judgeL4({
      image: new Uint8Array([1]),
      mustContain: ["恒温 12 小时"],
      vlm: async () => "总分：5/5",
      threshold: 3,
    });
    expect(r.failures).toEqual([]);
    expect(r.score).toBe(5);
  });

  it("解析不出分数时 score 为 null 且不产生失败项", async () => {
    const r = await judgeL4({
      image: new Uint8Array([1]),
      mustContain: [],
      vlm: async () => "我看不清",
      threshold: 3,
    });
    expect(r.score).toBeNull();
    expect(r.failures).toEqual([]);
  });
});
