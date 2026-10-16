import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const messageRole = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

// disabled 用户的所有会话请求立即被拒（require-user 校验 status），无需等 cookie 过期
export const userStatus = pgEnum("user_status", ["active", "disabled"]);

// admin 经手工 SQL 授予（与邀请码发放同模式，无界面）；默认 user
export const userRole = pgEnum("user_role", ["user", "admin"]);

// 保密为默认值，避免 NULL 语义歧义
export const userGender = pgEnum("user_gender", ["male", "female", "secret"]);

// edited：由画布编辑导出的派生图，与原始生成图（image）区分，meta 记录 sourceAssetId 血缘
export const assetKind = pgEnum("asset_kind", ["image", "json", "other", "edited"]);

export const taskType = pgEnum("task_type", [
  "generate_image",
  "render_html",
  "export",
]);

export const taskStatus = pgEnum("task_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);

// —— 积分域（M1）——

// 流水类型：grant 发放 / freeze 预扣 / settle 终态退差或补差 / release 冻结释放 / adjust 后台调整
export const creditLedgerType = pgEnum("credit_ledger_type", [
  "grant",
  "freeze",
  "settle",
  "release",
  "adjust",
]);

// 生命周期仅用于 freeze 条目（frozen → settled | released）；其余类型为 null。
// 状态翻转不改写 amount——append-only，对账恒等式 balance == sum(amount) 依赖这一点。
export const creditLedgerStatus = pgEnum("credit_ledger_status", [
  "frozen",
  "settled",
  "released",
]);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    type: creditLedgerType("type").notNull(),
    // 带符号整数 = 余额变动量（freeze 为负，release/settle 退差为正）
    amount: integer("amount").notNull(),
    status: creditLedgerStatus("status"),
    // 生成类条目关联任务；grant/adjust 无任务为 null
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("credit_ledger_user_idx").on(t.userId),
    index("credit_ledger_task_idx").on(t.taskId),
    index("credit_ledger_frozen_idx").on(t.userId, t.status),
  ],
);

// 定价表：key = 任务类型（generate_image | render_html），credits = 单价（分）
// M1 只读；后台编辑界面是 M2.3，上线前直接改库
export const creditPrices = pgTable("credit_prices", {
  key: text("key").primaryKey(),
  credits: integer("credits").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // 多租户：userId 必填无默认（repo 层全部显式传参）
  userId: text("user_id").notNull(),
  agentId: text("agent_id"),
  title: text("title"),
  // compact 产物：LLM 生成的会话摘要（骨架式），与 summarizedUpTo 水位线配套
  summary: text("summary"),
  // 摘要水位线：指向 messages.id，水位线之前的原文轮次已被摘要覆盖；原文永不删除
  summarizedUpTo: uuid("summarized_up_to"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: messageRole("role").notNull(),
  content: text("content").notNull().default(""),
  // 工具调用与结果（generate_image / render_html 等），结构化 JSON
  toolCalls: jsonb("tool_calls"),
  // LLM 视图 transcript：该消息对应的 pi-ai Message 序列（user 行 [UserMessage]，
  // assistant 行 [AssistantMessage, ...ToolResultMessage]），经清洗（无 thinking、无 base64）
  transcript: jsonb("transcript"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  sessionId: uuid("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  kind: assetKind("kind").notNull().default("image"),
  // MinIO 对象 key，如 assets/<uuid>.png
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  width: integer("width"),
  height: integer("height"),
  // 生图上下文
  prompt: text("prompt"),
  model: text("model"),
  sourceUrl: text("source_url"),
  // 任意扩展元数据（滤镜/裁剪参数、导出设置等）
  meta: jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  sessionId: uuid("session_id").references(() => sessions.id, {
    onDelete: "set null",
  }),
  type: taskType("type").notNull().default("generate_image"),
  status: taskStatus("status").notNull().default("pending"),
  payload: jsonb("payload").notNull().default({}),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  // 混合模型：1 = 一次性码，N = 团装码；使用纪律默认按一次性发放
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // 作废标记（M2 邀请码管理）：作废保留原 expiresAt 语义；注册校验链要求 IS NULL
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // 发放对象备注（无管理界面，码靠 SQL 手工插入）
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// —— 管理域（M2）——

// 管理端全写操作审计（append-only，repo 层不暴露 update/delete）：
// who（adminUserId）/ what（action + targetType/targetId）/ when（createdAt）/ 前后值（before/after 结构化）
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // 操作者 = 执行写操作的管理员 users.id；管理员被删后审计仍须可读 → 不设外键
    adminUserId: text("admin_user_id").notNull(),
    // 动作类型：text + 应用层常量（动作集随管理面增长，pgEnum 改型需 DDL）
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    // 批量生成等面向集合的动作可无单一对象
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("admin_audit_log_admin_idx").on(t.adminUserId, t.createdAt),
    index("admin_audit_log_target_idx").on(t.targetType, t.targetId),
    index("admin_audit_log_created_idx").on(t.createdAt),
  ],
);

// 配置 overlay（配置三层链第一层）：生效配置 = app_config ?? env ?? 代码目录兜底，DB 有值即赢
export const appConfig = pgTable("app_config", {
  // 类型化键空间：agent.<agentId>.enabled / model.<providerId>.<modelId>.enabled / model.roleDefaults.<role>
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  // 最后操作者（管理员 users.id）；完整变更史在 admin_audit_log
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    // 8 位短 ID（去易混字符），注册时生成、永不修改；UI 展示加 oops_ 前缀
    oopsId: text("oops_id").notNull(),
    // scrypt 加盐哈希，不存明文
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    gender: userGender("gender").notNull().default("secret"),
    bio: text("bio"),
    // 改密踢下线水位：改密 +1，载荷版本不符的旧 cookie 立即失效
    tokenVersion: integer("token_version").notNull().default(0),
    status: userStatus("status").notNull().default("active"),
    role: userRole("role").notNull().default("user"),
    // 物化余额（缓存面）：真相在 credit_ledger 流水，恒等式 balance == sum(ledger.amount)；
    // 全部写入必须走 ledger 同事务（repo 层），禁止裸 UPDATE 此列
    creditBalance: integer("credit_balance").notNull().default(0),
    // 注册所用邀请码（追溯发放来源）
    inviteCodeId: uuid("invite_code_id").references(() => inviteCodes.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // 用户名不区分大小写唯一：存原样、比较走 lower()
  (t) => [
    uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
    uniqueIndex("users_oops_id_idx").on(t.oopsId),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type User = typeof users.$inferSelect;
export type InviteCode = typeof inviteCodes.$inferSelect;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type CreditPrice = typeof creditPrices.$inferSelect;
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type AppConfig = typeof appConfig.$inferSelect;
