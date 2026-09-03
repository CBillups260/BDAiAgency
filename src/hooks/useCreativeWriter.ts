import { useState, useEffect, useCallback } from "react";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firestore, COLLECTIONS } from "../lib/firebase";

function docToObj<T>(snap: QueryDocumentSnapshot): T {
  return { id: snap.id, ...snap.data() } as T;
}

// ─── Creative Writer types ───────────────────────────────

export type BookStatus = "drafting" | "revising" | "complete";
export type ChapterStatus = "outline" | "draft" | "revised" | "final";
export type CharacterRole = "protagonist" | "antagonist" | "supporting";
export type LoreType = "location" | "faction" | "item" | "rule" | "event" | "other";
export type PlotStatus = "setup" | "developing" | "payoff" | "resolved" | "abandoned";
export type SceneStatus = "candidate" | "accepted" | "crafted" | "discarded";
export type SessionStatus = "ready" | "running" | "paused" | "complete" | "error";
export type TurnRole = "scene_header" | "character" | "nexus" | "director_note" | "user_note";

export interface CreativeBook {
  id: string;
  ownerUid: string;
  title: string;
  logline: string | null;
  genre: string | null;
  synopsis: string | null;
  styleNotes: string | null;
  targetAudience: string | null;
  nexusModel: string | null;
  defaultCharacterModel: string | null;
  /** Model for Story Intelligence chapter ingest (fast extraction; defaults server-side). */
  intelModel?: string | null;
  status: BookStatus;
  wordCountGoal: number | null;
  createdAt?: any;
  updatedAt?: any;
}

