import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countPassed, isBlocking, onlyNonBlocking, writeReport, type CaseResult, type Report } from "./report";
import type { Failure } from "./taxonomy";

function result(id: string, failures: Failure[]): CaseResult {
  return {
    id,
    agent: "poster-designer",
    durationMs: 1,
    imageUrl: null,
    failures,
    l4: null,
    toolCalls: [],
    rawText: "",
  };
}

describe("isBlocking / countPassed", () => {
  it("只有 judge_low 不算阻断", () => {
    const r = result("a", [{ code: "judge_low", detail: "3/5" }]);
    expect(isBlocking(r)).toBe(false);
    expect(onlyNonBlocking(r)).toBe(true);
  });

  it("judge_low 叠加阻断失败仍算失败", () => {
    const r = result("a", [
      { code: "judge_low", detail: "2/5" },
      { code: "overflow", detail: "100px" },
    ]);
    expect(isBlocking(r)).toBe(true);
    expect(onlyNonBlocking(r)).toBe(false);
  });

  it("零失败不算阻断且不算仅非阻断", () => {
    const r = result("a", []);
    expect(isBlocking(r)).toBe(false);
    expect(onlyNonBlocking(r)).toBe(false);
  });

  it("countPassed 忽略仅有 judge_low 的用例", () => {
    expect(
      countPassed([
        result("a", []),
        result("b", [{ code: "judge_low", detail: "" }]),
        result("c", [{ code: "size_mismatch", detail: "" }]),
      ]),
    ).toBe(2);
  });
});

describe("writeReport", () => {
  it("report.md 对仅有 judge_low 的用例显式标注非阻断", () => {
    const dir = mkdtempSync(join(tmpdir(), "report-"));
    const report: Report = {
      runAt: "2026-01-01T00:00:00.000Z",
      total: 2,
      passed: 2,
      results: [
        result("001-ok", []),
        result("002-low", [{ code: "judge_low", detail: "2/5" }]),
      ],
    };
    const md = writeReport(dir, report);
    const text = readFileSync(md, "utf8");
    expect(text).toContain("通过 2/2");
    expect(text).toMatch(/\| 002-low \| PASS（非阻断：judge_low） \|/);
    expect(text).toMatch(/\| 001-ok \| PASS \|/);
  });

  it("repeat>1 时报告头说明每例跑了几次", () => {
    const dir = mkdtempSync(join(tmpdir(), "report-"));
    const report: Report = {
      runAt: "2026-01-01T00:00:00.000Z",
      total: 1,
      passed: 1,
      results: [result("003", [])],
      repeat: 3,
    };
    const text = readFileSync(writeReport(dir, report), "utf8");
    expect(text).toContain("通过 1/1（每例跑 3 次，失败按多数判定；仅 judge_low 不算失败）");
  });

  it("单跑模式报告头保持原文案", () => {
    const dir = mkdtempSync(join(tmpdir(), "report-"));
    const report: Report = {
      runAt: "2026-01-01T00:00:00.000Z",
      total: 1,
      passed: 1,
      results: [result("003", [])],
    };
    const text = readFileSync(writeReport(dir, report), "utf8");
    expect(text).toContain("不算失败，明细中标注为非阻断");
    expect(text).not.toContain("每例跑");
  });
});
