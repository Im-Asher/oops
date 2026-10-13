import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { getTaskDashboardStats } from "./task.repo";

const NOW = Date.parse("2026-10-13T12:00:00Z");

describe("getTaskDashboardStats（M2 task 7.1）", () => {
  it("聚合口径：状态分布全量映射；失败率=failed/终态；均耗时=终态行均值", async () => {
    const mock = makeMockDb({
      selectQueue: [
        // 1) group by 全量分布
        [
          { status: "succeeded", count: 10 },
          { status: "failed", count: 3 },
          { status: "pending", count: 2 },
        ],
        // 2) 窗口内终态行（JS 口径输入）
        [
          { status: "succeeded", durationMs: 4_000 },
          { status: "succeeded", durationMs: 6_000 },
          { status: "failed", durationMs: 5_000 },
          { status: "canceled", durationMs: 5_000 },
        ],
        // 3) 最近失败
        [{ id: "t-fail-1", status: "failed" }],
      ],
    });
    const stats = await getTaskDashboardStats(mock.db, 24);
    expect(stats.statusCounts).toEqual({ pending: 2, running: 0, succeeded: 10, failed: 3, canceled: 0 });
    expect(stats.window.terminalCount).toBe(4);
    expect(stats.window.failedCount).toBe(1);
    expect(stats.window.failureRate).toBeCloseTo(0.25, 10);
    expect(stats.window.avgDurationMs).toBe(5_000);
    expect(stats.recentFailures).toHaveLength(1);
  });

  it("窗口无终态任务：失败率与均耗时为 null（非 0/0 歧义），分布与失败列表照常", async () => {
    const mock = makeMockDb({
      selectQueue: [
        [{ status: "pending", count: 5 }],
        [],
        [],
      ],
    });
    const stats = await getTaskDashboardStats(mock.db, 24);
    expect(stats.statusCounts.pending).toBe(5);
    expect(stats.window.terminalCount).toBe(0);
    expect(stats.window.failureRate).toBeNull();
    expect(stats.window.avgDurationMs).toBeNull();
    expect(stats.recentFailures).toEqual([]);
  });

  it("负时长夹具按 0 计入均值（时钟回拨容错），窗口起点按 windowHours 回推", async () => {
    const before = Date.now();
    const mock = makeMockDb({
      selectQueue: [
        [],
        [
          { status: "succeeded", durationMs: 3_000 },
          { status: "failed", durationMs: -1_000 },
        ],
        [],
      ],
    });
    const stats = await getTaskDashboardStats(mock.db, 6);
    expect(stats.window.avgDurationMs).toBe(1_500);
    const expectedStart = before - 6 * 3_600_000;
    expect(stats.window.startedAt.getTime()).toBeGreaterThanOrEqual(expectedStart);
    expect(stats.window.startedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
