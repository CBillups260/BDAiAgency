import { Router } from "express";
import { GoogleGenAI } from "@google/genai";

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─── Full Service Generation ──────────────────────────────

router.post("/generate", async (req, res) => {
  try {
    const { name, description } = req.body as {
      name?: string;
      description?: string;
    };

    if (!name?.trim()) {
      return res.status(400).json({ error: "Service name is required." });
    }

    const prompt = `You are an expert digital marketing agency operations strategist. A user is adding a new service to their agency. Your job is to deeply understand the service FIRST, then use that understanding to generate a bulletproof service package where every piece is informed by and connected to the analysis.

SERVICE NAME: ${name.trim()}
${description?.trim() ? `USER CONTEXT: ${description.trim()}` : ""}

═══════════════════════════════════════════════
STEP 1: DEEP SERVICE ANALYSIS (do this first, internally)
═══════════════════════════════════════════════

Before generating anything, analyze this service thoroughly:

- What EXACTLY does this service deliver? What are the tangible outputs/deliverables?
- Who is the ideal client for this service? What industries, company sizes, budgets?
- What is the competitive landscape? How saturated is this market?
- What are the TOP 3 reasons this service fails at other agencies? (missed deadlines, scope creep, unclear KPIs, poor communication, etc.)
- What does the client journey look like from first touchpoint to renewal?
- What skills does the team need? What's hard to hire for?
- Where are the margin leaks? What eats into profitability?
- What are the minimum viable deliverables vs. premium deliverables?
- What makes a client churnable vs. a long-term partner for this service?
- What adjacent services naturally complement this one?

Use this analysis as the FOUNDATION for everything below. Every pricing tier, every SOP part, every onboarding step, and every email should be DIRECTLY informed by this understanding.

═══════════════════════════════════════════════
STEP 2: GENERATE THE SERVICE PACKAGE
═══════════════════════════════════════════════

Return a JSON object with this structure:

{
  "analysis": {
    "coreDeliverables": ["deliverable 1", "deliverable 2", "deliverable 3"],
    "idealClient": "1-2 sentences describing the ideal client profile",
    "commonFailurePoints": ["failure point 1", "failure point 2", "failure point 3"],
    "keyDifferentiators": ["what makes this service stand out when done right 1", "2", "3"],
    "requiredSkills": ["skill 1", "skill 2", "skill 3"],
    "marginProtectors": ["what protects margins 1", "2", "3"]
  },
  "description": "A compelling 2-3 sentence service description that sells the VALUE and OUTCOME (not the process). Address the client's pain point and the transformation they'll experience.",
  "margin": <estimated profit margin 0-100 — be realistic based on the analysis of margin leaks and labor costs>,
  "pricingTiers": [
    {
      "name": "Starter",
      "price": "$X,XXX/mo",
      "features": ["4-6 features — these should be the MINIMUM viable deliverables from your analysis"]
    },
    {
      "name": "Growth",
      "price": "$X,XXX/mo",
      "features": ["everything in Starter plus 3-4 features that address the COMMON FAILURE POINTS — things that prevent churn"]
    },
    {
      "name": "Enterprise",
      "price": "$X,XXX/mo",
      "features": ["everything in Growth plus 3-4 PREMIUM features — dedicated resources, custom reporting, priority SLAs, strategy sessions"]
    }
  ],
  "pricingNotes": "3-4 sentences explaining: (1) how pricing maps to deliverables and labor costs, (2) how Growth tier specifically addresses common failure points to reduce churn, (3) market positioning vs competitors, (4) why the margin estimate is what it is",
  "vendors": ["5-7 REAL, industry-standard tools needed to deliver this service — picked based on the required skills and deliverables from your analysis"],
  "upsells": ["3-4 adjacent services that naturally complement this one — based on your analysis of the client journey and what clients typically need next"],
  "sopParts": [
    {
      "id": "kebab-case-id",
      "title": "Part Title",
      "description": "2-3 sentences explaining what this SOP part covers. IMPORTANT: reference how this part prevents specific failure points from your analysis.",
      "order": 1,
      "content": null,
      "recommended": true
    }
  ],
  "trainingDocs": "A comprehensive Training Document in Markdown (800+ words). Structure it as modules. CRITICAL: Module content should directly address the required skills from your analysis, and the 'Common Mistakes' module should map directly to the failure points you identified. Include:\\n\\n# Training Guide: ${name.trim()}\\n\\n## Module 1: Service Overview & Why It Matters\\n## Module 2: Understanding the Client (who they are, what they care about, what makes them churn)\\n## Module 3: Tools & Platforms (setup + best practices for each vendor)\\n## Module 4: Execution Workflow (step-by-step, referencing deliverables)\\n## Module 5: Quality Standards & Checkpoints (what good looks like, red flags)\\n## Module 6: Client Communication (templates, cadence, how to handle complaints)\\n## Module 7: Reporting & Analytics (what to track, how to present wins)\\n## Module 8: Common Mistakes & How to Avoid Them (map to your failure analysis)\\n## Assessment Questions (10 questions testing real understanding, not trivia)",
  "onboardingSteps": [
    {
      "order": 1,
      "title": "Step title",
      "description": "What happens — be specific. Each step should build confidence and reduce the risk of early churn.",
      "timeline": "Day 0"
    }
  ],
  "onboardingEmails": [
    {
      "order": 1,
      "name": "Welcome Email",
      "sendDay": "Day 0",
      "subject": "Subject line",
      "body": "Full email body in markdown. Each email should serve a specific purpose in the client journey: building trust, setting expectations, gathering access, showing early wins, and confirming value."
    }
  ]
}

CRITICAL REQUIREMENTS:
- sopParts: Generate 6-10 parts. Mark the first 3-4 as recommended. Each part description must reference which failure points it prevents. Content is always null. Last part should be a sign-off/review part.
- onboardingSteps: At least 6 steps. Design them to prevent the #1 failure point you identified — set expectations early and show value fast.
- onboardingEmails: At least 5 emails (Day 0 Welcome, Day 1 Kickoff, Day 3 Access Confirm, Day 7 Check-In, Day 30 Review). Each email body should be substantial (150+ words), professional, warm, and include clear next steps. The Day 30 email should reference measurable results.
- Pricing: US market rates. Starter should be accessible but profitable. Growth should be the "sweet spot" where most clients land. Enterprise should include dedicated resources.
- The analysis object is included in the output so the user can see the AI's reasoning.
- Everything connects: the failure points inform the SOP structure, the deliverables inform pricing features, the client profile informs email tone, the margin protectors inform vendor choices.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    const text = response.text ?? "";
    let result: any;

    try {
      result = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[0]);
        } catch {
          return res.status(422).json({ error: "Failed to parse AI response. Try again." });
        }
      } else {
        return res.status(422).json({ error: "Failed to generate service data. Try again." });
      }
    }

    // Build backward-compatible pricing record
    const pricing: Record<string, string> = {};
    if (result.pricingTiers && Array.isArray(result.pricingTiers)) {
      for (const tier of result.pricingTiers) {
        pricing[tier.name.toLowerCase()] = tier.price;
      }
    }

    res.json({
      name: name.trim(),
      description: result.description || null,
      analysis: result.analysis || null,
      status: "active",
      clients: 0,
      pricing,
      pricingTiers: result.pricingTiers || [],
      pricingNotes: result.pricingNotes || null,
      margin: typeof result.margin === "number" ? result.margin : null,
      sopStatus: result.sopParts?.length ? "outline-ready" : "not-started",
      sop: null,
      sopParts: result.sopParts || [],
      trainingDocs: result.trainingDocs || null,
      onboardingSteps: result.onboardingSteps || [],
      onboardingEmails: result.onboardingEmails || [],
      vendors: result.vendors || [],
      upsells: result.upsells || [],
    });
  } catch (err: any) {
    console.error("Service generation error:", err?.message || err);
    let userMessage = "Failed to generate service.";
    let statusCode = 500;
    if (err?.status && typeof err.status === "number") statusCode = err.status;
    if (err?.message) {
      try { userMessage = JSON.parse(err.message)?.error?.message || err.message; } catch { userMessage = err.message; }
    }
    res.status(statusCode).json({ error: userMessage });
  }
});

// ─── Regenerate Single Section ────────────────────────────

const SECTION_PROMPTS: Record<string, (name: string) => string> = {
  sop: (name) => `Generate a comprehensive Standard Operating Procedure (SOP) for the digital marketing agency service: "${name}".

Include these sections in Markdown:
# SOP: ${name}
## 1. Overview & Purpose
## 2. Client Onboarding Checklist
## 3. Tools & Access Setup
## 4. Recurring Workflow (weekly/monthly task breakdown)
## 5. Quality Assurance (review process, approval chains)
## 6. Reporting & Communication (report cadence, KPIs)
## 7. Escalation Procedures
## 8. Common Issues & Troubleshooting

Make it detailed enough for a new hire to follow. At least 800 words. Use bullet points and numbered steps.

Return a JSON object: { "content": "the full markdown SOP" }`,

  training: (name) => `Generate a comprehensive Training Document for the digital marketing agency service: "${name}".

Include these modules in Markdown:
# Training Guide: ${name}
## Module 1: Service Overview
## Module 2: Tools & Platforms (setup guides, best practices)
## Module 3: Client Communication (templates, terminology)
## Module 4: Execution Workflow (step-by-step)
## Module 5: Quality Standards (benchmarks, examples)
## Module 6: Reporting & Analytics
## Module 7: Common Mistakes to Avoid
## Assessment Questions (5-10 quiz questions)

Thorough enough to train someone with no prior experience. At least 800 words.

Return a JSON object: { "content": "the full markdown training doc" }`,

  onboarding: (name) => `Generate a detailed client onboarding process for the digital marketing agency service: "${name}".

Create at least 8 onboarding steps covering the full journey from contract signing through the first month.

Return a JSON object: { "steps": [{ "order": 1, "title": "...", "description": "...", "timeline": "Day 0" }, ...] }`,

  emails: (name) => `Generate a complete set of client onboarding emails for the digital marketing agency service: "${name}".

Create at least 5 emails: Welcome, Kickoff, Access Setup, First Week Check-In, 30-Day Review. Each should be professional, warm, and include clear next steps.

Return a JSON object: { "emails": [{ "order": 1, "name": "Welcome Email", "sendDay": "Day 0", "subject": "...", "body": "full markdown email body" }, ...] }`,

  pricing: (name) => `Generate pricing recommendations for the digital marketing agency service: "${name}".

Create 3 tiers (Starter, Growth, Enterprise) with realistic US market pricing. Include 4-6 features per tier and a pricing rationale.

Return a JSON object: { "pricingTiers": [{ "name": "Starter", "price": "$X,XXX/mo", "features": ["..."] }, ...], "pricingNotes": "rationale", "margin": <number 0-100> }`,
};

router.post("/regenerate-section", async (req, res) => {
  try {
    const { serviceName, section } = req.body as {
      serviceName?: string;
      section?: string;
    };

    if (!serviceName?.trim()) {
      return res.status(400).json({ error: "Service name is required." });
    }

    const promptFn = SECTION_PROMPTS[section || ""];
    if (!promptFn) {
      return res.status(400).json({ error: `Invalid section. Use: ${Object.keys(SECTION_PROMPTS).join(", ")}` });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: promptFn(serviceName.trim()),
      config: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    const text = response.text ?? "";
    let result: any;

    try {
      result = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { result = JSON.parse(jsonMatch[0]); } catch {
          return res.status(422).json({ error: "Failed to parse regenerated content." });
        }
      } else {
        return res.status(422).json({ error: "Failed to regenerate section." });
      }
    }

    res.json(result);
  } catch (err: any) {
    console.error("Section regeneration error:", err?.message || err);
    let userMessage = "Failed to regenerate section.";
    let statusCode = 500;
    if (err?.status && typeof err.status === "number") statusCode = err.status;
    if (err?.message) {
      try { userMessage = JSON.parse(err.message)?.error?.message || err.message; } catch { userMessage = err.message; }
    }
    res.status(statusCode).json({ error: userMessage });
  }
});

// ─── SOP: Generate Outline ────────────────────────────────

router.post("/sop/generate-outline", async (req, res) => {
  try {
    const { serviceName, serviceDescription } = req.body as {
      serviceName?: string;
      serviceDescription?: string;
    };

    if (!serviceName?.trim()) {
      return res.status(400).json({ error: "Service name is required." });
    }

    const prompt = `You are an expert operations consultant for a digital marketing agency. Generate an SOP (Standard Operating Procedure) outline for the service: "${serviceName.trim()}"
${serviceDescription ? `\nService description: ${serviceDescription}` : ""}

Create 6-10 SOP parts that together form a complete, production-ready Standard Operating Procedure. Each part should be a logical, self-contained section that can be written independently.

IMPORTANT:
- Parts should flow logically from foundational (overview, setup) to operational (workflows, QA) to advanced (troubleshooting, sign-off)
- Mark the first 3-4 foundational parts as "recommended": true — these should be generated first as they set the foundation
- The last part should always be a wrap-up/sign-off part
- Descriptions should be detailed enough that the user knows exactly what each part will contain
- Use unique kebab-case IDs (e.g., "overview-purpose", "tools-setup", "recurring-workflow")

Return a JSON object: { "parts": [{ "id": "kebab-id", "title": "Part Title", "description": "2-3 sentences about what this covers", "order": 1, "content": null, "recommended": true }, ...] }`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    const text = response.text ?? "";
    let result: any;
    try { result = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { result = JSON.parse(m[0]); } catch { return res.status(422).json({ error: "Failed to parse outline." }); } }
      else return res.status(422).json({ error: "Failed to generate outline." });
    }

    res.json({ parts: result.parts || [] });
  } catch (err: any) {
    console.error("SOP outline error:", err?.message || err);
    let userMessage = "Failed to generate SOP outline.";
    let statusCode = 500;
    if (err?.status && typeof err.status === "number") statusCode = err.status;
    if (err?.message) {
      try { userMessage = JSON.parse(err.message)?.error?.message || err.message; } catch { userMessage = err.message; }
    }
    res.status(statusCode).json({ error: userMessage });
  }
});

// ─── SOP: Generate Single Part ────────────────────────────

router.post("/sop/generate-part", async (req, res) => {
  try {
    const { serviceName, partTitle, partDescription, allParts, analysis } = req.body as {
      serviceName?: string;
      partTitle?: string;
      partDescription?: string;
      allParts?: { title: string; order: number }[];
      analysis?: {
        coreDeliverables?: string[];
        commonFailurePoints?: string[];
        requiredSkills?: string[];
        marginProtectors?: string[];
      };
    };

    if (!serviceName?.trim() || !partTitle?.trim()) {
      return res.status(400).json({ error: "Service name and part title are required." });
    }

    const outlineContext = allParts?.length
      ? `\n\nFull SOP outline for context (you are writing part "${partTitle}"):\n${allParts.map((p) => `${p.order}. ${p.title}`).join("\n")}`
      : "";

    const analysisContext = analysis
      ? `\n\nSERVICE ANALYSIS (use this to make the SOP section fail-proof):
- Core Deliverables: ${analysis.coreDeliverables?.join(", ") || "N/A"}
- Common Failure Points to PREVENT: ${analysis.commonFailurePoints?.join(", ") || "N/A"}
- Required Skills: ${analysis.requiredSkills?.join(", ") || "N/A"}
- Margin Protectors: ${analysis.marginProtectors?.join(", ") || "N/A"}

CRITICAL: This SOP section must directly address and prevent the common failure points listed above. Build in safeguards, checkpoints, and warnings that specifically target these risks.`
      : "";

    const prompt = `You are an expert operations consultant for a digital marketing agency. Write a detailed, production-ready SOP section that is designed to be FAIL-PROOF.

SERVICE: ${serviceName.trim()}
SECTION: ${partTitle.trim()}
${partDescription ? `SECTION SCOPE: ${partDescription}` : ""}${outlineContext}${analysisContext}

Write this SOP section in Markdown format. Requirements:
- Be extremely detailed and actionable — a new hire with no experience should be able to follow this
- Use numbered steps, bullet points, checklists, and clear formatting
- Include specific tool names, time estimates, and role assignments where relevant
- Include WARNING callouts for steps where the common failure points could occur
- Include CHECKPOINT markers where quality should be verified before proceeding
- Include tips and best practices from experienced practitioners
- Aim for 500-800 words for this section
- Start with a brief overview of what this section covers and why it matters
- End with a checklist of key takeaways and a "Red Flags to Watch For" list

Return a JSON object: { "content": "the full markdown content for this SOP section" }`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    const text = response.text ?? "";
    let result: any;
    try { result = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { result = JSON.parse(m[0]); } catch { return res.status(422).json({ error: "Failed to parse content." }); } }
      else return res.status(422).json({ error: "Failed to generate part." });
    }

    res.json({ content: result.content || "" });
  } catch (err: any) {
    console.error("SOP part generation error:", err?.message || err);
    let userMessage = "Failed to generate SOP part.";
    let statusCode = 500;
    if (err?.status && typeof err.status === "number") statusCode = err.status;
    if (err?.message) {
      try { userMessage = JSON.parse(err.message)?.error?.message || err.message; } catch { userMessage = err.message; }
    }
    res.status(statusCode).json({ error: userMessage });
  }
});

export default router;
