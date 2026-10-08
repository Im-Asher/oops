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
        // definitions 中的 presets 是词典 key；route 按请求 locale 解析为文案
        presets: ["thermosWhiteMain", "coffeeScene", "creamMain"],
        tools: ["generate_image"],
      },
    ]),
  },
}));

// getMessages 按请求 locale 返回词典——测试固定用 zh 词典断言解析结果
vi.mock("next-intl/server", () => ({
  getMessages: vi.fn(async () => (await import("../../../../messages/zh.json")).default),
}));

import { requireUser } from "@/server/auth/require-user";
import { GET } from "./route";

describe("GET /api/agents", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue("u1");
  });

  it("返回含 presets 的 Agent 元数据（词典解析为文案）且不含 systemPrompt", async () => {
    const res = await GET(new Request("http://localhost/api/agents"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<Record<string, unknown>> };
    expect(body.agents[0]).toMatchObject({
      id: "product-photographer",
      presets: [
        "为这款保温杯拍一张纯白背景主图，突出杯身的金属质感",
        "木质桌面上的咖啡杯场景摆拍，清晨自然光，温暖氛围",
        "为这款面霜生成一张电商主图，浅粉背景配柔和阴影，突出瓶身细节",
      ],
    });
    expect(body.agents[0]).not.toHaveProperty("systemPrompt");
  });

  it("未认证返回 401", async () => {
    vi.mocked(requireUser).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/agents"));
    expect(res.status).toBe(401);
  });
});
