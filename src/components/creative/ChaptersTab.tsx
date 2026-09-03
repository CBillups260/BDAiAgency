import { useState, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { NarrationPlayer } from "../ui/narration-player";
import {
  BookOpen,
  Plus,
  Trash,
  ChevronUp,
  ChevronDown,
  Zap,
  Layers,
  Clipboard,
  Check,
  Cpu,
  Headphones,
  Eye,
  Edit3,
  Type,
  Feather,
  Maximize2,
  Minimize2,
} from "@geist-ui/icons";
import {
  useDrafts,
  useCraftPlans,
  type BookChapter,
  type CreativeBook,
} from "../../hooks/useCreativeWriter";
import { usePersistedState } from "../../hooks/usePersistedState";
import CraftSession from "./CraftSession";
import type { useCreativeWriterMutations } from "../../hooks/useCreativeWriter";
import { useCreativeApi } from "../../hooks/useCreativeApi";
import {
  inputCls,
  labelCls,
  btnPrimary,
  btnGhost,
  EmptyState,
  StatusPill,
  normalizeBreaks,
  proseComponents,
} from "./shared";

const CHAPTER_STATUSES = ["outline", "draft", "revised", "final"] as const;

const SELECTION_ACTIONS: { key: string; label: string; hint: string }[] = [
  { key: "rewrite", label: "Rewrite", hint: "Same beats, better prose" },
  { key: "deepen", label: "Deepen", hint: "Interiority, subtext, emotional weight" },
  { key: "extend", label: "Extend", hint: "Grow the moment (~2×)" },
  { key: "shorten", label: "Shorten", hint: "Cut to ~half, keep every beat" },
  { key: "dialogue", label: "Dialogue", hint: "Let the characters speak it" },
  { key: "vivid", label: "Vivid", hint: "Concrete sensory grounding" },
];

/**
 * Map a DOM selection (plain text — markdown asterisks are not rendered) back
 * to a char range in the markdown source.
 */
function findSelectionRange(
  content: string,
  plainSel: string
): { start: number; end: number } | null {
  const direct = content.indexOf(plainSel);
  if (direct >= 0) return { start: direct, end: direct + plainSel.length };
  const map: number[] = [];
  let plain = "";
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "*") continue;
    plain += content[i];
    map.push(i);
  }
  for (const candidate of [plainSel, plainSel.replace(/\n+/g, "\n\n")]) {
    const idx = plain.indexOf(candidate);
    if (idx >= 0) return { start: map[idx], end: map[idx + candidate.length - 1] + 1 };
  }
  return null;
}

export interface NarrationSegment {
  start: number;
  end: number;
  startChar: number;
  endChar: number;
}


/**
 * Word-level karaoke for the segment currently being spoken. The audio has
 * exact SEGMENT timings; word times are interpolated within the segment by
 * character position — close enough that the sweep tracks the voice.
 */
