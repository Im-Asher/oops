import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toolRegistry, type ToolDefinition, type ToolHandlerResult } from "./registry";

const schema = z.object({ prompt: z.string().min(1) });

const def: ToolDefinition<{ prompt: string }> = {
  name: "echo_tool",
  label: "回显",
  description: "测试工具",
  schema,
  jsonSchema: {
    type: "object",
    properties: { prompt: { type: "string", minLength: 1 } },
    required: ["prompt"],
    additionalProperties: false,
  },
  async execute(args): Promise<ToolHandlerResult> {
    return { content: [{ type: "text", text: args.prompt }], details: { ok: true } };
  },
};

describe("ToolRegistry", () => {
  it("按名授权：getAgentTools 只返回已登记且在白名单中的工具", () => {
    toolRegistry.register(def);
    const allowed = toolRegistry.getAgentTools(["echo_tool"]);
    expect(allowed.has("echo_tool")).toBe(true);
    const filtered = toolRegistry.getAgentTools(["echo_tool", "nonexistent"]);
    expect(filtered.size).toBe(1);
  });

  it("zod 入参校验：非法参数返回结构化错误文本", async () => {
    toolRegistry.register(def);
    const tool = toolRegistry.getAgentTool("echo_tool")!;
    const bad = (await tool.execute("call-1", { prompt: "" })) as { content: { text: string }[] };
    expect(bad.content[0].text).toContain("参数校验失败");
  });

  it("合法参数调用处理器并返回结果", async () => {
    const spy = vi.spyOn(def, "execute");
    toolRegistry.register(def);
    const tool = toolRegistry.getAgentTool("echo_tool")!;
    const ok = (await tool.execute("call-2", { prompt: "hi" })) as {
      content: { text: string }[];
      details: Record<string, unknown>;
    };
    expect(ok.content[0].text).toBe("hi");
    expect(ok.details).toEqual({ ok: true });
    spy.mockRestore();
  });
});
