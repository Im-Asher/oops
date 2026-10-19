// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { takePendingHandoffFiles } from "@/lib/chat/home-handoff";
import { APP_VERSION } from "@/lib/version";
import { renderWithI18n } from "@/test/render-with-i18n";
import HomePage from "./page";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const AGENTS = {
  agents: [
    {
      id: "product-photographer",
      name: "产品摄影师",
      description: "电商主图与摆拍",
      icon: "📸",
      presets: [],
      tools: [],
    },
    {
      id: "atmosphere-designer",
      name: "氛围图设计师",
      description: "场景与氛围图",
      icon: "🌄",
      presets: [],
      tools: [],
    },
  ],
};

const SIDEBAR_KEY = "oops-sidebar-collapsed";

/** 显式桩住 matchMedia：jsdom 不做媒体查询求值，桌面/窄屏两条分支需各自可控。 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    addListener: () => {},
    dispatchEvent: () => false,
    matches,
    media: "(max-width: 767.98px)",
    onchange: null,
    removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
    removeListener: () => {},
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => (query === mql.media ? mql : { ...mql, matches: false })),
  );
  return {
    /** 模拟用户拖动窗口跨过 768px */
    setMatches(next: boolean) {
      mql.matches = next;
      act(() => {
        listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent));
      });
    },
  };
}

beforeEach(() => {
  stubMatchMedia(false);
  // 折叠态跨刷新保持，用例间必须隔离，否则后一条会读到前一条的落盘值
  localStorage.clear();
  // 路由感知桩：仅 /api/agents 返回列表，其余接口按空数据处理
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/agents") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(AGENTS) });
      }
      if (url.startsWith("/api/assets")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [], nextCursor: null }),
        });
      }
      // 消息中心列表：空；铃铛未读数：0
      if (url.startsWith("/api/notifications?")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [], total: 0 }),
        });
      }
      if (url.includes("/api/notifications/unread-count")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ unreadCount: 0 }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(null) });
    }),
  );
  takePendingHandoffFiles();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function imageFile(name: string): File {
  return new File(["data"], name, { type: "image/png" });
}

/** 切换一级组的展开态（单开：展开一个即收起另一个）。 */
async function toggleGroup(id: "create" | "library") {
  await userEvent.click(screen.getByTestId(`nav-${id}`));
}

/** 导航树内携带当前位置标记的行数。铃铛在 nav 之外，不计入。 */
function navCurrentCount(): number {
  return document.querySelectorAll('nav [aria-current="page"]').length;
}

function navRow(id: string): HTMLElement {
  return screen.getByTestId(`nav-${id}`);
}

