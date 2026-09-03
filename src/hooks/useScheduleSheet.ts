import { useCallback, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../lib/firebase";
import { authedFetch } from "../lib/api";
import type { FirestoreAccount } from "./useFirestore";

/** Hard ceiling for one sheet — big batches (40–200 posts) are the whole point. */
export const MAX_SHEET_ROWS = 200;

const CAPTION_CONCURRENCY = 3;
const SCHEDULE_CONCURRENCY = 3;

export type SheetRowStatus =
  | "draft"
  | "captioning"
  | "uploading"
  | "scheduling"
  | "scheduled"
  | "failed";

/** One spreadsheet line: Date | Caption | Image. */
export interface SheetRow {
  id: string;
  /** Local pixels, kept as a File so 40+ images never sit in memory as base64. */
  file: File | null;
  fileName: string;
  /** Object URL (local) or the uploaded download URL once it exists. */
  previewUrl: string;
  /** Public URL handed to HighLevel. Filled on first upload, reused on retry. */
  imageUrl: string | null;
  /** `input[type=datetime-local]` value — "YYYY-MM-DDTHH:mm". */
  dateLocal: string;
  caption: string;
  /** Menu item the vision pass matched this image to (null = no confident match). */
  menuMatch: string | null;
  status: SheetRowStatus;
  error: string | null;
}

export type SheetPhase = "idle" | "captioning" | "scheduling" | "done";

export interface SheetGhlConfig {
  locationId: string;
  privateIntegrationToken: string;
  accountIds: string[];
  userId: string;
}

export interface MenuContextItem {
  name: string;
  category: string;
  description?: string | null;
}

export interface SheetCaptionConfig {
  account: FirestoreAccount;
  /** The brand's menu, so each image is captioned as the dish it actually is. */
  menuItems: MenuContextItem[];
  platform: string;
  captionStyle: string;
  includeHashtags: boolean;
  includeEmojis: boolean;
}

export interface AutofillConfig {
  /** "YYYY-MM-DDTHH:mm" — first day considered. */
  startLocal: string;
  /** Weekdays that may receive posts (0=Sun … 6=Sat). A closed day is simply unchecked. */
  weekdays: number[];
  /** 1 = every qualifying week, 2 = every other week, … */
  everyNWeeks: number;
  /** "HH:mm" slots used on each posting day, in order. */
  times: string[];
  /** Skip the holidays most restaurants close for. */
  skipHolidays: boolean;
  /** Extra "YYYY-MM-DD" closures (private events, vacations). */
  blackoutDates: string[];
}

/** A date the fill deliberately stepped over, so the UI can say why. */
export interface SkippedDate {
  date: string;
  name: string;
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Days since the epoch in LOCAL time — DST-safe basis for week arithmetic. */
function dayNumber(d: Date): number {
  return Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(1970, 0, 1).getTime()) /
      86_400_000
  );
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}

/** Anonymous Gregorian computus. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Days a US restaurant is typically closed or shouldn't be posting a normal promo.
 * Deliberately not every federal holiday — banks close on Columbus Day, restaurants don't.
 */
export function usHolidayMap(fromYear: number, toYear: number): Map<string, string> {
  const map = new Map<string, string>();
  for (let y = fromYear; y <= toYear; y++) {
    const add = (d: Date, name: string) => map.set(ymdLocal(d), name);
    add(new Date(y, 0, 1), "New Year's Day");
    add(easterSunday(y), "Easter Sunday");
    add(lastWeekdayOfMonth(y, 4, 1), "Memorial Day");
    add(new Date(y, 6, 4), "Independence Day");
    add(nthWeekdayOfMonth(y, 8, 1, 1), "Labor Day");
    add(nthWeekdayOfMonth(y, 10, 4, 4), "Thanksgiving");
    add(new Date(y, 11, 24), "Christmas Eve");
    add(new Date(y, 11, 25), "Christmas Day");
  }
  return map;
}

