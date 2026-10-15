import { toolRegistry } from "./registry";
import { generateImageTool } from "./generate-image";
import { renderHtmlTool } from "./render-html";
import { presentOptionsTool } from "./present-options";

/** 注册全部内置工具。幂等，可重复调用。 */
export function registerBuiltinTools(): void {
  toolRegistry.register(generateImageTool);
  toolRegistry.register(renderHtmlTool);
  toolRegistry.register(presentOptionsTool);
}

registerBuiltinTools();
