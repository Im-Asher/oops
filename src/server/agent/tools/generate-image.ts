import { z } from "zod";
import type { ImageContent } from "@earendil-works/pi-ai";
import { submitAndWait } from "@/server/domain/tasks/task-executor";
import type { ToolDefinition } from "./registry";

const SIZES = [
  "1024*1024",
  "768*1344",
  "864*1152",
  "1024*768",
  "1152*864",
  "1344*768",
] as const;

const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;

export const generateImageSchema = z.object({
  prompt: z.string().min(1).describe("画面描述（建议含主体、风格、构图、色调）"),
  size: z.enum(SIZES).describe("像素尺寸，如 1024*1024"),
  aspectRatio: z.enum(RATIOS).describe("宽高比，如 1:1"),
});

export type GenerateImageArgs = z.infer<typeof generateImageSchema>;

const generateImageJsonSchema = {
  type: "object",
  properties: {
    prompt: { type: "string", minLength: 1, description: "画面描述（建议含主体、风格、构图、色调）" },
    size: { type: "string", enum: [...SIZES], description: "像素尺寸，如 1024*1024" },
    aspectRatio: { type: "string", enum: [...RATIOS], description: "宽高比，如 1:1" },
  },
  required: ["prompt", "size", "aspectRatio"],
  additionalProperties: false,
};

interface GenerateImageOutcome {
  assetId: string;
  url: string;
  data: string;
  mimeType: string;
  prompt: string;
  model: string;
  size: string;
  provider: string;
  taskId: string;
}

export const generateImageTool: ToolDefinition<GenerateImageArgs> = {
  name: "generate_image",
  label: "文生图",
  description:
    "根据文字描述生成一张产品图或氛围/场景图。仅在用户明确要求“生成图片/出图/画图”时调用。" +
    "尺寸与宽高比从用户意图推断，未指定则默认 1024*1024 与 1:1。",
  schema: generateImageSchema,
  jsonSchema: generateImageJsonSchema,
  async execute(args, ctx) {
    try {
      const result = (await submitAndWait(
        "generate_image",
        {
          prompt: args.prompt,
          size: args.size,
          aspectRatio: args.aspectRatio,
        },
        { sessionId: ctx.sessionId, userId: ctx.userId },
      )) as GenerateImageOutcome;
      const image: ImageContent = {
        type: "image",
        data: result.data,
        mimeType: result.mimeType,
      };
      return {
        content: [image],
        details: {
          assetId: result.assetId,
          url: result.url,
          prompt: result.prompt,
          model: result.model,
          size: result.size,
          provider: result.provider,
          taskId: result.taskId,
        },
      };
    } catch (err) {
      const message = (err as Error)?.message ?? "图像生成失败";
      return {
        content: [{ type: "text", text: `图像生成失败：${message}` }],
        details: { error: "generation_failed", message },
      };
    }
  },
};
