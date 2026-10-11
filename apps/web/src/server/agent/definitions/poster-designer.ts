import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agentRegistry, defineAgent } from "../registry";

const here = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(here, "prompts", "poster-designer.md"), "utf8");

export const posterDesigner = defineAgent({
  id: "poster-designer",
  name: "海报设计师",
  description: "看图做海报：基于商品图与需求产出完整海报版式，服务端渲染为成品图片。",
  icon: "🎨",
  // 灵感卡 presets 为词典 key（chat.presets.<agentId>.<key>），/api/agents 按请求 locale 解析为文案。
  presets: ["promoSale", "festivalMain", "newArrival"],
  tools: ["generate_image", "render_html"],
  // 主模型需 vision：直接观察商品图完成版式设计（能力不满足时装配层 fail-fast）。
  models: { main: { capabilities: ["vision"] } },
  systemPrompt,
});

agentRegistry.register(posterDesigner);
