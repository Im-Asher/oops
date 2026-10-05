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
  presets: [
    "生成一张秋天树林里木桌旁的场景氛围图，暖色调逆光",
    "为家居品牌生成一张客厅场景图，米色沙发配绿植，午后阳光",
    "生成一张海边日落时分的野餐场景图，电影感构图",
  ],
  tools: ["generate_image"],
  systemPrompt,
});

agentRegistry.register(atmosphereDesigner);
