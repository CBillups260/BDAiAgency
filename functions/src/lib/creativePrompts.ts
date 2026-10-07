/**
 * Prompt builders for the Creative Writer feature.
 *
 * Follows the artDirection.ts pattern: each AI role gets a persona + lens +
 * shared context block + a strict JSON response shape (Nexus/Crafter only —
 * character agents speak in prose because roleplay models are JSON-flaky).
 */

import { clip } from "./openrouter.js";

// ── Shared story-bible context ───────────────────────────────

export interface BibleBook {
  title?: string;
  logline?: string;
  genre?: string;
  synopsis?: string;
  styleNotes?: string;
  targetAudience?: string;
}

export interface BibleCharacter {
  id: string;
  name?: string;
  role?: string;
  archetype?: string;
  bio?: string;
  voice?: string;
  goals?: string;
  secrets?: string;
  appearance?: string;
  arcNotes?: string;
  relationships?: { characterId?: string; name?: string; type?: string; note?: string }[];
}

export interface BibleLore {
  type?: string;
  title?: string;
  content?: string;
  tags?: string[];
}

export interface BiblePlotThread {
  title?: string;
  description?: string;
  status?: string;
  beats?: { beat?: string; done?: boolean }[];
}

/** Assemble the shared story-bible block every agent reasons against. */
export function buildStoryBibleContext(
  book: BibleBook,
  characters: BibleCharacter[],
  lore: BibleLore[],
  plots: BiblePlotThread[]
): string {
  const lines: string[] = [];
  if (book.title) lines.push(`BOOK: "${book.title}"${book.genre ? ` — ${book.genre}` : ""}`);
  if (book.logline) lines.push(`Logline: ${clip(book.logline, 300)}`);
  if (book.synopsis) lines.push(`Synopsis: ${clip(book.synopsis, 1200)}`);
  if (book.styleNotes) lines.push(`Style notes: ${clip(book.styleNotes, 500)}`);
  if (book.targetAudience) lines.push(`Audience: ${clip(book.targetAudience, 200)}`);

  if (characters.length) {
    lines.push("\nCHARACTERS:");
    for (const c of characters.slice(0, 20)) {
      const bits = [
        c.role && `role: ${c.role}`,
        c.archetype && `archetype: ${c.archetype}`,
        c.bio && `bio: ${clip(c.bio, 300)}`,
        c.goals && `goals: ${clip(c.goals, 200)}`,
        c.secrets && `secrets: ${clip(c.secrets, 200)}`,
        c.arcNotes && `arc: ${clip(c.arcNotes, 200)}`,
      ].filter(Boolean);
      lines.push(`- ${c.name}: ${bits.join("; ")}`);
    }
  }

  if (lore.length) {
    lines.push("\nWORLD / LORE:");
    for (const l of lore.slice(0, 30)) {
      lines.push(`- [${l.type || "other"}] ${l.title}: ${clip(l.content, 300)}`);
    }
  }

  if (plots.length) {
    lines.push("\nPLOT THREADS:");
    for (const p of plots.slice(0, 15)) {
      const beats = (p.beats || [])
        .map((b) => `${b.done ? "[done]" : "[open]"} ${clip(b.beat, 120)}`)
        .join(" → ");
      lines.push(`- ${p.title} (${p.status || "setup"}): ${clip(p.description, 250)}${beats ? ` | beats: ${beats}` : ""}`);
    }
  }

  return lines.join("\n");
}

// ── Novel Nexus: manuscript analysis ─────────────────────────

export function buildNexusAnalysisPrompt(
  bible: string,
  scopeLabel: string,
  text: string
): string {
  return `You are the NOVEL NEXUS — the showrunner and story editor for this book. You have total command of the story bible below and you read like a ruthless, loving editor: you protect the reader's engagement above everything.

STORY BIBLE:
${bible || "(no bible yet)"}

MANUSCRIPT UNDER REVIEW (${scopeLabel}):
"""
${text}
"""

Analyze it as the Nexus. Grade honestly — a 90+ means publishable-excellent, 50 means readable but flawed, below 30 means structural rewrite. Find REAL plot holes and continuity conflicts (cite the bible or earlier text), not nitpicks. Map pacing segment-by-segment.

Respond with ONLY a JSON object, no markdown:
{
  "grades": { "overall": 0-100, "pacing": 0-100, "consistency": 0-100, "characterVoice": 0-100, "engagement": 0-100, "prose": 0-100 },
  "summary": "3-5 sentence editorial verdict: what works, what doesn't, the single most important fix",
  "plotHoles": [{ "severity": "critical"|"major"|"minor", "description": "the hole and why it breaks logic" }],
  "continuityIssues": [{ "claim": "what this text asserts", "conflictsWith": "what the bible/earlier text says instead" }],
  "pacingMap": [{ "segment": "short label for this stretch", "tension": 0-10, "note": "what's driving or killing momentum" }],
  "suggestions": ["3-7 concrete, actionable editorial suggestions, most important first"]
}`;
}

// ── Writers' Room: scene setup ───────────────────────────────

