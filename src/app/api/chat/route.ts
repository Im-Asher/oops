import { z } from "zod";
import type { UserMessage } from "@earendil-works/pi-ai";
import { runAgent } from "@/server/agent/runtime";
import { screenInput } from "@/server/agent/moderation";
import { sanitizeTranscript } from "@/server/agent/transcript";
import "@/server/agent"; // 副作用：注册 Agent / 工具 / 任务处理器
import { requireUser } from "@/server/auth/require-user";
import { createMessageRepo } from "@/server/db/message.repo";
import { createSessionRepo } from "@/server/db/session.repo";
import type { SseEvent } from "@/server/agent/types";

export const dynamic = "force-dynamic";

const chatSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  message: z.string().min(1),
});

/** 聊天入口：认证 → 校验 → 落库用户消息 → 经 agentLoop 流式生成（SSE）。 */
export async function POST(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }

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

  const sessionRepo = createSessionRepo();
  const session = await sessionRepo.get(sessionId, userId);
  if (!session) {
    return Response.json({ error: { code: "NOT_FOUND", message: "会话不存在" } }, { status: 404 });
  }
  const agentId = session.agentId ?? parsed.data.agentId;

  // 首条用户消息自动命名：仅当标题为空时截取前 20 字（手动命名与后续消息不覆盖；失败不阻断聊天）
  if (session.title == null) {
    try {
      await sessionRepo.rename(sessionId, message.slice(0, 20));
    } catch {
      // 自动命名失败仅影响标题展示，不阻断本轮对话
    }
  }

  const messageRepo = createMessageRepo();
  // user 消息双视图落库：UI 摘要 + LLM 视图 transcript（显式传 id 供 runAgent 排除本轮，防重复注入）
  const userMessage: UserMessage = { role: "user", content: message, timestamp: Date.now() };
  const userRow = await messageRepo.create({
    sessionId,
    userId,
    role: "user",
    content: message,
    transcript: sanitizeTranscript([userMessage]),
  });

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
          userId,
          agentId,
          userText: message,
          userMessageId: userRow.id,
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
