import { authedFetch } from './api';

export type AssetRole = 'inspiration' | 'dish' | 'logo' | 'fontstyle' | 'product' | 'background' | 'other';
export type ComposeIntent = 'recreate' | 'create_from_inspiration';
export type LogoVariant = 'light' | 'dark' | 'primary' | 'simplistic' | 'none';
export type SubjectGroupingType = 'single' | 'multi' | 'background_as_subject' | 'none';
export type TitleStrategy = 'preserve' | 'invent';
export type InspirationFormat =
  | 'standard_promo'
  | 'engagement_quiz'
  | 'engagement_question'
  | 'before_after'
  | 'recipe_steps'
  | 'testimonial'
  | 'announcement'
  | 'menu_showcase'
  | 'other';

export interface ClassifiedAsset {
  index: number;
  role: AssetRole;
  description: string;
  confidence: number;
  is_on_brand: boolean;
  extracted_title?: string | null;
  extracted_text?: string[] | null;
  menu_match?: string | null;
}

export interface ClassifierResponse {
  intent: ComposeIntent;
  intent_reason: string;
  recommended_aspect_ratio: string;
  recommended_logo_variant: LogoVariant;
  logo_variant_reason: string;
  assets: ClassifiedAsset[];
  subject_grouping: { type: SubjectGroupingType; subject_indices: number[] };
  title_strategy: TitleStrategy;
  suggested_title: string | null;
  suggested_cta: string | null;
  inspiration_format: InspirationFormat;
  engagement_mechanic: string | null;
  summary: string;
}

export interface BrandContext {
  company?: string | null;
  industry?: string | null;
  brandVoice?: string | null;
  targetAudience?: string | null;
  brandColors?: string[] | null;
  brandFont?: string | null;
  hasPrimaryLogo?: boolean;
  hasLightLogo?: boolean;
  hasDarkLogo?: boolean;
  hasSimplisticLogo?: boolean;
}

export interface MenuItemContext {
  name: string;
  category?: string;
  description?: string;
}

export interface AutoComposePlan {
  classifier: ClassifierResponse;
  builtPrompt: string;
  relabeledRefs: { originalIndex: number; newLabel: string; role: AssetRole }[];
}

/** One specialist's contribution to the art-direction roundtable. */
export interface SpecialistNote {
  specialist: string;
  title: string;
  assessment: string;
  directives: string[];
  confidence: number;
  tensions: string[];
}

/**
 * The Creative Director's synthesized brief — the output of the roundtable
 * ("Deep Compose"). Each field is concrete, generator-ready direction that
 * `buildComposePlan` weaves into the prompt. Optional everywhere so the rest of
 * the pipeline works unchanged when no roundtable was run.
 */
export interface ArtDirectionBrief {
  director_summary: string;
  composition: string;
  negative_space: string;
  subject: string;
  background: string;
  lighting: string;
  color: string;
  logo_placement: string;
  typography: string;
  resolved_tensions: string[];
  panel?: SpecialistNote[];
}

export async function classifyReferences(
  references: { base64: string; mimeType: string }[],
  brand?: BrandContext,
  menuItems?: MenuItemContext[],
  guidance?: string,
  assetLabels?: string[],
): Promise<ClassifierResponse> {
  if (references.length === 0) {
    return {
      intent: 'create_from_inspiration',
      intent_reason: '',
      recommended_aspect_ratio: '4:5',
      recommended_logo_variant: 'none',
      logo_variant_reason: '',
      assets: [],
      subject_grouping: { type: 'none', subject_indices: [] },
      title_strategy: 'invent',
      suggested_title: null,
      suggested_cta: null,
      inspiration_format: 'standard_promo',
      engagement_mechanic: null,
      summary: '',
    };
  }

  const res = await authedFetch('/api/content/classify-references', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ references, brand, menuItems, guidance, assetLabels }),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(text || 'Classification failed.'); }
  if (!res.ok) throw new Error(data.error || 'Classification failed.');
  return data as ClassifierResponse;
}

/**
 * Run the art-direction roundtable (Deep Compose): six specialists + a Creative
 * Director synthesize a holistic brief from the references, brand, and the
 * classifier's structural read. Returns the Director's brief.
 */