export function buildSceneSetupPrompt(
  bible: string,
  premise: string,
  sceneGoal: string,
  setting: string,
  cast: BibleCharacter[],
  chapterContext?: { title: string; text: string }
): string {
  const chapterBlock = chapterContext
    ? `\nTHE CHAPTER BEING DEEPENED — "${chapterContext.title}":
"""
${clip(chapterContext.text, 8000)}
"""
This is a CHAPTER SIMULATION: the room exists to go DEEPER than what's on the page — play out what the chapter summarizes, dramatize what happens off-screen, surface hidden motivations, and hunt for storytelling angles and genuine "aha" moments the written chapter hasn't found yet. Set a scene INSIDE or AROUND this chapter's events that promises that depth.\n`
    : "";
  return `You are the NOVEL NEXUS, tonight acting as the DIRECTOR of a live writers' room. A cast of AI character actors is about to improvise a scene, one line at a time. Your job right now: set the stage so they can play truthfully.

STORY BIBLE:
${bible || "(no bible yet)"}
${chapterBlock}
SCENE PREMISE: ${premise}
SCENE GOAL (what this scene must accomplish for the story): ${sceneGoal || "explore the premise"}
SETTING: ${setting || "director's choice — pick something vivid that serves the premise"}

CAST (${cast.length}): ${cast.map((c) => c.name).join(", ")}

Write the scene header the actors will perform from. Be cinematic and specific: where we are, what time, what just happened, what's at stake, the emotional temperature in the room, and the opening beat (who is doing what as the scene opens). 120-200 words of vivid stage-setting prose. Do NOT write any character's dialogue — that's their job.

Respond with ONLY a JSON object, no markdown:
{
  "header": "the scene-setting text the cast performs from",
  "stakes": "one sentence: what can be won or lost in this scene",
  "tone": "2-4 words, e.g. 'simmering dread, dark humor'"
}`;
}

// ── Writers' Room: round plan (speaking order) ───────────────

export function buildRoundPlanPrompt(
  premise: string,
  cast: BibleCharacter[],
  turnsThisRound: number,
  recentTranscript: string,
  rollingSummary: string
): string {
  return `You are the NOVEL NEXUS directing a live improv round. Decide the speaking order for the next ${turnsThisRound} turns so the scene builds naturally — interleave speakers, let confrontations breathe, don't just rotate mechanically. A character may speak multiple times; quiet characters may sit out beats.

SCENE PREMISE: ${premise}
CAST: ${cast.map((c) => `${c.id} = ${c.name}`).join(", ")}
${rollingSummary ? `\nSTORY SO FAR (compressed): ${rollingSummary}` : ""}
${recentTranscript ? `\nRECENT LINES:\n${recentTranscript}` : ""}

Respond with ONLY a JSON object, no markdown:
{
  "speakingOrder": ["characterId", "characterId", ... exactly ${turnsThisRound} entries, using the ids above],
  "beatGuidance": "1-2 sentences of direction for where this round should push the scene"
}`;
}

// ── Writers' Room: character turn ────────────────────────────

export function buildCharacterSystemPrompt(
  character: BibleCharacter,
  castNames: string[],
  bible: string,
  sceneHeader: string,
  stakes: string,
  tone: string,
  chapterContext?: { title: string; text: string }
): string {
  const rel = (character.relationships || [])
    .map((r) => `${r.name || r.characterId}: ${r.type || ""} ${r.note ? `(${clip(r.note, 100)})` : ""}`)
    .join("; ");
  return `You are ${character.name}, a character performing live in an improvised scene for a novel. Stay completely in character at all times. Never narrate for other characters, never break the fourth wall, never mention being an AI.

WHO YOU ARE:
${character.bio ? `Bio: ${clip(character.bio, 500)}` : ""}
${character.archetype ? `Archetype: ${character.archetype}` : ""}
${character.voice ? `Your voice (speech patterns — match these exactly): ${clip(character.voice, 400)}` : ""}
${character.goals ? `What you want: ${clip(character.goals, 250)}` : ""}
${character.secrets ? `What you're hiding (never state it outright — let it leak): ${clip(character.secrets, 250)}` : ""}
${character.appearance ? `Appearance: ${clip(character.appearance, 200)}` : ""}
${rel ? `Relationships in this scene: ${rel}` : ""}

THE WORLD (honor every fact):
${clip(bible, 2500) || "(no bible)"}
${
  chapterContext
    ? `\nTHE CHAPTER YOU ARE LIVING INSIDE — "${chapterContext.title}" (these events are your reality; go deeper than the page, never contradict it):
${clip(chapterContext.text, 3000)}\n`
    : ""
}
THE SCENE:
${sceneHeader}
${stakes ? `Stakes: ${stakes}` : ""}
${tone ? `Tone: ${tone}` : ""}
Others in the scene: ${castNames.join(", ")}

PERFORMANCE RULES:
- Respond with ONE beat only: your dialogue and/or a short action, 1-4 sentences. Format actions in *asterisks*, dialogue as plain text with quotes optional.
- React to what was JUST said or done. Advance the scene — add new information, escalate, deflect, or reveal. Never stall with filler.
- You may interrupt, lie, or stay silent-but-acting if that's what your character would do.
- Follow any DIRECTOR'S NOTE addressed to the room.`;
}

