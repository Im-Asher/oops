import { z } from "zod";
import { getConfig } from "@/lib/config";
import { hashPassword } from "@/server/auth/password";
import { rateLimit, clientIp } from "@/server/auth/rate-limit";
import { registerUser } from "@/server/auth/register";
import { sessionCookieHeader } from "@/server/auth/session-cookie";

const bodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "用户名至少 2 个字符")
    .max(32, "用户名至多 32 个字符"),
  password: z.string().min(8, "密码至少 8 位"),
  inviteCode: z.string().trim().min(1, "请填写邀请码"),
});

/** 邀请码注册：成功即登录（design/spec：注册即登录，不让用户再登录一次）。 */
export async function POST(req: Request): Promise<Response> {
  if (!rateLimit(`register:${clientIp(req)}`)) {
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
      {
        error: {
          code: "INVALID_INPUT",
          message: parsed.error.issues[0]?.message ?? "请检查填写内容",
        },
      },
      { status: 400 },
    );
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const result = await registerUser({
    username: parsed.data.username,
    passwordHash,
    inviteCode: parsed.data.inviteCode,
  });
  if (!result.ok) {
    const { status, code, message } =
      result.reason === "username_taken"
        ? { status: 409, code: "USERNAME_TAKEN", message: "用户名已存在" }
        : { status: 400, code: "INVITE_CODE_INVALID", message: "邀请码无效或已被使用" };
    return Response.json({ error: { code, message } }, { status });
  }
  return Response.json(
    { user: { id: result.user.id, username: result.user.username } },
    { status: 201, headers: { "set-cookie": sessionCookieHeader(result.user.id, getConfig().AUTH_SECRET) } },
  );
}
