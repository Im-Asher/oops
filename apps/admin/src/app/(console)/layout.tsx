import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { requireAdminFromCookieHeader } from "@oops/auth";
import { resolveGuardView } from "@/lib/guard-view";
import { ExpiredNotice, ForbiddenNotice } from "@/components/guard-notices";
import AdminShell from "@/components/admin-shell";

/**
 * 布局层门卫（admin-scaffold design D2 全量校验位置）+ 布局骨架挂载点。
 * proxy 只做 cookie 存在性引导；此处做验签/有效期/用户存在且 active/
 * 会话版本/role 全量校验并分流渲染（expired/forbidden/放行）。
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

  return <AdminShell>{children}</AdminShell>;
}
