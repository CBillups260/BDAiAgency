import { useCallback, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useAuth } from "./useAuth";
import { authedFetch } from "../lib/api";
import { getGhlLocationId, getGhlPrivateIntegrationToken } from "../lib/utils";
import { createMediaAsset, type FirestoreAccount } from "./useFirestore";
import {
  uploadBulkImage,
  createAiBulkHandoff,
  type TeamMember,
} from "./useScheduleHandoffs";

/** A menu item in the shape the analyze-asset endpoint wants. */
export interface MenuContextItem {
  name: string;
  category: string;
  description?: string | null;
}

export interface BulkImageInput {
  id: string;
  fileName: string;
  base64: string;
  mimeType: string;
  preview: string;
}

export type BulkRowStatus = "queued" | "analyzing" | "captioning" | "ready" | "failed";

export interface BulkRow extends BulkImageInput {
  status: BulkRowStatus;
  error: string | null;
  /** AI-given name (menu match if found, otherwise best guess). */
  name: string | null;
  menuMatch: string | null;
  category: string | null;
  tags: string[];
  description: string | null;
  similarityKey: string;
  /** One caption per scheduled use; index 0 used for occurrence 1, etc. */
  captions: string[];
  /** ISO instants, one per use. */
  occurrences: string[];
  scheduleReason: string | null;
}

export interface BulkRunConfig {
  account: FirestoreAccount;
  menuItems: MenuContextItem[];
  platform: string;
  captionStyle: string;
  cta: { type: string; value?: string };
  includeHashtags: boolean;
  includeEmojis: boolean;
  saveToSecondBrain: boolean;
  windowDays: number;
  usesPerImage: number;
  minSimilarGapDays: number;
  timezone: string;
}

export type BulkPhase = "idle" | "analyzing" | "planning" | "ready" | "committing" | "done";

export interface CommitSummary {
  handoffsCreated: number;
  assetsSaved: number;
  failed: { fileName: string; error: string }[];
}

const ANALYZE_CONCURRENCY = 4;
const COMMIT_CONCURRENCY = 3;

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

function deriveSimilarityKey(a: {
  menuMatch: string | null;
  category: string | null;
  tags: string[];
  name: string | null;
}): string {
  const raw = a.menuMatch || a.category || a.tags[0] || a.name || "misc";
  return raw.trim().toLowerCase() || "misc";
}

/**
 * Drives the bulk pipeline: analyze + name each image against the brand menu, draft brand-voice
 * captions, then spread the batch across the window (each image used `usesPerImage` times,
 * similar images kept apart). `commit()` uploads each image once and files the prefilled
 * handoffs into the AI Scheduler approval queue (+ optional Second Brain save).
 */
