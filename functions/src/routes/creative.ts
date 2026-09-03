import { Router } from "express";
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getDownloadURL } from "firebase-admin/storage";
import OpenAI from "openai";

import { db, storageBucket } from "../lib/firebase-admin.js";
import type { AuthedRequest } from "../lib/auth.js";
import {
  openrouterChat,
  extractJsonObject,
  clip,
  type OpenRouterMessage,
} from "../lib/openrouter.js";
import {
  buildStoryBibleContext,
  buildNexusAnalysisPrompt,
  buildSceneSetupPrompt,
  buildRoundPlanPrompt,
  buildCharacterSystemPrompt,
  buildNexusGradePrompt,
  buildCrafterPrompt,
  buildBibleExtractPrompt,
  buildIngestPrompt,
  buildPlayoutReviewPrompt,
  buildPlayoutCleanPrompt,
  buildTransformPlanPrompt,
  buildNewChapterPrompt,
  buildChapterAdditionPrompt,
  buildEditsPrompt,
  buildCharacterDevPrompt,
  buildRelationshipPrompt,
  buildFormatChapterPrompt,
  buildTitleSummaryPrompt,
  buildRestructurePrompt,
  buildSelectionEditPrompt,
  buildCraftPlanPrompt,
  buildMomentOptionsPrompt,
  SELECTION_ACTIONS,
  type BibleCharacter,
} from "../lib/creativePrompts.js";

const router = Router();

/**
 * Creative Writer — the book-writing studio backend.
 *
 * Novel Nexus (showrunner/editor), the Writers' Room roundtable (5–8 character
 * agents improvising a scene turn-by-turn), and the Crafter (scene → polished
 * chapter prose). All chat goes through OpenRouter so any model id works.
 *
 * The roundtable runs ONE round per request and streams turns to the client by
 * writing each turn doc to creative_sessions/{id}/turns as it lands — the UI
 * subscribes with onSnapshot, so no SSE is needed. Rounds chain via repeated
 * calls ("Continue round"), which keeps every round well inside the function's
 * 540s budget.
 */

const C = {
  books: "books",
  chapters: "book_chapters",
  drafts: "book_drafts",
  characters: "book_characters",
  lore: "book_lore",
  plots: "book_plot_threads",
  scenes: "book_scenes",
  sessions: "creative_sessions",
  reports: "nexus_reports",
  proposals: "nexus_proposals",
  craftPlans: "craft_plans",
} as const;

export const DEFAULT_NEXUS_MODEL = "moonshotai/kimi-k3";
export const DEFAULT_CHARACTER_MODEL = "nousresearch/hermes-3-llama-3.1-70b";

/** Grade/interject cadence and per-round bounds. */
const NEXUS_INTERJECT_EVERY = 6;
const DEFAULT_TURNS_PER_ROUND = 12;
const MAX_TURNS_PER_ROUND = 24;
/** Leave ~2 min of headroom under the 540s function timeout. */
const ROUND_WALL_CLOCK_MS = 420_000;

// ── Shared loaders ───────────────────────────────────────────

async function loadBookBundle(bookId: string) {
  const [bookSnap, charsSnap, loreSnap, plotsSnap] = await Promise.all([
    db.collection(C.books).doc(bookId).get(),
    db.collection(C.characters).where("bookId", "==", bookId).get(),
    db.collection(C.lore).where("bookId", "==", bookId).get(),
    db.collection(C.plots).where("bookId", "==", bookId).get(),
  ]);
  if (!bookSnap.exists) throw Object.assign(new Error("Book not found."), { status: 404 });
  const book = { id: bookSnap.id, ...bookSnap.data() } as any;
  const characters = charsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as BibleCharacter[];
  const lore = loreSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
  const plots = plotsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
  const bible = buildStoryBibleContext(book, characters, lore, plots);
  return { book, characters, lore, plots, bible };
}

function normalizeGrades(g: any) {
  const n = (v: any) => (typeof v === "number" ? Math.max(0, Math.min(100, Math.round(v))) : 0);
  return {
    overall: n(g?.overall),
    pacing: n(g?.pacing),
    consistency: n(g?.consistency),
    characterVoice: n(g?.characterVoice),
    engagement: n(g?.engagement),
    prose: n(g?.prose),
  };
}

// ── POST /api/creative/analyze — Novel Nexus manuscript analysis ──

router.post("/analyze", async (req: AuthedRequest, res) => {
  try {
    const { bookId, chapterId, scope = "chapter", model } = req.body as {
      bookId?: string;
      chapterId?: string;
      scope?: "chapter" | "book";
      model?: string;
    };
    if (!bookId) return res.status(400).json({ error: "bookId is required." });
    if (scope === "chapter" && !chapterId)
      return res.status(400).json({ error: "chapterId is required for chapter scope." });

    const { book, bible } = await loadBookBundle(bookId);
    const nexusModel = model || book.nexusModel || DEFAULT_NEXUS_MODEL;

    let scopeLabel = "";
    let text = "";

    if (scope === "chapter") {
      const chapSnap = await db.collection(C.chapters).doc(chapterId as string).get();
      if (!chapSnap.exists) return res.status(404).json({ error: "Chapter not found." });
      const chap = chapSnap.data() as any;
      scopeLabel = `Chapter: "${chap.title || "Untitled"}"`;
      text = clip(chap.content || "", 120_000);
      if (!text.trim())
        return res.status(400).json({ error: "This chapter has no content to analyze yet." });
    } else {
      // Book scope: condense long chapters in parallel, then analyze the digest
      // (the artDirection specialists→director shape).
      const chapsSnap = await db
        .collection(C.chapters)
        .where("bookId", "==", bookId)
        .get();
      const chapters = chapsSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((ch) => (ch.content || "").trim())
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      if (chapters.length === 0)
        return res.status(400).json({ error: "No chapters with content to analyze yet." });

      const digests = await Promise.all(
        chapters.map(async (ch) => {
          const content: string = ch.content || "";
          if (content.length <= 6000) return { title: ch.title, digest: content };
          try {
            const { text: summary } = await openrouterChat({
              model: nexusModel,
              messages: [
                {
                  role: "user",
                  content: `Condense this novel chapter to <=500 words, preserving every plot event, reveal, character beat, and any continuity-relevant detail (names, dates, injuries, objects, promises). No commentary.\n\n"""${clip(content, 90_000)}"""`,
                },
              ],
              temperature: 0.2,
              maxTokens: 900,
            });
            return { title: ch.title, digest: summary };
          } catch {
            return { title: ch.title, digest: clip(content, 6000) };
          }
        })
      );
      scopeLabel = `Full book (${chapters.length} chapters, condensed)`;
      text = digests
        .map((d, i) => `── Chapter ${i + 1}: "${d.title || "Untitled"}" ──\n${d.digest}`)
        .join("\n\n");
    }

    const { text: raw, tokensUsed } = await openrouterChat({
      model: nexusModel,
      messages: [{ role: "user", content: buildNexusAnalysisPrompt(bible, scopeLabel, text) }],
      temperature: 0.4,
      maxTokens: 4000,
      jsonMode: true,
    });
    const parsed = extractJsonObject(raw);
    if (!parsed.grades && !parsed.summary)
      return res.status(422).json({ error: "The Nexus could not produce an analysis. Try again." });

    const report = {
      bookId,
      ownerUid: req.uid || "",
      scope,
      chapterId: chapterId || null,
      model: nexusModel,
      grades: normalizeGrades(parsed.grades),
      summary: clip(parsed.summary, 1500),
      plotHoles: Array.isArray(parsed.plotHoles)
        ? parsed.plotHoles.slice(0, 12).map((p: any) => ({
            severity: ["critical", "major", "minor"].includes(p?.severity) ? p.severity : "minor",
            description: clip(p?.description, 500),
          }))
        : [],
      continuityIssues: Array.isArray(parsed.continuityIssues)
        ? parsed.continuityIssues.slice(0, 12).map((ci: any) => ({
            claim: clip(ci?.claim, 300),
            conflictsWith: clip(ci?.conflictsWith, 300),
            status: "open",
          }))
        : [],
      pacingMap: Array.isArray(parsed.pacingMap)
        ? parsed.pacingMap.slice(0, 24).map((s: any) => ({
            segment: clip(s?.segment, 120),
            tension: typeof s?.tension === "number" ? Math.max(0, Math.min(10, s.tension)) : 5,
            note: clip(s?.note, 300),
          }))
        : [],
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.slice(0, 10).map((s: any) => clip(s, 400))
        : [],
      tokensUsed,
      createdAt: FieldValue.serverTimestamp(),
    };
    const ref = await db.collection(C.reports).add(report);
    res.json({ reportId: ref.id, report: { ...report, createdAt: null } });
  } catch (err: any) {
    console.error("Nexus analyze error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Nexus analysis failed." });
  }
});

// ── Roundtable helpers ───────────────────────────────────────

