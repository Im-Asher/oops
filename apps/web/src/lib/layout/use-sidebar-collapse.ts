"use client";

import { useCallback, useEffect, useState } from "react";

/** 存储键沿用 theme-provider 的 oops-* 前缀风格。 */
const SIDEBAR_KEY = "oops-sidebar-collapsed";

/** 与 globals.css 的 md: 断点同阈（768px）。用 max-width 而非 min-width，
 *  使首帧（尚未收到 change 事件）就能直接读到窄屏结论。 */
const NARROW_QUERY = "(max-width: 767.98px)";

/** 正在接收文本输入的容器：在其中按 Cmd/Ctrl+B 应打出字符而非折叠侧栏。 */
const TYPING_SURFACE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export interface SidebarCollapseState {
  /** 窄屏（<768px）：侧栏离开文档流，以覆盖式抽屉呈现。初值 false（桌面），
   *  使 SSR 首帧与桌面一致——移动端首帧渲染的是被移出视口的 aside，不会闪现。 */
  isNarrow: boolean;
  /** 桌面折叠态；已持久化到本地存储。 */
  collapsed: boolean;
  /** 窄屏抽屉开合。瞬时状态，不持久化。 */
  drawerOpen: boolean;
  /** 折叠/展开（桌面）或开合抽屉（窄屏）：同一快捷键在两种视口下都是「显隐侧栏」。 */
  toggle: () => void;
  setDrawerOpen: (open: boolean) => void;
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  } catch {
    // 存储不可用（隐私模式等）时折叠仅在当前会话生效，与 theme-provider 一致
  }
}

/**
 * 侧栏的可见性状态与浏览器副作用（DESIGN.md B7.2）：
 * 桌面在展开/折叠两态间切换、窄屏切为覆盖抽屉，折叠态跨刷新保持。
 *
 * 位置与宽度本身由 CSS 响应式类表达，此处只持有状态——折叠因此只重渲染侧栏子树，
 * 主区（composer / 作品集 / 消息中心）不参与。
 */
export function useSidebarCollapse(): SidebarCollapseState {
  const [isNarrow, setIsNarrow] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    // 首帧固定为展开态（与初始 HTML 一致，无水合偏差）；挂载后订阅存储的初值
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readStoredCollapsed());
  }, []);

  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY);
    if (mql.matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsNarrow(true);
    }
    const onChange = (event: MediaQueryListEvent) => {
      setIsNarrow(event.matches);
      // 回到桌面态时抽屉不再承载导航；残留的 open 会让下次缩窄时凭空自动打开
      if (!event.matches) setDrawerOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // 写在事件处理器而非 state updater 内：updater 在 StrictMode 下会被重放，
  // 副作用放进去不纯。collapsed 进依赖数组保证读到的是最新值。
  const toggle = useCallback(() => {
    if (isNarrow) {
      setDrawerOpen((prev) => !prev);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    writeStoredCollapsed(next);
  }, [collapsed, isNarrow]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b") return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // target 未必是 Element（事件挂在 window/document 上时就是），故先做类型收敛
      const target = event.target;
      if (target instanceof Element && target.closest(TYPING_SURFACE)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return { collapsed, drawerOpen, isNarrow, setDrawerOpen, toggle };
}