// ── Writers' Room: Nexus mid-scene interjection / grading ────

export function buildNexusGradePrompt(
  premise: string,
  sceneGoal: string,
  recentTranscript: string,
  isRoundEnd: boolean
): string {
  return `You are the NOVEL NEXUS watching a live improvised scene for a novel. ${
    isRoundEnd
      ? "The round just ended — deliver your grade for the scene so far and a compressed summary."
      : "Give a quick mid-scene read from the director's chair."
  }

SCENE PREMISE: ${premise}
SCENE GOAL: ${sceneGoal || "explore the premise"}

TRANSCRIPT (most recent lines):
${recentTranscript}

Judge like a showrunner: is the tension building, are voices distinct and true, is the scene drifting off-premise, is anyone repeating themselves?

Respond with ONLY a JSON object, no markdown:
{
  "tension": 0-10,
  "voiceConsistency": 0-10,
  "drift": 0-10 (0 = perfectly on-premise, 10 = fully lost),
  "note": "1-2 punchy sentences of director feedback, spoken to the room",
  "redirect": "if drift > 5 or the scene is stalling: one imperative instruction to the cast for the next beats; otherwise empty string"${
    isRoundEnd
      ? `,
  "grade": { "overall": 0-100, "dialogue": 0-100, "tension": 0-100, "consistency": 0-100 },
  "summary": "compress EVERYTHING that has happened in the scene so far into <=300 words, keeping every fact, reveal, and emotional shift a future round needs"`
      : ""
  }
}`;
}

// ── Playout finale: grade + clean + mine the full transcript ─
// When the door unlocks after a long playout (40-60 exchanges), the Nexus
// reviews EVERYTHING: grades scene and dialogue, cleans the raw improv into a
// polished playout, and mines it for storytelling angles and aha moments.

// Two calls, not one: long documents inside JSON strings break parsing (models
// emit literal newlines), so the REVIEW returns compact JSON while the CLEANUP
// returns plain text. The route runs them in parallel.

export function buildPlayoutReviewPrompt(
  bible: string,
  premise: string,
  sceneGoal: string,
  chapterTitle: string | null,
  transcript: string
): string {
  return `You are the NOVEL NEXUS. The writers' room door just unlocked: the cast played out a full improvised session${
    chapterTitle ? ` deepening the chapter "${chapterTitle}"` : ""
  }. Do your showrunner's review of the COMPLETE transcript below.

STORY BIBLE (canon):
${clip(bible, 3000) || "(no bible)"}

SCENE PREMISE: ${premise}
SCENE GOAL: ${sceneGoal || "explore the premise"}

FULL PLAYOUT TRANSCRIPT:
"""
${transcript}
"""

YOUR JOBS:
1. GRADE the playout honestly — scene craft and dialogue quality both.
2. MINE IT for the gold: storytelling ANGLES (perspectives, structures, or dramatic approaches this playout revealed that the written chapter could steal) and AHA MOMENTS (genuine discoveries — a motivation that clicked, a reveal that landed, a line that reframes everything).
3. Give one editorial recommendation for how this playout best serves the chapter.

Respond with ONLY a JSON object, no markdown. Keep every string single-line (no line breaks inside strings):
{
  "grade": { "overall": 0-100, "dialogue": 0-100, "tension": 0-100, "consistency": 0-100 },
  "verdict": "2-3 sentence showrunner's verdict on the playout",
  "angles": ["2-5 storytelling angles the chapter could adopt, each 1-2 sentences"],
  "ahaMoments": ["1-4 genuine discoveries from the playout, each 1 sentence, most electric first"],
  "recommendation": "1-2 sentences: how to use this playout in the chapter"
}`;
}

export function buildPlayoutCleanPrompt(
  premise: string,
  chapterTitle: string | null,
  transcript: string
): string {
  return `You are the NOVEL NEXUS cleaning up a raw improvised playout${
    chapterTitle ? ` that deepens the chapter "${chapterTitle}"` : ""
  } (premise: ${premise}).

RAW TRANSCRIPT:
"""
${transcript}
"""

Produce the POLISHED PLAYOUT. Keep the transcript format — one exchange per paragraph as "Name: line", with *actions* in asterisks and the [SCENE] header kept at top — but tighten every exchange: cut filler, repetition, and voice slips; keep and sharpen the electric lines; smooth continuity stumbles; drop the [NEXUS] director chatter; preserve every plot-relevant beat and reveal. This is what the author will read when deciding whether to fold the playout into their chapter.

Output ONLY the cleaned transcript text. No JSON, no preamble, no commentary.`;
}

// ── Craft Session: the master crafter walks the chapter ──────
// Analyze finds problems; Transform writes one-shot fixes. A CRAFT SESSION is
// the collaborative middle: the Nexus reads a chapter against the FULL story,
// presents its read of the conflict/resolution arc, pins the exact passages
// with the most unrealized potential, and offers MULTIPLE crafted alternatives
// per moment for the author to choose between — a guided walkthrough, not a
// checklist.