export interface BookChapter {
  id: string;
  bookId: string;
  ownerUid: string;
  title: string;
  order: number;
  summary: string | null;
  content: string;
  status: ChapterStatus;
  wordCount: number;
  /** Story Intelligence bookkeeping (set server-side on ingest). */
  pacingNote?: string | null;
  lastIngestHash?: string | null;
  ingestedAt?: any;
  /** Audiobook narration (set server-side on narrate). */
  narrationUrl?: string | null;
  narrationHash?: string | null;
  narrationVoice?: string | null;
  /** Read-along timeline: audio time range ↔ char range of the narrated text. */
  narrationTimeline?: { start: number; end: number; startChar: number; endChar: number }[];
  /** Length of the text the narration was generated from (drift detection). */
  narratedChars?: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface BookDraft {
  id: string;
  bookId: string;
  chapterId: string;
  ownerUid: string;
  source: "manual" | "crafter";
  sceneId?: string | null;
  content: string;
  integrationNote?: string | null;
  model?: string | null;
  createdAt?: any;
}

export interface CharacterRelationship {
  characterId: string;
  name?: string;
  type: string;
  note?: string;
}

export interface BookCharacter {
  id: string;
  bookId: string;
  ownerUid: string;
  name: string;
  role: CharacterRole;
  archetype: string | null;
  bio: string | null;
  voice: string | null;
  goals: string | null;
  secrets: string | null;
  appearance: string | null;
  arcNotes: string | null;
  relationships: CharacterRelationship[];
  modelOverride: string | null;
  /** UI accent for chat bubbles / cards. */
  color: string;
  /** 'nexus' = auto-drafted by Story Intelligence. */
  source?: string;
  createdAt?: any;
}

export interface BookLore {
  id: string;
  bookId: string;
  ownerUid: string;
  type: LoreType;
  title: string;
  content: string;
  tags: string[];
  /** 'nexus' = auto-drafted by Story Intelligence. */
  source?: string;
  createdAt?: any;
}

export interface PlotBeat {
  beat: string;
  chapterId?: string | null;
  done: boolean;
}

export interface BookPlotThread {
  id: string;
  bookId: string;
  ownerUid: string;
  title: string;
  description: string | null;
  status: PlotStatus;
  beats: PlotBeat[];
  /** 'nexus' = auto-drafted by Story Intelligence. */
  source?: string;
  createdAt?: any;
}

export interface SceneTranscriptLine {
  turnIndex: number;
  role: TurnRole;
  characterId?: string | null;
  characterName: string;
  text: string;
}

export interface BookScene {
  id: string;
  bookId: string;
  ownerUid: string;
  chapterId: string | null;
  sessionId: string | null;
  title: string;
  premise: string;
  status: SceneStatus;
  /** 'chapter_sim' = playout produced by a locked-door chapter simulation. */
  mode?: "scene" | "chapter_sim";
  transcript: SceneTranscriptLine[];
  /** Nexus-polished playout (door-unlock pass) — the presentable version. */
  cleanedText?: string | null;
  verdict?: string | null;
  angles?: string[];
  ahaMoments?: string[];
  recommendation?: string | null;
  nexusGrade: { overall?: number; dialogue?: number; tension?: number; consistency?: number } | null;
  createdAt?: any;
}

export interface CreativeSession {
  id: string;
  bookId: string;
  ownerUid: string;
  premise: string;
  sceneGoal: string | null;
  setting: string | null;
  /** Chapter being simulated ('chapter deep-dive' mode); null = freeform scene. */
  chapterId?: string | null;
  /** Character-turn target for a locked-door playout (40-60 typical). */
  targetTurns?: number;
  finalSceneId?: string | null;
  characterIds: string[];
  characterModels: Record<string, string>;
  nexusModel: string;
  status: SessionStatus;
  stopRequested: boolean;
  round: number;
  turnCount: number;
  maxTurnsPerRound: number;
  temperature: number;
  rollingSummary: string | null;
  sceneHeader?: string | null;
  stakes?: string | null;
  tone?: string | null;
  lastGrade: { overall?: number; dialogue?: number; tension?: number; consistency?: number } | null;
  totalTokens: number;
  error?: string | null;
  createdAt?: any;
}

export interface SessionTurn {
  id: string;
  turnIndex: number;
  round: number;
  role: TurnRole;
  characterId?: string | null;
  characterName: string;
  text: string;
  model?: string;
  tokensUsed?: number;
  grade?: {
    tension?: number | null;
    voiceConsistency?: number | null;
    drift?: number | null;
    overall?: number;
    dialogue?: number;
    consistency?: number;
  } | null;
  consumed?: boolean;
  createdAt?: any;
}

export interface NexusReport {
  id: string;
  bookId: string;
  ownerUid: string;
  scope: "chapter" | "book" | "scene";
  chapterId: string | null;
  model: string;
  grades: {
    overall: number;
    pacing: number;
    consistency: number;
    characterVoice: number;
    engagement: number;
    prose: number;
  };
  summary: string;
  plotHoles: { severity: "critical" | "major" | "minor"; description: string }[];
  continuityIssues: { claim: string; conflictsWith: string; status: "open" | "resolved" }[];
  pacingMap: { segment: string; tension: number; note: string }[];
  suggestions: string[];
  createdAt?: any;
}

export type ProposalType =
  | "plot_fix"
  | "chapter_revision"
  | "chapter_addition"
  | "new_chapter"
  | "character_development"
  | "relationship";

export interface NexusProposal {
  id: string;
  bookId: string;
  ownerUid: string;
  status: "proposed" | "applied" | "dismissed";
  type: ProposalType;
  title: string;
  rationale: string;
  impact: string;
  editorNote?: string;
  targetChapterId: string | null;
  targetCharacterIds: string[];
  model: string;
  /** Type-specific executable content written by the Nexus. */
  payload: {
    // new_chapter
    chapterTitle?: string;
    content?: string;
    afterChapterId?: string | null;
    order?: number;
    // chapter_addition
    anchor?: string;
    text?: string;
    // plot_fix / chapter_revision
    edits?: { find: string; replace: string }[];
    // character_development
    characterId?: string;
    characterName?: string;
    traitAdditions?: string;
    voiceAdditions?: string;
    secretAdditions?: string;
    goalAdditions?: string;
    arcDirection?: string;
    // relationship
    aId?: string;
    aName?: string;
    bId?: string;
    bName?: string;
    relType?: string;
    aToB?: string;
    bToA?: string;
    surfaceIn?: string;
  };
  appliedNote?: string;
  createdAt?: any;
}

export interface CraftMoment {
  /** Verbatim excerpt from the chapter (server-verified at generation). */
  excerpt: string;
  issue: string;
  why: string;
  approach: string;
  options: { label: string; text: string }[];
  status: "open" | "applied" | "skipped";
  /** Index of the applied option, when status === 'applied'. */
  chosen?: number;
}

export interface CraftPlan {
  id: string;
  bookId: string;
  chapterId: string;
  ownerUid: string;
  chapterTitle: string;
  chapterRole: string;
  conflict: string;
  resolution: string;
  verdict: string;
  moments: CraftMoment[];
  model: string;
  createdAt?: any;
}

/** Accent palette assigned to characters round-robin (chat bubbles, cards). */
export const CHARACTER_COLORS = [
  "#a78bfa", // violet
  "#34d399", // emerald
  "#f472b6", // pink
  "#60a5fa", // blue
  "#fbbf24", // amber
  "#f87171", // red
  "#2dd4bf", // teal
  "#c084fc", // purple
];

// ─── Generic bookId-scoped realtime hook ─────────────────
// (The generic useFirestoreCollection doesn't re-subscribe when a `where`
// value changes, so Creative Writer hooks carry their params in effect deps.)

function useBookCollection<T>(
  collectionName: string,
  bookId: string | null,
  orderField?: string
): { items: T[]; loading: boolean } {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bookId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(collection(firestore, collectionName), where("bookId", "==", bookId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        let rows = snap.docs.map((d) => docToObj<T>(d));
        if (orderField) {
          rows = rows.sort(
            (a: any, b: any) => (a[orderField] ?? 0) - (b[orderField] ?? 0)
          );
        }
        setItems(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [collectionName, bookId, orderField]);

  return { items, loading };
}

// ─── Realtime hooks ──────────────────────────────────────

export function useBooks() {
  const [books, setBooks] = useState<CreativeBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(firestore, COLLECTIONS.books));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => docToObj<CreativeBook>(d))
          .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setBooks(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  return { books, loading };
}

export function useChapters(bookId: string | null) {
  const { items, loading } = useBookCollection<BookChapter>(
    COLLECTIONS.bookChapters,
    bookId,
    "order"
  );
  return { chapters: items, loading };
}

export function useCharacters(bookId: string | null) {
  const { items, loading } = useBookCollection<BookCharacter>(
    COLLECTIONS.bookCharacters,
    bookId
  );
  return { characters: items, loading };
}

export function useLore(bookId: string | null) {
  const { items, loading } = useBookCollection<BookLore>(COLLECTIONS.bookLore, bookId);
  return { lore: items, loading };
}

export function usePlotThreads(bookId: string | null) {
  const { items, loading } = useBookCollection<BookPlotThread>(
    COLLECTIONS.bookPlotThreads,
    bookId
  );
  return { threads: items, loading };
}

export function useScenes(bookId: string | null) {
  const { items, loading } = useBookCollection<BookScene>(COLLECTIONS.bookScenes, bookId);
  return { scenes: items, loading };
}

export function useDrafts(chapterId: string | null) {
  const [drafts, setDrafts] = useState<BookDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chapterId) {
      setDrafts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(firestore, COLLECTIONS.bookDrafts),
      where("chapterId", "==", chapterId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => docToObj<BookDraft>(d))
          .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setDrafts(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [chapterId]);

  return { drafts, loading };
}

export function useCreativeSessions(bookId: string | null) {
  const { items, loading } = useBookCollection<CreativeSession>(
    COLLECTIONS.creativeSessions,
    bookId
  );
  const sessions = [...items].sort(
    (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
  );
  return { sessions, loading };
}

export function useSession(sessionId: string | null) {
  const [session, setSession] = useState<CreativeSession | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    const unsub = onSnapshot(
      doc(firestore, COLLECTIONS.creativeSessions, sessionId),
      (snap) => {
        setSession(snap.exists() ? ({ id: snap.id, ...snap.data() } as CreativeSession) : null);
      }
    );
    return unsub;
  }, [sessionId]);

  return { session };
}

/** The live roundtable feed — server writes turns one-by-one; this streams them in. */
export function useSessionTurns(sessionId: string | null) {
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setTurns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(firestore, COLLECTIONS.creativeSessions, sessionId, "turns"),
      orderBy("turnIndex", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTurns(snap.docs.map((d) => docToObj<SessionTurn>(d)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [sessionId]);

  return { turns, loading };
}

export function useCraftPlans(chapterId: string | null) {
  const [plans, setPlans] = useState<CraftPlan[]>([]);
  useEffect(() => {
    if (!chapterId) {
      setPlans([]);
      return;
    }
    const q = query(
      collection(firestore, COLLECTIONS.craftPlans),
      where("chapterId", "==", chapterId)
    );
    const unsub = onSnapshot(q, (snap) => {
      setPlans(
        snap.docs
          .map((d) => docToObj<CraftPlan>(d))
          .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
      );
    });
    return unsub;
  }, [chapterId]);
  return { plans };
}

export function useNexusProposals(bookId: string | null) {
  const { items, loading } = useBookCollection<NexusProposal>(
    COLLECTIONS.nexusProposals,
    bookId
  );
  const proposals = [...items].sort(
    (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
  );
  return { proposals, loading };
}

export function useNexusReports(bookId: string | null) {
  const { items, loading } = useBookCollection<NexusReport>(
    COLLECTIONS.nexusReports,
    bookId
  );
  const reports = [...items].sort(
    (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
  );
  return { reports, loading };
}

// ─── Mutations ───────────────────────────────────────────

function countWords(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

export function useCreativeWriterMutations(uid: string) {
  const add = useCallback(
    async (collectionName: string, data: Record<string, unknown>) => {
      const ref = await addDoc(collection(firestore, collectionName), {
        ...data,
        ownerUid: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return ref.id;
    },
    [uid]
  );

  const update = useCallback(
    async (collectionName: string, id: string, data: Record<string, unknown>) => {
      const { id: _id, ...rest } = data as any;
      await updateDoc(doc(firestore, collectionName, id), {
        ...rest,
        updatedAt: serverTimestamp(),
      } as DocumentData);
    },
    []
  );

  const remove = useCallback(async (collectionName: string, id: string) => {
    await deleteDoc(doc(firestore, collectionName, id));
  }, []);

  // Books
  const addBook = useCallback(
    (data: Partial<CreativeBook>) =>
      add(COLLECTIONS.books, {
        title: "Untitled Book",
        logline: null,
        genre: null,
        synopsis: null,
        styleNotes: null,
        targetAudience: null,
        nexusModel: null,
        defaultCharacterModel: null,
        status: "drafting",
        wordCountGoal: null,
        ...data,
      }),
    [add]
  );
  const updateBook = useCallback(
    (id: string, data: Partial<CreativeBook>) => update(COLLECTIONS.books, id, data),
    [update]
  );
  const deleteBook = useCallback(
    async (id: string) => {
      // Cascade-delete everything belonging to the book (mirrors deleteAccount).
      const subCollections = [
        COLLECTIONS.bookChapters,
        COLLECTIONS.bookDrafts,
        COLLECTIONS.bookCharacters,
        COLLECTIONS.bookLore,
        COLLECTIONS.bookPlotThreads,
        COLLECTIONS.bookScenes,
        COLLECTIONS.creativeSessions,
        COLLECTIONS.nexusReports,
      ];
      for (const col of subCollections) {
        const snap = await getDocs(
          query(collection(firestore, col), where("bookId", "==", id))
        );
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      }
      await deleteDoc(doc(firestore, COLLECTIONS.books, id));
    },
    []
  );

  // Chapters
  const addChapter = useCallback(
    (bookId: string, data: Partial<BookChapter>) =>
      add(COLLECTIONS.bookChapters, {
        bookId,
        title: "Untitled Chapter",
        order: 0,
        summary: null,
        content: "",
        status: "outline",
        wordCount: 0,
        ...data,
      }),
    [add]
  );
  const updateChapter = useCallback(
    (id: string, data: Partial<BookChapter>) => {
      const patch: Partial<BookChapter> = { ...data };
      if (typeof data.content === "string") patch.wordCount = countWords(data.content);
      return update(COLLECTIONS.bookChapters, id, patch);
    },
    [update]
  );
  const deleteChapter = useCallback(
    (id: string) => remove(COLLECTIONS.bookChapters, id),
    [remove]
  );

  // Characters
  const addCharacter = useCallback(
    (bookId: string, data: Partial<BookCharacter>) =>
      add(COLLECTIONS.bookCharacters, {
        bookId,
        name: "New Character",
        role: "supporting",
        archetype: null,
        bio: null,
        voice: null,
        goals: null,
        secrets: null,
        appearance: null,
        arcNotes: null,
        relationships: [],
        modelOverride: null,
        color: "#a78bfa",
        ...data,
      }),
    [add]
  );
  const updateCharacter = useCallback(
    (id: string, data: Partial<BookCharacter>) =>
      update(COLLECTIONS.bookCharacters, id, data),
    [update]
  );
  const deleteCharacter = useCallback(
    (id: string) => remove(COLLECTIONS.bookCharacters, id),
    [remove]
  );

  // Lore
  const addLore = useCallback(
    (bookId: string, data: Partial<BookLore>) =>
      add(COLLECTIONS.bookLore, {
        bookId,
        type: "other",
        title: "New Entry",
        content: "",
        tags: [],
        ...data,
      }),
    [add]
  );
  const updateLore = useCallback(
    (id: string, data: Partial<BookLore>) => update(COLLECTIONS.bookLore, id, data),
    [update]
  );
  const deleteLore = useCallback((id: string) => remove(COLLECTIONS.bookLore, id), [remove]);

  // Plot threads
  const addPlotThread = useCallback(
    (bookId: string, data: Partial<BookPlotThread>) =>
      add(COLLECTIONS.bookPlotThreads, {
        bookId,
        title: "New Thread",
        description: null,
        status: "setup",
        beats: [],
        ...data,
      }),
    [add]
  );
  const updatePlotThread = useCallback(
    (id: string, data: Partial<BookPlotThread>) =>
      update(COLLECTIONS.bookPlotThreads, id, data),
    [update]
  );
  const deletePlotThread = useCallback(
    (id: string) => remove(COLLECTIONS.bookPlotThreads, id),
    [remove]
  );

  // Sessions
  const createSession = useCallback(
    (bookId: string, data: Partial<CreativeSession>) =>
      add(COLLECTIONS.creativeSessions, {
        bookId,
        premise: "",
        sceneGoal: null,
        setting: null,
        characterIds: [],
        characterModels: {},
        nexusModel: "",
        status: "ready",
        stopRequested: false,
        round: 0,
        turnCount: 0,
        maxTurnsPerRound: 12,
        temperature: 0.9,
        rollingSummary: null,
        lastGrade: null,
        totalTokens: 0,
        ...data,
      }),
    [add]
  );
  const deleteSession = useCallback(
    async (id: string) => {
      const turnsSnap = await getDocs(
        collection(firestore, COLLECTIONS.creativeSessions, id, "turns")
      );
      await Promise.all(turnsSnap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(firestore, COLLECTIONS.creativeSessions, id));
    },
    []
  );

  /** Drop a director's note into a live session; the server folds it into the next beats. */
  const addDirectorNote = useCallback(
    async (sessionId: string, text: string, afterTurnIndex: number) => {
      await addDoc(
        collection(firestore, COLLECTIONS.creativeSessions, sessionId, "turns"),
        {
          turnIndex: afterTurnIndex + 1,
          round: 0,
          role: "user_note",
          characterName: "Director (you)",
          text,
          consumed: false,
          createdAt: serverTimestamp(),
        }
      );
    },
    []
  );

  /** Snapshot a session's turns into a scene the book can keep. */
  const acceptScene = useCallback(
    async (
      session: CreativeSession,
      turns: SessionTurn[],
      opts: { title: string; chapterId?: string | null }
    ) => {
      const transcript: SceneTranscriptLine[] = turns
        .filter((t) => t.role !== "user_note" || t.text.trim())
        .map((t) => ({
          turnIndex: t.turnIndex,
          role: t.role,
          characterId: t.characterId ?? null,
          characterName: t.characterName,
          text: t.text,
        }));
      return add(COLLECTIONS.bookScenes, {
        bookId: session.bookId,
        chapterId: opts.chapterId ?? null,
        sessionId: session.id,
        title: opts.title,
        premise: session.premise,
        status: "accepted",
        transcript,
        nexusGrade: session.lastGrade ?? null,
      });
    },
    [add]
  );
  const updateScene = useCallback(
    (id: string, data: Partial<BookScene>) => update(COLLECTIONS.bookScenes, id, data),
    [update]
  );
  const deleteScene = useCallback(
    (id: string) => remove(COLLECTIONS.bookScenes, id),
    [remove]
  );

  const updateReport = useCallback(
    (id: string, data: Partial<NexusReport>) => update(COLLECTIONS.nexusReports, id, data),
    [update]
  );
  const deleteReport = useCallback(
    (id: string) => remove(COLLECTIONS.nexusReports, id),
    [remove]
  );

  const deleteDraft = useCallback(
    (id: string) => remove(COLLECTIONS.bookDrafts, id),
    [remove]
  );

  /** Record a moment's outcome on the craft plan doc (moments array update). */
  const updateCraftMoment = useCallback(
    async (
      plan: CraftPlan,
      momentIdx: number,
      patch: Partial<CraftMoment>
    ) => {
      const moments = plan.moments.map((m, i) => (i === momentIdx ? { ...m, ...patch } : m));
      await updateDoc(doc(firestore, COLLECTIONS.craftPlans, plan.id), { moments });
    },
    []
  );

  const deleteCraftPlan = useCallback(
    (id: string) => remove(COLLECTIONS.craftPlans, id),
    [remove]
  );

  const setProposalStatus = useCallback(
    (id: string, status: NexusProposal["status"], appliedNote?: string) =>
      update(COLLECTIONS.nexusProposals, id, {
        status,
        ...(appliedNote ? { appliedNote } : {}),
      }),
    [update]
  );

  /**
   * Execute a Nexus proposal against the live book. Returns a human-readable
   * result note; throws with a clear message when the target has drifted
   * (e.g. the author edited the passage the fix was written against).
   */
  const applyProposal = useCallback(
    async (
      proposal: NexusProposal,
      chapters: BookChapter[],
      characters: BookCharacter[]
    ): Promise<string> => {
      const p = proposal.payload || {};

      if (proposal.type === "new_chapter") {
        if (!p.content) throw new Error("Proposal has no chapter content.");
        const newId = await addChapter(proposal.bookId, {
          title: p.chapterTitle || proposal.title,
          content: p.content,
          summary: null,
          status: "draft",
          order: typeof p.order === "number" ? p.order : chapters.length,
          wordCount: (p.content.match(/\S+/g) || []).length,
        });
        // Renumber EVERYTHING to clean integers — fractional insert orders left
        // as-is eventually collide and produce duplicate chapter numbers.
        const all = [
          ...chapters.map((c) => ({ id: c.id, order: c.order ?? 0 })),
          { id: newId, order: typeof p.order === "number" ? p.order : chapters.length },
        ].sort((a, b) => a.order - b.order);
        await Promise.all(
          all.map((c, i) =>
            c.order === i
              ? Promise.resolve()
              : updateDoc(doc(firestore, COLLECTIONS.bookChapters, c.id), { order: i })
          )
        );
        return `New chapter "${p.chapterTitle}" inserted and the book renumbered cleanly.`;
      }

      if (proposal.type === "chapter_addition") {
        const chapter = chapters.find((c) => c.id === proposal.targetChapterId);
        if (!chapter) throw new Error("Target chapter no longer exists.");
        if (!p.text) throw new Error("Proposal has no passage text.");
        const content = chapter.content || "";
        const anchorIdx = p.anchor ? content.indexOf(p.anchor) : -1;
        const next =
          anchorIdx >= 0
            ? `${content.slice(0, anchorIdx + (p.anchor as string).length)}\n\n${p.text}${content.slice(
                anchorIdx + (p.anchor as string).length
              )}`
            : `${content.trim()}\n\n${p.text}`;
        await updateChapter(chapter.id, { content: next });
        return anchorIdx >= 0
          ? `Passage inserted into "${chapter.title}" at the Nexus's chosen seam.`
          : `Anchor sentence not found (chapter changed since) — passage appended to the end of "${chapter.title}"; move it where it belongs.`;
      }

      if (proposal.type === "plot_fix" || proposal.type === "chapter_revision") {
        const chapter = chapters.find((c) => c.id === proposal.targetChapterId);
        if (!chapter) throw new Error("Target chapter no longer exists.");
        const edits = p.edits || [];
        let content = chapter.content || "";
        let applied = 0;
        for (const e of edits) {
          if (content.includes(e.find)) {
            content = content.replace(e.find, e.replace);
            applied++;
          }
        }
        if (applied === 0)
          throw new Error(
            "None of the edits match the current text — the chapter changed since the Nexus wrote this fix. Dismiss and re-run the Nexus."
          );
        await updateChapter(chapter.id, { content });
        return `${applied}/${edits.length} edits applied to "${chapter.title}".`;
      }

      if (proposal.type === "character_development") {
        const character = characters.find((c) => c.id === p.characterId);
        if (!character) throw new Error("Target character no longer exists.");
        const patch: Partial<BookCharacter> = {};
        if (p.traitAdditions)
          patch.bio = [character.bio, p.traitAdditions].filter(Boolean).join(" ");
        if (p.voiceAdditions)
          patch.voice = [character.voice, p.voiceAdditions].filter(Boolean).join(" ");
        if (p.secretAdditions)
          patch.secrets = [character.secrets, p.secretAdditions].filter(Boolean).join(" ");
        if (p.goalAdditions)
          patch.goals = [character.goals, p.goalAdditions].filter(Boolean).join(" ");
        if (p.arcDirection)
          patch.arcNotes = [character.arcNotes, `[Nexus] ${p.arcDirection}`]
            .filter(Boolean)
            .join("\n");
        await updateCharacter(character.id, patch);
        return `${character.name} deepened — bio, voice, and arc updated.`;
      }

      if (proposal.type === "relationship") {
        const a = characters.find((c) => c.id === p.aId);
        const b = characters.find((c) => c.id === p.bId);
        if (!a || !b) throw new Error("One of the characters no longer exists.");
        await updateCharacter(a.id, {
          relationships: [
            ...(a.relationships || []),
            { characterId: b.id, name: b.name, type: p.relType || "connection", note: p.aToB },
          ],
        });
        await updateCharacter(b.id, {
          relationships: [
            ...(b.relationships || []),
            { characterId: a.id, name: a.name, type: p.relType || "connection", note: p.bToA },
          ],
        });
        return `${a.name} ↔ ${b.name}: "${p.relType}" established on both character cards.`;
      }

      throw new Error(`Unknown proposal type: ${proposal.type}`);
    },
    [addChapter, updateChapter, updateCharacter]
  );

  return {
    addBook,
    updateBook,
    deleteBook,
    addChapter,
    updateChapter,
    deleteChapter,
    addCharacter,
    updateCharacter,
    deleteCharacter,
    addLore,
    updateLore,
    deleteLore,
    addPlotThread,
    updatePlotThread,
    deletePlotThread,
    createSession,
    deleteSession,
    addDirectorNote,
    acceptScene,
    updateScene,
    deleteScene,
    updateReport,
    deleteReport,
    deleteDraft,
    setProposalStatus,
    applyProposal,
    updateCraftMoment,
    deleteCraftPlan,
  };
}
