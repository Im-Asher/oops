import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCases } from "./case";
import { pngSize } from "./judges/l1";

const PKG = join(import.meta.dirname, "..");
const CASES_DIR = join(PKG, "cases");
const FIXTURES_DIR = join(PKG, "fixtures");

describe("真实 cases/ 目录", () => {
  const cases = loadCases(CASES_DIR);

  it("能加载并且数量 ≥ 6", () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  it("id 唯一且有序", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("每个 case 的 assert.size 都是正整数二元组", () => {
    for (const c of cases) {
      expect(c.assert.size).toHaveLength(2);
      for (const n of c.assert.size) expect(Number.isInteger(n) && n > 0).toBe(true);
    }
  });

  it("每个 references 都能在 fixtures/ 下找到且是合法 PNG", () => {
    for (const c of cases) {
      for (const rel of c.references) {
        const file = join(FIXTURES_DIR, rel);
        expect(existsSync(file), `${c.id}: 缺少参考图 ${rel}`).toBe(true);
        expect(pngSize(readFileSync(file)), `${c.id}: ${rel} 不是合法 PNG`).not.toBeNull();
      }
    }
  });
});
