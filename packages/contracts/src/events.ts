import { z } from "zod";

/**
 * web ⇄ creation 的流式事件契约。
 *
 * 线上形态是 SSE 帧（`event: <type>` + `data: <json>`），web 侧原样 pipe 不解析，
 * 因此这里是**唯一**的形制来源：creation 发什么、前端收什么，编译期锁死。
 *
 * `v` 是契约版本，由 `encodeSseFrame` 在出线处统一附加（而不是让每个 emit 点手写），
 * 与 transcript 的版本化机制同构；递增即表示帧内字段有不兼容变更。
 */
export const SSE_EVENT_VERSION = 1 as const;

export const sseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message_delta"), text: z.string() }),
  /** 思考内容三段事件（id 为思考块索引，仅流式展示，不落库） */
  z.object({ type: z.literal("thinking_start"), id: z.string() }),
  z.object({ type: z.literal("thinking_delta"), id: z.string(), text: z.string() }),
  z.object({ type: z.literal("thinking_end"), id: z.string() }),
  z.object({
    type: z.literal("tool_start"),
    id: z.string(),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool_end"),
    id: z.string(),
    name: z.string(),
    details: z.record(z.string(), z.unknown()).nullable(),
  }),
  z.object({ type: z.literal("finish"), stopReason: z.string() }),
  z.object({ type: z.literal("error"), message: z.string(), code: z.string().optional() }),
]);

export type SseEvent = z.infer<typeof sseEventSchema>;

/** 出线形态：事件体 + 版本位。 */
export type SseEventWire = SseEvent & { v: typeof SSE_EVENT_VERSION };

/** SSE 帧编码：与拆分前的线上格式一致（`event:` 行 + 单行 JSON data），另加 `v` 版本位。 */
export function encodeSseFrame(event: SseEvent): string {
  const wire: SseEventWire = { ...event, v: SSE_EVENT_VERSION };
  return `event: ${wire.type}\ndata: ${JSON.stringify(wire)}\n\n`;
}

/** 心跳帧：SSE 注释行，本地代理不会把它当成业务事件，但可阻止空闲断连。 */
export const SSE_HEARTBEAT_FRAME = ": ping\n\n";