export function useBulkAiSchedule() {
  const { user } = useAuth();
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [phase, setPhase] = useState<BulkPhase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  // Mirror of rows for reading inside async loops without stale closures.
  const rowsRef = useRef<BulkRow[]>([]);

  const writeRows = useCallback((next: BulkRow[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const patchRow = useCallback((id: string, patch: Partial<BulkRow>) => {
    const next = rowsRef.current.map((r) => (r.id === id ? { ...r, ...patch } : r));
    rowsRef.current = next;
    setRows(next);
  }, []);

  const setImages = useCallback(
    (images: BulkImageInput[]) => {
      const next: BulkRow[] = images.map((img) => ({
        ...img,
        status: "queued",
        error: null,
        name: null,
        menuMatch: null,
        category: null,
        tags: [],
        description: null,
        similarityKey: "misc",
        captions: [],
        occurrences: [],
        scheduleReason: null,
      }));
      writeRows(next);
      setPhase("idle");
      setError(null);
      setProgress({ done: 0, total: next.length });
    },
    [writeRows]
  );

  const removeRow = useCallback(
    (id: string) => {
      writeRows(rowsRef.current.filter((r) => r.id !== id));
    },
    [writeRows]
  );

  const updateCaption = useCallback(
    (id: string, occ: number, value: string) => {
      const row = rowsRef.current.find((r) => r.id === id);
      if (!row) return;
      const captions = [...row.captions];
      captions[occ] = value;
      patchRow(id, { captions });
    },
    [patchRow]
  );

  const reset = useCallback(() => {
    writeRows([]);
    setPhase("idle");
    setError(null);
    setProgress({ done: 0, total: 0 });
  }, [writeRows]);

  /** Analyze + caption every queued image, then plan the spread schedule. */
  const analyzeAndDraft = useCallback(
    async (config: BulkRunConfig) => {
      const queued = rowsRef.current;
      if (!queued.length) return;
      setError(null);
      setPhase("analyzing");
      setProgress({ done: 0, total: queued.length });
      let done = 0;

      await mapWithConcurrency(queued, ANALYZE_CONCURRENCY, async (row) => {
        try {
          patchRow(row.id, { status: "analyzing", error: null });
          // 1) Vision analyze + menu match.
          const analyzeRes = await authedFetch("/api/content/analyze-asset", {
            method: "POST",
            body: JSON.stringify({
              imageBase64: row.base64,
              imageMimeType: row.mimeType,
              menuItems: config.menuItems,
            }),
          });
          const analysis = await analyzeRes.json().catch(() => null);
          if (!analyzeRes.ok) throw new Error(analysis?.error || "Analysis failed.");

          const name: string | null = analysis?.name || null;
          const menuMatch: string | null = analysis?.menuMatch || null;
          const category: string | null = analysis?.category || null;
          const tags: string[] = Array.isArray(analysis?.tags) ? analysis.tags : [];
          const description: string | null = analysis?.description || null;
          const similarityKey = deriveSimilarityKey({ menuMatch, category, tags, name });

          patchRow(row.id, {
            status: "captioning",
            name,
            menuMatch,
            category,
            tags,
            description,
            similarityKey,
          });

          // 2) Draft captions (topic = matched menu item / best guess).
          const topicParts = [menuMatch || name, description].filter(Boolean);
          const captionRes = await authedFetch("/api/content/generate-caption", {
            method: "POST",
            body: JSON.stringify({
              brandContext: {
                company: config.account.company,
                industry: config.account.industry,
                description: config.account.description,
                brandVoice: config.account.brandVoice,
                targetAudience: config.account.targetAudience,
                socialHandles: config.account.socialHandles,
                website: config.account.website,
              },
              media: [{ base64: row.base64, mimeType: row.mimeType }],
              platform: config.platform,
              captionStyle: config.captionStyle,
              topic: topicParts.length ? topicParts.join(" · ") : undefined,
              includeHashtags: config.includeHashtags,
              includeEmojis: config.includeEmojis,
              cta: config.cta,
            }),
          });
          const captionData = await captionRes.json().catch(() => null);
          if (!captionRes.ok) throw new Error(captionData?.error || "Caption generation failed.");
          const list: string[] = Array.isArray(captionData?.captions) ? captionData.captions : [];
          const cleaned = list.map((c) => (c || "").trim()).filter(Boolean);
          if (!cleaned.length) throw new Error("No caption returned.");
          // One distinct caption per use (wrap around if fewer were returned).
          const captions = Array.from(
            { length: config.usesPerImage },
            (_, i) => cleaned[i % cleaned.length]!
          );

          patchRow(row.id, { status: "ready", captions });
        } catch (e) {
          patchRow(row.id, {
            status: "failed",
            error: e instanceof Error ? e.message : "Failed to process image.",
          });
        } finally {
          done += 1;
          setProgress({ done, total: queued.length });
        }
      });

      // 3) Spread the schedule for everything that analyzed successfully.
      const ready = rowsRef.current.filter((r) => r.status === "ready");
      if (!ready.length) {
        setPhase("ready");
        return;
      }

      setPhase("planning");
      try {
        const locationId = getGhlLocationId(config.account);
        const token = getGhlPrivateIntegrationToken(config.account);
        const planRes = await authedFetch("/api/ghl/plan-bulk-schedule", {
          method: "POST",
          body: JSON.stringify({
            locationId: locationId || undefined,
            timezone: config.timezone,
            windowDays: config.windowDays,
            usesPerImage: config.usesPerImage,
            minSimilarGapDays: config.minSimilarGapDays,
            items: ready.map((r) => ({ id: r.id, similarityKey: r.similarityKey })),
            ...(token ? { privateIntegrationToken: token } : {}),
          }),
        });
        const planData = await planRes.json().catch(() => null);
        if (!planRes.ok) throw new Error(planData?.error || "Could not plan the schedule.");
        const plan: { itemId: string; occurrences: string[] }[] = Array.isArray(planData?.plan)
          ? planData.plan
          : [];
        const byId = new Map(plan.map((p) => [p.itemId, p.occurrences]));
        const next = rowsRef.current.map((r) =>
          byId.has(r.id) ? { ...r, occurrences: byId.get(r.id) || [] } : r
        );
        writeRows(next);
      } catch (e) {
        // Scheduling is best-effort — captions are still usable; the team can set times manually.
        setError(
          e instanceof Error
            ? `Captions are ready, but auto-scheduling failed: ${e.message}`
            : "Auto-scheduling failed; set times in the scheduler."
        );
      }
      setPhase("ready");
    },
    [patchRow, writeRows]
  );

  /** Commit the ready rows: upload once, create one handoff per use, optionally save to Second Brain. */
  const commit = useCallback(
    async (config: BulkRunConfig): Promise<CommitSummary> => {
      if (!user) throw new Error("Sign in to send posts to the scheduler.");
      const ready = rowsRef.current.filter((r) => r.status === "ready" && r.captions.length > 0);
      const summary: CommitSummary = { handoffsCreated: 0, assetsSaved: 0, failed: [] };
      if (!ready.length) return summary;

      setPhase("committing");
      setProgress({ done: 0, total: ready.length });
      let done = 0;

      const assignee: TeamMember = {
        id: user.uid,
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
      };
      const clientAccount = {
        id: config.account.id,
        name: config.account.company || config.account.name || "Client",
      };
      const batchId = uuidv4();

      await mapWithConcurrency(ready, COMMIT_CONCURRENCY, async (row) => {
        try {
          const { imageUrl } = await uploadBulkImage({
            accountId: config.account.id,
            base64: row.base64,
            mimeType: row.mimeType,
            toSecondBrain: config.saveToSecondBrain,
            batchId,
            imageId: row.id,
          });

          if (config.saveToSecondBrain) {
            await createMediaAsset({
              accountId: config.account.id,
              name: row.name || row.menuMatch || row.fileName,
              category: row.category || "Uncategorized",
              tags: row.tags,
              description: row.description,
              menuMatch: row.menuMatch,
              imageUrl,
              mimeType: row.mimeType,
            });
            summary.assetsSaved += 1;
          }

          const count = config.usesPerImage;
          for (let occ = 0; occ < count; occ++) {
            const caption = row.captions[occ] || row.captions[0] || "";
            const scheduleAtIso = row.occurrences[occ] ?? null;
            await createAiBulkHandoff({
              creator: user,
              assignee,
              clientAccount,
              imageUrl,
              imageStoragePath: null, // shared image — don't let one handoff's deletion orphan the others
              caption,
              scheduleAtIso,
              scheduleReason: row.scheduleReason,
              menuMatch: row.menuMatch,
              source: "bulk_ai",
              batchId,
              occurrenceIndex: occ + 1,
              occurrenceCount: count,
            });
            summary.handoffsCreated += 1;
          }
        } catch (e) {
          summary.failed.push({
            fileName: row.fileName,
            error: e instanceof Error ? e.message : "Failed to queue.",
          });
        } finally {
          done += 1;
          setProgress({ done, total: ready.length });
        }
      });

      setPhase("done");
      return summary;
    },
    [user]
  );

  return {
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
  };
}