interface TurnDoc {
  turnIndex: number;
  round: number;
  role: "scene_header" | "character" | "nexus" | "director_note" | "user_note";
  characterId?: string | null;
  characterName: string;
  text: string;
  model?: string;
  tokensUsed?: number;
  grade?: any;
  consumed?: boolean;
}

function renderTranscript(turns: TurnDoc[], max = 14): string {
  return turns
    .slice(-max)
    .map((t) => {
      if (t.role === "scene_header") return `[SCENE] ${t.text}`;
      if (t.role === "nexus") return `[NEXUS — director's chair] ${t.text}`;
      if (t.role === "user_note" || t.role === "director_note")
        return `[DIRECTOR'S NOTE to the room] ${t.text}`;
      return `${t.characterName}: ${t.text}`;
    })
    .join("\n");
}

async function writeTurn(sessionId: string, turn: TurnDoc): Promise<void> {
  await db
    .collection(C.sessions)
    .doc(sessionId)
    .collection("turns")
    .add({ ...turn, createdAt: FieldValue.serverTimestamp() });
}

// ── POST /api/creative/roundtable/run — one live round ──────

router.post("/roundtable/run", async (req: AuthedRequest, res) => {
  const startedAt = Date.now();
  const { sessionId } = req.body as { sessionId?: string };
  if (!sessionId) return res.status(400).json({ error: "sessionId is required." });
  const sessionRef = db.collection(C.sessions).doc(sessionId);

  try {
    // Claim the session (double-click / double-tab guard).
    const session = await db.runTransaction(async (tx) => {
      const snap = await tx.get(sessionRef);
      if (!snap.exists) throw Object.assign(new Error("Session not found."), { status: 404 });
      const s = snap.data() as any;
      if (s.status === "running")
        throw Object.assign(new Error("This session is already running."), { status: 409 });
      tx.update(sessionRef, { status: "running", stopRequested: false, error: null });
      return { id: snap.id, ...s };
    });

    const { book, characters, bible } = await loadBookBundle(session.bookId);

    // Chapter simulation: the cast lives inside a real chapter and digs deeper.
    let chapterContext: { title: string; text: string } | undefined;
    if (session.chapterId) {
      const chapSnap = await db.collection(C.chapters).doc(session.chapterId).get();
      if (chapSnap.exists) {
        const ch = chapSnap.data() as any;
        chapterContext = { title: ch.title || "Untitled", text: ch.content || "" };
      }
    }

    const castIds: string[] = Array.isArray(session.characterIds) ? session.characterIds : [];
    const cast = castIds
      .map((id) => characters.find((c) => c.id === id))
      .filter(Boolean) as BibleCharacter[];
    if (cast.length < 2)
      throw Object.assign(new Error("The session needs at least 2 valid characters."), {
        status: 400,
      });

    const nexusModel: string = session.nexusModel || book.nexusModel || DEFAULT_NEXUS_MODEL;
    const characterModels: Record<string, string> = session.characterModels || {};
    const modelFor = (c: BibleCharacter) =>
      characterModels[c.id] ||
      (c as any).modelOverride ||
      book.defaultCharacterModel ||
      DEFAULT_CHARACTER_MODEL;

    const turnsPerRound = Math.min(
      MAX_TURNS_PER_ROUND,
      Math.max(4, session.maxTurnsPerRound || DEFAULT_TURNS_PER_ROUND)
    );
    const temperature =
      typeof session.temperature === "number" ? session.temperature : 0.9;
    const round: number = (session.round || 0) + 1;

    // Rebuild the local transcript window from persisted turns.
    const turnsSnap = await sessionRef
      .collection("turns")
      .orderBy("turnIndex", "desc")
      .limit(30)
      .get();
    const priorTurns = turnsSnap.docs
      .map((d) => ({ ref: d.ref, ...(d.data() as TurnDoc) }))
      .reverse();
    let turnIndex =
      priorTurns.length > 0 ? Math.max(...priorTurns.map((t) => t.turnIndex)) + 1 : 0;
    const transcript: TurnDoc[] = priorTurns.map(({ ref: _r, ...t }) => t);

    let totalTokens = 0;
    let turnsAdded = 0;
    let sceneHeader = session.sceneHeader || "";
    let stakes = session.stakes || "";
    let tone = session.tone || "";
    let activeRedirect = "";

    // ── Round 1 only: the Nexus sets the stage ──
    if (!transcript.some((t) => t.role === "scene_header")) {
      const { text: raw, tokensUsed } = await openrouterChat({
        model: nexusModel,
        messages: [
          {
            role: "user",
            content: buildSceneSetupPrompt(
              bible,
              session.premise || "",
              session.sceneGoal || "",
              session.setting || "",
              cast,
              chapterContext
            ),
          },
        ],
        temperature: 0.8,
        maxTokens: 800,
        jsonMode: true,
      });
      totalTokens += tokensUsed;
      const setup = extractJsonObject(raw);
      sceneHeader = clip(setup.header, 2000) || `The scene opens. ${session.premise || ""}`;
      stakes = clip(setup.stakes, 300);
      tone = clip(setup.tone, 100);
      const headerTurn: TurnDoc = {
        turnIndex: turnIndex++,
        round,
        role: "scene_header",
        characterName: "Novel Nexus",
        text: sceneHeader,
        model: nexusModel,
        tokensUsed,
      };
      await writeTurn(sessionId, headerTurn);
      transcript.push(headerTurn);
      turnsAdded++;
      await sessionRef.update({ sceneHeader, stakes, tone });
    }

    // ── Round plan: the Nexus sets the speaking order ──
    let speakingOrder: string[] = [];
    let beatGuidance = "";
    try {
      const { text: raw, tokensUsed } = await openrouterChat({
        model: nexusModel,
        messages: [
          {
            role: "user",
            content: buildRoundPlanPrompt(
              session.premise || "",
              cast,
              turnsPerRound,
              renderTranscript(transcript, 10),
              session.rollingSummary || ""
            ),
          },
        ],
        temperature: 0.6,
        maxTokens: 500,
        jsonMode: true,
      });
      totalTokens += tokensUsed;
      const plan = extractJsonObject(raw);
      if (Array.isArray(plan.speakingOrder)) {
        speakingOrder = plan.speakingOrder.filter((id: any) =>
          cast.some((c) => c.id === id)
        );
      }
      beatGuidance = clip(plan.beatGuidance, 300);
    } catch (e: any) {
      console.warn("Round plan failed, falling back to rotation:", e?.message);
    }
    // Fallback / top-up: simple rotation so a bad plan never blocks the round.
    while (speakingOrder.length < turnsPerRound) {
      speakingOrder.push(cast[speakingOrder.length % cast.length].id);
    }
    speakingOrder = speakingOrder.slice(0, turnsPerRound);

    const castNames = cast.map((c) => c.name || "Unknown");
    let sinceInterjection = 0;
    let stopped = false;
    let lastGrade: any = session.lastGrade || null;

    // ── The turn loop — each turn is written to Firestore immediately ──
    for (let i = 0; i < speakingOrder.length; i++) {
      // Wall-clock guard: end the round gracefully with time to grade.
      if (Date.now() - startedAt > ROUND_WALL_CLOCK_MS) break;

      // Stop guard: re-read the session flag every 3 turns.
      if (i % 3 === 0 && i > 0) {
        const fresh = await sessionRef.get();
        if ((fresh.data() as any)?.stopRequested) {
          stopped = true;
          break;
        }
      }

      // Pull in any director's notes the user dropped since the last turn.
      const notesSnap = await sessionRef
        .collection("turns")
        .where("role", "==", "user_note")
        .where("consumed", "==", false)
        .get();
      for (const noteDoc of notesSnap.docs) {
        const note = noteDoc.data() as TurnDoc;
        transcript.push(note);
        await noteDoc.ref.update({ consumed: true });
      }

      const speaker = cast.find((c) => c.id === speakingOrder[i])!;
      const guidanceBits = [
        beatGuidance && i === 0 ? `Round direction: ${beatGuidance}` : "",
        activeRedirect ? `DIRECTOR'S NOTE (follow this): ${activeRedirect}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const messages: OpenRouterMessage[] = [
        {
          role: "system",
          content: buildCharacterSystemPrompt(
            speaker,
            castNames.filter((n) => n !== speaker.name),
            bible,
            sceneHeader,
            stakes,
            tone,
            chapterContext
          ),
        },
        {
          role: "user",
          content: `${
            session.rollingSummary ? `EARLIER IN THE SCENE (compressed): ${session.rollingSummary}\n\n` : ""
          }THE SCENE SO FAR:\n${renderTranscript(transcript)}\n${
            guidanceBits ? `\n${guidanceBits}\n` : ""
          }\nIt's your beat, ${speaker.name}. Respond in character with your next line/action only.`,
        },
      ];

      try {
        const { text, tokensUsed } = await openrouterChat({
          model: modelFor(speaker),
          messages,
          temperature,
          maxTokens: 350,
        });
        totalTokens += tokensUsed;
        const cleaned = clip(text.trim(), 2000);
        if (!cleaned) throw new Error("empty response");
        const turn: TurnDoc = {
          turnIndex: turnIndex++,
          round,
          role: "character",
          characterId: speaker.id,
          characterName: speaker.name || "Unknown",
          text: cleaned,
          model: modelFor(speaker),
          tokensUsed,
        };
        await writeTurn(sessionId, turn);
        transcript.push(turn);
        turnsAdded++;
        sinceInterjection++;
        activeRedirect = "";
        await sessionRef.update({
          turnCount: FieldValue.increment(1),
          totalTokens: FieldValue.increment(tokensUsed),
        });
      } catch (e: any) {
        // A single flaky model must not kill the scene — the Nexus covers.
        console.warn(`Character turn failed (${speaker.name}):`, e?.message);
        const skipTurn: TurnDoc = {
          turnIndex: turnIndex++,
          round,
          role: "nexus",
          characterName: "Novel Nexus",
          text: `(${speaker.name} misses their beat — ${clip(e?.message, 120) || "model error"}. Scene continues.)`,
          model: nexusModel,
        };
        await writeTurn(sessionId, skipTurn);
        transcript.push(skipTurn);
        turnsAdded++;
      }

      // ── Nexus mid-scene interjection every N character turns ──
      const isLastTurn = i === speakingOrder.length - 1;
      if (sinceInterjection >= NEXUS_INTERJECT_EVERY && !isLastTurn) {
        sinceInterjection = 0;
        try {
          const { text: raw, tokensUsed } = await openrouterChat({
            model: nexusModel,
            messages: [
              {
                role: "user",
                content: buildNexusGradePrompt(
                  session.premise || "",
                  session.sceneGoal || "",
                  renderTranscript(transcript),
                  false
                ),
              },
            ],
            temperature: 0.5,
            maxTokens: 500,
            jsonMode: true,
          });
          totalTokens += tokensUsed;
          const read = extractJsonObject(raw);
          activeRedirect = clip(read.redirect, 300);
          const nexusTurn: TurnDoc = {
            turnIndex: turnIndex++,
            round,
            role: "nexus",
            characterName: "Novel Nexus",
            text: clip(read.note, 500) || "The Nexus watches in silence.",
            model: nexusModel,
            tokensUsed,
            grade: {
              tension: read.tension ?? null,
              voiceConsistency: read.voiceConsistency ?? null,
              drift: read.drift ?? null,
            },
          };
          await writeTurn(sessionId, nexusTurn);
          transcript.push(nexusTurn);
          turnsAdded++;
        } catch (e: any) {
          console.warn("Nexus interjection failed:", e?.message);
        }
      }
    }

    // ── Round close: the Nexus grades and compresses ──
    let rollingSummary: string = session.rollingSummary || "";
    try {
      const { text: raw, tokensUsed } = await openrouterChat({
        model: nexusModel,
        messages: [
          {
            role: "user",
            content: buildNexusGradePrompt(
              session.premise || "",
              session.sceneGoal || "",
              `${rollingSummary ? `EARLIER (compressed): ${rollingSummary}\n\n` : ""}${renderTranscript(transcript, 30)}`,
              true
            ),
          },
        ],
        temperature: 0.4,
        maxTokens: 1200,
        jsonMode: true,
      });
      totalTokens += tokensUsed;
      const closeRead = extractJsonObject(raw);
      lastGrade = closeRead.grade || lastGrade;
      rollingSummary = clip(closeRead.summary, 2500) || rollingSummary;
      const gradeTurn: TurnDoc = {
        turnIndex: turnIndex++,
        round,
        role: "nexus",
        characterName: "Novel Nexus",
        text: clip(closeRead.note, 500) || "Round complete.",
        model: nexusModel,
        tokensUsed,
        grade: closeRead.grade || null,
      };
      await writeTurn(sessionId, gradeTurn);
      turnsAdded++;
    } catch (e: any) {
      console.warn("Round-close grading failed:", e?.message);
    }

    // A round always ends 'paused' — the user chooses to continue, accept, or end.
    await sessionRef.update({
      status: "paused",
      stopRequested: false,
      round,
      rollingSummary,
      lastGrade: lastGrade || null,
    });

    res.json({
      status: "paused",
      round,
      turnsAdded,
      stopped,
      grade: lastGrade || null,
      totalTokensThisRound: totalTokens,
    });
  } catch (err: any) {
    console.error("Roundtable run error:", err?.message || err);
    if (err?.status !== 409) {
      // Leave a diagnosable state; a 409 means another run owns the session.
      await sessionRef
        .update({ status: "error", error: clip(err?.message, 400) || "Round failed." })
        .catch(() => {});
    }
    res.status(err?.status || 500).json({ error: err?.message || "The round failed." });
  }
});

