import { describe, expect, it } from "vitest";
import { clearWorkspace, loadWorkspace, parseWorkspace, saveWorkspace } from "@/lib/canvas/workspace-storage";

/** 内存存储桩：模拟 localStorage 行为。 */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const snapshot = {
  positions: { "asset-1": { x: 10, y: 20 } },
  view: { x: -40, y: 12, scale: 1.25 },
  draft: "海边日落",
  referenceAssetId: "asset-1",
};

describe("workspace-storage 序列化与恢复", () => {
  it("save → load 往返保持快照一致，键按会话隔离", () => {
    const storage = memoryStorage();
    saveWorkspace("s1", snapshot, storage);
    saveWorkspace("s2", { ...snapshot, draft: "另一个会话" }, storage);
    expect(loadWorkspace("s1", storage)).toEqual(snapshot);
    expect(loadWorkspace("s2", storage)?.draft).toBe("另一个会话");
    expect(loadWorkspace("missing", storage)).toBeNull();
  });

  it("clearWorkspace 移除快照", () => {
    const storage = memoryStorage();
    saveWorkspace("s1", snapshot, storage);
    clearWorkspace("s1", storage);
    expect(loadWorkspace("s1", storage)).toBeNull();
  });

  it("损坏 JSON 返回 null 不抛错", () => {
    expect(parseWorkspace("{not json")).toBeNull();
    expect(parseWorkspace(null)).toBeNull();
    expect(parseWorkspace("42")).toBeNull();
  });

  it("缺失字段补默认值；非法坐标点被过滤", () => {
    const parsed = parseWorkspace(
      JSON.stringify({ view: { x: 1, y: 2, scale: 1 }, positions: { good: { x: 1, y: 2 }, bad: { x: "a" } } }),
    );
    expect(parsed).toEqual({
      positions: { good: { x: 1, y: 2 } },
      view: { x: 1, y: 2, scale: 1 },
      draft: "",
      referenceAssetId: null,
    });
  });

  it("视角 scale 非法/越界被钳制；view 非法整体判无效", () => {
    const ok = parseWorkspace(JSON.stringify({ view: { x: 0, y: 0, scale: 999 } }));
    expect(ok?.view.scale).toBe(4); // MAX_SCALE
    const bad = parseWorkspace(JSON.stringify({ view: { x: "a", y: 0 } }));
    expect(bad).toBeNull();
  });
});
