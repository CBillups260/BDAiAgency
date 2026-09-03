import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Feather,
  Plus,
  BookOpen,
  Users,
  Map,
  Target,
  MessageCircle,
  Zap,
  Sliders,
  Upload,
  Download,
  Trash,
} from "@geist-ui/icons";
import {
  useBooks,
  useChapters,
  useCharacters,
  useLore,
  usePlotThreads,
  useCreativeWriterMutations,
  CHARACTER_COLORS,
  type CreativeBook,
} from "../hooks/useCreativeWriter";
import { useCreativeApi, type BibleCandidates } from "../hooks/useCreativeApi";
import {
  DEFAULT_NEXUS_MODEL_ID,
  DEFAULT_CHARACTER_MODEL_ID,
} from "../lib/writerModels";
import {
  inputCls,
  labelCls,
  btnPrimary,
  btnGhost,
  EmptyState,
  Modal,
  StatusPill,
  WriterModelSelect,
} from "./creative/shared";
import ChaptersTab from "./creative/ChaptersTab";
import CharactersTab from "./creative/CharactersTab";
import LoreTab from "./creative/LoreTab";
import PlotThreadsTab from "./creative/PlotThreadsTab";
import WritersRoom from "./creative/WritersRoom";
import NexusPanel from "./creative/NexusPanel";

type TabKey = "chapters" | "characters" | "lore" | "plots" | "room" | "nexus";

const TABS: { key: TabKey; label: string; icon: typeof BookOpen }[] = [
  { key: "chapters", label: "Chapters", icon: BookOpen },
  { key: "characters", label: "Characters", icon: Users },
  { key: "lore", label: "Lore & World", icon: Map },
  { key: "plots", label: "Plot Threads", icon: Target },
  { key: "room", label: "Writers' Room", icon: MessageCircle },
  { key: "nexus", label: "Nexus", icon: Zap },
];

