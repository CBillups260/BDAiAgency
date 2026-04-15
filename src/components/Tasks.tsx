import { useState, useMemo, useRef, useEffect } from "react";
import type { User } from "firebase/auth";
import { motion } from "motion/react";
import {
  CheckSquare,
  Star,
  Upload,
  Loader,
  Search,
  Calendar,
  Image as ImageIcon,
  Briefcase,
  X,
  Layers,
  Trash2,
  Edit3,
} from "@geist-ui/icons";
import {
  useTeamMembers,
  useOutgoingHandoffs,
  createScheduleHandoff,
  createScheduleHandoffsBulk,
  deleteHandoff,
  MAX_BULK_HANDOFF_IMAGES,
  type TeamMember,
  type ScheduleHandoff,
} from "../hooks/useScheduleHandoffs";
import { useFirestoreAccounts, type FirestoreAccount } from "../hooks/useFirestore";

interface TasksProps {
  user: User;
}

function statusLabel(s: ScheduleHandoff["status"]) {
  switch (s) {
    case "pending":
      return "Waiting for scheduler";
    case "picked_up":
      return "In scheduler queue";
    case "scheduled":
      return "Published from scheduler";
    case "dismissed":
      return "Dismissed";
    default:
      return s;
  }
}

function statusClass(s: ScheduleHandoff["status"]) {
  switch (s) {
    case "pending":
      return "bg-amber-500/15 text-amber-300 border-amber-500/25";
    case "picked_up":
      return "bg-sky-500/15 text-sky-300 border-sky-500/25";
    case "scheduled":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";
    case "dismissed":
      return "bg-zinc-500/15 text-zinc-400 border-zinc-600/30";
    default:
      return "bg-zinc-500/15 text-zinc-400";
  }
}

function memberLabel(m: TeamMember, currentUid: string) {
  const base = m.displayName || m.email || m.uid;
  const you = m.uid === currentUid ? " (you)" : "";
  const email =
    m.email && m.displayName && m.uid !== currentUid ? ` · ${m.email}` : "";
  return `${base}${you}${email}`;
}

