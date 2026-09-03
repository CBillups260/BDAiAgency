import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Upload,
  Loader,
  Check,
  Grid,
  Trash2,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Zap,
  Calendar,
  RefreshCw,
} from "@geist-ui/icons";
import { useFirestoreAccounts, useFirestoreAccount, useBusinessSettings } from "../hooks/useFirestore";
import { authedFetch } from "../lib/api";
import { getGhlLocationId, getGhlPrivateIntegrationToken } from "../lib/utils";
import { extractGhlAccounts, type GhlAccountRow } from "../lib/ghl";
import {
  useScheduleSheet,
  parsePastedDate,
  parseLocalInput,
  toLocalInput,
  MAX_SHEET_ROWS,
  type SheetRow,
  type AutofillConfig,
  type SheetCommitSummary,
} from "../hooks/useScheduleSheet";

const PLATFORMS = ["instagram", "facebook", "tiktok", "linkedin"] as const;
const CAPTION_STYLES = [
  { value: "short-sweet", label: "Short & sweet" },
  { value: "engaging", label: "Engaging" },
  { value: "long-form", label: "Long form" },
  { value: "witty", label: "Witty" },
  { value: "bold", label: "Bold" },
] as const;

/** Meta's Instagram Content Publishing limit: ~25 posts per rolling 24h per account. */
const INSTAGRAM_DAILY_CAP = 25;

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Which weekdays a brand posts on is a durable fact about that business (Salvatori's is
 * closed Mondays, permanently), so it outlives the tab — hence localStorage rather than
 * the sessionStorage-backed usePersistedState used for scratch UI state.
 */
const POSTING_DAYS_KEY = "bdai:sheet.postingDays";

function loadPostingDays(accountId: string): number[] | null {
  try {
    const raw = localStorage.getItem(POSTING_DAYS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, number[]>;
    const days = map[accountId];
    return Array.isArray(days) ? days : null;
  } catch {
    return null;
  }
}

function savePostingDays(accountId: string, weekdays: number[]) {
  try {
    const raw = localStorage.getItem(POSTING_DAYS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number[]>) : {};
    map[accountId] = weekdays;
    localStorage.setItem(POSTING_DAYS_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable — the selection still works for this session.
  }
}

const inputClass =
  "rounded-lg bg-[#0f0f17] border border-white/10 px-2.5 py-1.5 text-[12px] text-white focus:border-emerald-500/50 focus:outline-none";
const btnClass =
  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] border border-white/10 text-zinc-300 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed";

function defaultStart(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(11, 0, 0, 0);
  return toLocalInput(d);
}

/** Split a clipboard payload into rows/columns the way a spreadsheet would. */
function parseClipboardGrid(text: string): string[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line, i, all) => line.trim().length > 0 || i < all.length - 1)
    .map((line) => line.split("\t"));
}

