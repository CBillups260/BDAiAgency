/**
 * Bulk schedule planner — spreads N images across a window, each used `usesPerImage`
 * times, keeping the copies of one image far apart and similar images (same
 * `similarityKey`, e.g. two "wings" photos) from landing close together.
 *
 * Pure & deterministic (inject `nowMs` to test) — no GHL/network/Intl deps. The
 * caller resolves the target-timezone offset and passes it as `tzOffsetMinutes`.
 */

export interface BulkScheduleItem {
  /** Stable id the caller uses to map results back to an image. */
  id: string;
  /** Items sharing this key are "similar" and get spaced apart (menuMatch || category || firstTag). */
  similarityKey: string;
}

export interface PlanBulkScheduleOptions {
  /** Length of the spread window in days (a "quarter" = ~90). Clamped to [7, 120]. */
  windowDays?: number;
  /** How many times each image is posted across the window. Clamped to [1, 4]. */
  usesPerImage?: number;
  /** Earliest posting hour (target-tz wall clock). */
  dayStartHour?: number;
  /** Latest posting hour (target-tz wall clock). */
  dayEndHour?: number;
  /** Hard minimum spacing (days) between two posts that share a similarityKey. */
  minSimilarGapDays?: number;
  /** Minimum spacing (hours) versus already-scheduled GHL posts and our own posts. */
  minGapHours?: number;
  /** ISO instants of existing GHL posts in the window — avoided by nudging forward. */
  existingSlotsIso?: string[];
  /** Target timezone offset in minutes (local − UTC), e.g. America/New_York in summer = -240. */
  tzOffsetMinutes?: number;
  /** Injected "now" for deterministic tests. Defaults to Date.now(). */
  nowMs?: number;
}

