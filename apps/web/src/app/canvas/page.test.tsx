// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render-with-i18n";
import ChatPage from "./page";

// 画布重子件以 stub 替代（本文件只验证聊天链路：bootstrap → 会话引导 → 选项卡应答）
vi.mock("@/components/canvas/canvas-stage", () => ({ CanvasStage: () => null }));
// 会话列表 stub：渲染可点击的会话项（历史会话按需打开的验证面）
vi.mock("@/components/chat/session-sidebar", () => ({
  SessionSidebar: ({
    onSelectSession,
    sessions,
  }: {
    onSelectSession: (id: string) => void;
    sessions: { id: string; title: string }[];
  }) => (
    <ul>
      {sessions.map((s) => (
        <li key={s.id}>
          <button onClick={() => onSelectSession(s.id)} type="button">
            {s.title}
          </button>
        </li>
      ))}
    </ul>
  ),
}));
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

interface SessionRow {
  id: string;
  agentId?: string | null;
  title: string;
  updatedAt: string;
}

/** 可变服务端状态：会话列表 / 建会话失败注入（按次消耗）。 */
let sessionsList: SessionRow[] = [];
let createFailures = 0;
const createCalls: { agentId?: string }[] = [];
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
    return Promise.resolve(jsonResponse({ sessions: sessionsList }));
  }
  if (url === "/api/sessions" && init?.method === "POST") {
    if (createFailures > 0) {
      createFailures -= 1;
      return Promise.resolve({ ok: false, status: 500 } as unknown as Response);
    }
    const body = JSON.parse(String(init.body)) as { agentId?: string };
    createCalls.push(body);
    const created: SessionRow = {
      id: `s-new-${createCalls.length}`,
      agentId: body.agentId ?? "poster-designer",
      title: "N",
      updatedAt: new Date().toISOString(),
    };
    sessionsList = [created, ...sessionsList];
    return Promise.resolve(jsonResponse(created));
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
  sessionsList = [
    { id: "s1", agentId: "poster-designer", title: "T", updatedAt: new Date().toISOString() },
  ];
  createFailures = 0;
  createCalls.length = 0;
  chatCalls.length = 0;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** 打开时钟下拉并选择指定标题的会话（历史会话按需打开）。 */
async function openHistoryAndSelect(title: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "会话历史" }));
  await userEvent.click(await screen.findByRole("button", { name: title }));
}

describe("canvas 页：会话引导 bootstrap", () => {
  it("有历史会话进入仍开新会话，不自动打开历史会话", async () => {
    renderWithI18n(<ChatPage />);
    // 进入即建会话（spec「进入画布即开新会话」）：不预选 s1，也不拉它的消息
    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toEqual({ agentId: "poster-designer" });
    // 会话列表仍被拉取（供时钟下拉使用）
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/sessions")).toBe(true);
    // s1 的消息未恢复：选项卡不存在
    expect(screen.queryByRole("button", { name: "促销主图" })).toBeNull();
  });

  it("历史会话可从时钟下拉打开并恢复消息", async () => {
    renderWithI18n(<ChatPage />);
    await waitFor(() => expect(createCalls).toHaveLength(1));
    await openHistoryAndSelect("T");
    // 按需打开历史会话：消息与选项卡恢复
    await screen.findByRole("button", { name: "促销主图" });
    expect(createCalls).toHaveLength(1);
  });

  it("无会话进入自动建会话（等 agents 回包取首个 Agent），输入框可用", async () => {
    sessionsList = [];
    renderWithI18n(<ChatPage />);
    // 初始无会话：输入框禁用
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    // bootstrap 后自动建会话，agentId 取 /api/agents 首个
    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toEqual({ agentId: "poster-designer" });
    // 新会话落地：输入框可用
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false),
    );
  });

  it("自动建会话失败呈现错误行 + 重试入口，重试成功后输入可用", async () => {
    sessionsList = [];
    createFailures = 1;
    renderWithI18n(<ChatPage />);
    // 首次 POST 失败：状态行报错并给重试按钮
    const retry = await screen.findByRole("button", { name: "重试" });
    expect(createCalls).toHaveLength(0);
    expect(screen.getByTestId("chat-status-line").textContent).toContain("会话创建失败");
    // 点击重试：第二次 POST 成功
    await userEvent.click(retry);
    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toEqual({ agentId: "poster-designer" });
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(false),
    );
  });
});

describe("canvas 页：会话下拉不含身份区块", () => {
  it("打开下拉只有会话项，无个人信息 / 退出登录", async () => {
    renderWithI18n(<ChatPage />);
    await waitFor(() => expect(createCalls).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "会话历史" }));
    expect(await screen.findByRole("button", { name: "T" })).toBeTruthy();
    // 身份入口已迁至悬浮顶栏头像（spec/session-management「会话列表」）
    expect(screen.queryByRole("link", { name: "个人信息" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "退出登录" })).toBeNull();
  });
});

describe("canvas 页：选项卡点击应答（HITL）", () => {
  it("恢复的选项卡可点击：label 作为无引用新方案发送；busy 中按钮禁用不重复发送", async () => {
    renderWithI18n(<ChatPage />);
    // 先经时钟下拉打开历史会话 s1，恢复其消息（含 present_options 选项卡）
    await waitFor(() => expect(createCalls).toHaveLength(1));
    await openHistoryAndSelect("T");
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

describe("canvas 页：聊天面板宽度可调", () => {
  /** 以 MouseEvent 模拟 pointer 事件（jsdom 未实现 PointerEvent，但 React 按 type 派发）。 */
  function dispatchPointer(target: EventTarget, type: string, clientX: number) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX }));
  }

  it("渲染右侧拖拽手柄（separator），初始宽度变量为默认 340px", async () => {
    renderWithI18n(<ChatPage />);
    await waitFor(() => expect(createCalls).toHaveLength(1));
    const handle = screen.getByTestId("chat-resize-handle");
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    const container = screen.getByTestId("chat-panel-container");
    expect(container.style.getPropertyValue("--chat-width")).toBe("340px");
  });

  it("拖拽手柄向右改变宽度（未触顶时实时更新）", async () => {
    renderWithI18n(<ChatPage />);
    await waitFor(() => expect(createCalls).toHaveLength(1));
    const handle = screen.getByTestId("chat-resize-handle");
    const container = screen.getByTestId("chat-panel-container");
    // 默认窗口 1024，上限 512；向右拖 100px：340 -> 440
    dispatchPointer(handle, "pointerdown", 0);
    dispatchPointer(window, "pointermove", 100);
    await waitFor(() =>
      expect(container.style.getPropertyValue("--chat-width")).toBe("440px"),
    );
    dispatchPointer(window, "pointerup", 100);
  });

  it("窗口缩窄使半屏上限小于当前宽度时，宽度被钳制到上限", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    renderWithI18n(<ChatPage />);
    await waitFor(() => expect(createCalls).toHaveLength(1));
    const handle = screen.getByTestId("chat-resize-handle");
    const container = screen.getByTestId("chat-panel-container");
    // 挂载即钳制：默认 340 > 上限 300 -> 300
    await waitFor(() =>
      expect(container.style.getPropertyValue("--chat-width")).toBe("300px"),
    );
    // 继续右拖远超上限，仍被钳制在 300
    dispatchPointer(handle, "pointerdown", 0);
    dispatchPointer(window, "pointermove", 1000);
    await waitFor(() =>
      expect(container.style.getPropertyValue("--chat-width")).toBe("300px"),
    );
    dispatchPointer(window, "pointerup", 1000);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
  });
});
