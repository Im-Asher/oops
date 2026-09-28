import { z } from "zod";
import { runAgent } from "@/server/agent/runtime";
import { screenInput } from "@/server/agent/moderation";
import "@/server/agent/agents"; // 副作用：注册 Agent / 工具 / 任务处理器
import { createMessageRepo } from "@/server/db/message.repo";
import { createSessionRepo } from "@/server/db/session.repo";
import type { SseEvent } from "@/server/agent/types";

export const dynamic = "force-dynamic";

const chatSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  message: z.string().min(1),
});

/** 聊天入口：校验 → 落库用户消息 → 经 agentLoop 流式生成（SSE）。 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "BAD_JSON", message: "请求体需为 JSON" } }, { status: 400 });
  }
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID", message: parsed.error.message } }, { status: 400 });
  }

  const { sessionId, message } = parsed.data;
  const blocked = screenInput(message);
  if (blocked) {
    return Response.json({ error: { code: "BLOCKED", message: blocked } }, { status: 400 });
  }

  const session = await createSessionRepo().get(sessionId);
  if (!session) {
    return Response.json({ error: { code: "NOT_FOUND", message: "会话不存在" } }, { status: 404 });
  }
  const agentId = session.agentId ?? parsed.data.agentId;

  const messageRepo = createMessageRepo();
  await messageRepo.create({ sessionId, role: "user", content: message });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ac = new AbortController();
      req.signal.addEventListener("abort", () => ac.abort());
      const send = (event: SseEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runAgent({
          sessionId,
          agentId,
          userText: message,
          signal: ac.signal,
          onEvent: send,
          repos: { message: messageRepo },
        });
      } catch (err) {
        send({ type: "error", message: (err as Error)?.message ?? "生成失败" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