// ── POST /api/creative/roundtable/stop ──────────────────────

router.post("/roundtable/stop", async (req: AuthedRequest, res) => {
  try {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) return res.status(400).json({ error: "sessionId is required." });
    await db.collection(C.sessions).doc(sessionId).update({ stopRequested: true });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to request stop." });
  }
});

// ── POST /api/creative/roundtable/finalize — the door unlocks ──
// After a full playout, the Nexus grades the whole transcript, cleans the raw
// improv into a polished playout, mines it for angles + aha moments, and saves
// it to the Scene Library as a playout option the author can add to a chapter.

router.post("/roundtable/finalize", async (req: AuthedRequest, res) => {
  try {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) return res.status(400).json({ error: "sessionId is required." });

    const sessionRef = db.collection(C.sessions).doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) return res.status(404).json({ error: "Session not found." });
    const session = sessionSnap.data() as any;
    if (session.status === "running")
      return res.status(409).json({ error: "Wait for the current round to finish first." });

    const turnsSnap = await sessionRef.collection("turns").orderBy("turnIndex", "asc").get();
    const turns = turnsSnap.docs.map((d) => d.data() as TurnDoc);
    const characterTurns = turns.filter((t) => t.role === "character");
    if (characterTurns.length < 4)
      return res.status(400).json({ error: "Not enough playout yet — run the room first." });

    const { book, bible } = await loadBookBundle(session.bookId);
    const nexusModel: string = session.nexusModel || book.nexusModel || DEFAULT_NEXUS_MODEL;

    let chapterTitle: string | null = null;
    if (session.chapterId) {
      const chapSnap = await db.collection(C.chapters).doc(session.chapterId).get();
      if (chapSnap.exists) chapterTitle = (chapSnap.data() as any).title || null;
    }

    const transcriptText = turns
      .map((t) =>
        t.role === "scene_header"
          ? `[SCENE] ${t.text}`
          : t.role === "nexus"
          ? `[NEXUS] ${t.text}`
          : t.role === "user_note" || t.role === "director_note"
          ? `[DIRECTOR'S NOTE] ${t.text}`
          : `${t.characterName}: ${t.text}`
      )
      .join("\n");

    // Review (compact JSON) and cleanup (plain text) run in parallel — a long
    // document inside a JSON string is a parse hazard, so they're separate calls.
    const clippedTranscript = clip(transcriptText, 80_000);
    const [review, cleanup] = await Promise.all([
      openrouterChat({
        model: nexusModel,
        messages: [
          {
            role: "user",
            content: buildPlayoutReviewPrompt(
              bible,
              session.premise || "",
              session.sceneGoal || "",
              chapterTitle,
              clippedTranscript
            ),
          },
        ],
        temperature: 0.5,
        maxTokens: 2500,
        jsonMode: true,
      }),
      openrouterChat({
        model: nexusModel,
        messages: [
          {
            role: "user",
            content: buildPlayoutCleanPrompt(session.premise || "", chapterTitle, clippedTranscript),
          },
        ],
        temperature: 0.4,
        maxTokens: 16_000,
      }),
    ]);
    const tokensUsed = review.tokensUsed + cleanup.tokensUsed;
    const parsed = extractJsonObject(review.text);
    const cleaned: string = cleanup.text.trim();
    if (!cleaned)
      return res.status(422).json({ error: "The Nexus could not finalize this playout. Try again." });

    const grade = {
      overall: Number(parsed.grade?.overall) || 0,
      dialogue: Number(parsed.grade?.dialogue) || 0,
      tension: Number(parsed.grade?.tension) || 0,
      consistency: Number(parsed.grade?.consistency) || 0,
    };
    const angles = Array.isArray(parsed.angles)
      ? parsed.angles.slice(0, 6).map((a: any) => clip(a, 400))
      : [];
    const ahaMoments = Array.isArray(parsed.ahaMoments)
      ? parsed.ahaMoments.slice(0, 5).map((a: any) => clip(a, 300))
      : [];

    const sceneDoc = {
      bookId: session.bookId,
      ownerUid: req.uid || "",
      chapterId: session.chapterId || null,
      sessionId,
      title: clip(session.premise, 80) || "Playout",
      premise: session.premise || "",
      status: "candidate",
      mode: session.chapterId ? "chapter_sim" : "scene",
      transcript: turns
        .filter((t) => t.role !== "user_note")
        .map((t) => ({
          turnIndex: t.turnIndex,
          role: t.role,
          characterId: t.characterId ?? null,
          characterName: t.characterName,
          text: t.text,
        })),
      cleanedText: clip(cleaned, 60_000),
      verdict: clip(parsed.verdict, 600),
      angles,
      ahaMoments,
      recommendation: clip(parsed.recommendation, 400),
      nexusGrade: grade,
      createdAt: FieldValue.serverTimestamp(),
    };
    const sceneRef = await db.collection(C.scenes).add(sceneDoc);

    await sessionRef.update({
      status: "complete",
      lastGrade: grade,
      finalSceneId: sceneRef.id,
      totalTokens: FieldValue.increment(tokensUsed),
    });

    res.json({
      sceneId: sceneRef.id,
      grade,
      verdict: sceneDoc.verdict,
      angles,
      ahaMoments,
      recommendation: sceneDoc.recommendation,
      cleanedPlayout: sceneDoc.cleanedText,
    });
  } catch (err: any) {
    console.error("Finalize error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Finalize failed." });
  }
});

