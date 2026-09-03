import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Cpu, Trash, X } from "@geist-ui/icons";
import type { CraftPlan, useCreativeWriterMutations } from "../../hooks/useCreativeWriter";
import { btnPrimary, btnGhost, normalizeBreaks, proseComponents } from "./shared";

/**
 * CraftSession — inline, in-document. The chapter renders as ONE continuous
 * manuscript page; each moment the Nexus pinned is highlighted in place with
 * its diagnosis and three crafted alternatives tucked directly beneath it.
 * Choosing an option splices the text right there — the page updates around
 * you, like working with an editor in the margins rather than in another room.
 */

interface Anchor {
  momentIdx: number;
  pos: number;
  len: number;
  /** What the highlight anchors to: the excerpt, or (if applied) the chosen text. */
  needle: string;
}

export default function CraftSession({
  plan,
  title,
  content,
  mutations,
  onApplyText,
  onClose,
}: {
  plan: CraftPlan;
  title: string;
  content: string;
  mutations: ReturnType<typeof useCreativeWriterMutations>;
  onApplyText: (excerpt: string, replacement: string) => boolean;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  // Anchor every moment to its position in the CURRENT text. Applied moments
  // anchor to their chosen replacement so the resolved chip stays in place.
  const anchors = useMemo<Anchor[]>(() => {
    const found: Anchor[] = [];
    for (let i = 0; i < plan.moments.length; i++) {
      const m = plan.moments[i];
      const needle =
        m.status === "applied" ? m.options[m.chosen ?? 0]?.text || m.excerpt : m.excerpt;
      const pos = content.indexOf(needle);
      if (pos >= 0) found.push({ momentIdx: i, pos, len: needle.length, needle });
    }
    return found.sort((a, b) => a.pos - b.pos);
  }, [plan.moments, content]);

  const resolved = plan.moments.filter((m) => m.status !== "open").length;
  const orphaned = plan.moments.length - anchors.length;

  // Split the chapter into interleaved parts: prose, then a moment block, …
  const parts = useMemo(() => {
    const out: { kind: "prose" | "moment"; text: string; anchor?: Anchor }[] = [];
    let cursor = 0;
    for (const a of anchors) {
      if (a.pos < cursor) continue; // overlapping anchors: keep the first
      if (a.pos > cursor) out.push({ kind: "prose", text: content.slice(cursor, a.pos) });
      out.push({ kind: "moment", text: a.needle, anchor: a });
      cursor = a.pos + a.len;
    }
    if (cursor < content.length) out.push({ kind: "prose", text: content.slice(cursor) });
    return out;
  }, [anchors, content]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#0A0A0F] border border-white/[0.08] rounded-2xl">
      {/* Session bar — sticky so the controls travel with you */}
      <div className="sticky top-0 z-10 bg-[#0A0A0F]/95 backdrop-blur-sm border-b border-white/[0.08] px-6 py-3 flex items-center gap-3">
        <Cpu size={14} className="text-violet-400 shrink-0" />
        <p className="text-xs font-semibold text-white">Craft Session</p>
        <div className="flex-1 flex gap-1">
          {plan.moments.map((m, i) => (
            <span
              key={i}
              className={`h-1 flex-1 max-w-10 rounded-full ${
                m.status === "applied"
                  ? "bg-gradient-to-r from-violet-500 to-sky-400"
                  : m.status === "skipped"
                  ? "bg-white/[0.14]"
                  : "bg-white/[0.06]"
              }`}
              title={`Moment ${i + 1}: ${m.status}`}
            />
          ))}
        </div>
        <span className="text-[10px] text-zinc-600 shrink-0">
          {resolved}/{plan.moments.length} resolved
        </span>
        <button
          onClick={() => {
            if (confirm("Discard this craft session? (Applied changes stay in the chapter.)")) {
              mutations.deleteCraftPlan(plan.id);
              onClose();
            }
          }}
          className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 transition-colors shrink-0"
          title="Discard session"
        >
          <Trash size={13} />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-white transition-colors shrink-0"
          title="Close the session (resume any time)"
        >
          <X size={14} />
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-8 py-10">
        {/* The master crafter's read — collapsible, out of the way */}
        <details className="mb-8 group" open={resolved === 0}>
          <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200 list-none flex items-center gap-2">
            <span className="text-violet-400">◈</span>
            <span className="font-medium">The crafter's read of this chapter</span>
            <span className="text-zinc-600 group-open:hidden">— expand</span>
          </summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-zinc-300 leading-relaxed">{plan.verdict}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {(
                [
                  ["Role in the story", plan.chapterRole],
                  ["Conflict", plan.conflict],
                  ["Resolution", plan.resolution],
                ] as const
              ).map(([label, text]) => (
                <div key={label} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</p>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </details>

        <h2 className="text-2xl font-serif font-semibold text-white text-center mb-10 tracking-wide">
          {title}
        </h2>

        {orphaned > 0 && (
          <p className="text-[11px] text-zinc-500 mb-6 text-center">
            {orphaned} moment{orphaned > 1 ? "s" : ""} no longer match the text (it changed
            since the session was crafted) and {orphaned > 1 ? "are" : "is"} hidden.
          </p>
        )}

        {/* The chapter, whole — with the crafter working in the margins */}
        {parts.map((part, i) =>
          part.kind === "prose" ? (
            <ReactMarkdown key={i} components={proseComponents(i === 0)}>
              {normalizeBreaks(part.text)}
            </ReactMarkdown>
          ) : (
            <MomentBlock
              key={i}
              plan={plan}
              momentIdx={part.anchor!.momentIdx}
              text={part.text}
              mutations={mutations}
              onApplyText={onApplyText}
              error={error}
              setError={setError}
            />
          )
        )}
      </div>
    </div>
  );
}

function MomentBlock({
  plan,
  momentIdx,
  text,
  mutations,
  onApplyText,
  error,
  setError,
}: {
  plan: CraftPlan;
  momentIdx: number;
  text: string;
  mutations: ReturnType<typeof useCreativeWriterMutations>;
  onApplyText: (excerpt: string, replacement: string) => boolean;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const moment = plan.moments[momentIdx];
  const [optionIdx, setOptionIdx] = useState(0);
  const [open, setOpen] = useState(moment.status === "open");

  const useOption = async () => {
    const ok = onApplyText(moment.excerpt, moment.options[optionIdx].text);
    if (!ok) {
      setError("This passage no longer matches the text — it changed since the session was crafted.");
      return;
    }
    setError(null);
    await mutations.updateCraftMoment(plan, momentIdx, { status: "applied", chosen: optionIdx });
  };

  const isOpen = moment.status === "open";

  return (
    <div className="my-2">
      {/* The passage itself, highlighted in place — still part of the page */}
      <div
        className={`-mx-4 px-4 py-1 rounded-xl border transition-all ${
          isOpen
            ? "bg-violet-500/[0.06] border-white/[0.1]"
            : "bg-transparent border-transparent"
        }`}
      >
        <ReactMarkdown components={proseComponents(false)}>
          {normalizeBreaks(text)}
        </ReactMarkdown>
      </div>

      {/* The crafter's note, tucked directly beneath the passage */}
      {isOpen ? (
        <div className="mb-6 -mt-1 border-l-2 border-violet-400/40 pl-4 ml-1 space-y-3">
          <p className="text-xs text-zinc-400 leading-relaxed pt-2">
            <span className="text-violet-400 mr-1.5">◈</span>
            <span className="text-zinc-200">{moment.issue}</span> {moment.why}{" "}
            <span className="text-violet-300">{moment.approach}</span>
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {moment.options.map((o, i) => (
              <button
                key={i}
                onClick={() => setOptionIdx(i)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                  i === optionIdx
                    ? "bg-white/[0.06] border-white/[0.16] text-white"
                    : "border-white/[0.08] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-xl p-4 max-h-64 overflow-y-auto">
            <p className="text-[15px] text-zinc-100 font-serif whitespace-pre-wrap leading-relaxed">
              {moment.options[optionIdx]?.text}
            </p>
          </div>
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button onClick={useOption} className={`${btnPrimary} py-2 text-xs`}>
              <Check size={13} /> Use "{moment.options[optionIdx]?.label}"
            </button>
            <button
              onClick={() => mutations.updateCraftMoment(plan, momentIdx, { status: "skipped" })}
              className={`${btnGhost} py-2 text-xs`}
            >
              Keep as written
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-4 -mt-1 pl-5 ml-1">
          <button
            onClick={() => setOpen(!open)}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
            title={
              moment.status === "applied"
                ? "This passage was crafted — click to revisit"
                : "Kept as written — click to revisit"
            }
          >
            {moment.status === "applied"
              ? `✓ crafted — "${moment.options[moment.chosen ?? 0]?.label}"`
              : "· kept as written"}
            {open ? " (hide)" : ""}
          </button>
          {open && moment.status !== "open" && (
            <button
              onClick={() =>
                mutations.updateCraftMoment(plan, momentIdx, { status: "open", chosen: undefined as any })
              }
              className="ml-2 text-[10px] text-violet-400 hover:text-violet-300"
            >
              reopen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
