import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import * as schema from "./schema.js";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

function createTables() {
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
      input TEXT, output TEXT, parent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      action TEXT NOT NULL, task_id TEXT, metadata TEXT,
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
      role TEXT NOT NULL, content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, company TEXT NOT NULL, email TEXT,
      avatar TEXT, platform TEXT, metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS services_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      clients INTEGER DEFAULT 0, pricing TEXT, margin REAL,
      sop_status TEXT, vendors TEXT, upsells TEXT
    );
  `);
}

async function seed() {
  console.log("Seeding database...");
  createTables();
  console.log("  ✓ Tables created");

  // --- Agents ---
  const agentDefs = [
    { id: "orchestrator", name: "Orchestrator Agent", role: "Main Agent — coordinates all sub-agents, manages task delegation, and ensures system-wide coherence", enabled: true, systemPrompt: null },
    { id: "accounts", name: "Account Agent", role: "Client relationships, communications, follow-ups, upsells, onboarding", enabled: true, systemPrompt: null },
    { id: "services", name: "Service Agent", role: "Service plans, pricing, SOPs, vendor management, training docs", enabled: true, systemPrompt: null },
    { id: "reports", name: "Report Agent", role: "Performance reports, social media analytics, Google Analytics insights", enabled: true, systemPrompt: null },
    { id: "financials", name: "Financial Agent", role: "Financial health, profitability, scope creep detection, margin tracking", enabled: true, systemPrompt: null },
  ];

  for (const agent of agentDefs) {
    db.insert(schema.agents)
      .values(agent)
      .onConflictDoNothing()
      .run();
  }
  console.log("  ✓ Agents seeded");

  // --- Accounts (clients) ---
  const clientAccounts = [
    { name: "Sarah Mitchell", company: "Pinnacle Group", email: "sarah@pinnaclegroup.com", avatar: "https://i.pravatar.cc/150?u=sarah", platform: "Slack" },
    { name: "James Ortega", company: "NovaTech", email: "james@novatech.io", avatar: "https://i.pravatar.cc/150?u=james", platform: "Email" },
    { name: "Lisa Chen", company: "Meridian Labs", email: "lisa@meridianlabs.com", avatar: "https://i.pravatar.cc/150?u=lisa", platform: "Slack" },
    { name: "David Park", company: "Crestline Brands", email: "david@crestlinebrands.com", avatar: "https://i.pravatar.cc/150?u=david", platform: "Email" },
    { name: "Alex Rivera", company: "Vertex Solutions", email: "alex@vertexsolutions.com", avatar: "https://i.pravatar.cc/150?u=alex", platform: "Email" },
    { name: "Morgan Hayes", company: "Atlas Digital", email: "morgan@atlasdigital.com", avatar: "https://i.pravatar.cc/150?u=morgan", platform: "Slack" },
    { name: "Taylor Kim", company: "BluePeak Media", email: "taylor@bluepeakmedia.com", avatar: "https://i.pravatar.cc/150?u=taylor", platform: "Email" },
    { name: "Jordan Blake", company: "Orion Creative", email: "jordan@orioncreative.com", avatar: "https://i.pravatar.cc/150?u=jordan", platform: "Slack" },
  ];

  // Clear existing accounts first to avoid duplicates on re-seed
  sqlite.exec("DELETE FROM accounts");
  for (const acct of clientAccounts) {
    db.insert(schema.accounts).values(acct).run();
  }
  console.log("  ✓ Accounts seeded");

  // --- Services ---
  const serviceDefs = [
    { name: "Social Media Management", description: "Full-service social media strategy, content creation, scheduling, and community management across all platforms.", status: "active", clients: 8, pricing: { starter: "$1,500/mo", growth: "$3,000/mo", enterprise: "$5,500/mo" }, margin: 72, sopStatus: "complete", vendors: ["Sprout Social", "Canva Pro", "CapCut"], upsells: ["Paid Social Ads", "Influencer Partnerships"] },
    { name: "SEO & Content Marketing", description: "Keyword research, on-page optimization, technical SEO audits, blog content creation, and link building campaigns.", status: "active", clients: 5, pricing: { starter: "$2,000/mo", growth: "$4,000/mo", enterprise: "$7,500/mo" }, margin: 68, sopStatus: "complete", vendors: ["Ahrefs", "Surfer SEO", "Clearscope"], upsells: ["Local SEO", "Content Video Production"] },
    { name: "Paid Advertising (PPC)", description: "Google Ads, Meta Ads, and LinkedIn Ads campaign management with full creative, targeting, and reporting.", status: "active", clients: 6, pricing: { starter: "$2,500/mo + ad spend", growth: "$4,500/mo + ad spend", enterprise: "$8,000/mo + ad spend" }, margin: 65, sopStatus: "in-progress", vendors: ["Google Ads", "Meta Business Suite", "Triple Whale"], upsells: ["Landing Page Design", "CRO Audit"] },
    { name: "Email Marketing & Automation", description: "Email campaign strategy, template design, automation workflows, list segmentation, and performance optimization.", status: "active", clients: 4, pricing: { starter: "$1,200/mo", growth: "$2,500/mo", enterprise: "$4,500/mo" }, margin: 78, sopStatus: "complete", vendors: ["Klaviyo", "Mailchimp", "Litmus"], upsells: ["SMS Marketing", "Customer Journey Mapping"] },
    { name: "Web Design & Development", description: "Custom website design, development, and maintenance using modern frameworks. Includes UX audit and conversion optimization.", status: "active", clients: 3, pricing: { project: "$8,000–$25,000", retainer: "$2,000/mo" }, margin: 60, sopStatus: "in-progress", vendors: ["Figma", "Webflow", "Vercel"], upsells: ["Monthly Maintenance", "A/B Testing"] },
  ];

  sqlite.exec("DELETE FROM services_catalog");
  for (const svc of serviceDefs) {
    db.insert(schema.servicesCatalog).values(svc as any).run();
  }
  console.log("  ✓ Services seeded");

  // --- Seed some initial activity ---
  const activities = [
    { agentId: "accounts", action: "draft_communication", metadata: { client: "Pinnacle Group", subject: "Q2 Strategy Sync" } },
    { agentId: "accounts", action: "suggest_upsell", metadata: { client: "Crestline Brands", service: "Email Marketing" } },
    { agentId: "services", action: "update_sop", metadata: { service: "Paid Advertising (PPC)" } },
    { agentId: "reports", action: "generate_report", metadata: { client: "Vertex Solutions", status: "generating" } },
    { agentId: "financials", action: "scope_creep_alert", metadata: { client: "Orion Creative", impact: "$1,800" } },
    { agentId: "orchestrator", action: "health_check", metadata: { status: "all_agents_operational" } },
    { agentId: "accounts", action: "onboarding_checkin", metadata: { client: "Meridian Labs", week: 2 } },
    { agentId: "financials", action: "margin_analysis", metadata: { avgMargin: "54.4%", target: "60%" } },
  ];

  sqlite.exec("DELETE FROM activity_log");
  for (const act of activities) {
    db.insert(schema.activityLog).values(act as any).run();
  }
  console.log("  ✓ Activity log seeded");

  console.log("Database seeded successfully!");
  sqlite.close();
}

seed().catch(console.error);
