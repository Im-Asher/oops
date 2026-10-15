// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import ChatPage from "./page";

// 画布重子件以 stub 替代（本文件只验证聊天链路：bootstrap → 选项卡 → 点击应答守卫）
vi.mock("@/components/canvas/canvas-stage", () => ({ CanvasStage: () => null }));
vi.mock("@/components/chat/session-sidebar", () => ({ SessionSidebar: () => null }));
vi.mock("@/components/chat/user-menu", () => ({ UserMenuContent: () => null }));
vi.mock("@/lib/chat/home-handoff", () => ({
  hasPendingHandoff: () => false,
  takePendingHandoffFiles: () => [],
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

interface ChatCallBody {
  sessionId: string;
  message: string;
  referenceAssetIds?: string[];
}

const chatCalls: ChatCallBody[] = [];

/** /api/chat SSE：推一条 message_delta 后保持打开（busy 悬置，供断言期间守卫生效）。 */
function openSseBody(): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: message_delta\ndata: {"text":"好"}\n\n'));
    },
  });
}

function jsonResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as unknown as Response;
}

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (url.includes("/api/agents")) {
    return Promise.resolve(
      jsonResponse({
        agents: [
          {
            id: "poster-designer",
            name: "海报设计师",
            description: "",
            icon: "🎨",
            presets: [],
            tools: [],
          },
        ],
      }),
    );
  }
  if (url === "/api/sessions" && (!init?.method || init.method === "GET")) {
    return Promise.resolve(
      jsonResponse({
        sessions: [
          { id: "s1", agentId: "poster-designer", title: "T", updatedAt: new Date().toISOString() },
        ],
      }),
    );
  }
  if (url.startsWith("/api/sessions/s1")) {
    return Promise.resolve(
      jsonResponse({
        messages: [
          {
            id: "m1",
            role: "assistant",
            parts: [
              { type: "text", text: "请选择海报用途" },
              {
                type: "options",
                question: "海报主要用在哪里？",
                options: [{ label: "促销主图" }, { label: "上新海报" }],
              },
            ],
          },
        ],
      }),
    );
  }
  if (url === "/api/chat") {
    chatCalls.push(JSON.parse(String(init?.body)) as ChatCallBody);
    return Promise.resolve({ ok: true, body: openSseBody() } as unknown as Response);
  }
  return Promise.resolve(jsonResponse({}));
});

beforeAll(() => {
  // jsdom 缺口：MessageList 自动滚底 effect 与窄屏判定
  Element.prototype.scrollTo = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false } as MediaQueryList);
});

beforeEach(() => {
  localStorage.clear();
  chatCalls.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("canvas 页：选项卡点击应答（HITL）", () => {
  it("恢复的选项卡可点击：label 作为无引用新方案发送；busy 中按钮禁用不重复发送", async () => {
    renderWithI18n(<ChatPage />);
    // bootstrap：自动选择最近会话并恢复消息（含 present_options 选项卡）
    const pick = await screen.findByRole("button", { name: "促销主图" });
    await userEvent.click(pick);
    await waitFor(() => expect(chatCalls).toHaveLength(1));
    expect(chatCalls[0]).toMatchObject({ sessionId: "s1", message: "促销主图" });
    // 选项应答 = 无引用新方案（不携带画布引用）
    expect(chatCalls[0].referenceAssetIds).toBeUndefined();
    // SSE 未结束（busy 悬置）：选项按钮禁用，二次点击不触发新一轮
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "促销主图" }) as HTMLButtonElement).disabled).toBe(true),
    );
    await userEvent.click(screen.getByRole("button", { name: "促销主图" }));
    expect(chatCalls).toHaveLength(1);
  });
});