export default function CreativeWriter({ user }: { user: { uid: string } }) {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { books, loading } = useBooks();
  const mutations = useCreativeWriterMutations(user.uid);

  const [tab, setTab] = useState<TabKey>("chapters");
  const [showSettings, setShowSettings] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const book = books.find((b) => b.id === bookId) || null;

  const { chapters } = useChapters(book?.id ?? null);
  const { characters } = useCharacters(book?.id ?? null);
  const { lore } = useLore(book?.id ?? null);
  const { threads } = usePlotThreads(book?.id ?? null);

  const totalWords = chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);

  const createBook = async () => {
    const id = await mutations.addBook({ title: "Untitled Book" });
    navigate(`/writer/${id}`);
    setShowSettings(true);
  };

  const exportManuscript = () => {
    if (!book) return;
    const md = [
      `# ${book.title}`,
      book.logline ? `*${book.logline}*` : "",
      "",
      ...chapters.map((c) => `\n## ${c.title}\n\n${c.content || "_(empty)_"}`),
    ].join("\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${book.title.replace(/[^\w\s-]/g, "").trim() || "manuscript"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col lg:flex-row gap-4 lg:gap-6 min-h-0 lg:h-[calc(100dvh-120px)]"
    >
      {/* Book sidebar */}
      <div className="w-full lg:w-64 shrink-0 flex flex-col gap-3 lg:overflow-y-auto">
        <div className="flex items-center gap-2 px-1">
          <Feather size={16} className="text-violet-400" />
          <h2 className="text-sm font-semibold text-white flex-1">Your Books</h2>
          <button
            onClick={createBook}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181824] transition-all"
            title="New book"
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto scrollbar-hide snap-x-tabs pb-1 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0">
        {books.map((b) => {
          const active = b.id === bookId;
          return (
            <button
              key={b.id}
              onClick={() => navigate(`/writer/${b.id}`)}
              className={`text-left px-4 py-3.5 rounded-2xl border transition-all w-[220px] shrink-0 lg:w-auto lg:shrink ${
                active
                  ? "bg-violet-500/10 border-violet-500/40"
                  : "bg-[#0A0A0F] border-white/[0.08] hover:border-violet-500/25"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold text-white truncate flex-1">{b.title}</p>
                <StatusPill value={b.status} />
              </div>
              {b.genre && <p className="text-[11px] text-zinc-500 mb-1.5">{b.genre}</p>}
              {b.wordCountGoal ? (
                <BookProgress bookId={b.id} goal={b.wordCountGoal} active={active} words={active ? totalWords : null} />
              ) : null}
            </button>
          );
        })}
        </div>
        {!loading && books.length === 0 && (
          <div className="text-center py-8 px-3">
            <p className="text-xs text-zinc-500 mb-3">
              Your creative studio awaits — books, chapters, characters, lore, and a full AI
              writers' room.
            </p>
            <button onClick={createBook} className={`${btnPrimary} w-full justify-center`}>
              <Plus size={15} /> Start your first book
            </button>
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {book ? (
          <>
            {/* Book header */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-semibold text-white truncate">{book.title}</h1>
                <p className="text-xs text-zinc-500">
                  {totalWords.toLocaleString()} words
                  {book.wordCountGoal
                    ? ` of ${book.wordCountGoal.toLocaleString()} goal (${Math.round(
                        (totalWords / book.wordCountGoal) * 100
                      )}%)`
                    : ""}
                  {book.logline ? ` · ${book.logline}` : ""}
                </p>
              </div>
              <button onClick={() => setShowImport(true)} className={btnGhost} title="Paste an existing manuscript — the Nexus extracts characters, lore, and plot threads">
                <Upload size={14} /> Import Bible
              </button>
              <button onClick={exportManuscript} className={btnGhost} title="Download the manuscript as markdown">
                <Download size={14} /> Export
              </button>
              <button onClick={() => setShowSettings(true)} className={btnGhost}>
                <Sliders size={14} /> Book Settings
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1.5 mb-5 overflow-x-auto pb-0.5">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                      active
                        ? "bg-gradient-to-r from-violet-600 to-sky-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-[#181824]"
                    }`}
                  >
                    <Icon size={15} />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Active tab */}
            <div className="flex-1 min-h-0">
              {tab === "chapters" && (
                <ChaptersTab
                  book={book}
                  chapters={chapters}
                  mutations={mutations}
                  onReportCreated={() => setTab("nexus")}
                />
              )}
              {tab === "characters" && (
                <CharactersTab book={book} characters={characters} mutations={mutations} />
              )}
              {tab === "lore" && <LoreTab book={book} lore={lore} mutations={mutations} />}
              {tab === "plots" && (
                <PlotThreadsTab book={book} threads={threads} mutations={mutations} />
              )}
              {tab === "room" && (
                <WritersRoom
                  book={book}
                  characters={characters}
                  chapters={chapters}
                  mutations={mutations}
                />
              )}
              {tab === "nexus" && (
                <NexusPanel
                  book={book}
                  chapters={chapters}
                  characters={characters}
                  mutations={mutations}
                />
              )}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<Feather size={26} />}
            title={loading ? "Loading your library…" : "Select a book — or start a new one"}
            subtitle="Creative Writer is your full book studio: manuscript, story bible, a Novel Nexus editor that grades and guards your story, and a live Writers' Room where AI actors improvise scenes for you."
            action={
              !loading && books.length > 0 ? undefined : !loading ? (
                <button onClick={createBook} className={btnPrimary}>
                  <Plus size={15} /> New Book
                </button>
              ) : undefined
            }
          />
        )}
      </div>

      {showSettings && book && (
        <BookSettingsModal
          book={book}
          onClose={() => setShowSettings(false)}
          onSave={async (data) => {
            await mutations.updateBook(book.id, data);
            setShowSettings(false);
          }}
          onDelete={async () => {
            if (
              confirm(
                `Delete "${book.title}" and ALL its chapters, characters, lore, scenes, and sessions? This cannot be undone.`
              )
            ) {
              await mutations.deleteBook(book.id);
              setShowSettings(false);
              navigate("/writer");
            }
          }}
        />
      )}

      {showImport && book && (
        <ImportBibleModal
          book={book}
          mutations={mutations}
          existingCount={characters.length}
          onClose={() => setShowImport(false)}
        />
      )}
    </motion.div>
  );
}

