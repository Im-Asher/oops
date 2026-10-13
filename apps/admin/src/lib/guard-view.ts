import type { AdminGuardResult } from "@oops/auth";

export type GuardView = "expired" | "forbidden" | null;

/**
 * 布局层门卫的渲染决策（spec「管理端访问门卫」三分支）：
 * 401 → expired（会话失效引导页：未登录/验签失败/过期/ghost 用户——ghost 在
 * requireUser 层即拒 401，语义自然继承）；403 → forbidden（antd Result 无权限页）；
 * ok → null（放行渲染布局）。
 */
export function resolveGuardView(result: AdminGuardResult): GuardView {
  if (result.ok) return null;
  return result.status === 401 ? "expired" : "forbidden";
}
