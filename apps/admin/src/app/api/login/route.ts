import { z } from "zod";
import { getAdminAuthConfig } from "@oops/config";
import { authenticateAdmin } from "@oops/auth/authenticate-admin";
import { rateLimit, clientIp } from "@oops/auth/rate-limit";
import { adminSessionCookieHeader } from "@oops/auth/session-cookie";
import { createAdminAuditRepo } from "@oops/db/admin-audit.repo";
import { isSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

// 管理端是高权限入口：登录限频阈值比 web 端更严
const LOGIN_RATE_LIMIT = 10;
const LOGIN_RATE_WINDOW_MS = 60_000;

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * POST /api/login：管理端登录（复用 users 表账号，role=admin 才发会话）。
 * 顺序：同源校验 → 限频 → 解析 → 校验（含 role）→ 落审计 → 下发管理端会话 cookie。
 * 凭证错误与非 admin 返回同一 401 文案：不泄漏账号存在性与角色（spec「非管理员账号登录被拒」）。
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) {
    return Response.json(
      { error: { code: "CROSS_ORIGIN", message: "拒绝跨源请求" } },
      { status: 403 },
    );
  }
  if (!rateLimit(`admin-login:${clientIp(req)}`, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS)) {
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
  const auth = await authenticateAdmin(parsed.data.username, parsed.data.password);
  if (!auth) {
    // 失败尝试不落审计：沿用 admin-audit「失败的尝试 MUST NOT 产生审计记录」
    return Response.json(
      { error: { code: "INVALID_CREDENTIALS", message: "用户名或密码不正确" } },
      { status: 401 },
    );
  }
  const cfg = getAdminAuthConfig();
  await createAdminAuditRepo().record({
    adminUserId: auth.userId,
    action: "auth.login",
    targetType: "user",
    targetId: auth.userId,
  });
  return Response.json(
    { user: { id: auth.userId } },
    {
      headers: {
        "set-cookie": adminSessionCookieHeader(
          auth.userId,
          cfg.adminAuthSecret,
          auth.tokenVersion,
          cfg.adminSessionMaxAgeSeconds,
          cfg.adminCookiePath,
        ),
      },
    },
  );
}
