import { z } from "zod";
import { getConfig } from "@/lib/config";
import { authenticate } from "@/server/auth/authenticate";
import { rateLimit, clientIp } from "@/server/auth/rate-limit";
import { sessionCookieHeader } from "@/server/auth/session-cookie";

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** 登录：失败一律"用户名或密码不正确"，不泄漏具体原因（spec）。 */
export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`login:${clientIp(req)}`)) {
    return Response.json(
      { error: { code: "RATE_LIMITED", message: "尝试太频繁了，请稍后再试" } },
      { status: 429 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: { code: "BAD_JSON", message: "请求体需为 JSON" } },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "请输入用户名和密码" } },
      { status: 400 },
    );
  }
  const userId = await authenticate(parsed.data.username, parsed.data.password);
  if (!userId) {
    return Response.json(
      { error: { code: "INVALID_CREDENTIALS", message: "用户名或密码不正确" } },
      { status: 401 },
    );
  }
  return Response.json(
    { user: { id: userId } },
    { headers: { "set-cookie": sessionCookieHeader(userId, getConfig().AUTH_SECRET) } },
  );
}
