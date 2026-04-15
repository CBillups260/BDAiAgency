import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Loader,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Upload,
  X,
  Briefcase,
  Image as ImageIcon,
} from "@geist-ui/icons";
import { motion } from "motion/react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../lib/firebase";
import { useFirestoreAccounts, useBusinessSettings } from "../hooks/useFirestore";
import { getGhlLocationId, getGhlPrivateIntegrationToken } from "../lib/utils";
import CaptionGeneratorMini from "./CaptionGeneratorMini";
import { useAuth } from "../hooks/useAuth";
import {
  usePendingHandoffsForAssignee,
  markHandoffScheduled,
  markHandoffDismissed,
  groupPendingHandoffsByClient,
  pickNextHandoffForClient,
  clientAccountIdForHandoffInQueue,
  type ScheduleHandoff,
} from "../hooks/useScheduleHandoffs";

interface GhlAccountRow {
  id: string;
  name: string;
  platform?: string;
}

function extractGhlAccounts(data: unknown): GhlAccountRow[] {
  const d = data as Record<string, unknown> | null | undefined;
  const results = (d?.results ?? d) as Record<string, unknown> | undefined;
  const raw = (results?.accounts ?? results?.data) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.accounts;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const a = item as Record<string, unknown>;
      const id = String(a.id ?? a._id ?? "").trim();
      const name = String(a.name ?? a.accountName ?? "Connected account");
      const platform = typeof a.platform === "string" ? a.platform : undefined;
      return { id, name, platform };
    })
    .filter((row) => row.id.length > 0);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/** 42 cells: 6 weeks × 7 days, starting Sunday */