export interface SheetCommitSummary {
  scheduled: number;
  failed: { fileName: string; error: string }[];
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Date → `input[type=datetime-local]` value in the browser's local zone. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

export function parseLocalInput(value: string): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Lenient parser for values pasted out of Google Sheets / Excel, which arrive in
 * whatever the source locale used ("9/1/2026 11:00 AM", "2026-09-01 11:00", …).
 * Returns a datetime-local string, or "" when the text isn't a date at all.
 */
export function parsePastedDate(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  // Already in datetime-local shape.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.slice(0, 16);
  // A bare "2026-09-01" is parsed as UTC midnight by Date(), which lands on the
  // previous day west of Greenwich — keep the day the user typed.
  const bareIso = /^(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (bareIso) return `${bareIso[1]}T00:00`;
  // "2026-09-01 11:00" → swap the separator so Date() treats it as local, not UTC.
  const isoish = text.replace(/^(\d{4}-\d{2}-\d{2})[ ]+(\d{1,2}:\d{2})/, "$1T$2");
  const direct = new Date(isoish);
  if (!Number.isNaN(direct.getTime())) return toLocalInput(direct);
  return "";
}

/**
 * Longest edge sent to the vision model. Identifying a dish and matching it to a menu
 * needs far less resolution than publishing does, and image tokens — not the model tier —
 * dominate the cost of a 40-image batch. The ORIGINAL file is still what gets uploaded
 * and posted; this downscale only ever feeds the AI.
 */
const ANALYSIS_MAX_EDGE = 1024;
/** Below this, re-encoding costs more than it saves. */
const ANALYSIS_SKIP_BYTES = 400_000;

export async function fileToAnalysisBase64(
  file: File
): Promise<{ base64: string; mimeType: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, ANALYSIS_MAX_EDGE / longest);
    if (scale === 1 && file.size < ANALYSIS_SKIP_BYTES) {
      bitmap.close?.();
      return fileToBase64(file);
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return fileToBase64(file);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : "";
    if (!base64) return fileToBase64(file);
    return { base64, mimeType: "image/jpeg" };
  } catch {
    // Decode/canvas failure (exotic format, tainted canvas) — send the original.
    return fileToBase64(file);
  }
}

export function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve({
        base64: s.includes(",") ? s.split(",")[1]! : s,
        mimeType: file.type?.startsWith("image/") ? file.type : "image/jpeg",
      });
    };
    r.onerror = () => reject(new Error("Could not read that image."));
    r.readAsDataURL(file);
  });
}

/**
 * Build `count` posting slots from the autofill rules. Days that fall outside the
 * cadence (or on a weekend when skipping) are passed over, and slots already in the
 * past are dropped so nothing is scheduled behind "now".
 */
export function buildSlots(
  cfg: AutofillConfig,
  count: number
): { slots: Date[]; skipped: SkippedDate[] } {
  const start = parseLocalInput(cfg.startLocal) ?? new Date();
  const times = cfg.times.length
    ? cfg.times
    : [`${pad2(start.getHours())}:${pad2(start.getMinutes())}`];
  const weekdays = new Set(cfg.weekdays);
  const everyN = Math.max(1, Math.floor(cfg.everyNWeeks) || 1);
  const slots: Date[] = [];
  const skipped: SkippedDate[] = [];
  if (!weekdays.size) return { slots, skipped };

  const first = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const holidays = cfg.skipHolidays
    ? usHolidayMap(first.getFullYear(), first.getFullYear() + 3)
    : new Map<string, string>();
  const blackout = new Set(cfg.blackoutDates);
  // Anchored to the FIRST qualifying day, so "every other week" never silently
  // pushes the opening post out by a week.
  let anchorWeek: number | null = null;

  // Guard: 3 years is far past any real batch.
  for (let i = 0; i < 1100 && slots.length < count; i++) {
    const day = new Date(first);
    day.setDate(first.getDate() + i);
    if (!weekdays.has(day.getDay())) continue;

    const week = Math.floor(dayNumber(day) / 7);
    if (anchorWeek === null) anchorWeek = week;
    if ((week - anchorWeek) % everyN !== 0) continue;

    const ymd = ymdLocal(day);
    if (blackout.has(ymd)) {
      skipped.push({ date: ymd, name: "Closed" });
      continue;
    }
    const holiday = holidays.get(ymd);
    if (holiday) {
      skipped.push({ date: ymd, name: holiday });
      continue;
    }

    for (const t of times) {
      const [h, m] = t.split(":");
      const slot = new Date(day);
      slot.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
      if (slot.getTime() > Date.now() && slot.getTime() >= start.getTime()) {
        slots.push(slot);
        if (slots.length >= count) break;
      }
    }
  }
  return { slots, skipped };
}

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/#[\w]+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first few words — the "opening move" that makes a bulk batch feel templated. */
function openingKey(s: string): string {
  return normalizeForCompare(s).split(" ").slice(0, 4).join(" ");
}