export default function ScheduleSheet({ onClose }: { onClose: () => void }) {
  const { accounts } = useFirestoreAccounts();
  const { settings } = useBusinessSettings();
  const [accountId, setAccountId] = useState<string>("");
  // The full record (menu items live in a subcollection the list query doesn't load).
  const { account } = useFirestoreAccount(accountId || null);
  const menuItems = useMemo(
    () =>
      (account?.menuItems ?? []).map((m) => ({
        name: m.name,
        category: m.category,
        description: m.description,
      })),
    [account]
  );

  const [channels, setChannels] = useState<GhlAccountRow[]>([]);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  const [platform, setPlatform] = useState<string>("instagram");
  const [captionStyle, setCaptionStyle] = useState<string>("short-sweet");
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [includeEmojis, setIncludeEmojis] = useState(false);
  const [overwriteCaptions, setOverwriteCaptions] = useState(false);

  const [autofill, setAutofill] = useState<AutofillConfig>({
    startLocal: defaultStart(),
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    everyNWeeks: 1,
    times: ["11:00"],
    skipHolidays: true,
    blackoutDates: [],
  });
  const [timesText, setTimesText] = useState("11:00");
  const [blackoutText, setBlackoutText] = useState("");

  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState<SheetCommitSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetRef = useRef<string | null>(null);
  /** Cell refs keyed "rowIndex:col" so Enter / fill-down can move focus like a sheet. */
  const cellRefs = useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map());

  const {
    rows,
    phase,
    progress,
    error,
    setError,
    notice,
    addFiles,
    replaceImage,
    setCell,
    setColumnFrom,
    removeRow,
    moveRow,
    sortByFileName,
    autofillDates,
    clearAll,
    generateCaptions,
    readyRowIds,
    scheduleAll,
  } = useScheduleSheet();

  const locationId = getGhlLocationId(account);
  const privateIntegrationToken = getGhlPrivateIntegrationToken(account);
  const ghlUserId = settings.ghlDefaultUserId?.trim() ?? "";

  // Load the brand's connected channels whenever the HighLevel location changes.
  useEffect(() => {
    setChannels([]);
    setSelectedChannelIds(new Set());
    setChannelError(null);
    if (!locationId.trim()) return;
    let cancelled = false;
    setLoadingChannels(true);
    (async () => {
      try {
        const res = await authedFetch("/api/ghl/accounts", {
          method: "POST",
          body: JSON.stringify({
            locationId: locationId.trim(),
            ...(privateIntegrationToken.trim()
              ? { privateIntegrationToken: privateIntegrationToken.trim() }
              : {}),
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.error || res.statusText);
        const list = extractGhlAccounts(data);
        setChannels(list);
        if (list.length === 1) setSelectedChannelIds(new Set([list[0]!.id]));
      } catch (e) {
        if (!cancelled) setChannelError(e instanceof Error ? e.message : "Couldn't load channels.");
      } finally {
        if (!cancelled) setLoadingChannels(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, privateIntegrationToken]);

  const busy = phase === "captioning" || phase === "scheduling";
  const readyCount = readyRowIds().length;
  const scheduledCount = rows.filter((r) => r.status === "scheduled").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  const missingCaption = rows.filter((r) => r.status !== "scheduled" && !r.caption.trim()).length;
  const missingDate = rows.filter((r) => r.status !== "scheduled" && !parseLocalInput(r.dateLocal)).length;

  const [confirming, setConfirming] = useState(false);
  const [copiedErrors, setCopiedErrors] = useState(false);
  const copyErrors = useCallback(async () => {
    const text = rows
      .filter((r) => r.status === "failed")
      .map((r, i) => `${i + 1}. ${r.fileName}: ${r.error ?? "Failed"}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedErrors(true);
      window.setTimeout(() => setCopiedErrors(false), 2000);
    } catch {
      setError(text);
    }
  }, [rows, setError]);

  const focusCell = useCallback((rowIndex: number, col: "date" | "caption") => {
    const el = cellRefs.current.get(`${rowIndex}:${col}`);
    if (el) {
      el.focus();
      if (el instanceof HTMLTextAreaElement) el.select();
    }
  }, []);

  const handleCellKeyDown = useCallback(
    (e: React.KeyboardEvent, rowIndex: number, col: "date" | "caption") => {
      const mod = e.metaKey || e.ctrlKey;
      // Cmd/Ctrl+D — fill this cell from the row above, same as a spreadsheet.
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const above = rows[rowIndex - 1];
        const current = rows[rowIndex];
        if (!above || !current) return;
        if (col === "caption") setCell(current.id, "caption", above.caption);
        else {
          // Dates fill forward by the gap between the two rows above it, so a
          // cadence set once keeps going.
          const prev = parseLocalInput(above.dateLocal);
          const prev2 = rows[rowIndex - 2] ? parseLocalInput(rows[rowIndex - 2]!.dateLocal) : null;
          if (!prev) return;
          const stepMs = prev2 ? prev.getTime() - prev2.getTime() : 24 * 60 * 60 * 1000;
          setCell(current.id, "dateLocal", toLocalInput(new Date(prev.getTime() + stepMs)));
        }
        return;
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && col === "caption" && !e.shiftKey) {
        e.preventDefault();
        focusCell(rowIndex + 1, "caption");
        return;
      }
      if (e.key === "Enter" && col === "date") {
        e.preventDefault();
        focusCell(rowIndex + 1, "date");
        return;
      }
      if (mod && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        focusCell(rowIndex + (e.key === "ArrowDown" ? 1 : -1), col);
      }
    },
    [rows, setCell, focusCell]
  );

  /** Paste a column (or a Date⇥Caption block) straight out of Google Sheets. */
  const handleCellPaste = useCallback(
    (e: React.ClipboardEvent, rowIndex: number, col: "date" | "caption") => {
      const text = e.clipboardData.getData("text/plain");
      if (!text) return;
      const grid = parseClipboardGrid(text);
      const multiRow = grid.length > 1;
      const multiCol = grid.some((cells) => cells.length > 1);
      if (!multiRow && !multiCol) return; // single value — let the browser handle it
      e.preventDefault();

      if (col === "date") {
        const dates = grid.map((cells) => parsePastedDate(cells[0] ?? ""));
        setColumnFrom(rowIndex, "dateLocal", dates);
        if (multiCol) {
          setColumnFrom(rowIndex, "caption", grid.map((cells) => (cells[1] ?? "").trim()));
        }
      } else {
        setColumnFrom(rowIndex, "caption", grid.map((cells) => (cells[0] ?? "").trim()));
      }
    },
    [setColumnFrom]
  );

  /** Remember this brand's posting days — a closed Monday is closed every Monday. */
  const toggleWeekday = useCallback(
    (day: number) => {
      setAutofill((c) => {
        const next = c.weekdays.includes(day)
          ? c.weekdays.filter((d) => d !== day)
          : [...c.weekdays, day].sort((a, b) => a - b);
        if (accountId) savePostingDays(accountId, next);
        return { ...c, weekdays: next };
      });
    },
    [accountId]
  );

  useEffect(() => {
    if (!accountId) return;
    const saved = loadPostingDays(accountId);
    if (saved) setAutofill((c) => ({ ...c, weekdays: saved }));
  }, [accountId]);

  const applyAutofill = useCallback(() => {
    const times = timesText
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => /^\d{1,2}:\d{2}$/.test(t));
    if (!times.length) {
      setError("Add at least one time of day, like “11:00, 17:30”.");
      return;
    }
    const blackoutDates = blackoutText
      .split(/[,\s]+/)
      .map((d) => d.trim())
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const cfg = { ...autofill, times, blackoutDates };
    setAutofill(cfg);
    autofillDates(cfg);
  }, [autofill, timesText, blackoutText, autofillDates, setError]);

  const handleGenerateCaptions = useCallback(() => {
    if (!account) {
      setError("Pick a brand first — captions use its voice.");
      return;
    }
    setSummary(null);
    void generateCaptions(
      { account, menuItems, platform, captionStyle, includeHashtags, includeEmojis },
      { overwrite: overwriteCaptions }
    );
  }, [account, menuItems, platform, captionStyle, includeHashtags, includeEmojis, overwriteCaptions, generateCaptions, setError]);

  const handleSchedule = useCallback(async () => {
    try {
      setSummary(null);
      const result = await scheduleAll({
        locationId,
        privateIntegrationToken,
        accountIds: Array.from(selectedChannelIds),
        userId: ghlUserId,
      });
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not schedule this batch.");
    }
  }, [scheduleAll, locationId, privateIntegrationToken, selectedChannelIds, ghlUserId, setError]);

  const canSchedule =
    !!locationId && selectedChannelIds.size > 0 && !!ghlUserId && readyCount > 0 && !busy;

  /**
   * Date span + the busiest 24h window of what's about to be committed. Instagram's
   * publishing API allows ~25 posts per rolling 24 hours per account and rejects the
   * overflow with a misleading "community guidelines" error, so surface it up front.
   */
  const readySpan = useMemo(() => {
    const ids = new Set(readyRowIds());
    const times = rows
      .filter((r) => ids.has(r.id))
      .map((r) => parseLocalInput(r.dateLocal)?.getTime())
      .filter((t): t is number => typeof t === "number")
      .sort((a, b) => a - b);
    if (!times.length) return null;
    const fmt = (t: number) =>
      new Date(t).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    // Widest count inside any 24h window (sliding over the sorted times).
    const DAY_MS = 24 * 60 * 60 * 1000;
    let busiest = 0;
    let start = 0;
    for (let end = 0; end < times.length; end++) {
      while (times[end]! - times[start]! >= DAY_MS) start++;
      busiest = Math.max(busiest, end - start + 1);
    }
    return { first: fmt(times[0]!), last: fmt(times[times.length - 1]!), busiest };
  }, [rows, readyRowIds]);

  const instagramSelected = useMemo(
    () =>
      channels.some(
        (c) => selectedChannelIds.has(c.id) && (c.platform ?? "").toLowerCase().includes("instagram")
      ),
    [channels, selectedChannelIds]
  );
  const overInstagramCap = instagramSelected && (readySpan?.busiest ?? 0) > INSTAGRAM_DAILY_CAP;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 backdrop-blur-sm p-2 sm:p-4">
      <div className="w-full max-w-[1400px] my-2 rounded-2xl border border-white/10 bg-[#0b0b12] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-300">
              <Grid size={16} />
            </span>
            <div>
              <h3 className="text-base font-semibold text-white">Schedule Sheet</h3>
              <p className="text-[11px] text-zinc-500">
                Date · Caption · Image — drop {MAX_SHEET_ROWS > 40 ? "40+" : ""} images, fill the grid, push the whole batch to HighLevel.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Destination */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(200px,260px)_minmax(0,1fr)] gap-4">
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-400">Brand</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={`${inputClass} w-full`}
                disabled={busy}
              >
                <option value="">Choose a client…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.company || a.name}
                  </option>
                ))}
              </select>
              {account && !locationId && (
                <p className="text-[11px] text-amber-300/90">
                  This client has no HighLevel location — add one in the CRM to schedule.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-400">
                Channels {loadingChannels && <Loader size={10} className="inline animate-spin ml-1" />}
              </span>
              <div className="flex flex-wrap gap-2 min-h-[34px] items-center">
                {channels.length === 0 && !loadingChannels && (
                  <span className="text-[11px] text-zinc-500">
                    {locationId ? channelError || "No connected channels found." : "Pick a brand to load its channels."}
                  </span>
                )}
                {channels.map((c) => {
                  const on = selectedChannelIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setSelectedChannelIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                      className={`px-2.5 py-1.5 rounded-lg text-[12px] border transition-colors ${
                        on
                          ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                          : "border-white/10 text-zinc-400 hover:bg-white/5"
                      }`}
                    >
                      {on && <Check size={10} className="inline mr-1" />}
                      {c.name}
                      {c.platform ? <span className="text-zinc-500"> · {c.platform}</span> : null}
                    </button>
                  );
                })}
              </div>
              {!ghlUserId && (
                <p className="text-[11px] text-amber-300/90">
                  No default HighLevel user id in Settings — posts can't be created without one.
                </p>
              )}
            </div>
          </div>

          {/* Toolbar */}
          <div className="rounded-xl border border-white/[0.07] bg-[#0f0f17] p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Start</span>
                <input
                  type="datetime-local"
                  value={autofill.startLocal}
                  onChange={(e) => setAutofill((c) => ({ ...c, startLocal: e.target.value }))}
                  className={inputClass}
                  disabled={busy}
                />
              </label>
              <div className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">
                  Post on {account ? "· closed days stay unchecked" : ""}
                </span>
                <div className="flex gap-1">
                  {WEEKDAY_LABELS.map((label, day) => {
                    const on = autofill.weekdays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        disabled={busy}
                        title={WEEKDAY_FULL[day]}
                        onClick={() => toggleWeekday(day)}
                        className={`w-8 h-[34px] rounded-lg text-[11px] font-medium border transition-colors ${
                          on
                            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                            : "border-white/10 text-zinc-600 hover:bg-white/5"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Every</span>
                <select
                  value={autofill.everyNWeeks}
                  onChange={(e) => setAutofill((c) => ({ ...c, everyNWeeks: Number(e.target.value) }))}
                  className={inputClass}
                  disabled={busy}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "week" : `${n} weeks`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Times of day</span>
                <input
                  value={timesText}
                  onChange={(e) => setTimesText(e.target.value)}
                  placeholder="11:00, 17:30"
                  className={`${inputClass} w-32`}
                  disabled={busy}
                />
              </label>
              <label className="inline-flex items-center gap-2 text-[12px] text-zinc-400 pb-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autofill.skipHolidays}
                  onChange={(e) => setAutofill((c) => ({ ...c, skipHolidays: e.target.checked }))}
                  disabled={busy}
                />
                Skip holidays
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Also closed</span>
                <input
                  value={blackoutText}
                  onChange={(e) => setBlackoutText(e.target.value)}
                  placeholder="2026-11-27, 2026-12-31"
                  className={`${inputClass} w-44`}
                  disabled={busy}
                />
              </label>
              <button type="button" onClick={applyAutofill} disabled={busy || rows.length === 0} className={btnClass}>
                <Calendar size={13} /> Fill dates
              </button>

              <span className="h-6 w-px bg-white/10 mx-1 hidden sm:block" />

              <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Platform</span>
                <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputClass} disabled={busy}>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p[0]!.toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Caption style</span>
                <select
                  value={captionStyle}
                  onChange={(e) => setCaptionStyle(e.target.value)}
                  className={inputClass}
                  disabled={busy}
                >
                  {CAPTION_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleGenerateCaptions}
                disabled={busy || rows.length === 0 || !account}
                className={`${btnClass} border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20`}
              >
                {phase === "captioning" ? <Loader size={13} className="animate-spin" /> : <Zap size={13} />}
                AI captions
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-[12px] text-zinc-400">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includeHashtags} onChange={(e) => setIncludeHashtags(e.target.checked)} disabled={busy} />
                Hashtags
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includeEmojis} onChange={(e) => setIncludeEmojis(e.target.checked)} disabled={busy} />
                Emojis
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={overwriteCaptions} onChange={(e) => setOverwriteCaptions(e.target.checked)} disabled={busy} />
                Overwrite existing captions
              </label>
              <span className="ml-auto flex items-center gap-2">
                <button type="button" onClick={sortByFileName} disabled={busy || rows.length === 0} className={btnClass}>
                  <RefreshCw size={12} /> Sort by filename
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || rows.length >= MAX_SHEET_ROWS}
                  className={btnClass}
                >
                  <Upload size={12} /> Add images
                </button>
                <button type="button" onClick={clearAll} disabled={busy || rows.length === 0} className={btnClass}>
                  Clear
                </button>
              </span>
            </div>
          </div>

          {/* Progress */}
          {busy && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-500">
                {phase === "captioning"
                  ? `Drafting captions… ${progress.done}/${progress.total}`
                  : `Scheduling in HighLevel… ${progress.done}/${progress.total}`}
              </p>
            </div>
          )}

          {/* The sheet */}
          {rows.length === 0 ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-16 cursor-pointer transition-colors ${
                dragOver ? "border-emerald-500/60 bg-emerald-500/5" : "border-white/15 hover:border-white/25"
              }`}
            >
              <Upload size={28} className="text-zinc-500" />
              <p className="text-sm text-zinc-300">Drop your images here — one row per post</p>
              <p className="text-[11px] text-zinc-500">Up to {MAX_SHEET_ROWS} images · JPG / PNG</p>
            </div>
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
              }}
              className={`rounded-xl border overflow-hidden ${
                dragOver ? "border-emerald-500/60" : "border-white/[0.07]"
              }`}
            >
              <div className="max-h-[52dvh] overflow-auto">
                {/* Fixed column widths add up to ~760px — below that the grid has to
                    scroll sideways rather than crush the caption column. */}
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead className="sticky top-0 z-10 bg-[#16161f]">
                    <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                      <th className="w-10 px-2 py-2 font-semibold border-b border-r border-white/[0.07] text-center">#</th>
                      <th className="w-[190px] px-2 py-2 font-semibold border-b border-r border-white/[0.07]">Date</th>
                      <th className="px-2 py-2 font-semibold border-b border-r border-white/[0.07]">Caption</th>
                      <th className="w-[230px] px-2 py-2 font-semibold border-b border-r border-white/[0.07]">Image</th>
                      <th className="w-[150px] px-2 py-2 font-semibold border-b border-white/[0.07]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <SheetRowView
                        key={row.id}
                        row={row}
                        index={i}
                        isLast={i === rows.length - 1}
                        busy={busy}
                        registerCell={(col, el) => {
                          const key = `${i}:${col}`;
                          if (el) cellRefs.current.set(key, el);
                          else cellRefs.current.delete(key);
                        }}
                        onChange={setCell}
                        onKeyDown={handleCellKeyDown}
                        onPaste={handleCellPaste}
                        onRemove={removeRow}
                        onMove={moveRow}
                        onReplaceImage={(id) => {
                          replaceTargetRef.current = id;
                          replaceInputRef.current?.click();
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-white/[0.07] bg-[#0f0f17] text-[11px] text-zinc-500">
                <span className="text-zinc-300 font-medium">{rows.length} rows</span>
                <span className="text-emerald-300">{readyCount} ready</span>
                {missingCaption > 0 && <span className="text-amber-300/80">{missingCaption} missing caption</span>}
                {missingDate > 0 && <span className="text-amber-300/80">{missingDate} missing date</span>}
                {scheduledCount > 0 && <span className="text-emerald-400">{scheduledCount} scheduled</span>}
                {failedCount > 0 && (
                  <>
                    <span className="text-red-300">{failedCount} failed</span>
                    <button
                      type="button"
                      onClick={() => void copyErrors()}
                      className="text-red-300/80 underline underline-offset-2 hover:text-red-200"
                    >
                      {copiedErrors ? "Copied ✓" : "Copy error details"}
                    </button>
                  </>
                )}
                <span className="ml-auto">
                  Paste a column from Google Sheets · Enter moves down · ⌘/Ctrl+D fills from the row above
                </span>
              </div>
            </div>
          )}

          {notice && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/[0.08] px-3 py-2 text-[12px] text-sky-200 flex items-start gap-2">
              <Calendar size={13} className="mt-px shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-[12px] text-amber-200">
              {error}
            </div>
          )}

          {summary && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-3 text-[12px] text-emerald-100 space-y-1">
              <p className="font-medium flex items-center gap-1.5">
                <Check size={13} /> Scheduled {summary.scheduled} post{summary.scheduled !== 1 ? "s" : ""} in HighLevel.
              </p>
              {summary.failed.length > 0 && (
                <p className="text-red-300">
                  {summary.failed.length} failed — fix the red rows and press Schedule again to retry just those.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-white/[0.07]">
          <p className="text-[11px] text-zinc-500">
            {!account
              ? "Pick a brand to begin."
              : !locationId
                ? "This brand isn't connected to HighLevel."
                : selectedChannelIds.size === 0
                  ? "Pick at least one channel."
                  : `${readyCount} row${readyCount !== 1 ? "s" : ""} will be posted to ${selectedChannelIds.size} channel${
                      selectedChannelIds.size !== 1 ? "s" : ""
                    }.`}
          </p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!canSchedule}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/90 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {phase === "scheduling" ? <Loader size={14} className="animate-spin" /> : <Calendar size={14} />}
            {phase === "scheduling" ? "Scheduling…" : `Schedule ${readyCount} post${readyCount !== 1 ? "s" : ""} in GHL`}
          </button>
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f17] p-5 space-y-4">
            <h4 className="text-sm font-semibold text-white">
              Schedule {readyCount} post{readyCount !== 1 ? "s" : ""}?
            </h4>
            <div className="space-y-2 text-[12px] text-zinc-400">
              <p>
                They go to{" "}
                <span className="text-zinc-200">
                  {selectedChannelIds.size} channel{selectedChannelIds.size !== 1 ? "s" : ""}
                </span>{" "}
                for <span className="text-zinc-200">{account?.company || account?.name}</span>.
              </p>
              {readySpan && (
                <p>
                  First posts <span className="text-zinc-200">{readySpan.first}</span>, last{" "}
                  <span className="text-zinc-200">{readySpan.last}</span>.
                </p>
              )}
              <p className="text-emerald-300/90">
                Nothing publishes now — every post is created with a future date and can be edited in
                HighLevel until then.
              </p>
              {overInstagramCap && (
                <p className="text-amber-300">
                  Heads up: {readySpan?.busiest} of these land within 24 hours of each other.
                  Instagram only accepts about {INSTAGRAM_DAILY_CAP} posts a day per account and
                  rejects the rest with a misleading "community guidelines" error. Spread them
                  further before sending.
                </p>
              )}
              <p className="text-amber-300/80">This can't be undone from here.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="px-3 py-2 rounded-lg text-[12px] border border-white/10 text-zinc-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  void handleSchedule();
                }}
                className="px-3 py-2 rounded-lg text-[12px] font-medium bg-emerald-500/90 hover:bg-emerald-500 text-white"
              >
                Schedule {readyCount}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const id = replaceTargetRef.current;
          if (file && id) replaceImage(id, file);
          replaceTargetRef.current = null;
          e.target.value = "";
        }}
      />
    </div>
  );
}

function SheetRowView({
  row,
  index,
  isLast,
  busy,
  registerCell,
  onChange,
  onKeyDown,
  onPaste,
  onRemove,
  onMove,
  onReplaceImage,
}: {
  row: SheetRow;
  index: number;
  isLast: boolean;
  busy: boolean;
  registerCell: (col: "date" | "caption", el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onChange: (id: string, field: "dateLocal" | "caption", value: string) => void;
  onKeyDown: (e: React.KeyboardEvent, rowIndex: number, col: "date" | "caption") => void;
  onPaste: (e: React.ClipboardEvent, rowIndex: number, col: "date" | "caption") => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onReplaceImage: (id: string) => void;
}) {
  const locked = row.status === "scheduled";
  const cellBase =
    "w-full bg-transparent px-2 py-1.5 text-[12px] text-zinc-100 focus:outline-none focus:bg-emerald-500/[0.07] focus:ring-1 focus:ring-inset focus:ring-emerald-500/50 disabled:text-zinc-500";

  return (
    <tr
      className={`border-b border-white/[0.05] ${
        row.status === "failed"
          ? "bg-red-500/[0.06]"
          : locked
            ? "bg-emerald-500/[0.05]"
            : index % 2
              ? "bg-white/[0.015]"
              : ""
      }`}
    >
      <td className="px-1 py-1 border-r border-white/[0.05] text-center align-middle">
        <span className="text-[11px] text-zinc-600 tabular-nums">{index + 1}</span>
      </td>

      <td className="p-0 border-r border-white/[0.05] align-middle">
        <input
          ref={(el) => registerCell("date", el)}
          type="datetime-local"
          value={row.dateLocal}
          disabled={busy || locked}
          onChange={(e) => onChange(row.id, "dateLocal", e.target.value)}
          onKeyDown={(e) => onKeyDown(e, index, "date")}
          onPaste={(e) => onPaste(e, index, "date")}
          className={`${cellBase} [color-scheme:dark]`}
        />
      </td>

      <td className="p-0 border-r border-white/[0.05] align-middle">
        <textarea
          ref={(el) => registerCell("caption", el)}
          value={row.caption}
          rows={2}
          disabled={busy || locked}
          placeholder="Write or paste a caption…"
          onChange={(e) => onChange(row.id, "caption", e.target.value)}
          onKeyDown={(e) => onKeyDown(e, index, "caption")}
          onPaste={(e) => onPaste(e, index, "caption")}
          className={`${cellBase} resize-y placeholder-zinc-600 leading-snug`}
        />
      </td>

      <td className="px-2 py-1.5 border-r border-white/[0.05] align-middle">
        <div className="flex items-center gap-2">
          <img src={row.previewUrl} alt="" className="w-10 h-10 rounded object-cover shrink-0 border border-white/10" />
          <button
            type="button"
            disabled={busy || locked}
            onClick={() => onReplaceImage(row.id)}
            title={`${row.fileName} — click to replace`}
            className="min-w-0 flex-1 text-left disabled:cursor-default group/img"
          >
            <span className="block text-[11px] text-zinc-400 group-hover/img:text-zinc-200 truncate">
              {row.fileName}
            </span>
            {row.menuMatch && (
              <span className="block text-[10px] text-emerald-300/80 truncate" title={row.menuMatch}>
                ✓ {row.menuMatch}
              </span>
            )}
          </button>
          <div className="flex flex-col shrink-0">
            <button
              type="button"
              disabled={busy || index === 0}
              onClick={() => onMove(row.id, -1)}
              className="p-0.5 text-zinc-600 hover:text-zinc-300 disabled:opacity-30"
              aria-label="Move up"
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              disabled={busy || isLast}
              onClick={() => onMove(row.id, 1)}
              className="p-0.5 text-zinc-600 hover:text-zinc-300 disabled:opacity-30"
              aria-label="Move down"
            >
              <ChevronDown size={12} />
            </button>
          </div>
        </div>
      </td>

      <td className="px-2 py-1.5 align-middle">
        <div className="flex items-center gap-2">
          <StatusCell row={row} />
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(row.id)}
            className="ml-auto p-1 rounded text-zinc-600 hover:text-red-300 disabled:opacity-30"
            aria-label="Delete row"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatusCell({ row }: { row: SheetRow }) {
  if (row.status === "failed") {
    // Full text, wrapped and scrollable — a truncated failure is a failure you can't act on.
    return (
      <span className="flex items-start gap-1 text-[10px] text-red-300 leading-tight">
        <AlertCircle size={10} className="mt-px shrink-0" />
        <span className="max-h-16 overflow-y-auto break-words whitespace-pre-wrap">
          {row.error || "Failed"}
        </span>
      </span>
    );
  }
  const map: Record<string, { label: string; cls: string; spin?: boolean }> = {
    draft: { label: "Draft", cls: "bg-zinc-500/15 text-zinc-400" },
    captioning: { label: "Writing…", cls: "bg-violet-500/15 text-violet-200", spin: true },
    uploading: { label: "Uploading…", cls: "bg-blue-500/15 text-blue-200", spin: true },
    scheduling: { label: "Sending…", cls: "bg-blue-500/15 text-blue-200", spin: true },
    scheduled: { label: "Scheduled", cls: "bg-emerald-500/15 text-emerald-200" },
  };
  const s = map[row.status] ?? map.draft!;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium ${s.cls}`}>
      {s.spin ? <Loader size={9} className="animate-spin" /> : row.status === "scheduled" ? <Check size={9} /> : null}
      {s.label}
    </span>
  );
}
