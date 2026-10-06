import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allMaterialFilesExist, DESIGN_MATERIALS, findMaterial } from "@/lib/design/materials";

describe("素材目录", () => {
  const publicDir = join(process.cwd(), "public");

  it("所有素材文件真实存在于 public/design-materials/", () => {
    expect(allMaterialFilesExist(publicDir)).toBe(true);
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
