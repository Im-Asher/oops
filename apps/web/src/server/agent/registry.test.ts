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
        icon: "🧪",
        presets: [],
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
        icon: "🧪",
        presets: [],
        tools: ["gen_tool"],
        systemPrompt: "x",
      }),
    );
    const tools = agentRegistry.getAgentTools("auth-test", { userId: "u1" });
    expect(tools.map((t) => t.name)).toEqual(["gen_tool"]);
    expect(tools.some((t) => t.name === "extra_tool")).toBe(false);
  });

  it("元数据导出：metadata() 含 icon 与 presets 且不含 systemPrompt", () => {
    agentRegistry.register(
      defineAgent({
        id: "meta-test",
        name: "测试",
        description: "测试 Agent",
        icon: "🧪",
        presets: ["需求一", "需求二"],
        tools: [],
        systemPrompt: "secret-prompt",
      }),
    );
    const meta = agentRegistry.metadata().find((a) => a.id === "meta-test");
    expect(meta).toMatchObject({ id: "meta-test", icon: "🧪", presets: ["需求一", "需求二"], tools: [] });
    expect(meta).not.toHaveProperty("systemPrompt");
  });

  it("声明式定义加载：内置两个 Agent 注册且元数据可透出", async () => {
    await import("./index"); // 副作用：加载全部定义
    const meta = agentRegistry.metadata();
    expect(meta.find((a) => a.id === "atmosphere-designer")).toMatchObject({
      name: "氛围图设计师",
      icon: "🌄",
      tools: ["generate_image"],
    });
    expect(meta.find((a) => a.id === "product-photographer")).toMatchObject({
      name: "产品摄影师",
      icon: "📸",
      tools: ["generate_image"],
    });
    expect(meta.find((a) => a.id === "product-photographer")).not.toHaveProperty("systemPrompt");
    expect(meta.find((a) => a.id === "atmosphere-designer")?.presets).toHaveLength(3);
    expect(meta.find((a) => a.id === "product-photographer")?.presets).toHaveLength(3);
  });

  it("models 声明：合法能力位透传，运行时/装配层可读取", () => {
    agentRegistry.register(
      defineAgent({
        id: "models-declared",
        name: "测试",
        description: "测试 Agent",
        icon: "🧪",
        presets: [],
        tools: [],
        systemPrompt: "x",
        models: { main: { capabilities: ["vision"] } },
      }),
    );
    expect(agentRegistry.get("models-declared")?.models?.main?.capabilities).toEqual(["vision"]);
  });

  it("models 校验：空 capabilities 启动即报错", () => {
    expect(() =>
      defineAgent({
        id: "empty-caps",
        name: "测试",
        description: "测试 Agent",
        icon: "🧪",
        presets: [],
        tools: [],
        systemPrompt: "x",
        models: { main: { capabilities: [] } },
      }),
    ).toThrowError(/非空数组/);
  });

  it("models 校验：未知能力名启动即报错", () => {
    expect(() =>
      defineAgent({
        id: "bad-caps",
        name: "测试",
        description: "测试 Agent",
        icon: "🧪",
        presets: [],
        tools: [],
        systemPrompt: "x",
        // 故意越类型：运行时守卫须拦截（unknown 能力）
        models: { main: { capabilities: ["telepathy" as "vision"] } },
      }),
    ).toThrowError(/未知模型能力/);
  });

  it("未声明 models 的定义保持原状（字段缺省）", () => {
    const def = defineAgent({
      id: "no-models",
      name: "测试",
      description: "测试 Agent",
      icon: "🧪",
      presets: [],
      tools: [],
      systemPrompt: "x",
    });
    expect(def.models).toBeUndefined();
  });
});
