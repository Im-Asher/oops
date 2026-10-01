import { z } from "zod";
import { requireUser } from "@/server/auth/require-user";
import { createUserRepo } from "@/server/db/user.repo";
import { toProfile, updateProfile } from "@/server/profile/profile";

function unauthorized(): Response {
  return Response.json(
    { error: { code: "UNAUTHORIZED", message: "请先登录" } },
    { status: 401 },
  );
}

/** 当前用户资料（username/oopsId 只读，其余字段可经 PATCH 修改）。 */
export async function GET(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();
  const user = await createUserRepo().findById(userId);
  if (!user) return unauthorized();
  return Response.json(toProfile(user));
}

// 未知/只读字段（含 username、oopsId）由 zod 默认 strip 忽略；空串表示清除
const patchSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(20, "昵称至多 20 个字符")
    .transform((v) => (v === "" ? null : v))
    .optional(),
  gender: z.enum(["male", "female", "secret"]).optional(),
  bio: z
    .string()
    .trim()
    .max(60, "个性签名至多 60 个字符")
    .transform((v) => (v === "" ? null : v))
    .optional(),
});

/** 部分更新资料，返回更新后的完整资料。 */
export async function PATCH(req: Request): Promise<Response> {
  const userId = await requireUser(req);
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: { code: "BAD_REQUEST", message: "请求格式不正确" } },
      { status: 400 },
    );
  }
  const parsed = patchSchema.safeParse(body);
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

  const result = await updateProfile(userId, parsed.data);
  if (!result.ok) return unauthorized();
  return Response.json(result.profile);
}