function BookProgress({
  goal,
  words,
}: {
  bookId: string;
  goal: number;
  active: boolean;
  words: number | null;
}) {
  if (words == null) return null;
  const pct = Math.min(100, Math.round((words / goal) * 100));
  return (
    <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function BookSettingsModal({
  book,
  onClose,
  onSave,
  onDelete,
}: {
  book: CreativeBook;
  onClose: () => void;
  onSave: (data: Partial<CreativeBook>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<CreativeBook>>({ ...book });
  const set = (k: keyof CreativeBook, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal title="Book Settings" onClose={onClose} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Title</label>
          <input value={form.title || ""} onChange={(e) => set("title", e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Genre</label>
            <input
              value={form.genre || ""}
              onChange={(e) => set("genre", e.target.value)}
              className={inputCls}
              placeholder="Epic fantasy, thriller…"
            />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select
              value={form.status || "drafting"}
              onChange={(e) => set("status", e.target.value)}
              className={inputCls}
            >
              <option value="drafting">drafting</option>
              <option value="revising">revising</option>
              <option value="complete">complete</option>
            </select>
          </div>
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Logline — the book in one sentence</label>
          <input
            value={form.logline || ""}
            onChange={(e) => set("logline", e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Synopsis</label>
          <textarea
            value={form.synopsis || ""}
            onChange={(e) => set("synopsis", e.target.value)}
            className={`${inputCls} min-h-[90px]`}
          />
        </div>
        <div>
          <label className={labelCls}>Style notes — voice, tense, influences</label>
          <textarea
            value={form.styleNotes || ""}
            onChange={(e) => set("styleNotes", e.target.value)}
            className={`${inputCls} min-h-[70px]`}
            placeholder="e.g. close third past tense, sparse Cormac McCarthy-style prose"
          />
        </div>
        <div>
          <label className={labelCls}>Target audience</label>
          <textarea
            value={form.targetAudience || ""}
            onChange={(e) => set("targetAudience", e.target.value)}
            className={`${inputCls} min-h-[70px]`}
            placeholder="e.g. adult grimdark readers who loved The First Law"
          />
        </div>
        <div>
          <label className={labelCls}>Novel Nexus model (editor/director/crafter)</label>
          <WriterModelSelect
            tier="nexus"
            value={form.nexusModel || DEFAULT_NEXUS_MODEL_ID}
            onChange={(v) => set("nexusModel", v)}
          />
        </div>
        <div>
          <label className={labelCls}>Default character actor model</label>
          <WriterModelSelect
            tier="character"
            value={form.defaultCharacterModel || DEFAULT_CHARACTER_MODEL_ID}
            onChange={(v) => set("defaultCharacterModel", v)}
          />
        </div>
        <div>
          <label className={labelCls}>Word count goal</label>
          <input
            type="number"
            value={form.wordCountGoal ?? ""}
            onChange={(e) => set("wordCountGoal", e.target.value ? Number(e.target.value) : null)}
            className={inputCls}
            placeholder="e.g. 90000"
          />
        </div>
        <div>
          <label className={labelCls}>Story Intelligence model (auto bible sync)</label>
          <WriterModelSelect
            tier="nexus"
            value={form.intelModel || "google/gemini-2.5-pro"}
            onChange={(v) => set("intelModel", v)}
          />
          <p className="text-[10px] text-zinc-600 mt-1.5">
            Runs after every chapter save to extract characters, lore, and plot beats —
            a fast model keeps saves snappy.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-6">
        <button onClick={onDelete} className="text-red-400 hover:text-red-300 text-sm">
          <Trash size={15} className="inline mr-1" /> Delete book
        </button>
        <div className="flex-1" />
        <button onClick={onClose} className={btnGhost}>
          Cancel
        </button>
        <button onClick={() => onSave(form)} className={btnPrimary}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function ImportBibleModal({
  book,
  mutations,
  existingCount,
  onClose,
}: {
  book: CreativeBook;
  mutations: ReturnType<typeof useCreativeWriterMutations>;
  existingCount: number;
  onClose: () => void;
}) {
  const api = useCreativeApi();
  const [text, setText] = useState("");
  const [candidates, setCandidates] = useState<BibleCandidates | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const keyOf = (kind: string, i: number) => `${kind}:${i}`;
  const toggle = (key: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const saveSelected = async () => {
    if (!candidates) return;
    setSaving(true);
    let colorIdx = existingCount;
    for (let i = 0; i < candidates.characters.length; i++) {
      if (!picked.has(keyOf("char", i))) continue;
      const c = candidates.characters[i];
      await mutations.addCharacter(book.id, {
        name: c.name,
        role: (["protagonist", "antagonist", "supporting"].includes(c.role || "")
          ? c.role
          : "supporting") as any,
        archetype: c.archetype || null,
        bio: c.bio || null,
        voice: c.voice || null,
        goals: c.goals || null,
        appearance: c.appearance || null,
        color: CHARACTER_COLORS[colorIdx++ % CHARACTER_COLORS.length],
      });
    }
    for (let i = 0; i < candidates.lore.length; i++) {
      if (!picked.has(keyOf("lore", i))) continue;
      const l = candidates.lore[i];
      await mutations.addLore(book.id, {
        type: (["location", "faction", "item", "rule", "event"].includes(l.type || "")
          ? l.type
          : "other") as any,
        title: l.title,
        content: l.content || "",
      });
    }
    for (let i = 0; i < candidates.plotThreads.length; i++) {
      if (!picked.has(keyOf("plot", i))) continue;
      const p = candidates.plotThreads[i];
      await mutations.addPlotThread(book.id, {
        title: p.title,
        description: p.description || null,
        status: (["setup", "developing", "payoff"].includes(p.status || "")
          ? p.status
          : "setup") as any,
      });
    }
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="Import Story Bible from a manuscript" onClose={onClose} wide>
      {!candidates ? (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Paste chapters or notes from an existing manuscript. The Nexus reads it and extracts
            characters (with observed voice), world lore, and plot threads — you review and pick
            what to keep.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={`${inputCls} min-h-[220px] font-serif`}
            placeholder="Paste your manuscript text here…"
          />
          {api.error && <p className="text-xs text-red-400">{api.error}</p>}
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className={btnGhost}>
              Cancel
            </button>
            <button
              onClick={async () => {
                const result = await api.extractBible(book.id, text);
                if (result) {
                  setCandidates(result);
                  const all = new Set<string>();
                  result.characters.forEach((_, i) => all.add(keyOf("char", i)));
                  result.lore.forEach((_, i) => all.add(keyOf("lore", i)));
                  result.plotThreads.forEach((_, i) => all.add(keyOf("plot", i)));
                  setPicked(all);
                }
              }}
              disabled={!text.trim() || api.extracting}
              className={btnPrimary}
            >
              {api.extracting ? "The Nexus is reading…" : "Extract"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {(
            [
              ["char", "Characters", candidates.characters.map((c) => `${c.name} — ${c.bio || c.archetype || ""}`)],
              ["lore", "Lore & World", candidates.lore.map((l) => `[${l.type || "other"}] ${l.title} — ${l.content || ""}`)],
              ["plot", "Plot Threads", candidates.plotThreads.map((p) => `${p.title} — ${p.description || ""}`)],
            ] as [string, string, string[]][]
          ).map(([kind, label, rows]) => (
            <div key={kind}>
              <p className="text-xs font-semibold text-white mb-2">
                {label} ({rows.length})
              </p>
              {rows.length === 0 && <p className="text-xs text-zinc-600">None found.</p>}
              <div className="space-y-1.5">
                {rows.map((row, i) => {
                  const key = keyOf(kind, i);
                  return (
                    <label key={key} className="flex items-start gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={picked.has(key)}
                        onChange={() => toggle(key)}
                        className="mt-0.5 accent-violet-500"
                      />
                      <span className="text-xs text-zinc-400 group-hover:text-zinc-300 line-clamp-2">
                        {row}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-3">
            <button onClick={() => setCandidates(null)} className={btnGhost}>
              Back
            </button>
            <button onClick={saveSelected} disabled={saving || picked.size === 0} className={btnPrimary}>
              {saving ? "Saving…" : `Add ${picked.size} to the bible`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
