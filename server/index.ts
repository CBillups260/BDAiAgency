import "./load-env.js";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// Initialize DB (creates tables if not exist)
import db, { schema, sqlite } from "./db/index.js";

// Routes
import agentRoutes from "./routes/agents.js";
import chatRoutes from "./routes/chat.js";
import activityRoutes from "./routes/activity.js";
import taskRoutes from "./routes/tasks.js";
import contentRoutes from "./routes/content.js";
import accountRoutes from "./routes/accounts.js";
import socialRoutes from "./routes/social.js";
import canvaRoutes from "./routes/canva.js";
import videoRoutes from "./routes/video.js";
import serviceRoutes from "./routes/services.js";
import prospectingRoutes from "./routes/prospecting.js";
import ghlRoutes from "./routes/ghl.js";

// Queue
import { taskQueue } from "./queue/taskQueue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.SERVER_PORT || "3001");

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Create tables if they don't exist
function initializeDB() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT,
      config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      input TEXT,
      output TEXT,
      parent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      action TEXT NOT NULL,
      task_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      email TEXT,
      avatar TEXT,
      logo TEXT,
      platform TEXT,
      industry TEXT,
      website TEXT,
      description TEXT,
      brand_voice TEXT,
      target_audience TEXT,
      brand_colors TEXT,
      social_handles TEXT,
      services_subscribed TEXT,
      contract_start TEXT,
      contract_end TEXT,
      monthly_retainer TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      title TEXT,
      email TEXT,
      phone TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      clients INTEGER DEFAULT 0,
      pricing TEXT,
      margin REAL,
      sop_status TEXT,
      vendors TEXT,
      upsells TEXT
    );

    CREATE TABLE IF NOT EXISTS gmail_tokens (
      id TEXT PRIMARY KEY DEFAULT 'default',
      email TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log("Database tables initialized");
}

// API Routes
app.use("/api/agents", agentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/canva", canvaRoutes);
app.use("/api/video", videoRoutes);
app.use("/api/prospecting", prospectingRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/ghl", ghlRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Global error handler — ensures all errors return JSON, not plain text
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err?.message || err);
  const status = typeof err?.status === "number" ? err.status : (typeof err?.statusCode === "number" ? err.statusCode : 500);
  res.status(status).json({ error: err?.message || "Something went wrong." });
});

// In production, serve the built frontend
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "..", "dist");
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// Start
async function start() {
  initializeDB();
  await taskQueue.restore();

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`SSE stream: http://localhost:${PORT}/api/activity/stream`);
  });
}

start().catch(console.error);