// ── POST /api/creative/craft — scene transcript → chapter prose ──

router.post("/craft", async (req: AuthedRequest, res) => {
  try {
    const { sceneId, chapterId, instructions = "" } = req.body as {
      sceneId?: string;
      chapterId?: string;
      instructions?: string;
    };
    if (!sceneId || !chapterId)
      return res.status(400).json({ error: "sceneId and chapterId are required." });

    const [sceneSnap, chapterSnap] = await Promise.all([
      db.collection(C.scenes).doc(sceneId).get(),
      db.collection(C.chapters).doc(chapterId).get(),
    ]);
    if (!sceneSnap.exists) return res.status(404).json({ error: "Scene not found." });
    if (!chapterSnap.exists) return res.status(404).json({ error: "Chapter not found." });
    const scene = sceneSnap.data() as any;
    const chapter = chapterSnap.data() as any;

    const { book, bible } = await loadBookBundle(scene.bookId);
    const crafterModel = book.nexusModel || DEFAULT_NEXUS_MODEL;

    // Prefer the Nexus's cleaned playout when the door-unlock pass produced one.
    const transcriptText: string =
      (scene.cleanedText || "").trim() ||
      (Array.isArray(scene.transcript)
        ? scene.transcript
            .map((t: any) =>
              t.role === "nexus" || t.role === "scene_header"
                ? `[${t.characterName || "Nexus"}] ${t.text}`
                : `${t.characterName}: ${t.text}`
            )
            .join("\n")
        : "");
    if (!transcriptText.trim())
      return res.status(400).json({ error: "This scene has no transcript to craft from." });

    const chapterTail = clip(chapter.content || "", 8000);
    const { text: raw, tokensUsed } = await openrouterChat({
      model: crafterModel,
      messages: [
        {
          role: "user",
          content: buildCrafterPrompt(
            bible,
            book,
            chapter.title || "Untitled",
            chapterTail ? chapterTail.slice(-6000) : "",
            scene.premise || "",
            clip(transcriptText, 40_000),
            instructions
          ),
        },
      ],
      temperature: 0.7,
      maxTokens: 8000,
      jsonMode: true,
    });
    const parsed = extractJsonObject(raw);
    const prose: string = typeof parsed.prose === "string" ? parsed.prose : "";
    if (!prose.trim())
      return res.status(422).json({ error: "The Crafter produced no prose. Try again." });

    const draft = {
      bookId: scene.bookId,
      chapterId,
      ownerUid: req.uid || "",
      source: "crafter",
      sceneId,
      content: prose,
      integrationNote: clip(parsed.integrationNote, 500),
      model: crafterModel,
      tokensUsed,
      createdAt: FieldValue.serverTimestamp(),
    };
    const ref = await db.collection(C.drafts).add(draft);
    await sceneSnap.ref.update({ status: "crafted", chapterId });

    res.json({ draftId: ref.id, content: prose, integrationNote: draft.integrationNote });
  } catch (err: any) {
    console.error("Crafter error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Crafting failed." });
  }
});

// ── POST /api/creative/ingest-chapter — Story Intelligence ──
// Reads one chapter against the existing bible and applies a diff: drafts new
// characters/lore/threads, enriches existing ones, advances thread beats, and
// writes the chapter summary. Fired automatically after a chapter save.

const INGEST_MODEL_FALLBACK = "google/gemini-2.5-pro";

