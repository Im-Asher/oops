import { db as defaultDb } from "@/server/db";
import { createUserRepo } from "@/server/db/user.repo";
import { createInviteCodeRepo } from "@/server/db/invite-code.repo";
import type { DbClient } from "@/server/db/invite-code.repo";
import type { User } from "@/server/db/schema";
import { generateUniqueOopsId } from "./oops-id";

export type RegisterFailureReason = "invite_code_invalid" | "username_taken";

export type RegisterResult =
  | { ok: true; user: User }
  | { ok: false; reason: RegisterFailureReason };

/** 事务内中止信号：抛出以触发回滚（直接 return 会提交已扣减的码）。 */
class RegisterAbort extends Error {
  constructor(public readonly reason: RegisterFailureReason) {
    super(reason);
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "23505"
  );
}

/**
 * 注册原子语义：邀请码校验 → 用户名查重 → 建号，全部在同一事务内。
 * 校验顺序遵循 spec（码优先）；用户名占用发生在码扣减之后时靠抛出中止回滚。
 * lower(username) 唯一索引为并发同名注册的兜底，冲突同样归为 username_taken。
 */
export async function registerUser(
  input: { username: string; passwordHash: string; inviteCode: string },
  db: DbClient = defaultDb,
): Promise<RegisterResult> {
  try {
    const user = await db.transaction(async (tx) => {
      const consumed = await createInviteCodeRepo(tx).consumeByCode(
        input.inviteCode,
      );
      if (!consumed) throw new RegisterAbort("invite_code_invalid");
      if (await createUserRepo(tx).findByUsername(input.username)) {
        throw new RegisterAbort("username_taken");
      }
      // oops ID 生成与查重同事务：冲突近乎不可能，重试兜底（上限 5 次）
      const oopsId = await generateUniqueOopsId(async (id) => {
        return !(await createUserRepo(tx).findByOopsId(id));
      });
      return createUserRepo(tx).create({
        username: input.username,
        oopsId,
        passwordHash: input.passwordHash,
        inviteCodeId: consumed.id,
      });
    });
    return { ok: true, user };
  } catch (e) {
    if (e instanceof RegisterAbort) return { ok: false, reason: e.reason };
    if (isUniqueViolation(e)) return { ok: false, reason: "username_taken" };
    throw e;
  }
}
