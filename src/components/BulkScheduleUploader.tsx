import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  X,
  Upload,
  Loader,
  Check,
  Zap,
  Trash2,
  AlertCircle,
  Calendar,
} from "@geist-ui/icons";
import { useFirestoreAccounts, useFirestoreAccount } from "../hooks/useFirestore";
import { getGhlLocationId } from "../lib/utils";
import {
  useBulkAiSchedule,
  type BulkImageInput,
  type BulkRunConfig,
  type CommitSummary,
} from "../hooks/useBulkAiSchedule";
import { MAX_BULK_HANDOFF_IMAGES } from "../hooks/useScheduleHandoffs";

const PLATFORMS = ["instagram", "facebook", "tiktok", "linkedin"] as const;
const CAPTION_STYLES = [
  { value: "short-sweet", label: "Short & sweet" },
  { value: "engaging", label: "Engaging" },
  { value: "long-form", label: "Long form" },
  { value: "witty", label: "Witty" },
  { value: "bold", label: "Bold" },
] as const;
const CTA_TYPES = [
  { value: "none", label: "No CTA" },
  { value: "visit-website", label: "Visit website" },
  { value: "call", label: "Call" },
  { value: "book-table", label: "Book a table" },
  { value: "order-online", label: "Order online" },
] as const;
const WINDOW_OPTIONS = [
  { value: 90, label: "Quarter · 90 days" },
  { value: 60, label: "2 months · 60 days" },
  { value: 45, label: "6 weeks · 45 days" },
  { value: 30, label: "Month · 30 days" },
] as const;

function readImage(file: File): Promise<BulkImageInput> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result as string;
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fileName: file.name,
        base64: dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl,
        mimeType: file.type?.startsWith("image/") ? file.type : "image/jpeg",
        preview: dataUrl,
      });
    };
    r.onerror = () => reject(new Error("Could not read image."));
    r.readAsDataURL(file);
  });
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const inputClass =
  "w-full rounded-lg bg-[#0f0f17] border border-white/10 px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none";

