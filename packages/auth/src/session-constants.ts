/**
 * Edge-safe 会话常量（proxy.ts 可引用）：本模块 MUST NOT 引入任何 node:* 依赖。
 * 全量校验用的 crypto 逻辑在 session-cookie.ts（Node 运行时专属）。
 */
export const SESSION_COOKIE_NAME = "oops_session";
/** 30 天固定有效期，不滑动（design D5） */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * 管理端会话 cookie 名。**与 web 端不同名是硬要求而非洁癖**：同 host / 父域部署时
 * 浏览器按名区分 cookie，web 端会话不会被管理端认下——否则只加登录页也会因浏览器
 * 自动携带而退回免登录，且行为随部署形态变化（design D2）。
 */
export const ADMIN_SESSION_COOKIE_NAME = "oops_admin_session";