export async function requestArtDirection(input: {
  references: { base64: string; mimeType: string }[];
  brand?: BrandContext;
  classifier?: ClassifierResponse;
  menuItems?: MenuItemContext[];
  guidance?: string;
}): Promise<ArtDirectionBrief> {
  const res = await authedFetch('/api/art-direction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(text || 'Art direction failed.'); }
  if (!res.ok) throw new Error(data.error || 'Art direction failed.');
  return data.brief as ArtDirectionBrief;
}

export interface ArchitectResult {
  prompt: string;
  headline: string;
  spec: any | null;
}

/**
 * The Prompt Architect — distills the deterministic draft into one tight
 * imperative generation prompt (the proven style) plus a compact JSON spec.
 * This is the foundation: the multi-step's understanding converges here into the
 * single prompt fed to the image generator.
 */
export async function requestPromptArchitect(input: {
  draft: string;
  assets: { label: string; role?: string; description?: string }[];
  fontLabel?: string;
  ratio?: string;
  logoLock?: boolean;
  logoCorner?: string;
}): Promise<ArchitectResult> {
  const res = await authedFetch('/api/art-direction/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(text || 'Prompt Architect failed.'); }
  if (!res.ok) throw new Error(data.error || 'Prompt Architect failed.');
  return { prompt: data.prompt, headline: data.headline || '', spec: data.spec ?? null };
}

export interface CritiqueVerdict {
  pass: boolean;
  issues: string[];
  corrective: string;
}

/**
 * QA critic: review a rendered composition against the source assets + rules.
 * Returns pass/fail + a corrective note for a one-shot retry. The logo is
 * composited separately, so it is not judged here. Fails open (returns pass).
 */
export async function critiqueComposition(input: {
  image: { base64: string; mimeType: string };
  references: { base64: string; mimeType: string; role?: string }[];
  brand?: BrandContext;
  planSummary?: string;
  guidance?: string;
}): Promise<CritiqueVerdict> {
  try {
    const res = await authedFetch('/api/art-direction/critique', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { pass: true, issues: [], corrective: '' };
    return {
      pass: data.pass !== false,
      issues: Array.isArray(data.issues) ? data.issues : [],
      corrective: typeof data.corrective === 'string' ? data.corrective : '',
    };
  } catch {
    return { pass: true, issues: [], corrective: '' };
  }
}

function pickLabel(role: AssetRole, counts: Record<string, number>): string {
  const base =
    role === 'inspiration' ? 'inspiration'
    : role === 'dish' ? 'dish'
    : role === 'logo' ? 'logo'
    : role === 'fontstyle' ? 'fontstyle'
    : role === 'product' ? 'product'
    : role === 'background' ? 'background'
    : 'ref';
  const n = (counts[base] ?? 0) + 1;
  counts[base] = n;
  return n === 1 ? base : `${base}${n}`;
}

export function buildComposePlan(
  classifier: ClassifierResponse,
  brand: BrandContext,
  options?: {
    autoInjectedLogoLabel?: string | null;
    autoInjectedFontLabel?: string | null;
    brief?: ArtDirectionBrief | null;
    guidance?: string | null;
    /** When true, the generator must NOT draw a logo — it reserves a corner and
     *  the real logo is composited on afterward (guaranteed-exact mark). */
    logoLock?: boolean;
    logoCorner?: string;
  },
): AutoComposePlan {
  const {
    assets,
    intent,
    subject_grouping,
    title_strategy,
    suggested_title,
    suggested_cta,
    inspiration_format,
    engagement_mechanic,
  } = classifier;
  const autoInjectedLogoLabel = options?.autoInjectedLogoLabel ?? null;
  const autoInjectedFontLabel = options?.autoInjectedFontLabel ?? null;

  const counts: Record<string, number> = {};
  const sorted = [...assets].sort((a, b) => {
    const order: Record<AssetRole, number> = {
      inspiration: 0,
      dish: 1,
      product: 2,
      background: 3,
      logo: 4,
      fontstyle: 5,
      other: 6,
    };
    return order[a.role] - order[b.role];
  });

  const relabeled = sorted.map((c) => ({
    originalIndex: c.index,
    newLabel: pickLabel(c.role, counts),
    role: c.role,
  }));
  const labelByIndex = new Map(relabeled.map((r) => [r.originalIndex, r.newLabel]));

  const inspiration = assets.find((a) => a.role === 'inspiration');
  const dishes = assets.filter((a) => a.role === 'dish');
  const products = assets.filter((a) => a.role === 'product');
  const logos = assets.filter((a) => a.role === 'logo');
  const backgrounds = assets.filter((a) => a.role === 'background');

  // ── BRAND BLOCK ──────────────────────────────────────────
  const brandLines: string[] = [];
  if (brand.company) brandLines.push(`Brand: ${brand.company}`);
  if (brand.industry) brandLines.push(`Industry: ${brand.industry}`);
  if (brand.brandVoice) brandLines.push(`Voice: ${brand.brandVoice}`);
  if (brand.targetAudience) brandLines.push(`Audience: ${brand.targetAudience}`);
  if (brand.brandColors?.length) brandLines.push(`Brand colors (use for typography, accents, and overlays WHERE THEY CONTRAST well with the background; white or black are allowed for text when they read better): ${brand.brandColors.join(', ')}`);
  if (brand.brandFont) brandLines.push(`Brand font reference: ${brand.brandFont}`);
  const brandBlock = brandLines.length ? `BRAND\n${brandLines.join('\n')}\n\n` : '';

  // ── INSTRUCTIONS ─────────────────────────────────────────
  const instr: string[] = [];

  // Mode header
  if (intent === 'recreate') {
    instr.push(`MODE: RECREATE. The dropped material already belongs to ${brand.company || 'this brand'}. Refresh it while preserving its brand markers (logo, title, copy, color treatment).`);
  } else {
    instr.push(`MODE: CREATE FROM INSPIRATION. Apply the look-and-feel of the inspiration to ${brand.company || 'the selected brand'}, swapping the inspiration's subject and logo for the brand's own.`);
  }

  // User guidance — a short hint the user typed to steer the composition.
  const guidance = options?.guidance?.trim();
  if (guidance) {
    instr.push(`USER GUIDANCE (the user explicitly asked for this — the composition must reflect it): ${guidance}`);
  }

  // ── ROUNDTABLE ART DIRECTION (Deep Compose) ──────────────
  // When a Creative Director brief is supplied, lead with its overarching
  // vision. The detailed per-dimension directives are appended near the end
  // (before OUTPUT) so they refine — never replace — the hard house rules.
  const brief = options?.brief ?? null;
  if (brief?.director_summary?.trim()) {
    instr.push(`CREATIVE DIRECTION (the overarching vision the whole composition must serve): ${brief.director_summary.trim()}`);
  }

  // Composition reference
  if (inspiration) {
    const insLabel = labelByIndex.get(inspiration.index);
    instr.push(`Use @${insLabel} as the composition, lighting, typographic style, and energy reference (${inspiration.description}).`);
  } else {
    instr.push(`No inspiration image was provided — design an on-brand 4:5 social-ready graphic from scratch using the assets below.`);
  }

  const heroSubject: ClassifiedAsset | null = (() => {
    const subjectIdx = subject_grouping.subject_indices[0]
      ?? assets.find((a) => a.role === 'dish' || a.role === 'product')?.index;
    return subjectIdx != null ? assets.find((a) => a.index === subjectIdx) ?? null : null;
  })();

  // Inspiration format — engagement / quiz / before-after / etc.
  if (inspiration && inspiration_format !== 'standard_promo') {
    const subjectName = heroSubject?.menu_match || heroSubject?.description || "the user's subject";
    switch (inspiration_format) {
      case 'engagement_quiz':
        instr.push(`ENGAGEMENT FORMAT — QUIZ: This is a participation graphic. Preserve the EXACT interactive mechanic from @${labelByIndex.get(inspiration!.index)}${engagement_mechanic ? ` (${engagement_mechanic})` : ''}. Adapt the puzzle to the new subject: if the inspiration uses fill-in-the-blank with one letter shown and dashes equal to the rest of the dish name's letters, regenerate the same pattern using the NEW dish name (${subjectName}) — count the letters, keep the same letter(s) revealed if it makes sense, dashes for the rest. If the inspiration uses multiple choice, swap the options to match. The puzzle must be solvable and the answer must be the new subject.`);
        break;
      case 'engagement_question':
        instr.push(`ENGAGEMENT FORMAT — QUESTION: This is a participation graphic asking the audience to respond${engagement_mechanic ? ` (${engagement_mechanic})` : ''}. Preserve the question-prompt structure but adapt the question to the new subject (${subjectName}) and the brand's voice. Keep the body copy short and conversational.`);
        break;
      case 'before_after':
        instr.push(`FORMAT — BEFORE/AFTER: The inspiration uses a split or comparison layout. Preserve that split exactly. Substitute the user's subject into the "after" side; the "before" side should be the contextually appropriate comparison (raw ingredient, empty plate, the problem the brand solves, etc.).`);
        break;
      case 'recipe_steps':
        instr.push(`FORMAT — RECIPE STEPS: The inspiration is a numbered/stepwise recipe layout. Preserve the step structure, numbering, and visual rhythm. Replace each step's photo and copy to reflect a real preparation flow for the new subject.`);
        break;
      case 'testimonial':
        instr.push(`FORMAT — TESTIMONIAL: The inspiration is a pull-quote / review layout. Preserve the quote-emphasis composition. The quote should be short, voice-matched to the brand, and reference the experience of the new subject — not the brand's tagline.`);
        break;
      case 'announcement':
        instr.push(`FORMAT — ANNOUNCEMENT: The inspiration is an announcement (opening, new menu item, event, hours). Preserve the announcement structure. Adapt the news to fit the new subject and brand context.`);
        break;
      case 'menu_showcase':
        instr.push(`FORMAT — MENU SHOWCASE: The inspiration is a multi-item grid/list. Preserve the grid/list structure. Populate it with the user's subject(s); if there aren't enough, treat the single subject as the hero and feature it more prominently.`);
        break;
    }
  }


  // Subject — handle multi-subject grouping
  const subjectIndices = subject_grouping.subject_indices.length
    ? subject_grouping.subject_indices
    : [...dishes, ...products].map((a) => a.index);
  const subjectAssets = subjectIndices
    .map((i) => assets.find((a) => a.index === i))
    .filter(Boolean) as ClassifiedAsset[];

  if (subjectAssets.length >= 2) {
    const labels = subjectAssets.map((s) => `@${labelByIndex.get(s.index)}`).join(', ');
    instr.push(`HERO SUBJECTS: ${labels} are REAL PHOTOGRAPHS of the exact items to feature together as one composed group. Reproduce each one faithfully — same food, plating, garnish, char/sear, colors, and proportions. You may relight and rearrange them to share the frame naturally, but do NOT re-cook, re-plate, restyle, swap, simplify, or substitute any of them, and do NOT borrow subjects from the inspiration. A viewer must recognize them as the same items photographed in ${labels}.`);
  } else if (subjectAssets.length === 1) {
    const s = subjectAssets[0];
    const label = labelByIndex.get(s.index);
    const menuLine = s.menu_match ? ` This dish is ${brand.company || 'the brand'}'s "${s.menu_match}".` : '';
    instr.push(`HERO SUBJECT: @${label} is a REAL PHOTOGRAPH of the exact ${s.role} to feature (${s.description}).${menuLine} Reproduce THIS dish faithfully — same food, same plating, same garnish, same char/sear, same colors, same proportions and count. You may relight and reframe it to fit the composition, but do NOT re-cook, re-plate, restyle, swap, simplify, or "improve" it into a different-looking dish, and do NOT borrow the subject from the inspiration. A viewer must recognize it as the same dish photographed in @${label}.`);
  } else if (subject_grouping.type === 'background_as_subject' && backgrounds.length) {
    const bg = backgrounds[0];
    instr.push(`HERO SUBJECT: Treat @${labelByIndex.get(bg.index)} as the main scene. Compose typography and brand elements over it.`);
  }

  // Background (when not used as subject)
  if (subject_grouping.type !== 'background_as_subject' && backgrounds.length) {
    const bgLabels = backgrounds.map((b) => `@${labelByIndex.get(b.index)}`).join(', ');
    instr.push(`BACKGROUND: The user PROVIDED ${bgLabels} as the backdrop — build the entire composition ON it. Use it as the base layer behind everything; place the subject, headline, and logo over it. Preserve its real colors, texture, lighting, and mood, and extend it naturally to fill the frame if the aspect ratio needs it. Do NOT replace it with an invented background.`);
  }

  // Logo handling — user-dropped logos OR an auto-injected logo OR none
  const droppedLogoLabels = logos.map((l) => `@${labelByIndex.get(l.index)}`);
  const effectiveLogoLabels = autoInjectedLogoLabel
    ? [...droppedLogoLabels, `@${autoInjectedLogoLabel}`]
    : droppedLogoLabels;
  if (options?.logoLock) {
    const corner = options.logoCorner || 'bottom-right';
    instr.push(`LOGO: Do NOT render, draw, paint, or recreate any logo, wordmark, icon, badge, monogram, or brand mark ANYWHERE in the composition. Instead, leave the ${corner} area clean and uncluttered — free of text, the subject, and busy detail — keeping roughly the corner 18% of the frame as calm negative space. The brand's real logo will be composited into that reserved corner afterward, so any drawn logo would collide with it.`);
  } else if (effectiveLogoLabels.length) {
    const logoRefs = effectiveLogoLabels.join(' or ');
    if (intent === 'recreate' && droppedLogoLabels.length) {
      instr.push(`LOGO: ${logoRefs} is the brand's official logo. Treat it like a copy-paste, not inspiration — reproduce the EXACT same artwork: the same icon/illustration (every detail of it), the same wordmark letterforms, spacing, and proportions. Do NOT redraw, re-letter, paraphrase, recolor, restyle, simplify, or invent any part of the mark, and never replace its illustration with a different one. Place it in its existing position from the inspiration, crisp, undistorted, and fully visible. If you cannot reproduce the mark exactly, leave clean empty space for it rather than approximating.`);
    } else {
      instr.push(`LOGO: ${logoRefs} is the brand's official logo. Treat it like a copy-paste, not inspiration — reproduce the EXACT same artwork: the same icon/illustration (every detail of it), the same wordmark letterforms, spacing, and proportions. Do NOT redraw, re-letter, paraphrase, recolor, restyle, simplify, or invent any part of the mark, and never replace its illustration with a different one. Place it cleanly in a corner (bottom-right by default unless the layout clearly calls for another position) at roughly 10–15% of the shorter edge, crisp, undistorted, and never cropped. If you cannot reproduce the mark exactly, leave clean empty space in that corner rather than approximating or inventing a logo.`);
    }
  } else {
    instr.push(`LOGO: No brand logo reference is available. DO NOT invent, draw, generate, or fabricate any logo, wordmark, badge, monogram, seal, or brand mark in the composition. Leave brand identity off the artwork entirely — the brand will be added separately downstream. Treat this as a logo-free graphic.`);
  }

  // Title
  if (title_strategy === 'preserve') {
    const ext = inspiration?.extracted_title;
    if (ext) {
      instr.push(`TITLE: Preserve the existing brand headline exactly: "${ext}". Same wording, same typographic weight, same hierarchy as the inspiration.`);
    } else {
      instr.push(`TITLE: Preserve the brand's existing headline copy and typographic treatment from the inspiration. Do not rewrite the title.`);
    }
  } else if (suggested_title) {
    instr.push(`TITLE: Use this short, punchy headline: "${suggested_title}". Style it in the inspiration's typographic spirit but in the brand's color palette.`);
  } else {
    instr.push(`TITLE: Add a short punchy headline (3–6 words) that fits the brand voice and grabs attention. Keep it tight.`);
  }

  // Reproduce ALL copy when refreshing the brand's OWN graphic (recreate intent) —
  // not just the headline, but every subheading, body line, price, date, and tag.
  const recreateText =
    intent === 'recreate'
      ? inspiration?.extracted_text?.length
        ? inspiration.extracted_text
        : assets.flatMap((a) => a.extracted_text || [])
      : [];
  if (recreateText.length) {
    instr.push(
      `REPRODUCE ALL TEXT EXACTLY: This is ${brand.company || 'the brand'}'s OWN graphic being refreshed, so every word on it must come back — not just the title. Recreate each of these text elements verbatim and correctly spelled, keeping each one's relative size, weight, color, and position from the original (headline AND every subheading, body line, price, date, tagline, and label): ${recreateText
        .map((t) => `"${t}"`)
        .join(', ')}. Do NOT drop, shorten, paraphrase, translate, merge, or invent any text.`,
    );
  }

  // Font / lettering style reference — either a font-style asset the USER dropped
  // (classified role "fontstyle") or the brand's saved font image (auto-injected).
  // A provided font reference is explicit intent: the user wants this lettering.
  const fontAssets = assets.filter((a) => a.role === 'fontstyle');
  const fontStyleLabel = fontAssets.length
    ? labelByIndex.get(fontAssets[0].index)
    : autoInjectedFontLabel;
  if (fontStyleLabel) {
    instr.push(
      `FONT / LETTERING STYLE: The user PROVIDED a reference of the exact lettering style they want, shown as @${fontStyleLabel}. ` +
      `Render the headline and any prominent display text in THIS lettering style — closely match its letterforms, stroke weight, contrast, case, and overall character. ` +
      `Treat @${fontStyleLabel} ONLY as a typography reference: do NOT copy the actual words shown in it, do NOT paste it into the composition as an image, and do NOT treat it as a logo, subject, or background. ` +
      (brand.brandColors?.length
        ? `Take only the letterform STYLE from it — color the text using the brand palette (or white/black where that contrasts better against the background), not the colors in the reference. `
        : '') +
      `If it conflicts with any named brand font, prefer this image.`,
    );
  } else if (brand.brandFont) {
    instr.push(`FONT: Style headline/display text to evoke "${brand.brandFont}".`);
  }

  // CTA — do NOT render a CTA inside the graphic. The CTA lives in the caption
  // copy where it's natural; baking it into every image makes them feel like ads.
  // (suggested_cta is still produced by the classifier and used downstream
  // for caption generation — see Composer.generateCaptionForAsset.)
  void suggested_cta;
  void intent;
  instr.push(`NO CTA IN ARTWORK: Do NOT render any button, pill, banner, badge, or stand-alone "call to action" line inside the composition (e.g. no "Order Today", "Book Now", "Call Today", "Shop Now" rendered as graphic text). The CTA is delivered in the post caption, not on the image. If the inspiration shows one, omit it in this recreation.`);

  // Brand color enforcement
  if (brand.brandColors?.length) {
    instr.push(`COLORS & CONTRAST: Pull headline, accent, and overlay colors from the brand palette — but ONLY where they contrast strongly with whatever sits directly behind them. Legibility comes first: if a brand color would be hard to read on its background (e.g. teal text on an orange panel), use crisp WHITE or near-BLACK for that text instead. Reserve a strong brand color for the primary headline where it genuinely pops, and let white or black carry secondary / supporting text whenever that reads cleaner. Every line of text must have clear, comfortable contrast against its immediate background — never sacrifice readability to force a brand color.`);
  }

  // No duplicate brand naming
  if (brand.company) {
    instr.push(`NO BRAND-NAME REPETITION: The logo already shows "${brand.company}" and any brand tagline. Do NOT print "${brand.company}", any abbreviation of it, or the brand tagline anywhere else in the composition — not as a headline, subheadline, footer, watermark, or accent line. The logo alone identifies the brand. All body copy must be a headline, dish name, tagline, quote, promo line, or CTA — never a restatement of the wordmark.`);
  }

  // Detailed art direction from the studio panel (Deep Compose only). These
  // refine the composition; the hard rules above (logo bit-for-bit, no CTA,
  // brand colors, no name repetition) still govern.
  if (brief) {
    const artLines: [string, string | undefined][] = [
      ['COMPOSITION', brief.composition],
      ['NEGATIVE SPACE', brief.negative_space],
      ['SUBJECT', brief.subject],
      ['BACKGROUND', brief.background],
      ['LIGHTING & MOOD', brief.lighting],
      ['COLOR', brief.color],
      ['LOGO PLACEMENT', brief.logo_placement],
      ['TYPOGRAPHY', brief.typography],
    ];
    for (const [label, val] of artLines) {
      if (val && val.trim()) instr.push(`ART DIRECTION — ${label}: ${val.trim()}`);
    }
  }

  // Final output line
  instr.push(`OUTPUT: A single polished, social-ready graphic at 4:5 (Instagram post) unless the aspect ratio above says otherwise. Match the inspiration's medium — photorealistic where it is photorealistic, typographic where it leans editorial.`);

  const summary = classifier.summary ? `\n\nContext: ${classifier.summary}` : '';
  const builtPrompt = `${brandBlock}TASK\n${instr.map((s, i) => `${i + 1}. ${s}`).join('\n')}${summary}`;

  return { classifier, builtPrompt, relabeledRefs: relabeled };
}
