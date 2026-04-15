import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAkvNPMQ5UPnUcmXXfR9bRxGGRsxKarvr0",
  authDomain: "ai-designer-b3ea6.firebaseapp.com",
  projectId: "ai-designer-b3ea6",
  storageBucket: "ai-designer-b3ea6.firebasestorage.app",
  messagingSenderId: "309126109469",
  appId: "1:309126109469:web:781b7beaaf4900bcf1e9f4",
  measurementId: "G-P9CMTRVVHR",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function seed() {
  console.log("Seeding Firestore...\n");

  // ─── Agents ────────────────────────────────────────────
  const agentDefs = [
    { id: "orchestrator", name: "Orchestrator Agent", role: "Main Agent — coordinates all sub-agents, manages task delegation, and ensures system-wide coherence", enabled: true },
    { id: "accounts", name: "Account Agent", role: "Client relationships, communications, follow-ups, upsells, onboarding", enabled: true },
    { id: "services", name: "Service Agent", role: "Service plans, pricing, SOPs, vendor management, training docs", enabled: true },
    { id: "reports", name: "Report Agent", role: "Performance reports, social media analytics, Google Analytics insights", enabled: true },
    { id: "financials", name: "Financial Agent", role: "Financial health, profitability, scope creep detection, margin tracking", enabled: true },
  ];

  for (const agent of agentDefs) {
    const { id, ...data } = agent;
    await setDoc(doc(db, "agents", id), { ...data, createdAt: serverTimestamp() });
  }
  console.log("  ✓ Agents seeded");

  // ─── Accounts ──────────────────────────────────────────
  const clientAccounts = [
    {
      name: "Pinnacle Group", company: "Pinnacle Group",
      email: "hello@pinnaclegroup.com", avatar: "https://i.pravatar.cc/150?u=pinnacle", platform: "Slack",
      industry: "Real Estate & Hospitality", website: "https://pinnaclegroup.com",
      description: "Luxury real estate and hospitality brand targeting high-net-worth clientele across the US Southeast.",
      brandVoice: "Sophisticated, confident, and aspirational. Uses polished language with a warm, inviting undertone. Avoids slang.",
      targetAudience: "High-net-worth individuals ages 35-65, luxury homebuyers, resort travelers, and commercial investors.",
      brandColors: ["#1A1A2E", "#C9A96E", "#FFFFFF"],
      socialHandles: { instagram: "@pinnacle.group", twitter: "@PinnacleGrp", linkedin: "pinnacle-group", facebook: "PinnacleGroupOfficial" },
      servicesSubscribed: ["Social Media Management", "Paid Advertising (PPC)"],
      contractStart: "2025-09-01", contractEnd: "2026-08-31", monthlyRetainer: "$8,500",
      status: "active", notes: "Key Q2 priority: launch spring campaign for new resort property.",
    },
    {
      name: "NovaTech", company: "NovaTech",
      email: "marketing@novatech.io", avatar: "https://i.pravatar.cc/150?u=novatech", platform: "Email",
      industry: "SaaS & Technology", website: "https://novatech.io",
      description: "B2B SaaS platform for enterprise workflow automation. Series B funded, 200+ enterprise clients.",
      brandVoice: "Authoritative, data-driven, and forward-thinking. Uses industry terminology confidently. Professional but not stiff.",
      targetAudience: "CTOs, VPs of Operations, and IT directors at mid-market to enterprise companies (500+ employees).",
      brandColors: ["#0F172A", "#3B82F6", "#10B981"],
      socialHandles: { instagram: "@novatech.io", twitter: "@NovaTechHQ", linkedin: "novatech-io" },
      servicesSubscribed: ["SEO & Content Marketing", "Web Design & Development"],
      contractStart: "2025-06-15", contractEnd: "2026-06-14", monthlyRetainer: "$11,500",
      status: "active", notes: "Blog traffic converting at only 1.2% — CRO audit recommended.",
    },
    {
      name: "Meridian Labs", company: "Meridian Labs",
      email: "brand@meridianlabs.com", avatar: "https://i.pravatar.cc/150?u=meridian", platform: "Slack",
      industry: "Biotech & Healthcare", website: "https://meridianlabs.com",
      description: "Biotech diagnostics company developing rapid-test kits for clinical and consumer markets.",
      brandVoice: "Trustworthy, scientific, and approachable. Translates complex science into clear, human language. Empathetic tone.",
      targetAudience: "Healthcare professionals, lab directors, and health-conscious consumers ages 25-55.",
      brandColors: ["#064E3B", "#34D399", "#F0FDF4"],
      socialHandles: { instagram: "@meridianlabs", twitter: "@MeridianLabs", linkedin: "meridian-labs", facebook: "MeridianLabsHealth" },
      servicesSubscribed: ["Social Media Management", "Email Marketing & Automation"],
      contractStart: "2026-01-01", contractEnd: "2026-12-31", monthlyRetainer: "$4,700",
      status: "active", notes: "New product line launching next month — content strategy kickoff needed.",
    },
    {
      name: "Crestline Brands", company: "Crestline Brands",
      email: "hello@crestlinebrands.com", avatar: "https://i.pravatar.cc/150?u=crestline", platform: "Email",
      industry: "Consumer Goods & E-commerce", website: "https://crestlinebrands.com",
      description: "DTC lifestyle brand selling premium outdoor gear and apparel through Shopify and Amazon.",
      brandVoice: "Adventurous, authentic, and community-driven. Casual but quality-focused. Uses emojis sparingly. Strong storytelling.",
      targetAudience: "Outdoor enthusiasts ages 22-40, weekend warriors, hikers, campers, and eco-conscious shoppers.",
      brandColors: ["#1E3A2F", "#F97316", "#FEF3C7"],
      socialHandles: { instagram: "@crestlinebrands", twitter: "@CrestlineBrds", linkedin: "crestline-brands", tiktok: "@crestlinebrands" },
      servicesSubscribed: ["Social Media Management", "SEO & Content Marketing"],
      contractStart: "2025-11-01", contractEnd: "2026-10-31", monthlyRetainer: "$7,000",
      status: "active", notes: "Interested in expanding into email marketing. Strong Q1 social growth.",
    },
    {
      name: "Vertex Solutions", company: "Vertex Solutions",
      email: "team@vertexsolutions.com", avatar: "https://i.pravatar.cc/150?u=vertex", platform: "Email",
      industry: "Professional Services & Consulting", website: "https://vertexsolutions.com",
      description: "Management consulting firm specializing in digital transformation for mid-market companies.",
      brandVoice: "Intelligent, strategic, and results-oriented. Uses business language with a consultative tone. Thought leadership focus.",
      targetAudience: "C-suite executives, board members, and VP-level decision-makers at companies with $50M-$500M revenue.",
      brandColors: ["#1E293B", "#6366F1", "#E2E8F0"],
      socialHandles: { instagram: "@vertexsolutions", twitter: "@VertexConsult", linkedin: "vertex-solutions" },
      servicesSubscribed: ["Paid Advertising (PPC)", "Email Marketing & Automation"],
      contractStart: "2025-10-01", contractEnd: "2026-09-30", monthlyRetainer: "$6,800",
      status: "active", notes: "March report generating. LinkedIn thought leadership performing well.",
    },
    {
      name: "Atlas Digital", company: "Atlas Digital",
      email: "info@atlasdigital.com", avatar: "https://i.pravatar.cc/150?u=atlas", platform: "Slack",
      industry: "Digital Media & Entertainment", website: "https://atlasdigital.com",
      description: "Digital media agency producing branded content, short-form video, and influencer campaigns.",
      brandVoice: "Creative, bold, and trend-forward. Speaks the language of culture and pop media. Edgy but inclusive.",
      targetAudience: "Gen Z and Millennial consumers, brand marketers, and media buyers at agencies and Fortune 500.",
      brandColors: ["#18181B", "#F43F5E", "#FBBF24"],
      socialHandles: { instagram: "@atlasdigital", twitter: "@AtlasDigitalHQ", linkedin: "atlas-digital", tiktok: "@atlasdigital", youtube: "@AtlasDigitalMedia" },
      servicesSubscribed: ["Social Media Management", "Paid Advertising (PPC)", "Web Design & Development"],
      contractStart: "2025-07-01", contractEnd: "2026-06-30", monthlyRetainer: "$9,200",
      status: "active", notes: "Scope creep flagged — frequent off-cycle reporting requests (3 extra this month).",
    },
    {
      name: "Salvatori's Italian Eatery", company: "Salvatori's Italian Eatery",
      email: "info@salvatorisitalian.com", avatar: "https://i.pravatar.cc/150?u=salvatoris", platform: "Email",
      industry: "Restaurant & Food Service", website: "https://salvatorisitalian.com",
      description: "Family-owned authentic Italian eatery established in 2006 in New Haven, Indiana. Grown to 7 locations across Northeast Indiana.",
      brandVoice: "Warm, family-oriented, and authentically Italian. Community-focused with pride in tradition, quality, and hospitality.",
      targetAudience: "Families, couples, and local diners across Northeast Indiana seeking affordable, authentic Italian cuisine.",
      brandColors: ["#8B1A1A", "#D4A843", "#1A3C2A"],
      socialHandles: { instagram: "@salvatorisitalian", facebook: "salvatoris.italian" },
      servicesSubscribed: ["Social Media Management"],
      contractStart: "2026-03-01", contractEnd: "2027-02-28", monthlyRetainer: "$3,500",
      accountType: "Restaurant",
      status: "active", notes: "New client — 7-location Italian restaurant group in NE Indiana.",
    },
    {
      name: "BluePeak Media", company: "BluePeak Media",
      email: "contact@bluepeakmedia.com", avatar: "https://i.pravatar.cc/150?u=bluepeak", platform: "Email",
      industry: "Media & Publishing", website: "https://bluepeakmedia.com",
      description: "Independent media company running niche newsletters and podcasts in the finance and tech space.",
      brandVoice: "Sharp, witty, and informative. Think newsletter-style writing — punchy, concise, opinionated.",
      targetAudience: "Finance professionals, tech enthusiasts, and knowledge workers ages 28-50.",
      brandColors: ["#0C4A6E", "#38BDF8", "#F8FAFC"],
      socialHandles: { instagram: "@bluepeakmedia", twitter: "@BluePeakMedia", linkedin: "bluepeak-media" },
      servicesSubscribed: ["Social Media Management"],
      contractStart: "2026-01-15", contractEnd: "2026-07-14", monthlyRetainer: "$5,500",
      status: "active", notes: "Lean engagement. Strong newsletter audience — social is secondary channel.",
    },
    {
      name: "Orion Creative", company: "Orion Creative",
      email: "studio@orioncreative.com", avatar: "https://i.pravatar.cc/150?u=orion", platform: "Slack",
      industry: "Design & Creative Agency", website: "https://orioncreative.com",
      description: "Full-service creative agency handling branding, packaging design, and campaign creative for CPG and fashion brands.",
      brandVoice: "Artful, expressive, and visually-minded. Speaks in design language. Inspires creativity. Polished yet playful.",
      targetAudience: "Brand directors, CMOs, and creative leads at CPG, fashion, and luxury brands.",
      brandColors: ["#1C1917", "#A855F7", "#FDE68A"],
      socialHandles: { instagram: "@orioncreative", twitter: "@OrionCreativeHQ", linkedin: "orion-creative", tiktok: "@orioncreative" },
      servicesSubscribed: ["Social Media Management", "SEO & Content Marketing", "Paid Advertising (PPC)", "Web Design & Development"],
      contractStart: "2025-04-01", contractEnd: "2026-03-31", monthlyRetainer: "$15,200",
      status: "active", notes: "Highest-revenue account but margin under pressure. 4 extra revision rounds on web design.",
    },
  ];

  const accountIdMap: Record<number, string> = {};

  for (let i = 0; i < clientAccounts.length; i++) {
    const acct = clientAccounts[i];
    const ref = await addDoc(collection(db, "accounts"), {
      ...acct,
      logo: null,
      metadata: null,
      createdAt: serverTimestamp(),
    });
    accountIdMap[i + 1] = ref.id;
    console.log(`  ✓ Account: ${acct.company} → ${ref.id}`);
  }

  // ─── Contacts ──────────────────────────────────────────
  const contactsList = [
    { accountIdx: 1, name: "Sarah Mitchell", title: "VP of Marketing", email: "sarah@pinnaclegroup.com", phone: "+1 (404) 555-0123", isPrimary: true, avatar: "https://i.pravatar.cc/150?u=sarah" },
    { accountIdx: 1, name: "Robert Nguyen", title: "Brand Director", email: "robert@pinnaclegroup.com", phone: "+1 (404) 555-0124", isPrimary: false, avatar: "https://i.pravatar.cc/150?u=robert" },
    { accountIdx: 2, name: "James Ortega", title: "Head of Growth", email: "james@novatech.io", phone: "+1 (512) 555-0201", isPrimary: true, avatar: "https://i.pravatar.cc/150?u=james" },
    { accountIdx: 2, name: "Priya Sharma", title: "Content Manager", email: "priya@novatech.io", phone: "+1 (512) 555-0202", isPrimary: false, avatar: "https://i.pravatar.cc/150?u=priya" },
    { accountIdx: 3, name: "Lisa Chen", title: "Marketing Director", email: "lisa@meridianlabs.com", phone: "+1 (617) 555-0301", isPrimary: true, avatar: "https://i.pravatar.cc/150?u=lisa" },
    { accountIdx: 4, name: "David Park", title: "Founder & CEO", email: "david@crestlinebrands.com", phone: "+1 (720) 555-0401", isPrimary: true, avatar: "https://i.pravatar.cc/150?u=david" },
    { accountIdx: 4, name: "Emma Walsh", title: "E-commerce Manager", email: "emma@crestlinebrands.com", phone: "+1 (720) 555-0402", isPrimary: false, avatar: "https://i.pravatar.cc/150?u=emma" },
    { accountIdx: 5, name: "Alex Rivera", title: "Managing Partner", email: "alex@vertexsolutions.com", phone: "+1 (214) 555-0501", isPrimary: true, avatar: "https://i.pravatar.cc/150?u=alex" },
    { accountIdx: 6, name: "Morgan Hayes", title: "Creative Director", email: "morgan@atlasdigital.com", phone: "+1 (323) 555-0601", isPrimary: true, avatar: "https://i.pravatar.cc/150?u=morgan" },
    { accountIdx: 6, name: "Kai Tanaka", title: "Producer", email: "kai@atlasdigital.com", phone: "+1 (323) 555-0602", isPrimary: false, avatar: "https://i.pravatar.cc/150?u=kai" },
    { accountIdx: 6, name: "Desiree Okonkwo", title: "Social Media Lead", email: "desiree@atlasdigital.com", phone: "+1 (323) 555-0603", isPrimary: false, avatar: "https://i.pravatar.cc/150?u=desiree" },
    { accountIdx: 7, name: "Salvatori Family", title: "Ownership", email: "info@salvatorisitalian.com", phone: "+1 (260) 493-2777", isPrimary: true, avatar: "https://i.pravatar.cc/150?u=salvatori" },
    { accountIdx: 8, name: "Taylor Kim", title: "Editor-in-Chief", email: "taylor@bluepeakmedia.com", phone: "+1 (646) 555-0701", isPrimary: true, avatar: "https://i.pravatar.cc/150?u=taylor" },
    { accountIdx: 9, name: "Jordan Blake", title: "Co-Founder & CCO", email: "jordan@orioncreative.com", phone: "+1 (415) 555-0801", isPrimary: true, avatar: "https://i.pravatar.cc/150?u=jordan" },
    { accountIdx: 9, name: "Camille Durand", title: "Account Director", email: "camille@orioncreative.com", phone: "+1 (415) 555-0802", isPrimary: false, avatar: "https://i.pravatar.cc/150?u=camille" },
  ];

  for (const { accountIdx, ...contactData } of contactsList) {
    const accountId = accountIdMap[accountIdx];
    await addDoc(collection(db, "contacts"), {
      ...contactData,
      accountId,
      notes: null,
      createdAt: serverTimestamp(),
    });
  }
  console.log("  ✓ Contacts seeded");

  // ─── Services Catalog ──────────────────────────────────
  const serviceDefs = [
    { name: "Social Media Management", description: "Full-service social media strategy, content creation, scheduling, and community management.", status: "active", clients: 8, pricing: { starter: "$1,500/mo", growth: "$3,000/mo", enterprise: "$5,500/mo" }, margin: 72, sopStatus: "complete", vendors: ["Sprout Social", "Canva Pro", "CapCut"], upsells: ["Paid Social Ads", "Influencer Partnerships"] },
    { name: "SEO & Content Marketing", description: "Keyword research, on-page optimization, technical SEO audits, blog content creation, and link building.", status: "active", clients: 5, pricing: { starter: "$2,000/mo", growth: "$4,000/mo", enterprise: "$7,500/mo" }, margin: 68, sopStatus: "complete", vendors: ["Ahrefs", "Surfer SEO", "Clearscope"], upsells: ["Local SEO", "Content Video Production"] },
    { name: "Paid Advertising (PPC)", description: "Google Ads, Meta Ads, and LinkedIn Ads campaign management with full creative, targeting, and reporting.", status: "active", clients: 6, pricing: { starter: "$2,500/mo + ad spend", growth: "$4,500/mo + ad spend", enterprise: "$8,000/mo + ad spend" }, margin: 65, sopStatus: "in-progress", vendors: ["Google Ads", "Meta Business Suite", "Triple Whale"], upsells: ["Landing Page Design", "CRO Audit"] },
    { name: "Email Marketing & Automation", description: "Email campaign strategy, template design, automation workflows, list segmentation, and performance optimization.", status: "active", clients: 4, pricing: { starter: "$1,200/mo", growth: "$2,500/mo", enterprise: "$4,500/mo" }, margin: 78, sopStatus: "complete", vendors: ["Klaviyo", "Mailchimp", "Litmus"], upsells: ["SMS Marketing", "Customer Journey Mapping"] },
    { name: "Web Design & Development", description: "Custom website design, development, and maintenance using modern frameworks.", status: "active", clients: 3, pricing: { project: "$8,000–$25,000", retainer: "$2,000/mo" }, margin: 60, sopStatus: "in-progress", vendors: ["Figma", "Webflow", "Vercel"], upsells: ["Monthly Maintenance", "A/B Testing"] },
  ];

  for (const svc of serviceDefs) {
    await addDoc(collection(db, "services_catalog"), svc);
  }
  console.log("  ✓ Services seeded");

  // ─── Activity Log ──────────────────────────────────────
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

  for (const act of activities) {
    await addDoc(collection(db, "activity_log"), {
      ...act,
      createdAt: serverTimestamp(),
    });
  }
  console.log("  ✓ Activity log seeded");

  console.log("\nFirestore seeded successfully!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
