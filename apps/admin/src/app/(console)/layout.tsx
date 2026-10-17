import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { requireAdminFromCookieHeader } from "@oops/auth";
import { createUserRepo } from "@oops/db/user.repo";
import { resolveGuardView } from "@/lib/guard-view";
import { ExpiredNotice, ForbiddenNotice } from "@/components/guard-notices";
import AdminShell from "@/components/admin-shell";

/**
 * 布局层门卫（admin-scaffold design D2 全量校验位置）+ 布局骨架挂载点。
 * proxy 只做管理端 cookie 存在性引导（无则去 /login）；此处做验签/有效期/
 * 用户存在且 active/会话版本/role 全量校验并分流渲染（expired/forbidden/放行）。
 * expired 给出登录页入口，forbidden 单独保留：role 可被降级，不能只看登录时刻。
 * 放行分支再查一次库取管理员身份给头部展示（task 3.2）——守卫内部各自
 * 查库（require-user 状态/tv、require-admin role、此处身份），admin 内部
 * 工具流量下可接受；M2 落真实管理 API 时收敛守卫返回 user 行一次查询。
 */
export default async function ConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const guard = await requireAdminFromCookieHeader(cookieStore.toString());
  const view = resolveGuardView(guard);

  if (view === "expired") return <ExpiredNotice />;
  if (view === "forbidden") return <ForbiddenNotice />;
  if (!guard.ok) {
    // 不可达：resolveGuardView 已把全部 !ok 映射为上述引导页；此处仅为类型窄化。
    return <ExpiredNotice />;
  }

  const repo = createUserRepo();
  const user = await repo.findById(guard.userId);
  const identity = user?.displayName ?? user?.username ?? guard.userId;

  return (
    <AdminShell identity={identity}>{children}</AdminShell>
  );
}
