import { useState } from "react";
import { MessageCircle, Plus, Trash, Film, Award, Feather } from "@geist-ui/icons";
import {
  useCreativeSessions,
  useScenes,
  type BookCharacter,
  type BookChapter,
  type CreativeBook,
  type CreativeSession,
  type useCreativeWriterMutations,
} from "../../hooks/useCreativeWriter";
import { useCreativeApi } from "../../hooks/useCreativeApi";
import {
  DEFAULT_NEXUS_MODEL_ID,
  DEFAULT_CHARACTER_MODEL_ID,
} from "../../lib/writerModels";
import {
  inputCls,
  labelCls,
  btnPrimary,
  btnGhost,
  EmptyState,
  Modal,
  StatusPill,
  WriterModelSelect,
  modelShortName,
} from "./shared";
import RoundtableSession from "./RoundtableSession";

export default function WritersRoom({
  book,
  characters,
  chapters,
  mutations,
}: {
  book: CreativeBook;
  characters: BookCharacter[];
  chapters: BookChapter[];
  mutations: ReturnType<typeof useCreativeWriterMutations>;
}) {
  const { sessions } = useCreativeSessions(book.id);
  const { scenes } = useScenes(book.id);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const api = useCreativeApi();

  if (activeSessionId) {
    return (
      <RoundtableSession
        sessionId={activeSessionId}
        book={book}
        characters={characters}
        chapters={chapters}
        mutations={mutations}
        onBack={() => setActiveSessionId(null)}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-8">
      {/* Sessions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Live Sessions</h3>
            <p className="text-xs text-zinc-500 max-w-xl">
              The Nexus sets a scene and directs your cast of AI actors — each powered by its
              own model — while grading the improv live. Keep the rounds you love.
            </p>
          </div>
          <button
            onClick={() => setShowWizard(true)}
            disabled={characters.length < 2}
            className={btnPrimary}
            title={characters.length < 2 ? "Create at least 2 characters first" : ""}
          >
            <Plus size={15} /> New Session
          </button>
        </div>

        {sessions.length === 0 ? (
          <EmptyState
            icon={<MessageCircle size={24} />}
            title="No writers' room sessions yet"
            subtitle={
              characters.length < 2
                ? "Create at least 2 characters in the Characters tab, then convene the room."
                : "Set a scene premise, pick 5–8 characters, and watch them improvise it live."
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="bg-[#0A0A0F] border border-white/[0.08] rounded-2xl p-5 hover:border-violet-500/40 transition-all cursor-pointer group"
                onClick={() => setActiveSessionId(s.id)}
              >
                <div className="flex items-center gap-2 mb-2">
                  <StatusPill value={s.status} />
                  <span className="text-[11px] text-zinc-600">
                    Round {s.round} · {s.turnCount || 0} turns
                  </span>
                  <div className="flex-1" />
                  {s.lastGrade?.overall != null && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                      <Award size={12} /> {s.lastGrade.overall}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete this session and its transcript?"))
                        mutations.deleteSession(s.id);
                    }}
                    className="text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash size={14} />
                  </button>
                </div>
                <p className="text-sm text-white font-medium line-clamp-2 mb-2">{s.premise}</p>
                <div className="flex -space-x-2">
                  {s.characterIds.slice(0, 8).map((id) => {
                    const c = characters.find((ch) => ch.id === id);
                    return (
                      <div
                        key={id}
                        className="w-7 h-7 rounded-full border-2 border-[#0A0A0F] flex items-center justify-center text-[10px] font-bold text-black/80"
                        style={{ backgroundColor: c?.color || "#666" }}
                        title={c?.name}
                      >
                        {(c?.name || "?").slice(0, 1).toUpperCase()}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scene library */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-1">Scene Library</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Scenes you accepted from the room. Hand any of them to the Crafter to turn the improv
          into polished chapter prose.
        </p>
        {scenes.length === 0 ? (
          <EmptyState
            icon={<Film size={24} />}
            title="No accepted scenes yet"
            subtitle='Run a session and hit "Accept scene into book" when the cast nails it.'
          />
        ) : (
          <div className="space-y-3">
            {scenes.map((sc) => (
              <SceneCard
                key={sc.id}
                scene={sc}
                chapters={chapters}
                api={api}
                mutations={mutations}
              />
            ))}
          </div>
        )}
        {api.error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2 mt-3">
            {api.error}
          </p>
        )}
      </div>

      {showWizard && (
        <SessionWizard
          book={book}
          characters={characters}
          chapters={chapters}
          onClose={() => setShowWizard(false)}
          onCreate={async (data) => {
            const id = await mutations.createSession(book.id, data);
            setShowWizard(false);
            setActiveSessionId(id);
          }}
        />
      )}
    </div>
  );
}

function SceneCard({
  scene,
  chapters,
  api,
  mutations,
}: {
  scene: any;
  chapters: BookChapter[];
  api: ReturnType<typeof useCreativeApi>;
  mutations: ReturnType<typeof useCreativeWriterMutations>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [craftTarget, setCraftTarget] = useState(scene.chapterId || chapters[0]?.id || "");
  const [instructions, setInstructions] = useState("");
  const [showCraft, setShowCraft] = useState(false);
  const hasClean = Boolean((scene.cleanedText || "").trim());

  return (
    <div className="bg-[#0A0A0F] border border-white/[0.08] rounded-2xl p-5">
      <div className="flex items-center gap-2 flex-wrap">
        <StatusPill value={scene.status} />
        {scene.mode === "chapter_sim" && (
          <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/25">
            📖 chapter playout
          </span>
        )}
        <p className="text-sm font-medium text-white flex-1 min-w-0 truncate">{scene.title}</p>
        {scene.nexusGrade?.overall != null && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400">
            <Award size={12} /> Nexus grade: {scene.nexusGrade.overall}
          </span>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-zinc-500 hover:text-white"
        >
          {expanded
            ? "Hide"
            : hasClean
            ? "Read playout"
            : `Transcript (${scene.transcript?.length || 0} lines)`}
        </button>
        <button
          onClick={() => setShowCraft(!showCraft)}
          className={`${btnGhost} py-1.5 px-3 text-xs`}
          disabled={api.crafting}
        >
          <Feather size={13} className="text-violet-400" />
          {api.crafting ? "Crafting…" : "Craft into prose"}
        </button>
        <button
          onClick={() => {
            if (confirm("Delete this scene?")) mutations.deleteScene(scene.id);
          }}
          className="text-zinc-700 hover:text-red-400"
        >
          <Trash size={14} />
        </button>
      </div>
      <p className="text-xs text-zinc-500 mt-1.5 line-clamp-1">{scene.premise}</p>

      {showCraft && (
        <div className="mt-3 border border-violet-500/25 bg-violet-500/5 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Target chapter</label>
              <select
                value={craftTarget}
                onChange={(e) => setCraftTarget(e.target.value)}
                className={inputCls}
              >
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Instructions for the Crafter (optional)</label>
              <input
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                className={inputCls}
                placeholder="e.g. tighten the middle, keep Mara's last line verbatim"
              />
            </div>
          </div>
          <button
            onClick={async () => {
              if (!craftTarget) return;
              const result = await api.craftScene(scene.id, craftTarget, instructions);
              if (result) setShowCraft(false);
            }}
            disabled={!craftTarget || api.crafting}
            className={btnPrimary}
          >
            {api.crafting
              ? "The Crafter is writing…"
              : "Craft — the draft appears in that chapter's Drafts drawer"}
          </button>
        </div>
      )}

      {expanded && (
        <div className="mt-3 border-t border-white/[0.08] pt-3 space-y-3">
          {(scene.ahaMoments || []).length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-amber-300 mb-1">⚡ Aha moments</p>
              {(scene.ahaMoments || []).map((a: string, i: number) => (
                <p key={i} className="text-xs text-zinc-300">• {a}</p>
              ))}
            </div>
          )}
          {(scene.angles || []).length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-violet-300 mb-1">Storytelling angles</p>
              {(scene.angles || []).map((a: string, i: number) => (
                <p key={i} className="text-xs text-zinc-400">• {a}</p>
              ))}
            </div>
          )}
          {hasClean && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowRaw(false)}
                className={`text-[11px] px-2 py-1 rounded-md border ${!showRaw ? "bg-violet-500/15 border-violet-500/40 text-violet-300" : "border-white/[0.08] text-zinc-500"}`}
              >
                ✨ Cleaned playout
              </button>
              <button
                onClick={() => setShowRaw(true)}
                className={`text-[11px] px-2 py-1 rounded-md border ${showRaw ? "bg-violet-500/15 border-violet-500/40 text-violet-300" : "border-white/[0.08] text-zinc-500"}`}
              >
                Raw improv
              </button>
            </div>
          )}
          {hasClean && !showRaw ? (
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">
              {scene.cleanedText}
            </pre>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {(scene.transcript || []).map((t: any, i: number) => (
                <p key={i} className="text-xs">
                  <span
                    className={
                      t.role === "nexus" || t.role === "scene_header"
                        ? "text-amber-400 font-medium"
                        : "text-violet-300 font-medium"
                    }
                  >
                    {t.characterName}:
                  </span>{" "}
                  <span className="text-zinc-400">{t.text}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionWizard({
  book,
  characters,
  chapters,
  onClose,
  onCreate,
}: {
  book: CreativeBook;
  characters: BookCharacter[];
  chapters: BookChapter[];
  onClose: () => void;
  onCreate: (data: Partial<CreativeSession>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"scene" | "chapter_sim">(
    chapters.some((c) => (c.content || "").trim()) ? "chapter_sim" : "scene"
  );
  const [chapterId, setChapterId] = useState<string>(
    chapters.find((c) => (c.content || "").trim())?.id || ""
  );
  const [premise, setPremise] = useState("");
  const [sceneGoal, setSceneGoal] = useState("");
  const [setting, setSetting] = useState("");
  const [castIds, setCastIds] = useState<string[]>([]);
  const [characterModels, setCharacterModels] = useState<Record<string, string>>({});
  const [nexusModel, setNexusModel] = useState(book.nexusModel || DEFAULT_NEXUS_MODEL_ID);
  const [turnsPerRound, setTurnsPerRound] = useState(12);
  const [targetTurns, setTargetTurns] = useState(48);
  const [temperature, setTemperature] = useState(0.9);
  const [creating, setCreating] = useState(false);

  const toggleCast = (id: string) => {
    setCastIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : prev.length >= 8 ? prev : [...prev, id]
    );
  };

  const canCreate = premise.trim().length > 0 && castIds.length >= 2;

  return (
    <Modal title="Convene the Writers' Room" onClose={onClose} wide>
      <div className="space-y-4">
        {/* Mode: freeform scene vs chapter deep-dive */}
        <div className="flex gap-2">
          {(
            [
              ["chapter_sim", "📖 Chapter Deep-Dive", "Simulate a chapter to mine deeper ideas, angles, and aha moments"],
              ["scene", "🎭 Freeform Scene", "Improvise any scene from a premise"],
            ] as const
          ).map(([key, label, hint]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              disabled={key === "chapter_sim" && !chapters.some((c) => (c.content || "").trim())}
              title={hint}
              className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all disabled:opacity-40 ${
                mode === key
                  ? "bg-violet-500/15 border-violet-500/50 text-white"
                  : "bg-[#0A0A0F] border-white/[0.08] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "chapter_sim" && (
          <div>
            <label className={labelCls}>Chapter to deepen</label>
            <select value={chapterId} onChange={(e) => setChapterId(e.target.value)} className={inputCls}>
              {chapters
                .filter((c) => (c.content || "").trim())
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
            <p className="text-[10px] text-zinc-600 mt-1.5">
              The cast lives inside this chapter's events and digs beneath them — the Nexus
              hunts for angles and aha moments the written page hasn't found.
            </p>
          </div>
        )}

        <div>
          <label className={labelCls}>
            {mode === "chapter_sim"
              ? "What to explore — the question this playout digs into"
              : "Scene premise — what is this scene?"}
          </label>
          <textarea
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            className={`${inputCls} min-h-[70px]`}
            placeholder={
              mode === "chapter_sim"
                ? "e.g. What was really said between Seraphine and Lucien before the ritual — and what does he still refuse to admit?"
                : "e.g. The heist crew confronts Mara about the missing map, hours before the vault job."
            }
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Scene goal (what it must accomplish)</label>
            <input
              value={sceneGoal}
              onChange={(e) => setSceneGoal(e.target.value)}
              className={inputCls}
              placeholder="e.g. reveal the betrayal without naming the traitor"
            />
          </div>
          <div>
            <label className={labelCls}>Setting (optional — Nexus decides if blank)</label>
            <input
              value={setting}
              onChange={(e) => setSetting(e.target.value)}
              className={inputCls}
              placeholder="e.g. the safehouse basement, past midnight, storm outside"
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>
            Cast — pick 5–8 for the full roundtable feel ({castIds.length} selected, 2 minimum)
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {characters.map((c) => {
              const selected = castIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCast(c.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                    selected
                      ? "bg-violet-500/10 border-violet-500/50"
                      : "bg-[#0A0A0F] border-white/[0.08] hover:border-violet-500/25"
                  }`}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-black/80 shrink-0"
                    style={{ backgroundColor: c.color }}
                  >
                    {(c.name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">{c.name}</p>
                    <p className="text-[10px] text-zinc-600 capitalize truncate">{c.role}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {castIds.length > 0 && (
          <div>
            <label className={labelCls}>Actor models (per character)</label>
            <div className="space-y-2">
              {castIds.map((id) => {
                const c = characters.find((ch) => ch.id === id)!;
                return (
                  <div key={id} className="flex items-center gap-3">
                    <span className="text-xs text-white w-32 truncate shrink-0">{c.name}</span>
                    <WriterModelSelect
                      tier="character"
                      value={characterModels[id] || c.modelOverride || ""}
                      onChange={(v) =>
                        setCharacterModels((m) => ({ ...m, [id]: v }))
                      }
                      allowDefault
                      defaultLabel={`Default (${modelShortName(
                        book.defaultCharacterModel || DEFAULT_CHARACTER_MODEL_ID
                      )})`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Novel Nexus (director) model</label>
            <WriterModelSelect tier="nexus" value={nexusModel} onChange={setNexusModel} />
            <p className="text-[10px] text-zinc-600 mt-1.5 leading-relaxed">
              Reasoning models (Kimi K3, DeepSeek R1) direct with more insight but think
              slowly — the Nexus speaks ~4 times a round, so a faster model keeps the room
              lively. Deep analysis is where the slow ones earn their keep.
            </p>
          </div>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>
                Full playout length: {targetTurns} exchanges{" "}
                <span className="text-zinc-600">(lock-the-door target; 40–60 recommended)</span>
              </label>
              <input
                type="range"
                min={12}
                max={60}
                step={2}
                value={targetTurns}
                onChange={(e) => setTargetTurns(Number(e.target.value))}
                className="w-full accent-violet-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Turns per round: {turnsPerRound}</label>
                <input
                  type="range"
                  min={6}
                  max={24}
                  value={turnsPerRound}
                  onChange={(e) => setTurnsPerRound(Number(e.target.value))}
                  className="w-full accent-violet-500"
                />
              </div>
              <div>
                <label className={labelCls}>Creative heat: {temperature.toFixed(2)}</label>
                <input
                  type="range"
                  min={0.5}
                  max={1.2}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full accent-violet-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-6">
        <div className="flex-1" />
        <button onClick={onClose} className={btnGhost}>
          Cancel
        </button>
        <button
          onClick={async () => {
            setCreating(true);
            const cleanModels: Record<string, string> = {};
            for (const [k, v] of Object.entries(characterModels)) if (v) cleanModels[k] = v;
            await onCreate({
              premise: premise.trim(),
              sceneGoal: sceneGoal.trim() || null,
              setting: setting.trim() || null,
              chapterId: mode === "chapter_sim" ? chapterId || null : null,
              targetTurns,
              characterIds: castIds,
              characterModels: cleanModels,
              nexusModel,
              maxTurnsPerRound: turnsPerRound,
              temperature,
            });
          }}
          disabled={!canCreate || creating}
          className={btnPrimary}
        >
          {creating ? "Setting the stage…" : "Open the Room"}
        </button>
      </div>
    </Modal>
  );
}
