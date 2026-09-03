import { useState } from "react";
import { Target, Plus, Trash, Check, Circle } from "@geist-ui/icons";
import type {
  BookPlotThread,
  CreativeBook,
  PlotStatus,
  useCreativeWriterMutations,
} from "../../hooks/useCreativeWriter";
import {
  inputCls,
  labelCls,
  btnPrimary,
  btnGhost,
  EmptyState,
  Modal,
  StatusPill,
} from "./shared";

const PLOT_STATUSES: PlotStatus[] = ["setup", "developing", "payoff", "resolved", "abandoned"];

export default function PlotThreadsTab({
  book,
  threads,
  mutations,
}: {
  book: CreativeBook;
  threads: BookPlotThread[];
  mutations: ReturnType<typeof useCreativeWriterMutations>;
}) {
  const [editing, setEditing] = useState<BookPlotThread | null>(null);
  const [creating, setCreating] = useState(false);
  const [newBeat, setNewBeat] = useState<Record<string, string>>({});

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500 max-w-lg">
          Every promise you make to the reader. The Nexus checks these threads for setups
          without payoffs — and payoffs without setups.
        </p>
        <button onClick={() => setCreating(true)} className={btnPrimary}>
          <Plus size={15} /> New Thread
        </button>
      </div>

      {threads.length === 0 ? (
        <EmptyState
          icon={<Target size={24} />}
          title="No plot threads yet"
          subtitle="Track each storyline as beats: setup → developing → payoff → resolved."
        />
      ) : (
        <div className="space-y-3">
          {threads.map((t) => (
            <div
              key={t.id}
              className="bg-[#0A0A0F] border border-white/[0.08] rounded-2xl p-5 hover:border-violet-500/25 transition-all"
            >
              <div className="flex items-center gap-3 mb-2">
                <button
                  onClick={() => setEditing(t)}
                  className="text-sm font-semibold text-white hover:text-violet-300 text-left"
                >
                  {t.title}
                </button>
                {t.source === "nexus" && (
                  <span
                    className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/25"
                    title="Auto-drafted by Story Intelligence from your chapters"
                  >
                    ✨ Nexus draft
                  </span>
                )}
                <select
                  value={t.status}
                  onChange={(e) =>
                    mutations.updatePlotThread(t.id, { status: e.target.value as PlotStatus })
                  }
                  className="bg-transparent text-xs text-zinc-400 border border-white/[0.08] rounded-lg px-2 py-1 focus:outline-none"
                >
                  {PLOT_STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-[#12121A]">
                      {s}
                    </option>
                  ))}
                </select>
                <StatusPill value={t.status} />
                <div className="flex-1" />
                <span className="text-[11px] text-zinc-600">
                  {t.beats.filter((b) => b.done).length}/{t.beats.length} beats
                </span>
              </div>
              {t.description && (
                <p className="text-xs text-zinc-400 mb-3">{t.description}</p>
              )}

              <div className="space-y-1.5">
                {t.beats.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 group">
                    <button
                      onClick={() => {
                        const beats = [...t.beats];
                        beats[i] = { ...b, done: !b.done };
                        mutations.updatePlotThread(t.id, { beats });
                      }}
                      className={b.done ? "text-emerald-400" : "text-zinc-600 hover:text-zinc-400"}
                    >
                      {b.done ? <Check size={14} /> : <Circle size={14} />}
                    </button>
                    <span
                      className={`text-xs flex-1 ${
                        b.done ? "text-zinc-600 line-through" : "text-zinc-300"
                      }`}
                    >
                      {b.beat}
                    </span>
                    <button
                      onClick={() => {
                        const beats = t.beats.filter((_, j) => j !== i);
                        mutations.updatePlotThread(t.id, { beats });
                      }}
                      className="text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash size={12} />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <input
                    value={newBeat[t.id] || ""}
                    onChange={(e) => setNewBeat((n) => ({ ...n, [t.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (newBeat[t.id] || "").trim()) {
                        mutations.updatePlotThread(t.id, {
                          beats: [...t.beats, { beat: newBeat[t.id].trim(), done: false }],
                        });
                        setNewBeat((n) => ({ ...n, [t.id]: "" }));
                      }
                    }}
                    className={`${inputCls} py-1.5 text-xs`}
                    placeholder="Add a beat and press Enter…"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ThreadModal
          thread={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (data) => {
            if (editing) await mutations.updatePlotThread(editing.id, data);
            else await mutations.addPlotThread(book.id, data);
            setCreating(false);
            setEditing(null);
          }}
          onDelete={
            editing
              ? async () => {
                  if (confirm(`Delete thread "${editing.title}"?`)) {
                    await mutations.deletePlotThread(editing.id);
                    setEditing(null);
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function ThreadModal({
  thread,
  onClose,
  onSave,
  onDelete,
}: {
  thread: BookPlotThread | null;
  onClose: () => void;
  onSave: (data: Partial<BookPlotThread>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<BookPlotThread>>(
    thread || { title: "", description: "", status: "setup" }
  );

  return (
    <Modal title={thread ? `Edit ${thread.title}` : "New Plot Thread"} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Title</label>
          <input
            value={form.title || ""}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className={inputCls}
            placeholder="e.g. The stolen crown, Mara's revenge"
          />
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <textarea
            value={form.description || ""}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className={`${inputCls} min-h-[100px]`}
            placeholder="What this thread promises the reader and how it should land"
          />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-6">
        {onDelete && (
          <button onClick={onDelete} className="text-red-400 hover:text-red-300 text-sm">
            <Trash size={15} className="inline mr-1" /> Delete
          </button>
        )}
        <div className="flex-1" />
        <button onClick={onClose} className={btnGhost}>
          Cancel
        </button>
        <button
          onClick={() => form.title?.trim() && onSave(form)}
          disabled={!form.title?.trim()}
          className={btnPrimary}
        >
          {thread ? "Save" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