describe("首页落地页", () => {
  it("侧栏两级结构：AI 画布/排版设计可用，素材库置灰；作品集切主区视图", async () => {
    renderWithI18n(<HomePage />);
    const canvasLink = await screen.findByTestId("nav-canvas");
    expect(canvasLink.getAttribute("href")).toBe("/canvas");
    // 竖排改造后标签包在内层 span 里，按钮语义只能经 testid 取
    const designBtn = screen.getByTestId("nav-layout-design") as HTMLButtonElement;
    expect(designBtn.disabled).toBe(false);
    await userEvent.click(designBtn);
    expect(await screen.findByText("新建设计")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // 图库组默认收起，展开后素材库仍是置灰占位
    await toggleGroup("library");
    expect((screen.getByTestId("nav-assets") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("nav-settings") as HTMLButtonElement).disabled).toBe(true);
    // 铃铛入口常驻侧栏底栏
    expect(screen.getByTestId("notifications-bell")).toBeTruthy();
    // 用户入口（头像触发）可达
    expect(screen.getByRole("button", { name: "用户菜单" })).toBeTruthy();
    // 语言切换入口与主题切换并列（双入口之一）
    expect(screen.getByRole("button", { name: "切换语言" })).toBeTruthy();
  });

  it("消息中心：不在导航树内，铃铛是唯一入口并承担当前位置标记", async () => {
    renderWithI18n(<HomePage />);
    expect(await screen.findByText("用一句话，生成电商好图")).toBeTruthy();

    // 导航树里没有消息中心项：铃铛承担入口（spec home-landing）
    expect(screen.queryByTestId("nav-messages")).toBeNull();
    const bell = screen.getByTestId("notifications-bell");
    expect(bell.getAttribute("aria-current")).toBeNull();

    await userEvent.click(bell);
    expect(await screen.findByText("还没有任何消息")).toBeTruthy();
    expect(screen.queryByText("用一句话，生成电商好图")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    // 当前位置由铃铛指示；导航行此时不应有任何 current 标记
    expect(bell.getAttribute("aria-current")).toBe("page");
    expect(navCurrentCount()).toBe(0);
    // 同一份状态：视图内未读数为 0 时铃铛也不带角标
    expect(screen.queryByTestId("notifications-bell-count")).toBeNull();
  });

  it("作品集：图库组二级项切主区视图，不跳独立路由", async () => {
    renderWithI18n(<HomePage />);
    // 默认视图是创作落地页，默认展开的是创作组
    expect(await screen.findByText("用一句话，生成电商好图")).toBeTruthy();
    expect(navRow("create").getAttribute("aria-expanded")).toBe("true");

    await toggleGroup("library");
    await userEvent.click(screen.getByTestId("nav-portfolio"));
    // 切换到作品集面板：横幅消失，作品集空态出现
    await waitFor(() => expect(screen.getByText("作品集还是空的")).toBeTruthy());
    expect(screen.queryByText("用一句话，生成电商好图")).toBeNull();
    expect(push).not.toHaveBeenCalledWith("/portfolio");
  });

  it("创作直发：提交携带文本 + send 标记跳 /canvas（空输入不可提交）", async () => {
    renderWithI18n(<HomePage />);
    const input = await screen.findByLabelText("消息输入");
    // 空输入：发送禁用，回车不跳转
    expect((screen.getByLabelText("发送") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();

    await userEvent.type(input, "为保温杯拍一张主图");
    await userEvent.click(screen.getByLabelText("发送"));
    expect(push).toHaveBeenCalledTimes(1);
    const url = new URL(push.mock.calls[0][0], "http://localhost");
    expect(url.pathname).toBe("/canvas");
    expect(url.searchParams.get("draft")).toBe("为保温杯拍一张主图");
    expect(url.searchParams.get("send")).toBe("1");
    expect(url.searchParams.get("t")).not.toBeNull();
  });

  it("直发乐观态：提交后输入锁定（路由锁），不可重复触发", async () => {
    renderWithI18n(<HomePage />);
    const input = await screen.findByLabelText("消息输入");
    await userEvent.type(input, "为保温杯拍一张主图");
    await userEvent.click(screen.getByLabelText("发送"));
    expect((screen.getByLabelText("消息输入") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByLabelText("发送") as HTMLButtonElement).disabled).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("附件：添加图片出现可移除 chip；非图片与超 5 张被拒绝并提示", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByLabelText("消息输入");
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, {
      target: { files: [imageFile("a.png"), new File(["x"], "b.pdf", { type: "application/pdf" })] },
    });
    expect(screen.getByTestId("composer-pending-files")).toBeTruthy();
    expect(screen.getByText("附件：a.png")).toBeTruthy();
    expect(screen.getByTestId("home-file-error").textContent).toContain("仅支持图片");

    // 移除 chip
    await userEvent.click(screen.getByLabelText("移除附件 a.png"));
    expect(screen.queryByTestId("composer-pending-files")).toBeNull();

    // 超 5 张：第 6 张被拒
    fireEvent.change(fileInput, {
      target: {
        files: [
          imageFile("1.png"),
          imageFile("2.png"),
          imageFile("3.png"),
          imageFile("4.png"),
          imageFile("5.png"),
          imageFile("6.png"),
        ],
      },
    });
    expect(screen.getByTestId("home-file-error").textContent).toContain("最多 5 个附件");
    expect(screen.getAllByText(/^附件：/).length).toBe(5);
  });

  it("携带附件直发：附件经 handoff store 交接给画布侧", async () => {
    renderWithI18n(<HomePage />);
    const input = await screen.findByLabelText("消息输入");
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [imageFile("ref.png")] } });
    await userEvent.type(input, "带参考图生成");
    await userEvent.click(screen.getByLabelText("发送"));
    const handed = takePendingHandoffFiles();
    expect(handed).toHaveLength(1);
    expect(handed[0].name).toBe("ref.png");
  });

  it("侧栏品牌区在 logo 旁展示版本徽标", async () => {
    renderWithI18n(<HomePage />);
    const badge = await screen.findByTestId("app-version-badge");
    expect(badge.textContent).toBe(`v${APP_VERSION}`);
    expect(screen.getByText("oops")).toBeTruthy();
  });
});

/**
 * 两级导航的结构不变量（spec home-landing「侧栏两级导航结构」「展开状态的单开不变量」
 * 「当前所在位置的指示」）。jsdom 无布局引擎，故这里锁的是能断言的结构事实：
 * aria 状态、二级项是否挂载、当前标记的唯一性。
 */
describe("侧栏两级结构", () => {
  it("默认展开创作组：二级项挂载且一级项带 aria-expanded", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-create");

    expect(navRow("create").getAttribute("aria-expanded")).toBe("true");
    expect(navRow("library").getAttribute("aria-expanded")).toBe("false");
    // 创作组的两个二级项在 DOM 里
    expect(screen.getByTestId("nav-canvas")).toBeTruthy();
    expect(screen.getByTestId("nav-layout-design")).toBeTruthy();
    // 图库组收起 → 其二级项不存在
    expect(screen.queryByTestId("nav-portfolio")).toBeNull();
    expect(screen.queryByTestId("nav-assets")).toBeNull();
  });

  it("一级项只切展开态：不导航也不改主区视图", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByText("用一句话，生成电商好图");

    await userEvent.click(navRow("create"));
    expect(navRow("create").getAttribute("aria-expanded")).toBe("false");
    // 主区未变，路由未变
    expect(screen.getByText("用一句话，生成电商好图")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByTestId("nav-canvas")).toBeNull();

    // 再点回来恢复
    await userEvent.click(navRow("create"));
    expect(navRow("create").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("nav-canvas")).toBeTruthy();
  });

  it("单开不变量：展开一组即收起另一组", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-create");

    await toggleGroup("library");
    expect(navRow("library").getAttribute("aria-expanded")).toBe("true");
    expect(navRow("create").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("nav-portfolio")).toBeTruthy();
    expect(screen.queryByTestId("nav-canvas")).toBeNull();
  });

  it("当前标记唯一：首页视图由一级叶子承担", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    expect(navRow("home").getAttribute("aria-current")).toBe("page");
    expect(navCurrentCount()).toBe(1);
    // 展开中的组与其二级项都不带当前标记
    expect(navRow("create").getAttribute("aria-current")).toBeNull();
    expect(navRow("canvas").getAttribute("aria-current")).toBeNull();
  });

  it("所属组收起时由一级项代行当前标记（当前位置不消失）", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-create");
    await toggleGroup("library");
    await userEvent.click(screen.getByTestId("nav-portfolio"));
    await waitFor(() => expect(screen.getByText("作品集还是空的")).toBeTruthy());
    expect(navRow("portfolio").getAttribute("aria-current")).toBe("page");
    expect(navCurrentCount()).toBe(1);

    // 手动收起当前项所属组：二级项消失，一级项接管标记
    await toggleGroup("library");
    expect(screen.queryByTestId("nav-portfolio")).toBeNull();
    expect(navRow("library").getAttribute("aria-current")).toBe("page");
    expect(navRow("library").getAttribute("aria-expanded")).toBe("false");
    expect(navCurrentCount()).toBe(1);
    // 主区仍是作品集，标记没有跟视图脱节
    expect(screen.getByText("作品集还是空的")).toBeTruthy();
  });

  it("展开态在会话内保持：切视图不擅自收起用户打开的组", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-create");
    await toggleGroup("library");

    await userEvent.click(navRow("home"));
    await waitFor(() => expect(screen.getByText("用一句话，生成电商好图")).toBeTruthy());
    expect(navRow("library").getAttribute("aria-expanded")).toBe("true");
  });

  it("占位项两态都禁用：展开态与折叠轨里都是 disabled", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-create");
    await toggleGroup("library");

    const assets = screen.getByTestId("nav-assets") as HTMLButtonElement;
    expect(assets.disabled).toBe(true);
    expect(assets.getAttribute("aria-disabled")).toBe("true");
    expect(assets.getAttribute("title")).toBe("敬请期待");

    await userEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
    const railAssets = screen.getByTestId("nav-assets") as HTMLButtonElement;
    expect(railAssets.disabled).toBe(true);
  });

  it("切展开态不重渲染主区：主区仍是同一个 DOM 节点", async () => {
    renderWithI18n(<HomePage />);
    const headline = await screen.findByText("用一句话，生成电商好图");
    const homeRow = screen.getByTestId("nav-home");

    await toggleGroup("library");
    expect(screen.getByText("用一句话，生成电商好图")).toBe(headline);
    expect(screen.getByTestId("nav-home")).toBe(homeRow);
  });
});

