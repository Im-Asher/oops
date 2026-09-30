import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { OWNER_ID } from "@/lib/config";

export const messageRole = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

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

export const sessions = pgTable("chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  // 认证延后：恒为 OWNER_ID，多租户预留
  userId: text("user_id").notNull().default(OWNER_ID),
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
  userId: text("user_id").notNull().default(OWNER_ID),
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
  userId: text("user_id").notNull().default(OWNER_ID),
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
  userId: text("user_id").notNull().default(OWNER_ID),
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

export type Session = typeof sessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Task = typeof tasks.$inferSelect;
