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

/**
 * Radix 的 Trigger 在 pointerdown 里调用 hasPointerCapture/releasePointerCapture 以阻止
 * 浏览器隐式捕获，浮层定位还会建 ResizeObserver —— jsdom 三者都没有，不桩住则点不开。
 */
function stubRadixEnvironment() {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

beforeEach(() => {
  stubMatchMedia(false);
  stubRadixEnvironment();
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


/** 导航树内携带当前位置标记的行数（一级列 + 抽屉内二级项，合计唯一）。铃铛在 nav 之外。 */
function navCurrentCount(): number {
  return document.querySelectorAll('nav [aria-current="page"]').length;
}

function navRow(id: string): HTMLElement {
  return screen.getByTestId(`nav-${id}`);
}

/** 主区容器（<main> 里承载作品集 / 消息中心 / 落地页的那一层，排在 rail 与二级面板之后）。 */
function mainArea(): HTMLElement {
  const main = document.querySelector("main");
  const area = main?.children[2] as HTMLElement | undefined;
  if (!area) throw new Error("找不到主区容器");
  return area;
}

/** 二级面板容器（rail 的兄弟节点，常驻 DOM，靠宽度 0 / inert 表示收起）。 */
function panel(): HTMLElement {
  return screen.getByTestId("home-panel");
}

/** 面板内容（关闭后延迟一个过渡时长才卸载，避免主区回满宽时露出空条）。 */
function panelNav(id: "create" | "library"): HTMLElement {
  return screen.getByTestId(`nav-panel-${id}`);
}

describe("首页落地页", () => {
  it("侧栏 rail 常驻：一级项带可见标签，二级项不在 rail 里", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    // 一级列常驻最左侧，宽度是常量（无折叠态）
    const sidebar = screen.getByTestId("home-sidebar");
    expect(sidebar.className).toContain("w-sidebar-rail");
    expect(sidebar.hasAttribute("data-collapsed")).toBe(false);
    // 可见文字标签 = 可访问名称，不退化为仅 aria-label
    for (const id of ["home", "create", "library"]) {
      expect(navRow(id).textContent).not.toBe("");
    }
    // 二级项不在 rail 里
    for (const id of ["canvas", "layout-design", "portfolio", "assets"]) {
      expect(screen.queryByTestId(`nav-${id}`)).toBeNull();
    }
    // 铃铛入口与用户入口都在
    expect(screen.getByTestId("notifications-bell")).toBeTruthy();
    expect(screen.getByRole("button", { name: "用户菜单" })).toBeTruthy();
  });

  it("激活一级项：展开其二级面板，并落到该组的第一个子项", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    // 图库 → 默认子项是主区视图（作品集）：展开面板并切主区
    await userEvent.click(navRow("library"));
    expect(await screen.findByTestId("nav-panel-library")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("作品集还是空的")).toBeTruthy());
    expect(push).not.toHaveBeenCalledWith("/portfolio");

    // 创作 → 换成创作自己的面板（单开）
    await userEvent.click(navRow("create"));
    expect(await screen.findByTestId("nav-panel-create")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("nav-panel-library")).toBeNull());
  });

  it("激活一级项不跳转：默认子项是整页路由时只展开面板", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    // 一级行不再是链接：没有任何 href
    for (const id of ["home", "create", "library"]) {
      expect(navRow(id).tagName).toBe("BUTTON");
      expect(navRow(id).hasAttribute("href")).toBe(false);
    }

    await userEvent.click(navRow("create"));
    // 面板展开了，但没被带离 /home —— 否则用户看不到第二级（排版设计）
    expect(await screen.findByTestId("nav-panel-create")).toBeTruthy();
    expect(screen.getByText("用一句话，生成电商好图")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(navRow("create").hasAttribute("href")).toBe(false);
  });

  it("激活无子项的一级项：收起面板并回落地页", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    await userEvent.click(navRow("library"));
    await screen.findByTestId("nav-panel-library");
    await waitFor(() => expect(screen.getByText("作品集还是空的")).toBeTruthy());

    await userEvent.click(navRow("home"));
    expect(await screen.findByText("用一句话，生成电商好图")).toBeTruthy();
    expect(panel().className).toContain("w-0");
    // 面板内容延迟一个过渡时长才卸载，避免主区回满宽时露出空条
    await waitFor(() => expect(panel().hasAttribute("inert")).toBe(true));
  });

  it("排版设计：面板内二级项开尺寸弹窗，面板保持展开", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    await userEvent.click(navRow("create"));
    await screen.findByTestId("nav-panel-create");

    const designBtn = within(panelNav("create")).getByTestId(
      "nav-layout-design",
    ) as HTMLButtonElement;
    expect(designBtn.disabled).toBe(false);
    await userEvent.click(designBtn);
    expect(await screen.findByText("新建设计")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // 激活二级项后面板保持展开（推挤式下每次选择都收起会让主区宽度反复跳变）
    expect(panel().className).toContain("w-sidebar-drawer");
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

  it("作品集：面板内二级项切主区视图，面板保持展开", async () => {
    renderWithI18n(<HomePage />);
    expect(await screen.findByText("用一句话，生成电商好图")).toBeTruthy();

    await userEvent.click(navRow("library"));
    const nav = await screen.findByTestId("nav-panel-library");
    await userEvent.click(within(nav).getByTestId("nav-portfolio"));
    await waitFor(() => expect(screen.getByText("作品集还是空的")).toBeTruthy());
    // 切换到作品集面板：横幅消失
    expect(screen.queryByText("用一句话，生成电商好图")).toBeNull();
    expect(push).not.toHaveBeenCalledWith("/portfolio");
    expect(panel().className).toContain("w-sidebar-drawer");
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
});

/**
 * 一级列 + 并排二级面板的结构不变量（spec home-landing「一级列与二级面板结构」
 * 「一级项展开面板并落到默认子项」「二级面板的开合约束」「当前位置的委托标记」）。
 * jsdom 无布局引擎，故锁的是能断言的结构事实：面板是不是 rail 的兄弟节点、
 * 是否被移出可访问性树、宽度类与 inert 的开合、当前标记的唯一性。
 */
describe("一级列与二级面板", () => {
  it("面板是 rail 的兄弟节点，排在主区之前，且不是浮层", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    const main = document.querySelector("main");
    expect(main).toBeTruthy();
    // 顺序即「推挤」的结构事实：rail | 面板 | 主区，三者是同一个 flex 容器的子节点
    expect(Array.from(main!.children).map((c) => c.getAttribute("data-testid"))).toEqual([
      "home-sidebar",
      "home-panel",
      null,
    ]);
    // 覆盖层必须靠 absolute/fixed 脱流；面板两者都没有，故它必然占布局宽度
    expect(panel().className).not.toMatch(/\b(absolute|fixed)\b/);
    expect(panel().className).toContain("overflow-hidden");
    expect(panel().className).toContain("transition-[width]");
  });

  it("初始收起：宽度归零 + inert，面板不在可访问性树中", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    expect(panel().className).toContain("w-0");
    expect(panel().className).not.toContain("w-sidebar-drawer");
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(panel().getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByTestId("nav-panel-library")).toBeNull();
    expect(screen.queryByTestId("nav-panel-create")).toBeNull();
  });

  it("展开后：宽度切换、inert 移除、内容挂载且是独立命名地标", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    await userEvent.click(navRow("library"));

    await screen.findByTestId("nav-panel-library");
    expect(panel().className).toContain("w-sidebar-drawer");
    expect(panel().className).not.toContain("w-0");
    expect(panel().hasAttribute("inert")).toBe(false);

    expect(within(panelNav("library")).getByTestId("nav-portfolio")).toBeTruthy();
    expect(within(panelNav("library")).getByTestId("nav-assets")).toBeTruthy();
    // 二级项不与一级项共列：面板里是另一个 nav 地标，且名字不同
    const nav = within(panel()).getByRole("navigation", { name: "图库的二级导航" });
    expect(within(nav).queryByTestId("nav-library")).toBeNull();
  });

  it("一级行内只有一个可激活目标", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    // 没有展开控件这种东西了：一级行的激活目标就是它自己
    for (const id of ["home", "create", "library"]) {
      expect(screen.queryByTestId(`nav-expand-${id}`)).toBeNull();
      // 行内不嵌套任何可激活元素（也不会出现 button 套 button）
      expect(navRow(id).querySelectorAll("a, button").length).toBe(0);
    }
    // 有子项的一级行：整行容器里只有它自己一个目标
    for (const id of ["create", "library"]) {
      const container = navRow(id).parentElement as HTMLElement;
      expect(container.querySelectorAll("a, button").length).toBe(1);
    }
  });

  it("顶部开关按钮是面板的全局开合：带 aria-expanded，收起再打开恢复上次那一组", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    const toggle = screen.getByTestId("sidebar-panel-toggle");

    // 初始收起
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("展开二级导航");
    expect(toggle.getAttribute("aria-controls")).toBe("home-l2-panel");
    expect(panel().hasAttribute("inert")).toBe(true);

    // 打开：当前视图无所属组 → 打开第一组
    await userEvent.click(toggle);
    expect(await screen.findByTestId("nav-panel-create")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("收起二级导航");
    expect(screen.getByText("用一句话，生成电商好图")).toBeTruthy();

    // 切到图库组再收起：重新打开应恢复图库，而不是回到第一组
    await userEvent.click(navRow("library"));
    await screen.findByTestId("nav-panel-library");
    await userEvent.click(toggle);
    await waitFor(() => expect(panel().hasAttribute("inert")).toBe(true));
    await userEvent.click(toggle);
    expect(await screen.findByTestId("nav-panel-library")).toBeTruthy();
  });

  it("单开不变量：切到另一组时其面板收起", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    await userEvent.click(navRow("create"));
    await screen.findByTestId("nav-panel-create");
    await userEvent.click(navRow("library"));
    expect(await screen.findByTestId("nav-panel-library")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("nav-panel-create")).toBeNull());
  });

  it("重复激活同一一级项不收起面板", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    await userEvent.click(navRow("library"));
    await screen.findByTestId("nav-panel-library");
    await userEvent.click(navRow("library"));
    expect(panel().className).toContain("w-sidebar-drawer");
    expect(screen.getByTestId("nav-panel-library")).toBeTruthy();
  });

  it("点一级项立即高亮该组：tile 亮、面板内默认子项带 aria-current", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    expect(navRow("home").querySelector(".bg-primary")).toBeTruthy();
    expect(navRow("create").querySelector(".bg-primary")).toBeNull();

    // 创作：主区仍是落地页，但创作的 tile 必须亮起来
    await userEvent.click(navRow("create"));
    const nav = await screen.findByTestId("nav-panel-create");
    expect(navRow("create").querySelector(".bg-primary")).toBeTruthy();
    expect(navRow("home").querySelector(".bg-primary")).toBeNull();
    // aria-current 落在面板内的默认子项，不在一级行上
    expect(within(nav).getByTestId("nav-canvas").getAttribute("aria-current")).toBe("page");
    expect(navRow("create").hasAttribute("aria-current")).toBe(false);
    expect(navCurrentCount()).toBe(1);

    // 回到首页：选择清空，落点交回主区视图
    await userEvent.click(navRow("home"));
    await waitFor(() => expect(navRow("home").querySelector(".bg-primary")).toBeTruthy());
    expect(navRow("create").querySelector(".bg-primary")).toBeNull();
    expect(navRow("home").getAttribute("aria-current")).toBe("page");
  });

  it("当前位置唯一：面板未展开时由一级项代行", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    expect(navRow("home").getAttribute("aria-current")).toBe("page");
    expect(navCurrentCount()).toBe(1);

    await userEvent.click(navRow("library"));
    await waitFor(() => expect(screen.getByText("作品集还是空的")).toBeTruthy());
    await userEvent.click(navRow("home"));
    await waitFor(() => expect(screen.getByText("用一句话，生成电商好图")).toBeTruthy());
    await waitFor(() => expect(panel().hasAttribute("inert")).toBe(true));
    expect(navRow("library").getAttribute("aria-current")).toBeNull();
    expect(navCurrentCount()).toBe(1);
  });

  it("当前位置唯一：面板展开时标记面板内的二级项", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    await userEvent.click(navRow("library"));
    const nav = await screen.findByTestId("nav-panel-library");
    await waitFor(() => expect(screen.getByText("作品集还是空的")).toBeTruthy());

    expect(within(nav).getByTestId("nav-portfolio").getAttribute("aria-current")).toBe("page");
    expect(navRow("library").getAttribute("aria-current")).toBeNull();
    expect(navCurrentCount()).toBe(1);
  });

  it("占位项在面板内置灰，且不改变主区", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");
    await userEvent.click(navRow("library"));
    const nav = await screen.findByTestId("nav-panel-library");

    const assets = within(nav).getByTestId("nav-assets") as HTMLButtonElement;
    expect(assets.disabled).toBe(true);
    expect(assets.getAttribute("aria-disabled")).toBe("true");
    expect(assets.getAttribute("title")).toBe("敬请期待");
    await userEvent.click(assets);
    expect(assets.disabled).toBe(true);
    expect(screen.getByText("作品集还是空的")).toBeTruthy();
  });

  it("切面板开合不重渲染主区：主区仍是同一个 DOM 节点", async () => {
    renderWithI18n(<HomePage />);
    const headline = await screen.findByText("用一句话，生成电商好图");
    const area = mainArea();

    // 用快捷键开合：它只动面板，不触发一级项的「落到默认子项」导航
    fireEvent.keyDown(window, { ctrlKey: true, key: "b" });
    await screen.findByTestId("nav-panel-create");
    expect(screen.getByText("用一句话，生成电商好图")).toBe(headline);
    expect(mainArea()).toBe(area);

    fireEvent.keyDown(window, { ctrlKey: true, key: "b" });
    await waitFor(() => expect(panel().hasAttribute("inert")).toBe(true));
    expect(mainArea()).toBe(area);
  });
});