describe("侧栏折叠态（spec home-landing / DESIGN.md B7.2）", () => {
  const sidebar = () => screen.getByTestId("home-sidebar");

  it("默认展开：品牌标识与版本徽标在位，导航项竖排带标签", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    expect(sidebar().getAttribute("data-collapsed")).toBe("false");
    expect(screen.getByTestId("app-version-badge")).toBeTruthy();
    expect(screen.getByText("排版设计")).toBeTruthy();
  });

  it("折叠钮切换：宽度态翻转，标签仍在，品牌标识让位给展开钮", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    await userEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
    expect(sidebar().getAttribute("data-collapsed")).toBe("true");
    // 折叠态保留可见标签，故窄轨下 aria 名与可见文本一致（无 tooltip-only 缺口）
    expect(screen.getByText("排版设计")).toBeTruthy();
    expect(screen.queryByTestId("app-version-badge")).toBeNull();
    expect(screen.queryByText("oops")).toBeNull();

    await userEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
    expect(sidebar().getAttribute("data-collapsed")).toBe("false");
    expect(screen.getByTestId("app-version-badge")).toBeTruthy();
  });

  it("当前项带 aria-current，置灰项两态都仍是 disabled", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    expect(screen.getByTestId("nav-home").getAttribute("aria-current")).toBe("page");
    // 收起的组内二级项不存在，故无从查它的 current 标记
    expect(screen.queryByTestId("nav-portfolio")).toBeNull();

    await toggleGroup("library");
    expect(screen.getByTestId("nav-portfolio").getAttribute("aria-current")).toBeNull();

    // 折叠不改展开态：图库组仍是展开的，占位项在轨内同样 disabled
    await userEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
    for (const id of ["nav-assets", "nav-settings"]) {
      const el = screen.getByTestId(id) as HTMLButtonElement;
      expect(el.disabled).toBe(true);
      expect(el.getAttribute("aria-disabled")).toBe("true");
    }
  });

  /**
   * 回归锁：footer 曾把 5 个控件竖排 + 「设置」当一级导航 tile，footer 从 49px 涨到
   * 224px，把 nav 挤到溢出——Radix 弹层关闭后焦点归位触发浏览器滚动，「首页」被推出
   * 视口，当前位置指示彻底消失。jsdom 无布局引擎，测不出像素高度，故此处锁住产生该
   * 高度的结构性事实：展开态 footer 是「设置图标 + 四个功能图标」同级的图标行，
   * 「设置」不再是带文字标签的导航项。高度预算见 DESIGN.md B7.2.2a。
   */
  it("footer 在两态都是图标控件区：设置不再作为带标签的导航项", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    const settings = screen.getByTestId("nav-settings");
    expect(settings.textContent).toBe("");
    // 可访问名来自 aria-label（设置），不是 title（敬请期待）
    expect(settings.getAttribute("aria-label")).toBe("设置");
    expect(settings.getAttribute("title")).toBe("敬请期待");
    // 「设置」标签只属于 nav 语义，footer 不再重复渲染它
    expect(screen.queryByText("设置")).toBeNull();
    expect(screen.getByTestId("notifications-bell").parentElement).toBe(settings.parentElement);

    // 折叠轨同样是纯图标区（不引入文字标签，64px 轨只够 28px 控件）
    await userEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
    expect((screen.getByTestId("nav-settings") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("设置")).toBeNull();
  });

  it("Cmd/Ctrl+B 切换折叠；在输入框内打字时不劫持", async () => {
    renderWithI18n(<HomePage />);
    const input = await screen.findByLabelText("消息输入");

    fireEvent.keyDown(window, { ctrlKey: true, key: "b" });
    expect(sidebar().getAttribute("data-collapsed")).toBe("true");

    // 输入态：组合键属于用户文本，不得折叠侧栏
    fireEvent.keyDown(input, { ctrlKey: true, key: "b" });
    expect(sidebar().getAttribute("data-collapsed")).toBe("true");

    fireEvent.keyDown(window, { key: "b" });
    expect(sidebar().getAttribute("data-collapsed")).toBe("true");
  });

  it("折叠态落盘并在下次挂载时恢复", async () => {
    const { unmount } = renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    await userEvent.click(screen.getByTestId("sidebar-collapse-toggle"));
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe("1");
    unmount();

    renderWithI18n(<HomePage />);
    await waitFor(() => expect(sidebar().getAttribute("data-collapsed")).toBe("true"));
  });

  it("窄屏：侧栏离开文档流，浮动按钮唤出抽屉，Esc 关闭", async () => {
    stubMatchMedia(true);
    renderWithI18n(<HomePage />);

    await screen.findByTestId("sidebar-open-button");
    expect(screen.queryByTestId("home-sidebar")).toBeNull();

    await userEvent.click(screen.getByTestId("sidebar-open-button"));
    expect(await screen.findByTestId("nav-home")).toBeTruthy();
    // 抽屉内为展开形态：品牌标识在位
    expect(screen.getByTestId("app-version-badge")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("nav-home")).toBeNull());
  });

  it("窄屏抽屉内两级导航可用，切主区视图后自动收起", async () => {
    stubMatchMedia(true);
    renderWithI18n(<HomePage />);
    await screen.findByTestId("sidebar-open-button");
    await userEvent.click(screen.getByTestId("sidebar-open-button"));

    // 抽屉内同样默认展开创作组，可切到图库并选中作品集
    const drawerNav = await screen.findByRole("navigation", { name: "主导航" });
    expect(within(drawerNav).getByTestId("nav-create").getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(screen.getByTestId("nav-library"));
    await userEvent.click(await screen.findByTestId("nav-portfolio"));

    expect(await screen.findByText("作品集还是空的")).toBeTruthy();
    expect(screen.queryByTestId("nav-home")).toBeNull();
  });

  it("抽屉开着时把窗口拉回桌面：改走常驻侧栏，抽屉开合态不残留", async () => {
    const mql = stubMatchMedia(true);
    renderWithI18n(<HomePage />);
    await screen.findByTestId("sidebar-open-button");
    await userEvent.click(screen.getByTestId("sidebar-open-button"));
    expect(await screen.findByTestId("nav-home")).toBeTruthy();

    mql.setMatches(false);
    await waitFor(() => expect(screen.getByTestId("home-sidebar")).toBeTruthy());
    expect(screen.queryByTestId("sidebar-open-button")).toBeNull();

    // 再次缩窄时抽屉应为关闭态，不能凭空自动打开
    mql.setMatches(true);
    await waitFor(() => expect(screen.getByTestId("sidebar-open-button")).toBeTruthy());
    expect(screen.queryByTestId("nav-home")).toBeNull();
  });
});
