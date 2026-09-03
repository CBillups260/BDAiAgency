# The Composer & AI Auto Composer — Architecture & Operating Manual

> **Scope:** How the Composer and the broader Content Creation area actually work — every "thinking step," the prompts that drive them, where they live in code, and where the seams for improvement are.
> **Audience:** Us. This is the reference we reason about and improve from.
> **Last mapped:** 2026-05-29 against `src/components/Composer.tsx`, `src/lib/autoCompose.ts`, `src/components/ContentCreation.tsx`, and `functions/src/routes/content.ts`.

---

## 1. The mental model (read this first)

The Composer is **not** an autonomous agent. It is a **deterministic pipeline of specialized AI "thinking steps,"** each with exactly one job, chained together by orchestration code on the client. A human stays in the loop and can inspect or override the output at every seam.

The crown jewel is **Auto Compose**, which turns "here are some reference images + a brand" into "a finished, on-brand social graphic" through three distinct minds:

```
  REFERENCES + BRAND
        │
        ▼
  ┌─────────────────┐   "What am I looking at and what should we make?"
  │ 1. CLASSIFIER    │   gemini-2.5-pro · unlimited thinking · VISION + STRATEGY
  │    (the brain)   │   → structured decisions (intent, roles, ratio, logo, format…)
  └─────────────────┘
        │
        ▼
  ┌─────────────────┐   "Pick & inject the right brand logo for this composition."
  │ 2. LOGO INJECTOR │   client logic · uses classifier's logo-variant call
  └─────────────────┘
        │
        ▼
  ┌─────────────────┐   "Translate the strategy into a precise generation brief."
  │ 3. PLAN BUILDER  │   PURE deterministic code (no LLM) · the 'art director'
  │  (the architect) │   → a numbered, rule-bound prompt + relabeled refs
  └─────────────────┘
        │
        ▼
  ┌─────────────────┐   "Render it."
  │ 4. GENERATOR     │   gemini-3-pro-image / 3.1-flash-image / gpt-image-2
  │    (the hands)   │   → N candidate images (1–4 in parallel)
  └─────────────────┘
        │
        ▼
  ┌─────────────────┐   "Write the words that go with it." (optional, per image)
  │ 5. CAPTIONER     │   gemini-3-flash · uses the classifier's plan as the topic
  └─────────────────┘
```

The key architectural insight: **strategy (Stage 1) is decoupled from rendering (Stage 4) by a deterministic translation layer (Stage 3).** That gives us tight, auditable control over what the image model is asked to do, instead of hoping a single mega-prompt does everything.

---

## 2. Where it lives — the Content Creation area

`src/components/ContentCreation.tsx` is the shell. It is a tabbed workspace routed at `/content/:tool` (`ContentCreation.tsx:94-105`). Each tab is an independent tool — most are **single-purpose AI agents** that share the same backend (`functions/src/routes/content.ts`) and brand context.

