/**
 * Settings → Client Portals. Create the passcode-gated links clients open on
 * their phones (/p/<slug>) and pick which Accounts (brands) each one shows.
 */
import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Plus, RefreshCw, Trash2, Edit3, Smartphone, CheckCircle, Eye, EyeOff } from "@geist-ui/icons";
import { authedFetch } from "../lib/api";
import { useFirestoreAccounts } from "../hooks/useFirestore";
import { getGhlLocationId, getGhlPrivateIntegrationToken } from "../lib/utils";

interface PortalRow {
  slug: string;
  name: string;
  accountIds: string[];
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  brands?: { id: string; name: string; connected: boolean; hasToken: boolean }[];
}

interface EditRow {
  id: string;
  brandName?: string;
  postId?: string;
  scheduleDate?: string | null;
  before?: string;
  after?: string;
  editedAt: string | null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function portalUrl(slug: string): string {
  return `${window.location.origin}/p/${slug}`;
}

export default function ClientPortalsAdmin() {
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();
  const [portals, setPortals] = useState<PortalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [showPasscode, setShowPasscode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editsFor, setEditsFor] = useState<string | null>(null);
  const [edits, setEdits] = useState<EditRow[]>([]);
  const [editsLoading, setEditsLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authedFetch("/api/portal/admin");
      if (!(res.headers.get("content-type") || "").includes("application/json")) {
        throw new Error("The portal API isn't deployed on this backend yet — run `npm run deploy:functions` and refresh.");
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setPortals(data.portals || []);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load portals.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!slugTouched && !editingSlug) setSlug(slugify(name));
  }, [name, slugTouched, editingSlug]);

  const sortedAccounts = useMemo(
    () =>
      [...accounts]
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        .filter((a) => !filter.trim() || (a.name || "").toLowerCase().includes(filter.toLowerCase()) || (a.company || "").toLowerCase().includes(filter.toLowerCase())),
    [accounts, filter]
  );

  const resetForm = () => {
    setEditingSlug(null);
    setName("");
    setSlug("");
    setSlugTouched(false);
    setPasscode("");
    setSelected(new Set());
    setSaveError(null);
  };

  const startEdit = (p: PortalRow) => {
    setEditingSlug(p.slug);
    setName(p.name);
    setSlug(p.slug);
    setSlugTouched(true);
    setPasscode("");
    setSelected(new Set(p.accountIds));
    setSaveError(null);
    window.scrollTo({ top: document.getElementById("client-portals")?.offsetTop ?? 0, behavior: "smooth" });
  };

  const save = async () => {
    setSaveError(null);
    if (!name.trim()) return setSaveError("Give the portal a name (e.g. SRG).");
    if (!editingSlug && passcode.trim().length < 4) return setSaveError("Set a passcode of at least 4 characters.");
    if (selected.size === 0) return setSaveError("Pick at least one brand.");
    setSaving(true);
    try {
      const res = await authedFetch("/api/portal/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim() || undefined,
          passcode: passcode.trim() || undefined,
          accountIds: Array.from(selected),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      resetForm();
      await load();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: PortalRow) => {
    if (!window.confirm(`Delete the "${p.name}" portal? The link will stop working for the client.`)) return;
    const res = await authedFetch(`/api/portal/admin/${encodeURIComponent(p.slug)}`, { method: "DELETE" });
    if (res.ok) await load();
  };

  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(portalUrl(s));
      setCopied(s);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      window.prompt("Copy this link", portalUrl(s));
    }
  };

  const toggleEdits = async (s: string) => {
    if (editsFor === s) return setEditsFor(null);
    setEditsFor(s);
    setEditsLoading(true);
    try {
      const res = await authedFetch(`/api/portal/admin/${encodeURIComponent(s)}/edits`);
      const data = await res.json();
      setEdits(res.ok ? data.edits || [] : []);
    } finally {
      setEditsLoading(false);
    }
  };

  const inputClass =
    "w-full px-4 py-3 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-purple-500/50 transition-colors";
  const labelClass = "text-xs text-zinc-400 uppercase tracking-wider font-medium block mb-2";