/** spec home-landing「构建版本徽标的位置」+ design D8：偏好入口从底栏收进用户菜单。 */
describe("rail 底栏与偏好入口", () => {
  it("底栏只留铃铛与头像两个控件", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    const footer = screen.getByTestId("sidebar-footer");
    const buttons = within(footer).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(screen.getByTestId("notifications-bell")).toBeTruthy();
    expect(screen.getByRole("button", { name: "用户菜单" })).toBeTruthy();
    // 主题 / 语言 / 设置不再常驻底栏
    expect(within(footer).queryByRole("button", { name: "切换语言" })).toBeNull();
    expect(screen.queryByTestId("nav-settings")).toBeNull();
  });

  it("品牌与构建版本只在二级面板里；一级列不带它们", async () => {
    renderWithI18n(<HomePage />);
    const sidebar = await screen.findByTestId("home-sidebar");
    // 一级列顶部只有面板开关
    expect(within(sidebar).queryByText("oops")).toBeNull();
    expect(within(sidebar).queryByTestId("app-version-badge")).toBeNull();

    await userEvent.click(navRow("library"));
    await screen.findByTestId("nav-panel-library");
    expect(within(panelNav("library")).getByText("oops")).toBeTruthy();
    const badge = within(panelNav("library")).getByTestId("app-version-badge");
    expect(badge.textContent).toContain(APP_VERSION);
    expect(badge.textContent).toContain("构建版本");
  });
});

