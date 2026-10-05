import { z } from "zod";
import { clientIp, rateLimit } from "@/server/auth/rate-limit";
import { requireUser } from "@/server/auth/require-user";
import { sessionCookieHeader } from "@/server/auth/session-cookie";
import { getConfig } from "@/lib/config";
import { changePassword } from "@/server/profile/profile";

const bodySchema = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  // "确认新密码"一致是前端表单职责，服务端只管当前密码与新密码
  newPassword: z.string().min(8, "新密码至少 8 位"),
});

/** 改密：验证当前密码后更新哈希并提升会话版本；响应下发新 cookie 保持当前端登录。 */
export async function POST(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) {
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  }

  // 防"当前密码"在线暴力试错：比通用认证限频更紧
  if (!rateLimit(`password-change:${clientIp(req)}`, 5, 60_000)) {
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
      { error: { code: "BAD_REQUEST", message: "请求格式不正确" } },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: parsed.error.issues[0]?.message ?? "请求格式不正确",
        },
      },
      { status: 400 },
    );
  }

  const result = await changePassword({
    userId,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
  });
  if (!result.ok) {
    if (result.reason === "wrong_current") {
      return Response.json(
        { error: { code: "WRONG_PASSWORD", message: "当前密码不正确" } },
        { status: 400 },
      );
    }
    return Response.json(
      { error: { code: "UNAUTHORIZED", message: "请先登录" } },
      { status: 401 },
    );
  }

  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": sessionCookieHeader(
          userId,
          getConfig().AUTH_SECRET,
          result.tokenVersion,
        ),
      },
    },
  );
}
