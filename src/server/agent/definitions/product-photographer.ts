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
  presets: [
    "为这款保温杯拍一张纯白背景主图，突出杯身的金属质感",
    "木质桌面上的咖啡杯场景摆拍，清晨自然光，温暖氛围",
    "为这款面霜生成一张电商主图，浅粉背景配柔和阴影，突出瓶身细节",
  ],
  tools: ["generate_image"],
  systemPrompt,
});

agentRegistry.register(productPhotographer);
