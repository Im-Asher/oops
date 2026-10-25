import { z } from "zod";

/**
 * `POST /v1/runs` 请求体。
 *
 * 分工：web 已完成认证、会话归属校验、引用资产归属校验、用户消息落库与自动命名，
 * 这里只承载 creation 执行一个回合所必需的信息。
 * - `message` 是用户原文（仅用于日志/审计口径），模型可见文本由 creation 用
 *   `referenceAssetIds` 拼装，避免两侧各拼一遍。
 * - `userMessageId` 是 web 刚写入的 user 行 id：重建回放历史时排除该行，
 *   否则本轮输入会被注入两次。
 */
export const runRequestSchema = z.object({
  /** web 生成，作为幂等键；重复提交返回 409，不重复扣费。 */
  runId: z.string().min(1),
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  message: z.string().min(1),
  userMessageId: z.string().min(1),
  /** 画布引用图（归属校验已在 web 完成），vision Agent 会读取字节注入本轮。 */
  referenceAssetIds: z.array(z.string().min(1)).max(5).default([]),
  locale: z.string().min(1).optional(),
});

export type RunRequest = z.infer<typeof runRequestSchema>;

/** 建连前后两层错误：建连前走 HTTP 状态码 + JSON，建连后走 SSE `error` 事件。 */
export const runErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type RunError = z.infer<typeof runErrorSchema>;
