import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalCase } from "./case";
import type { CaseResult } from "./report";

/**
 * 用可变实现替换 executeCase，而不是 vi.fn() spy：
 * vitest 5 会把 spy 返回的 rejected promise 额外记成用例失败（哪怕被测代码已经 catch），
 * 「每轮都抛错」这类用例就无法用 spy 写。
 */
let impl: (...args: unknown[]) => Promise<CaseResult> = () =>
  Promise.reject(new Error("测试未设置 impl"));
const calls: unknown[][] = [];
vi.mock("./execute", () => ({
  executeCase: (...args: unknown[]) => {
    calls.push(args);
    return impl(...args);
  },
}));

const { repeatCase } = await import("./repeat-run");
const { parseRepeat, mergeLabel, runLabel } = await import("./args");

const c = { id: "003-poster-tall", agent: "poster-designer" } as unknown as EvalCase;

function run(over: Partial<CaseResult> = {}): CaseResult {
  return {
    id: c.id,
    agent: c.agent,
    durationMs: 10,
    imageUrl: "/f/a.png",
    failures: [],
    l4: null,
    toolCalls: ["render_html"],
    rawText: "ok",
    ...over,
  };
}

const ctx = {} as never;

/** 一轮"抛错"：延迟到微任务里拒绝，贴近真实的异步失败。 */
function rejecting(message: string): () => Promise<CaseResult> {
  return () =>
    Promise.resolve().then((): CaseResult => {
      throw new Error(message);
    });
}

/** 按顺序吐出每一轮的实现；用完后一直重复最后一个。 */
function sequence(...steps: (CaseResult | (() => Promise<CaseResult>))[]): void {
  let i = 0;
  impl = () => {
    const step = steps[Math.min(i++, steps.length - 1)];
    return typeof step === "function" ? step() : Promise.resolve(step);
  };
}

describe("parseRepeat", () => {
  it("缺省为 1", () => {
    expect(parseRepeat([])).toBe(1);
    expect(parseRepeat(["--smoke", "--tag=smoke"])).toBe(1);
  });

  it("解析 --repeat=N", () => {
    expect(parseRepeat(["--repeat=3"])).toBe(3);
    expect(parseRepeat(["--repeat= 2 "])).toBe(2);
  });

  it("非法/≤0/非整数回落 1 而不抛错", () => {
    for (const arg of ["--repeat=", "--repeat=abc", "--repeat=0", "--repeat=-2", "--repeat=2.5"]) {
      expect(parseRepeat([arg])).toBe(1);
    }
  });
});

describe("runLabel / mergeLabel", () => {
  it("标签区分 PASS 与 FAIL", () => {
    expect(runLabel(run())).toBe("PASS");
    expect(runLabel(run({ failures: [{ code: "overflow", detail: "溢出 60px（2/3 次）" }] }))).toBe(
      "FAIL overflow",
    );
  });

  it("mergeLabel 带上次数", () => {
    expect(mergeLabel(run({ failures: [{ code: "overflow", detail: "溢出 60px（2/3 次）" }] }))).toBe(
      "FAIL overflow（2/3 次）",
    );
    expect(mergeLabel(run())).toBe("PASS");
  });
});

describe("repeatCase", () => {
  beforeEach(() => {
    calls.length = 0;
    impl = () => Promise.reject(new Error("测试未设置 impl"));
  });

  it("单跑一次，输出保持原格式且不加摘要行", async () => {
    impl = () => Promise.resolve(run());
    const out: string[] = [];
    const r = await repeatCase(c, ctx, { runDir: "/tmp/run", n: 1, write: (s) => out.push(s) });
    expect(calls).toHaveLength(1);
    expect(r.failures).toEqual([]);
    expect(out.join("")).toBe("▶ 003-poster-tall ... PASS\n");
  });

  it("每轮用独立产物目录并把轮次写进进度", async () => {
    impl = () => Promise.resolve(run());
    const out: string[] = [];
    await repeatCase(c, ctx, { runDir: "/tmp/run", n: 3, write: (s) => out.push(s) });
    const dirs = calls.map((args) => (args[1] as { artifactDir: string }).artifactDir);
    expect(dirs).toEqual([
      "/tmp/run/003-poster-tall-r1",
      "/tmp/run/003-poster-tall-r2",
      "/tmp/run/003-poster-tall-r3",
    ]);
    const text = out.join("");
    expect(text).toContain("▶ 003-poster-tall (1/3) ... ");
    expect(text).toContain("▶ 003-poster-tall (3/3) ... ");
    expect(text).toContain("  → 003-poster-tall: PASS\n");
  });

  it("3 次里 2 次溢出算失败并打印次数", async () => {
    sequence(
      run({ failures: [{ code: "overflow", detail: "溢出 60px" }] }),
      run(),
      run({ failures: [{ code: "overflow", detail: "溢出 135px" }] }),
    );
    const out: string[] = [];
    const r = await repeatCase(c, ctx, { runDir: "/tmp/run", n: 3, write: (s) => out.push(s) });
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].detail).toBe("溢出 60px（2/3 次）");
    expect(out.join("")).toContain("  → 003-poster-tall: FAIL overflow（2/3 次）\n");
  });

  it("单次抛错记成一条失败参与合并，不中断后续轮次", async () => {
    sequence(rejecting("网络断了"), run(), run());
    const out: string[] = [];
    const r = await repeatCase(c, ctx, { runDir: "/tmp/run", n: 3, write: (s) => out.push(s) });
    expect(calls).toHaveLength(3);
    // 3 次里只有 1 次 render_error，多数票不算失败
    expect(r.failures).toEqual([]);
    expect(out.join("")).toContain("ERROR 网络断了\n");
  });

  it("每次都抛错时仍然是失败", async () => {
    sequence(rejecting("挂了"));
    const r = await repeatCase(c, ctx, { runDir: "/tmp/run", n: 2, write: () => {} });
    expect(r.failures[0].code).toBe("render_error");
    expect(r.failures[0].detail).toBe("挂了（2/2 次）");
  });
});
