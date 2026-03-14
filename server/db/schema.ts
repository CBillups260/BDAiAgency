import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  systemPrompt: text("system_prompt"),
  config: text("config", { mode: "json" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"), // pending, running, completed, failed
  input: text("input", { mode: "json" }),
  output: text("output", { mode: "json" }),
  parentId: text("parent_id"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  completedAt: text("completed_at"),
});

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: text("agent_id").notNull().references(() => agents.id),
  action: text("action").notNull(),
  taskId: text("task_id"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull().references(() => agents.id),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  role: text("role").notNull(), // user, assistant
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  company: text("company").notNull(),
  email: text("email"),
  avatar: text("avatar"),
  platform: text("platform"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});

export const servicesCatalog = sqliteTable("services_catalog", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  clients: integer("clients").default(0),
  pricing: text("pricing", { mode: "json" }),
  margin: real("margin"),
  sopStatus: text("sop_status"),
  vendors: text("vendors", { mode: "json" }),
  upsells: text("upsells", { mode: "json" }),
});
