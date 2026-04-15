import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  Save,
  RefreshCw,
  CheckCircle,
  Briefcase,
  Globe,
  Mail,
  Phone,
  MapPin,
  Users,
  Zap,
  FileText,
  Plus,
  Trash2,
  Edit3,
  Calendar,
} from "@geist-ui/icons";
import {
  useBusinessSettings,
  type BusinessSettings,
} from "../hooks/useFirestore";
import type { User } from "firebase/auth";

interface SettingsProps {
  user: User;
}

export default function Settings({ user }: SettingsProps) {
  const { settings, loading, saveSettings } = useBusinessSettings();
  const [form, setForm] = useState<BusinessSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newValueProp, setNewValueProp] = useState("");
  const [ghlLookupLocationId, setGhlLookupLocationId] = useState("");
  const [ghlLookupPrivateToken, setGhlLookupPrivateToken] = useState("");
  const [ghlUserLookup, setGhlUserLookup] = useState<{ id: string; name: string; email?: string }[]>([]);
  const [ghlLookupLoading, setGhlLookupLoading] = useState(false);
  const [ghlLookupError, setGhlLookupError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  /** After save, skip one remote→form sync so stale listener state can't revert the form. */
  const skipNextRemoteSyncRef = useRef(false);

  // Only sync remote → form when the user hasn't edited locally. Firestore
  // onSnapshot can fire repeatedly and would otherwise wipe in-progress edits.
  useEffect(() => {
    if (loading || dirtyRef.current) return;
    if (skipNextRemoteSyncRef.current) {
      skipNextRemoteSyncRef.current = false;
      return;
    }
    setForm(settings);
  }, [loading, settings]);

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await saveSettings(form);
      skipNextRemoteSyncRef.current = true;
      dirtyRef.current = false;
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save settings";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  const update = (field: keyof BusinessSettings, value: any) => {
    dirtyRef.current = true;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const addValueProp = () => {
    if (!newValueProp.trim()) return;
    update("valuePropositions", [...form.valuePropositions, newValueProp.trim()]);
    setNewValueProp("");
  };

  const removeValueProp = (index: number) => {
    update(
      "valuePropositions",
      form.valuePropositions.filter((_, i) => i !== index)
    );
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto py-20 text-center">
        <RefreshCw size={24} className="mx-auto mb-3 text-purple-400 animate-spin" />
        <p className="text-sm text-zinc-500">Loading settings...</p>
      </div>
    );
  }

  const inputClass =
    "w-full px-4 py-3 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-purple-500/50 transition-colors";
  const labelClass = "text-xs text-zinc-400 uppercase tracking-wider font-medium block mb-2";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-4xl mx-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-semibold text-white">Settings</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Configure your agency info — used for AI-generated prospecting messages
          </p>
          {saveError && (
            <p className="text-sm text-red-400 mt-2" role="alert">
              {saveError}
            </p>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : saved ? (
            <CheckCircle size={14} />
          ) : (
            <Save size={14} />
          )}
          {saved ? "Saved" : "Save Settings"}
        </button>
      </div>

      {/* Current User Info */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 mb-6">
        <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
          <Users size={14} className="text-purple-400" />
          Logged-in User
        </h3>
        <div className="flex items-center gap-4">
          <img
            src={
              user.photoURL ||
              `https://ui-avatars.com/api/?name=${encodeURIComponent(
                user.displayName || user.email || "U"
              )}&background=7c3aed&color=fff&size=48`
            }
            alt=""
            className="w-12 h-12 rounded-full border border-[#27273A]"
          />
          <div>
            <p className="text-sm font-medium text-white">
              {user.displayName || "No display name"}
            </p>
            <p className="text-xs text-zinc-500">{user.email}</p>
          </div>
          <div className="ml-auto text-xs text-zinc-600 bg-[#0A0A0F] px-3 py-1.5 rounded-lg border border-[#27273A]">
            This info is automatically used in prospecting messages
          </div>
        </div>
      </div>

      {/* Agency Information */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 mb-6">
        <h3 className="text-sm font-medium text-white mb-6 flex items-center gap-2">
          <Briefcase size={14} className="text-purple-400" />
          Agency Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>Agency Name</label>
            <input
              type="text"
              value={form.agencyName}
              onChange={(e) => update("agencyName", e.target.value)}
              placeholder="BrandD AI Agency"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <div className="relative">
              <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="text"
                value={form.agencyWebsite}
                onChange={(e) => update("agencyWebsite", e.target.value)}
                placeholder="https://youragency.com"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="email"
                value={form.agencyEmail}
                onChange={(e) => update("agencyEmail", e.target.value)}
                placeholder="hello@youragency.com"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="text"
                value={form.agencyPhone}
                onChange={(e) => update("agencyPhone", e.target.value)}
                placeholder="(555) 123-4567"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Address</label>
            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type="text"
                value={form.agencyAddress}
                onChange={(e) => update("agencyAddress", e.target.value)}
                placeholder="123 Main St, City, State"
                className={`${inputClass} pl-9`}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Agency Description</label>
            <textarea
              value={form.agencyDescription}
              onChange={(e) => update("agencyDescription", e.target.value)}
              placeholder="What does your agency do? What makes you different?"
              rows={3}
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>
      </div>

      {/* Sender / Owner */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 mb-6">
        <h3 className="text-sm font-medium text-white mb-6 flex items-center gap-2">
          <Edit3 size={14} className="text-purple-400" />
          Sender Identity
        </h3>
        <p className="text-xs text-zinc-500 mb-5">
          Controls how emails and DMs are signed off.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className={labelClass}>Your Name</label>
            <input
              type="text"
              value={form.ownerName}
              onChange={(e) => update("ownerName", e.target.value)}
              placeholder={user.displayName || "Your full name"}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Your Title</label>
            <input
              type="text"
              value={form.ownerTitle}
              onChange={(e) => update("ownerTitle", e.target.value)}
              placeholder="Founder & CEO"
              className={inputClass}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Email Sign-Off Name</label>
            <input
              type="text"
              value={form.signOffName}
              onChange={(e) => update("signOffName", e.target.value)}
              placeholder="The BrandD AI Agency Team"
              className={inputClass}
            />
            <p className="text-[10px] text-zinc-600 mt-1.5">
              This is the name that appears at the bottom of prospecting emails
            </p>
          </div>
        </div>
      </div>

      {/* Brand Voice & Messaging */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 mb-6">
        <h3 className="text-sm font-medium text-white mb-6 flex items-center gap-2">
          <Zap size={14} className="text-purple-400" />
          Brand Voice & Messaging
        </h3>
        <div className="space-y-5">
          <div>
            <label className={labelClass}>Brand Voice / Tone</label>
            <textarea
              value={form.brandVoice}
              onChange={(e) => update("brandVoice", e.target.value)}
              placeholder="Describe your agency's tone — e.g., Professional but approachable, data-driven, results-focused..."
              rows={3}
              className={`${inputClass} resize-none`}
            />
          </div>

          <div>
            <label className={labelClass}>Value Propositions</label>
            <p className="text-[10px] text-zinc-600 mb-3">
              Key benefits the AI will weave into prospecting messages
            </p>
            <div className="space-y-2 mb-3">
              {form.valuePropositions.map((prop, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-xl bg-[#0A0A0F] border border-[#27273A]"
                >
                  <span className="w-6 h-6 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center justify-center text-[10px] font-bold shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-sm text-zinc-300 flex-1">{prop}</span>
                  <button
                    onClick={() => removeValueProp(i)}
                    className="text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newValueProp}
                onChange={(e) => setNewValueProp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addValueProp()}
                placeholder="e.g., 3x average ROI for restaurant clients"
                className={`${inputClass} flex-1`}
              />
              <button
                onClick={addValueProp}
                disabled={!newValueProp.trim()}
                className="px-4 py-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm hover:bg-purple-500/20 transition-colors disabled:opacity-50"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          <div>
            <label className={labelClass}>Case Studies / Social Proof</label>
            <textarea
              value={form.caseStudies}
              onChange={(e) => update("caseStudies", e.target.value)}
              placeholder="Describe results you've achieved for clients — the AI will reference these in Day 3 (Social Proof) emails..."
              rows={4}
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>
      </div>

      {/* Go High Level — shared API defaults */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 mb-6">
        <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
          <Calendar size={14} className="text-purple-400" />
          Go High Level (scheduling)
        </h3>
        <p className="text-xs text-zinc-500 mb-5">
          One default <strong className="text-zinc-400">user id</strong> for the whole team when creating Social Planner posts via the API.
          Social Planner tokens are often per sub-account: store them on each client in Accounts, or in{" "}
          <code className="text-zinc-400">GHL_LOCATION_TOKENS</code> on the server. For user lookup, paste that location’s token below if needed.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="md:col-span-2">
            <label className={labelClass}>Default HighLevel user id</label>
            <input
              type="text"
              value={form.ghlDefaultUserId ?? ""}
              onChange={(e) => update("ghlDefaultUserId", e.target.value)}
              placeholder="Paste user id (use lookup below)"
              className={`${inputClass} font-mono text-xs`}
              autoComplete="off"
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>HighLevel company id (agency only)</label>
            <input
              type="text"
              value={form.ghlCompanyId ?? ""}
              onChange={(e) => update("ghlCompanyId", e.target.value)}
              placeholder="Required for user lookup if you use an agency-level API token"
              className={`${inputClass} font-mono text-xs`}
              autoComplete="off"
            />
            <p className="text-[10px] text-zinc-600 mt-1.5">
              Sub-account Private Integration tokens can often skip this; the API will list users by location alone.
            </p>
          </div>
        </div>
        <div className="mt-5 pt-5 border-t border-[#27273A]">
          <p className="text-[11px] text-zinc-500 mb-3 uppercase tracking-wider">Look up user ids</p>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <div className="flex-1 space-y-3">
              <div>
                <label className={labelClass}>Location id to query</label>
                <input
                  type="text"
                  value={ghlLookupLocationId}
                  onChange={(e) => setGhlLookupLocationId(e.target.value)}
                  placeholder="Same as a client’s GHL Location ID in Accounts"
                  className={`${inputClass} font-mono text-xs`}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className={labelClass}>Location Private Integration token (optional)</label>
                <input
                  type="password"
                  value={ghlLookupPrivateToken}
                  onChange={(e) => setGhlLookupPrivateToken(e.target.value)}
                  placeholder="Paste sub-account token if server env / map doesn’t cover this location"
                  className={`${inputClass} font-mono text-xs`}
                  autoComplete="off"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!ghlLookupLocationId.trim()) {
                  setGhlLookupError("Enter a location id.");
                  return;
                }
                setGhlLookupLoading(true);
                setGhlLookupError(null);
                try {
                  const res = await fetch("/api/ghl/location-users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      locationId: ghlLookupLocationId.trim(),
                      companyId: (form.ghlCompanyId ?? "").trim() || undefined,
                      ...(ghlLookupPrivateToken.trim()
                        ? { privateIntegrationToken: ghlLookupPrivateToken.trim() }
                        : {}),
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || res.statusText);
                  setGhlUserLookup(Array.isArray(data.users) ? data.users : []);
                } catch (e) {
                  setGhlLookupError(e instanceof Error ? e.message : "Lookup failed.");
                  setGhlUserLookup([]);
                } finally {
                  setGhlLookupLoading(false);
                }
              }}
              disabled={ghlLookupLoading}
              className="px-4 py-3 rounded-xl bg-purple-500/15 border border-purple-500/25 text-sm text-purple-200 hover:bg-purple-500/25 transition-colors disabled:opacity-50 shrink-0"
            >
              {ghlLookupLoading ? <RefreshCw size={14} className="animate-spin inline" /> : null}{" "}
              Fetch users
            </button>
          </div>
          {ghlLookupError && (
            <p className="text-xs text-red-400 mt-2" role="alert">
              {ghlLookupError}
            </p>
          )}
          {ghlUserLookup.length > 0 && (
            <ul className="mt-4 space-y-2 max-h-48 overflow-y-auto rounded-xl border border-[#27273A] bg-[#0A0A0F] p-2">
              {ghlUserLookup.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-[#12121A] text-sm"
                >
                  <div className="min-w-0">
                    <p className="text-zinc-200 truncate">{u.name}</p>
                    <p className="text-[10px] text-zinc-500 font-mono truncate">{u.id}</p>
                    {u.email && <p className="text-[10px] text-zinc-600 truncate">{u.email}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => update("ghlDefaultUserId", u.id)}
                    className="shrink-0 text-xs px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/25"
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Bottom Save */}
      <div className="flex justify-end pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : saved ? (
            <CheckCircle size={14} />
          ) : (
            <Save size={14} />
          )}
          {saved ? "Saved" : "Save Settings"}
        </button>
      </div>
    </motion.div>
  );
}