function KaraokeSegment({
  text,
  seg,
  audioRef,
}: {
  text: string;
  seg: NarrationSegment;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}) {
  // Tokenize once: words + the whitespace between them (kept for layout).
  const tokens = useMemo(() => text.split(/(\s+)/), [text]);
  const cume = useMemo(() => {
    // Cumulative char count at the END of each token (speech-weight proxy).
    let n = 0;
    return tokens.map((t) => (n += t.length));
  }, [tokens]);
  const total = cume[cume.length - 1] || 1;
  const [spokenChars, setSpokenChars] = useState(0);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = audioRef.current;
      if (!el) return;
      const frac = Math.min(1, Math.max(0, (el.currentTime - seg.start) / (seg.end - seg.start || 1)));
      const target = Math.round(frac * total);
      setSpokenChars((prev) => (prev === target ? prev : target));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [seg, total, audioRef]);

  return (
    <div className="font-serif text-[16px] leading-[1.9] whitespace-pre-wrap mb-5">
      {tokens.map((tok, i) => {
        if (/^\s+$/.test(tok)) return tok;
        const display = tok.replace(/\*/g, "");
        const spoken = cume[i] <= spokenChars;
        const current =
          !spoken && (i === 0 ? 0 : cume[i - 1]) < spokenChars && spokenChars < cume[i];
        return (
          <span
            key={i}
            className={
              current
                ? "text-white bg-gradient-to-r from-violet-500/30 to-sky-400/30 rounded px-0.5 -mx-0.5 transition-colors duration-150"
                : spoken
                ? "text-zinc-100 transition-colors duration-300"
                : "text-zinc-500 transition-colors duration-300"
            }
          >
            {display}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Manuscript-quality reading view. When a narration timeline is supplied it
 * renders segment-by-segment so the passage being read aloud is highlighted
 * and kept in view — with word-level karaoke inside the active segment.
 */
function ProseView({
  title,
  content,
  timeline,
  activeSegment,
  onSegmentClick,
  audioRef,
}: {
  title: string;
  content: string;
  timeline?: NarrationSegment[] | null;
  activeSegment?: number;
  onSegmentClick?: (seg: NarrationSegment) => void;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
}) {
  const segRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Keep the spoken passage centered as the voice moves through the chapter.
  useEffect(() => {
    if (activeSegment == null || activeSegment < 0) return;
    segRefs.current[activeSegment]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSegment]);

  return (
    <div className="h-full overflow-y-auto bg-[#0A0A0F] border border-white/[0.08] rounded-2xl">
      <div className="max-w-2xl mx-auto px-8 py-10">
        <h2 className="text-2xl font-serif font-semibold text-white text-center mb-10 tracking-wide">
          {title}
        </h2>
        {timeline && timeline.length > 0 ? (
          timeline.map((seg, i) => (
            <div
              key={i}
              ref={(el) => {
                segRefs.current[i] = el;
              }}
              onClick={() => onSegmentClick?.(seg)}
              title={onSegmentClick ? "Jump the narration here" : undefined}
              className={`-mx-4 px-4 py-1 rounded-xl border transition-all duration-500 ${
                onSegmentClick ? "cursor-pointer" : ""
              } ${
                i === activeSegment
                  ? "bg-white/[0.03] border-white/[0.14]"
                  : "border-transparent opacity-90"
              }`}
            >
              {i === activeSegment && audioRef ? (
                <KaraokeSegment
                  text={content.slice(seg.startChar, seg.endChar)}
                  seg={seg}
                  audioRef={audioRef}
                />
              ) : (
                <ReactMarkdown components={proseComponents(i === 0)}>
                  {normalizeBreaks(content.slice(seg.startChar, seg.endChar))}
                </ReactMarkdown>
              )}
            </div>
          ))
        ) : (
          <ReactMarkdown components={proseComponents(true)}>
            {normalizeBreaks(content)}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

export default function ChaptersTab({
  book,
  chapters,
  mutations,
  onReportCreated,
}: {
  book: CreativeBook;
  chapters: BookChapter[];
  mutations: ReturnType<typeof useCreativeWriterMutations>;
  onReportCreated: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const api = useCreativeApi();

  // Story Intelligence status: runs automatically after every save.
  const [intel, setIntel] = useState<{ state: "idle" | "running" | "done"; message: string }>({
    state: "idle",
    message: "",
  });
  // Narration state.
  const [voice, setVoice] = useState("onyx");
  const [narrating, setNarrating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [narrateError, setNarrateError] = useState<string | null>(null);
  const intelRunRef = useRef(0);
  // Write (textarea) vs Read (manuscript typography).
  const [viewMode, setViewMode] = useState<"write" | "read">("write");
  const [formatNote, setFormatNote] = useState<string | null>(null);
  // Read-along: segment timeline + which segment the voice is currently on.
  const [timeline, setTimeline] = useState<NarrationSegment[] | null>(null);
  const [narratedChars, setNarratedChars] = useState(0);
  const [activeSegment, setActiveSegment] = useState(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Continuous listening: when a chapter's narration ends, roll into the next.
  const [autoAdvance, setAutoAdvance] = usePersistedState("writer:autoAdvance", false);
  const [upNext, setUpNext] = useState<string | null>(null);
  // Highlight-to-edit: floating Nexus toolbar over a Read-mode selection.
  const [selEdit, setSelEdit] = useState<{ text: string; x: number; y: number } | null>(null);
  const [selBusy, setSelBusy] = useState<string | null>(null);
  const [selResult, setSelResult] = useState<{
    replacement: string;
    action: string;
    range: { start: number; end: number };
    original: string;
  } | null>(null);
  const [selError, setSelError] = useState<string | null>(null);
  // Nexus restructure of the whole table of contents.
  const [restructureNote, setRestructureNote] = useState<string | null>(null);
  // Craft session: the master-crafter walkthrough for this chapter.
  const [craftOpen, setCraftOpen] = useState(false);
  const { plans: craftPlans } = useCraftPlans(selectedId);
  const activePlan = craftPlans[0] || null;
  // Distraction-free full-screen editing (Esc exits).
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const selected = chapters.find((c) => c.id === selectedId) || null;

  // Local editing buffer so typing doesn't fire a Firestore write per keystroke.
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (selected) {
      setTitle(selected.title);
      setSummary(selected.summary || "");
      setContent(selected.content || "");
      setDirty(false);
      setIntel({ state: "idle", message: "" });
      setAudioUrl(selected.narrationUrl || null);
      if (selected.narrationVoice) setVoice(selected.narrationVoice);
      setNarrateError(null);
      setFormatNote(null);
      setTimeline(selected.narrationTimeline || null);
      setNarratedChars(selected.narratedChars || 0);
      setActiveSegment(-1);
      // Open finished chapters in the reading view; drafts open ready to write.
      setViewMode((selected.content || "").trim().length > 500 ? "read" : "write");
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read-along only works when the on-screen text is exactly what was narrated.
  const readAlongReady = Boolean(timeline?.length && narratedChars === content.length);
  // Narration exists but no longer matches the text (edits applied since) —
  // word highlighting is off until a re-narration re-syncs audio to text.
  const readAlongStale = Boolean(
    audioUrl && (!timeline?.length || narratedChars !== content.length)
  );

  const onAudioTime = () => {
    const audio = audioRef.current;
    if (!audio || !readAlongReady || !timeline) return;
    const t = audio.currentTime;
    const idx = timeline.findIndex((s) => t >= s.start && t < s.end);
    if (idx !== activeSegment) setActiveSegment(idx);
  };

  const autoFormat = async () => {
    if (!content.trim()) return;
    setFormatNote(null);
    const result = await api.formatChapter(content, book.styleNotes || undefined);
    if (!result) return;
    setContent(result.formatted);
    setDirty(true);
    setViewMode("read");
    setFormatNote(
      result.contentWarning ||
        "Formatted — review in the reading view, then Save to keep it."
    );
  };

  /** After every save, Story Intelligence reads the chapter and grows the bible. */
  const runIntel = async (chapterId: string, force = false) => {
    const runId = ++intelRunRef.current;
    setIntel({ state: "running", message: "Story Intelligence is reading your chapter…" });
    const result = await api.ingestChapter(book.id, chapterId, force);
    if (runId !== intelRunRef.current) return; // superseded by a newer save
    if (!result || result.skipped) {
      setIntel({
        state: "idle",
        message: result?.reason && !/unchanged/i.test(result.reason) ? result.reason : "",
      });
      return;
    }
    const a = result.applied!;
    const parts = [
      a.charactersAdded && `+${a.charactersAdded} character${a.charactersAdded > 1 ? "s" : ""}`,
      a.charactersEnriched && `${a.charactersEnriched} enriched`,
      a.loreAdded && `+${a.loreAdded} lore`,
      a.loreEnriched && `${a.loreEnriched} lore updated`,
      a.threadsAdded && `+${a.threadsAdded} thread${a.threadsAdded > 1 ? "s" : ""}`,
      a.threadsAdvanced && `${a.threadsAdvanced} thread${a.threadsAdvanced > 1 ? "s" : ""} advanced`,
    ].filter(Boolean);
    setIntel({
      state: "done",
      message: parts.length
        ? `Bible updated: ${parts.join(", ")}`
        : "Chapter read — bible already up to date.",
    });
    // The ingest wrote a fresh summary server-side; mirror it locally so the
    // next save doesn't clobber it with the stale buffer.
    if (result.chapterSummary) setSummary(result.chapterSummary);
  };

  const save = async () => {
    if (!selected) return;
    await mutations.updateChapter(selected.id, { title, summary, content });
    setDirty(false);
    void runIntel(selected.id);
  };

  const listen = async (chapter?: BookChapter) => {
    const target = chapter ?? selected;
    if (!target) return;
    // Only the manually-selected chapter can have unsaved edits worth saving.
    if (!chapter && dirty) await save();
    setNarrating(true);
    setNarrateError(null);
    try {
      const result = await api.narrateChapter(target.id, voice);
      setAudioUrl(result.url);
      setTimeline(result.timeline || null);
      setNarratedChars(result.narratedChars || 0);
      setViewMode("read");
      if (result.truncated)
        setNarrateError("Note: chapter exceeds ~30 min of audio — narration covers the first part.");
      // Start reading along right away.
      setTimeout(() => audioRef.current?.play().catch(() => {}), 400);
    } catch (err: any) {
      setNarrateError(err.message);
    } finally {
      setNarrating(false);
    }
  };

  const onProseMouseUp = () => {
    if (viewMode !== "read") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setSelEdit(null);
      return;
    }
    const text = sel.toString().trim();
    if (text.length < 12 || text.length > 8000) {
      setSelEdit(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelError(null);
    setSelEdit({ text, x: rect.left + rect.width / 2, y: rect.top });
  };

  const runSelectionEdit = async (action: string) => {
    if (!selEdit || !selected) return;
    const range = findSelectionRange(content, selEdit.text);
    if (!range) {
      setSelError("Couldn't locate that selection in the source — try selecting within one passage.");
      return;
    }
    setSelBusy(action);
    setSelError(null);
    const source = content.slice(range.start, range.end);
    const result = await api.editSelection(book.id, selected.id, source, action);
    setSelBusy(null);
    if (!result) {
      setSelError(api.error || "The Nexus edit failed — try again.");
      return;
    }
    setSelResult({ ...result, range, original: source });
    setSelEdit(null);
  };

  const applySelectionEdit = () => {
    if (!selResult) return;
    setContent(
      (prev) =>
        prev.slice(0, selResult.range.start) +
        selResult.replacement +
        prev.slice(selResult.range.end)
    );
    setDirty(true);
    setSelResult(null);
  };

  /** Narration finished — roll into the next chapter when auto-advance is on. */
  const onNarrationEnded = async () => {
    setActiveSegment(-1);
    if (!autoAdvance) return;
    const idx = chapters.findIndex((c) => c.id === selectedId);
    const next = chapters
      .slice(idx + 1)
      .find((c) => (c.content || "").trim().length > 0);
    if (!next) {
      setNarrateError("End of the book — no further chapters with content.");
      return;
    }
    if (dirty) await save();
    setUpNext(next.title);
    setSelectedId(next.id); // the selection effect resets buffers to the new chapter
    // Narrate by id (server reads Firestore) — cache hit resumes instantly,
    // an unnarrated chapter generates first, then plays.
    await listen(next);
    setUpNext(null);
  };

  const addChapter = async () => {
    const id = await mutations.addChapter(book.id, {
      title: `Chapter ${chapters.length + 1}`,
      order: chapters.length,
    });
    setSelectedId(id);
  };

  const move = async (chapter: BookChapter, dir: -1 | 1) => {
    const idx = chapters.findIndex((c) => c.id === chapter.id);
    const swap = chapters[idx + dir];
    if (!swap) return;
    await Promise.all([
      mutations.updateChapter(chapter.id, { order: swap.order }),
      mutations.updateChapter(swap.id, { order: chapter.order }),
    ]);
  };

  const wordCount = useMemo(() => (content.match(/\S+/g) || []).length, [content]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 h-full min-h-0">
      {/* Chapter list */}
      <div className="w-full lg:w-64 shrink-0 flex flex-col gap-2 max-h-[38dvh] lg:max-h-none overflow-y-auto pr-1">
        <button onClick={addChapter} className={`${btnGhost} justify-center`}>
          <Plus size={15} /> New Chapter
        </button>
        {chapters.length >= 2 && (
          <button
            onClick={async () => {
              if (
                !confirm(
                  "Let the Nexus restructure the book? It will renumber, reorder where the story reads better, and refresh every chapter's title and summary."
                )
              )
                return;
              setRestructureNote("The Nexus is restructuring the book…");
              const result = await api.restructure(book.id);
              setRestructureNote(
                result
                  ? `${result.editorNote} (${result.changed} chapter${result.changed === 1 ? "" : "s"} updated)`
                  : api.error || "Restructure failed."
              );
            }}
            disabled={api.restructuring}
            className={`${btnGhost} justify-center text-xs`}
            title="The Nexus reorders, retitles, and re-summarizes every chapter so the book flows as one"
          >
            <Cpu size={13} className="text-violet-400" />
            {api.restructuring ? "Restructuring…" : "✨ Nexus Restructure"}
          </button>
        )}
        {restructureNote && (
          <p className="text-[10px] text-zinc-500 px-1 leading-relaxed">{restructureNote}</p>
        )}
        {chapters.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={`text-left px-3.5 py-3 rounded-xl border transition-all group ${
              selectedId === c.id
                ? "bg-violet-500/10 border-violet-500/40"
                : "bg-[#0A0A0F] border-white/[0.08] hover:border-violet-500/25"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">Ch. {i + 1}</span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    move(c, -1);
                  }}
                  className="text-zinc-500 hover:text-white cursor-pointer"
                >
                  <ChevronUp size={13} />
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    move(c, 1);
                  }}
                  className="text-zinc-500 hover:text-white cursor-pointer"
                >
                  <ChevronDown size={13} />
                </span>
              </div>
            </div>
            <p className="text-sm text-white font-medium truncate mt-0.5">{c.title}</p>
            <div className="flex items-center justify-between mt-1.5">
              <StatusPill value={c.status} />
              <span className="text-[10px] text-zinc-600">
                {(c.wordCount || 0).toLocaleString()} words
              </span>
            </div>
          </button>
        ))}
        {chapters.length === 0 && (
          <p className="text-xs text-zinc-600 text-center py-6">
            No chapters yet — start your manuscript.
          </p>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0 min-h-[60dvh] lg:min-h-0 flex flex-col">
        {selected ? (
          <div
            className={
              fullscreen
                ? "fixed inset-0 z-[80] bg-[#0A0A0F] p-4 md:p-6 flex flex-col gap-3 overflow-hidden"
                : "flex flex-col h-full min-h-0 gap-3"
            }
          >
            <div className="flex items-center gap-3">
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
                className={`${inputCls} text-base font-semibold flex-1`}
                placeholder="Chapter title"
              />
              <select
                value={selected.status}
                onChange={(e) =>
                  mutations.updateChapter(selected.id, { status: e.target.value as any })
                }
                className={`${inputCls} w-32`}
              >
                {CHAPTER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (confirm(`Delete "${selected.title}"? This cannot be undone.`)) {
                    mutations.deleteChapter(selected.id);
                    setSelectedId(null);
                  }
                }}
                className="p-2.5 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Delete chapter"
              >
                <Trash size={16} />
              </button>
            </div>

            <div className="flex gap-2">
              <input
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  setDirty(true);
                }}
                className={inputCls}
                placeholder="One-line summary — or let the Nexus write it ✨"
              />
              <button
                onClick={async () => {
                  if (!selected) return;
                  if (dirty) await save();
                  const result = await api.titleChapter(selected.id);
                  if (result) {
                    setTitle(result.title);
                    setSummary(result.summary);
                  }
                }}
                disabled={api.titling || !content.trim()}
                className={`${btnGhost} shrink-0 px-3`}
                title="Nexus writes this chapter's title and one-line summary from the text"
              >
                {api.titling ? "…" : "✨ Title & summary"}
              </button>
            </div>

            {/* View toggle + auto-format */}
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-white/[0.08] overflow-hidden">
                <button
                  onClick={() => setViewMode("write")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all ${
                    viewMode === "write"
                      ? "bg-violet-500/15 text-violet-300"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <Edit3 size={12} /> Write
                </button>
                <button
                  onClick={() => setViewMode("read")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all ${
                    viewMode === "read"
                      ? "bg-violet-500/15 text-violet-300"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  <Eye size={12} /> Read
                </button>
              </div>
              <button
                onClick={autoFormat}
                disabled={api.formatting || !content.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs font-medium text-zinc-400 hover:text-white hover:border-violet-500/40 transition-all disabled:opacity-50"
                title="AI formatting pass: paragraphs, dialogue breaks, scene dividers, italics — never changes your words"
              >
                <Type size={12} className="text-violet-400" />
                {api.formatting ? "Formatting…" : "Auto-Format"}
              </button>
              {formatNote && (
                <span
                  className={`text-[11px] ${
                    formatNote.includes("review before saving") || formatNote.includes("shifted")
                      ? "text-amber-400"
                      : "text-emerald-400"
                  }`}
                >
                  {formatNote}
                </span>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setFullscreen(!fullscreen)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs font-medium text-zinc-400 hover:text-white hover:border-white/20 transition-all"
                title={fullscreen ? "Exit full screen (Esc)" : "Full-screen editing — the chapter takes the whole window"}
              >
                {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                {fullscreen ? "Exit" : "Focus"}
              </button>
            </div>

            {craftOpen && activePlan ? (
              <CraftSession
                plan={activePlan}
                title={title || selected.title}
                content={content}
                mutations={mutations}
                onApplyText={(excerpt, replacement) => {
                  if (!content.includes(excerpt)) return false;
                  setContent((prev) => prev.replace(excerpt, replacement));
                  setDirty(true);
                  return true;
                }}
                onClose={() => setCraftOpen(false)}
              />
            ) : viewMode === "write" ? (
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                }}
                className={`${inputCls} flex-1 min-h-[300px] resize-none font-serif text-[15px] leading-relaxed`}
                placeholder="Write or paste your chapter here — raw text is fine; Auto-Format will shape it into a clean manuscript…"
              />
            ) : (
              <div className="flex-1 min-h-[300px]" onMouseUp={onProseMouseUp}>
                <ProseView
                  title={title || selected.title}
                  content={content}
                  timeline={readAlongReady ? timeline : null}
                  activeSegment={activeSegment}
                  audioRef={audioRef}
                  onSegmentClick={
                    readAlongReady
                      ? (seg) => {
                          const audio = audioRef.current;
                          if (!audio) return;
                          audio.currentTime = seg.start + 0.01;
                          audio.play().catch(() => {});
                        }
                      : undefined
                  }
                />
              </div>
            )}

            {/* Highlight-to-edit: floating Nexus toolbar over the selection */}
            {selEdit && !selResult && (
              <div
                className="fixed z-[60] -translate-x-1/2 -translate-y-full pb-2"
                style={{ left: selEdit.x, top: selEdit.y }}
              >
                <div className="bg-[#12121A] border border-violet-500/40 rounded-xl shadow-2xl shadow-violet-500/10 p-1.5 flex items-center gap-1">
                  {SELECTION_ACTIONS.map((a) => (
                    <button
                      key={a.key}
                      onClick={() => runSelectionEdit(a.key)}
                      disabled={selBusy !== null}
                      title={a.hint}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                        selBusy === a.key
                          ? "bg-violet-500/20 text-violet-300 animate-pulse"
                          : "text-zinc-300 hover:bg-violet-500/15 hover:text-white"
                      }`}
                    >
                      {selBusy === a.key ? "Nexus…" : a.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setSelEdit(null)}
                    className="px-1.5 text-zinc-600 hover:text-zinc-300"
                  >
                    ✕
                  </button>
                </div>
                {selError && (
                  <p className="mt-1 text-[10px] text-red-400 bg-[#12121A] border border-red-500/30 rounded-lg px-2 py-1">
                    {selError}
                  </p>
                )}
              </div>
            )}

            {/* Review the Nexus's inline edit before it touches the chapter */}
            {selResult && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                <div
                  className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                  onClick={() => setSelResult(null)}
                />
                <div className="relative bg-[#12121A] border border-white/[0.08] rounded-2xl w-full max-w-2xl max-h-[80dvh] flex flex-col shadow-2xl">
                  <div className="px-6 py-4 border-b border-white/[0.08]">
                    <p className="text-sm font-semibold text-white capitalize">
                      Nexus {selResult.action} — review the change
                    </p>
                  </div>
                  <div className="p-6 overflow-y-auto space-y-4">
                    <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                      <p className="text-[10px] text-red-400/80 uppercase tracking-wider mb-2">Original</p>
                      <p className="text-xs text-zinc-500 whitespace-pre-wrap font-serif line-through decoration-red-500/30 max-h-40 overflow-y-auto">
                        {selResult.original}
                      </p>
                    </div>
                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                      <p className="text-[10px] text-emerald-400/80 uppercase tracking-wider mb-2">
                        Nexus version
                      </p>
                      <p className="text-sm text-zinc-200 whitespace-pre-wrap font-serif max-h-72 overflow-y-auto">
                        {selResult.replacement}
                      </p>
                    </div>
                  </div>
                  <div className="px-6 py-4 border-t border-white/[0.08] flex gap-2 justify-end">
                    <button onClick={() => setSelResult(null)} className={btnGhost}>
                      Discard
                    </button>
                    <button onClick={applySelectionEdit} className={btnPrimary}>
                      <Check size={15} /> Replace in chapter
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Story Intelligence status strip */}
            {(intel.state !== "idle" || intel.message) && (
              <div
                className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 border border-white/[0.08] bg-white/[0.03] ${
                  intel.state === "running" ? "text-violet-300" : "text-zinc-300"
                }`}
              >
                <Cpu size={13} className={intel.state === "running" ? "animate-pulse text-violet-400" : "text-violet-400"} />
                <span className="flex-1">{intel.message}</span>
                {intel.state === "done" && (
                  <span className="text-[10px] text-zinc-500">
                    check Characters · Lore · Plots for ✨ drafts
                  </span>
                )}
              </div>
            )}

            {/* Narration player — the little symphony. */}
            {audioUrl && (
              <NarrationPlayer
                src={audioUrl}
                onElement={(el) => {
                  audioRef.current = el;
                }}
                onTimeUpdate={onAudioTime}
                onEnded={() => void onNarrationEnded()}
                rightSlot={
                  <div className="flex items-center gap-2 shrink-0">
                    {upNext && (
                      <span className="text-[10px] text-amber-400/90 animate-pulse">
                        up next: {upNext}…
                      </span>
                    )}
                    {readAlongReady && (
                      <span
                        className="text-[10px] text-violet-400/80"
                        title="The reading view highlights and follows the passage being spoken"
                      >
                        ● read-along
                      </span>
                    )}
                    <button
                      onClick={() => setAutoAdvance(!autoAdvance)}
                      className={`flex items-center gap-1.5 text-[10px] font-semibold rounded-lg px-2 py-1 border transition-all ${
                        autoAdvance
                          ? "text-violet-300 bg-white/[0.04] border-white/[0.14]"
                          : "text-zinc-500 border-white/[0.08] hover:text-zinc-300"
                      }`}
                      title={
                        autoAdvance
                          ? "Continuous listening ON — when this chapter ends, the next one starts reading (generating its narration first if needed)"
                          : "Continuous listening OFF — playback stops at the end of this chapter"
                      }
                    >
                      <span
                        className={`w-6 h-3 rounded-full relative transition-colors ${
                          autoAdvance
                            ? "bg-gradient-to-r from-violet-500 to-sky-400"
                            : "bg-white/[0.1]"
                        }`}
                      >
                        <span
                          className={`absolute top-[2px] w-2 h-2 rounded-full bg-white transition-all ${
                            autoAdvance ? "left-[14px]" : "left-[2px]"
                          }`}
                        />
                      </span>
                      Auto-next
                    </button>
                  </div>
                }
              />
            )}
            {narrateError && <p className="text-[11px] text-amber-400">{narrateError}</p>}
            {readAlongStale && !narrating && (
              <div className="flex items-center gap-2 text-[11px] text-zinc-400 bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2">
                <span className="flex-1">
                  The chapter text has changed since this narration was recorded, so
                  word-by-word read-along is off (the highlights would point at the wrong
                  words).
                </span>
                <button
                  onClick={() => void listen()}
                  className="shrink-0 font-semibold text-violet-300 hover:text-white border border-white/[0.12] hover:border-white/25 rounded-lg px-2.5 py-1 transition-colors"
                  title="Regenerate narration from the current text — read-along re-enables automatically"
                >
                  Re-narrate & sync
                </button>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-zinc-500">{wordCount.toLocaleString()} words</span>
              <div className="flex-1" />
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className={`${inputCls} w-28 py-2`}
                title="Narrator voice"
              >
                {["onyx", "fable", "nova", "alloy", "ash", "echo", "shimmer"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void listen()}
                disabled={narrating || !content.trim()}
                className={btnGhost}
                title="Narrate this chapter as an audiobook (cached until the text changes)"
              >
                <Headphones size={15} className="text-violet-400" />
                {narrating ? "Narrating…" : "Listen"}
              </button>
              <button onClick={save} disabled={!dirty} className={btnPrimary}>
                <Check size={15} /> {dirty ? "Save" : "Saved"}
              </button>
              <button
                onClick={async () => {
                  if (dirty) await save();
                  const result = await api.analyze(book.id, "chapter", selected.id);
                  if (result) onReportCreated();
                }}
                disabled={api.analyzing || !content.trim()}
                className={btnGhost}
                title="Send this chapter to the Novel Nexus for grading, plot-hole and pacing analysis"
              >
                <Zap size={15} className="text-amber-400" />
                {api.analyzing ? "Nexus is reading…" : "Analyze with Nexus"}
              </button>
              <button
                onClick={() => selected && runIntel(selected.id, true)}
                disabled={intel.state === "running" || !content.trim()}
                className={btnGhost}
                title="Re-run Story Intelligence: re-read this chapter and update characters, lore, and plot threads"
              >
                <Cpu size={15} className="text-violet-400" /> Sync Bible
              </button>
              <button
                onClick={async () => {
                  if (!selected) return;
                  // Resume an existing session with open moments; else craft anew.
                  if (activePlan && activePlan.moments.some((m) => m.status === "open")) {
                    setCraftOpen(true);
                    return;
                  }
                  if (dirty) await save();
                  const result = await api.craftPlan(book.id, selected.id);
                  if (result) setCraftOpen(true);
                }}
                disabled={api.craftingPlan || !content.trim()}
                className={btnGhost}
                title="The master crafter reads this chapter against the whole story, pins the moments with the most potential, and drafts alternatives you choose between"
              >
                <Feather size={15} className="text-violet-400" />
                {api.craftingPlan
                  ? "The crafter is reading…"
                  : activePlan && activePlan.moments.some((m) => m.status === "open")
                  ? "Resume Craft Session"
                  : "Craft Session"}
              </button>
              <button onClick={() => setShowDrafts(!showDrafts)} className={btnGhost}>
                <Layers size={15} /> Drafts
              </button>
            </div>
            {api.error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2">
                {api.error}
              </p>
            )}

            {showDrafts && (
              <DraftsDrawer
                chapterId={selected.id}
                onInsert={(text) => {
                  setContent((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
                  setDirty(true);
                }}
                mutations={mutations}
              />
            )}
          </div>
        ) : (
          <EmptyState
            icon={<BookOpen size={24} />}
            title="Select a chapter to write"
            subtitle="Or create a new one. The Nexus can analyze any chapter for pacing, plot holes, and consistency."
          />
        )}
      </div>
    </div>
  );
}

function DraftsDrawer({
  chapterId,
  onInsert,
  mutations,
}: {
  chapterId: string;
  onInsert: (text: string) => void;
  mutations: ReturnType<typeof useCreativeWriterMutations>;
}) {
  const { drafts, loading } = useDrafts(chapterId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div className="border border-white/[0.08] rounded-xl bg-[#0A0A0F] p-4 max-h-72 overflow-y-auto">
      <p className="text-xs font-medium text-zinc-400 mb-3">
        Drafts for this chapter — Crafter output lands here; insert it when you're happy.
      </p>
      {loading && <p className="text-xs text-zinc-600">Loading…</p>}
      {!loading && drafts.length === 0 && (
        <p className="text-xs text-zinc-600">
          No drafts yet. Accept a scene in the Writers' Room, then "Craft into prose".
        </p>
      )}
      <div className="space-y-2">
        {drafts.map((d) => (
          <div key={d.id} className="border border-white/[0.08] rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <StatusPill value={d.source === "crafter" ? "crafted" : "draft"} />
              <span className="text-[10px] text-zinc-600 truncate">{d.model || "manual"}</span>
              <div className="flex-1" />
              <button
                onClick={() => onInsert(d.content)}
                className="text-[11px] text-violet-400 hover:text-violet-300 font-medium"
              >
                Insert into chapter
              </button>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(d.content);
                  setCopied(d.id);
                  setTimeout(() => setCopied(null), 1500);
                }}
                className="text-zinc-500 hover:text-white"
                title="Copy"
              >
                {copied === d.id ? <Check size={13} /> : <Clipboard size={13} />}
              </button>
              <button
                onClick={() => mutations.deleteDraft(d.id)}
                className="text-zinc-500 hover:text-red-400"
                title="Delete draft"
              >
                <Trash size={13} />
              </button>
            </div>
            {d.integrationNote && (
              <p className="text-[11px] text-amber-400/80 mb-1.5 italic">{d.integrationNote}</p>
            )}
            <p
              className={`text-xs text-zinc-400 whitespace-pre-wrap font-serif cursor-pointer ${
                expanded === d.id ? "" : "line-clamp-3"
              }`}
              onClick={() => setExpanded(expanded === d.id ? null : d.id)}
            >
              {d.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
