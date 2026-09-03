import { Router } from "express";
import { GoogleGenAI } from "@google/genai";

const router = Router();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * The Studio — a roundtable of specialist art-direction "brains" plus a Creative
 * Director who synthesizes them into one coherent brief.
 *
 * Round 1: six specialists analyze the references in parallel (fast/cheap model),
 *          each through one lens, and flag the tensions their picks create.
 * Round 2: the Creative Director (deep-thinking model) resolves those tensions
 *          into a single Art-Direction Brief that downstream prompt-building
 *          (src/lib/autoCompose.ts → buildComposePlan) weaves into the generator
 *          prompt.
 *
 * This ENRICHES the existing classify → plan → generate pipeline; it does not
 * replace it. The deterministic plan builder still owns the hard house rules.
 */

const SPECIALIST_MODEL = "gemini-3-flash-preview";
const DIRECTOR_MODEL = "gemini-2.5-pro";
const CRITIC_MODEL = "gemini-3-flash-preview";
const ARCHITECT_MODEL = "gemini-3-flash-preview";

interface Specialist {
  key: string;
  title: string;
  lens: string;
}

const SPECIALISTS: Specialist[] = [
  {
    key: "composition",
    title: "Composition & Negative-Space Architect",
    lens: "You judge the overall composition: layout grid, focal hierarchy, visual balance, and eye-flow. Above all you MAP THE NEGATIVE SPACE — which regions are open and uncluttered — and decide where the hero subject, the headline, and the logo should sit for a balanced, professional, breathing layout.",
  },
  {
    key: "subject",
    title: "Subject & Focal Enhancement Director",
    lens: "You identify the hero subject and decide how to make it the unmistakable star: scale, framing, placement, separation from the background, depth of field, and hero treatment. How do we make this subject pop and look irresistible without distorting what it actually is?",
  },
  {
    key: "background",
    title: "Background & Environment Director",
    lens: "You evaluate the background/environment. Does it work? Should it be kept, cleaned up, replaced, extended, darkened, or blurred? Consider surface, depth, texture, and clutter. The background must support the subject and never compete with it or with the text.",
  },
  {
    key: "lighting",
    title: "Lighting, Color & Mood Director",
    lens: "You direct the lighting, color grade, and mood. Decide the direction and quality of light (soft, dramatic, natural, moody), where highlights and shadows fall, warmth/coolness, contrast, and an overall color grade that harmonizes with the brand palette and the emotional read of the piece.",
  },
  {
    key: "logo",
    title: "Logo & Brand Placement Director",
    lens: "You decide brand-mark placement. Given the composition and where the negative space is, name the exact region the logo should occupy and a rough size as a % of the shorter edge, which logo variant suits the background brightness (light vs dark mark for contrast), the clear-space around it, and how to keep it from crowding the subject or the headline.",
  },
  {
    key: "typography",
    title: "Typography & Message Hierarchy Director",
    lens: "You direct typography and message hierarchy: headline treatment, weight, case, scale, and especially CONTRAST & legibility against the background. Define the hierarchy between headline, any subhead, and supporting copy. Make sure every line reads easily — use a brand color for type only where it clearly contrasts, and white or black for secondary/supporting text when that reads cleaner (never a low-contrast pairing like teal on orange). Keep copy tight and let the type carry energy without clutter.",
  },
];

function clip(s: unknown, max = 600): string {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max) : s;
}

