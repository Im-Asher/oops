import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGN_MATERIALS, findMaterial, materialElement } from "@/lib/design/materials";

describe("素材目录", () => {
  // 目录完整性：所有素材文件真实存在（守卫在测试侧，模块保持 client 安全）。
  const allMaterialFilesExist = () =>
    DESIGN_MATERIALS.every((material) => existsSync(join(process.cwd(), "public", material.src)));

  it("所有素材文件真实存在于 public/design-materials/", () => {
    expect(allMaterialFilesExist()).toBe(true);
  });

  it("素材 id 唯一且固有尺寸合法", () => {
    const ids = DESIGN_MATERIALS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const material of DESIGN_MATERIALS) {
      expect(material.width).toBeGreaterThan(0);
      expect(material.height).toBeGreaterThan(0);
      expect(material.src).toMatch(/^\/design-materials\/[\w-]+\.svg$/);
    }
  });

  it("findMaterial 命中与未命中", () => {
    expect(findMaterial("crown")?.src).toContain("crown.svg");
    expect(findMaterial("nope")).toBeNull();
  });
});

describe("materialElement", () => {
  it("按画布宽度等比缩放固有尺寸（800 基准），fit=contain 同源 src", () => {
    const material = findMaterial("crown")!;
    const element = materialElement(material, 1600);
    expect(element.type).toBe("image");
    expect(element.w).toBeCloseTo(material.width * 2);
    expect(element.h).toBeCloseTo(material.height * 2);
    expect(element.src).toBe(material.src);
    expect(element.fit).toBe("contain");
    expect(element.rotation).toBe(0);
    expect(element.opacity).toBe(1);
  });

  it("每次生成独立 id（多次插入不冲突）", () => {
    const material = findMaterial("star")!;
    expect(materialElement(material, 800).id).not.toBe(materialElement(material, 800).id);
  });
});
