// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  recoverMock: vi.fn(),
  reconcileMock: vi.fn(),
  cleanupMock: vi.fn(),
  log: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@oops/domain/tasks/executor", () => ({ recoverInterruptedTasks: h.recoverMock }));
vi.mock("@oops/domain/credits/service", () => ({
  creditsService: { reconcileFrozen: h.reconcileMock },
}));
vi.mock("@oops/domain/notifications/service", () => ({
  notificationsService: { cleanupExpired: h.cleanupMock },
}));

async function register() {
  vi.resetModules();
  process.env.NEXT_RUNTIME = "nodejs";
  const mod = await import("./instrumentation");
  await mod.register();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.recoverMock.mockResolvedValue(0);
  h.reconcileMock.mockResolvedValue(0);
  h.cleanupMock.mockResolvedValue(0);
  vi.spyOn(console, "log").mockImplementation(h.log);
  vi.spyOn(console, "error").mockImplementation(h.error);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startup register", () => {
  it("启动即清理过期已读通知投递行（D12）", async () => {
    await register();
    expect(h.cleanupMock).toHaveBeenCalledTimes(1);
  });

  it("清理有删除量时才打印日志", async () => {
    h.cleanupMock.mockResolvedValue(3);
    await register();
    const printed = h.log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("3");
  });

  it("清理失败不影响启动（通知数据问题不拖垮服务）", async () => {
    h.cleanupMock.mockRejectedValue(new Error("db down"));
    await expect(register()).resolves.toBeUndefined();
    expect(h.error).toHaveBeenCalled();
  });

  it("非 Node 运行时直接返回，不碰 DB", async () => {
    vi.resetModules();
    process.env.NEXT_RUNTIME = "edge";
    const mod = await import("./instrumentation");
    await mod.register();
    expect(h.recoverMock).not.toHaveBeenCalled();
    expect(h.cleanupMock).not.toHaveBeenCalled();
  });
});
