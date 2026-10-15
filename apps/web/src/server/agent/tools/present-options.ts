import { z } from "zod";
import type { ToolDefinition } from "./registry";

/**
 * present_options：把「需要用户拍板的分支」渲染为可点击选项卡（HITL）。
 * execute 无任何 IO 副作用：details 原样透传给持久化与前端渲染，
 * terminate=true 由 runtime 借 pi-agent-core 结束本轮 agent 循环，等待用户点击。
 */
export const presentOptionsSchema = z.object({
  question: z.string().min(1).max(200).describe("一句话说明需要用户确认什么"),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(40).describe("选项按钮文案，用户点它即作为下一条消息发出"),
        detail: z.string().min(1).max(120).optional().describe("可选补充说明，显示在按钮下方"),
      }),
    )
    .min(2)
    .max(4)
    .describe("2~4 个互斥选项，覆盖最可能的选择"),
});

export type PresentOptionsArgs = z.infer<typeof presentOptionsSchema>;

const presentOptionsJsonSchema = {
  type: "object",
  properties: {
    question: { type: "string", minLength: 1, description: "一句话说明需要用户确认什么" },
    options: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          label: { type: "string", minLength: 1, description: "选项按钮文案，用户点它即作为下一条消息发出" },
          detail: { type: "string", minLength: 1, description: "可选补充说明，显示在按钮下方" },
        },
        required: ["label"],
        additionalProperties: false,
      },
      description: "2~4 个互斥选项，覆盖最可能的选择",
    },
  },
  required: ["question", "options"],
  additionalProperties: false,
};

export const presentOptionsTool: ToolDefinition<PresentOptionsArgs> = {
  name: "present_options",
  label: "出示选项",
  description:
    "下一步存在明确分支需要用户拍板时，把问题与候选项渲染成可点击选项卡并结束本轮，等待用户点击。" +
    "调用后本轮回复自然收尾，不要再输出让用户打字回答的等效问题清单。",
  schema: presentOptionsSchema,
  jsonSchema: presentOptionsJsonSchema,
  async execute(args) {
    return {
      content: [
        {
          type: "text",
          text: `已向用户出示 ${args.options.length} 个选项（点击即作为下一条消息发出），等待用户选择后再继续。`,
        },
      ],
      details: { question: args.question, options: args.options },
      terminate: true,
    };
  },
};
