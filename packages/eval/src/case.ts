import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const caseSchema = z.object({
  id: z.string().min(1),
  agent: z.string().min(1).default("poster-designer"),
  message: z.string().min(1),
  /** 相对 packages/eval 的 fixtures 路径。 */
  references: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string()).default([]),
  assert: z.object({
    size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    /**
     * 尺寸不是单一确定值时（海报高度档位由模型自选）：宽度仍按 size[0] 卡，
     * 高度只要落在该集合内即通过。
     */
    allowedHeights: z.array(z.number().int().positive()).optional(),
    /**
     * 尺寸完全由模型从工具枚举里挑时（如文生图像素档位）：实际尺寸命中任一即可。
     * 用于卡「供应商返回了枚举外的尺寸」，而不是卡某个具体像素。
     */
    allowedSizes: z
      .array(z.tuple([z.number().int().positive(), z.number().int().positive()]))
      .optional(),
    mustContainText: z.array(z.string()).default([]),
    maxOverflowPx: z.number().int().min(0).default(0),
    denyCss: z.array(z.string()).default([]),
  }),
});

export type EvalCase = z.infer<typeof caseSchema>;

export function parseCase(source: string): EvalCase {
  return caseSchema.parse(parseYaml(source));
}

export function loadCases(dir: string): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => parseCase(readFileSync(join(dir, f), "utf8")))
    .sort((a, b) => a.id.localeCompare(b.id));
}
