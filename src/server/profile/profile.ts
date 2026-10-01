import type { User } from "@/server/db/schema";
import {
  createUserRepo,
  type ProfilePatch,
  type UserGender,
} from "@/server/db/user.repo";
import { hashPassword, verifyPassword } from "@/server/auth/password";

export interface ProfileData {
  username: string;
  oopsId: string;
  displayName: string | null;
  gender: UserGender;
  bio: string | null;
}

/** username/oopsId 只读；其余字段经 PATCH 可改。 */
export function toProfile(user: User): ProfileData {
  return {
    username: user.username,
    oopsId: user.oopsId,
    displayName: user.displayName,
    gender: user.gender,
    bio: user.bio,
  };
}

export type UpdateProfileResult =
  | { ok: true; profile: ProfileData }
  | { ok: false; reason: "unauthorized" };

/** 部分更新资料；空 patch 直接返回当前资料（避免无效 UPDATE）。 */
export async function updateProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<UpdateProfileResult> {
  const repo = createUserRepo();
  if (Object.keys(patch).length > 0) {
    const updated = await repo.updateProfile(userId, patch);
    if (!updated) return { ok: false, reason: "unauthorized" };
    return { ok: true, profile: toProfile(updated) };
  }
  const current = await repo.findById(userId);
  if (!current) return { ok: false, reason: "unauthorized" };
  return { ok: true, profile: toProfile(current) };
}

export type ChangePasswordResult =
  | { ok: true; tokenVersion: number }
  | { ok: false; reason: "unauthorized" | "wrong_current" };

/**
 * 改密：验证当前密码 → 同一条语句写新哈希并将会话版本 +1（旧 cookie 立即失效）。
 * 返回新版本供路由下发新 cookie，使当前端保持登录。
 */
export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<ChangePasswordResult> {
  const repo = createUserRepo();
  const user = await repo.findById(input.userId);
  if (!user) return { ok: false, reason: "unauthorized" };
  const currentOk = await verifyPassword(
    input.currentPassword,
    user.passwordHash,
  );
  if (!currentOk) return { ok: false, reason: "wrong_current" };
  const newHash = await hashPassword(input.newPassword);
  const tokenVersion = await repo.updatePassword(input.userId, newHash);
  if (tokenVersion === undefined) return { ok: false, reason: "unauthorized" };
  return { ok: true, tokenVersion };
}