export default function BulkScheduleUploader({ onClose }: { onClose: () => void }) {
  const { accounts } = useFirestoreAccounts();
  const [accountId, setAccountId] = useState<string>("");
  const { account } = useFirestoreAccount(accountId || null);

  const [platform, setPlatform] = useState<string>("instagram");
  const [captionStyle, setCaptionStyle] = useState<string>("short-sweet");
  const [ctaType, setCtaType] = useState<string>("none");
  const [windowDays, setWindowDays] = useState<number>(90);
  const [usesPerImage, setUsesPerImage] = useState<number>(2);
  const [includeHashtags, setIncludeHashtags] = useState<boolean>(true);
  const [includeEmojis, setIncludeEmojis] = useState<boolean>(false);
  const [saveToSecondBrain, setSaveToSecondBrain] = useState<boolean>(true);
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState<CommitSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    rows,
    phase,
    progress,
    error,
    setImages,
    removeRow,
    updateCaption,
    analyzeAndDraft,
    commit,
    reset,
  } = useBulkAiSchedule();

  const menuItems = useMemo(
    () =>
      (account?.menuItems ?? []).map((m) => ({
        name: m.name,
        category: m.category,
        description: m.description,
      })),
    [account]
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) return;
      const capped = imgs.slice(0, MAX_BULK_HANDOFF_IMAGES - rows.length);
      const loaded = await Promise.all(capped.map(readImage));
      setImages([...rows.map((r) => ({ ...r })), ...loaded]);
    },
    [rows, setImages]
  );

  const config: BulkRunConfig | null = useMemo(() => {
    if (!account) return null;
    return {
      account,
      menuItems,
      platform,
      captionStyle,
      cta: { type: ctaType },
      includeHashtags,
      includeEmojis,
      saveToSecondBrain,
      windowDays,
      usesPerImage,
      minSimilarGapDays: 7,
      timezone: "America/New_York",
    };
  }, [
    account,
    menuItems,
    platform,
    captionStyle,
    ctaType,
    includeHashtags,
    includeEmojis,
    saveToSecondBrain,
    windowDays,
    usesPerImage,
  ]);

  const busy = phase === "analyzing" || phase === "planning" || phase === "committing";
  const readyRows = rows.filter((r) => r.status === "ready");
  const failedRows = rows.filter((r) => r.status === "failed");
  const totalPosts = readyRows.length * usesPerImage;
  const cadenceDays = totalPosts > 0 ? (windowDays / totalPosts).toFixed(1) : "0";
  const hasGhl = !!getGhlLocationId(account);

  const handleAnalyze = useCallback(() => {
    if (!config) return;
    setSummary(null);
    void analyzeAndDraft(config);
  }, [config, analyzeAndDraft]);

  const handleCommit = useCallback(async () => {
    if (!config) return;
    const result = await commit(config);
    setSummary(result);
  }, [config, commit]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4 sm:p-6">
      <div className="w-full max-w-5xl my-4 rounded-2xl border border-white/10 bg-[#0b0b12] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-300">
              <Zap size={16} />
            </span>
            <div>
              <h3 className="text-base font-semibold text-white">Bulk AI Scheduler</h3>
              <p className="text-[11px] text-zinc-500">
                Upload a batch → AI names them by your menu, drafts captions, and spreads them across the quarter.
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

        <div className="p-5 space-y-5">
          {/* Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-400">Brand</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={inputClass}
                disabled={busy}
              >
                <option value="">Choose a client…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.company || a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-400">Platform</span>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputClass} disabled={busy}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p[0]!.toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-400">Caption style</span>
              <select value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value)} className={inputClass} disabled={busy}>
                {CAPTION_STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-400">Call to action</span>
              <select value={ctaType} onChange={(e) => setCtaType(e.target.value)} className={inputClass} disabled={busy}>
                {CTA_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-400">Spread window</span>
              <select
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                className={inputClass}
                disabled={busy}
              >
                {WINDOW_OPTIONS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-zinc-400">Times each image is used</span>
              <select
                value={usesPerImage}
                onChange={(e) => setUsesPerImage(Number(e.target.value))}
                className={inputClass}
                disabled={busy}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </select>
            </label>
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
              <input type="checkbox" checked={saveToSecondBrain} onChange={(e) => setSaveToSecondBrain(e.target.checked)} disabled={busy} />
              Save matched images to the brand's Second Brain
            </label>
          </div>

          {/* Dropzone */}
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
                if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-12 cursor-pointer transition-colors ${
                dragOver ? "border-emerald-500/60 bg-emerald-500/5" : "border-white/15 hover:border-white/25"
              }`}
            >
              <Upload size={28} className="text-zinc-500" />
              <p className="text-sm text-zinc-300">Drop images here or click to browse</p>
              <p className="text-[11px] text-zinc-500">Up to {MAX_BULK_HANDOFF_IMAGES} images · JPG / PNG</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Summary bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <div className="flex flex-wrap items-center gap-3 text-zinc-400">
                  <span className="text-zinc-300 font-medium">{rows.length} image{rows.length !== 1 ? "s" : ""}</span>
                  {readyRows.length > 0 && (
                    <span className="text-emerald-300">
                      {totalPosts} posts · ~1 every {cadenceDays} days
                    </span>
                  )}
                  {failedRows.length > 0 && <span className="text-red-300">{failedRows.length} failed</span>}
                  {!hasGhl && account && (
                    <span className="text-amber-300/80">No HighLevel location — times are suggestions</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {phase !== "committing" && phase !== "done" && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy || rows.length >= MAX_BULK_HANDOFF_IMAGES}
                      className="px-2.5 py-1.5 rounded-lg text-xs border border-white/10 text-zinc-300 hover:bg-white/5 disabled:opacity-40"
                    >
                      Add more
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={reset}
                    disabled={busy}
                    className="px-2.5 py-1.5 rounded-lg text-xs border border-white/10 text-zinc-400 hover:bg-white/5 disabled:opacity-40"
                  >
                    Clear
                  </button>
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
                    {phase === "planning"
                      ? "Spreading the schedule across the window…"
                      : phase === "committing"
                        ? `Filing posts into the approval queue… ${progress.done}/${progress.total}`
                        : `Analyzing & drafting… ${progress.done}/${progress.total}`}
                  </p>
                </div>
              )}

              {/* Rows */}
              <div className="space-y-2 max-h-[42dvh] overflow-y-auto pr-1 -mr-1">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex gap-3 rounded-xl border border-white/[0.07] bg-[#0f0f17] p-3"
                  >
                    <img src={row.preview} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusPill status={row.status} />
                        {row.name && <span className="text-sm font-medium text-white truncate">{row.name}</span>}
                        {row.menuMatch ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-200 text-[10px]">
                            <Check size={9} /> {row.menuMatch}
                          </span>
                        ) : row.status === "ready" ? (
                          <span className="px-1.5 py-0.5 rounded-md bg-zinc-500/15 text-zinc-300 text-[10px]">best guess</span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          disabled={busy}
                          className="ml-auto p-1 rounded text-zinc-500 hover:text-red-300 disabled:opacity-40"
                          title="Remove"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {row.status === "failed" && (
                        <p className="text-[11px] text-red-300 flex items-center gap-1">
                          <AlertCircle size={11} /> {row.error}
                        </p>
                      )}

                      {row.status === "ready" &&
                        row.captions.map((cap, i) => (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                              <Calendar size={10} />
                              <span>
                                Use {i + 1} of {usesPerImage} · {fmtDate(row.occurrences[i])}
                              </span>
                            </div>
                            <textarea
                              value={cap}
                              onChange={(e) => updateCaption(row.id, i, e.target.value)}
                              rows={2}
                              className="w-full rounded-lg bg-[#0b0b12] border border-white/10 px-2.5 py-1.5 text-[12px] text-zinc-200 focus:border-emerald-500/50 focus:outline-none resize-y"
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
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
                <Check size={13} /> Sent {summary.handoffsCreated} post{summary.handoffsCreated !== 1 ? "s" : ""} to your approval queue
                {summary.assetsSaved > 0 && ` · saved ${summary.assetsSaved} to the Second Brain`}.
              </p>
              <p className="text-emerald-200/70">
                Review and approve them below in the AI Scheduler handoff queue.
              </p>
              {summary.failed.length > 0 && (
                <p className="text-red-300">{summary.failed.length} image(s) failed: {summary.failed.map((f) => f.fileName).join(", ")}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/[0.07]">
          <p className="text-[11px] text-zinc-500">
            {!account
              ? "Pick a brand to begin."
              : phase === "ready"
                ? `${readyRows.length} ready · ${totalPosts} posts will be queued for your approval.`
                : `Drafts go to your AI Scheduler queue for the team to approve.`}
          </p>
          <div className="flex items-center gap-2">
            {(phase === "idle" || phase === "analyzing" || phase === "planning") && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!config || rows.length === 0 || busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/90 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader size={14} className="animate-spin" /> : <Zap size={14} />}
                {busy ? "Working…" : "Analyze & draft"}
              </button>
            )}
            {(phase === "ready" || phase === "committing" || phase === "done") && (
              <button
                type="button"
                onClick={() => void handleCommit()}
                disabled={readyRows.length === 0 || phase === "committing" || phase === "done"}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/90 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {phase === "committing" ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
                {phase === "done"
                  ? "Sent ✓"
                  : phase === "committing"
                    ? "Sending…"
                    : `Send ${totalPosts} to my approval queue`}
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    queued: { label: "Queued", cls: "bg-zinc-500/15 text-zinc-300" },
    analyzing: { label: "Analyzing", cls: "bg-blue-500/15 text-blue-200" },
    captioning: { label: "Captioning", cls: "bg-violet-500/15 text-violet-200" },
    ready: { label: "Ready", cls: "bg-emerald-500/15 text-emerald-200" },
    failed: { label: "Failed", cls: "bg-red-500/15 text-red-200" },
  };
  const s = map[status] ?? map.queued!;
  return <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium ${s.cls}`}>{s.label}</span>;
}
