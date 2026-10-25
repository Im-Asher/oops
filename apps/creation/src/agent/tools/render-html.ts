import { z } from "zod";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { submitAndWait } from "@oops/domain/tasks/executor";
import { createAssetRepo } from "@oops/db/asset.repo";
import type { ToolDefinition } from "./registry";

/** 海报固定宽（电商主图宽度惯例）。 */
export const POSTER_WIDTH = 750;
/** 海报高度档位（单屏海报，详情长图延后）。 */
export const POSTER_HEIGHTS = [1000, 1334, 1654] as const;
/** HTML 入参大小上限。 */
export const HTML_MAX_BYTES = 200_000;

export const renderHtmlSchema = z.object({
  html: z
    .string()
    .min(1)
    .max(HTML_MAX_BYTES, `HTML 超过 ${HTML_MAX_BYTES} 字节上限`)
    .describe(
      "完整自包含的海报 HTML：内联全部 CSS、禁止 script/内联事件、固定视口尺寸即海报尺寸",
    ),
  height: z
    .number()
    .int()
    .refine(
      (v): v is (typeof POSTER_HEIGHTS)[number] =>
        (POSTER_HEIGHTS as readonly number[]).includes(v),
      `高度仅支持 ${POSTER_HEIGHTS.join("/")}`,
    )
    .describe(`海报高度档位（宽固定 ${POSTER_WIDTH}）`),
  referenceAssetId: z
    .string()
    .min(1)
    .optional()
    .describe("海报依据的画布商品图 assetId（血缘记录）；未引用时不传"),
});

export type RenderHtmlArgs = z.infer<typeof renderHtmlSchema>;

const renderHtmlJsonSchema = {
  type: "object",
  properties: {
    html: {
      type: "string",
      minLength: 1,
      maxLength: HTML_MAX_BYTES,
      description: "完整自包含的海报 HTML：内联全部 CSS、禁止 script/内联事件、固定视口尺寸即海报尺寸",
    },
    height: {
      type: "number",
      enum: [...POSTER_HEIGHTS],
      description: `海报高度档位（宽固定 ${POSTER_WIDTH}）`,
    },
    referenceAssetId: {
      type: "string",
      minLength: 1,
      description: "海报依据的画布商品图 assetId（血缘记录）；未引用时不传",
    },
  },
  required: ["html", "height"],
  additionalProperties: false,
};

interface RenderHtmlOutcome {
  assetId: string;
  url: string;
  data: string;
  mimeType: string;
  width: number;
  height: number;
  taskId: string;
  /** 渲染前被剥离的图片引用数（外链/读取失败/src 缺失）。 */
  droppedImages?: number;
  referenceAssetId?: string;
}

export const renderHtmlTool: ToolDefinition<RenderHtmlArgs> = {
  name: "render_html",
  label: "海报渲染",
  description:
    "把你生成的完整海报 HTML 渲染为一张海报图片（服务端无浏览器渲染）。" +
    "HTML 必须自包含：内联全部 CSS、无脚本、按宽 750 与所选高度档位设计；" +
    "先想好版式与文案再产出完整 HTML，一次渲染成型。",
  schema: renderHtmlSchema,
  jsonSchema: renderHtmlJsonSchema,
  async execute(args, ctx) {
    // 引用血缘：归属校验（存在、本人、本会话），失败结构化回喂模型，不进渲染队列。
    if (args.referenceAssetId) {
      const asset = await createAssetRepo().get(args.referenceAssetId);
      const valid =
        asset && asset.userId === ctx.userId && asset.sessionId === ctx.sessionId;
      if (!valid) {
        const message = "引用的图片不存在或无权使用";
        return {
          content: [{ type: "text", text: `海报渲染失败：${message}` }],
          details: { error: "invalid_reference", message },
        };
      }
    }
    try {
      const result = (await submitAndWait(
        "render_html",
        {
          html: args.html,
          width: POSTER_WIDTH,
          height: args.height,
          ...(args.referenceAssetId ? { referenceAssetId: args.referenceAssetId } : {}),
        },
        { sessionId: ctx.sessionId, userId: ctx.userId, signal: ctx.signal },
      )) as RenderHtmlOutcome;
      const image: ImageContent = {
        type: "image",
        data: result.data,
        mimeType: result.mimeType,
      };
      // 有图被剥离时明确告知：商品图丢失会让海报缺主角，Agent 必须转告用户重新
      // 上传/选中，而不是静默交付一张带空洞的海报。
      const dropped = result.droppedImages ?? 0;
      const caption: TextContent = {
        type: "text",
        text:
          `海报已渲染：${result.url}（${POSTER_WIDTH}×${result.height}）` +
          (dropped > 0
            ? `。注意：有 ${dropped} 处图片引用未能加载（外链被禁或读取失败），成品中对应位置为空——若缺失的是商品图，请告知用户重新上传并选中该图后重试。`
            : ""),
      };
      return {
        content: [image, caption],
        details: {
          assetId: result.assetId,
          url: result.url,
          width: result.width,
          height: result.height,
          taskId: result.taskId,
          ...(result.droppedImages !== undefined ? { droppedImages: result.droppedImages } : {}),
          ...(result.referenceAssetId ? { referenceAssetId: result.referenceAssetId } : {}),
        },
      };
    } catch (err) {
      const message = (err as Error)?.message ?? "海报渲染失败";
      return {
        content: [{ type: "text", text: `海报渲染失败：${message}` }],
        details: { error: "render_failed", message },
      };
    }
  },
};
