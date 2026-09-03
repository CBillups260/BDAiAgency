import { useState } from "react";
import { Users, Plus, Trash, Cpu } from "@geist-ui/icons";
import {
  CHARACTER_COLORS,
  type BookCharacter,
  type CreativeBook,
  type useCreativeWriterMutations,
} from "../../hooks/useCreativeWriter";
import {
  inputCls,
  labelCls,
  btnPrimary,
  btnGhost,
  EmptyState,
  Modal,
  WriterModelSelect,
  modelShortName,
} from "./shared";

const ROLES = ["protagonist", "antagonist", "supporting"] as const;

export default function CharactersTab({
  book,
  characters,
  mutations,
}: {
  book: CreativeBook;
  characters: BookCharacter[];
  mutations: ReturnType<typeof useCreativeWriterMutations>;
}) {
  const [editing, setEditing] = useState<BookCharacter | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500 max-w-lg">
          Your cast. Voice cards power the Writers' Room — the richer the voice, goals, and
          secrets, the better each AI actor performs.
        </p>
        <button onClick={() => setCreating(true)} className={btnPrimary}>
          <Plus size={15} /> New Character
        </button>
      </div>

      {characters.length === 0 ? (
        <EmptyState
          icon={<Users size={24} />}
          title="No characters yet"
          subtitle="Create your cast, or paste a manuscript in the Import Bible tool to extract them automatically."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {characters.map((c) => (
            <button
              key={c.id}
              onClick={() => setEditing(c)}
              className="text-left bg-[#0A0A0F] border border-white/[0.08] rounded-2xl p-5 hover:border-violet-500/40 transition-all"
              style={{ borderTopColor: c.color, borderTopWidth: 3 }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-black/80"
                  style={{ backgroundColor: c.color }}
                >
                  {(c.name || "?").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                  <p className="text-[11px] text-zinc-500 capitalize">
                    {c.role}
                    {c.archetype ? ` · ${c.archetype}` : ""}
                  </p>
                </div>
                {c.source === "nexus" && (
                  <span
                    className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/25"
                    title="Auto-drafted by Story Intelligence from your chapters — click to review and edit"
                  >
                    ✨ Nexus draft
                  </span>
                )}
              </div>
              {c.bio && <p className="text-xs text-zinc-400 line-clamp-2 mb-2">{c.bio}</p>}
              {c.voice && (
                <p className="text-[11px] text-zinc-500 italic line-clamp-2 mb-2">
                  “{c.voice}”
                </p>
              )}
              <div className="flex items-center gap-2 mt-auto">
                <span className="inline-flex items-center gap-1 text-[10px] text-violet-400 bg-violet-500/10 border border-violet-500/25 rounded-md px-1.5 py-0.5">
                  <Cpu size={10} />
                  {modelShortName(
                    c.modelOverride || book.defaultCharacterModel || "nousresearch/hermes-3-llama-3.1-70b"
                  )}
                </span>
                {(c.relationships || []).length > 0 && (
                  <span className="text-[10px] text-zinc-600">
                    {c.relationships.length} relationship{c.relationships.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <CharacterModal
          character={editing}
          characters={characters}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (data) => {
            if (editing) await mutations.updateCharacter(editing.id, data);
            else
              await mutations.addCharacter(book.id, {
                ...data,
                color: CHARACTER_COLORS[characters.length % CHARACTER_COLORS.length],
              });
            setCreating(false);
            setEditing(null);
          }}
          onDelete={
            editing
              ? async () => {
                  if (confirm(`Delete ${editing.name}?`)) {
                    await mutations.deleteCharacter(editing.id);
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

function CharacterModal({
  character,
  characters,
  onClose,
  onSave,
  onDelete,
}: {
  character: BookCharacter | null;
  characters: BookCharacter[];
  onClose: () => void;
  onSave: (data: Partial<BookCharacter>) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<BookCharacter>>(
    character || { name: "", role: "supporting" }
  );
  const set = (k: keyof BookCharacter, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal title={character ? `Edit ${character.name}` : "New Character"} onClose={onClose} wide>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Name</label>
          <input
            value={form.name || ""}
            onChange={(e) => set("name", e.target.value)}
            className={inputCls}
            placeholder="Character name"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Role</label>
            <select
              value={form.role || "supporting"}
              onChange={(e) => set("role", e.target.value)}
              className={inputCls}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Accent color</label>
            <div className="flex gap-1.5 pt-1.5 flex-wrap">
              {CHARACTER_COLORS.map((col) => (
                <button
                  key={col}
                  onClick={() => set("color", col)}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${
                    form.color === col ? "border-white scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: col }}
                />
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className={labelCls}>Archetype</label>
          <input
            value={form.archetype || ""}
            onChange={(e) => set("archetype", e.target.value)}
            className={inputCls}
            placeholder="e.g. reluctant mentor, trickster, femme fatale"
          />
        </div>
        <div>
          <label className={labelCls}>AI actor model (override)</label>
          <WriterModelSelect
            tier="character"
            value={form.modelOverride || ""}
            onChange={(v) => set("modelOverride", v || null)}
            allowDefault
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Bio</label>
          <textarea
            value={form.bio || ""}
            onChange={(e) => set("bio", e.target.value)}
            className={`${inputCls} min-h-[70px]`}
            placeholder="Who they are, their history, what shaped them…"
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>
            Voice — speech patterns + 1-2 sample lines (the actor imitates this)
          </label>
          <textarea
            value={form.voice || ""}
            onChange={(e) => set("voice", e.target.value)}
            className={`${inputCls} min-h-[70px]`}
            placeholder={`e.g. Clipped sentences, dry wit, never swears. "You call that a plan? I've seen better strategy in a bar fight."`}
          />
        </div>
        <div>
          <label className={labelCls}>Goals — what they want</label>
          <textarea
            value={form.goals || ""}
            onChange={(e) => set("goals", e.target.value)}
            className={`${inputCls} min-h-[60px]`}
          />
        </div>
        <div>
          <label className={labelCls}>Secrets — what they hide (leaks into subtext)</label>
          <textarea
            value={form.secrets || ""}
            onChange={(e) => set("secrets", e.target.value)}
            className={`${inputCls} min-h-[60px]`}
          />
        </div>
        <div>
          <label className={labelCls}>Appearance</label>
          <textarea
            value={form.appearance || ""}
            onChange={(e) => set("appearance", e.target.value)}
            className={`${inputCls} min-h-[50px]`}
          />
        </div>
        <div>
          <label className={labelCls}>Arc notes</label>
          <textarea
            value={form.arcNotes || ""}
            onChange={(e) => set("arcNotes", e.target.value)}
            className={`${inputCls} min-h-[50px]`}
            placeholder="Where this character is headed across the book"
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Relationships</label>
          <RelationshipEditor
            value={form.relationships || []}
            others={characters.filter((c) => c.id !== character?.id)}
            onChange={(rels) => set("relationships", rels)}
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
          onClick={() => form.name?.trim() && onSave(form)}
          disabled={!form.name?.trim()}
          className={btnPrimary}
        >
          {character ? "Save" : "Create"}
        </button>
      </div>
    </Modal>
  );
}

function RelationshipEditor({
  value,
  others,
  onChange,
}: {
  value: { characterId: string; name?: string; type: string; note?: string }[];
  others: BookCharacter[];
  onChange: (rels: { characterId: string; name?: string; type: string; note?: string }[]) => void;
}) {
  return (
    <div className="space-y-2">
      {value.map((rel, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select
            value={rel.characterId}
            onChange={(e) => {
              const other = others.find((o) => o.id === e.target.value);
              const next = [...value];
              next[i] = { ...rel, characterId: e.target.value, name: other?.name };
              onChange(next);
            }}
            className={`${inputCls} w-40`}
          >
            <option value="">Pick…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <input
            value={rel.type}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...rel, type: e.target.value };
              onChange(next);
            }}
            className={`${inputCls} w-32`}
            placeholder="rival, sister…"
          />
          <input
            value={rel.note || ""}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...rel, note: e.target.value };
              onChange(next);
            }}
            className={`${inputCls} flex-1`}
            placeholder="note"
          />
          <button
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="text-zinc-500 hover:text-red-400 shrink-0"
          >
            <Trash size={14} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...value, { characterId: "", type: "" }])}
        className="text-xs text-violet-400 hover:text-violet-300"
      >
        + Add relationship
      </button>
    </div>
  );
}
