import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { agentRegistry, defineAgent } from "../registry";

const here = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(here, "prompts", "product-photographer.md"), "utf8");

export const productPhotographer = defineAgent({
  id: "product-photographer",
  name: "产品摄影师",
  description:
    "专注棚拍质感的产品图摄影师：白底主图、场景摆拍、电商主图规范，调用 generate_image 出图。",
  icon: "📸",
  tools: ["generate_image"],
  systemPrompt,
});

agentRegistry.register(productPhotographer);
