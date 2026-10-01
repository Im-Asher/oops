import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agentRegistry, defineAgent } from "../registry";

const here = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(here, "prompts", "atmosphere-designer.md"), "utf8");

export const atmosphereDesigner = defineAgent({
  id: "atmosphere-designer",
  name: "氛围图设计师",
  description: "专注氛围/场景图与产品图的文生图助手，调用 generate_image 把描述变成图片。",
  icon: "🌄",
  tools: ["generate_image"],
  systemPrompt,
});

agentRegistry.register(atmosphereDesigner);
