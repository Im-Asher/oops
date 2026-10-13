/**
 * Edge-safe 会话常量（proxy.ts 可引用）：本模块 MUST NOT 引入任何 node:* 依赖。
 * 全量校验用的 crypto 逻辑在 session-cookie.ts（Node 运行时专属）。
 */
export const SESSION_COOKIE_NAME = "oops_session";
/** 30 天固定有效期，不滑动（design D5） */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
