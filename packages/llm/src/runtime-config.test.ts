import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayReader } from "./runtime-config";
import {
  bumpRuntimeConfigGeneration,
  resolveAgentEnabled,
  resolveModelEnabled,
  resolveRoleDefault,
} from "./runtime-config";

function makeReader(overrides: Record<string, unknown> = {}): OverlayReader & { calls: number } {
  return {
    calls: 0,
    async readOverlay(keys: readonly string[]) {
      this.calls += 1;
      const map = new Map<string, unknown>();
      for (const key of keys) {
        if (key in overrides) map.set(key, overrides[key]);
      }
      return map;
    },
  };
}

beforeEach(() => {
  bumpRuntimeConfigGeneration();
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("runtime-config resolver（M2 task 6.1）", () => {
  it("overlay 命中即赢：enabled bool 与 roleDefaults 对象直接生效且标注 overlay", async () => {
    const reader = makeReader({
      "agent.poster-designer.enabled": false,
      "model.qwen-token-plan-cn.qwen3.8-max.enabled": false,
      "model.roleDefaults.main": {
        providerId: "qwen-token-plan-cn",
        modelId: "qwen3.7-plus",
      },
    });
    await expect(
      resolveAgentEnabled("poster-designer", reader),
    ).resolves.toEqual({ enabled: false, source: "overlay" });
    await expect(
      resolveModelEnabled("qwen-token-plan-cn", "qwen3.8-max", reader),
    ).resolves.toEqual({ enabled: false, source: "overlay" });
    await expect(resolveRoleDefault("main", reader)).resolves.toEqual({
      providerId: "qwen-token-plan-cn",
      modelId: "qwen3.7-plus",
      source: "overlay",
    });
  });

  it("缺省下落：overlay 无值时 agent/model 回落 catalog 默认放行，roleDefault 回落目录 roleDefaults", async () => {
    const reader = makeReader();
    await expect(resolveAgentEnabled("poster-designer", reader)).resolves.toEqual({
      enabled: true,
      source: "catalog",
    });
    await expect(
      resolveModelEnabled("qwen-token-plan-cn", "qwen3.8-max", reader),
    ).resolves.toEqual({ enabled: true, source: "catalog" });
    await expect(resolveRoleDefault("main", reader)).resolves.toEqual({
      providerId: "qwen-token-plan-cn",
      modelId: "qwen3.8-max",
      source: "catalog",
    });
  });

  it("env 层：LLM_<ROLE>_MODEL 登记模型来源 env；未登记模型回落 catalog", async () => {
    vi.stubEnv("LLM_PROVIDER", "qwen-token-plan-cn");
    vi.stubEnv("LLM_MAIN_MODEL", "qwen3.7-plus");
    const reader = makeReader();
    await expect(resolveRoleDefault("main", reader)).resolves.toEqual({
      providerId: "qwen-token-plan-cn",
      modelId: "qwen3.7-plus",
      source: "env",
    });

    vi.stubEnv("LLM_MAIN_MODEL", "ghost-model");
    await expect(resolveRoleDefault("main", reader)).resolves.toEqual({
      providerId: "qwen-token-plan-cn",
      modelId: "qwen3.8-max",
      source: "catalog",
    });
  });

  it("overlay 脏值（未登记模型 / 非布爔回落）不阻塞下层解析", async () => {
    const reader = makeReader({
      "model.roleDefaults.main": {
        providerId: "qwen-token-plan-cn",
        modelId: "ghost",
      },
      "agent.x.enabled": "yes",
    });
    await expect(resolveRoleDefault("main", reader)).resolves.toMatchObject({
      source: "catalog",
    });
    await expect(resolveAgentEnabled("x", reader)).resolves.toEqual({
      enabled: true,
      source: "catalog",
    });
  });

  it("清除回落：bump 代数后缓存失效，overlay 删除的键立即回落下层", async () => {
    const key = "agent.poster-designer.enabled";
    const reader = makeReader({ [key]: false });
    await expect(resolveAgentEnabled("poster-designer", reader)).resolves.toEqual({
      enabled: false,
      source: "overlay",
    });
    // TTL 内重读走缓存（reader 不再被调用）
    await expect(resolveAgentEnabled("poster-designer", reader)).resolves.toEqual({
      enabled: false,
      source: "overlay",
    });
    expect(reader.calls).toBe(1);

    // 模拟 DB 删除后 admin 写路径 bump：立即读到「无 overlay」
    bumpRuntimeConfigGeneration();
    const after = makeReader();
    await expect(resolveAgentEnabled("poster-designer", after)).resolves.toEqual({
      enabled: true,
      source: "catalog",
    });
  });

  it("缓存窗口：TTL 内 reader 只调一次，过期后重拉（fake timers）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T00:00:00Z"));
    const key = "agent.poster-designer.enabled";
    const reader = makeReader({ [key]: false });
    await resolveAgentEnabled("poster-designer", reader);
    vi.advanceTimersByTime(10_000);
    await resolveAgentEnabled("poster-designer", reader);
    expect(reader.calls).toBe(1); // 窗口内命中缓存
    vi.advanceTimersByTime(20_100); // 越过 30s TTL
    await resolveAgentEnabled("poster-designer", reader);
    expect(reader.calls).toBe(2);
  });

  it("fail-open：overlay 读失败回落 env/catalog，失败不缓存（恢复后立即生效）", async () => {
    vi.stubEnv("LLM_PROVIDER", "qwen-token-plan-cn");
    vi.stubEnv("LLM_MAIN_MODEL", "qwen3.7-plus");
    let shouldFail = true;
    const flaky: OverlayReader = {
      async readOverlay(keys) {
        if (shouldFail) throw new Error("db down");
        const map = new Map<string, unknown>();
        for (const key of keys) {
          if (key === "agent.poster-designer.enabled") map.set(key, false);
          if (key === "model.roleDefaults.main") {
            map.set(key, { providerId: "qwen-token-plan-cn", modelId: "qwen3.8-max" });
          }
        }
        return map;
      },
    };
    // 抖动窗口：enabled 回落 catalog，roleDefault 回落 env（overlay 值被挡住）
    await expect(resolveAgentEnabled("poster-designer", flaky)).resolves.toEqual({
      enabled: true,
      source: "catalog",
    });
    await expect(resolveRoleDefault("main", flaky)).resolves.toEqual({
      providerId: "qwen-token-plan-cn",
      modelId: "qwen3.7-plus",
      source: "env",
    });
    // 恢复：未被失败结果污染，立即读到 overlay
    shouldFail = false;
    await expect(resolveAgentEnabled("poster-designer", flaky)).resolves.toEqual({
      enabled: false,
      source: "overlay",
    });
    await expect(resolveRoleDefault("main", flaky)).resolves.toEqual({
      providerId: "qwen-token-plan-cn",
      modelId: "qwen3.8-max",
      source: "overlay",
    });
  });
});
