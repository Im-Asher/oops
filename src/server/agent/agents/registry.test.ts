import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agentRegistry, defineAgent } from "./registry";
import { toolRegistry, type ToolDefinition } from "@/server/agent/tools/registry";

function fakeTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: "测试",
    schema: z.object({}),
    jsonSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    async execute() {
      return { content: [] };
    },
  };
}

describe("AgentRegistry", () => {
  it("声明式注册：get / list 可见已注册 Agent", () => {
    agentRegistry.register(
      defineAgent({
        id: "registry-test",
        name: "测试",
        description: "测试 Agent",
        tools: ["generate_image"],
        systemPrompt: "x",
      }),
    );
    expect(agentRegistry.get("registry-test")?.tools).toEqual(["generate_image"]);
    expect(agentRegistry.list().some((a) => a.id === "registry-test")).toBe(true);
  });

  it("按名授权：getAgentTools 只返回「Agent 声明 ∩ 已注册工具」，越权工具不出现", () => {
    toolRegistry.register(fakeTool("gen_tool"));
    toolRegistry.register(fakeTool("extra_tool"));
    agentRegistry.register(
      defineAgent({
        id: "auth-test",
        name: "测试",
        description: "测试 Agent",
        tools: ["gen_tool"],
        systemPrompt: "x",
      }),
    );
    const tools = agentRegistry.getAgentTools("auth-test");
    expect(tools.map((t) => t.name)).toEqual(["gen_tool"]);
    expect(tools.some((t) => t.name === "extra_tool")).toBe(false);
  });
});
