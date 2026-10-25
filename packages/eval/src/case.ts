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
