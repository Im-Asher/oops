import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { createTaskRepo } from "./task.repo";

describe("task repo", () => {
  it("create defaults type=generate_image and stores payload", async () => {
    const mock = makeMockDb();
    const repo = createTaskRepo(mock.db);
    const row = await repo.create({ payload: { prompt: "苹果" } });
    expect(row).toMatchObject({
      type: "generate_image",
      payload: { prompt: "苹果" },
      userId: "owner",
    });
    expect(mock.state.calls.at(-1)?.op).toBe("insert.values.returning");
  });

  it("update returns new status/result", async () => {
    const mock = makeMockDb();
    const repo = createTaskRepo(mock.db);
    const row = await repo.update("t1", {
      status: "succeeded",
      result: { url: "x" },
    });
    expect(row).toMatchObject({ status: "succeeded" });
    expect(mock.state.calls.at(-1)?.op).toBe("update.set.where.returning");
  });

  it("get returns first matching row", async () => {
    const mock = makeMockDb({ selectResult: [{ id: "t1" }] });
    const repo = createTaskRepo(mock.db);
    const row = await repo.get("t1");
    expect(row?.id).toBe("t1");
  });
});
