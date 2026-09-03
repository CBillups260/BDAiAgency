import { useState, useEffect, useRef, useMemo } from "react";
import {
  Play,
  StopCircle,
  Send,
  Award,
  Zap,
  ChevronRight,
  Check,
  Lock,
  Star,
} from "@geist-ui/icons";
import { doc, getDoc } from "firebase/firestore";
import { firestore, COLLECTIONS } from "../../lib/firebase";
import {
  useSession,
  useSessionTurns,
  type BookCharacter,
  type BookChapter,
  type CreativeBook,
  type SessionTurn,
  type useCreativeWriterMutations,
} from "../../hooks/useCreativeWriter";
import { useCreativeApi } from "../../hooks/useCreativeApi";
import {
  inputCls,
  labelCls,
  btnPrimary,
  btnGhost,
  Modal,
  StatusPill,
  modelShortName,
} from "./shared";

export default function RoundtableSession({
  sessionId,
  book,
  characters,
  chapters,
  mutations,
  onBack,
}: {
  sessionId: string;
  book: CreativeBook;
  characters: BookCharacter[];
  chapters: BookChapter[];
  mutations: ReturnType<typeof useCreativeWriterMutations>;
  onBack: () => void;
}) {
  const { session } = useSession(sessionId);
  const { turns } = useSessionTurns(sessionId);
  const api = useCreativeApi();
  const [note, setNote] = useState("");
  const [showAccept, setShowAccept] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  // Lock-the-door playout: auto-chain rounds until the exchange target, then
  // the Nexus finalizes (grade + cleanup + angles) into a playout option.
  const [playing, setPlaying] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [playout, setPlayout] = useState<Awaited<
    ReturnType<ReturnType<typeof useCreativeApi>["finalizeSession"]>
  > | null>(null);
  const playingRef = useRef(false);
  const charTurnsRef = useRef(0);

  const characterTurnCount = useMemo(
    () => turns.filter((t) => t.role === "character").length,
    [turns]
  );
  useEffect(() => {
    charTurnsRef.current = characterTurnCount;
  }, [characterTurnCount]);

  const targetTurns = session?.targetTurns || 48;

  const finalize = async () => {
    setFinalizing(true);
    const result = await api.finalizeSession(sessionId);
    if (result) setPlayout(result);
    setFinalizing(false);
  };

  const lockTheDoor = async () => {
    setPlaying(true);
    playingRef.current = true;
    let errored = false;
    while (playingRef.current && charTurnsRef.current < targetTurns) {
      const r = await api.runRound(sessionId);
      if (!r) {
        errored = true;
        break;
      }
      if (r.stopped) break;
    }
    const finished = playingRef.current;
    playingRef.current = false;
    setPlaying(false);
    // The door unlocks: finalize automatically when the playout ran its course.
    if (finished && !errored && charTurnsRef.current >= Math.min(targetTurns, 8)) {
      await finalize();
    }
  };

  const stopPlayout = async () => {
    playingRef.current = false;
    setPlaying(false);
    await api.stopSession(sessionId);
  };

  useEffect(() => {
    // Leaving the room mid-playout stops the auto-chain (the current round
    // still completes server-side; its turns are persisted).
    return () => {
      playingRef.current = false;
    };
  }, []);

  // Resilience: the finalize result also lives in Firestore (session.finalSceneId),
  // so a dropped HTTP response — or reopening a completed session — still shows
  // the playout card.
  useEffect(() => {
    if (!session?.finalSceneId || playout) return;
    getDoc(doc(firestore, COLLECTIONS.bookScenes, session.finalSceneId)).then((snap) => {
      if (!snap.exists()) return;
      const s = snap.data() as any;
      setPlayout({
        sceneId: snap.id,
        grade: s.nexusGrade || { overall: 0, dialogue: 0, tension: 0, consistency: 0 },
        verdict: s.verdict || "",
        angles: s.angles || [],
        ahaMoments: s.ahaMoments || [],
        recommendation: s.recommendation || "",
        cleanedPlayout: s.cleanedText || "",
      });
    });
  }, [session?.finalSceneId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isRunning = session?.status === "running" || api.running || playing;

  const charById = useMemo(() => {
    const map: Record<string, BookCharacter> = {};
    for (const c of characters) map[c.id] = c;
    return map;
  }, [characters]);

  // Auto-scroll as turns stream in.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length]);

  if (!session) return <p className="text-sm text-zinc-500 p-6">Loading session…</p>;

  const lastTurnIndex = turns.length ? Math.max(...turns.map((t) => t.turnIndex)) : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-white/[0.08] flex-wrap">
        <button onClick={onBack} className="text-zinc-500 hover:text-white text-sm">
          ← Sessions
        </button>
        <StatusPill value={isRunning ? "running" : session.status} />
        <p className="text-sm text-white font-medium flex-1 min-w-0 truncate">
          {session.premise}
        </p>
        <span className="text-[11px] text-zinc-600">
          Round {session.round} · {session.turnCount || 0} turns ·{" "}
          {((session.totalTokens || 0) / 1000).toFixed(1)}k tokens
        </span>
        {session.lastGrade?.overall != null && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1">
            <Award size={13} /> {session.lastGrade.overall}/100
          </span>
        )}
      </div>

      {/* Cast strip */}
      <div className="flex items-center gap-2 py-3 overflow-x-auto">
        {session.characterIds.map((id) => {
          const c = charById[id];
          if (!c) return null;
          return (
            <div
              key={id}
              className="flex items-center gap-2 bg-[#0A0A0F] border border-white/[0.08] rounded-full pl-1 pr-3 py-1 shrink-0"
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-black/80"
                style={{ backgroundColor: c.color }}
              >
                {(c.name || "?").slice(0, 1).toUpperCase()}
              </div>
              <span className="text-[11px] text-zinc-300">{c.name}</span>
              <span className="text-[9px] text-zinc-600">
                {modelShortName(
                  session.characterModels?.[id] ||
                    c.modelOverride ||
                    book.defaultCharacterModel ||
                    "hermes"
                )}
              </span>
            </div>
          );
        })}
        <div className="flex items-center gap-2 bg-amber-500/5 border border-amber-500/25 rounded-full px-3 py-1 shrink-0">
          <Zap size={11} className="text-amber-400" />
          <span className="text-[11px] text-amber-300">
            Nexus · {modelShortName(session.nexusModel)}
          </span>
        </div>
      </div>

      {/* Live feed */}
      <div
        ref={feedRef}
        className="flex-1 min-h-0 overflow-y-auto space-y-3 py-4 pr-2"
      >
        {turns.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-zinc-400 mb-1">The room is quiet.</p>
            <p className="text-xs text-zinc-600">
              Hit "Run Round" — the Nexus will set the stage and the cast starts improvising,
              line by line, live.
            </p>
          </div>
        )}
        {turns.map((t) => (
          <TurnBubble key={t.id} turn={t} character={t.characterId ? charById[t.characterId] : undefined} />
        ))}
        {isRunning && (
          <div className="flex items-center gap-2 text-xs text-violet-400 pl-2">
            <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
            {playing
              ? `Door locked — the cast is playing it out (${characterTurnCount}/${targetTurns} exchanges)…`
              : "The room is live — turns stream in as the cast performs…"}
          </div>
        )}
        {finalizing && (
          <div className="flex items-center gap-2 text-xs text-amber-400 pl-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            The door unlocks — the Nexus is grading the playout, cleaning it up, and mining
            it for angles…
          </div>
        )}
        {playout && <PlayoutCard playout={playout} />}
      </div>

      {/* Error */}
      {(api.error || session.error) && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2 mb-2">
          {api.error || session.error}
        </p>
      )}

      {/* Controls */}
      <div className="border-t border-white/[0.08] pt-3 space-y-2">
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && note.trim()) {
                await mutations.addDirectorNote(sessionId, note.trim(), lastTurnIndex);
                setNote("");
              }
            }}
            className={inputCls}
            placeholder="Director's note to the room — e.g. 'Bring the storm inside. Someone knocks at the door.' (Enter to send)"
          />
          <button
            onClick={async () => {
              if (!note.trim()) return;
              await mutations.addDirectorNote(sessionId, note.trim(), lastTurnIndex);
              setNote("");
            }}
            disabled={!note.trim()}
            className={btnGhost}
          >
            <Send size={15} />
          </button>
        </div>
        {/* Playout progress */}
        {characterTurnCount > 0 && session.status !== "complete" && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all"
                style={{ width: `${Math.min(100, (characterTurnCount / targetTurns) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-600 shrink-0">
              {characterTurnCount}/{targetTurns} exchanges
            </span>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={lockTheDoor}
            disabled={isRunning || finalizing || session.status === "complete"}
            className={btnPrimary}
            title={`Auto-run rounds until ${targetTurns} exchanges, then the Nexus grades, cleans, and presents the playout`}
          >
            <Lock size={15} />
            {playing
              ? "Playing it out…"
              : session.status === "complete"
              ? "Playout complete"
              : characterTurnCount > 0
              ? "Lock the Door — finish the playout"
              : "Lock the Door — Play It Out"}
          </button>
          <button
            onClick={() => api.runRound(sessionId)}
            disabled={isRunning || finalizing || session.status === "complete"}
            className={btnGhost}
            title="Run a single round, then pause for your direction"
          >
            <Play size={15} />
            {session.round > 0 ? `One round (R${session.round + 1})` : "One round"}
          </button>
          {isRunning && (
            <button onClick={stopPlayout} className={btnGhost}>
              <StopCircle size={15} className="text-red-400" /> Stop
            </button>
          )}
          {!isRunning && !finalizing && !playout && characterTurnCount >= 4 && session.status !== "complete" && (
            <button
              onClick={finalize}
              className={btnGhost}
              title="Unlock now: grade + clean up what has played so far into a playout option"
            >
              <Star size={15} className="text-amber-400" /> Finalize playout
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setShowAccept(true)}
            disabled={characterTurnCount === 0 || isRunning}
            className={btnGhost}
            title="Snapshot the raw transcript into the Scene Library without the Nexus cleanup pass"
          >
            <Check size={15} className="text-emerald-400" /> Accept raw scene
          </button>
        </div>
      </div>

      {showAccept && (
        <AcceptSceneModal
          defaultTitle={session.premise.slice(0, 60)}
          chapters={chapters}
          onClose={() => setShowAccept(false)}
          onAccept={async (title, chapterId) => {
            await mutations.acceptScene(session, turns, { title, chapterId });
            setShowAccept(false);
          }}
        />
      )}
    </div>
  );
}

function PlayoutCard({
  playout,
}: {
  playout: {
    grade: { overall: number; dialogue: number; tension: number; consistency: number };
    verdict: string;
    angles: string[];
    ahaMoments: string[];
    recommendation: string;
    cleanedPlayout: string;
  } | null;
}) {
  const [showClean, setShowClean] = useState(false);
  if (!playout) return null;
  const g = playout.grade;
  const gradeColor = (v: number) =>
    v >= 75 ? "text-emerald-400" : v >= 50 ? "text-amber-400" : "text-red-400";

  return (
    <div className="border border-amber-500/30 bg-gradient-to-b from-amber-500/10 to-transparent rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Star size={16} className="text-amber-400" />
        <p className="text-sm font-semibold text-white flex-1">
          Playout ready — saved to your Scene Library
        </p>
        {(
          [
            ["Overall", g.overall],
            ["Dialogue", g.dialogue],
            ["Tension", g.tension],
            ["Consistency", g.consistency],
          ] as const
        ).map(([label, v]) => (
          <span key={label} className="text-[11px] text-zinc-500">
            {label}: <span className={`font-bold ${gradeColor(v)}`}>{v}</span>
          </span>
        ))}
      </div>

      {playout.verdict && <p className="text-xs text-zinc-300 leading-relaxed">{playout.verdict}</p>}

      {playout.ahaMoments.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-amber-300 mb-1.5">⚡ Aha moments</p>
          <ul className="space-y-1">
            {playout.ahaMoments.map((a, i) => (
              <li key={i} className="text-xs text-zinc-300 flex gap-2">
                <span className="text-amber-400 shrink-0">•</span> {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {playout.angles.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-violet-300 mb-1.5">Storytelling angles</p>
          <ul className="space-y-1">
            {playout.angles.map((a, i) => (
              <li key={i} className="text-xs text-zinc-400 flex gap-2">
                <span className="text-violet-400 shrink-0">•</span> {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {playout.recommendation && (
        <p className="text-xs text-zinc-400 italic border-l-2 border-amber-500/40 pl-3">
          Nexus recommends: {playout.recommendation}
        </p>
      )}

      <div>
        <button
          onClick={() => setShowClean(!showClean)}
          className="text-xs text-violet-400 hover:text-violet-300 font-medium"
        >
          {showClean ? "Hide cleaned playout" : "Read the cleaned playout"}
        </button>
        {showClean && (
          <pre className="mt-2 text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed max-h-72 overflow-y-auto bg-[#0A0A0F] border border-white/[0.08] rounded-xl p-4">
            {playout.cleanedPlayout}
          </pre>
        )}
      </div>

      <p className="text-[10px] text-zinc-600">
        Next step: open the Scene Library (back → Writers' Room) and hit "Craft into prose"
        to weave this playout into the chapter — the Crafter uses the cleaned version.
      </p>
    </div>
  );
}

function TurnBubble({
  turn,
  character,
}: {
  turn: SessionTurn;
  character?: BookCharacter;
}) {
  if (turn.role === "scene_header") {
    return (
      <div className="mx-auto max-w-2xl bg-[#12121A] border border-white/[0.08] rounded-2xl p-5 text-center">
        <p className="text-[10px] uppercase tracking-widest text-amber-400 mb-2">
          ✦ The Nexus sets the scene ✦
        </p>
        <p className="text-sm text-zinc-300 italic leading-relaxed">{turn.text}</p>
      </div>
    );
  }

  if (turn.role === "nexus") {
    return (
      <div className="flex gap-3 max-w-3xl">
        <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
          <Zap size={14} className="text-amber-400" />
        </div>
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl rounded-tl-sm px-4 py-3 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold text-amber-400">Novel Nexus</span>
            {turn.grade && (
              <span className="text-[10px] text-amber-500/80">
                {turn.grade.overall != null
                  ? `round grade ${turn.grade.overall}/100`
                  : [
                      turn.grade.tension != null ? `tension ${turn.grade.tension}/10` : "",
                      turn.grade.voiceConsistency != null
                        ? `voices ${turn.grade.voiceConsistency}/10`
                        : "",
                      turn.grade.drift != null ? `drift ${turn.grade.drift}/10` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            )}
          </div>
          <p className="text-xs text-amber-100/80 leading-relaxed">{turn.text}</p>
        </div>
      </div>
    );
  }

  if (turn.role === "user_note" || turn.role === "director_note") {
    return (
      <div className="mx-auto max-w-xl text-center">
        <p className="text-[11px] text-violet-400">
          <ChevronRight size={11} className="inline" /> Director's note: {turn.text}
        </p>
      </div>
    );
  }

  const color = character?.color || "#a78bfa";
  return (
    <div className="flex gap-3 max-w-3xl">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-black/80 shrink-0"
        style={{ backgroundColor: color }}
      >
        {(turn.characterName || "?").slice(0, 1).toUpperCase()}
      </div>
      <div
        className="bg-[#12121A] border rounded-2xl rounded-tl-sm px-4 py-3 min-w-0"
        style={{ borderColor: `${color}40` }}
      >
        <span className="text-[11px] font-semibold block mb-1" style={{ color }}>
          {turn.characterName}
        </span>
        <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">{turn.text}</p>
      </div>
    </div>
  );
}

function AcceptSceneModal({
  defaultTitle,
  chapters,
  onClose,
  onAccept,
}: {
  defaultTitle: string;
  chapters: BookChapter[];
  onClose: () => void;
  onAccept: (title: string, chapterId: string | null) => Promise<void>;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [chapterId, setChapterId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  return (
    <Modal title="Accept scene into the book" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Scene title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Target chapter (optional — pick later if unsure)</label>
          <select
            value={chapterId}
            onChange={(e) => setChapterId(e.target.value)}
            className={inputCls}
          >
            <option value="">No chapter yet</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-zinc-500">
          The full transcript and the Nexus's grade are snapshotted into your Scene Library.
          From there, hand it to the Crafter to become polished chapter prose.
        </p>
      </div>
      <div className="flex items-center gap-3 mt-6">
        <div className="flex-1" />
        <button onClick={onClose} className={btnGhost}>
          Cancel
        </button>
        <button
          onClick={async () => {
            setSaving(true);
            await onAccept(title.trim() || defaultTitle, chapterId || null);
          }}
          disabled={saving}
          className={btnPrimary}
        >
          {saving ? "Saving…" : "Accept scene"}
        </button>
      </div>
    </Modal>
  );
}
