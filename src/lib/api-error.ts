/**
 * 服务端错误 { code, message } 的客户端渲染策略（design D5b）：
 * route handler 已返回结构化 `{ error: { code, message } }`，客户端按 code
 * 查 `common.apiErrors` 词典文案；未登记的 code 以服务端 message 兜底。
 * 服务端零改动、code 语义稳定。
 *
 * 未登记 code 及原因：
 * - INVALID_INPUT / INVALID / BAD_REQUEST：zod 动态校验消息，同一 code 下文案不固定；
 * - BLOCKED：内容审核原文（层 B，经 agent 转述）；
 * - UNSUPPORTED_TYPE / TOO_LARGE：服务端 message 携带插值（文件类型/字节数），
 *   客户端以通用文案登记（不含具体数值），避免为插值改服务端结构。
 */

import type { Messages } from "@/i18n/messages";

/** 已登记 code → 词典 key（common.apiErrors 下）。key 拼错 typecheck 即报。 */
const CODE_KEYS = {
  UNAUTHENTICATED: "unauthenticated",
  UNAUTHORIZED: "unauthenticated",
  RATE_LIMITED: "rateLimited",
  BAD_JSON: "badJson",
  BAD_FORM: "badForm",
  NO_FILE: "noFile",
  NO_SESSION: "noSession",
  NOT_FOUND: "notFound",
  INVALID_CREDENTIALS: "invalidCredentials",
  USERNAME_TAKEN: "usernameTaken",
  INVITE_CODE_INVALID: "inviteCodeInvalid",
  WRONG_PASSWORD: "wrongPassword",
  ASSET_CLEANUP_FAILED: "assetCleanupFailed",
  INVALID_AGENT: "invalidAgent",
  INVALID_REFERENCE: "invalidReference",
  TOO_LARGE: "tooLarge",
  UNSUPPORTED_TYPE: "unsupportedType",
} as const satisfies Record<string, keyof Messages["common"]["apiErrors"]>;

export type ApiErrorCode = keyof typeof CODE_KEYS;
export type ApiErrorKey = (typeof CODE_KEYS)[ApiErrorCode];

/** 服务端错误响应体（仅取所需字段）。 */
export interface ApiErrorBody {
  code?: string;
  message?: string;
}

/**
 * 渲染服务端错误文案：code 已登记 → 词典；否则 server message；
 * 连 message 都没有（网络解析失败等）→ 调用方 fallback。
 */
export function apiErrorMessage(
  error: ApiErrorBody | null | undefined,
  tApi: (key: ApiErrorKey) => string,
  fallback: string,
): string {
  const code = error?.code;
  const key = code && code in CODE_KEYS ? CODE_KEYS[code as ApiErrorCode] : undefined;
  if (key) return tApi(key);
  return error?.message ?? fallback;
}
