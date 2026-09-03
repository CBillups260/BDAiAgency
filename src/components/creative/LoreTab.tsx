import { useState } from "react";
import { Globe, Plus, Trash, Map } from "@geist-ui/icons";
import type {
  BookLore,
  CreativeBook,
  LoreType,
  useCreativeWriterMutations,
} from "../../hooks/useCreativeWriter";
import { inputCls, labelCls, btnPrimary, btnGhost, EmptyState, Modal } from "./shared";

const LORE_TYPES: { key: LoreType | "all"; label: string; emoji: string }[] = [
  { key: "all", label: "All", emoji: "✦" },
  { key: "location", label: "Locations", emoji: "🏔" },
  { key: "faction", label: "Factions", emoji: "⚔️" },
  { key: "item", label: "Items", emoji: "🗝" },
  { key: "rule", label: "World Rules", emoji: "📜" },
  { key: "event", label: "Events", emoji: "🔥" },
  { key: "other", label: "Other", emoji: "✦" },
];

export default function LoreTab({
  book,
  lore,
  mutations,
}: {
  book: CreativeBook;
  lore: BookLore[];
  mutations: ReturnType<typeof useCreativeWriterMutations>;
}) {
  const [filter, setFilter] = useState<LoreType | "all">("all");
  const [editing, setEditing] = useState<BookLore | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = filter === "all" ? lore : lore.filter((l) => l.type === filter);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {LORE_TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                filter === t.key
                  ? "bg-violet-500/15 text-violet-300 border-violet-500/40"
                  : "bg-[#0A0A0F] text-zinc-500 border-white/[0.08] hover:text-zinc-300"
              }`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
        <button onClick={() => setCreating(true)} className={btnPrimary}>
          <Plus size={15} /> New Entry
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Map size={24} />}
          title="No world-building entries yet"
          subtitle="Locations, factions, magic rules, key items, historical events — everything here becomes canon the Nexus enforces and the cast honors."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((l) => (
            <button
              key={l.id}
              onClick={() => setEditing(l)}
              className="text-left bg-[#0A0A0F] border border-white/[0.08] rounded-2xl p-5 hover:border-violet-500/40 transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">
                  {LORE_TYPES.find((t) => t.key === l.type)?.emoji || "✦"}
                </span>
                <p className="text-sm font-semibold text-white truncate flex-1">{l.title}</p>
                {l.source === "nexus" && (
                  <span
                    className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/25"
                    title="Auto-drafted by Story Intelligence from your chapters"
                  >
                    ✨
                  </span>
                )}
                <span className="text-[10px] uppercase tracking-wider text-zinc-600">
                  {l.type}
                </span>
              </div>
              <p className="text-xs text-zinc-400 line-clamp-3">{l.content}</p>
              {(l.tags || []).length > 0 && (
                <div className="flex gap-1.5 mt-2.5 flex-wrap">
                  {l.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] text-zinc-500 bg-[#181824] rounded-md px-1.5 py-0.5"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <LoreModal
          entry={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (data) => {
            if (editing) await mutations.updateLore(editing.id, data);
            else await mutations.addLore(book.id, data);
            setCreating(false);
            setEditing(null);
          }}
          onDelete={
            editing
              ? async () => {
                  if (confirm(`Delete "${editing.title}"?`)) {
                    await mutations.deleteLore(editing.id);
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

function LoreModal({
  entry,
  onClose,
  onSave,
  onDelete,
}: {
  entry: BookLore | null;
  onClose: () => void;
  onSave: (data: Partial<BookLore>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<BookLore>>(
    entry || { type: "location", title: "", content: "", tags: [] }
  );
  const [tagsText, setTagsText] = useState((entry?.tags || []).join(", "));

  return (
    <Modal title={entry ? `Edit ${entry.title}` : "New World Entry"} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LoreType }))}
              className={inputCls}
            >
              {LORE_TYPES.filter((t) => t.key !== "all").map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Tags (comma-separated)</label>
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              className={inputCls}
              placeholder="magic, act-2, capital"
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Title</label>
          <input
            value={form.title || ""}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Content — what is canon about this</label>
          <textarea
            value={form.content || ""}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            className={`${inputCls} min-h-[140px]`}
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
          onClick={() =>
            form.title?.trim() &&
            onSave({
              ...form,
              tags: tagsText
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          disabled={!form.title?.trim()}
          className={btnPrimary}
        >
          {entry ? "Save" : "Create"}
        </button>
      </div>
    </Modal>
  );
}
