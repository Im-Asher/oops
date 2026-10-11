import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { requireAdminFromCookieHeader } from "@oops/auth";
import { createUserRepo } from "@oops/db/user.repo";
import { resolveGuardView } from "@/lib/guard-view";
import { ExpiredNotice, ForbiddenNotice } from "@/components/guard-notices";
import AdminShell from "@/components/admin-shell";

/**
 * 布局层门卫（admin-scaffold design D2 全量校验位置）+ 布局骨架挂载点。
 * proxy 只做 cookie 存在性引导；此处做验签/有效期/用户存在且 active/
 * 会话版本/role 全量校验并分流渲染（expired/forbidden/放行）。
 * 放行分支顺路查库取管理员身份给头部展示（task 3.2）——同 layout 完成
 * 门卫与身份查询，避免每请求重复验签查库。
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
