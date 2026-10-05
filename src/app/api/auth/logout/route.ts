import { clientIp, rateLimit } from "@/server/auth/rate-limit";
import { clearSessionCookieHeader } from "@/server/auth/session-cookie";

/** 登出：立即过期会话 cookie；幂等，未登录调用同样成功。 */
export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`logout:${clientIp(req)}`)) {
    return Response.json(
      { error: { code: "RATE_LIMITED", message: "尝试太频繁了，请稍后再试" } },
      { status: 429 },
    );
  }
  return Response.json(
    { ok: true },
    { headers: { "set-cookie": clearSessionCookieHeader() } },
  );
}