function accountLabel(a: FirestoreAccount) {
  return (a.company || a.name || "Client").trim() || "Client";
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function validateImageFile(f: File): string | null {
  if (!f.type.startsWith("image/")) return `${f.name}: not an image`;
  if (f.size > MAX_IMAGE_BYTES) return `${f.name}: over 20 MB`;
  return null;
}

export default function Tasks({ user }: TasksProps) {
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();
  const { members, loading: membersLoading, error: membersError } = useTeamMembers();
  const { handoffs: outgoing, loading: outgoingLoading } = useOutgoingHandoffs(user.uid);
  const [accountQuery, setAccountQuery] = useState("");
  const [clientAccountId, setClientAccountId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [assigneeUid, setAssigneeUid] = useState("");
  const [captionHint, setCaptionHint] = useState("");
  const [handoffMode, setHandoffMode] = useState<"single" | "bulk">("single");
  const [file, setFile] = useState<File | null>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkNotes, setBulkNotes] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const bulkPreviewUrlsRef = useRef<string[]>([]);

  const revokeBulkPreviews = () => {
    bulkPreviewUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    bulkPreviewUrlsRef.current = [];
  };

  useEffect(() => {
    return () => revokeBulkPreviews();
  }, []);

  const setBulkFilesWithPreviews = (files: File[], preserveNotes = false) => {
    revokeBulkPreviews();
    const urls = files.map((f) => URL.createObjectURL(f));
    bulkPreviewUrlsRef.current = urls;
    setBulkFiles(files);
    if (!preserveNotes) setBulkNotes({});
  };

  const addBulkFilesFromList = (list: FileList | File[]) => {
    if (!clientAccountId) {
      return ["Select a brand in step 1 before adding images."];
    }
    const incoming = Array.from(list);
    const errors: string[] = [];
    const combined: File[] = [...bulkFiles];
    for (const f of incoming) {
      const err = validateImageFile(f);
      if (err) {
        errors.push(err);
        continue;
      }
      if (combined.length >= MAX_BULK_HANDOFF_IMAGES) {
        errors.push(`Max ${MAX_BULK_HANDOFF_IMAGES} images — skipped “${f.name}” and any after it.`);
        break;
      }
      combined.push(f);
    }
    setBulkFilesWithPreviews(combined, true);
    return errors;
  };

  const removeBulkAt = (index: number) => {
    const reindexed: Record<number, string> = {};
    Object.entries(bulkNotes).forEach(([k, v]) => {
      const ki = Number(k);
      if (ki < index) reindexed[ki] = v;
      else if (ki > index) reindexed[ki - 1] = v;
    });
    setBulkNotes(reindexed);
    setBulkFilesWithPreviews(bulkFiles.filter((_, i) => i !== index), true);
  };

  const assigneeOptions = useMemo(() => members, [members]);

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) =>
      accountLabel(a).localeCompare(accountLabel(b), undefined, { sensitivity: "base" })
    );
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase();
    if (!q) return sortedAccounts;
    return sortedAccounts.filter((a) => {
      const hay = `${a.company || ""} ${a.name || ""} ${a.email || ""} ${a.id}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedAccounts, accountQuery]);

  const selectedClientAccount: FirestoreAccount | undefined = useMemo(
    () => accounts.find((a) => a.id === clientAccountId),
    [accounts, clientAccountId]
  );

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return assigneeOptions;
    return assigneeOptions.filter((m) => {
      const hay = `${m.displayName || ""} ${m.email || ""} ${m.uid}`.toLowerCase();
      return hay.includes(q);
    });
  }, [assigneeOptions, memberQuery]);

  const selectedAssignee: TeamMember | undefined = useMemo(
    () => members.find((m) => m.uid === assigneeUid),
    [members, assigneeUid]
  );

  const handleDelete = async (h: ScheduleHandoff) => {
    setDeletingId(h.id);
    try {
      await deleteHandoff(h.id, h.imageStoragePath);
    } catch {
      setFormError("Couldn't delete that handoff. Try again.");
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormOk(null);
    if (!selectedClientAccount) {
      setFormError("Choose which client account this post is for.");
      return;
    }
    if (!selectedAssignee) {
      setFormError("Choose who should schedule this post.");
      return;
    }

    if (handoffMode === "bulk") {
      if (bulkFiles.length === 0) {
        setFormError(`Add at least one image (up to ${MAX_BULK_HANDOFF_IMAGES}).`);
        return;
      }
      setSubmitting(true);
      setBulkProgress({ done: 0, total: bulkFiles.length });
      try {
        const { ok, failed } = await createScheduleHandoffsBulk({
          creator: user,
          assignee: selectedAssignee,
          clientAccount: {
            id: selectedClientAccount.id,
            name: accountLabel(selectedClientAccount),
          },
          files: bulkFiles,
          captionHint,
          perImageNotes: bulkNotes,
          onProgress: (done, total) => setBulkProgress({ done, total }),
        });
        setBulkProgress(null);
        if (failed.length === 0) {
          setFormOk(
            `Sent ${ok} post${ok !== 1 ? "s" : ""} to ${selectedAssignee.displayName || selectedAssignee.email || "teammate"} for ${accountLabel(selectedClientAccount)}.`
          );
          revokeBulkPreviews();
          setBulkFiles([]);
          setBulkNotes({});
          if (bulkInputRef.current) bulkInputRef.current.value = "";
        } else {
          setFormOk(
            `Sent ${ok} of ${bulkFiles.length}. ${failed.length} failed — check below.`
          );
          setFormError(
            failed.slice(0, 5).map((f) => `${f.name}: ${f.error}`).join("\n") +
              (failed.length > 5 ? `\n…+${failed.length - 5} more` : "")
          );
          revokeBulkPreviews();
          setBulkFiles([]);
          setBulkNotes({});
          if (bulkInputRef.current) bulkInputRef.current.value = "";
        }
      } catch (err) {
        setBulkProgress(null);
        setFormError(err instanceof Error ? err.message : "Bulk handoff failed.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!file) {
      setFormError("Upload an image for them to post.");
      return;
    }
    setSubmitting(true);
    try {
      await createScheduleHandoff({
        creator: user,
        assignee: selectedAssignee,
        clientAccount: {
          id: selectedClientAccount.id,
          name: accountLabel(selectedClientAccount),
        },
        file,
        captionHint,
      });
      setFormOk(
        `Sent to ${selectedAssignee.displayName || selectedAssignee.email || "teammate"} for ${accountLabel(selectedClientAccount)}. They’ll see it in Content → AI Scheduler.`
      );
      setFile(null);
      setCaptionHint("");
      setClientAccountId("");
      setAccountQuery("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn’t create handoff.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-7xl mx-auto space-y-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold text-white">Tasks</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Social handoffs — send finished creative to whoever runs the AI Scheduler
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-[11px] font-medium text-amber-300/90">
          <Star size={12} className="text-amber-400" />
          Featured · Social workflow
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <form
          onSubmit={handleSubmit}
          className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg space-y-5"
        >
          <div className="flex items-center gap-2 text-purple-300 mb-1">
            <CheckSquare size={18} />
            <h3 className="text-lg font-semibold text-white">New schedule handoff</h3>
          </div>
          <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-[#0A0A0F] border border-[#27273A] w-full sm:w-fit mb-3">
            <button
              type="button"
              onClick={() => {
                setHandoffMode("single");
                revokeBulkPreviews();
                setBulkFiles([]);
                setBulkNotes({});
                if (bulkInputRef.current) bulkInputRef.current.value = "";
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                handoffMode === "single"
                  ? "bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.2)]"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Single image
            </button>
            <button
              type="button"
              onClick={() => {
                setHandoffMode("bulk");
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all inline-flex items-center gap-2 ${
                handoffMode === "bulk"
                  ? "bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.2)]"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Layers size={16} />
              Bulk (up to {MAX_BULK_HANDOFF_IMAGES})
            </button>
          </div>
          <p className="text-sm text-zinc-500 leading-relaxed">
            {handoffMode === "single" ? (
              <>
                Choose the client, assign a teammate, attach one image, and add an optional caption. They’ll see it in{" "}
                <span className="text-zinc-400">Content → AI Scheduler</span>.
              </>
            ) : (
              <>
                <span className="text-zinc-300">Pick the brand first</span> — then teammate and images. Every file in this batch is tied to that one client so the AI Scheduler queue stays grouped by account.
              </>
            )}
          </p>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold flex items-center gap-2">
                <Briefcase size={14} className="text-zinc-500" />
                {handoffMode === "bulk" ? (
                  <>
                    <span className="text-purple-400 font-bold">1.</span> Brand / client account
                  </>
                ) : (
                  "Client account"
                )}
              </label>
              {!accountsLoading && sortedAccounts.length > 0 && (
                <span className="text-[10px] text-zinc-600">{sortedAccounts.length} clients</span>
              )}
            </div>
            <div className="relative mb-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
              <input
                type="search"
                value={accountQuery}
                onChange={(e) => setAccountQuery(e.target.value)}
                placeholder="Search client name or company…"
                disabled={accountsLoading}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500/45 disabled:opacity-50"
              />
            </div>
            <div className="rounded-xl border border-[#27273A] bg-[#0A0A0F] overflow-hidden">
              <div className="max-h-48 overflow-y-auto divide-y divide-[#27273A]/80">
                {accountsLoading ? (
                  <div className="flex items-center gap-2 text-zinc-500 text-sm px-4 py-6 justify-center">
                    <Loader size={16} className="animate-spin" /> Loading clients…
                  </div>
                ) : filteredAccounts.length === 0 ? (
                  <p className="text-sm text-zinc-500 px-4 py-6 text-center">
                    {sortedAccounts.length === 0
                      ? "No accounts yet. Add clients under Accounts."
                      : "No matches — try another search."}
                  </p>
                ) : (
                  filteredAccounts.map((a) => {
                    const selected = clientAccountId === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          if (handoffMode === "bulk" && clientAccountId !== a.id && bulkFiles.length > 0) {
                            revokeBulkPreviews();
                            setBulkFiles([]);
                            if (bulkInputRef.current) bulkInputRef.current.value = "";
                          }
                          setClientAccountId(a.id);
                        }}
                        className={`w-full flex flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? "bg-purple-500/15 text-white border-l-2 border-purple-500"
                            : "text-zinc-300 hover:bg-[#12121A] border-l-2 border-transparent"
                        }`}
                      >
                        <span className="font-medium truncate w-full">{accountLabel(a)}</span>
                        {a.name && a.company && a.name !== a.company && (
                          <span className="text-[11px] text-zinc-500 truncate w-full">{a.name}</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            {selectedClientAccount && (
              <p className="text-[11px] text-zinc-500 mt-2">
                {handoffMode === "bulk" ? (
                  <>
                    All bulk images will be queued for{" "}
                    <span className="text-amber-400/90 font-medium">{accountLabel(selectedClientAccount)}</span>{" "}
                    in the scheduler.
                  </>
                ) : (
                  <>
                    Post for:{" "}
                    <span className="text-zinc-400">{accountLabel(selectedClientAccount)}</span>
                  </>
                )}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">
                {handoffMode === "bulk" ? (
                  <>
                    <span className="text-purple-400 font-bold">2.</span> Assign to scheduler
                  </>
                ) : (
                  "Assign to"
                )}
              </label>
              {!membersLoading && assigneeOptions.length > 0 && (
                <span className="text-[10px] text-zinc-600">
                  {assigneeOptions.length} in roster
                </span>
              )}
            </div>
            {membersError && (
              <p className="text-xs text-red-400 mb-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
                {membersError} — check Firestore rules allow reading <code className="text-red-300">team_members</code> for app users, then deploy rules.
              </p>
            )}
            <div className="relative mb-2">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
              <input
                type="search"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="Search name or email…"
                disabled={membersLoading}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500/45 disabled:opacity-50"
              />
            </div>
            <div className="rounded-xl border border-[#27273A] bg-[#0A0A0F] overflow-hidden">
              <div className="max-h-60 overflow-y-auto divide-y divide-[#27273A]/80">
                {membersLoading ? (
                  <div className="flex items-center gap-2 text-zinc-500 text-sm px-4 py-6 justify-center">
                    <Loader size={16} className="animate-spin" /> Loading team…
                  </div>
                ) : filteredMembers.length === 0 ? (
                  <p className="text-sm text-zinc-500 px-4 py-6 text-center">
                    {assigneeOptions.length === 0
                      ? "No team profiles yet. Everyone who signs in is added to this list automatically."
                      : "No matches — try another search."}
                  </p>
                ) : (
                  filteredMembers.map((m) => {
                    const selected = assigneeUid === m.uid;
                    return (
                      <button
                        key={m.uid}
                        type="button"
                        onClick={() => setAssigneeUid(m.uid)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                          selected
                            ? "bg-purple-500/15 text-white border-l-2 border-purple-500"
                            : "text-zinc-300 hover:bg-[#12121A] border-l-2 border-transparent"
                        }`}
                      >
                        <img
                          src={
                            m.photoURL ||
                            `https://ui-avatars.com/api/?name=${encodeURIComponent(memberLabel(m, user.uid))}&background=3f3f46&color=fff&size=64`
                          }
                          alt=""
                          className="w-9 h-9 rounded-full border border-[#27273A] shrink-0 object-cover"
                        />
                        <span className="truncate min-w-0">{memberLabel(m, user.uid)}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            {selectedAssignee && (
              <p className="text-[11px] text-zinc-500 mt-2">
                Selected:{" "}
                <span className="text-zinc-400">
                  {memberLabel(selectedAssignee, user.uid)}
                </span>
              </p>
            )}
          </div>

          {handoffMode === "single" ? (
            <div>
              <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold block mb-2">
                Post image
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-8 rounded-xl border-2 border-dashed border-[#27273A] hover:border-purple-500/35 bg-[#0A0A0F] text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                {file ? (
                  <>
                    <ImageIcon size={18} className="text-purple-400 shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </>
                ) : (
                  <>
                    <Upload size={18} className="text-zinc-500 shrink-0" />
                    Click to upload image
                  </>
                )}
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold block">
                  <span className="text-purple-400 font-bold">3.</span> Post images (this brand only)
                </label>
                <span className="text-[10px] text-zinc-600">
                  {bulkFiles.length}/{MAX_BULK_HANDOFF_IMAGES} selected
                </span>
              </div>
              {!clientAccountId && (
                <p className="text-xs text-amber-400/90 mb-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  Choose a brand in step 1 before adding files — that keeps each batch tied to one client in the scheduler.
                </p>
              )}
              <input
                ref={bulkInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={!clientAccountId}
                onChange={(e) => {
                  const fl = e.target.files;
                  if (fl?.length) {
                    const errs = addBulkFilesFromList(fl);
                    if (errs.length) setFormError(errs.join(" · "));
                  }
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={!clientAccountId}
                onClick={() => bulkInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-6 rounded-xl border-2 border-dashed border-[#27273A] hover:border-purple-500/35 bg-[#0A0A0F] text-sm text-zinc-400 hover:text-zinc-300 transition-colors mb-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#27273A]"
              >
                <Upload size={18} className="text-zinc-500 shrink-0" />
                {clientAccountId && selectedClientAccount
                  ? `Add images for ${accountLabel(selectedClientAccount)} (max ${MAX_BULK_HANDOFF_IMAGES})`
                  : "Select a brand first to add images"}
              </button>
              {bulkFiles.length > 0 && (
                <div className="space-y-2 max-h-80 overflow-y-auto rounded-xl border border-[#27273A] bg-[#0A0A0F] p-3">
                  {bulkFiles.map((f, i) => (
                    <div key={`${f.name}-${f.size}-${i}`} className="flex gap-3 p-2 rounded-xl bg-[#12121A] border border-[#27273A] group">
                      <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#27273A] bg-[#0A0A0F] shrink-0">
                        <img
                          src={bulkPreviewUrlsRef.current[i] || ""}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeBulkAt(i)}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded-md bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                          aria-label={`Remove ${f.name}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                        <span className="text-[11px] text-zinc-500 truncate">{f.name}</span>
                        <div className="relative flex-1">
                          <Edit3 size={12} className="absolute left-2.5 top-2.5 text-zinc-600 pointer-events-none" />
                          <textarea
                            value={bulkNotes[i] || ""}
                            onChange={(e) =>
                              setBulkNotes((prev) => ({ ...prev, [i]: e.target.value }))
                            }
                            placeholder="Add a note for this image…"
                            rows={2}
                            className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-[#0A0A0F] border border-[#27273A] text-xs text-white placeholder-zinc-600 outline-none resize-none focus:border-purple-500/40 transition-colors"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold block mb-2">
              {handoffMode === "bulk" && <span className="text-purple-400 font-bold mr-1">4.</span>}
              Caption note <span className="text-zinc-600 font-normal normal-case">(optional)</span>
            </label>
            <textarea
              value={captionHint}
              onChange={(e) => setCaptionHint(e.target.value)}
              placeholder="e.g. Client: Acme — Spring promo, use emojis sparingly"
              rows={3}
              className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4 text-sm text-white placeholder-zinc-600 outline-none resize-none focus:border-purple-500/40 transition-colors"
            />
            <p className="text-[11px] text-zinc-600 mt-1.5">
              {handoffMode === "bulk"
                ? "Fallback note for images without their own note. Per-image notes override this."
                : "Fills the caption field in AI Scheduler if it’s empty when they load this handoff."}
            </p>
          </div>

          {formError && (
            <p className="text-sm text-red-400 whitespace-pre-wrap break-words">{formError}</p>
          )}
          {formOk && <p className="text-sm text-emerald-400">{formOk}</p>}
          {bulkProgress && (
            <p className="text-sm text-zinc-400 flex items-center gap-2">
              <Loader size={14} className="animate-spin text-purple-400" />
              Creating handoffs {bulkProgress.done}/{bulkProgress.total}…
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || membersLoading || accountsLoading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm font-semibold text-white shadow-[0_0_15px_rgba(168,85,247,0.2)] hover:from-purple-500 hover:to-purple-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? <Loader size={16} className="animate-spin" /> : <Calendar size={16} />}
            {handoffMode === "bulk"
              ? bulkFiles.length > 0
                ? `Send ${bulkFiles.length} to scheduler`
                : "Send to scheduler"
              : "Send to scheduler"}
          </button>
        </form>

        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <h3 className="text-lg font-semibold text-white mb-1">Your outgoing handoffs</h3>
          <p className="text-sm text-zinc-500 mb-6">Everything you’ve sent for scheduling</p>

          {outgoingLoading ? (
            <div className="flex items-center gap-2 text-zinc-500 text-sm py-12 justify-center">
              <Loader size={16} className="animate-spin" /> Loading…
            </div>
          ) : outgoing.length === 0 ? (
            <p className="text-sm text-zinc-600 py-8 text-center">No handoffs yet.</p>
          ) : (
            <ul className="space-y-3 max-h-[min(520px,55vh)] overflow-y-auto pr-1">
              {outgoing.map((h) => (
                <li
                  key={h.id}
                  className="relative flex gap-3 p-3 rounded-2xl bg-[#0A0A0F] border border-[#27273A] hover:border-[#333347] transition-colors group/card"
                >
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-[#12121A] shrink-0 border border-[#27273A]">
                    {h.imageUrl ? (
                      <img src={h.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-700">
                        <ImageIcon size={20} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      To {h.assigneeName}
                    </p>
                    {(h.clientAccountName || h.clientAccountId) && (
                      <p className="text-xs text-amber-400/90 mt-1 truncate">
                        Client: {h.clientAccountName?.trim() || "—"}
                      </p>
                    )}
                    {h.captionHint && (
                      <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{h.captionHint}</p>
                    )}
                    <span
                      className={`inline-block mt-2 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md border ${statusClass(h.status)}`}
                    >
                      {statusLabel(h.status)}
                    </span>
                  </div>
                  {confirmDeleteId === h.id ? (
                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/80 backdrop-blur-sm z-10 px-4">
                      <div className="text-center space-y-3">
                        <p className="text-sm text-white font-medium">Delete this handoff?</p>
                        <p className="text-xs text-zinc-400">This will permanently remove the image and task.</p>
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={deletingId === h.id}
                            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(h)}
                            disabled={deletingId === h.id}
                            className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {deletingId === h.id ? (
                              <Loader size={12} className="animate-spin" />
                            ) : (
                              <Trash2 size={12} />
                            )}
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(h.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-zinc-500 opacity-0 group-hover/card:opacity-100 transition-all hover:bg-red-500/20 hover:text-red-400"
                      aria-label="Delete handoff"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.div>
  );
}