function normName(s: unknown): string {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

router.post("/ingest-chapter", async (req: AuthedRequest, res) => {
  try {
    const { bookId, chapterId, force = false } = req.body as {
      bookId?: string;
      chapterId?: string;
      force?: boolean;
    };
    if (!bookId || !chapterId)
      return res.status(400).json({ error: "bookId and chapterId are required." });

    const chapSnap = await db.collection(C.chapters).doc(chapterId).get();
    if (!chapSnap.exists) return res.status(404).json({ error: "Chapter not found." });
    const chapter = chapSnap.data() as any;
    const content: string = chapter.content || "";
    if (content.trim().length < 200)
      return res.json({ skipped: true, reason: "Chapter too short to ingest." });

    // Skip if this exact text was already ingested (saves cost on no-op saves).
    const hash = createHash("sha1").update(content).digest("hex");
    if (!force && chapter.lastIngestHash === hash)
      return res.json({ skipped: true, reason: "Chapter unchanged since last sync." });

    const { book, characters, lore, plots, bible } = await loadBookBundle(bookId);
    const ingestModel: string =
      (req.body as any).model || book.intelModel || INGEST_MODEL_FALLBACK;

    const prompt = buildIngestPrompt(
      bible,
      characters.map((c) => ({ id: c.id, name: c.name || "" })),
      lore.map((l: any) => ({ id: l.id, type: l.type, title: l.title || "" })),
      plots.map((p: any) => ({
        id: p.id,
        title: p.title || "",
        status: p.status,
        beats: Array.isArray(p.beats) ? p.beats : [],
      })),
      chapter.title || "Untitled",
      chapter.order ?? 0,
      clip(content, 120_000)
    );

    const { text: raw, tokensUsed } = await openrouterChat({
      model: ingestModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 6000,
      jsonMode: true,
    });
    const parsed = extractJsonObject(raw);
    if (!parsed.chapterSummary && !parsed.newCharacters) {
      console.warn(
        `Ingest parse failure (${ingestModel}), raw tail: …${raw.slice(-400)}`
      );
      return res.status(422).json({ error: "Story Intelligence returned nothing usable. Try again." });
    }

    const applied = {
      charactersAdded: 0,
      charactersEnriched: 0,
      loreAdded: 0,
      loreEnriched: 0,
      threadsAdded: 0,
      threadsAdvanced: 0,
    };
    const chapterTag = `Ch.${(chapter.order ?? 0) + 1}`;
    const knownCharNames = new Set(characters.map((c) => normName(c.name)));
    const knownLoreTitles = new Set(lore.map((l: any) => normName(l.title)));
    const knownThreadTitles = new Set(plots.map((p: any) => normName(p.title)));

    // New characters (drafted by the Nexus, deduped by name).
    const palette = ["#a78bfa", "#34d399", "#f472b6", "#60a5fa", "#fbbf24", "#f87171", "#2dd4bf", "#c084fc"];
    let colorIdx = characters.length;
    for (const c of (Array.isArray(parsed.newCharacters) ? parsed.newCharacters : []).slice(0, 12)) {
      if (!c?.name || knownCharNames.has(normName(c.name))) continue;
      knownCharNames.add(normName(c.name));
      await db.collection(C.characters).add({
        bookId,
        ownerUid: req.uid || "",
        name: clip(c.name, 100),
        role: ["protagonist", "antagonist", "supporting"].includes(c.role) ? c.role : "supporting",
        archetype: clip(c.archetype, 150) || null,
        bio: clip(c.bio, 1500) || null,
        voice: clip(c.voice, 1000) || null,
        goals: clip(c.goals, 600) || null,
        secrets: clip(c.secrets, 600) || null,
        appearance: clip(c.appearance, 600) || null,
        arcNotes: c.arcNotes ? `[${chapterTag}] ${clip(c.arcNotes, 500)}` : null,
        relationships: [],
        modelOverride: null,
        color: palette[colorIdx++ % palette.length],
        source: "nexus",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      applied.charactersAdded++;
    }

    // Enrichments to existing characters.
    for (const u of (Array.isArray(parsed.characterUpdates) ? parsed.characterUpdates : []).slice(0, 20)) {
      const existing = characters.find((c) => c.id === u?.id);
      if (!existing) continue;
      const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (u.arcNote)
        patch.arcNotes = [existing.arcNotes, `[${chapterTag}] ${clip(u.arcNote, 500)}`]
          .filter(Boolean)
          .join("\n");
      if (u.bioAddition)
        patch.bio = [existing.bio, clip(u.bioAddition, 800)].filter(Boolean).join(" ");
      if (u.voiceAddition)
        patch.voice = [(existing as any).voice, clip(u.voiceAddition, 500)].filter(Boolean).join(" ");
      if (["protagonist", "antagonist", "supporting"].includes(u.role)) patch.role = u.role;
      if (Object.keys(patch).length > 1) {
        await db.collection(C.characters).doc(existing.id).update(patch);
        applied.charactersEnriched++;
      }
    }

    // New lore (locations, factions, items, rules, key moments as events).
    for (const l of (Array.isArray(parsed.newLore) ? parsed.newLore : []).slice(0, 20)) {
      if (!l?.title || knownLoreTitles.has(normName(l.title))) continue;
      knownLoreTitles.add(normName(l.title));
      await db.collection(C.lore).add({
        bookId,
        ownerUid: req.uid || "",
        type: ["location", "faction", "item", "rule", "event"].includes(l.type) ? l.type : "other",
        title: clip(l.title, 150),
        content: clip(l.content, 2000),
        tags: Array.isArray(l.tags) ? l.tags.slice(0, 6).map((t: any) => clip(t, 30)) : [chapterTag],
        source: "nexus",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      applied.loreAdded++;
    }

    for (const u of (Array.isArray(parsed.loreUpdates) ? parsed.loreUpdates : []).slice(0, 20)) {
      const existing: any = lore.find((l: any) => l.id === u?.id);
      if (!existing || !u.contentAddition) continue;
      await db
        .collection(C.lore)
        .doc(existing.id)
        .update({
          content: [existing.content, `[${chapterTag}] ${clip(u.contentAddition, 800)}`]
            .filter(Boolean)
            .join("\n"),
          updatedAt: FieldValue.serverTimestamp(),
        });
      applied.loreEnriched++;
    }

    // New plot threads.
    for (const t of (Array.isArray(parsed.newPlotThreads) ? parsed.newPlotThreads : []).slice(0, 10)) {
      if (!t?.title || knownThreadTitles.has(normName(t.title))) continue;
      knownThreadTitles.add(normName(t.title));
      await db.collection(C.plots).add({
        bookId,
        ownerUid: req.uid || "",
        title: clip(t.title, 150),
        description: clip(t.description, 800) || null,
        status: ["setup", "developing"].includes(t.status) ? t.status : "setup",
        beats: Array.isArray(t.beats)
          ? t.beats.slice(0, 10).map((b: any) => ({ beat: clip(b?.beat, 300), done: false }))
          : [],
        source: "nexus",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      applied.threadsAdded++;
    }

    // Advance existing threads: complete beats by index, append new beats.
    for (const u of (Array.isArray(parsed.plotThreadUpdates) ? parsed.plotThreadUpdates : []).slice(0, 15)) {
      const existing: any = plots.find((p: any) => p.id === u?.id);
      if (!existing) continue;
      const beats = Array.isArray(existing.beats) ? [...existing.beats] : [];
      const doneIdx: number[] = Array.isArray(u.completedBeatIndexes) ? u.completedBeatIndexes : [];
      for (const i of doneIdx) if (beats[i]) beats[i] = { ...beats[i], done: true };
      for (const b of Array.isArray(u.newBeats) ? u.newBeats.slice(0, 8) : [])
        if (b?.beat) beats.push({ beat: clip(b.beat, 300), done: false });
      const patch: Record<string, unknown> = { beats, updatedAt: FieldValue.serverTimestamp() };
      if (["setup", "developing", "payoff", "resolved", "abandoned"].includes(u.status))
        patch.status = u.status;
      await db.collection(C.plots).doc(existing.id).update(patch);
      applied.threadsAdvanced++;
    }

    // Stamp the chapter: summary + ingest bookkeeping.
    await chapSnap.ref.update({
      summary: clip(parsed.chapterSummary, 600) || chapter.summary || null,
      pacingNote: clip(parsed.pacingNote, 300) || null,
      lastIngestHash: hash,
      ingestedAt: FieldValue.serverTimestamp(),
    });

    res.json({ skipped: false, applied, chapterSummary: clip(parsed.chapterSummary, 600), model: ingestModel, tokensUsed });
  } catch (err: any) {
    console.error("Ingest error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Story Intelligence failed." });
  }
});

// ── POST /api/creative/narrate — chapter → audiobook MP3 ──
// OpenAI TTS, chunked on paragraph boundaries, concatenated, cached in Firebase
// Storage keyed by content hash + voice so re-listens are free.

const TTS_VOICES = ["alloy", "ash", "echo", "fable", "onyx", "nova", "shimmer"] as const;
const TTS_CHAR_CAP = 30_000; // ~30 min of audio; keeps response + cost sane

interface TtsSegment {
  /** [startChar, endChar) into the narrated text — the read-along anchor. */
  startChar: number;
  endChar: number;
  /** What actually gets spoken (markdown/scene-break markup stripped). */
  speak: string;
}

/**
 * Split the chapter into paragraph-group segments (≤ ~600 chars, ending on
 * paragraph boundaries). Each segment is narrated as its own TTS call and
 * timed exactly, which is what powers the read-along highlight — the audio
 * has no word timestamps, so segment-level measurement is the ground truth.
 */
function segmentForTts(text: string, max = 600): TtsSegment[] {
  // Split a range by a regex of boundary markers, keeping exact char offsets.
  const splitBy = (start: number, end: number, re: RegExp): { start: number; end: number }[] => {
    const parts: { start: number; end: number }[] = [];
    const slice = text.slice(start, end);
    let last = 0;
    let m: RegExpExecArray | null;
    const g = new RegExp(re.source, "g");
    while ((m = g.exec(slice))) {
      parts.push({ start: start + last, end: start + m.index + (re.source.includes("[.!?") ? m[0].length : 0) });
      last = m.index + m[0].length;
    }
    parts.push({ start: start + last, end });
    return parts.filter((p) => p.end > p.start);
  };

  // Cascade: blank lines → single newlines → sentence ends. Manuscripts pasted
  // with single \n line breaks (no blank lines) otherwise become one giant
  // segment and the read-along highlight crawls.
  let parts = splitBy(0, text.length, /\n\s*\n/);
  parts = parts.flatMap((p) => (p.end - p.start > max * 2 ? splitBy(p.start, p.end, /\n/) : [p]));
  parts = parts.flatMap((p) =>
    p.end - p.start > max * 2 ? splitBy(p.start, p.end, /[.!?]["”']?\s+/) : [p]
  );

  // Greedily merge small parts back up to ~max chars per segment.
  const segments: TtsSegment[] = [];
  const push = (seg: { start: number; end: number }) => {
    const speak = text
      .slice(seg.start, seg.end)
      .replace(/^[ \t]*\* *\* *\*+[ \t]*$/gm, "") // scene-break markers aren't read aloud
      .replace(/\*\*?([^*]+)\*\*?/g, "$1") // strip markdown emphasis asterisks
      .trim();
    if (speak) segments.push({ startChar: seg.start, endChar: seg.end, speak });
  };
  let cur: { start: number; end: number } | null = null;
  for (const p of parts) {
    if (!cur) cur = { ...p };
    else if (p.end - cur.start <= max) cur.end = p.end;
    else {
      push(cur);
      cur = { ...p };
    }
  }
  if (cur) push(cur);
  return segments;
}

/** Run tasks with bounded concurrency, preserving order of results. */
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

router.post("/narrate", async (req: AuthedRequest, res) => {
  try {
    const { chapterId, voice = "onyx", force = false } = req.body as {
      chapterId?: string;
      voice?: string;
      force?: boolean;
    };
    if (!chapterId) return res.status(400).json({ error: "chapterId is required." });
    const ttsVoice = (TTS_VOICES as readonly string[]).includes(voice) ? voice : "onyx";

    const chapSnap = await db.collection(C.chapters).doc(chapterId).get();
    if (!chapSnap.exists) return res.status(404).json({ error: "Chapter not found." });
    const chapter = chapSnap.data() as any;
    const fullText: string = (chapter.content || "").trim();
    if (!fullText) return res.status(400).json({ error: "This chapter has no content to narrate." });

    const truncated = fullText.length > TTS_CHAR_CAP;
    const text = truncated ? fullText.slice(0, TTS_CHAR_CAP) : fullText;
    const hash = createHash("sha1").update(`${ttsVoice}:${text}`).digest("hex").slice(0, 16);

    // Cache hit: same text + voice already narrated WITH a read-along timeline
    // (older cached narrations without one regenerate once).
    if (
      !force &&
      chapter.narrationHash === hash &&
      chapter.narrationUrl &&
      Array.isArray(chapter.narrationTimeline) &&
      chapter.narrationTimeline.length > 0
    ) {
      return res.json({
        url: chapter.narrationUrl,
        timeline: chapter.narrationTimeline,
        narratedChars: text.length,
        cached: true,
        truncated,
        voice: ttsVoice,
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { parseBuffer } = await import("music-metadata");
    const segments = segmentForTts(text);
    if (segments.length === 0)
      return res.status(400).json({ error: "Nothing narratable in this chapter." });

    // One TTS call per segment (bounded concurrency), each duration measured —
    // exact segment timings are what drive the read-along highlight.
    const rendered = await mapPool(segments, 6, async (seg) => {
      const speech = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: ttsVoice as any,
        input: seg.speak,
        instructions:
          "You are narrating an audiobook chapter. Read with measured pace, natural emotional shading that follows the prose, and distinct subtle voicing for dialogue.",
        response_format: "mp3",
      });
      const buf = Buffer.from(await speech.arrayBuffer());
      const meta = await parseBuffer(buf, "audio/mpeg");
      const duration = meta.format.duration || 0;
      if (!duration) throw new Error("could not measure segment duration");
      return { buf, duration };
    });

    const buffers: Buffer[] = [];
    const timeline: { start: number; end: number; startChar: number; endChar: number }[] = [];
    let clock = 0;
    for (let i = 0; i < rendered.length; i++) {
      buffers.push(rendered[i].buf);
      const start = Math.round(clock * 100) / 100;
      clock += rendered[i].duration;
      const end = Math.round(clock * 100) / 100;
      timeline.push({ start, end, startChar: segments[i].startChar, endChar: segments[i].endChar });
    }
    const mp3 = Buffer.concat(buffers);

    const file = storageBucket().file(`narrations/${chapterId}-${hash}.mp3`);
    await file.save(mp3, { contentType: "audio/mpeg", resumable: false });
    const url = await getDownloadURL(file);

    await chapSnap.ref.update({
      narrationUrl: url,
      narrationHash: hash,
      narrationVoice: ttsVoice,
      narrationTimeline: timeline,
      narratedChars: text.length,
      narratedAt: FieldValue.serverTimestamp(),
    });

    res.json({
      url,
      timeline,
      narratedChars: text.length,
      cached: false,
      truncated,
      voice: ttsVoice,
      minutes: Math.round((clock / 60) * 10) / 10,
      segments: timeline.length,
    });
  } catch (err: any) {
    console.error("Narration error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Narration failed." });
  }
});

// ── POST /api/creative/craft-plan — the master crafter walks a chapter ──
// Plan pass: conflict/resolution read + 3-5 moments pinned to VERBATIM
// excerpts (machine-verified). Option passes: three distinct crafted drafts
// per moment, in parallel. Saved as one craft_plans doc the walkthrough UI
// steps through — the author picks a version per moment.

function parseOptionBlocks(raw: string): { label: string; text: string }[] {
  const options: { label: string; text: string }[] = [];
  const re = /<<<OPTION:\s*(.+?)>>>\s*\n([\s\S]*?)\n\s*<<<END>>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && options.length < 4) {
    const label = m[1].trim();
    const text = m[2].trim();
    if (label && text) options.push({ label: clip(label, 40), text: clip(text, 8000) });
  }
  return options;
}

router.post("/craft-plan", async (req: AuthedRequest, res) => {
  const startedAt = Date.now();
  try {
    const { bookId, chapterId } = req.body as { bookId?: string; chapterId?: string };
    if (!bookId || !chapterId)
      return res.status(400).json({ error: "bookId and chapterId are required." });

    const chapSnap = await db.collection(C.chapters).doc(chapterId).get();
    if (!chapSnap.exists) return res.status(404).json({ error: "Chapter not found." });
    const chapter = chapSnap.data() as any;
    const content: string = chapter.content || "";
    if (content.trim().length < 500)
      return res.status(400).json({ error: "This chapter needs more content before a craft session." });

    const { book, bible } = await loadBookBundle(bookId);
    const nexusModel: string = book.nexusModel || DEFAULT_NEXUS_MODEL;

    // Digest of the REST of the story so moments serve the whole book.
    const chapsSnap = await db.collection(C.chapters).where("bookId", "==", bookId).get();
    const storyDigest = chapsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((ch) => ch.id !== chapterId && (ch.content || "").trim())
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(
        (ch) =>
          `── "${ch.title}" ──\n${ch.summary ? `${ch.summary}\n` : ""}${clip(ch.content, 2500)}`
      )
      .join("\n\n");

    // ── Plan pass ──
    const { text: planRaw } = await openrouterChat({
      model: nexusModel,
      messages: [
        {
          role: "user",
          content: buildCraftPlanPrompt(bible, storyDigest, chapter.title || "Untitled", content),
        },
      ],
      temperature: 0.5,
      // Whole-story craft analysis makes reasoning models think HARD — Kimi K3
      // exhausted a 9k budget purely on reasoning here. 8k visible (×3 head-
      // room = 24k) gives the thinking room to land.
      maxTokens: 8000,
      jsonMode: true,
    });
    const plan = extractJsonObject(planRaw);
    const rawMoments: any[] = Array.isArray(plan.moments) ? plan.moments.slice(0, 5) : [];
    // Machine-verify every excerpt against the chapter — unverifiable moments
    // are dropped rather than shipped broken.
    const verified = rawMoments.filter(
      (m) => typeof m?.excerpt === "string" && m.excerpt.length > 40 && content.includes(m.excerpt)
    );
    if (verified.length === 0)
      return res
        .status(422)
        .json({ error: "The Nexus could not anchor any moments to the text. Try again." });

    // Slow plan (reasoning model) → draft options on the fast model instead.
    const optionModel = Date.now() - startedAt > 180_000 ? INGEST_MODEL_FALLBACK : nexusModel;

    // ── Option passes, all moments in parallel ──
    const moments = (
      await Promise.all(
        verified.map(async (m) => {
          try {
            const idx = content.indexOf(m.excerpt);
            const before = content.slice(Math.max(0, idx - 1500), idx);
            const after = content.slice(idx + m.excerpt.length, idx + m.excerpt.length + 1000);
            const { text } = await openrouterChat({
              model: optionModel,
              messages: [
                {
                  role: "user",
                  content: buildMomentOptionsPrompt(
                    bible,
                    book.styleNotes || "",
                    before,
                    m.excerpt,
                    after,
                    clip(m.issue, 400),
                    clip(m.approach, 400)
                  ),
                },
              ],
              temperature: 0.8,
              maxTokens: 6000,
            });
            const options = parseOptionBlocks(text);
            if (options.length === 0) throw new Error("no options parsed");
            return {
              excerpt: m.excerpt,
              issue: clip(m.issue, 400),
              why: clip(m.why, 300),
              approach: clip(m.approach, 400),
              options,
              status: "open",
            };
          } catch (e: any) {
            console.warn("Moment options failed:", e?.message);
            return null;
          }
        })
      )
    ).filter(Boolean);
    if (moments.length === 0)
      return res.status(422).json({ error: "The Nexus drafted no usable options. Try again." });

    const planDoc = {
      bookId,
      chapterId,
      ownerUid: req.uid || "",
      chapterTitle: chapter.title || "Untitled",
      chapterRole: clip(plan.chapterRole, 400),
      conflict: clip(plan.conflict, 400),
      resolution: clip(plan.resolution, 400),
      verdict: clip(plan.verdict, 600),
      moments,
      model: nexusModel,
      createdAt: FieldValue.serverTimestamp(),
    };
    const ref = await db.collection(C.craftPlans).add(planDoc);
    res.json({ planId: ref.id, ...planDoc, createdAt: null });
  } catch (err: any) {
    console.error("Craft-plan error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Craft session failed." });
  }
});

// ── POST /api/creative/title-chapter — one-click title + summary ──

router.post("/title-chapter", async (req: AuthedRequest, res) => {
  try {
    const { chapterId } = req.body as { chapterId?: string };
    if (!chapterId) return res.status(400).json({ error: "chapterId is required." });
    const chapSnap = await db.collection(C.chapters).doc(chapterId).get();
    if (!chapSnap.exists) return res.status(404).json({ error: "Chapter not found." });
    const chapter = chapSnap.data() as any;
    if (!(chapter.content || "").trim())
      return res.status(400).json({ error: "Write some chapter content first." });

    const { bible } = await loadBookBundle(chapter.bookId);
    const { text: raw } = await openrouterChat({
      model: INGEST_MODEL_FALLBACK,
      messages: [
        {
          role: "user",
          content: buildTitleSummaryPrompt(bible, (chapter.order ?? 0) + 1, chapter.content),
        },
      ],
      temperature: 0.6,
      maxTokens: 400,
      jsonMode: true,
    });
    const parsed = extractJsonObject(raw);
    if (!parsed.title) return res.status(422).json({ error: "The Nexus produced no title. Try again." });

    const title = clip(parsed.title, 100);
    const summary = clip(parsed.summary, 300);
    await chapSnap.ref.update({ title, summary });
    res.json({ title, summary });
  } catch (err: any) {
    console.error("Title-chapter error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Titling failed." });
  }
});

// ── POST /api/creative/restructure — the Nexus owns the table of contents ──
// Re-orders (integer renumber), re-titles, and re-summarizes every chapter so
// the book flows as one continuous story after Nexus insertions/moves.

router.post("/restructure", async (req: AuthedRequest, res) => {
  try {
    const { bookId } = req.body as { bookId?: string };
    if (!bookId) return res.status(400).json({ error: "bookId is required." });

    const { book, bible } = await loadBookBundle(bookId);
    const chapsSnap = await db.collection(C.chapters).where("bookId", "==", bookId).get();
    const chapters = chapsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (chapters.length < 2)
      return res.status(400).json({ error: "Need at least 2 chapters to restructure." });

    const { text: raw } = await openrouterChat({
      model: book.nexusModel || DEFAULT_NEXUS_MODEL,
      messages: [
        {
          role: "user",
          content: buildRestructurePrompt(
            bible,
            chapters.map((ch) => ({
              id: ch.id,
              title: ch.title || "Untitled",
              summary: ch.summary || "",
              words: ch.wordCount || 0,
              opening: (ch.content || "").slice(0, 400),
              closing: (ch.content || "").slice(-400),
            }))
          ),
        },
      ],
      temperature: 0.4,
      maxTokens: 2000,
      jsonMode: true,
    });
    const parsed = extractJsonObject(raw);
    const plan: any[] = Array.isArray(parsed.chapters) ? parsed.chapters : [];

    // Every existing id must appear exactly once, else refuse (no data loss).
    const planIds = new Set(plan.map((p) => p?.id));
    if (planIds.size !== chapters.length || !chapters.every((ch) => planIds.has(ch.id)))
      return res.status(422).json({ error: "The Nexus returned an incomplete layout. Try again." });

    const ordered = [...plan].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const changes: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      const existing = chapters.find((ch) => ch.id === p.id)!;
      const patch: Record<string, unknown> = {};
      if ((existing.order ?? 0) !== i) patch.order = i;
      const newTitle = clip(p.title, 100);
      if (newTitle && newTitle !== existing.title) patch.title = newTitle;
      const newSummary = clip(p.summary, 300);
      if (newSummary && newSummary !== existing.summary) patch.summary = newSummary;
      if (Object.keys(patch).length > 0) {
        await db.collection(C.chapters).doc(p.id).update(patch);
        const moved = (existing.order ?? 0) !== i ? `#${chapters.indexOf(existing) + 1}→#${i + 1}` : "";
        const retitled = patch.title ? `titled "${newTitle}"` : "";
        changes.push(`"${existing.title}": ${[moved, retitled].filter(Boolean).join(", ") || "summary refreshed"}`);
      }
    }

    res.json({
      editorNote: clip(parsed.editorNote, 400),
      changed: changes.length,
      changes: changes.slice(0, 12),
    });
  } catch (err: any) {
    console.error("Restructure error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Restructure failed." });
  }
});

// ── POST /api/creative/edit-selection — highlight-to-edit ──
// The author highlighted a passage in the reading view; the Nexus transforms
// JUST that passage in context. Returns the replacement — the client splices
// it into the editor buffer for review before saving.

router.post("/edit-selection", async (req: AuthedRequest, res) => {
  try {
    const {
      bookId,
      chapterId,
      selection,
      action = "rewrite",
      instruction = "",
    } = req.body as {
      bookId?: string;
      chapterId?: string;
      selection?: string;
      action?: string;
      instruction?: string;
    };
    if (!bookId || !chapterId || !selection?.trim())
      return res.status(400).json({ error: "bookId, chapterId, and selection are required." });
    const actionInstruction = SELECTION_ACTIONS[action];
    if (!actionInstruction) return res.status(400).json({ error: `Unknown action: ${action}` });

    const chapSnap = await db.collection(C.chapters).doc(chapterId).get();
    if (!chapSnap.exists) return res.status(404).json({ error: "Chapter not found." });
    const content: string = (chapSnap.data() as any).content || "";
    const idx = content.indexOf(selection);
    const before = idx >= 0 ? content.slice(Math.max(0, idx - 2000), idx) : "";
    const after = idx >= 0 ? content.slice(idx + selection.length, idx + selection.length + 1500) : "";

    const { book, bible } = await loadBookBundle(bookId);
    const { text } = await openrouterChat({
      model: book.nexusModel || DEFAULT_NEXUS_MODEL,
      messages: [
        {
          role: "user",
          content: buildSelectionEditPrompt(
            bible,
            book.styleNotes || "",
            before,
            clip(selection, 12_000),
            after,
            actionInstruction,
            instruction
          ),
        },
      ],
      temperature: 0.7,
      maxTokens: Math.max(1500, Math.ceil(selection.length / 2)),
    });
    const replacement = text.trim().replace(/^"""|"""$/g, "").trim();
    if (!replacement)
      return res.status(422).json({ error: "The Nexus produced no replacement. Try again." });

    res.json({ replacement, action });
  } catch (err: any) {
    console.error("Edit-selection error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Inline edit failed." });
  }
});

// ── POST /api/creative/format-chapter — raw text → clean manuscript ──
// Formatting-only pass over the editor's CURRENT buffer (client sends text, so
// unsaved work formats too). Returns the formatted text for review — nothing
// is written server-side; the author saves when happy.

router.post("/format-chapter", async (req: AuthedRequest, res) => {
  try {
    const { text, styleNotes = "", model } = req.body as {
      text?: string;
      styleNotes?: string;
      model?: string;
    };
    if (!text?.trim()) return res.status(400).json({ error: "text is required." });

    const formatModel = model || INGEST_MODEL_FALLBACK;
    const { text: raw, tokensUsed } = await openrouterChat({
      model: formatModel,
      messages: [
        { role: "user", content: buildFormatChapterPrompt(clip(text, 120_000), styleNotes) },
      ],
      temperature: 0.1,
      maxTokens: 24_000,
    });
    const formatted = raw.trim().replace(/^```(?:markdown|md)?\n?|\n?```$/g, "");
    if (!formatted) return res.status(422).json({ error: "The formatter returned nothing. Try again." });

    // Content-preservation check: the words must survive formatting.
    const words = (s: string) => (s.toLowerCase().match(/[a-z0-9']+/g) || []).length;
    const inWords = words(text);
    const outWords = words(formatted);
    const wordDelta = inWords > 0 ? Math.abs(outWords - inWords) / inWords : 0;

    res.json({
      formatted,
      wordDelta: Math.round(wordDelta * 1000) / 10, // percent, 1 decimal
      contentWarning:
        wordDelta > 0.02
          ? `Word count shifted ${(wordDelta * 100).toFixed(1)}% during formatting — review before saving.`
          : null,
      model: formatModel,
      tokensUsed,
    });
  } catch (err: any) {
    console.error("Format error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Formatting failed." });
  }
});

// ── POST /api/creative/transform — the Nexus takes the lead ──
// Editor-in-chief mode: a PLAN pass reads the whole story and decides the 3-5
// highest-impact transformations; parallel EXECUTOR passes then write the
// actual content (chapters, insertions, surgical edits, character work). Each
// lands in nexus_proposals for one-click Apply in the UI — the Nexus leads,
// the author approves.

function parseEditBlocks(raw: string): { find: string; replace: string }[] {
  const edits: { find: string; replace: string }[] = [];
  const re = /<<<FIND>>>\s*\n([\s\S]*?)\n\s*<<<REPLACE>>>\s*\n([\s\S]*?)\n\s*<<<END>>>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && edits.length < 6) {
    const find = m[1].trim();
    const replace = m[2].trim();
    if (find && replace) edits.push({ find, replace });
  }
  return edits;
}

router.post("/transform", async (req: AuthedRequest, res) => {
  const startedAt = Date.now();
  try {
    const { bookId, focus = "" } = req.body as { bookId?: string; focus?: string };
    if (!bookId) return res.status(400).json({ error: "bookId is required." });

    const { book, characters, bible } = await loadBookBundle(bookId);
    const nexusModel: string = (req.body as any).model || book.nexusModel || DEFAULT_NEXUS_MODEL;

    const chapsSnap = await db.collection(C.chapters).where("bookId", "==", bookId).get();
    const chapters = chapsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!chapters.some((ch) => (ch.content || "").trim()))
      return res.status(400).json({ error: "Write at least one chapter first — the Nexus needs a story to transform." });

    // Digest: summaries where we have them, clipped text otherwise.
    const chaptersDigest = chapters
      .map(
        (ch) =>
          `── #${(ch.order ?? 0) + 1} "${ch.title}" (${ch.wordCount || 0} words) ──\n${
            ch.summary ? `Summary: ${ch.summary}\n` : ""
          }${clip(ch.content || "", 3500)}`
      )
      .join("\n\n");

    // Open problems from the latest reports feed the plan.
    const reportsSnap = await db
      .collection(C.reports)
      .where("bookId", "==", bookId)
      .get();
    const reports = reportsSnap.docs
      .map((d) => d.data() as any)
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
      .slice(0, 3);
    const openIssues = reports
      .flatMap((r) => [
        ...(r.plotHoles || []).map((p: any) => `[${p.severity}] ${p.description}`),
        ...(r.continuityIssues || [])
          .filter((ci: any) => ci.status === "open")
          .map((ci: any) => `[continuity] "${ci.claim}" vs "${ci.conflictsWith}"`),
      ])
      .slice(0, 15)
      .join("\n");

    // ── Plan pass ──
    const { text: planRaw, tokensUsed: planTokens } = await openrouterChat({
      model: nexusModel,
      messages: [
        {
          role: "user",
          content: buildTransformPlanPrompt(
            bible,
            clip(chaptersDigest, 60_000),
            openIssues,
            characters.map((c) => ({ id: c.id, name: c.name || "", role: c.role })),
            chapters.map((ch) => ({ id: ch.id, title: ch.title || "Untitled", order: ch.order ?? 0 })),
            clip(focus, 500)
          ),
        },
      ],
      temperature: 0.5,
      maxTokens: 2500,
      jsonMode: true,
    });
    const plan = extractJsonObject(planRaw);
    const specs: any[] = Array.isArray(plan.proposals) ? plan.proposals.slice(0, 5) : [];
    if (specs.length === 0)
      return res.status(422).json({ error: "The Nexus produced no transformation plan. Try again." });

    // If the plan pass ate most of the clock (slow reasoning model), execute
    // with the fast intel model so the whole request stays inside the budget.
    const executorModel =
      Date.now() - startedAt > 180_000 ? INGEST_MODEL_FALLBACK : nexusModel;

    const chapterById = new Map(chapters.map((ch) => [ch.id, ch]));
    const charById = new Map(characters.map((c) => [c.id, c]));

    // ── Executor passes, in parallel ──
    const executed = await Promise.all(
      specs.map(async (spec): Promise<any | null> => {
        try {
          const base = {
            bookId,
            ownerUid: req.uid || "",
            status: "proposed",
            type: spec.type,
            title: clip(spec.title, 120) || "Untitled change",
            rationale: clip(spec.rationale, 500),
            impact: clip(spec.impact, 300),
            targetChapterId: spec.targetChapterId || null,
            targetCharacterIds: Array.isArray(spec.targetCharacterIds)
              ? spec.targetCharacterIds.filter((id: string) => charById.has(id))
              : [],
            model: executorModel,
            editorNote: clip(plan.editorNote, 500),
            createdAt: FieldValue.serverTimestamp(),
          };

          if (spec.type === "new_chapter") {
            const after = spec.afterChapterId ? chapterById.get(spec.afterChapterId) : chapters[chapters.length - 1];
            const afterIdx = after ? chapters.findIndex((ch) => ch.id === after.id) : chapters.length - 1;
            const next = chapters[afterIdx + 1] || null;
            const { text } = await openrouterChat({
              model: executorModel,
              messages: [
                {
                  role: "user",
                  content: buildNewChapterPrompt(
                    bible,
                    book,
                    after ? { title: after.title, content: after.content || "" } : null,
                    next ? { title: next.title, content: next.content || "" } : null,
                    spec.spec || spec.rationale
                  ),
                },
              ],
              temperature: 0.7,
              maxTokens: 6000,
            });
            const lines = text.trim().split("\n");
            const chapterTitle = clip(lines[0].replace(/^#+\s*/, ""), 120) || base.title;
            const content = lines.slice(1).join("\n").trim();
            if (content.length < 400) throw new Error("chapter too short");
            return {
              ...base,
              payload: {
                chapterTitle,
                content,
                afterChapterId: after?.id || null,
                order: after ? (after.order ?? 0) + 0.5 : chapters.length,
              },
            };
          }

          if (spec.type === "chapter_addition") {
            const target = chapterById.get(spec.targetChapterId);
            if (!target) throw new Error("target chapter not found");
            const { text } = await openrouterChat({
              model: executorModel,
              messages: [
                {
                  role: "user",
                  content: buildChapterAdditionPrompt(
                    bible,
                    book,
                    target.title || "Untitled",
                    target.content || "",
                    spec.spec || spec.rationale
                  ),
                },
              ],
              temperature: 0.7,
              maxTokens: 4000,
            });
            const match = text.match(/^\s*ANCHOR:\s*(.+?)\s*\n\s*\n([\s\S]+)$/);
            if (!match) throw new Error("addition output malformed");
            return {
              ...base,
              payload: { anchor: clip(match[1], 500), text: match[2].trim() },
            };
          }

          if (spec.type === "plot_fix" || spec.type === "chapter_revision") {
            const target = chapterById.get(spec.targetChapterId);
            if (!target) throw new Error("target chapter not found");
            const { text } = await openrouterChat({
              model: executorModel,
              messages: [
                {
                  role: "user",
                  content: buildEditsPrompt(
                    bible,
                    spec.type,
                    target.title || "Untitled",
                    target.content || "",
                    spec.spec || spec.rationale
                  ),
                },
              ],
              temperature: 0.5,
              maxTokens: 5000,
            });
            const edits = parseEditBlocks(text).filter((e) =>
              (target.content || "").includes(e.find)
            );
            if (edits.length === 0) throw new Error("no verifiable edits produced");
            return { ...base, payload: { edits } };
          }

          if (spec.type === "character_development") {
            const target = charById.get(base.targetCharacterIds[0]);
            if (!target) throw new Error("target character not found");
            const { text } = await openrouterChat({
              model: executorModel,
              messages: [
                { role: "user", content: buildCharacterDevPrompt(bible, target, spec.spec || spec.rationale) },
              ],
              temperature: 0.7,
              maxTokens: 1200,
              jsonMode: true,
            });
            const dev = extractJsonObject(text);
            if (!dev.traitAdditions && !dev.voiceAdditions && !dev.secretAdditions && !dev.arcDirection)
              throw new Error("no development produced");
            return {
              ...base,
              payload: {
                characterId: target.id,
                characterName: target.name,
                traitAdditions: clip(dev.traitAdditions, 800),
                voiceAdditions: clip(dev.voiceAdditions, 500),
                secretAdditions: clip(dev.secretAdditions, 500),
                goalAdditions: clip(dev.goalAdditions, 400),
                arcDirection: clip(dev.arcDirection, 400),
              },
            };
          }

          if (spec.type === "relationship") {
            const a = charById.get(base.targetCharacterIds[0]);
            const b = charById.get(base.targetCharacterIds[1]);
            if (!a || !b) throw new Error("relationship needs two valid characters");
            const { text } = await openrouterChat({
              model: executorModel,
              messages: [
                { role: "user", content: buildRelationshipPrompt(bible, a, b, spec.spec || spec.rationale) },
              ],
              temperature: 0.7,
              maxTokens: 900,
              jsonMode: true,
            });
            const rel = extractJsonObject(text);
            if (!rel.type) throw new Error("no relationship produced");
            return {
              ...base,
              payload: {
                aId: a.id,
                aName: a.name,
                bId: b.id,
                bName: b.name,
                relType: clip(rel.type, 60),
                aToB: clip(rel.aToB, 400),
                bToA: clip(rel.bToA, 400),
                surfaceIn: clip(rel.surfaceIn, 300),
              },
            };
          }

          throw new Error(`unknown proposal type: ${spec.type}`);
        } catch (e: any) {
          console.warn(`Executor failed (${spec.type} "${spec.title}"):`, e?.message);
          return null;
        }
      })
    );

    const proposals = executed.filter(Boolean);
    if (proposals.length === 0)
      return res.status(422).json({ error: "The Nexus planned changes but none could be executed. Try again." });

    const saved: any[] = [];
    for (const p of proposals) {
      const ref = await db.collection(C.proposals).add(p);
      saved.push({ ...p, id: ref.id, createdAt: null });
    }

    res.json({
      editorNote: clip(plan.editorNote, 500),
      proposals: saved,
      planned: specs.length,
      executed: proposals.length,
      model: nexusModel,
      executorModel,
      planTokens,
    });
  } catch (err: any) {
    console.error("Transform error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "The Nexus transformation failed." });
  }
});

// ── POST /api/creative/extract-bible — manuscript → story-bible candidates ──

router.post("/extract-bible", async (req: AuthedRequest, res) => {
  try {
    const { bookId, text, model } = req.body as {
      bookId?: string;
      text?: string;
      model?: string;
    };
    if (!bookId || !text?.trim())
      return res.status(400).json({ error: "bookId and text are required." });

    const bookSnap = await db.collection(C.books).doc(bookId).get();
    if (!bookSnap.exists) return res.status(404).json({ error: "Book not found." });
    const extractModel = model || (bookSnap.data() as any).nexusModel || DEFAULT_NEXUS_MODEL;

    const { text: raw } = await openrouterChat({
      model: extractModel,
      messages: [{ role: "user", content: buildBibleExtractPrompt(clip(text, 100_000)) }],
      temperature: 0.3,
      maxTokens: 6000,
      jsonMode: true,
    });
    const parsed = extractJsonObject(raw);
    res.json({
      characters: Array.isArray(parsed.characters) ? parsed.characters.slice(0, 20) : [],
      lore: Array.isArray(parsed.lore) ? parsed.lore.slice(0, 30) : [],
      plotThreads: Array.isArray(parsed.plotThreads) ? parsed.plotThreads.slice(0, 15) : [],
    });
  } catch (err: any) {
    console.error("Bible extraction error:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Extraction failed." });
  }
});

export default router;
