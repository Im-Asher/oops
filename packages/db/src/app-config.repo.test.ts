import { describe, expect, it } from "vitest";
import { makeMockDb } from "./mock-db";
import { assertConfigKeyValue, createAppConfigRepo } from "./app-config.repo";

describe("app-config repo（M2 task 6.1）", () => {
  it("get returns row value or null", async () => {
    const hit = makeMockDb({ selectQueue: [[{ value: false }]] });
    await expect(
      createAppConfigRepo(hit.db).get("agent.poster-designer.enabled"),
    ).resolves.toBe(false);
    expect(hit.state.calls[0]?.op).toBe("select.from.where");

    const miss = makeMockDb({ selectQueue: [[]] });
    await expect(
      createAppConfigRepo(miss.db).get("agent.poster-designer.enabled"),
    ).resolves.toBeNull();
  });

  it("getMany maps rows by key and skips empty input", async () => {
    const mock = makeMockDb({
      selectQueue: [
        [
          { key: "agent.poster-designer.enabled", value: true },
          {
            key: "model.roleDefaults.main",
            value: { providerId: "qwen-token-plan-cn", modelId: "qwen3.7-plus" },
          },
        ],
      ],
    });
    const map = await createAppConfigRepo(mock.db).getMany([
      "agent.poster-designer.enabled",
      "model.roleDefaults.main",
      "agent.missing.enabled",
    ]);
    expect(map.get("agent.poster-designer.enabled")).toBe(true);
    expect(map.get("model.roleDefaults.main")).toEqual({
      providerId: "qwen-token-plan-cn",
      modelId: "qwen3.7-plus",
    });
    expect(map.has("agent.missing.enabled")).toBe(false);

    const empty = makeMockDb();
    await expect(createAppConfigRepo(empty.db).getMany([])).resolves.toEqual(
      new Map(),
    );
    expect(empty.state.calls).toHaveLength(0);
  });

  it("set upserts with conflict update and passes valid pairs", async () => {
    const mock = makeMockDb({
      pendingValues: {
        key: "agent.poster-designer.enabled",
        value: false,
        updatedBy: "admin-1",
      },
    });
    await createAppConfigRepo(mock.db).set({
      key: "agent.poster-designer.enabled",
      value: false,
      updatedBy: "admin-1",
    });
    expect(mock.state.lastValues).toMatchObject({
      key: "agent.poster-designer.enabled",
      value: false,
      updatedBy: "admin-1",
    });
    expect(mock.state.calls.at(-1)?.op).toContain("onConflictDoUpdate");
  });

  it("set rejects malformed keys and mismatched value shapes", async () => {
    const repo = createAppConfigRepo(makeMockDb().db);
    // 非法键形状
    await expect(
      repo.set({ key: "agent..enabled", value: true, updatedBy: "a" }),
    ).rejects.toThrow(/非法键/);
    await expect(
      repo.set({ key: "agent.poster.enabled.extra", value: true, updatedBy: "a" }),
    ).rejects.toThrow(/非法键/);
    await expect(
      repo.set({ key: "secret.api_key", value: "x", updatedBy: "a" }),
    ).rejects.toThrow(/非法键/);
    // bool 命名空间配非 bool 值
    await expect(
      repo.set({
        key: "agent.poster-designer.enabled",
        value: "yes",
        updatedBy: "a",
      }),
    ).rejects.toThrow(/须为 boolean/);
    await expect(
      repo.set({
        key: "model.qwen-token-plan-cn.qwen3.8-max.enabled",
        value: 1,
        updatedBy: "a",
      }),
    ).rejects.toThrow(/须为 boolean/);
    // roleDefaults 配缺字段对象
    await expect(
      repo.set({
        key: "model.roleDefaults.main",
        value: { modelId: "x" },
        updatedBy: "a",
      }),
    ).rejects.toThrow(/providerId, modelId/);
    await expect(
      repo.set({ key: "model.roleDefaults.summary", value: {}, updatedBy: "a" }),
    ).rejects.toThrow(/非法键/);
    // roleDefaults 值校验直接暴露（route 层预检用）
    expect(() =>
      assertConfigKeyValue(
        "model.roleDefaults.summarizer",
        { providerId: "qwen-token-plan-cn", modelId: "qwen3.8-max" },
      ),
    ).not.toThrow();
  });

  it("remove issues a conditional delete", async () => {
    const mock = makeMockDb();
    await createAppConfigRepo(mock.db).remove("agent.poster-designer.enabled");
    expect(mock.state.calls[0]?.op).toBe("delete.where");
  });
});