function buildMonthGrid(viewMonth: Date) {
  const first = startOfMonth(viewMonth);
  const startOffset = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const cell = new Date(gridStart);
    cell.setDate(gridStart.getDate() + i);
    cells.push({
      date: cell,
      inMonth: cell.getMonth() === viewMonth.getMonth(),
    });
  }
  return cells;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function readFileAsBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve({
        base64: s.includes(",") ? s.split(",")[1] : s,
        mimeType: file.type && file.type.startsWith("image/") ? file.type : "image/jpeg",
      });
    };
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function HandoffRow({
  h,
  pos,
  total,
  isActive,
  clientName,
  onLoad,
  onSkip,
}: {
  h: ScheduleHandoff;
  pos: number;
  total: number;
  isActive: boolean;
  clientName: string;
  onLoad: (h: ScheduleHandoff) => void;
  onSkip: (id: string) => void;
}) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-xl border p-2.5 sm:p-3 transition-colors ${
        isActive
          ? "border-emerald-500/45 bg-emerald-500/[0.08] ring-1 ring-emerald-500/30"
          : "border-white/[0.08] bg-[#0a0a10]/80"
      }`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden border border-white/10 shrink-0 bg-[#12121A]">
          {h.imageUrl ? (
            <img src={h.imageUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500 text-center px-1 leading-tight">
              Preparing image…
            </div>
          )}
          <span className="absolute bottom-0.5 right-0.5 min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded bg-black/75 text-[10px] font-bold text-white tabular-nums">
            {pos}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 gap-y-0">
            <p className="text-sm font-medium text-white truncate">From {h.createdByName}</p>
            <span className="text-[10px] font-medium text-amber-400/80 tabular-nums shrink-0">
              #{pos} of {total}
            </span>
            {isActive ? (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/95 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30">
                Now in composer
              </span>
            ) : null}
          </div>
          {h.captionHint ? (
            <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{h.captionHint}</p>
          ) : (
            <p className="text-xs text-zinc-500 mt-1">
              {clientName} is pre-selected when you load this post.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={isActive || !h.imageUrl?.trim()}
          onClick={() => void onLoad(h)}
          className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-lg shadow-amber-900/20 ${
            isActive || !h.imageUrl?.trim()
              ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700"
              : "bg-gradient-to-r from-amber-600 to-orange-500 text-white hover:from-amber-500 hover:to-orange-400"
          }`}
        >
          {isActive
            ? "Loaded below"
            : !h.imageUrl?.trim()
              ? "Waiting for image"
              : "Load in composer"}
        </button>
        <button
          type="button"
          onClick={() => void onSkip(h.id)}
          className="inline-flex items-center justify-center px-3 py-2 rounded-xl border border-white/10 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05] transition-colors"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function QueueGroup({
  group,
  activeHandoffId,
  onLoad,
  onSkip,
}: {
  group: { clientKey: string; clientName: string; handoffs: ScheduleHandoff[] };
  activeHandoffId: string | null;
  onLoad: (h: ScheduleHandoff) => void;
  onSkip: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = group.handoffs.length;

  const activeIdx = group.handoffs.findIndex((h) => h.id === activeHandoffId);
  const leadIdx = activeIdx >= 0 ? activeIdx : 0;
  const lead = group.handoffs[leadIdx];
  const remaining = total - 1;

  if (!lead) return null;

  return (
    <div className="flex flex-col gap-2 pl-1 border-l-2 border-amber-500/20 ml-2">
      <HandoffRow
        h={lead}
        pos={leadIdx + 1}
        total={total}
        isActive={activeHandoffId === lead.id}
        clientName={group.clientName}
        onLoad={onLoad}
        onSkip={onSkip}
      />

      {remaining > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-[#0a0a10]/60 hover:bg-[#0a0a10] px-3 py-2.5 transition-colors group"
        >
          <div className="flex -space-x-2">
            {group.handoffs.slice(leadIdx + 1, leadIdx + 4).map((h) => (
              <div
                key={h.id}
                className="w-8 h-8 rounded-md overflow-hidden border-2 border-[#0a0a10] bg-[#12121A] shrink-0"
              >
                {h.imageUrl ? (
                  <img src={h.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon size={10} className="text-zinc-600" />
                  </div>
                )}
              </div>
            ))}
          </div>
          <span className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">
            +{remaining} more in queue
          </span>
          <ChevronDown size={14} className="text-zinc-500 group-hover:text-zinc-400 ml-auto transition-colors" />
        </button>
      )}

      {remaining > 0 && expanded && (
        <>
          {group.handoffs.map((h, idx) => {
            if (idx === leadIdx) return null;
            return (
              <HandoffRow
                key={h.id}
                h={h}
                pos={idx + 1}
                total={total}
                isActive={activeHandoffId === h.id}
                clientName={group.clientName}
                onLoad={onLoad}
                onSkip={onSkip}
              />
            );
          })}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.06] bg-[#0a0a10]/60 hover:bg-[#0a0a10] px-3 py-2 text-xs text-zinc-500 hover:text-zinc-400 transition-colors"
          >
            <ChevronDown size={14} className="rotate-180 transition-transform" />
            Collapse
          </button>
        </>
      )}
    </div>
  );
}

export default function GhlSchedulePanel() {
  const { user } = useAuth();
  const { handoffs: pendingHandoffs } = usePendingHandoffsForAssignee(user?.uid);
  const pendingHandoffsByClient = useMemo(
    () => groupPendingHandoffsByClient(pendingHandoffs),
    [pendingHandoffs]
  );
  const queueGroupsRef = useRef(pendingHandoffsByClient);
  const selectedClientIdRef = useRef("");
  const activeHandoffIdRef = useRef<string | null>(null);
  useEffect(() => {
    queueGroupsRef.current = pendingHandoffsByClient;
  }, [pendingHandoffsByClient]);

  const { accounts: firestoreAccounts, loading: fsLoading } = useFirestoreAccounts();
  const { settings } = useBusinessSettings();

  /** All CRM accounts (not only GHL-linked) so handoffs can pre-select any client. */
  const schedulerClientOptions = useMemo(() => {
    return [...firestoreAccounts].sort((a, b) =>
      (a.company || a.name || "").localeCompare(b.company || b.name || "", undefined, {
        sensitivity: "base",
      })
    );
  }, [firestoreAccounts]);

  const [selectedClientId, setSelectedClientId] = useState("");
  /** Handoff row currently loaded into the composer (queue “now” item). */
  const [activeHandoffId, setActiveHandoffId] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [scheduleImageUrl, setScheduleImageUrl] = useState<string | null>(null);
  const [scheduleImagePreview, setScheduleImagePreview] = useState<string | null>(null);
  /** Raw pixels from the file picker — caption AI uses this so we never fetch blob:/Firebase in the browser. */
  const [scheduleImageDataBase64, setScheduleImageDataBase64] = useState<string | null>(null);
  const [scheduleImageDataMimeType, setScheduleImageDataMimeType] = useState("image/jpeg");
  const [imageUploading, setImageUploading] = useState(false);
  const postImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    selectedClientIdRef.current = selectedClientId;
  }, [selectedClientId]);
  useEffect(() => {
    activeHandoffIdRef.current = activeHandoffId;
  }, [activeHandoffId]);

  const [timezone, setTimezone] = useState("America/New_York");
  const [timezoneLabel, setTimezoneLabel] = useState<string | null>(null);
  const [minGapHours, setMinGapHours] = useState(4);
  const [windowDays, setWindowDays] = useState(14);
  const [preferences, setPreferences] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [ghlAccounts, setGhlAccounts] = useState<GhlAccountRow[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedAt, setSuggestedAt] = useState<string | null>(null);
  const [suggestReason, setSuggestReason] = useState<string | null>(null);

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [dayPostCounts, setDayPostCounts] = useState<Record<string, number>>({});
  const [calendarLoading, setCalendarLoading] = useState(false);
  /** Value for `input type="datetime-local"` — manual slot without AI. */
  const [manualLocalDatetime, setManualLocalDatetime] = useState("");
  const [mediaUrlsText, setMediaUrlsText] = useState("");
  const [locationOverride, setLocationOverride] = useState("");
  const [userIdOverride, setUserIdOverride] = useState("");
  const [status, setStatus] = useState<{
    configured: boolean;
    hasEnvUserId?: boolean;
    message?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ghl/status");
        const data = (await res.json()) as { configured?: boolean; hasEnvUserId?: boolean; message?: string };
        if (cancelled) return;
        setStatus({
          configured: Boolean(data.configured),
          hasEnvUserId: data.hasEnvUserId,
          message: typeof data.message === "string" ? data.message : undefined,
        });
      } catch {
        if (!cancelled) setStatus({ configured: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveLocationId = useMemo(() => {
    const ov = locationOverride.trim();
    if (ov) return ov;
    if (!selectedClientId) return "";
    const acc = firestoreAccounts.find((a) => a.id === selectedClientId);
    return acc ? getGhlLocationId(acc) : "";
  }, [locationOverride, selectedClientId, firestoreAccounts]);

  const effectivePrivateIntegrationToken = useMemo(() => {
    if (!selectedClientId) return "";
    const acc = firestoreAccounts.find((a) => a.id === selectedClientId);
    return acc ? getGhlPrivateIntegrationToken(acc) : "";
  }, [selectedClientId, firestoreAccounts]);

  const selectedClientMissingGhl = useMemo(() => {
    if (!selectedClientId || fsLoading) return false;
    const acc = firestoreAccounts.find((a) => a.id === selectedClientId);
    return Boolean(acc && !getGhlLocationId(acc));
  }, [selectedClientId, fsLoading, firestoreAccounts]);

  const ghlAuthPayload = useMemo(() => {
    const t = effectivePrivateIntegrationToken.trim();
    return t ? { privateIntegrationToken: t } : {};
  }, [effectivePrivateIntegrationToken]);

  const userIdForApi = useMemo(() => {
    const o = userIdOverride.trim();
    if (o) return o;
    return settings.ghlDefaultUserId?.trim() ?? "";
  }, [userIdOverride, settings.ghlDefaultUserId]);

  /** Server env token / map, or per-client token from CRM — enough to call GHL. */
  const ghlApiConfigured = Boolean(
    status?.configured || effectivePrivateIntegrationToken.trim()
  );

  const canSchedulePosts = Boolean(userIdForApi);

  const mediaUrlsForSchedule = useMemo(() => {
    const fromText = mediaUrlsText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const fromImage = scheduleImageUrl ? [scheduleImageUrl] : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of [...fromImage, ...fromText]) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  }, [scheduleImageUrl, mediaUrlsText]);

  const fetchChannels = useCallback(async () => {
    if (!effectiveLocationId.trim()) return;
    setLoadingAccounts(true);
    setError(null);
    try {
      const res = await fetch("/api/ghl/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: effectiveLocationId.trim(), ...ghlAuthPayload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      const rows = extractGhlAccounts(data);
      setGhlAccounts(rows);
      setSelectedAccountIds(new Set());
      if (rows.length === 1) {
        setSelectedAccountIds(new Set([rows[0].id]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load social channels.");
      setGhlAccounts([]);
      setSelectedAccountIds(new Set());
    } finally {
      setLoadingAccounts(false);
    }
  }, [effectiveLocationId, ghlAuthPayload]);

  useEffect(() => {
    setGhlAccounts([]);
    setSelectedAccountIds(new Set());
    if (!effectiveLocationId.trim()) return;
    void fetchChannels();
  }, [effectiveLocationId, ghlAuthPayload, fetchChannels]);

  useEffect(() => {
    if (!effectiveLocationId.trim()) {
      setTimezone("America/New_York");
      setTimezoneLabel(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ghl/location-meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId: effectiveLocationId.trim(),
            ...ghlAuthPayload,
          }),
        });
        const data = (await res.json()) as { timezone?: string; name?: string };
        if (cancelled || !res.ok) return;
        if (typeof data.timezone === "string" && data.timezone.trim()) {
          setTimezone(data.timezone.trim());
        }
        setTimezoneLabel(typeof data.name === "string" && data.name.trim() ? data.name.trim() : null);
      } catch {
        if (!cancelled) setTimezoneLabel(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveLocationId, ghlAuthPayload]);

  useEffect(() => {
    if (!effectiveLocationId.trim()) {
      setDayPostCounts({});
      setCalendarLoading(false);
      return;
    }
    const from = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const to = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0, 23, 59, 59, 999);
    let cancelled = false;
    setCalendarLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/ghl/posts/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId: effectiveLocationId.trim(),
            fromDate: from.toISOString(),
            toDate: to.toISOString(),
            ...ghlAuthPayload,
          }),
        });
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const slots = (data.slots || []) as { scheduleDate?: string | null }[];
        const counts: Record<string, number> = {};
        for (const s of slots) {
          if (!s.scheduleDate) continue;
          const d = new Date(s.scheduleDate);
          if (Number.isNaN(d.getTime())) continue;
          const key = ymdLocal(d);
          counts[key] = (counts[key] || 0) + 1;
        }
        if (!cancelled) setDayPostCounts(counts);
      } catch {
        if (!cancelled) setDayPostCounts({});
      } finally {
        if (!cancelled) setCalendarLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveLocationId, viewMonth, ghlAuthPayload]);

  const monthCells = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const todayYmd = ymdLocal(new Date());
  const suggestedYmd = useMemo(() => {
    if (!suggestedAt) return null;
    const d = new Date(suggestedAt);
    return Number.isNaN(d.getTime()) ? null : ymdLocal(d);
  }, [suggestedAt]);

  const suggestedDisplay = useMemo(() => {
    if (!suggestedAt) return null;
    const d = new Date(suggestedAt);
    if (Number.isNaN(d.getTime())) {
      return { line: suggestedAt, sub: "" };
    }
    return {
      line: d.toLocaleString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      sub: timezoneLabel ? `${timezoneLabel} · ${timezone}` : timezone,
    };
  }, [suggestedAt, timezone, timezoneLabel]);

  const toggleAccount = useCallback((id: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const applyManualScheduleTime = useCallback(() => {
    if (!manualLocalDatetime.trim()) {
      setError("Choose a date and time first.");
      return;
    }
    const d = new Date(manualLocalDatetime);
    if (Number.isNaN(d.getTime())) {
      setError("That date and time is not valid.");
      return;
    }
    if (d.getTime() < Date.now() - 60_000) {
      setError("Pick a time at least a minute in the future.");
      return;
    }
    setError(null);
    setSuggestedAt(d.toISOString());
    setSuggestReason("Manual time — you chose this slot.");
    setViewMonth(startOfMonth(d));
  }, [manualLocalDatetime]);

  const handlePostImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Image should be under 15 MB.");
      return;
    }
    setImageUploading(true);
    setError(null);
    setScheduleImageUrl(null);
    setActiveHandoffId(null);
    let dataB64: string;
    let dataMime: string;
    try {
      const parsed = await readFileAsBase64(file);
      dataB64 = parsed.base64;
      dataMime = parsed.mimeType;
      setScheduleImageDataBase64(parsed.base64);
      setScheduleImageDataMimeType(parsed.mimeType);
    } catch {
      setImageUploading(false);
      setError("Couldn’t read that file. Try another image.");
      return;
    }
    if (scheduleImagePreview?.startsWith("blob:")) URL.revokeObjectURL(scheduleImagePreview);
    const local = URL.createObjectURL(file);
    setScheduleImagePreview(local);
    try {
      const id = `scheduler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
      const storageRef = ref(storage, `flow-bucket/scheduler/${id}.${ext}`);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);
      setScheduleImageUrl(url);
      setScheduleImagePreview((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return url;
      });
      setScheduleImageDataBase64(dataB64);
      setScheduleImageDataMimeType(dataMime);
    } catch {
      setScheduleImageUrl(null);
      setScheduleImageDataBase64(dataB64);
      setScheduleImageDataMimeType(dataMime);
      setError(
        "Couldn’t upload to Firebase Storage — your image stays below. Sign in, or ask an admin to allow scheduler uploads. You can also paste a public image URL under Advanced."
      );
    } finally {
      setImageUploading(false);
    }
  };

  const clearPostImage = () => {
    if (scheduleImagePreview?.startsWith("blob:")) URL.revokeObjectURL(scheduleImagePreview);
    setScheduleImagePreview(null);
    setScheduleImageUrl(null);
    setScheduleImageDataBase64(null);
    setActiveHandoffId(null);
  };

  const applyScheduleHandoff = useCallback(
    async (h: ScheduleHandoff) => {
      if (!(h.imageUrl || "").trim()) return;
      setActiveHandoffId(h.id);
      setScheduleImageDataBase64(null);
      setScheduleImagePreview((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return h.imageUrl;
      });
      setScheduleImageUrl(h.imageUrl);
      setCaption((c) => (c.trim() ? c : (h.captionHint?.trim() ?? "")));
      if (h.clientAccountId?.trim()) {
        const stillExists = firestoreAccounts.some((a) => a.id === h.clientAccountId);
        if (stillExists) setSelectedClientId(h.clientAccountId);
      }
      setSuggestedAt(null);
      setSuggestReason(null);
      setError(null);
    },
    [firestoreAccounts]
  );

  const advanceAfterSchedule = useCallback(
    async (completedId: string) => {
      try {
        await markHandoffScheduled(completedId);
      } catch {
        setError("Published to HighLevel, but we couldn’t update the handoff queue — refresh if it looks wrong.");
      }
      setSuggestedAt(null);
      setSuggestReason(null);
      const brandId =
        clientAccountIdForHandoffInQueue(queueGroupsRef.current, completedId) ||
        selectedClientIdRef.current;
      const next = pickNextHandoffForClient(queueGroupsRef.current, completedId, brandId);
      if (next) {
        await applyScheduleHandoff(next);
      } else {
        setScheduleImagePreview((prev) => {
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
          return null;
        });
        setScheduleImageUrl(null);
        setScheduleImageDataBase64(null);
        setCaption("");
        setActiveHandoffId(null);
      }
    },
    [applyScheduleHandoff]
  );

  const dismissScheduleHandoff = async (handoffId: string) => {
    if (activeHandoffId === handoffId) {
      setActiveHandoffId(null);
    }
    setError(null);
    try {
      await markHandoffDismissed(handoffId);
    } catch {
      setError("Couldn’t dismiss that handoff. Try again.");
    }
  };

  const runSuggest = useCallback(async () => {
    if (!effectiveLocationId.trim() || !caption.trim()) {
      setError("Choose a client and write something for your post.");
      return;
    }
    setSuggesting(true);
    setError(null);
    setSuggestedAt(null);
    setSuggestReason(null);
    try {
      const res = await fetch("/api/ghl/suggest-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: effectiveLocationId.trim(),
          caption: caption.trim(),
          timezone,
          minGapHours,
          windowDays,
          preferences: preferences.trim() || undefined,
          ...ghlAuthPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setSuggestedAt(data.scheduledAt as string);
      setSuggestReason(typeof data.reason === "string" ? data.reason : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggest failed.");
    } finally {
      setSuggesting(false);
    }
  }, [effectiveLocationId, caption, timezone, minGapHours, windowDays, preferences, ghlAuthPayload]);

  const runSuggestAndSchedule = useCallback(async () => {
    if (!effectiveLocationId.trim() || !caption.trim()) {
      setError("Choose a client and write something for your post.");
      return;
    }
    if (selectedAccountIds.size === 0) {
      setError("Pick at least one place to post (Facebook, Instagram, etc.).");
      return;
    }
    setSuggesting(true);
    setScheduling(true);
    setError(null);
    setSuggestedAt(null);
    setSuggestReason(null);
    try {
      const suggestRes = await fetch("/api/ghl/suggest-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: effectiveLocationId.trim(),
          caption: caption.trim(),
          timezone,
          minGapHours,
          windowDays,
          preferences: preferences.trim() || undefined,
          ...ghlAuthPayload,
        }),
      });
      const suggestData = await suggestRes.json();
      if (!suggestRes.ok) throw new Error(suggestData.error || suggestRes.statusText);
      const when = suggestData.scheduledAt as string;
      setSuggestedAt(when);
      setSuggestReason(typeof suggestData.reason === "string" ? suggestData.reason : null);

      const schedRes = await fetch("/api/ghl/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: effectiveLocationId.trim(),
          caption: caption.trim(),
          accountIds: Array.from(selectedAccountIds),
          scheduleDate: when,
          mediaUrls: mediaUrlsForSchedule.length ? mediaUrlsForSchedule : undefined,
          userId: userIdForApi || undefined,
          ...ghlAuthPayload,
        }),
      });
      const schedData = await schedRes.json();
      if (!schedRes.ok) throw new Error(schedData.error || schedRes.statusText);
      const hid = activeHandoffIdRef.current;
      if (hid) await advanceAfterSchedule(hid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Schedule failed.");
    } finally {
      setSuggesting(false);
      setScheduling(false);
    }
  }, [
    effectiveLocationId,
    caption,
    selectedAccountIds,
    mediaUrlsForSchedule,
    userIdForApi,
    timezone,
    minGapHours,
    windowDays,
    preferences,
    ghlAuthPayload,
    advanceAfterSchedule,
  ]);

  const runSchedule = useCallback(async () => {
    if (!effectiveLocationId.trim() || !caption.trim()) {
      setError("Choose a client and write something for your post.");
      return;
    }
    const when = suggestedAt?.trim();
    if (!when) {
      setError("Pick a time first — use “Suggest a time” or choose a date and time below.");
      return;
    }
    if (selectedAccountIds.size === 0) {
      setError("Pick at least one place to post.");
      return;
    }
    setScheduling(true);
    setError(null);
    try {
      const res = await fetch("/api/ghl/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: effectiveLocationId.trim(),
          caption: caption.trim(),
          accountIds: Array.from(selectedAccountIds),
          scheduleDate: when,
          mediaUrls: mediaUrlsForSchedule.length ? mediaUrlsForSchedule : undefined,
          userId: userIdForApi || undefined,
          ...ghlAuthPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setError(null);
      const hid = activeHandoffIdRef.current;
      if (hid) await advanceAfterSchedule(hid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Schedule failed.");
    } finally {
      setScheduling(false);
    }
  }, [
    effectiveLocationId,
    caption,
    suggestedAt,
    selectedAccountIds,
    mediaUrlsForSchedule,
    userIdForApi,
    ghlAuthPayload,
    advanceAfterSchedule,
  ]);

  useEffect(() => {
    if (!suggestedAt) return;
    const d = new Date(suggestedAt);
    if (Number.isNaN(d.getTime())) return;
    setViewMonth(startOfMonth(d));
  }, [suggestedAt]);

  const inputClass =
    "w-full px-4 py-3 rounded-xl bg-[#08080c] border border-[#2a2a38] text-white placeholder-zinc-600 text-sm focus:outline-none focus:border-purple-500/45 focus:ring-1 focus:ring-purple-500/20 transition-all";
  const labelClass = "text-[11px] text-zinc-500 uppercase tracking-wider font-semibold block mb-2";
  const panelClass =
    "rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#15151f] via-[#101018] to-[#0a0a0f] shadow-[0_24px_64px_-20px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.04)]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="max-w-7xl mx-auto space-y-6 pb-10"
    >
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-[11px] font-medium text-purple-300/90 mb-3">
            <Calendar size={12} className="text-purple-400" />
            AI Scheduler
          </div>
          <h3 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">Plan your social posts</h3>
          <p className="text-zinc-500 text-sm mt-2 max-w-xl leading-relaxed">
            Choose a client, add a photo and caption, pick where it should go, and let AI suggest the best time—or pick the time yourself.
          </p>
        </div>
      </div>

      {pendingHandoffs.length > 0 && (
        <div className="rounded-2xl border border-amber-500/35 bg-gradient-to-r from-amber-500/[0.09] to-orange-500/[0.05] px-4 py-4 sm:px-5 sm:py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-amber-200/95 uppercase tracking-wider flex items-center gap-2">
              <Upload size={14} className="text-amber-400" />
              Task handoff queue
            </p>
            <span className="text-xs font-semibold text-amber-100 tabular-nums">
              <span className="text-amber-400/90">{pendingHandoffs.length}</span> in queue ·{" "}
              <span className="text-amber-400/90">{pendingHandoffsByClient.length}</span> brand
              {pendingHandoffsByClient.length !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-[11px] text-amber-200/60 leading-relaxed">
            Bulk uploads from Tasks appear here by brand. One post is loaded in the composer at a time (highlighted below).
            After you <span className="text-amber-200/90">schedule in HighLevel</span>, the next image for that brand loads
            automatically until the queue is clear.
          </p>
          <div className="flex flex-col gap-4 max-h-[min(60vh,520px)] overflow-y-auto pr-1 -mr-1">
            {pendingHandoffsByClient.map((group) => (
              <div key={group.clientKey} className="space-y-2">
                <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 py-2 px-3 rounded-xl bg-[#141018] border border-amber-500/25 shadow-sm">
                  <Briefcase size={14} className="text-amber-400 shrink-0" />
                  <span className="text-sm font-semibold text-white truncate flex-1 min-w-0">
                    {group.clientName}
                  </span>
                  <span className="text-[10px] font-medium text-amber-300/90 tabular-nums shrink-0">
                    {group.handoffs.length} image{group.handoffs.length !== 1 ? "s" : ""} · FIFO
                  </span>
                </div>
                <QueueGroup
                  group={group}
                  activeHandoffId={activeHandoffId}
                  onLoad={applyScheduleHandoff}
                  onSkip={dismissScheduleHandoff}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(280px,400px)_minmax(0,1fr)] gap-6 lg:gap-8 items-start">
        {/* ── Calendar column ───────────────── */}
        <div className="space-y-4">
          <div className={`${panelClass} p-5 sm:p-6`}>
            <div className="flex items-center justify-between mb-5">
              <h4 className="text-sm font-semibold text-white tracking-tight">
                {viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </h4>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => addMonths(m, -1))}
                  className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                  aria-label="Previous month"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMonth(startOfMonth(new Date()))}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setViewMonth((m) => addMonths(m, 1))}
                  className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
                  aria-label="Next month"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-zinc-600 uppercase tracking-wider py-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1.5">
              {monthCells.map(({ date, inMonth }) => {
                const key = ymdLocal(date);
                const count = dayPostCounts[key] || 0;
                const isToday = key === todayYmd;
                const isSuggested = suggestedYmd !== null && key === suggestedYmd;
                return (
                  <div
                    key={date.getTime()}
                    className={`
                      relative aspect-square rounded-xl flex flex-col items-center justify-start pt-1.5 text-[13px] font-medium tabular-nums transition-all duration-200
                      ${inMonth ? "text-zinc-100" : "text-zinc-700"}
                      ${isToday && inMonth ? "ring-1 ring-purple-500/40 bg-purple-500/[0.12]" : ""}
                      ${isSuggested && inMonth ? "ring-2 ring-emerald-400/50 bg-gradient-to-b from-emerald-500/20 to-emerald-600/5 shadow-[0_0_24px_-6px_rgba(52,211,153,0.35)]" : ""}
                      ${inMonth && !isSuggested && !isToday ? "hover:bg-white/[0.05]" : ""}
                    `}
                  >
                    <span>{date.getDate()}</span>
                    {inMonth && count > 0 && (
                      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                        {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
                          <span
                            key={i}
                            className="h-1 w-1 rounded-full bg-violet-400"
                            style={{ opacity: 0.45 + i * 0.25 }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 pt-4 border-t border-white/[0.06] flex flex-wrap items-center gap-4 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-violet-400/80" />
                Other posts that week
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full ring-2 ring-emerald-400/60 bg-emerald-500/30" />
                Your chosen time
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded ring-1 ring-purple-500/50 bg-purple-500/20" />
                Today
              </span>
              {calendarLoading && (
                <span className="flex items-center gap-1.5 text-zinc-600">
                  <Loader size={10} className="animate-spin" /> Updating…
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-600 mt-3 leading-relaxed">
              {!effectiveLocationId.trim()
                ? "Select a client to see how busy your calendar is."
                : "The calendar is a guide: dots show other posts; the highlighted day is when this post is set to go out. You choose the time on the right."}
            </p>
          </div>

          {suggestedDisplay && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`${panelClass} p-5 overflow-hidden relative`}
            >
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />
              <p className="text-[11px] font-semibold text-emerald-400/90 uppercase tracking-wider mb-2">When it will post</p>
              <p className="text-lg font-semibold text-white leading-snug">{suggestedDisplay.line}</p>
              {suggestedDisplay.sub && <p className="text-xs text-zinc-500 mt-1">{suggestedDisplay.sub}</p>}
              {suggestReason && <p className="text-sm text-zinc-400 mt-3 leading-relaxed border-t border-white/[0.06] pt-3">{suggestReason}</p>}
              <button
                type="button"
                onClick={runSchedule}
                disabled={scheduling || !canSchedulePosts || selectedAccountIds.size === 0}
                className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20 hover:from-emerald-500 hover:to-teal-400 disabled:opacity-50 transition-all"
              >
                {scheduling ? <Loader size={16} className="animate-spin" /> : null}
                Schedule this post
              </button>
            </motion.div>
          )}
        </div>

        {/* ── Composer column ───────────────── */}
        <div className={`${panelClass} p-6 sm:p-7 space-y-6`}>
          <div>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">Client</p>
            <label className={labelClass}>Who is this post for?</label>
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              disabled={fsLoading}
              className={inputClass}
            >
              <option value="">{fsLoading ? "Loading…" : "— Choose a client —"}</option>
              {schedulerClientOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.company || a.name}
                  {!getGhlLocationId(a) ? " · (no GHL linked)" : ""}
                </option>
              ))}
            </select>
            {!fsLoading && schedulerClientOptions.length === 0 && (
              <p className="text-xs text-amber-400/90 mt-2">
                No clients in Accounts yet. Add clients under Accounts to schedule posts.
              </p>
            )}
            {selectedClientMissingGhl && (
              <p className="text-xs text-amber-400/90 mt-2">
                This client has no GoHighLevel location on file — add it in Accounts to load the calendar and publish.
              </p>
            )}
          </div>

          <div>
            <label className={labelClass}>Post caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              placeholder="Optional draft or notes — AI can use this with your post image."
              className={`${inputClass} resize-y min-h-[100px]`}
            />
          </div>

          <div>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-3">Photo for this post</p>
            <input
              ref={postImageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handlePostImage(f);
              }}
            />
            {!scheduleImagePreview ? (
              <button
                type="button"
                onClick={() => postImageInputRef.current?.click()}
                disabled={imageUploading}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-dashed border-[#2a2a38] hover:border-purple-500/35 text-sm text-zinc-400 hover:text-zinc-200 transition-all disabled:opacity-50"
              >
                {imageUploading ? <Loader size={18} className="animate-spin text-purple-400" /> : <Upload size={18} />}
                Upload an image
              </button>
            ) : (
              <div className="flex items-start gap-3">
                <div className="relative w-28 h-28 rounded-xl overflow-hidden border border-[#2a2a38] bg-black/30 shrink-0">
                  <img src={scheduleImagePreview} alt="" className="w-full h-full object-cover" />
                  {imageUploading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader size={20} className="text-purple-400 animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => postImageInputRef.current?.click()}
                    disabled={imageUploading}
                    className="text-xs text-purple-300 hover:text-purple-200 text-left"
                  >
                    Replace image
                  </button>
                  <button
                    type="button"
                    onClick={clearPostImage}
                    className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    <X size={12} /> Remove
                  </button>
                </div>
              </div>
            )}
            <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed">
              Task handoffs fill this automatically. The same image is analyzed for AI captions below — no second upload.
            </p>
          </div>

          <div>
            <CaptionGeneratorMini
              accountId={selectedClientId || null}
              postImageUrl={scheduleImagePreview}
              postImageDataBase64={scheduleImageDataBase64}
              postImageDataMimeType={scheduleImageDataMimeType}
              topicHint={caption}
              onApplyCaption={(text) => setCaption(text)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchChannels()}
              disabled={loadingAccounts || !effectiveLocationId.trim()}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-zinc-200 hover:bg-white/[0.07] disabled:opacity-50 transition-all"
            >
              {loadingAccounts ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Refresh social pages
            </button>
            {loadingAccounts && effectiveLocationId ? (
              <span className="text-[10px] text-zinc-600">Finding connected pages…</span>
            ) : null}
          </div>

          {ghlAccounts.length > 0 && (
            <div>
              <label className={labelClass}>Where should it post?</label>
              <div className="space-y-1 max-h-52 overflow-y-auto rounded-xl border border-white/[0.06] p-2 bg-black/25">
                {ghlAccounts.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-3 text-sm text-zinc-200 cursor-pointer rounded-lg px-3 py-2.5 hover:bg-white/[0.04] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAccountIds.has(a.id)}
                      onChange={() => toggleAccount(a.id)}
                      className="rounded border-zinc-600 accent-purple-500"
                    />
                    <span className="flex-1">{a.name}</span>
                    {a.platform && <span className="text-xs text-zinc-500">{a.platform}</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
          >
            {showAdvanced ? "▼" : "▶"} Fine-tune timing (optional)
          </button>

          {showAdvanced && (
            <div className="space-y-4 rounded-xl border border-white/[0.06] bg-black/20 p-4">
              <p className="text-[10px] text-zinc-600">
                Time zone comes from your client’s profile when available.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelClass}>Time zone</label>
                  <input type="text" value={timezone} readOnly className={`${inputClass} opacity-80 cursor-not-allowed`} />
                </div>
                <div>
                  <label className={labelClass}>Space from other posts (hours)</label>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={minGapHours}
                    onChange={(e) => setMinGapHours(Number(e.target.value) || 4)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>How far ahead to look (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={windowDays}
                    onChange={(e) => setWindowDays(Number(e.target.value) || 14)}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Notes for the assistant (optional)</label>
                <input
                  type="text"
                  value={preferences}
                  onChange={(e) => setPreferences(e.target.value)}
                  placeholder="e.g. Weekday mornings only"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-white/[0.06] bg-black/15 px-4 py-4 space-y-3">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Pick your own date &amp; time</p>
            <label className={labelClass}>Date and time</label>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <input
                type="datetime-local"
                value={manualLocalDatetime}
                onChange={(e) => setManualLocalDatetime(e.target.value)}
                disabled={!effectiveLocationId.trim()}
                className={`${inputClass} sm:flex-1 text-xs`}
              />
              <button
                type="button"
                onClick={applyManualScheduleTime}
                disabled={!effectiveLocationId.trim() || !manualLocalDatetime.trim()}
                className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white/[0.08] border border-white/[0.12] text-sm font-medium text-zinc-100 hover:bg-white/[0.12] disabled:opacity-45 transition-all shrink-0"
              >
                Use this time
              </button>
            </div>
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              Sets the time on the calendar yourself—then tap Schedule this post.
            </p>
          </div>

          {!canSchedulePosts && (
            <p className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
              Scheduling needs a quick one-time setup. Ask your admin to finish it in Settings.
            </p>
          )}

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              onClick={runSuggestAndSchedule}
              disabled={
                suggesting || scheduling || !canSchedulePosts || selectedAccountIds.size === 0 || !effectiveLocationId.trim()
              }
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-sm font-semibold text-white shadow-lg shadow-emerald-950/40 hover:from-emerald-500 hover:to-teal-400 disabled:opacity-50 transition-all"
            >
              {suggesting || scheduling ? <Loader size={16} className="animate-spin" /> : null}
              Suggest time &amp; schedule
            </button>
            <button
              type="button"
              onClick={runSuggest}
              disabled={suggesting || !effectiveLocationId.trim()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-violet-500 text-sm font-semibold text-white shadow-lg shadow-purple-950/30 hover:from-purple-500 hover:to-violet-400 disabled:opacity-50 transition-all"
            >
              {suggesting ? <Loader size={16} className="animate-spin" /> : null}
              Suggest a time only
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 leading-relaxed">
            When a time shows on the left, tap <span className="text-zinc-400">Schedule this post</span> to finish.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
