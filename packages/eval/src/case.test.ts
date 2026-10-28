import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCases, parseCase } from "./case";

const valid = `id: 001-poster-minimal
agent: poster-designer
message: "做一张极简海报"
references: [fixtures/product.png]
assert:
  size: [750, 1334]
  mustContainText: ["恒温 12 小时"]
  maxOverflowPx: 0
  denyCss: [grid]`;

describe("parseCase", () => {
  it("解析合法 yaml 并填默认值", () => {
    const c = parseCase(valid);
    expect(c.id).toBe("001-poster-minimal");
    expect(c.assert.size).toEqual([750, 1334]);
    expect(c.assert.maxOverflowPx).toBe(0);
  });

  it("可选 allowedHeights 能解析", () => {
    const c = parseCase(`${valid}\n  allowedHeights: [1000, 1334, 1654]\n`);
    expect(c.assert.allowedHeights).toEqual([1000, 1334, 1654]);
  });

  it("缺 allowedHeights 时为 undefined（走精确比较）", () => {
    expect(parseCase(valid).assert.allowedHeights).toBeUndefined();
  });

  it("allowedHeights 非正整数时抛错", () => {
    expect(() => parseCase(`${valid}\n  allowedHeights: [0]\n`)).toThrow();
    expect(() => parseCase(`${valid}\n  allowedHeights: [1000.5]\n`)).toThrow();
  });

  it("可选 allowedSizes 能解析", () => {
    const c = parseCase(`${valid}\n  allowedSizes:\n    - [1024, 1024]\n`);
    expect(c.assert.allowedSizes).toEqual([[1024, 1024]]);
  });

  it("allowedSizes 含非正整数时抛错", () => {
    expect(() => parseCase(`${valid}\n  allowedSizes:\n    - [0, 1024]\n`)).toThrow();
  });

  it("缺 id 时抛错", () => {
    expect(() => parseCase("message: hi\nassert:\n  size: [750, 1334]\n")).toThrow();
  });
});

describe("loadCases", () => {
  it("只加载 .yaml 且按 id 排序", () => {
    const dir = mkdtempSync(join(tmpdir(), "cases-"));
    writeFileSync(join(dir, "b.yaml"), valid.replace("001-poster-minimal", "002-b"));
    writeFileSync(join(dir, "a.yaml"), valid.replace("001-poster-minimal", "001-a"));
    writeFileSync(join(dir, "notes.txt"), "ignore me");
    const cases = loadCases(dir);
    expect(cases.map((c) => c.id)).toEqual(["001-a", "002-b"]);
  });
});