export interface BulkScheduleResult {
  itemId: string;
  /** ISO-8601 instants (UTC `Z`), ascending, length === usesPerImage. */
  occurrences: string[];
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Order items so that ones sharing a similarityKey are interleaved as far apart as
 * possible — the classic "reorganize string" greedy: always emit from the group with
 * the most remaining items whose key differs from the one just placed.
 */
function spreadOrder(items: BulkScheduleItem[]): BulkScheduleItem[] {
  const groups = new Map<string, BulkScheduleItem[]>();
  for (const it of items) {
    const key = it.similarityKey || "misc";
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }

  // Stable order of keys (by remaining count desc, then key name) so output is deterministic.
  const result: BulkScheduleItem[] = [];
  let lastKey: string | null = null;
  while (result.length < items.length) {
    const candidates = [...groups.entries()].filter(([, arr]) => arr.length > 0);
    candidates.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    // Prefer the largest group whose key differs from the last placed; fall back if forced.
    const pick = candidates.find(([key]) => key !== lastKey) ?? candidates[0];
    const [key, arr] = pick;
    result.push(arr.shift()!);
    lastKey = key;
  }
  return result;
}

/** UTC instant whose target-tz wall clock is `hour:minute` on the local date of `baseMs`. */
function instantAtLocalHour(baseMs: number, tzOffsetMinutes: number, hour: number, minute: number): number {
  const local = new Date(baseMs + tzOffsetMinutes * 60000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  return Date.UTC(y, m, d, hour, minute) - tzOffsetMinutes * 60000;
}

/** Rotating high-engagement posting hours within the allowed window. */
function hourForSlot(index: number, startHour: number, endHour: number): number {
  const palette = [11, 13, 17, 19].filter((h) => h >= startHour && h <= endHour);
  const hours = palette.length ? palette : [Math.round((startHour + endHour) / 2)];
  return hours[index % hours.length]!;
}

/**
 * Plan the full schedule. Returns one entry per input item with `usesPerImage`
 * ascending ISO instants.
 */
export function planBulkSchedule(
  items: BulkScheduleItem[],
  opts: PlanBulkScheduleOptions = {}
): BulkScheduleResult[] {
  const n = items.length;
  if (n === 0) return [];

  const uses = clamp(Math.round(opts.usesPerImage ?? 2), 1, 4);
  const windowDays = clamp(Math.round(opts.windowDays ?? 90), 7, 120);
  const startHour = clamp(opts.dayStartHour ?? 10, 0, 23);
  const endHour = clamp(opts.dayEndHour ?? 20, startHour, 23);
  const minSimilarGapMs = clamp(opts.minSimilarGapDays ?? 7, 0, windowDays) * DAY_MS;
  const minGapMs = clamp(opts.minGapHours ?? 4, 0, 72) * HOUR_MS;
  const tzOffset = Number.isFinite(opts.tzOffsetMinutes) ? (opts.tzOffsetMinutes as number) : 0;
  const now = opts.nowMs ?? Date.now();

  const totalPosts = n * uses;
  // Start tomorrow, end at the window edge; leave a little headroom at the end.
  const startMs = now + DAY_MS;
  const endMs = now + windowDays * DAY_MS;
  const span = Math.max(DAY_MS, endMs - startMs);

  // Even grid of slot instants, snapped to a business hour and de-duped against existing posts.
  const existingMs = (opts.existingSlotsIso ?? [])
    .map((s) => Date.parse(s))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);

  type Slot = { ms: number; key: string };
  const slots: Slot[] = new Array(totalPosts);

  // Interleaved item order (same key spaced apart); copy u of order-position p → slot p + u*n.
  const order = spreadOrder(items);

  for (let i = 0; i < totalPosts; i++) {
    const fraction = (i + 0.5) / totalPosts;
    const rawMs = startMs + fraction * span;
    const hour = hourForSlot(i, startHour, endHour);
    const minute = i % 2 === 0 ? 0 : 30;
    const ms = instantAtLocalHour(rawMs, tzOffset, hour, minute);
    slots[i] = { ms, key: "" };
  }

  // Map each occurrence to a slot and remember which item/key owns it.
  // assignment[slotIndex] = { itemId, occurrence }
  const assignment: { itemId: string; occ: number }[] = new Array(totalPosts);
  for (let u = 0; u < uses; u++) {
    for (let p = 0; p < n; p++) {
      const slotIndex = p + u * n;
      const item = order[p]!;
      slots[slotIndex]!.key = item.similarityKey || "misc";
      assignment[slotIndex] = { itemId: item.id, occ: u };
    }
  }

  // Time-order pass: enforce min global gap, min similar-key gap, and avoid existing posts.
  // We walk slots in chronological order and push any conflicting slot forward.
  const orderByTime = slots.map((s, idx) => ({ idx, ms: s.ms, key: s.key })).sort((a, b) => a.ms - b.ms);

  let prevMs = -Infinity;
  // Track the last time we placed each similarity key so we can enforce minSimilarGapMs.
  const lastKeyMs = new Map<string, number>();
  let existingPtr = 0;

  for (const node of orderByTime) {
    let ms = Math.max(node.ms, prevMs + minGapMs);

    // Keep similar items apart.
    const lk = lastKeyMs.get(node.key);
    if (lk !== undefined && ms - lk < minSimilarGapMs) {
      ms = lk + minSimilarGapMs;
    }

    // Avoid existing GHL slots (advance the pointer; both lists are sorted).
    while (existingPtr < existingMs.length && existingMs[existingPtr]! < ms - minGapMs) existingPtr++;
    for (let k = existingPtr; k < existingMs.length; k++) {
      if (Math.abs(existingMs[k]! - ms) < minGapMs) {
        ms = existingMs[k]! + minGapMs;
      } else if (existingMs[k]! > ms) {
        break;
      }
    }

    slots[node.idx]!.ms = ms;
    prevMs = ms;
    lastKeyMs.set(node.key, ms);
  }

  // Collect per-item occurrences, ascending.
  const byItem = new Map<string, number[]>();
  for (let i = 0; i < totalPosts; i++) {
    const a = assignment[i]!;
    const arr = byItem.get(a.itemId) ?? [];
    arr.push(slots[i]!.ms);
    byItem.set(a.itemId, arr);
  }

  return items.map((it) => ({
    itemId: it.id,
    occurrences: (byItem.get(it.id) ?? []).sort((a, b) => a - b).map((ms) => new Date(ms).toISOString()),
  }));
}
