import { describe, expect, it, vi } from "vitest";
import type { TaskInput, TaskRepo } from "@oops/db/task.repo";
import type { CreditGate } from "../credits/service";
import {
  recoverInterruptedTasks,
  registerTaskHandler,
  submitAndWait,
  TaskError,
} from "./executor";

function makeRepo(): TaskRepo {
  const map = new Map<string, Record<string, unknown>>();
  let n = 0;
  return {
    async create(input: TaskInput) {
      n += 1;
      const id = `t${n}`;
      const row = {
        id,
        type: input.type ?? "generate_image",
        payload: input.payload ?? {},
        sessionId: input.sessionId,
        userId: input.userId,
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

/** 直通闸门：任务行经注入 repo 创建、不冻结——core 机制单测与积分语义解耦。 */
function makePassthroughGate(repo: TaskRepo): CreditGate {
  return {
    freezeForTask: async (input) => {
      const t = await repo.create({
        type: input.type as TaskInput["type"],
        payload: input.payload,
        sessionId: input.sessionId,
        userId: input.userId,
      });
      return { taskId: t.id };
    },
    settle: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  };
}

describe("task-executor", () => {
  it("运行处理器并返回结果，任务标记为 succeeded，结算钩子被调用", async () => {
    registerTaskHandler("test_echo", async (p) => ({ echoed: p }));
    const repo = makeRepo();
    const gate = makePassthroughGate(repo);
    const res = await submitAndWait("test_echo", { a: 1 }, { repo, userId: "u1", credits: gate });
    expect(res).toEqual({ echoed: { a: 1 } });
    expect((await repo.list())[0].status).toBe("succeeded");
    expect((await repo.list())[0].userId).toBe("u1");
    expect(gate.settle).toHaveBeenCalledWith("t1");
    expect(gate.release).not.toHaveBeenCalled();
  });

  it("handler ctx 透传 sessionId（资产回填会话，GC 依赖）", async () => {
    let seen: string | undefined;
    registerTaskHandler("test_ctx_session", async (_p, ctx) => {
      seen = ctx.sessionId;
      return { ok: true };
    });
    const repo = makeRepo();
    await submitAndWait("test_ctx_session", {}, {
      repo,
      sessionId: "s42",
      userId: "u1",
      credits: makePassthroughGate(repo),
    });
    expect(seen).toBe("s42");
  });

  it("处理器抛错时任务标记为 failed 并调用释放钩子", async () => {
    registerTaskHandler("test_fail", async () => {
      throw new Error("boom");
    });
    const repo = makeRepo();
    const gate = makePassthroughGate(repo);
    await expect(
      submitAndWait("test_fail", {}, { repo, userId: "u1", credits: gate }),
    ).rejects.toThrow("boom");
    expect((await repo.list())[0].status).toBe("failed");
    expect(gate.release).toHaveBeenCalledWith("t1");
  });

  it("闸门冻结失败（余额不足）直接抛 TaskError，无任务态更新", async () => {
    const repo = makeRepo();
    const gate: CreditGate = {
      freezeForTask: async () => {
        throw new TaskError("积分余额不足，无法发起该任务", "insufficient_credits");
      },
      settle: vi.fn(),
      release: vi.fn(),
    };
    await expect(
      submitAndWait("test_none", {}, { repo, userId: "u1", credits: gate }),
    ).rejects.toMatchObject({ kind: "insufficient_credits" });
    expect(gate.release).not.toHaveBeenCalled();
    expect(gate.settle).not.toHaveBeenCalled();
  });

  it("重启清理：running 与 pending 孤儿任务都被标记为 failed", async () => {
    const repo = makeRepo();
    const running = await repo.create({ type: "generate_image", userId: "u1" });
    const pending = await repo.create({ type: "generate_image", userId: "u1" });
    await repo.update(running.id, { status: "running" });
    const count = await recoverInterruptedTasks(repo);
    expect(count).toBe(2);
    expect((await repo.get(running.id))?.status).toBe("failed");
    expect((await repo.get(pending.id))?.status).toBe("failed");
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
    const gate = makePassthroughGate(repo);
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        submitAndWait("test_conc", { i }, { repo, userId: "u1", credits: gate }),
      ),
    );
    expect(max).toBeLessThanOrEqual(2);
  });
});