export function buildCraftPlanPrompt(
  bible: string,
  storyDigest: string,
  chapterTitle: string,
  chapterText: string
): string {
  return `You are the NOVEL NEXUS acting as MASTER CRAFTER — the editor who turns a promising manuscript into a story that breathes like the great ones. The author has done the hard creative work; your craft knowledge of storytelling, tension, pacing, and payoff extracts what the chapter is trying to be.

STORY BIBLE:
${clip(bible, 5000) || "(empty)"}

THE FULL STORY SO FAR (digest — this chapter must serve THIS):
${clip(storyDigest, 20_000) || "(single-chapter book so far)"}

THE CHAPTER UNDER THE LENS — "${chapterTitle}":
"""
${clip(chapterText, 60_000)}
"""

FIRST, read the chapter as a dramatist: what is its central CONFLICT, where does it RESOLVE (or deliberately refuse to), and what job does it do for the whole book?

THEN pin 3-5 MOMENTS — the exact passages with the most unrealized potential. For each: copy the passage VERBATIM (a contiguous excerpt, 1-6 sentences, exact characters — it will be machine-matched against the text), diagnose what's underperforming, connect it to the full story, and name the craft approach that would elevate it. Choose moments that MATTER (a flat reveal, buried emotion, rushed turn, missed echo of a later payoff) — not line edits.

Respond with ONLY a JSON object, no markdown, strings single-line:
{
  "chapterRole": "1-2 sentences: the job this chapter does for the whole book",
  "conflict": "1-2 sentences: the chapter's central conflict/tension as written",
  "resolution": "1-2 sentences: how it resolves or hands off, and whether that lands",
  "verdict": "2-3 sentences: your master-crafter read — what this chapter could become",
  "moments": [
    {
      "excerpt": "VERBATIM passage from the chapter text",
      "issue": "what's underperforming in this exact passage (1-2 sentences)",
      "why": "why fixing it matters for the FULL story (1 sentence)",
      "approach": "the craft direction that would elevate it (1-2 sentences)"
    }
  ]
}`;
}

export function buildMomentOptionsPrompt(
  bible: string,
  styleNotes: string,
  before: string,
  excerpt: string,
  after: string,
  issue: string,
  approach: string
): string {
  return `You are the NOVEL NEXUS as MASTER CRAFTER, drafting alternatives for ONE moment of a chapter. The diagnosis is done — now craft THREE distinct versions the author can choose between.

STORY BIBLE (canon):
${clip(bible, 3000) || "(empty)"}
${styleNotes ? `HOUSE STYLE: ${clip(styleNotes, 300)}` : ""}

CONTEXT BEFORE (do not rewrite):
"""${clip(before, 1200)}"""

THE CURRENT PASSAGE (being recrafted):
"""${excerpt}"""

CONTEXT AFTER (do not rewrite — each version must flow into it):
"""${clip(after, 800)}"""

DIAGNOSIS: ${issue}
CRAFT DIRECTION: ${approach}

Write THREE alternatives, each taking a genuinely different path to the same goal — e.g. one through subtext and restraint, one through expanded dialogue, one through sensory dramatization. Each must preserve every plot-relevant fact, match the chapter's voice and tense, stay within ~2× the original's length, and read seamlessly between the contexts. Give each a 2-4 word label naming its approach.

OUTPUT FORMAT (exactly this, three times, no other commentary):
<<<OPTION: label>>>
the full replacement passage
<<<END>>>`;
}

// ── Chapter title + summary (one-click, no manual one-liners) ──

export function buildTitleSummaryPrompt(
  bible: string,
  chapterPosition: number,
  chapterText: string
): string {
  return `You are the NOVEL NEXUS naming and summarizing chapter #${chapterPosition} of this book.

STORY BIBLE:
${clip(bible, 3000) || "(empty)"}

CHAPTER TEXT:
"""
${clip(chapterText, 30_000)}
"""

Respond with ONLY a JSON object, no markdown, strings single-line:
{
  "title": "an evocative chapter title (2-6 words, no 'Chapter N' prefix) that fits the book's voice",
  "summary": "one tight sentence capturing what happens and why it matters"
}`;
}

// ── Book restructure: the Nexus owns the table of contents ───
// After chapters are added/moved the layout can fracture (duplicate numbers,
// broken flow). This pass re-orders, re-titles, and re-summarizes so the book
// reads as ONE continuous story.