describe("Cmd/Ctrl+B 显隐二级层（design D10）", () => {
  it("开合二级面板；在输入框内打字时不劫持", async () => {
    renderWithI18n(<HomePage />);
    const input = await screen.findByLabelText("消息输入");

    fireEvent.keyDown(window, { ctrlKey: true, key: "b" });
    expect(await screen.findByTestId("nav-panel-create")).toBeTruthy();

    fireEvent.keyDown(window, { ctrlKey: true, key: "b" });
    await waitFor(() => expect(panel().hasAttribute("inert")).toBe(true));

    // 输入态：组合键属于用户文本，不得显隐二级层
    fireEvent.keyDown(input, { ctrlKey: true, key: "b" });
    expect(panel().hasAttribute("inert")).toBe(true);

    fireEvent.keyDown(window, { key: "b" });
    expect(panel().hasAttribute("inert")).toBe(true);
  });

  it("面板关闭时按快捷键开当前视图所属组的面板", async () => {
    renderWithI18n(<HomePage />);
    await screen.findByTestId("nav-home");

    // 先落到作品集（图库组），再用快捷键收起面板 —— 视图不变，仍属图库
    await userEvent.click(navRow("library"));
    await waitFor(() => expect(screen.getByText("作品集还是空的")).toBeTruthy());
    fireEvent.keyDown(window, { metaKey: true, key: "b" });
    await waitFor(() => expect(panel().hasAttribute("inert")).toBe(true));

    fireEvent.keyDown(window, { metaKey: true, key: "b" });
    expect(await screen.findByTestId("nav-panel-library")).toBeTruthy();
  });
});

