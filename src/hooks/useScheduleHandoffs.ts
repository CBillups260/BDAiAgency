import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  onSnapshot,
  setDoc,
  serverTimestamp,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { firestore, storage, COLLECTIONS } from "../lib/firebase";

function docToObj<T>(snap: QueryDocumentSnapshot): T {
  return { id: snap.id, ...snap.data() } as T;
}

export interface TeamMember {
  id: string;
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  lastSeenAt?: unknown;
}

export interface ScheduleHandoff {
  id: string;
  assigneeUid: string;
  assigneeName: string;
  assigneeEmail: string | null;
  /** CRM account this post is for (scheduler sees this + client is pre-selected). Omitted on older handoffs. */
  clientAccountId?: string | null;
  clientAccountName?: string | null;
  imageUrl: string;
  imageStoragePath: string;
  captionHint: string | null;
  status: "pending" | "picked_up" | "dismissed" | "scheduled";
  createdByUid: string;
  createdByName: string;
  createdByEmail: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/** Upsert the signed-in user so they appear in the team picker (Google / any provider). */
export async function syncTeamMember(user: User) {
  const uid = user.uid;
  await setDoc(
    doc(firestore, COLLECTIONS.teamMembers, uid),
    {
      uid,
      displayName: user.displayName ?? null,
      email: user.email ?? null,
      photoURL: user.photoURL ?? null,
      lastSeenAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const col = collection(firestore, COLLECTIONS.teamMembers);
    const unsub = onSnapshot(
      col,
      (snap) => {
        setError(null);
        const rows = snap.docs.map((d) => docToObj<TeamMember>(d));
        rows.sort((a, b) => {
          const na = (a.displayName || a.email || a.uid).toLowerCase();
          const nb = (b.displayName || b.email || b.uid).toLowerCase();
          return na.localeCompare(nb);
        });
        setMembers(rows);
        setLoading(false);
      },
      (err) => {
        setError(err.message || "Could not load team list");
        setMembers([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  return { members, loading, error };
}

function sortHandoffsByCreatedAt(rows: ScheduleHandoff[]) {
  return [...rows].sort((a, b) => {
    const ta = toMillis(a.createdAt);
    const tb = toMillis(b.createdAt);
    return tb - ta;
  });
}

/** Pending queue: group by CRM client so bulk batches stay together in AI Scheduler. */
function clientSortKey(h: ScheduleHandoff) {
  const id = (h.clientAccountId || "").trim();
  if (id) return `id:${id}`;
  return `name:${(h.clientAccountName || "").toLowerCase()}`;
}

export function sortPendingHandoffsForScheduler(rows: ScheduleHandoff[]) {
  return [...rows].sort((a, b) => {
    const cmp = clientSortKey(a).localeCompare(clientSortKey(b));
    if (cmp !== 0) return cmp;
    return toMillis(b.createdAt) - toMillis(a.createdAt);
  });
}

export function groupPendingHandoffsByClient(rows: ScheduleHandoff[]): {
  clientKey: string;
  clientName: string;
  handoffs: ScheduleHandoff[];
}[] {
  if (rows.length === 0) return [];
  const sorted = sortPendingHandoffsForScheduler(rows);
  const groups: { clientKey: string; clientName: string; handoffs: ScheduleHandoff[] }[] = [];
  for (const h of sorted) {
    const clientKey = clientSortKey(h);
    const clientName = h.clientAccountName?.trim() || "Client not specified";
    const last = groups[groups.length - 1];
    if (last && last.clientKey === clientKey) last.handoffs.push(h);
    else groups.push({ clientKey, clientName, handoffs: [h] });
  }
  // Bulk queue: oldest first within each brand (FIFO).
  for (const g of groups) {
    g.handoffs.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
  }
  return groups;
}

/**
 * After scheduling one handoff, pick the next queue item for the same CRM client (FIFO).
 * Returns null when that brand has no more pending posts in the list.
 */
export function pickNextHandoffForClient(
  groups: { handoffs: ScheduleHandoff[] }[],
  excludedHandoffId: string,
  clientAccountId: string | null | undefined
): ScheduleHandoff | null {
  const prefer = (clientAccountId || "").trim();
  if (!prefer) return null;
  const group = groups.find((g) =>
    g.handoffs.some((h) => (h.clientAccountId || "").trim() === prefer)
  );
  if (!group) return null;
  const rest = group.handoffs.filter(
    (h) => h.id !== excludedHandoffId && (h.imageUrl || "").trim().length > 0
  );
  rest.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
  return rest[0] ?? null;
}

export function clientAccountIdForHandoffInQueue(
  groups: { handoffs: ScheduleHandoff[] }[],
  handoffId: string
): string | null {
  for (const g of groups) {
    const h = g.handoffs.find((x) => x.id === handoffId);
    const id = h?.clientAccountId?.trim();
    if (id) return id;
  }
  return null;
}

function toMillis(v: unknown): number {
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/** Pending handoffs assigned to this user (shown in AI Scheduler banner). */
export function usePendingHandoffsForAssignee(assigneeUid: string | undefined) {
  const [handoffs, setHandoffs] = useState<ScheduleHandoff[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!assigneeUid) {
      setHandoffs([]);
      setLoading(false);
      return;
    }
    const q = query(
      collection(firestore, COLLECTIONS.scheduleHandoffs),
      where("assigneeUid", "==", assigneeUid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => docToObj<ScheduleHandoff>(d))
          .filter((h) => h.status === "pending" || h.status === "picked_up");
        setHandoffs(sortPendingHandoffsForScheduler(rows));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [assigneeUid]);

  return { handoffs, loading };
}

/** Handoffs you created (Tasks page history). */
export function useOutgoingHandoffs(createdByUid: string | undefined) {
  const [handoffs, setHandoffs] = useState<ScheduleHandoff[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!createdByUid) {
      setHandoffs([]);
      setLoading(false);
      return;
    }
    const q = query(
      collection(firestore, COLLECTIONS.scheduleHandoffs),
      where("createdByUid", "==", createdByUid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => docToObj<ScheduleHandoff>(d));
        setHandoffs(sortHandoffsByCreatedAt(rows));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [createdByUid]);

  return { handoffs, loading };
}

export async function markHandoffPickedUp(handoffId: string) {
  await updateDoc(doc(firestore, COLLECTIONS.scheduleHandoffs, handoffId), {
    status: "picked_up",
    updatedAt: serverTimestamp(),
  });
}

export async function markHandoffDismissed(handoffId: string) {
  await updateDoc(doc(firestore, COLLECTIONS.scheduleHandoffs, handoffId), {
    status: "dismissed",
    updatedAt: serverTimestamp(),
  });
}

/** Call after a post is successfully sent to HighLevel — removes it from the scheduler queue. */
export async function markHandoffScheduled(handoffId: string) {
  await updateDoc(doc(firestore, COLLECTIONS.scheduleHandoffs, handoffId), {
    status: "scheduled",
    updatedAt: serverTimestamp(),
  });
}

/** Permanently delete a handoff and its stored image. */
export async function deleteHandoff(handoffId: string, imageStoragePath?: string) {
  if (imageStoragePath) {
    try {
      await deleteObject(ref(storage, imageStoragePath));
    } catch {
      // Image may already be gone — proceed with doc deletion
    }
  }
  await deleteDoc(doc(firestore, COLLECTIONS.scheduleHandoffs, handoffId));
}

export async function createScheduleHandoff(input: {
  creator: User;
  assignee: TeamMember;
  clientAccount: { id: string; name: string };
  file: File;
  captionHint: string;
}): Promise<string> {
  const { creator, assignee, clientAccount, file, captionHint } = input;
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Image should be under 20 MB.");
  }
  if (!clientAccount.id.trim()) {
    throw new Error("Choose which client account this post is for.");
  }

  /** One Firestore write after storage is ready — assignee queue never sees an image-less “ghost” row. */
  const draftRef = doc(collection(firestore, COLLECTIONS.scheduleHandoffs));
  const handoffId = draftRef.id;

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
  const path = `${COLLECTIONS.scheduleHandoffs}/${handoffId}/post.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const imageUrl = await getDownloadURL(storageRef);

  await setDoc(draftRef, {
    assigneeUid: assignee.uid,
    assigneeName: assignee.displayName || assignee.email || "Team member",
    assigneeEmail: assignee.email ?? null,
    clientAccountId: clientAccount.id,
    clientAccountName: clientAccount.name,
    imageUrl,
    imageStoragePath: path,
    captionHint: captionHint.trim() || null,
    status: "pending" as const,
    createdByUid: creator.uid,
    createdByName: creator.displayName || creator.email || "Someone",
    createdByEmail: creator.email ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return handoffId;
}

export const MAX_BULK_HANDOFF_IMAGES = 30;

export type BulkHandoffInput = Omit<Parameters<typeof createScheduleHandoff>[0], "file" | "captionHint"> & {
  files: File[];
  captionHint: string;
  /** Per-image notes keyed by index. Falls back to the shared captionHint when absent. */
  perImageNotes?: Record<number, string>;
  onProgress?: (completed: number, total: number) => void;
};

export async function createScheduleHandoffsBulk(
  input: BulkHandoffInput
): Promise<{ ok: number; failed: { name: string; error: string }[] }> {
  const { files, onProgress, perImageNotes, captionHint, ...rest } = input;
  const failed: { name: string; error: string }[] = [];
  let ok = 0;
  const total = files.length;
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const note = perImageNotes?.[i]?.trim() || captionHint;
    try {
      await createScheduleHandoff({ ...rest, file, captionHint: note });
      ok++;
    } catch (e) {
      failed.push({
        name: file.name,
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
    onProgress?.(i + 1, total);
  }
  return { ok, failed };
}
