import type { ThemeConfig } from "antd";

/**
 * antd 主题 token 映射（docs/DESIGN.md B7.6）。
 *
 * admin 不消费 Tailwind，与 web 的视觉一致性只能靠这份显式映射维持；
 * 改品牌色必须双落：apps/web/src/app/globals.css + 此文件，
 * theme.test.ts 会断言两侧同值，分叉会直接变红。
 */
export const ANTD_THEME_TOKEN: NonNullable<ThemeConfig["token"]> = {
  colorPrimary: "#7d2ae8", // = --brand-violet-500
  colorInfo: "#00c4cc", // = --brand-cyan-500；仅链接/信息用，禁作文字色（B2.4）
  colorSuccess: "#00b894",
  colorWarning: "#ffb020",
  colorError: "#e5484d", // 语义红独立于品牌色（B2.3）
  borderRadius: 10, // = --radius（0.625rem）
  // admin 不装载 Geist、也无 Tailwind 变量，var(--font-sans) 在此无效；
  // 用与 web 正文回退栈一致的 CJK 系统栈（B3.2）。
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
};
