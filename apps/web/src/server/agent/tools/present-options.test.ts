import { describe, expect, it } from "vitest";
import { presentOptionsSchema, presentOptionsTool } from "./present-options";

const ctx = { userId: "u1", sessionId: "s1" };

describe("present_options 工具", () => {
  it("schema：question + 2~6 个选项合法，detail 可选", () => {
    expect(
      presentOptionsSchema.safeParse({
        question: "这张图主要用在哪里？",
        options: [{ label: "商品详情页氛围图" }, { label: "电商主图", detail: "1:1 纯白背景" }],
      }).success,
    ).toBe(true);
  });

  it("schema：少于 2 个 / 多于 4 个选项、空 label、超长字段均拒绝（registry 层结构化回喂，不 terminate）", () => {
    const base = { question: "q" };
    expect(presentOptionsSchema.safeParse({ ...base, options: [{ label: "只有一项" }] }).success).toBe(false);
    expect(
      presentOptionsSchema.safeParse({
        ...base,
        options: Array.from({ length: 5 }, (_, i) => ({ label: `选项${i}` })),
      }).success,
    ).toBe(false);
    expect(
      presentOptionsSchema.safeParse({ ...base, options: [{ label: "" }, { label: "b" }] }).success,
    ).toBe(false);
    expect(
      presentOptionsSchema.safeParse({
        ...base,
        question: "一".repeat(201),
        options: [{ label: "a" }, { label: "b" }],
      }).success,
    ).toBe(false);
    expect(
      presentOptionsSchema.safeParse({
        ...base,
        options: [{ label: "a".repeat(41) }, { label: "b" }],
      }).success,
    ).toBe(false);
  });

  it("execute：details 原样透出 question/options，terminate=true 结束本轮等待点击", async () => {
    const args = {
      question: "海报用途？",
      options: [{ label: "促销主图" }, { label: "上新海报", detail: "新品上架" }],
    };
    const result = await presentOptionsTool.execute(args, ctx);
    expect(result.terminate).toBe(true);
    expect(result.details).toEqual({ question: args.question, options: args.options });
    expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("等待用户选择") }]);
  });
});
