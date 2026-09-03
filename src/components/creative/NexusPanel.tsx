import { useState } from "react";
import { Zap, Trash, AlertTriangle, Check, Circle, Cpu, X } from "@geist-ui/icons";
import {
  useNexusReports,
  useNexusProposals,
  type BookChapter,
  type BookCharacter,
  type CreativeBook,
  type NexusProposal,
  type NexusReport,
  type useCreativeWriterMutations,
} from "../../hooks/useCreativeWriter";
import { useCreativeApi } from "../../hooks/useCreativeApi";
import {
  inputCls,
  btnPrimary,
  btnGhost,
  EmptyState,
  StatusPill,
  GradeBar,
  PacingHeatmap,
  modelShortName,
} from "./shared";

export default function NexusPanel({
  book,
  chapters,
  characters,
  mutations,
}: {
  book: CreativeBook;
  chapters: BookChapter[];
  characters: BookCharacter[];
  mutations: ReturnType<typeof useCreativeWriterMutations>;
}) {
  const { reports } = useNexusReports(book.id);
  const { proposals } = useNexusProposals(book.id);
  const api = useCreativeApi();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState("");
  const [editorNote, setEditorNote] = useState("");

  const selected = reports.find((r) => r.id === selectedId) || reports[0] || null;
  const openIssues = reports.flatMap((r) =>
    (r.continuityIssues || [])
      .map((ci, i) => ({ ...ci, reportId: r.id, index: i }))
      .filter((ci) => ci.status === "open")
  );

  const openProposals = proposals.filter((p) => p.status === "proposed");
  const resolvedProposals = proposals.filter((p) => p.status !== "proposed");

  return (
    <div className="h-full overflow-y-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">Novel Nexus — Editorial Desk</h3>
          <p className="text-xs text-zinc-500 max-w-xl">
            The Nexus reads your manuscript against the story bible: grades, plot holes,
            continuity conflicts, and a pacing map. Analyze single chapters from the Chapters
            tab, or the whole book here.
          </p>
        </div>
        <button
          onClick={() => api.analyze(book.id, "book")}
          disabled={api.analyzing || chapters.every((c) => !(c.content || "").trim())}
          className={btnGhost}
        >
          <Zap size={15} className="text-amber-400" />
          {api.analyzing ? "The Nexus is reading…" : "Analyze full book"}
        </button>
      </div>

      {/* ── Nexus takes the lead ── */}
      <div className="bg-gradient-to-b from-violet-500/10 to-transparent border border-violet-500/30 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Cpu size={15} className="text-violet-400" />
          <p className="text-sm font-semibold text-white flex-1">
            Let the Nexus take the lead
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          The Nexus reads the whole story, decides the changes that matter most, and{" "}
          <span className="text-zinc-300">writes them</span> — plot-hole fixes, deeper
          moments, whole new chapters, character traits, relationships. Each lands below
          as a ready-to-apply proposal: you just approve.
        </p>
        <div className="flex gap-2">
          <input
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            className={inputCls}
            placeholder="Optional steer — e.g. 'deepen Lucien', 'fix the pacing in act one', 'more romance'"
          />
          <button
            onClick={async () => {
              const result = await api.transform(book.id, focus.trim() || undefined);
              if (result) setEditorNote(result.editorNote);
            }}
            disabled={api.transforming || chapters.every((c) => !(c.content || "").trim())}
            className={`${btnPrimary} shrink-0`}
          >
            <Cpu size={15} />
            {api.transforming ? "The Nexus is working…" : "Transform the story"}
          </button>
        </div>
        {api.transforming && (
          <p className="text-[11px] text-violet-300 animate-pulse">
            Reading every chapter, deciding the highest-impact changes, and writing them —
            this takes a few minutes. Proposals stream in below when ready.
          </p>
        )}
        {editorNote && !api.transforming && (
          <p className="text-xs text-zinc-300 italic border-l-2 border-violet-500/40 pl-3">
            Editor's note: {editorNote}
          </p>
        )}
      </div>

      {/* Proposal queue */}
      {openProposals.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-white">
            Proposed transformations ({openProposals.length})
          </p>
          {openProposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              chapters={chapters}
              characters={characters}
              mutations={mutations}
            />
          ))}
        </div>
      )}
      {resolvedProposals.length > 0 && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300">
            {resolvedProposals.length} resolved proposal{resolvedProposals.length > 1 ? "s" : ""}
          </summary>
          <div className="mt-2 space-y-1.5">
            {resolvedProposals.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <StatusPill value={p.status === "applied" ? "complete" : "abandoned"} />
                <span className="text-zinc-400">{p.title}</span>
                {p.appliedNote && <span className="text-zinc-600">— {p.appliedNote}</span>}
                <button
                  onClick={() => mutations.setProposalStatus(p.id, "proposed")}
                  className="text-zinc-600 hover:text-zinc-300 text-[10px]"
                  title="Reopen"
                >
                  reopen
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {api.error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2">
          {api.error}
        </p>
      )}

      {/* Consistency ledger (open issues across all reports) */}
      {openIssues.length > 0 && (
        <div className="bg-[#0A0A0F] border border-amber-500/25 rounded-2xl p-5">
          <p className="text-xs font-semibold text-amber-400 mb-3 flex items-center gap-2">
            <AlertTriangle size={13} /> Consistency Ledger — {openIssues.length} open
          </p>
          <div className="space-y-2">
            {openIssues.map((ci) => (
              <ContinuityRow key={`${ci.reportId}-${ci.index}`} issue={ci} reports={reports} mutations={mutations} />
            ))}
          </div>
        </div>
      )}

      {reports.length === 0 ? (
        <EmptyState
          icon={<Zap size={24} />}
          title="No Nexus reports yet"
          subtitle="Write a chapter and hit 'Analyze with Nexus', or analyze the full book above."
        />
      ) : (
        <div className="flex gap-5">
          {/* Report list */}
          <div className="w-60 shrink-0 space-y-2">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`w-full text-left px-3.5 py-3 rounded-xl border transition-all ${
                  selected?.id === r.id
                    ? "bg-violet-500/10 border-violet-500/40"
                    : "bg-[#0A0A0F] border-white/[0.08] hover:border-violet-500/25"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                    {r.scope === "book"
                      ? "Full book"
                      : chapters.find((c) => c.id === r.chapterId)?.title || "Chapter"}
                  </span>
                  <span
                    className={`text-sm font-bold ${
                      r.grades.overall >= 75
                        ? "text-emerald-400"
                        : r.grades.overall >= 50
                        ? "text-amber-400"
                        : "text-red-400"
                    }`}
                  >
                    {r.grades.overall}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-600 truncate">{modelShortName(r.model)}</p>
              </button>
            ))}
          </div>

          {/* Report detail */}
          {selected && (
            <div className="flex-1 min-w-0 space-y-5">
              <div className="bg-[#0A0A0F] border border-white/[0.08] rounded-2xl p-5">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <p className="text-sm text-zinc-300 leading-relaxed">{selected.summary}</p>
                  <button
                    onClick={() => {
                      if (confirm("Delete this report?")) mutations.deleteReport(selected.id);
                    }}
                    className="text-zinc-600 hover:text-red-400 shrink-0"
                  >
                    <Trash size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <GradeBar label="Overall" value={selected.grades.overall} />
                  <GradeBar label="Pacing" value={selected.grades.pacing} />
                  <GradeBar label="Consistency" value={selected.grades.consistency} />
                  <GradeBar label="Character voice" value={selected.grades.characterVoice} />
                  <GradeBar label="Engagement" value={selected.grades.engagement} />
                  <GradeBar label="Prose" value={selected.grades.prose} />
                </div>
              </div>

              {selected.pacingMap.length > 0 && (
                <div className="bg-[#0A0A0F] border border-white/[0.08] rounded-2xl p-5">
                  <p className="text-xs font-semibold text-white mb-3">Pacing heatmap</p>
                  <PacingHeatmap segments={selected.pacingMap} />
                  <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
                    {selected.pacingMap.map((s, i) => (
                      <p key={i} className="text-[11px] text-zinc-500">
                        <span className="text-zinc-300 font-medium">{s.segment}</span>{" "}
                        (tension {s.tension}/10) — {s.note}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {selected.plotHoles.length > 0 && (
                <div className="bg-[#0A0A0F] border border-white/[0.08] rounded-2xl p-5">
                  <p className="text-xs font-semibold text-white mb-3">
                    Plot holes ({selected.plotHoles.length})
                  </p>
                  <div className="space-y-2">
                    {selected.plotHoles.map((p, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <StatusPill value={p.severity} />
                        <p className="text-xs text-zinc-400 leading-relaxed">{p.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selected.suggestions.length > 0 && (
                <div className="bg-[#0A0A0F] border border-violet-500/20 rounded-2xl p-5">
                  <p className="text-xs font-semibold text-violet-300 mb-3">
                    Nexus recommendations
                  </p>
                  <ul className="space-y-2">
                    {selected.suggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-zinc-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Monotone chips — the emoji carries the type; color stays quiet.
const PROPOSAL_CHIP = "text-zinc-300 bg-white/[0.04] border-white/[0.1]";
const PROPOSAL_TYPE_META: Record<string, { label: string; emoji: string; color: string }> = {
  plot_fix: { label: "Plot fix", emoji: "🩹", color: PROPOSAL_CHIP },
  chapter_revision: { label: "Revision", emoji: "✂️", color: PROPOSAL_CHIP },
  chapter_addition: { label: "Deeper moment", emoji: "➕", color: PROPOSAL_CHIP },
  new_chapter: { label: "New chapter", emoji: "📖", color: PROPOSAL_CHIP },
  character_development: { label: "Character depth", emoji: "🎭", color: PROPOSAL_CHIP },
  relationship: { label: "Connection", emoji: "🔗", color: PROPOSAL_CHIP },
};

function ProposalCard({
  proposal,
  chapters,
  characters,
  mutations,
}: {
  proposal: NexusProposal;
  chapters: BookChapter[];
  characters: BookCharacter[];
  mutations: ReturnType<typeof useCreativeWriterMutations>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = PROPOSAL_TYPE_META[proposal.type] || PROPOSAL_TYPE_META.chapter_revision;
  const targetChapter = chapters.find((c) => c.id === proposal.targetChapterId);
  const p = proposal.payload || {};

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const note = await mutations.applyProposal(proposal, chapters, characters);
      await mutations.setProposalStatus(proposal.id, "applied", note);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bg-[#0A0A0F] border border-white/[0.08] rounded-2xl p-5 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${meta.color}`}>
          {meta.emoji} {meta.label}
        </span>
        <p className="text-sm font-semibold text-white flex-1 min-w-0">{proposal.title}</p>
        {targetChapter && (
          <span className="text-[10px] text-zinc-600">→ {targetChapter.title}</span>
        )}
      </div>
      <p className="text-xs text-zinc-400">{proposal.rationale}</p>
      {proposal.impact && (
        <p className="text-[11px] text-violet-300/90">Reader gains: {proposal.impact}</p>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-violet-400 hover:text-violet-300 font-medium"
      >
        {expanded ? "Hide the change" : "Review the change"}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-white/[0.08] pt-3">
          {proposal.type === "new_chapter" && (
            <div>
              <p className="text-[11px] text-zinc-500 mb-1">
                New chapter: <span className="text-white">"{p.chapterTitle}"</span>
                {p.afterChapterId
                  ? ` — after "${chapters.find((c) => c.id === p.afterChapterId)?.title || "?"}"`
                  : " — at the end"}
              </p>
              <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-serif leading-relaxed max-h-72 overflow-y-auto bg-[#12121A] rounded-xl p-4">
                {p.content}
              </pre>
            </div>
          )}
          {proposal.type === "chapter_addition" && (
            <div>
              {p.anchor && (
                <p className="text-[11px] text-zinc-500 mb-1.5">
                  Inserted after: <span className="text-zinc-300 italic">"{p.anchor}"</span>
                </p>
              )}
              <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-serif leading-relaxed max-h-64 overflow-y-auto bg-[#12121A] rounded-xl p-4">
                {p.text}
              </pre>
            </div>
          )}
          {(proposal.type === "plot_fix" || proposal.type === "chapter_revision") &&
            (p.edits || []).map((e, i) => (
              <div key={i} className="rounded-xl overflow-hidden border border-white/[0.08]">
                <div className="bg-red-500/5 border-b border-white/[0.08] p-3">
                  <p className="text-[10px] text-red-400/80 uppercase tracking-wider mb-1">Current</p>
                  <p className="text-xs text-zinc-400 whitespace-pre-wrap line-through decoration-red-500/40">
                    {e.find}
                  </p>
                </div>
                <div className="bg-emerald-500/5 p-3">
                  <p className="text-[10px] text-emerald-400/80 uppercase tracking-wider mb-1">Nexus rewrite</p>
                  <p className="text-xs text-zinc-200 whitespace-pre-wrap">{e.replace}</p>
                </div>
              </div>
            ))}
          {proposal.type === "character_development" && (
            <div className="space-y-1.5 text-xs">
              <p className="text-zinc-300 font-medium">{p.characterName}</p>
              {p.traitAdditions && <p className="text-zinc-400"><span className="text-zinc-500">Traits:</span> {p.traitAdditions}</p>}
              {p.voiceAdditions && <p className="text-zinc-400"><span className="text-zinc-500">Voice:</span> {p.voiceAdditions}</p>}
              {p.secretAdditions && <p className="text-zinc-400"><span className="text-zinc-500">Secret:</span> {p.secretAdditions}</p>}
              {p.goalAdditions && <p className="text-zinc-400"><span className="text-zinc-500">Goals:</span> {p.goalAdditions}</p>}
              {p.arcDirection && <p className="text-zinc-400"><span className="text-zinc-500">Arc:</span> {p.arcDirection}</p>}
            </div>
          )}
          {proposal.type === "relationship" && (
            <div className="space-y-1.5 text-xs">
              <p className="text-zinc-200 font-medium">
                {p.aName} ↔ {p.bName}: <span className="text-pink-300">{p.relType}</span>
              </p>
              <p className="text-zinc-400"><span className="text-zinc-500">{p.aName}'s side:</span> {p.aToB}</p>
              <p className="text-zinc-400"><span className="text-zinc-500">{p.bName}'s side:</span> {p.bToA}</p>
              {p.surfaceIn && <p className="text-zinc-400"><span className="text-zinc-500">Surfaces:</span> {p.surfaceIn}</p>}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button onClick={apply} disabled={applying} className={`${btnPrimary} py-2 text-xs`}>
          <Check size={13} /> {applying ? "Applying…" : "Apply to the book"}
        </button>
        <button
          onClick={() => mutations.setProposalStatus(proposal.id, "dismissed")}
          disabled={applying}
          className={`${btnGhost} py-2 text-xs`}
        >
          <X size={13} /> Dismiss
        </button>
      </div>
    </div>
  );
}

function ContinuityRow({
  issue,
  reports,
  mutations,
}: {
  issue: { claim: string; conflictsWith: string; status: string; reportId: string; index: number };
  reports: NexusReport[];
  mutations: ReturnType<typeof useCreativeWriterMutations>;
}) {
  const resolve = async () => {
    const report = reports.find((r) => r.id === issue.reportId);
    if (!report) return;
    const continuityIssues = report.continuityIssues.map((ci, i) =>
      i === issue.index ? { ...ci, status: "resolved" as const } : ci
    );
    await mutations.updateReport(report.id, { continuityIssues });
  };

  return (
    <div className="flex items-start gap-2.5 group">
      <button
        onClick={resolve}
        className="text-zinc-600 hover:text-emerald-400 mt-0.5 shrink-0"
        title="Mark resolved"
      >
        <Circle size={13} className="group-hover:hidden" />
        <Check size={13} className="hidden group-hover:block" />
      </button>
      <p className="text-xs text-zinc-400 leading-relaxed">
        <span className="text-zinc-200">{issue.claim}</span>{" "}
        <span className="text-zinc-600">conflicts with</span>{" "}
        <span className="text-amber-300/90">{issue.conflictsWith}</span>
      </p>
    </div>
  );
}