  return (
    <div id="client-portals" className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 mb-6">
      <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
        <Smartphone size={14} className="text-purple-400" />
        Client portals (phone review links)
      </h3>
      <p className="text-xs text-zinc-500 mb-5">
        One link + passcode per client. They open it on their phone, pick a brand, swipe through Facebook / Instagram previews of the next 31 days, and can
        reword captions before posts go live. Edits write straight back to HighLevel. Brands need a GHL location id (and a location token) in Accounts.
      </p>

      {/* Existing portals */}
      <div className="space-y-3 mb-6">
        {loading ? (
          <p className="text-xs text-zinc-500 flex items-center gap-2">
            <RefreshCw size={12} className="animate-spin" /> Loading…
          </p>
        ) : loadError ? (
          <p className="text-xs text-red-400">{loadError}</p>
        ) : portals.length === 0 ? (
          <p className="text-xs text-zinc-600">No portals yet — create the first one below.</p>
        ) : (
          portals.map((p) => (
            <div key={p.slug} className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate">{p.name}</p>
                  <p className="text-[11px] text-zinc-500 font-mono truncate">{portalUrl(p.slug)}</p>
                </div>
                <button onClick={() => copy(p.slug)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#12121A] border border-[#27273A] text-xs text-zinc-300 hover:text-white">
                  {copied === p.slug ? <CheckCircle size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  {copied === p.slug ? "Copied" : "Copy link"}
                </button>
                <a href={portalUrl(p.slug)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#12121A] border border-[#27273A] text-xs text-zinc-300 hover:text-white">
                  <ExternalLink size={12} /> Open
                </a>
                <button onClick={() => startEdit(p)} className="p-2 rounded-lg bg-[#12121A] border border-[#27273A] text-zinc-400 hover:text-white" aria-label="Edit">
                  <Edit3 size={13} />
                </button>
                <button onClick={() => remove(p)} className="p-2 rounded-lg bg-[#12121A] border border-[#27273A] text-zinc-500 hover:text-red-400" aria-label="Delete">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(p.brands ?? []).map((b) => (
                  <span
                    key={b.id}
                    title={b.connected ? (b.hasToken ? "Connected (location token saved)" : "Location id set — uses server token map") : "Missing GHL location id in Accounts"}
                    className={`text-[11px] px-2 py-1 rounded-full border ${
                      b.connected ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/5" : "border-amber-500/30 text-amber-300 bg-amber-500/5"
                    }`}
                  >
                    {b.name}
                    {!b.connected && " · no location id"}
                  </span>
                ))}
              </div>
              <button onClick={() => toggleEdits(p.slug)} className="mt-3 text-[11px] text-zinc-500 hover:text-zinc-300">
                {editsFor === p.slug ? "Hide client edits" : "Show client edits"}
              </button>
              {editsFor === p.slug && (
                <div className="mt-2 space-y-2">
                  {editsLoading ? (
                    <p className="text-xs text-zinc-500">Loading…</p>
                  ) : edits.length === 0 ? (
                    <p className="text-xs text-zinc-600">No edits from the client yet.</p>
                  ) : (
                    edits.map((e) => (
                      <div key={e.id} className="text-xs bg-[#12121A] border border-[#27273A] rounded-xl p-3">
                        <p className="text-zinc-400 mb-1">
                          <span className="text-white">{e.brandName}</span> · {e.editedAt ? new Date(e.editedAt).toLocaleString() : ""}
                          {e.scheduleDate && <> · posts {new Date(e.scheduleDate).toLocaleString()}</>}
                        </p>
                        <p className="text-zinc-500 line-through whitespace-pre-wrap">{e.before}</p>
                        <p className="text-zinc-200 whitespace-pre-wrap mt-1">{e.after}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create / edit form */}
      <div className="border-t border-[#27273A] pt-5">
        <p className="text-[11px] text-zinc-500 mb-3 uppercase tracking-wider">{editingSlug ? `Editing “${editingSlug}”` : "New portal"}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Client / company name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="SRG" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Link</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 font-mono shrink-0">/p/</span>
              <input
                value={slug}
                disabled={Boolean(editingSlug)}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="srg"
                className={`${inputClass} font-mono text-xs disabled:opacity-60`}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>{editingSlug ? "New passcode (leave blank to keep)" : "Passcode"}</label>
            <div className="relative">
              <input
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                type={showPasscode ? "text" : "password"}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. 4821 or shortys2026"
                autoComplete="new-password"
                className={`${inputClass} pr-11 font-mono`}
              />
              <button type="button" onClick={() => setShowPasscode((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white" aria-label="Toggle passcode">
                {showPasscode ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[10px] text-zinc-600 mt-1.5">Letters and numbers both work and case doesn't matter. Changing it signs every phone out.</p>
          </div>
          <div>
            <label className={labelClass}>Brands ({selected.size} selected)</label>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter accounts…" className={`${inputClass} mb-2`} />
            <div className="max-h-56 overflow-y-auto rounded-xl border border-[#27273A] bg-[#0A0A0F] divide-y divide-[#27273A]">
              {accountsLoading ? (
                <p className="text-xs text-zinc-500 p-3">Loading accounts…</p>
              ) : sortedAccounts.length === 0 ? (
                <p className="text-xs text-zinc-600 p-3">No accounts match.</p>
              ) : (
                sortedAccounts.map((a) => {
                  const loc = getGhlLocationId(a);
                  const tok = getGhlPrivateIntegrationToken(a);
                  const on = selected.has(a.id);
                  return (
                    <label key={a.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-white/[.02]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(a.id)) n.delete(a.id);
                            else n.add(a.id);
                            return n;
                          })
                        }
                        className="accent-purple-500"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-white truncate">{a.name}</span>
                        <span className={`block text-[10px] ${loc ? "text-emerald-400" : "text-amber-400"}`}>
                          {loc ? (tok ? "GHL connected · token saved" : "GHL location id set") : "No GHL location id — add it in Accounts"}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
        {saveError && (
          <p className="text-xs text-red-400 mt-3" role="alert">
            {saveError}
          </p>
        )}
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-50"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
            {editingSlug ? "Save portal" : "Create portal"}
          </button>
          {editingSlug && (
            <button onClick={resetForm} className="text-xs text-zinc-400 hover:text-white">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