describe("窄屏（<768px）侧栏", () => {
  it("侧栏离开文档流，浮动按钮唤出覆盖抽屉", async () => {
    stubMatchMedia(true);
    renderWithI18n(<HomePage />);

    await screen.findByTestId("sidebar-open-button");
    expect(screen.queryByTestId("home-sidebar")).toBeNull();

    await userEvent.click(screen.getByTestId("sidebar-open-button"));
    expect(await screen.findByTestId("nav-home")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("nav-home")).toBeNull());
  });

  it("平铺全部层级（无展开控件、不叠浮层），切主区视图后自动收起", async () => {
    stubMatchMedia(true);
    renderWithI18n(<HomePage />);
    await screen.findByTestId("sidebar-open-button");
    await userEvent.click(screen.getByTestId("sidebar-open-button"));

    const drawerNav = await screen.findByRole("navigation", { name: "主导航" });
    // 窄屏没有可展开的面板：一级项降级为分组标题，只剩二级项可点
    expect(within(drawerNav).getByTestId("nav-group-create")).toBeTruthy();
    expect(within(drawerNav).getByTestId("nav-group-library")).toBeTruthy();
    for (const id of ["create", "library"]) {
      expect(within(drawerNav).queryByTestId(`nav-${id}`)).toBeNull();
    }
    for (const id of ["canvas", "layout-design", "portfolio", "assets"]) {
      expect(within(drawerNav).getByTestId(`nav-${id}`)).toBeTruthy();
    }
    // 顶部开关按钮在窄屏无意义（没有常驻面板可开合）
    expect(screen.queryByTestId("sidebar-panel-toggle")).toBeNull();
    // 模态 sheet 内不能叠 portaled 浮层
    expect(document.querySelector("[data-slot='popover-content']")).toBeNull();
    expect(screen.queryByTestId("home-panel")).toBeNull();

    await userEvent.click(within(drawerNav).getByTestId("nav-portfolio"));
    expect(await screen.findByText("作品集还是空的")).toBeTruthy();
    expect(screen.queryByTestId("nav-home")).toBeNull();
  });

  it("抽屉开着时把窗口拉回桌面：改走常驻侧栏，开合态不残留", async () => {
    const mql = stubMatchMedia(true);
    renderWithI18n(<HomePage />);
    await screen.findByTestId("sidebar-open-button");
    await userEvent.click(screen.getByTestId("sidebar-open-button"));
    expect(await screen.findByTestId("nav-home")).toBeTruthy();

    mql.setMatches(false);
    await waitFor(() => expect(screen.getByTestId("home-sidebar")).toBeTruthy());
    expect(screen.queryByTestId("sidebar-open-button")).toBeNull();
    // 面板状态属于桌面分支，不因视口变化凭空打开
    expect(panel().className).toContain("w-0");

    // 再次缩窄时抽屉应为关闭态，不能凭空自动打开
    mql.setMatches(true);
    await waitFor(() => expect(screen.getByTestId("sidebar-open-button")).toBeTruthy());
    expect(screen.queryByTestId("nav-home")).toBeNull();
  });
});
