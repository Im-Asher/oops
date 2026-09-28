import { describe, expect, it } from "vitest";
import type { TaskInput, TaskRepo } from "@/server/db/task.repo";
import {
  recoverInterruptedTasks,
  registerTaskHandler,
  submitAndWait,
} from "./task-executor";

function makeRepo(): TaskRepo {
  const map = new Map<string, Record<string, unknown>>();
  let n = 0;
  return {
    async create(input: TaskInput = {}) {
      n += 1;
      const id = `t${n}`;
      const row = {
        id,
        type: input.type ?? "generate_image",
        payload: input.payload ?? {},
        sessionId: input.sessionId,
        userId: input.userId ?? "owner",
        status: "pending",
        result: null,
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      map.set(id, row);
      return row as never;
    },
    async get(id) {
      return map.get(id) as never;
    },
    async update(id, patch) {
      const r = map.get(id);
      if (r) Object.assign(r, patch, { updatedAt: new Date() });
      return r as never;
    },
    async list() {
      return [...map.values()] as never;
    },
  };
}

describe("task-executor", () => {
  it("运行处理器并返回结果，任务标记为 succeeded", async () => {
    registerTaskHandler("test_echo", async (p) => ({ echoed: p }));
    const repo = makeRepo();
    const res = await submitAndWait("test_echo", { a: 1 }, { repo });
    expect(res).toEqual({ echoed: { a: 1 } });
    expect((await repo.list())[0].status).toBe("succeeded");
  });

  it("处理器抛错时任务标记为 failed 并保留错误信息", async () => {
    registerTaskHandler("test_fail", async () => {
      throw new Error("boom");
    });
    const repo = makeRepo();
    await expect(submitAndWait("test_fail", {}, { repo })).rejects.toThrow("boom");
    expect((await repo.list())[0].status).toBe("failed");
  });

  it("重启清理：running 任务被标记为 failed", async () => {
    const repo = makeRepo();
    const created = await repo.create({ type: "generate_image" });
    await repo.update(created.id, { status: "running" });
    const count = await recoverInterruptedTasks(repo);
    expect(count).toBe(1);
    expect((await repo.get(created.id))?.status).toBe("failed");
  });

  it("并发上限为 2", async () => {
    let active = 0;
    let max = 0;
    registerTaskHandler("test_conc", async () => {
      active += 1;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 30));
      active -= 1;
      return "ok";
    });
    const repo = makeRepo();
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => submitAndWait("test_conc", { i }, { repo })),
    );
    expect(max).toBeLessThanOrEqual(2);
  });
});