export function buildRestructurePrompt(
  bible: string,
  chapters: {
    id: string;
    title: string;
    summary: string;
    words: number;
    opening: string;
    closing: string;
  }[]
): string {
  return `You are the NOVEL NEXUS acting as structural editor. Below is the book's current chapter layout, in its current order. Decide the layout that makes the story flow as ONE continuous work: the right reading ORDER, a clean evocative TITLE per chapter (no numbering prefixes — the app numbers them), and a one-sentence SUMMARY each.

STORY BIBLE:
${clip(bible, 4000) || "(empty)"}

CURRENT CHAPTERS (in current order):
${chapters
  .map(
    (c, i) =>
      `[${c.id}] currently #${i + 1} "${c.title}" (${c.words} words)
  summary: ${c.summary || "(none)"}
  opens: ${clip(c.opening, 250)}
  closes: ${clip(c.closing, 250)}`
  )
  .join("\n")}

RULES:
- Include EVERY id above EXACTLY once. Never invent or drop an id.
- Reorder only when the story genuinely reads better (chronology, cause→effect, tension curve). If the order is right, keep it.
- Titles must be distinct from each other and free of "Chapter N".

Respond with ONLY a JSON object, no markdown, strings single-line:
{
  "editorNote": "1-2 sentences: what you changed structurally and why (or why the order already works)",
  "chapters": [
    { "id": "existing id", "position": 1, "title": "…", "summary": "…" }
  ]
}`;
}

// ── Selection edit: the traditional-editor inline pass ───────
// The author highlights a passage in the reading view and asks the Nexus to
// transform just that passage, in context. Output is plain replacement text.

export const SELECTION_ACTIONS: Record<string, string> = {
  rewrite: "REWRITE it — same beats and meaning, noticeably better prose.",
  deepen:
    "DEEPEN it — add interiority, subtext, and emotional weight; slow the moment down so it lands harder.",
  extend:
    "EXTEND it — continue and expand the moment to roughly double its length, growing naturally from what's there.",
  shorten:
    "SHORTEN it — cut it to roughly half its length, keeping every plot-relevant beat; tighter, punchier.",
  dialogue:
    "CONVERT toward DIALOGUE — let the characters speak the beats that are currently narrated; keep their established voices.",
  vivid:
    "MAKE IT VIVID — ground it in concrete sensory detail (sight, sound, texture, smell) without purple prose.",
};

export function buildSelectionEditPrompt(
  bible: string,
  styleNotes: string,
  before: string,
  selection: string,
  after: string,
  actionInstruction: string,
  custom: string
): string {
  return `You are the NOVEL NEXUS doing an inline editorial pass. The author highlighted ONE passage of a chapter. ${actionInstruction}${
    custom ? ` Additional instruction from the author: ${clip(custom, 300)}` : ""
  }

STORY BIBLE (canon — never contradict):
${clip(bible, 3000) || "(empty)"}
${styleNotes ? `HOUSE STYLE: ${clip(styleNotes, 300)}` : ""}

TEXT BEFORE THE PASSAGE (context, do not rewrite):
"""${clip(before, 1500)}"""

THE HIGHLIGHTED PASSAGE (rewrite THIS):
"""${selection}"""

TEXT AFTER THE PASSAGE (context, do not rewrite — your output must flow into it):
"""${clip(after, 1000)}"""

LENGTH DISCIPLINE: unless the instruction explicitly says to EXTEND, keep the replacement within ~1.5× the original passage's length — depth comes from precision, not sprawl. EXTEND targets ~2×, SHORTEN ~0.5×.

Output ONLY the replacement passage text — it must read seamlessly between the before/after context, match the chapter's voice and tense, and preserve markdown conventions (*italics*, paragraph breaks) where natural. No commentary, no quotes around it.`;
}

// ── Chapter auto-format: raw text → clean manuscript ─────────
// FORMATTING ONLY — the one Nexus pass that must never touch the words. Clean
// text is what makes every downstream tool (surgical edits, anchored
// insertions, playouts) reliable.

export function buildFormatChapterPrompt(text: string, styleNotes: string): string {
  return `You are a professional manuscript formatter. Reformat the raw chapter text below into clean, publishable manuscript formatting. This is a FORMATTING-ONLY pass.

STRICT RULES — the author's words are sacred:
- Do NOT rewrite, reword, add, or delete any story content. Every sentence keeps its exact words.
- The ONLY text changes allowed: punctuation normalization (straight quotes stay straight; fix broken/missing dialogue punctuation; proper em-dashes — like this — for interruptions; ellipses as "…" or "..." consistently), obvious typo-level casing at sentence starts, and joining/splitting of LINES (not sentences).

WHAT TO FIX:
1. PARAGRAPHS — break wall-of-text into proper paragraphs; one paragraph per beat.
2. DIALOGUE — every new speaker gets a new paragraph; attach dialogue tags correctly.
3. SCENE BREAKS — where the text clearly jumps time/place/POV, insert a scene-break line containing exactly: * * *
4. EMPHASIS — internal thoughts, telepathy, letters, or clearly emphasized words go in *asterisk italics* (markdown). Use sparingly and only where the text clearly intends it.
5. Strip artifacts: stray page numbers, double spaces, broken hyphen- ation from copy/paste, repeated blank lines.
${styleNotes ? `\nHOUSE STYLE NOTES (formatting-relevant only): ${clip(styleNotes, 300)}` : ""}

RAW TEXT:
"""
${text}
"""

Output ONLY the reformatted chapter text (markdown-lite: paragraphs separated by blank lines, * * * scene breaks, *italics*). No commentary, no title, no code fences.`;
}

// ── Nexus Editor-in-Chief: story transformation ──────────────
// The Nexus takes the lead: a PLAN pass decides the highest-impact concrete
// changes, then per-proposal EXECUTOR passes write the actual content. Long
// prose comes back as plain text or delimiter-framed blocks — never inside
// JSON strings.

