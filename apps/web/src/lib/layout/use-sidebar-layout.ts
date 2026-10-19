"use client";

import { useEffect, useRef, useState } from "react";

/** 与 globals.css 的 md: 断点同阈（768px）。用 max-width 而非 min-width，
 *  使首帧（尚未收到 change 事件）就能直接读到窄屏结论。 */
const NARROW_QUERY = "(max-width: 767.98px)";

/** 正在接收文本输入的容器：在其中按 Cmd/Ctrl+B 应打出字符而非显隐二级层。 */
const TYPING_SURFACE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export interface SidebarLayoutState {
  /** 窄屏（<768px）：侧栏离开文档流，以覆盖式抽屉呈现。初值 false（桌面），
   *  使 SSR 首帧与桌面一致——移动端首帧渲染的是被移出视口的 aside，不会闪现。 */
  isNarrow: boolean;
  /** 窄屏覆盖抽屉开合。瞬时状态，不持久化。 */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
}

/**
 * 窄屏侧栏的可见性状态（DESIGN.md B7.2.5）。
 *
 * 桌面侧栏恒为常驻的一级列（rail）+ 并排的二级面板，没有折叠态，故本模块**不再**持有
 * 宽度状态、也不再读写任何 localStorage —— 二级面板的开合由侧栏组件自己持有
 * （design D9）。位置与宽度本身由 CSS 响应式类表达，此处只持有窄屏抽屉状态。
 */
export function useSidebarLayout(): SidebarLayoutState {
  const [isNarrow, setIsNarrow] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const toggleDrawer = () => setDrawerOpen((prev) => !prev);

  return { drawerOpen, isNarrow, setDrawerOpen, toggleDrawer };
}

/**
 * `Cmd/Ctrl+B` 显隐二级层（design D10）：窄屏开合覆盖抽屉，桌面开合二级面板。
 * 调用方决定「显隐」的具体含义 —— 本模块只负责组合键与「输入态不劫持」这条守卫。
 *
 * 回调走 ref 而非依赖数组：调用方每次渲染都会给出新闭包，直接进依赖会让监听器
 * 每渲染重挂一次；渲染期写 ref 又不被 React 认可，故在 effect 里同步。
 */
export function useSidebarDisclosureHotkey(toggle: () => void) {
  const latest = useRef(toggle);

  useEffect(() => {
    latest.current = toggle;
  }, [toggle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b") return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // target 未必是 Element（事件挂在 window/document 上时就是），故先做类型收敛
      const target = event.target;
      if (target instanceof Element && target.closest(TYPING_SURFACE)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
