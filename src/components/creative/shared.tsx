import React from "react";
import { X } from "@geist-ui/icons";
import {
  WRITER_MODELS,
  writerModelsByTier,
  type WriterModelTier,
} from "../../lib/writerModels";

/** Shared input styling for the Creative Writer surfaces. */
// Monotone system: near-black surfaces, hairline borders, zinc text — with ONE
// accent, the violet→sky gradient, reserved for primary actions and live state.
export const hairline = "border border-white/[0.08]";
export const inputCls =
  "w-full bg-[#0A0A0F] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-400/40 transition-colors";
export const labelCls = "block text-xs font-medium text-zinc-400 mb-1.5";
export const btnPrimary =
  "inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-600 to-sky-500 text-white hover:from-violet-500 hover:to-sky-400 transition-all shadow-[0_0_18px_rgba(139,92,246,0.18)] disabled:opacity-50 disabled:cursor-not-allowed";
export const btnGhost =
  "inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.03] text-zinc-300 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed";

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 bg-[#0A0A0F] border border-white/[0.08] rounded-2xl flex items-center justify-center mb-4 text-zinc-600">
        {icon}
      </div>
      <p className="text-zinc-400 text-sm mb-1">{title}</p>
      {subtitle && <p className="text-zinc-600 text-xs max-w-sm">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Monotone pills: neutral zinc for most states, the accent gradient tint for
// live/finished states, red reserved for genuine problems only.
const PILL_NEUTRAL = "bg-white/[0.04] text-zinc-400 border-white/[0.08]";
const PILL_ACCENT = "bg-violet-500/10 text-violet-300 border-violet-400/25";
const PILL_DANGER = "bg-red-500/10 text-red-400 border-red-500/20";
const PILL_COLORS: Record<string, string> = {
  // accent: live or landed states
  running: PILL_ACCENT,
  complete: PILL_ACCENT,
  final: PILL_ACCENT,
  crafted: PILL_ACCENT,
  accepted: PILL_ACCENT,
  resolved: PILL_ACCENT,
  payoff: PILL_ACCENT,
  // danger: real problems only
  error: PILL_DANGER,
  critical: PILL_DANGER,
  // everything else is quiet
  outline: PILL_NEUTRAL,
};

export function StatusPill({ value }: { value: string }) {
  const cls = PILL_COLORS[value] || PILL_NEUTRAL;
  return (
    <span
      className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${cls}`}
    >
      {value}
    </span>
  );
}

export function CostDots({ cost }: { cost: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`Relative cost ${cost}/4`}>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i <= cost ? "bg-violet-400" : "bg-white/[0.08]"}`}
        />
      ))}
    </span>
  );
}

/** Grouped model dropdown over the OpenRouter writer-model catalog. */
export function WriterModelSelect({
  tier,
  value,
  onChange,
  allowDefault,
  defaultLabel = "Book default",
}: {
  tier: WriterModelTier;
  value: string;
  onChange: (id: string) => void;
  allowDefault?: boolean;
  defaultLabel?: string;
}) {
  const models = writerModelsByTier(tier);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {allowDefault && <option value="">{defaultLabel}</option>}
      {models.map((m) => (
        <option key={`${m.tier}-${m.id}`} value={m.id}>
          {m.name} — {m.provider} ({"$".repeat(m.cost)})
        </option>
      ))}
    </select>
  );
}

export function modelShortName(id: string): string {
  return WRITER_MODELS.find((m) => m.id === id)?.name ?? id.split("/").pop() ?? id;
}

export function GradeBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-400">{label}</span>
        <span className="text-xs font-semibold text-white">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-sky-400"
          style={{ width: `${value}%`, opacity: 0.45 + (value / 100) * 0.55 }}
        />
      </div>
    </div>
  );
}

/** Tension strip: one cell per pacing segment, colored by tension 0-10. */
export function PacingHeatmap({
  segments,
}: {
  segments: { segment: string; tension: number; note: string }[];
}) {
  if (!segments.length) return null;
  return (
    <div>
      <div className="flex gap-1 h-8 rounded-lg overflow-hidden">
        {segments.map((s, i) => (
          <div
            key={i}
            className="flex-1 relative group cursor-default rounded-sm bg-gradient-to-t from-violet-500 to-sky-400"
            style={{ opacity: 0.12 + (Math.min(10, Math.max(0, s.tension)) / 10) * 0.88 }}
            title={`${s.segment} — tension ${s.tension}/10\n${s.note}`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-zinc-600">opening</span>
        <span className="text-[10px] text-zinc-600">
          tension map (hover segments)
        </span>
        <span className="text-[10px] text-zinc-600">end</span>
      </div>
    </div>
  );
}

/** Normalize scene breaks ("* * *", "***", "———") to markdown hr for styling. */
export function normalizeBreaks(text: string): string {
  return text.replace(/^[ \t]*(\* *\* *\*+|[-—ـ_]{3,})[ \t]*$/gm, "---");
}

/** Book-typography markdown components for chapter prose. */
export function proseComponents(withDropCap: boolean) {
  return {
    p: ({ children }: any) => (
      <p
        className={`font-serif text-[16px] leading-[1.9] text-zinc-200 mb-5 ${
          withDropCap
            ? "[&:first-of-type]:first-letter:text-4xl [&:first-of-type]:first-letter:font-semibold [&:first-of-type]:first-letter:text-violet-300 [&:first-of-type]:first-letter:mr-1 [&:first-of-type]:first-letter:float-left [&:first-of-type]:first-letter:leading-[0.85]"
            : ""
        }`}
      >
        {children}
      </p>
    ),
    em: ({ children }: any) => <em className="text-zinc-300 italic">{children}</em>,
    strong: ({ children }: any) => <strong className="text-white font-semibold">{children}</strong>,
    hr: () => (
      <div className="flex items-center justify-center gap-3 my-9 text-violet-400/60 select-none">
        <span className="text-xs tracking-[0.5em]">✦ ✦ ✦</span>
      </div>
    ),
    h1: ({ children }: any) => <h3 className="font-serif text-xl text-white mt-8 mb-4">{children}</h3>,
    h2: ({ children }: any) => <h3 className="font-serif text-lg text-white mt-8 mb-4">{children}</h3>,
    h3: ({ children }: any) => <h4 className="font-serif text-base text-white mt-6 mb-3">{children}</h4>,
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-2 border-violet-500/40 pl-4 italic text-zinc-400 my-5">
        {children}
      </blockquote>
    ),
  };
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative bg-[#12121A] border border-white/[0.08] rounded-2xl w-full ${
          wide ? "max-w-3xl" : "max-w-lg"
        } max-h-[85dvh] flex flex-col shadow-2xl`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08]">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
