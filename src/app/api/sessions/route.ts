import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { createSessionRepo } from "@/server/db/session.repo";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().optional(),
});

/** 列出当前用户的会话。 */
export async function GET(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "请先登录" } }, { status: 401 });
  }
  const sessions = await createSessionRepo().list(userId);
  return Response.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      agentId: s.agentId,
      title: s.title,
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
}

/** 创建新会话（绑定 Agent）。 */
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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: { code: "INVALID", message: parsed.error.message } }, { status: 400 });
  }
  const session = await createSessionRepo().create({
    agentId: parsed.data.agentId,
    title: parsed.data.title,
    userId,
  });
  return Response.json({
    id: session.id,
    agentId: session.agentId,
    title: session.title,
    updatedAt: session.updatedAt.toISOString(),
  });
}
