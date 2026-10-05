import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/require-user", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/server/agent", () => ({
  agentRegistry: {
    metadata: vi.fn(() => [
      {
        id: "product-photographer",
        name: "产品摄影师",
        description: "d",
        icon: "📸",
        presets: ["预设一", "预设二", "预设三"],
        tools: ["generate_image"],
      },
    ]),
  },
}));

import { requireUser } from "@/server/auth/require-user";
import { GET } from "./route";

describe("GET /api/agents", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue("u1");
  });

  it("返回含 presets 的 Agent 元数据且不含 systemPrompt", async () => {
    const res = await GET(new Request("http://localhost/api/agents"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<Record<string, unknown>> };
    expect(body.agents[0]).toMatchObject({
      id: "product-photographer",
      presets: ["预设一", "预设二", "预设三"],
    });
    expect(body.agents[0]).not.toHaveProperty("systemPrompt");
  });

  it("未认证返回 401", async () => {
    vi.mocked(requireUser).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/agents"));
    expect(res.status).toBe(401);
  });
});
