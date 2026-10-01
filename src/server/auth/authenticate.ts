import { createUserRepo } from "@/server/db/user.repo";
import { verifyPassword } from "./password";

// 未知用户时对固定哑哈希执行等价 scrypt 运算，抹平"用户名是否存在"的耗时侧信道
const DUMMY_HASH = "scrypt$" + "A".repeat(22) + "AA==$" + "A".repeat(86) + "AA==";

/** 登录验证：成功返回 userId；失败一律返回 null（统一文案由路由给出，不区分失败原因）。 */
export async function authenticate(
  username: string,
  password: string,
): Promise<string | null> {
  const user = await createUserRepo().findByUsername(username);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  return user && ok ? user.id : null;
}
