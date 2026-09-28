import { z } from "zod";
import { createSessionRepo } from "@/server/db/session.repo";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().optional(),
});

/** 列出当前用户的会话。 */
export async function GET(): Promise<Response> {
  const sessions = await createSessionRepo().list();
  return Response.json({
    sessions: sessions.map((s) => ({ id: s.id, agentId: s.agentId, title: s.title })),
  });
}

/** 创建新会话（绑定 Agent）。 */
export async function POST(req: Request): Promise<Response> {
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
  });
  return Response.json({ id: session.id, agentId: session.agentId, title: session.title });
}