| Sub-tab (UI label) | `tool` id | Component | Primary endpoint(s) | One-line job |
|---|---|---|---|---|
| Caption Generator | `captions` | `CaptionGenerator` | `/generate-caption` | 5 on-brand captions from media or a topic |
| Post Creator *(default landing)* | *(none)* | inline in `ContentCreation` | `/generate-image` | Simple text→background image (style presets + colors) |
| Quote Generator | `quote-generator` | `QuoteGenerator` | `/generate-quote` | 8 image-matched quotes for overlays |
| BG Extractor | `isolator` | `SubjectIsolator` | `/extract-background` | Remove the subject, keep a clean background |
| Review Graphics | `review-graphics` | `ReviewGraphicGenerator` | `/search-places`, `/place-reviews`, generation | Turn a Google review into a graphic |
| Products/Food/Graphics | `asset-creator` | `AssetCreator` | `/generate-asset` | Studio-grade product/food photography (4 modes, 40+ styles) |
| Resizer | `resizer` | `Resizer` | `/generate-asset` (resize mode) | Reframe an image to a new aspect ratio |
| **Composer** | `composer` | **`Composer`** | `/classify-references`, `/generate-composite`, `/generate-caption` | **The multi-agent Auto Composer (this document's focus)** |
| Remix | `remix` | `RemixCreator` | `/analyze-graphic`, `/remix-graphic` | Rebrand an existing graphic element-by-element |
| AI Scheduler | `ai-scheduler` | `GhlSchedulePanel` | GHL routes | Push finished posts to the scheduler |

> The **Inspiration widget** (added 2026-05) mounts *underneath* the Composer and feeds it ideas + reference images — see `project_inspiration_engine`.

The Composer is one tab, but it is the only one that *orchestrates multiple agents* into a single output. The rest are powerful single-shot tools.

---

## 3. The Composer's data model

Everything in the Composer is **per-tab**. The user can run up to 8 independent generation contexts (`MAX_TABS = 8`, `Composer.tsx:54`), each with its own references, prompt, settings, and in-flight state — so one tab can keep generating while you start another.

`interface ComposerTab` (`Composer.tsx:93-120`) — the important fields:

| Field | Meaning |
|---|---|
| `references: Reference[]` | Up to 8 (`MAX_REFS = 8`) input images, each `{ id, label, base64, mimeType, preview }`. `label` is the `@mention` handle (`@img1`, or semantic like `@dish`). |
| `prompt` | The manual prompt (also where a built Auto-Compose prompt can be pushed for editing). |
| `model` | `gemini-3-pro-image-preview` \| `gemini-3.1-flash-image-preview` \| `gpt-image-2`. |
| `ratio`, `count` | Aspect ratio; how many candidates to generate (clamped 1–4). |
| `thinkingLevel` | Only sent for `gemini-3.1-flash-image-preview`. |
| `resolution`, `quality` | Only sent for `gpt-image-2`. |
| `autoStage: 'idle' \| 'classifying' \| 'generating'` | Drives the Auto-Compose progress UI. |
| `lastPlan` | The most recent `{ classifier, labelMap, builtPrompt }` — shown to the user for transparency. |
| `cachedPlan` | A `fingerprint`-keyed snapshot of the plan so regenerating skips re-classification (see §5). |
| `quickAdjust`, `quickRetrying` | The "tweak and re-render without re-thinking" mechanism (see §5). |
| `assets: GeneratedAsset[]` | The generated images for this tab. |
| `captionsByAsset` | Captions generated per image (keyed by the asset timestamp). |

State is persisted to `sessionStorage` via `usePersistedState` (`composer.tabs.v1`, `composer.activeTabId.v1`, `composer.accountId`), and in-flight flags are cleared on reload (`Composer.tsx:193-208`).

---

## 4. The Auto Compose pipeline — in detail

Entry point: `autoCompose()` at `Composer.tsx:521`. Preconditions: at least one reference image, a selected brand, and the tab is idle (`Composer.tsx:524-531`). Without a brand it refuses and tells the user to pick one — because the whole point is *on-brand* output.

### Stage 0 — Inputs assembled (`Composer.tsx:553-568`)

The orchestrator gathers:
- **References** — the dropped images (`base64` + `mimeType`).
- **Brand context** — from the selected account: `company, industry, brandVoice, targetAudience, brandColors, brandFont`, plus three booleans `hasPrimaryLogo / hasLightLogo / hasDarkLogo` so the classifier knows which logo variants exist.
- **Menu items** — `name, category, description` from the account's `menuItems` (lets the classifier match a dish photo to a real menu item).

### Stage 1 — The Classifier Agent (the brain)

**Code:** `classifyReferences()` in `src/lib/autoCompose.ts:69-102` → **`POST /api/content/classify-references`** (`content.ts:2045`).
**Model:** `gemini-2.5-pro` with `thinkingConfig: { thinkingBudget: -1, includeThoughts: false }` (`content.ts:2185-2188`) — **the only step in the whole system given an *unlimited* thinking budget.** This is the deep-reasoning seat.

It looks at *all* references at once (passed as `inlineData`) plus the brand + menu, and returns one structured object — `interface ClassifierResponse` (`autoCompose.ts:29-43`):

| Decision | Field | What it determines |
|---|---|---|
| **Intent** | `intent`, `intent_reason` | `recreate` (the assets already belong to this brand → refresh them) vs `create_from_inspiration` (an outside reference + the brand's own subject → transplant the look onto the brand). |
| **Asset roles** | `assets[]` → `{ index, role, description, confidence, is_on_brand, extracted_title, menu_match }` | Each image is tagged `inspiration \| dish \| logo \| product \| background \| other`. |
| **Aspect ratio** | `recommended_aspect_ratio` | Defaults `4:5`; deviates to `9:16` / `1:1` / `16:9` only when the inspiration clearly calls for it. |
| **Logo variant** | `recommended_logo_variant`, `logo_variant_reason` | `light \| dark \| primary \| none` — **chosen by predicting the composition's background brightness** (dark scene → light logo, bright scene → dark logo) for contrast. |
| **Subject grouping** | `subject_grouping: { type, subject_indices }` | `single \| multi \| background_as_subject \| none`. Two dishes dropped = ONE multi-subject group (feature both), not a swap. |
| **Title** | `title_strategy`, `suggested_title` | `preserve` an existing headline vs `invent` a new 3–6 word one. **Hard rule: the title may never just restate the brand name/wordmark.** |
| **CTA** | `suggested_cta` | An industry-appropriate action phrase (used downstream for the *caption*, not painted on the image — see §9). |
| **Format** | `inspiration_format`, `engagement_mechanic` | `standard_promo \| engagement_quiz \| engagement_question \| before_after \| recipe_steps \| testimonial \| announcement \| menu_showcase \| other`. This is what lets the system *preserve an interactive mechanic* (e.g. a fill-in-the-blank) while swapping the subject. |
| **Summary** | `summary` | Free-text context carried into the build prompt. |

> Representative classifier instruction (`content.ts` ~2092): *"'create_from_inspiration' — The dropped assets are MIXED: typically one 'inspiration' image from somewhere else (Pinterest, a competitor, a stock template) plus the user's own subject(s)… Replace the inspiration's subject with the user's subject; replace the inspiration's logo with the user's brand logo; rewrite copy in the brand's voice…"*

If there are zero references, `classifyReferences` short-circuits to a sensible default object without calling the API (`autoCompose.ts:74-90`).

### Stage 2 — Logo auto-injection (`Composer.tsx:577-600`)

A small but important piece of *non-LLM reasoning*. If the user did **not** drop a logo themselves **and** the brand has a logo on file, the orchestrator injects the brand's official logo as an extra reference so the generator has the real mark to work from:

```
recommended_logo_variant → which stored logo to use
  'light'   → account.lightLogo
  'dark'    → account.darkLogo
  'primary' → account.primaryLogo
  'none'/fallback → first available (light → dark → primary)
```

The chosen logo URL is fetched through `/api/content/image-proxy` and converted to base64 (`fetchLogoAsRef`, `Composer.tsx:499-515`), then labeled `logo`. It is only injected if there's room under `MAX_REFS` (`Composer.tsx:590`). On failure it degrades gracefully — generates without the logo and warns (`Composer.tsx:593-599`).

### Stage 3 — The Plan Builder (the art director)

**Code:** `buildComposePlan()` in `src/lib/autoCompose.ts:117-305`. **This is pure, deterministic TypeScript — no AI call.** It is the translation layer that converts the classifier's *decisions* into an explicit, numbered *brief* the image model must follow. This is where most of our hard-won "house style" rules live.

What it does, in order:

1. **Relabel & sort references** (`autoCompose.ts:134-152`). Assets are sorted by role priority (`inspiration → dish → product → background → logo → other`) and given semantic labels via `pickLabel` (`@inspiration`, `@dish`, `@dish2`, `@logo`, …). A `labelByIndex` map is kept so the right base64 goes with the right `@mention`.

2. **Brand block** (`autoCompose.ts:160-168`): company, industry, voice, audience, and crucially —
   > *"Brand colors (use these EXACTLY for typography, accents, overlays): …"*

3. **A numbered TASK list** (`autoCompose.ts:170-302`), assembled from the classifier's decisions. The notable rules:
   - **Mode header** — RECREATE ("refresh while preserving brand markers") vs CREATE FROM INSPIRATION ("apply the look-and-feel… swapping the inspiration's subject and logo for the brand's own") (`:174-178`).
   - **Composition reference** — *"Use @inspiration as the composition, lighting, typographic style, and energy reference."* (`:181-186`).
   - **Format adapters** — for non-standard formats it preserves the *mechanic*. E.g. the quiz case literally instructs: *"if the inspiration uses fill-in-the-blank with one letter shown and dashes equal to the rest of the dish name's letters, regenerate the same pattern using the NEW dish name… count the letters… The puzzle must be solvable and the answer must be the new subject."* (`:198-219`).
   - **Hero subject(s)** — single, multi ("feature them together as one composed subject group… preserve each item's plating exactly"), or background-as-subject. For a single subject it forces a *replace, don't reinvent*: *"If the inspiration shows a different subject, REPLACE it with this exact one — preserve plating, garnish, color, and proportion. Do not invent or substitute."* (`:223-242`).
   - **Logo** (`:250-264`) — the most defensive rule set. With a logo reference present: *"Use this EXACT logo image bit-for-bit — do NOT redraw, re-letter, paraphrase, recolor, restyle, or invent a new mark… place it cleanly in a corner… at roughly 10–15% of the shorter edge… never cropped."* With **no** logo available: *"DO NOT invent, draw, generate, or fabricate any logo, wordmark, badge, monogram, seal, or brand mark… Leave brand identity off the artwork entirely."*
   - **Title** (`:266-278`) — preserve an extracted title, use the suggested one, or invent a tight 3–6 word headline.
   - **No CTA in the artwork** (`:280-286`) — deliberately *not* painted on the image: *"Do NOT render any button, pill, banner, badge, or stand-alone 'call to action' line inside the composition… The CTA is delivered in the post caption, not on the image."* (The `suggested_cta` is still produced and used by the captioner.)
   - **Color enforcement** (`:289-291`) and **no brand-name repetition** (`:294-296`): *"The logo already shows '{company}'… Do NOT print '{company}', any abbreviation, or the tagline anywhere else… The logo alone identifies the brand."*
   - **Output spec** (`:299`): a single social-ready graphic at the chosen ratio, matching the inspiration's medium (photoreal vs editorial/typographic).

   The final prompt is `BRAND\n…\n\nTASK\n1. …\n2. …` plus the classifier summary (`autoCompose.ts:301-302`).

4. **Returns** `{ classifier, builtPrompt, relabeledRefs }`.

### Stage 4 — The Generator (the hands)

**Code:** the `body` + parallel `requestOne()` in `Composer.tsx:646-713` → **`POST /api/content/generate-composite`** (`content.ts:226`).
**Models:** `gemini-3-pro-image-preview` (default, higher quality), `gemini-3.1-flash-image-preview` (faster, supports a `thinkingLevel`), or `gpt-image-2` (OpenAI; takes `resolution` + `quality`) (`content.ts:253-256`).

The backend builds a **reference legend** so the model understands the `@mentions` (`content.ts:268-281`):
> *"Image 1 is what the user calls @inspiration … When you see an @mention in the prompt, use the corresponding reference image… Produce a single photorealistic output image that follows this instruction precisely."*

The orchestrator sends the relabeled references (plus the injected logo), then fires **N requests in parallel** (`count`, clamped 1–4) via `Promise.all` (`Composer.tsx:684`), tracking per-request progress. Results are prepended to `tab.assets`; partial failures are reported as "X of N failed" (`Composer.tsx:701-713`).

### Stage 5 — The Captioner (optional, per image)

**Code:** `generateCaptionForAsset()` (`Composer.tsx:852`) → **`POST /api/content/generate-caption`** (`content.ts:1156`, model `gemini-3-flash-preview`).

Its "topic" is **derived from the classifier's plan**, not typed by the user — `buildAssetTopicHint` (`Composer.tsx:827-850`) assembles "Featured menu item / Headline on the graphic / CTA on the graphic / Post format" from the classifier output. This is the seam where `suggested_cta` re-enters: the CTA lives in the caption, exactly as the Plan Builder intended.

---

## 5. Modes, caching & iteration

**Two ways to drive the Composer:**

- **Manual** (`generate()`, `Composer.tsx:956`) — your `prompt` is used as-is, hitting the same `/generate-composite`. Optionally prepends a light `[Brand Context]` block when `applyBrandContext` is on (`Composer.tsx:969-981`). No classifier, no plan builder.
- **Auto Compose** (`autoCompose()`) — the full 5-stage pipeline above.

**Plan caching (skip re-thinking on regenerate).** `buildAutoFingerprint` (`Composer.tsx:470-491`) hashes the references (mime + length + head/tail of base64), the brand identity (id, voice, colors, which logos exist), and the menu item names into a `v3::…` string. The plan is cached under that fingerprint. If nothing material changed, `autoCompose()` reuses the cached classifier + built prompt and **skips Stage 1–3 entirely** (`Composer.tsx:536, 544-550`). `isCacheHot` (`Composer.tsx:494-497`) lights up a "Plan cached — next click skips classification" hint in the UI. Change a reference, the brand, or the menu → fingerprint changes → it re-classifies.

**Quick Adjust (tweak without re-thinking).** `quickRegenerate()` (`Composer.tsx:721`) appends your tweak to the cached built prompt as an override and re-renders:
> `{cached builtPrompt}\n\nUSER ADJUSTMENT (this overrides anything above that conflicts — apply this exactly):\n{your text}`

It reuses the cached labels, ratio, and injected logo (`Composer.tsx:736-755`) — so it's fast and cheap, no classifier call.

**Transparency / manual takeover.** The UI surfaces `lastPlan` — the classifier's reasoning and the built prompt — and lets the user push the built prompt into the manual prompt box to hand-edit (`Composer.tsx:1470-1490`). The pipeline is glass-box, not black-box.

---

## 6. Controls & model reference

| Control | Applies to | Notes |
|---|---|---|
| **Model** | all | `gemini-3-pro-image-preview` (quality) · `gemini-3.1-flash-image-preview` (speed + `thinkingLevel`) · `gpt-image-2` (OpenAI). Backend allowlists and falls back to `gemini-3-pro-image-preview` (`content.ts:253-254`). |
| **Aspect ratio** | all | Auto-Compose overrides it with the classifier's recommendation (`Composer.tsx:611-617`). |
| **Count (1–4)** | all | Parallel candidates. |
| **Thinking level** | flash-image only | Sent as `thinkingConfig` (`content.ts:337-338`). |
| **Resolution + Quality** | gpt-image-2 only | OpenAI sizing math at `content.ts:35-64`. |

**Model roster across the system (verified):**

| Endpoint | Model |
|---|---|
| `/classify-references` | `gemini-2.5-pro` (thinking budget −1) |
| `/generate-composite`, `/generate-asset`, `/remix-graphic`, `/generate-title` | `gemini-3-pro-image-preview` · `gemini-3.1-flash-image-preview` · (`gpt-image-2` for composite/asset) |
| `/generate-image` | `gemini-3.1-flash-image-preview` |
| `/extract-background` | `gemini-3-pro-image-preview` |
| `/generate-caption`, `/generate-quote`, `/analyze-graphic`, `/analyze-asset` | `gemini-3-flash-preview` |

---

## 7. The supporting agents (sibling tools)

Each is a self-contained "thinking logic." Documented at the endpoint level so we can reason about reuse.

- **AssetCreator → `/generate-asset`** (`content.ts:381`). The most prompt-engineered tool: a **4-mode system** — *Resize* (reframe only, preserve everything), *Enhance·Subtle* (a "sibling frame" from a small camera-move pool, `content.ts:589-621`), *Enhance·Shot-type* (quality-up + reframe, scene/lighting/mood frozen, `content.ts:623-649`), and *Enhance·Style / Transform* (bold reshoot, `content.ts:651-673`), plus 40+ named styles and detail-boost presets. This is the clearest example of our **"preserve vs. transform" duality** (see §9).
- **RemixCreator → `/analyze-graphic` then `/remix-graphic`** (`content.ts:1628`, `1710`). A **two-step agent**: first a vision model decomposes a graphic into a structured layout/elements/colors/typography spec; then a generator rebuilds it element-by-element with the brand's logo, colors, font, and asset swaps while preserving the exact layout.
- **ReviewGraphicGenerator** — chains `/search-places` → `/place-reviews` (Google/SerpAPI) → image generation to turn a real customer review into a branded graphic.
- **SubjectIsolator → `/extract-background`** — semantic subject removal + seamless inpaint to produce a clean reusable background.
- **CaptionGenerator → `/generate-caption`** — 24 caption styles + a rich CTA-type mapper + platform char limits (`content.ts:1148-1284`).
- **QuoteGenerator → `/generate-quote`** — analyzes a photo's mood and returns 8 mixed quotes (original / famous / motivational / one-liners).
- **Resizer → `/generate-asset` (resize mode)** — the reframe path, surfaced as its own tool.
- **Post Creator → `/generate-image`** — the simplest path: text + style preset + colors → one background (`ContentCreation.tsx:152-197`).

---

## 8. End-to-end example

*Scenario: it's Friday at Salvatori's. The user drops a Pinterest "guess-the-dish" quiz graphic and a photo of their lasagna, selects Salvatori's, clicks Auto Compose.*

1. **Classifier** sees two images. Decides `intent = create_from_inspiration`; tags the Pinterest image `inspiration` and the lasagna `dish` (with `menu_match: "Lasagna al Forno"` if it's on the menu); `inspiration_format = engagement_quiz` with the detected mechanic; `recommended_aspect_ratio = 4:5`; the Pinterest graphic is dark → `recommended_logo_variant = light`; `title_strategy = invent`, `suggested_title = "GUESS THE DISH"`, `suggested_cta = "Dine In Tonight"`.
2. **Logo injector** sees no dropped logo → fetches Salvatori's **light** logo and appends it as `@logo`.
3. **Plan builder** relabels refs (`@inspiration`, `@dish`, `@logo`), writes the brand block (incl. exact brand colors), and emits numbered rules: use `@inspiration` for composition; **preserve the quiz mechanic but re-letter it for "Lasagna al Forno"**; make `@dish` the hero, replacing the inspiration's subject; place `@logo` bit-for-bit, top corner, ~10–15%; headline "GUESS THE DISH"; **no CTA painted on the image**; brand colors only; don't reprint "Salvatori's".
4. **Generator** renders 1–4 candidates on `gemini-3-pro-image-preview` at 4:5.
5. **Captioner** (if invoked) writes a caption whose topic is "Featured menu item: Lasagna al Forno · Headline: GUESS THE DISH · CTA: Dine In Tonight · Post format: engagement quiz" — so the **"Dine In Tonight" CTA lands in the caption**, not the artwork.

---

## 9. Design principles encoded in the prompts

These are the opinions baked into the pipeline. Worth knowing before changing anything:

1. **Strategy ≠ rendering.** A reasoning model decides; deterministic code translates; an image model renders. Each is independently inspectable and tunable.
2. **Preserve vs. transform is explicit.** Resize/subtle/shot-type prompts *freeze* scene, lighting, and mood and only improve quality/framing; style/transform prompts *intentionally go bold.* The duality is a feature, encoded per-mode.
3. **The logo is sacred.** Always "use the exact logo bit-for-bit," never invent one; if none exists, leave brand identity *off* the art.
4. **No CTA on the canvas.** CTAs live in captions; baking them into every image makes them read like ads.
5. **No brand-name repetition.** The logo identifies the brand; copy must earn its place (headline/dish/quote/promo).
6. **Brand colors are law** for typography, accents, and overlays.
7. **Format-aware.** The classifier names the inspiration's *format* and the plan builder *preserves its mechanic* (quiz, before/after, recipe steps…), not just its surface look.

---

## 10. Observations & improvement levers

Strengths to keep: the glass-box pipeline, the deterministic plan builder (total control over house rules), plan caching, quick-adjust, and the deep-thinking classifier. Candidate improvements, roughly ordered by leverage — **options, not prescriptions:**

1. **Add a QA / critic agent (Stage 6).** Nothing currently *verifies* the rendered image against the plan. A vision pass could check: is the logo present, uncropped, and the right variant? Is the headline spelled correctly and legible? Are only brand colors used? Is there an accidental CTA or duplicated brand name? On failure, auto-retry once with a corrective note. This is the single biggest quality lever and fits cleanly after Stage 4.
2. **Auto-rank the N candidates.** When `count > 1` we show all candidates equally. A lightweight ranker (legibility + brand-fit + aesthetics) could star the best one.
3. **Hard-place the logo by compositing.** Logo placement is *instructed*, not *enforced* — image models still drift, distort, or recolor marks. An optional post-step that composites the real logo PNG at a computed corner/scale would guarantee fidelity for brands that need it.
4. **Promote the Plan Builder to a hybrid.** It's deterministic today (a strength: control + speed + zero cost). For more nuance we could optionally route the assembled brief through a small "art director" LLM to smooth phrasing and resolve rule conflicts — while keeping the deterministic version as the default/fallback.
5. **Persist & learn from plans.** Plans are cached only per-tab, in-session. Logging classifier outputs + which candidate the user actually used would let us tune prompts and (later) personalize per brand.
6. **Make Quick Adjust conversational.** It's single-shot append today. A short revision history ("make the title bigger" → "now warmer lighting") would compound edits without re-classifying.
7. **Unify brand context across modes.** Manual mode's `[Brand Context]` block (`Composer.tsx:969-981`) is lighter than Auto's brand block. Consider sharing one builder so manual output is just as on-brand.
8. **Model consistency.** The classifier (`gemini-2.5-pro`) is a generation behind the renderers (`gemini-3-*`). Worth periodically re-evaluating whether the brain should move to the newest reasoning model.
9. **Expand `inspiration_format`.** The format taxonomy is powerful; adding formats (carousel/cover, countdown, "spot the difference," UGC-style) directly widens what Auto Compose can faithfully reproduce.
10. **Surface confidence.** The classifier returns per-asset `confidence` and `is_on_brand`, but the UI doesn't use them. Low-confidence classifications could prompt the user to confirm a role before generating — cheap insurance against a wrong `intent`.

---

## 11. Deep Compose — the Studio roundtable *(implemented 2026-05-29)*

Auto Compose now has a **depth control**: *Quick* (the single-classifier path described above — the default) and **Deep · Studio** (a multi-agent roundtable that deliberates before composing). Deep is non-destructive and fully cached — it runs once per unique references + brand + depth and is reused on every regenerate / Quick Adjust.

**Pipeline when depth = deep:**

```
Classifier ─→ 🆕 ROUNDTABLE ─→ Plan Builder (brief-enriched) ─→ Generate
              (panel → director)
```

**The panel** — `functions/src/routes/artDirection.ts`, `POST /api/art-direction`:
- **Round 1 — six specialists in parallel** on `gemini-3-flash-preview`, each through one lens: Composition & Negative-Space, Subject & Focal Enhancement, Background & Environment, Lighting/Color/Mood, Logo & Brand Placement, Typography & Message Hierarchy. Each returns `{ assessment, directives[], confidence, tensions[] }` — `tensions` are the conflicts it foresees with other concerns.
- **Round 2 — the Creative Director** on `gemini-2.5-pro` (unlimited thinking budget) reads all six notes + the references, resolves the flagged tensions, and returns the structured **`ArtDirectionBrief`** (`director_summary` + `composition` / `negative_space` / `subject` / `background` / `lighting` / `color` / `logo_placement` / `typography` + `resolved_tensions`, plus the raw panel notes for transparency).

**Integration (non-destructive):**
- Orchestration in `Composer.tsx` `autoCompose()`: after classify + logo/font injection, if depth is deep it sets `autoStage='deliberating'`, calls `requestArtDirection()`, and passes the brief into `buildComposePlan`. The brief is cached in `cachedPlan.brief`; the plan fingerprint now includes depth (`v4::`).
- `buildComposePlan` (`src/lib/autoCompose.ts`) weaves the brief in: `director_summary` leads as a "CREATIVE DIRECTION" line right after the MODE header, and the per-dimension directives append as "ART DIRECTION — …" lines **before** OUTPUT. The hard house rules (logo bit-for-bit, no-CTA, brand colors, no name repetition) still lead and govern — the brief refines, never overrides.
- If the roundtable errors, it falls back to the standard plan and warns (graceful degradation).
- The plan-transparency panel renders the Director's brief + collapsible specialist notes.

**Cost:** a fresh Deep compose ≈ classifier + 6 specialists + 1 director (~8 planning calls), then N generations — all cached, so regenerate / Quick-Adjust are free. *Quick* remains the default.

**Asset fidelity & intent (implemented 2026-05-29):**
- **Asset-driven prompting** — a provided asset is explicit intent. The classifier honors **user-applied labels** (renaming a ref `logoSimple`/`fontstyle` is passed in as a strong role hint), and there's a dedicated **`fontstyle`** role so a typography reference is recognized (not dumped into "other"). The Architect/builder then *always* reference provided assets — "use this exact logo @logo," "render display text in the @fontstyle lettering" — automatically, no toggle.
- **Logo = reference-in-prompt** (the user's proven manual approach). The prompt references the brand logo ("use this exact logo @logo, never redraw it"); the model draws it. No compositing by default. *(A `logoLock` compositing path remains dormant in code — `src/lib/logoComposite.ts`, gated by `const logoLockActive = false` — kept available if a guaranteed-paste option is ever wanted.)*
- **QA Critic** — after render, `POST /api/art-direction/critique` (`gemini-3-flash-preview`) compares the image to the source references **including the logo** (logo fidelity → subject fidelity → text → brand colors → no stray CTA). On fail it returns a corrective note and the client does **one corrective retry** (re-generate). Per-tab "Self-review" toggle (default on); fails open.
- `buildComposePlan` subject prompting is hardened: the dish reference is a *real photograph to reproduce faithfully* (don't re-cook / restyle / substitute).

## 12. The Prompt Architect — the convergence point *(implemented 2026-05-29)*

The pipeline used to hand the generator a long list of *abstract* instructions. It now **converges on ONE tight, imperative generation prompt** modeled on the reliable manual pattern ("recreate @inspiration, swap @logo, use @fontstyle, say 'X'"). This is the **foundation** under both Quick and Deep — the roundtable *enriches* it, it doesn't replace it.

**Flow:** `Classifier → (Roundtable — Deep only) → buildComposePlan (deterministic draft) → 🆕 Prompt Architect → [+ MUST guarantees] → Generate`.

- `buildComposePlan` still assembles the rich deterministic draft (it knows every asset's role + the house rules). That draft is now the Architect's **input**, not the final prompt.
- **Prompt Architect** (`POST /api/art-direction/prompt`, `gemini-3-flash-preview`, text-only) distills the draft into one imperative prompt in the proven skeleton (recreate → subject → typography → headline → logo → look → output) **plus a compact JSON spec sheet**. Client `requestPromptArchitect` (`src/lib/autoCompose.ts`); orchestrated in `Composer.tsx` `autoCompose` (stage `'architecting'`).
- **Guarantees:** the client appends a deterministic `MUST:` block (Logo Lock reserve-corner, no-CTA, no brand-name, brand palette) so the Architect can't drop a house rule, and **falls back to the deterministic draft** if the Architect call fails.
- **JSON spec (A/B):** a per-tab "Append JSON spec" toggle appends the Architect's structured spec at generation time (cached in `cachedPlan.spec`, so toggling doesn't re-plan) — to test whether JSON improves adherence for Gemini's image model. Default off; imperative NL is the proven baseline.
- Plan fingerprint bumped to `v5`; runs once per plan (cached). The transparency panel's "Show generated prompt" now shows the Architect's final prompt.

## 13. Quick file / endpoint index

| Concern | Location |
|---|---|
| Content area shell + sub-tab routing | `src/components/ContentCreation.tsx:94-105, 264` |
| Composer component + tab model | `src/components/Composer.tsx` (`ComposerTab` `:93-120`) |
| Auto-Compose orchestration | `src/components/Composer.tsx:521-719` |
| Plan caching / fingerprint | `src/components/Composer.tsx:470-497` |
| Quick Adjust | `src/components/Composer.tsx:721-824` |
| Manual generate | `src/components/Composer.tsx:956-1015` |
| Per-asset captioning | `src/components/Composer.tsx:827-924` |
| **Plan Builder + classifier types** | **`src/lib/autoCompose.ts`** (`buildComposePlan` `:117-305`) |
| Classifier agent (backend) | `functions/src/routes/content.ts:2045` (model `:2185`) |
| Image generator (backend) | `functions/src/routes/content.ts:226` |
| Caption / quote / analyze | `content.ts:1156 / 1388 / 1628 / 1991` |
| Asset / title / remix / extract-bg | `content.ts:381 / 977 / 1710 / 145` |

---

*Maintenance note: file:line references drift as code changes. When in doubt, grep for the function/route name rather than trusting the line number.*