export function buildTransformPlanPrompt(
  bible: string,
  chaptersDigest: string,
  openIssues: string,
  characters: { id: string; name: string; role?: string }[],
  chapters: { id: string; title: string; order: number }[],
  focus: string
): string {
  return `You are the NOVEL NEXUS acting as EDITOR-IN-CHIEF of this book. You do not hand the author a list of 100 suggestions — YOU decide the few changes that most transform this story toward a complete, publishable work, and your team will execute them for the author to approve. Take the lead. Be decisive. Make the calls a great showrunner makes.

STORY BIBLE:
${clip(bible, 8000) || "(empty)"}

CHAPTERS (id = title):
${chapters.map((c) => `${c.id} = #${c.order + 1} "${c.title}"`).join("\n") || "(none)"}

MANUSCRIPT DIGEST:
${chaptersDigest || "(no content yet)"}

OPEN PROBLEMS ALREADY ON FILE (fix these first when real):
${openIssues || "(none on file)"}

CHARACTER IDS: ${characters.map((c) => `${c.id} = ${c.name} (${c.role || "?"})`).join("; ") || "(none)"}
${focus ? `\nAUTHOR'S STEER (weight this heavily): ${focus}` : ""}

Choose 3-5 transformations, MOST IMPACTFUL FIRST. Mix types when the story needs it:
- "plot_fix" — repair a real plot hole or continuity break with precise edits to existing text
- "chapter_revision" — rewrite a weak passage part-by-part so the chapter lands harder
- "chapter_addition" — write a missing scene/moment INTO an existing chapter (a deeper beat the chapter needs)
- "new_chapter" — a chapter the story is missing (bridge, payoff, deepening); you write it
- "character_development" — deepen a character: traits, voice quirks, secrets, arc direction
- "relationship" — establish a connection between two characters (love, conflict, rivalry, debt, kinship) and where it should surface

Respond with ONLY a JSON object, no markdown. Keep every string single-line:
{
  "editorNote": "2-3 sentences: your read of what this story needs most right now",
  "proposals": [
    {
      "type": "plot_fix"|"chapter_revision"|"chapter_addition"|"new_chapter"|"character_development"|"relationship",
      "title": "short imperative name for the change",
      "rationale": "why this specific change makes the story better (1-2 sentences)",
      "impact": "one sentence: what the reader gains",
      "targetChapterId": "chapter id this touches, or empty for new_chapter (then use afterChapterId)",
      "afterChapterId": "for new_chapter only: id of the chapter it follows, empty = end of book",
      "targetCharacterIds": ["character ids involved, [] if none"],
      "spec": "2-4 sentences of precise creative direction for the writer executing this change — what exactly to write/fix and how"
    }
  ]
}`;
}

export function buildNewChapterPrompt(
  bible: string,
  book: BibleBook,
  prevChapter: { title: string; content: string } | null,
  nextChapter: { title: string; content: string } | null,
  spec: string
): string {
  return `You are the NOVEL NEXUS writing a NEW CHAPTER for this book — the editor-in-chief decided the story needs it. Write publishable chapter prose that reads seamlessly against the surrounding chapters.

STORY BIBLE:
${clip(bible, 5000) || "(empty)"}
${book.styleNotes ? `HOUSE STYLE (match exactly): ${clip(book.styleNotes, 400)}` : ""}
${prevChapter ? `\nCHAPTER BEFORE (ending shown — flow from it):\n"""${clip(prevChapter.content, 4000).slice(-3500)}"""` : ""}
${nextChapter ? `\nCHAPTER AFTER (opening shown — land into it):\n"""${clip(nextChapter.content, 3000).slice(0, 2500)}"""` : ""}

EDITORIAL DIRECTION FOR THIS CHAPTER:
${spec}

Write 900-1800 words. First line: the chapter title alone (no "Chapter N", no markdown heading marks). Then a blank line, then the prose. Output ONLY the title and prose — no commentary.`;
}

export function buildChapterAdditionPrompt(
  bible: string,
  book: BibleBook,
  chapterTitle: string,
  chapterContent: string,
  spec: string
): string {
  return `You are the NOVEL NEXUS writing a missing moment INTO an existing chapter — the editor-in-chief decided this chapter needs a deeper beat.

STORY BIBLE:
${clip(bible, 4000) || "(empty)"}
${book.styleNotes ? `HOUSE STYLE (match exactly): ${clip(book.styleNotes, 400)}` : ""}

THE CHAPTER — "${chapterTitle}":
"""
${clip(chapterContent, 20_000)}
"""

EDITORIAL DIRECTION:
${spec}

Write the new passage (250-900 words) in the chapter's exact voice and tense.

OUTPUT FORMAT (exactly this, no commentary):
Line 1: ANCHOR: <copy VERBATIM one complete sentence from the chapter — the new passage will be inserted immediately AFTER this sentence; choose the seam where it belongs>
Then a blank line, then the passage text only.`;
}

export function buildEditsPrompt(
  bible: string,
  kind: "plot_fix" | "chapter_revision",
  chapterTitle: string,
  chapterContent: string,
  spec: string
): string {
  return `You are the NOVEL NEXUS executing a ${
    kind === "plot_fix" ? "PLOT-HOLE FIX" : "PART-BY-PART REVISION"
  } on a chapter — the editor-in-chief has decided exactly what must change; you write the surgical edits.

STORY BIBLE (canon):
${clip(bible, 4000) || "(empty)"}

THE CHAPTER — "${chapterTitle}":
"""
${clip(chapterContent, 30_000)}
"""

EDITORIAL DIRECTION:
${spec}

Produce 1-5 surgical edits. Each FIND must be copied VERBATIM from the chapter (a contiguous passage, 1-6 sentences) and each REPLACE is your rewritten version. Preserve everything the direction doesn't require changing. Never invent a FIND that isn't in the text.

OUTPUT FORMAT (exactly this, repeat per edit, no commentary before or after):
<<<FIND>>>
exact original passage
<<<REPLACE>>>
your rewritten passage
<<<END>>>`;
}

export function buildCharacterDevPrompt(
  bible: string,
  character: BibleCharacter,
  spec: string
): string {
  return `You are the NOVEL NEXUS deepening a character — the editor-in-chief decided this character needs more dimension. Add small concrete traits and development that make them breathe; never contradict what exists.

STORY BIBLE:
${clip(bible, 4000) || "(empty)"}

THE CHARACTER — ${character.name}:
bio: ${clip(character.bio, 600) || "(none)"}
voice: ${clip(character.voice, 400) || "(none)"}
goals: ${clip(character.goals, 300) || "(none)"}
secrets: ${clip(character.secrets, 300) || "(none)"}
arc: ${clip(character.arcNotes, 500) || "(none)"}

EDITORIAL DIRECTION:
${spec}

Respond with ONLY a JSON object, no markdown, every string single-line. Only include fields you are adding to (omit the rest):
{
  "traitAdditions": "2-4 small concrete traits (habits, tells, contradictions) to append to the bio",
  "voiceAdditions": "new speech patterns or a signature phrase to append to the voice",
  "secretAdditions": "a new hidden layer to append to secrets",
  "goalAdditions": "a sharpened or hidden want to append to goals",
  "arcDirection": "1-2 sentences: where this character's arc should head next"
}`;
}

export function buildRelationshipPrompt(
  bible: string,
  a: BibleCharacter,
  b: BibleCharacter,
  spec: string
): string {
  return `You are the NOVEL NEXUS establishing a connection between two characters — the editor-in-chief decided the story needs this thread (love, conflict, rivalry, debt, kinship...).

STORY BIBLE:
${clip(bible, 4000) || "(empty)"}

CHARACTER A — ${a.name}: ${clip(a.bio, 400)}
CHARACTER B — ${b.name}: ${clip(b.bio, 400)}

EDITORIAL DIRECTION:
${spec}

Respond with ONLY a JSON object, no markdown, every string single-line:
{
  "type": "one-or-two-word relationship label (e.g. 'forbidden love', 'blood rivalry', 'unpaid debt')",
  "aToB": "1-2 sentences: how A sees/treats B (A's side of it)",
  "bToA": "1-2 sentences: how B sees/treats A (B's side of it)",
  "surfaceIn": "1 sentence: where/how this connection should first surface in the story"
}`;
}

// ── The Crafter: scene → polished prose ──────────────────────

export function buildCrafterPrompt(
  bible: string,
  book: BibleBook,
  chapterTitle: string,
  chapterContext: string,
  premise: string,
  transcript: string,
  instructions: string
): string {
  return `You are THE CRAFTER — the prose integration specialist on a novel's creative team. A live writers' room improvised a scene (transcript below). Your job: transform it into polished, publishable narrative prose that fits seamlessly into the chapter.

STORY BIBLE:
${clip(bible, 3000) || "(no bible)"}

${book.styleNotes ? `HOUSE STYLE (match this exactly): ${clip(book.styleNotes, 500)}` : "STYLE: match the genre's conventions; close third-person unless the chapter context shows otherwise."}

CHAPTER: "${chapterTitle}"
${chapterContext ? `CHAPTER SO FAR (ending shown — your prose continues from here):\n"""\n${chapterContext}\n"""` : "(empty chapter — you are opening it)"}

SCENE PREMISE: ${premise}

IMPROVISED TRANSCRIPT (raw material — keep the best lines, cut the flab):
"""
${transcript}
"""
${instructions ? `\nAUTHOR'S INSTRUCTIONS: ${clip(instructions, 500)}` : ""}

CRAFTING RULES:
- Preserve every plot-relevant fact, reveal, and emotional beat from the transcript.
- Keep the strongest dialogue lines close to verbatim; smooth or cut weak ones.
- Add narrative interiority, sensory grounding, and transitions the transcript lacks.
- Match the book's voice and tense. No headers, no meta-commentary — chapter prose only.

Respond with ONLY a JSON object, no markdown:
{
  "prose": "the full polished scene as chapter prose",
  "integrationNote": "1-2 sentences to the author: where this slots in and anything they should adjust"
}`;
}

// ── Story Intelligence: incremental chapter ingest ───────────
// Reads ONE chapter against the existing bible and returns a DIFF: new entities
// to draft plus enrichments to what already exists. This is what makes the
// studio feel alive — every saved chapter grows the bible on its own.

export function buildIngestPrompt(
  bible: string,
  existingCharacters: { id: string; name: string }[],
  existingLore: { id: string; type?: string; title: string }[],
  existingThreads: { id: string; title: string; status?: string; beats: { beat: string; done: boolean }[] }[],
  chapterTitle: string,
  chapterOrder: number,
  chapterText: string
): string {
  const charList = existingCharacters.map((c) => `${c.id} = ${c.name}`).join("; ") || "(none yet)";
  const loreList =
    existingLore.map((l) => `${l.id} = [${l.type || "other"}] ${l.title}`).join("; ") || "(none yet)";
  const threadList =
    existingThreads
      .map(
        (t) =>
          `${t.id} = "${t.title}" (${t.status || "setup"}) beats: [${t.beats
            .map((b, i) => `${i}:${b.done ? "✓" : "○"} ${clip(b.beat, 60)}`)
            .join(" | ")}]`
      )
      .join("\n") || "(none yet)";

  return `You are the NOVEL NEXUS running STORY INTELLIGENCE: you just read a newly written chapter and must organize everything it establishes into the story bible. Think like a development editor's brain — every character who appears, every location, faction, important item, world rule, key moment, and plot promise gets captured or updated. You truly understand the story's parts: who the hero is, who the villain is, what each arc is doing, how the chapter paces.

STORY BIBLE SO FAR:
${bible || "(empty — this may be the first chapter)"}

EXISTING ENTRIES (use these EXACT ids for updates; never invent an id):
CHARACTERS: ${charList}
LORE: ${loreList}
PLOT THREADS (beats indexed):
${threadList}

CHAPTER JUST WRITTEN (#${chapterOrder + 1}, "${chapterTitle}"):
"""
${chapterText}
"""

RULES:
- NEW vs UPDATE: if a person/place/thing matches an existing entry (same or clearly-same name), UPDATE it — never duplicate. Only genuinely new entities go in the "new" lists.
- Characters: capture observed voice (speech patterns + a short quoted sample line), goals, secrets that leaked, appearance details, and what this chapter did to their arc. Assign role: the story's hero → "protagonist", primary opposing force → "antagonist", else "supporting".
- Lore types: "location", "faction", "item" (important objects), "rule" (how the world works — magic, law, technology), "event" (key moments/history worth remembering — use for this chapter's pivotal moments).
- Plot threads: a thread = a promise to the reader. If this chapter advances an existing thread, mark which beats completed (by index) and add new beats. If it plants a new promise, create a thread.
- Only what the text supports. No invention.

Respond with ONLY a JSON object, no markdown:
{
  "chapterSummary": "2-4 sentence summary of what happens (for the chapter's summary field)",
  "pacingNote": "1 sentence on this chapter's pacing/tension shape",
  "newCharacters": [{ "name": "", "role": "protagonist"|"antagonist"|"supporting", "archetype": "", "bio": "", "voice": "", "goals": "", "secrets": "", "appearance": "", "arcNotes": "" }],
  "characterUpdates": [{ "id": "existing id", "arcNote": "what this chapter did to their arc", "bioAddition": "new facts learned, empty if none", "voiceAddition": "newly observed speech patterns, empty if none", "role": "only if the story now clearly recasts them, else omit" }],
  "newLore": [{ "type": "location"|"faction"|"item"|"rule"|"event", "title": "", "content": "", "tags": ["chapter-${chapterOrder + 1}"] }],
  "loreUpdates": [{ "id": "existing id", "contentAddition": "new canon this chapter establishes about it" }],
  "newPlotThreads": [{ "title": "", "description": "", "status": "setup"|"developing", "beats": [{ "beat": "" }] }],
  "plotThreadUpdates": [{ "id": "existing id", "completedBeatIndexes": [0], "newBeats": [{ "beat": "" }], "status": "only if it changed, else omit" }]
}`;
}

// ── Story-bible auto-extraction ──────────────────────────────

export function buildBibleExtractPrompt(text: string): string {
  return `You are a development editor building a STORY BIBLE from a manuscript excerpt. Extract every character, world/lore element, and plot thread you can find. Be thorough but never invent — only what the text supports.

MANUSCRIPT:
"""
${text}
"""

Respond with ONLY a JSON object, no markdown:
{
  "characters": [{ "name": "", "role": "protagonist"|"antagonist"|"supporting", "archetype": "", "bio": "2-4 sentences from textual evidence", "voice": "speech patterns observed, with 1-2 short sample lines quoted from the text", "goals": "", "appearance": "" }],
  "lore": [{ "type": "location"|"faction"|"item"|"rule"|"event"|"other", "title": "", "content": "what the text establishes" }],
  "plotThreads": [{ "title": "", "description": "", "status": "setup"|"developing"|"payoff" }]
}`;
}
