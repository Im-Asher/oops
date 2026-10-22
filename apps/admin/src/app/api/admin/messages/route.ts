import { requireAdmin } from "@oops/auth";
import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_LEVELS,
  NOTIFICATION_SOURCES,
} from "@oops/db/notification.repo";
import {
  NotificationError,
  notificationsService,
} from "@oops/domain/notifications/service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const listQuerySchema = z.object({
  source: z.enum(NOTIFICATION_SOURCES).optional(),
  /** 标题/正文模糊匹配 */
  keyword: z.string().min(1).max(100).optional(),
  /** active 仅未撤回（缺省）/ revoked 仅已撤回 / all 全部 */
  revoked: z.enum(["active", "revoked", "all"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/admin/messages：管理端列表（来源 / 关键词 / 撤回态筛选 + 分页）。
 * 列表项带目标人数与已读人数；已撤回消息仍可查（D4：撤回只改可见性，不改历史）。
 */
export async function GET(req: Request): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_QUERY", message: "过滤参数不合法" } },
      { status: 400 },
    );
  }
  const page = await notificationsService.listForAdmin(parsed.data);
  return Response.json({
    ...page,
    items: page.items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      revokedAt: item.revokedAt?.toISOString() ?? null,
    })),
  });
}

/**
 * 管理员只写两类消息（category 由受众推导，不接受客户端直传）：
 * 全体广播 → admin.broadcast，定向 → admin.direct。level 由运营选择，
 * 决定用户侧的视觉严重度。
 */
const sendSchema = z
  .object({
    audience: z.enum(NOTIFICATION_AUDIENCES),
    userIds: z.array(z.string().min(1)).max(500).optional(),
    title: z.string().min(1).max(80),
    body: z.string().min(1).max(2000),
    level: z.enum(NOTIFICATION_LEVELS).default("info"),
    note: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.audience === "users" && (v.userIds?.length ?? 0) === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["userIds"],
        message: "定向发送须至少选择一名用户",
      });
    }
  });

/**
 * POST /api/admin/messages：下发站内信（全体广播或定向）。
 * 事务与审计语义在 domain 服务内（message.send 与业务同事务）；
 * 路由层只做守卫 + 入参校验 + 结构化错误映射。
 */
export async function POST(req: Request): Promise<Response> {
  const guard = await requireAdmin(req);
  if (!guard.ok) {
    return Response.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.status },
    );
  }
  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_PARAMS", message: "消息参数不合法" } },
      { status: 422 },
    );
  }
  const input = parsed.data;
  try {
    const result = await notificationsService.send({
      source: "admin",
      category: input.audience === "all" ? "admin.broadcast" : "admin.direct",
      level: input.level,
      title: input.title,
      body: input.body,
      audience: input.audience,
      userIds: input.userIds,
      adminId: guard.userId,
      note: input.note,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof NotificationError) {
      // empty_audience / no_receivable_user 是「选错了人」而非参数畸形 → 422
      const status = err.kind === "admin_required" ? 403 : 422;
      return Response.json({ error: { code: err.kind, message: err.message } }, { status });
    }
    throw err;
  }
}