/** Extract the first JSON object from a model response. */
function extractJsonObject(text: string): any {
  if (!text) return {};
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

/** Build the shared context the whole panel reasons against. */
function buildContextBlock(brand: any, classifier: any, menuItems: any[], guidance?: string): string {
  const lines: string[] = [];
  if (guidance && guidance.trim())
    lines.push(`USER GUIDANCE (steer the whole composition toward this — subject, theme, mood, and copy): "${guidance.trim()}"`);
  if (brand?.company) lines.push(`Brand: ${brand.company}`);
  if (brand?.industry) lines.push(`Industry: ${brand.industry}`);
  if (brand?.brandVoice) lines.push(`Voice: ${brand.brandVoice}`);
  if (brand?.targetAudience) lines.push(`Audience: ${brand.targetAudience}`);
  if (Array.isArray(brand?.brandColors) && brand.brandColors.length)
    lines.push(`Brand colors (use these for type/accents/overlays): ${brand.brandColors.join(", ")}`);

  if (classifier) {
    lines.push(
      `Intent: ${classifier.intent === "recreate" ? "RECREATE existing brand material" : "CREATE FROM INSPIRATION (apply an outside reference's look to this brand's own subject)"}`,
    );
    if (classifier.inspiration_format)
      lines.push(`Detected format: ${String(classifier.inspiration_format).replace(/_/g, " ")}`);
    if (classifier.recommended_aspect_ratio)
      lines.push(`Aspect ratio: ${classifier.recommended_aspect_ratio}`);
    if (classifier.suggested_title) lines.push(`Working headline: "${classifier.suggested_title}"`);
    if (Array.isArray(classifier.assets) && classifier.assets.length) {
      const roles = classifier.assets
        .map((a: any) => `[image ${a.index}] ${a.role}${a.menu_match ? ` = "${a.menu_match}"` : ""}: ${clip(a.description, 120)}`)
        .join("; ");
      lines.push(`Reference roles: ${roles}`);
    }
  }

  if (Array.isArray(menuItems) && menuItems.length) {
    lines.push(`Menu/offerings: ${menuItems.slice(0, 20).map((m: any) => m.name).join(", ")}`);
  }
  return lines.join("\n");
}

function specialistPrompt(s: Specialist, context: string): string {
  return `You are the ${s.title} on a creative roundtable designing ONE social-media graphic together.

YOUR LENS: ${s.lens}

SHARED BRIEF CONTEXT:
${context || "(no extra context)"}

Study the provided reference image(s) through YOUR lens only — trust the other specialists to cover theirs. Be concrete and opinionated; this feeds an image generator, so vague adjectives are useless.

Respond with ONLY a JSON object, no markdown:
{
  "assessment": "1-3 sentences on what you observe through your lens and your overall call",
  "directives": ["3-6 concrete, specific, generator-ready instructions"],
  "confidence": 0.0-1.0,
  "tensions": ["any conflicts your recommendations create with other concerns (logo, subject, background, lighting, typography) — name them plainly so the Creative Director can resolve them; [] if none"]
}`;
}

function directorPrompt(context: string, notes: any[]): string {
  return `You are the CREATIVE DIRECTOR chairing a roundtable for ONE social-media graphic. Six specialists have each studied the reference image(s) through their own lens and filed the notes below. Your job: weigh their input, RESOLVE their tensions, and produce one coherent, holistic art-direction brief that a downstream image generator can follow.

SHARED BRIEF CONTEXT:
${context || "(no extra context)"}

SPECIALIST NOTES:
${JSON.stringify(notes, null, 2)}

Make decisive calls where specialists conflict (e.g. if Lighting wants a dark moody grade and Logo needs contrast, decide the grade AND the logo variant/placement that work together). Every field must be concrete, generator-ready direction — NOT vague adjectives. Keep the brand's identity intact: never invent a logo, never bake a call-to-action into the artwork, and use the brand palette for type.

Respond with ONLY a JSON object, no markdown:
{
  "director_summary": "1-3 sentences: the single holistic vision the whole composition serves",
  "composition": "layout, focal hierarchy, and visual flow",
  "negative_space": "where the open space is and what goes there (subject / headline / logo)",
  "subject": "how to feature and enhance the hero subject so it pops",
  "background": "verdict + treatment for the background/environment",
  "lighting": "lighting direction, quality, and where light/shadow fall",
  "color": "color grade and how it harmonizes with the brand palette",
  "logo_placement": "exact region + rough size + variant + clear-space (complements, does not override, the bit-for-bit logo rule)",
  "typography": "headline treatment, hierarchy, and legibility approach",
  "resolved_tensions": ["how you reconciled the specific conflicts the specialists flagged; [] if none"]
}`;
}

router.post("/", async (req, res) => {
  try {
    const {
      references = [],
      brand = {},
      classifier = null,
      menuItems = [],
      guidance = "",
    } = req.body as {
      references?: { base64: string; mimeType: string }[];
      brand?: any;
      classifier?: any;
      menuItems?: any[];
      guidance?: string;
    };

    if (!Array.isArray(references) || references.length === 0) {
      return res.status(400).json({ error: "references are required." });
    }

    const context = buildContextBlock(brand, classifier, menuItems, guidance);
    const imageParts = references.map((r) => ({
      inlineData: { data: r.base64, mimeType: r.mimeType },
    }));

    // ── Round 1: specialists deliberate in parallel ──────────────
    const notes = await Promise.all(
      SPECIALISTS.map(async (s) => {
        try {
          const response = await ai.models.generateContent({
            model: SPECIALIST_MODEL,
            contents: [{ role: "user", parts: [...imageParts, { text: specialistPrompt(s, context) }] }],
          });
          const parsed = extractJsonObject(response.text ?? "");
          return {
            specialist: s.key,
            title: s.title,
            assessment: clip(parsed.assessment, 600),
            directives: Array.isArray(parsed.directives) ? parsed.directives.map((d: any) => clip(d, 300)).slice(0, 6) : [],
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
            tensions: Array.isArray(parsed.tensions) ? parsed.tensions.map((t: any) => clip(t, 300)).slice(0, 5) : [],
          };
        } catch (e: any) {
          console.warn(`Specialist ${s.key} failed:`, e?.message);
          return { specialist: s.key, title: s.title, assessment: "", directives: [], confidence: 0, tensions: [], error: true };
        }
      }),
    );

    const liveNotes = notes.filter((n) => !("error" in n) || !n.error);
    if (liveNotes.length === 0) {
      return res.status(502).json({ error: "The art-direction panel could not analyze these references. Try again." });
    }

    // ── Round 2: the Creative Director synthesizes & resolves tensions ──
    const directorResponse = await ai.models.generateContent({
      model: DIRECTOR_MODEL,
      contents: [{ role: "user", parts: [...imageParts, { text: directorPrompt(context, liveNotes) }] }],
      config: { thinkingConfig: { thinkingBudget: -1, includeThoughts: false } },
    });

    const synth = extractJsonObject(directorResponse.text ?? "");
    if (!synth.director_summary && !synth.composition) {
      return res.status(422).json({ error: "The Creative Director could not synthesize a brief. Try again." });
    }

    const brief = {
      director_summary: clip(synth.director_summary, 600),
      composition: clip(synth.composition, 600),
      negative_space: clip(synth.negative_space, 600),
      subject: clip(synth.subject, 600),
      background: clip(synth.background, 600),
      lighting: clip(synth.lighting, 600),
      color: clip(synth.color, 600),
      logo_placement: clip(synth.logo_placement, 600),
      typography: clip(synth.typography, 600),
      resolved_tensions: Array.isArray(synth.resolved_tensions)
        ? synth.resolved_tensions.map((t: any) => clip(t, 300)).slice(0, 8)
        : [],
      panel: notes,
    };

    res.json({ brief });
  } catch (err: any) {
    console.error("Art-direction error:", err?.message || err);
    let userMessage = "Failed to run the art-direction panel.";
    let statusCode = 500;
    if (err?.status && typeof err.status === "number") statusCode = err.status;
    if (err?.message) {
      try {
        userMessage = JSON.parse(err.message)?.error?.message || err.message;
      } catch {
        userMessage = err.message;
      }
    }
    res.status(statusCode).json({ error: userMessage });
  }
});

// ── POST /api/art-direction/critique ─────────────────────
// QA reviewer: compares a rendered composition against the source assets + rules
// and returns pass/fail plus a corrective note for a one-shot retry. The logo is
// composited separately (pixel-exact), so it is explicitly NOT judged here.

function critiquePrompt(brand: any, planSummary: string, guidance: string): string {
  const colors =
    Array.isArray(brand?.brandColors) && brand.brandColors.length
      ? brand.brandColors.join(", ")
      : "the brand palette";
  return `You are a meticulous art-director QA reviewer for brand social graphics. Compare the GENERATED IMAGE against the REFERENCE asset(s) and the rules, then report only real, fixable problems.

CHECK, in priority order:
1. LOGO FIDELITY — If a brand LOGO reference is provided, the rendered logo MUST match it exactly: same wordmark, same icon/illustration, same lettering and proportions. FAIL if the logo was redrawn, re-lettered, restyled, recolored, distorted, cropped, or replaced with a different mark.
2. SUBJECT FIDELITY — Is the hero subject clearly the SAME item shown in the reference photo (same food/product, same plating, garnish, char/sear, colors, proportions, and count)? FAIL if it was re-cooked, re-plated, restyled, substituted, or invented into a different-looking item.
3. TEXT — Is all text correctly spelled, grammatical, and legible (good contrast, not cut off)?
4. COLOR & CONTRAST — Does EVERY text element have strong, comfortable contrast against its immediate background? FLAG any low-contrast or hard-to-read type (e.g. teal letters on an orange panel) and say what color it should be instead. Brand colors (${colors}) should be used where they contrast; white or black text is correct and fine when it improves legibility — do NOT flag white/black text as "off-brand".
5. NO STRAY CTA — There must be NO button/badge/"Order Now"-style call-to-action rendered as graphic text.
6. PROFESSIONALISM — Obvious artifacts, gibberish text, distortion, or amateur composition.${guidance ? `\n\nThe user explicitly asked for: "${guidance}". Flag if the image ignores it.` : ""}${planSummary ? `\n\nIntended plan (abridged): ${planSummary.slice(0, 800)}` : ""}

Return ONLY JSON: {"pass": true|false, "issues": ["..."], "corrective": "one concise instruction to fix the most important issue(s) on a re-render — empty string if pass"}. Set pass=false only for genuine, fixable problems — especially a redrawn/wrong logo, subject infidelity, or broken/garbled text.`;
}

router.post("/critique", async (req, res) => {
  try {
    const {
      image,
      references = [],
      brand = {},
      planSummary = "",
      guidance = "",
    } = req.body as {
      image?: { base64: string; mimeType: string };
      references?: { base64: string; mimeType: string; role?: string }[];
      brand?: any;
      planSummary?: string;
      guidance?: string;
    };
    if (!image?.base64) return res.status(400).json({ error: "image is required." });

    const parts: any[] = [
      { text: "GENERATED IMAGE (review this one):" },
      { inlineData: { data: image.base64, mimeType: image.mimeType } },
    ];
    references.slice(0, 4).forEach((r: any, i) => {
      const hint =
        r.role === "logo"
          ? "the brand LOGO — the rendered logo MUST match this exactly (same wordmark, same icon/illustration, same lettering & proportions)"
          : r.role === "fontstyle"
          ? "the FONT / lettering STYLE the display text should match"
          : r.role === "dish" || r.role === "product"
          ? "the hero SUBJECT — the output must show this same item"
          : "a source asset that must be honored";
      parts.push({ text: `REFERENCE ${i} (${hint}):` });
      parts.push({ inlineData: { data: r.base64, mimeType: r.mimeType } });
    });
    parts.push({ text: critiquePrompt(brand, planSummary, guidance) });

    const response = await ai.models.generateContent({
      model: CRITIC_MODEL,
      contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json" },
    });

    const v = extractJsonObject(response.text ?? "");
    res.json({
      pass: v.pass !== false,
      issues: Array.isArray(v.issues) ? v.issues.map((x: any) => clip(x, 240)).slice(0, 8) : [],
      corrective: clip(v.corrective, 500),
    });
  } catch (err: any) {
    // Fail open — a critic error must never block the pipeline.
    console.error("Critique error:", err?.message || err);
    res.json({ pass: true, issues: [], corrective: "" });
  }
});

// ── POST /api/art-direction/prompt ───────────────────────
// The Prompt Architect — the convergence point. It distills the verbose
// deterministic draft (which already solved what every asset is and how to use
// it) into ONE tight, concrete, imperative image-generation prompt in the proven
// "recreate @inspiration / feature @dish / @logo / @fontstyle / headline / look /
// output" structure that reliably works — plus a compact JSON spec sheet.

function architectMetaPrompt(
  legend: string,
  draft: string,
  ratio: string,
  logoLock: boolean,
  logoCorner: string,
): string {
  return `You are a senior art director writing the FINAL image-generation prompt for a brand social graphic. Below is a COMPLETE but verbose internal brief — a separate analysis already worked out what every dropped asset is and how to use it. Your job: distill it into ONE tight, concrete, imperative prompt that an image model will follow reliably, in the proven structure below.

KEEP every concrete instruction: each @label and how it is used, the EXACT text/copy (every line — headline, subheads, prices, dates, taglines), any engagement mechanic, the logo handling, the lighting / color / mood, and the aspect ratio. CUT abstraction, meta-talk, and repetition. Around 120–200 words of plain imperative sentences — no headers, no markdown, no preamble.

ASSET LEGEND (refer to assets by these exact @labels):
${legend || "(no labeled assets)"}

PROVEN STRUCTURE (follow this order; omit a line the brief doesn't support):
1. Recreate the composition, layout, and energy of @inspiration (if present; otherwise design a clean on-brand layout from the assets).
2. Feature @dish / @product EXACTLY as photographed — reproduce it faithfully, relight and reframe only, never re-cook, restyle, or substitute it.
3. Render the display text in the @fontstyle lettering (if present).
4. Headline: the exact words, set in the brand palette.
5. Logo: ${logoLock ? `leave the ${logoCorner} corner clean and empty for the logo (it is composited in afterward) — render NO logo or brand mark.` : `place @logo in the ${logoCorner}, reproduced exactly, never redrawn.`}
6. Look: distill the lighting, color grade, mood, and negative space into 1–3 vivid, concrete sentences.
7. Output: one ${ratio} graphic; no call-to-action text; never print the brand name (the logo carries it).

INTERNAL BRIEF TO DISTILL:
"""
${draft}
"""

Also produce a compact JSON "spec" capturing the same decisions (all keys optional: recreate_from, composition, subject{ref,do}, headline{text,font_ref,color}, logo{ref,placement,mode}, lighting, background, palette[], ratio, constraints[]).

Return ONLY JSON: {"prompt":"<the final imperative prompt>","headline":"<the exact headline text used>","spec":{ ... }}.`;
}

router.post("/prompt", async (req, res) => {
  try {
    const {
      draft = "",
      assets = [],
      fontLabel = "",
      ratio = "4:5",
      logoLock = false,
      logoCorner = "bottom-right",
    } = req.body as {
      draft?: string;
      assets?: { label: string; role?: string; description?: string }[];
      fontLabel?: string;
      ratio?: string;
      logoLock?: boolean;
      logoCorner?: string;
    };
    if (!draft.trim()) return res.status(400).json({ error: "draft is required." });

    const legendLines = (assets || []).map(
      (a) => `@${a.label} — ${a.role || "asset"}${a.description ? `: ${clip(a.description, 140)}` : ""}`,
    );
    if (fontLabel) legendLines.push(`@${fontLabel} — the lettering / font style to match for display text`);

    const response = await ai.models.generateContent({
      model: ARCHITECT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: architectMetaPrompt(legendLines.join("\n"), draft, ratio, !!logoLock, logoCorner) },
          ],
        },
      ],
      config: { responseMimeType: "application/json" },
    });

    const out = extractJsonObject(response.text ?? "");
    if (!out.prompt || typeof out.prompt !== "string") {
      return res.status(422).json({ error: "Prompt Architect produced no prompt." });
    }
    res.json({
      prompt: clip(out.prompt, 4000),
      headline: clip(out.headline, 200),
      spec: out.spec && typeof out.spec === "object" ? out.spec : null,
    });
  } catch (err: any) {
    console.error("Prompt Architect error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Prompt Architect failed." });
  }
});

export default router;