function tokenSet(s: string): Set<string> {
  return new Set(normalizeForCompare(s).split(" ").filter((w) => w.length > 3));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * The caption endpoint returns several variations; taking the first one is what makes
 * a batch drift into a single formula. Pick whichever least resembles what this batch
 * has already used, weighting a repeated opening heavily since it's the most visible.
 */
export function pickFreshest(candidates: string[], used: string[]): string {
  const fallback = candidates[0] ?? "";
  if (!used.length) return fallback;
  const usedTokens = used.map(tokenSet);
  const usedOpenings = new Set(used.map(openingKey));
  let best = fallback;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const t = tokenSet(candidate);
    const maxSimilarity = usedTokens.reduce((m, u) => Math.max(m, jaccard(t, u)), 0);
    const score = maxSimilarity + (usedOpenings.has(openingKey(candidate)) ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Sheet model behind the bulk scheduler grid: rows of Date | Caption | Image, an AI
 * caption pass, and a commit that uploads each image once and creates one HighLevel
 * post per row. Rows keep their own status so a partial failure can be retried
 * without re-posting the ones that already landed.
 */
export function useScheduleSheet() {
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [phase, setPhase] = useState<SheetPhase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  /** Informational result of the last fill (dates covered, closures skipped). */
  const [notice, setNotice] = useState<string | null>(null);
  /** Mirror of `rows` so async loops read current values without stale closures. */
  const rowsRef = useRef<SheetRow[]>([]);
  const batchIdRef = useRef<string>(uuidv4());

  const writeRows = useCallback((next: SheetRow[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const patchRow = useCallback((id: string, patch: Partial<SheetRow>) => {
    writeRows(rowsRef.current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, [writeRows]);

  const addFiles = useCallback(
    (files: File[]): number => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      const room = MAX_SHEET_ROWS - rowsRef.current.length;
      const accepted = images.slice(0, Math.max(0, room));
      if (!accepted.length) return 0;
      const next: SheetRow[] = accepted.map((file) => ({
        id: uuidv4(),
        file,
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
        imageUrl: null,
        dateLocal: "",
        caption: "",
        menuMatch: null,
        status: "draft",
        error: null,
      }));
      writeRows([...rowsRef.current, ...next]);
      if (accepted.length < images.length) {
        setError(`Only ${MAX_SHEET_ROWS} rows fit in one sheet — ${images.length - accepted.length} image(s) were left out.`);
      }
      return accepted.length;
    },
    [writeRows]
  );

  /** Swap the image on an existing row, keeping its date and caption. */
  const replaceImage = useCallback(
    (id: string, file: File) => {
      const row = rowsRef.current.find((r) => r.id === id);
      if (!row || !file.type.startsWith("image/")) return;
      if (row.previewUrl.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl);
      patchRow(id, {
        file,
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
        imageUrl: null,
        status: row.status === "scheduled" ? "draft" : row.status,
        error: null,
      });
    },
    [patchRow]
  );

  const setCell = useCallback(
    (id: string, field: "dateLocal" | "caption", value: string) => {
      const row = rowsRef.current.find((r) => r.id === id);
      if (!row) return;
      patchRow(id, {
        [field]: value,
        // Editing a failed row clears the stale error so the status column stays honest.
        ...(row.status === "failed" ? { status: "draft" as const, error: null } : {}),
      });
    },
    [patchRow]
  );

  /** Write a block of values down a column, starting at `startIndex` (clipboard spill). */
  const setColumnFrom = useCallback(
    (startIndex: number, field: "dateLocal" | "caption", values: string[]) => {
      const next = rowsRef.current.map((r, i) => {
        const v = values[i - startIndex];
        if (i < startIndex || v === undefined) return r;
        return { ...r, [field]: v, ...(r.status === "failed" ? { status: "draft" as const, error: null } : {}) };
      });
      writeRows(next);
    },
    [writeRows]
  );

  const removeRow = useCallback(
    (id: string) => {
      const row = rowsRef.current.find((r) => r.id === id);
      if (row?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl);
      writeRows(rowsRef.current.filter((r) => r.id !== id));
    },
    [writeRows]
  );

  const moveRow = useCallback(
    (id: string, delta: number) => {
      const list = [...rowsRef.current];
      const from = list.findIndex((r) => r.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved!);
      writeRows(list);
    },
    [writeRows]
  );

  /** Batches are usually exported in order, so filename sort restores the intended sequence. */
  const sortByFileName = useCallback(() => {
    writeRows(
      [...rowsRef.current].sort((a, b) =>
        a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: "base" })
      )
    );
  }, [writeRows]);

  const autofillDates = useCallback(
    (cfg: AutofillConfig) => {
      const targets = rowsRef.current.filter((r) => r.status !== "scheduled");
      const { slots, skipped } = buildSlots(cfg, targets.length);
      if (!slots.length) {
        setNotice(null);
        setError(
          cfg.weekdays.length === 0
            ? "Pick at least one day of the week to post on."
            : "Those rules produced no future dates — check the start date and times."
        );
        return;
      }
      const byId = new Map(targets.map((r, i) => [r.id, slots[i]] as const));
      writeRows(
        rowsRef.current.map((r) => {
          const slot = byId.get(r.id);
          return slot ? { ...r, dateLocal: toLocalInput(slot) } : r;
        })
      );

      const fmt = (d: Date) =>
        d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      const parts = [
        `Filled ${slots.length} row${slots.length !== 1 ? "s" : ""}: ${fmt(slots[0]!)} → ${fmt(slots[slots.length - 1]!)}.`,
      ];
      if (skipped.length) {
        const shown = skipped.slice(0, 4).map((s) => `${s.name} (${s.date})`);
        parts.push(
          `Skipped ${skipped.length} closed date${skipped.length !== 1 ? "s" : ""}: ${shown.join(", ")}${
            skipped.length > shown.length ? `, +${skipped.length - shown.length} more` : ""
          }.`
        );
      }
      setNotice(parts.join(" "));
      setError(
        slots.length < targets.length
          ? `${targets.length - slots.length} row(s) left unfilled — add more posting days or times.`
          : null
      );
    },
    [writeRows]
  );

  const clearAll = useCallback(() => {
    for (const r of rowsRef.current) {
      if (r.previewUrl.startsWith("blob:")) URL.revokeObjectURL(r.previewUrl);
    }
    writeRows([]);
    setPhase("idle");
    setProgress({ done: 0, total: 0 });
    setError(null);
    batchIdRef.current = uuidv4();
  }, [writeRows]);

  /** Draft a brand-voice caption for every row that doesn't already have one. */
  const generateCaptions = useCallback(
    async (cfg: SheetCaptionConfig, opts: { overwrite: boolean }) => {
      const targets = rowsRef.current.filter(
        (r) => r.status !== "scheduled" && r.file && (opts.overwrite || !r.caption.trim())
      );
      if (!targets.length) {
        setError("Every row already has a caption — tick “overwrite” to redo them.");
        return;
      }
      setError(null);
      setPhase("captioning");
      setProgress({ done: 0, total: targets.length });
      let done = 0;

      const brandContext = {
        company: cfg.account.company,
        industry: cfg.account.industry,
        description: cfg.account.description,
        brandVoice: cfg.account.brandVoice,
        targetAudience: cfg.account.targetAudience,
        socialHandles: cfg.account.socialHandles,
        website: cfg.account.website,
      };

      // Shared across the batch so each caption is written against what came before —
      // seeded with captions already in the sheet so those aren't echoed either.
      const used: string[] = rowsRef.current
        .filter((r) => !targets.some((t) => t.id === r.id))
        .map((r) => r.caption.trim())
        .filter(Boolean);

      await mapWithConcurrency(targets, CAPTION_CONCURRENCY, async (row) => {
        try {
          patchRow(row.id, { status: "captioning", error: null });
          // Downscaled copy — used for BOTH AI calls; the post still carries the original.
          const { base64, mimeType } = await fileToAnalysisBase64(row.file!);

          // 1) Look at the image and match it against the brand's menu.
          let menuMatch: string | null = null;
          let topic: string | undefined;
          try {
            const aRes = await authedFetch("/api/content/analyze-asset", {
              method: "POST",
              body: JSON.stringify({
                imageBase64: base64,
                imageMimeType: mimeType,
                menuItems: cfg.menuItems,
              }),
            });
            const analysis = await aRes.json().catch(() => null);
            if (aRes.ok && analysis) {
              menuMatch = analysis.menuMatch || null;
              const parts = [menuMatch || analysis.name, analysis.description].filter(Boolean);
              topic = parts.length ? parts.join(" · ") : undefined;
            }
          } catch {
            // Analysis is an enhancement — a caption from the raw image still beats failing.
          }
          patchRow(row.id, { menuMatch });

          // 2) Craft the caption, told what the batch has already used.
          const res = await authedFetch("/api/content/generate-caption", {
            method: "POST",
            body: JSON.stringify({
              brandContext,
              media: [{ base64, mimeType }],
              platform: cfg.platform,
              captionStyle: cfg.captionStyle,
              includeHashtags: cfg.includeHashtags,
              includeEmojis: cfg.includeEmojis,
              topic,
              avoidCaptions: used.slice(-12),
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error || "Caption generation failed.");
          const list: string[] = Array.isArray(data?.captions) ? data.captions : [];
          const candidates = list.map((c) => (c || "").trim()).filter(Boolean);
          if (!candidates.length) throw new Error("No caption returned.");
          // 3) Of the variations offered, keep the one least like the rest of the batch.
          const caption = pickFreshest(candidates, used);
          used.push(caption);
          patchRow(row.id, { status: "draft", caption });
        } catch (e) {
          // Keep the stack reachable — the row only has room for the message.
          console.error("[ScheduleSheet] caption failed", row.fileName, e);
          patchRow(row.id, {
            status: "failed",
            error: e instanceof Error ? e.message : "Caption failed.",
          });
        } finally {
          done += 1;
          setProgress({ done, total: targets.length });
        }
      });

      setPhase("idle");
    },
    [patchRow]
  );

  /** Rows that are complete enough to send to HighLevel. */
  const readyRowIds = useCallback((): string[] => {
    return rowsRef.current
      .filter(
        (r) =>
          r.status !== "scheduled" &&
          r.caption.trim().length > 0 &&
          !!parseLocalInput(r.dateLocal) &&
          (!!r.file || !!r.imageUrl)
      )
      .map((r) => r.id);
  }, []);

  /**
   * Upload each pending image once, then create one HighLevel post per row.
   * Already-scheduled rows are skipped, so re-running only retries the stragglers.
   */
  const scheduleAll = useCallback(
    async (cfg: SheetGhlConfig): Promise<SheetCommitSummary> => {
      const summary: SheetCommitSummary = { scheduled: 0, failed: [] };
      if (!cfg.locationId.trim()) throw new Error("Pick a brand with a HighLevel location first.");
      if (!cfg.accountIds.length) throw new Error("Pick at least one channel to post to.");
      if (!cfg.userId.trim()) {
        throw new Error("Missing the HighLevel user id — set a default in Settings before scheduling.");
      }

      const ids = new Set(readyRowIds());
      const targets = rowsRef.current.filter((r) => ids.has(r.id));
      if (!targets.length) return summary;

      setError(null);
      setPhase("scheduling");
      setProgress({ done: 0, total: targets.length });
      let done = 0;
      const auth = cfg.privateIntegrationToken.trim()
        ? { privateIntegrationToken: cfg.privateIntegrationToken.trim() }
        : {};

      await mapWithConcurrency(targets, SCHEDULE_CONCURRENCY, async (row) => {
        try {
          let imageUrl = row.imageUrl;
          if (!imageUrl) {
            patchRow(row.id, { status: "uploading", error: null });
            const file = row.file;
            if (!file) throw new Error("This row lost its image — re-add the photo and try again.");
            const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
            const path = `flow-bucket/scheduler/sheet/${batchIdRef.current}/${row.id}.${ext}`;
            const storageRef = ref(storage, path);
            await uploadBytes(storageRef, file, { contentType: file.type });
            imageUrl = await getDownloadURL(storageRef);
            // Persist the URL so a retry after a GHL error doesn't re-upload.
            patchRow(row.id, { imageUrl });
          }

          patchRow(row.id, { status: "scheduling" });
          const when = parseLocalInput(row.dateLocal);
          if (!when) throw new Error("This row's date is empty or invalid.");
          const res = await authedFetch("/api/ghl/schedule", {
            method: "POST",
            body: JSON.stringify({
              locationId: cfg.locationId.trim(),
              caption: row.caption.trim(),
              accountIds: cfg.accountIds,
              scheduleDate: when.toISOString(),
              mediaUrls: [imageUrl],
              userId: cfg.userId.trim(),
              ...auth,
            }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error || res.statusText || "HighLevel rejected the post.");
          patchRow(row.id, { status: "scheduled", error: null });
          summary.scheduled += 1;
        } catch (e) {
          const message = e instanceof Error ? e.message : "Could not schedule this post.";
          // Keep the stack reachable — the row only has room for the message.
          console.error("[ScheduleSheet] schedule failed", row.fileName, e);
          patchRow(row.id, { status: "failed", error: message });
          summary.failed.push({ fileName: row.fileName, error: message });
        } finally {
          done += 1;
          setProgress({ done, total: targets.length });
        }
      });

      setPhase("done");
      return summary;
    },
    [patchRow, readyRowIds]
  );

  return {
    rows,
    phase,
    progress,
    error,
    setError,
    notice,
    setNotice,
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
  };
}
