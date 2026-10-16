import { describe, expect, it } from "vitest";
import {
  DESIGN_PRESET_GROUPS,
  loadRecentSizes,
  recordRecentSize,
} from "@/lib/design/presets";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("尺寸预设目录", () => {
  it("包含常用尺寸/电商物料/社交媒体三组，每组尺寸合法", () => {
    expect(DESIGN_PRESET_GROUPS.map((g) => g.id)).toEqual(["common", "ecom", "social"]);
    for (const group of DESIGN_PRESET_GROUPS) {
      expect(group.presets.length).toBeGreaterThan(0);
      for (const preset of group.presets) {
        expect(preset.width).toBeGreaterThan(0);
        expect(preset.height).toBeGreaterThan(0);
        expect(preset.id).toBeTruthy();
      }
    }
  });

  it("预设 id 全局唯一（词典 key 依赖唯一性）", () => {
    const ids = DESIGN_PRESET_GROUPS.flatMap((g) => g.presets.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("最近使用尺寸存储", () => {
  it("记录去重置顶并保持最近优先", () => {
    const storage = memoryStorage();
    recordRecentSize({ width: 800, height: 800 }, storage);
    recordRecentSize({ width: 1242, height: 1656 }, storage);
    recordRecentSize({ width: 800, height: 800 }, storage);
    expect(loadRecentSizes(storage)).toEqual([
      { width: 800, height: 800 },
      { width: 1242, height: 1656 },
    ]);
  });

  it("上限 8 条，最旧被丢弃；空/损坏存储返回空数组", () => {
    const storage = memoryStorage();
    for (let i = 0; i < 10; i += 1) {
      recordRecentSize({ width: 100 + i, height: 200 + i }, storage);
    }
    const sizes = loadRecentSizes(storage);
    expect(sizes.length).toBe(8);
    expect(sizes[0]).toEqual({ width: 109, height: 209 });
    expect(sizes[7]).toEqual({ width: 102, height: 202 });

    expect(loadRecentSizes(memoryStorage())).toEqual([]);
    storage.setItem("oops:design:recent-sizes:v1", "{not json");
    expect(loadRecentSizes(storage)).toEqual([]);
  });
});
