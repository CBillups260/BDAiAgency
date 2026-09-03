import { authedFetch } from "../lib/api";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Calendar, Check, Loader, Zap, Send, X } from "@geist-ui/icons";
import { useAuth } from "../hooks/useAuth";
import {
  createScheduleHandoffFromBase64,
  updateHandoffAiResult,
  type HandoffProcessingMode,
} from "../hooks/useScheduleHandoffs";
import type { FirestoreAccount } from "../hooks/useFirestore";
import { getGhlLocationId, getGhlPrivateIntegrationToken } from "../lib/utils";

export interface PushToSchedulerSource {
  /** Origin tag stored on the handoff for analytics + UI (e.g. "composer", "asset_creator"). */
  id: string;
  /** Optional caption seed passed to the AI captioner. */
  topicHint?: string;
}

export interface PushToSchedulerButtonProps {
  account: FirestoreAccount | null;
  getImageBytes: () => Promise<{ base64: string; mimeType: string }> | { base64: string; mimeType: string };
  source: PushToSchedulerSource;
  /** Tailwind class overrides for the trigger button (size/colors). */
  className?: string;
  /** Compact look — small icon button only (for hover overlays). */
  compact?: boolean;
  /** Render a tooltip-only label inside the trigger button. */
  label?: string;
  disabled?: boolean;
  /** Optional: invoked after a successful push so the caller can show its own toast/animation. */
  onPushed?: (mode: HandoffProcessingMode, handoffId: string) => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "captioning" }
  | { kind: "suggesting" }
  | { kind: "done"; mode: HandoffProcessingMode }
  | { kind: "error"; message: string };

const ICON_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

export default function PushToSchedulerButton({
  account,
  getImageBytes,
  source,
  className,
  compact = false,
  label,
  disabled = false,
  onPushed,
}: PushToSchedulerButtonProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click / escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Auto-clear the "done" pill after a few seconds so the trigger reverts to its idle look.
  useEffect(() => {
    if (phase.kind !== "done" && phase.kind !== "error") return;
    const t = setTimeout(() => setPhase({ kind: "idle" }), phase.kind === "error" ? 5000 : 3000);
    return () => clearTimeout(t);
  }, [phase]);

  const accountReady = !!account && !!user;
  const triggerDisabled = disabled || !accountReady || phase.kind === "uploading" || phase.kind === "captioning" || phase.kind === "suggesting";

  const push = useCallback(
    async (mode: HandoffProcessingMode) => {
      if (!user) {
        setPhase({ kind: "error", message: "Sign in to push to the scheduler." });
        return;
      }
      if (!account) {
        setPhase({ kind: "error", message: "Choose a brand first — that's where the post is filed." });
        return;
      }
      setOpen(false);
      setPhase({ kind: "uploading" });
      let handoffId: string;
      let imageBytes: { base64: string; mimeType: string };
      try {
        const raw = getImageBytes();
        imageBytes = raw instanceof Promise ? await raw : raw;
      } catch (e) {
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : "Couldn't read the generated image.",
        });
        return;
      }

      try {
        handoffId = await createScheduleHandoffFromBase64({
          creator: user,
          assignee: {
            id: user.uid,
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
          },
          clientAccount: {
            id: account.id,
            name: account.company || account.name || "Client",
          },
          base64: imageBytes.base64,
          mimeType: imageBytes.mimeType,
          captionHint: source.topicHint?.trim() || "",
          source: source.id,
          processingMode: mode,
        });
      } catch (e) {
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : "Couldn't queue the post.",
        });
        return;
      }

      if (mode === "manual") {
        setPhase({ kind: "done", mode });
        onPushed?.(mode, handoffId);
        return;
      }

      // ── AI auto path: caption first, then try to suggest a time (if GHL is wired up).
      setPhase({ kind: "captioning" });
      let aiCaption: string | null = null;
      let captionError: string | null = null;
      try {
        const captionRes = await authedFetch("/api/content/generate-caption", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandContext: {
              company: account.company,
              industry: account.industry,
              description: account.description,
              brandVoice: account.brandVoice,
              targetAudience: account.targetAudience,
              socialHandles: account.socialHandles,
            },
            media: [{ base64: imageBytes.base64, mimeType: imageBytes.mimeType }],
            platform: "instagram",
            captionStyle: "short-sweet",
            topic: source.topicHint?.trim() || undefined,
            includeHashtags: true,
            includeEmojis: false,
          }),
        });
        const captionData = await captionRes.json().catch(() => null);
        if (!captionRes.ok) {
          throw new Error(captionData?.error || "Caption generation failed.");
        }
        const list = Array.isArray(captionData?.captions) ? (captionData.captions as string[]) : [];
        aiCaption = list[0]?.trim() || null;
      } catch (e) {
        captionError = e instanceof Error ? e.message : "Caption generation failed.";
      }

      // Try to suggest a publish time when the brand has a GHL location wired up.
      const locationId = getGhlLocationId(account);
      const integrationToken = getGhlPrivateIntegrationToken(account);
      let aiSuggestedScheduleAt: string | null = null;
      let aiSuggestReason: string | null = null;
      let suggestError: string | null = null;
      if (locationId && aiCaption) {
        setPhase({ kind: "suggesting" });
        try {
          const suggestRes = await authedFetch("/api/ghl/suggest-schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              locationId,
              caption: aiCaption,
              timezone: "America/New_York",
              minGapHours: 4,
              windowDays: 14,
              ...(integrationToken ? { privateIntegrationToken: integrationToken } : {}),
            }),
          });
          const suggestData = await suggestRes.json().catch(() => null);
          if (!suggestRes.ok) {
            throw new Error(suggestData?.error || "Time suggestion failed.");
          }
          if (typeof suggestData?.scheduledAt === "string") {
            aiSuggestedScheduleAt = suggestData.scheduledAt;
          }
          if (typeof suggestData?.reason === "string") {
            aiSuggestReason = suggestData.reason;
          }
        } catch (e) {
          suggestError = e instanceof Error ? e.message : "Time suggestion failed.";
        }
      } else if (!locationId) {
        suggestError = "No HighLevel location on this brand — caption is ready, you'll set the time in the scheduler.";
      }

      const errorSummary = [captionError, suggestError].filter(Boolean).join(" · ") || null;

      try {
        await updateHandoffAiResult(handoffId, {
          aiProcessingStatus: aiCaption ? "ready_for_approval" : "failed",
          aiProcessingError: errorSummary,
          aiSuggestedCaption: aiCaption,
          aiSuggestedScheduleAt,
          aiSuggestReason,
        });
      } catch {
        // Doc update failure shouldn't lose what we have; the handoff already exists.
      }

      if (!aiCaption) {
        setPhase({
          kind: "error",
          message: captionError || "AI processing failed — sent as manual handoff instead.",
        });
      } else {
        setPhase({ kind: "done", mode });
      }
      onPushed?.(mode, handoffId);
    },
    [account, user, getImageBytes, source, onPushed]
  );

  const busy =
    phase.kind === "uploading" || phase.kind === "captioning" || phase.kind === "suggesting";

  let triggerInner: React.ReactNode;
  if (busy) {
    triggerInner = (
      <>
        <Loader size={compact ? 12 : 14} className="animate-spin" />
        {!compact &&
          (phase.kind === "uploading"
            ? "Uploading…"
            : phase.kind === "captioning"
              ? "Writing caption…"
              : "Picking time…")}
      </>
    );
  } else if (phase.kind === "done") {
    triggerInner = (
      <>
        <Check size={compact ? 12 : 14} />
        {!compact && (phase.mode === "ai_auto" ? "AI ready · review" : "Sent to queue")}
      </>
    );
  } else if (phase.kind === "error") {
    triggerInner = (
      <>
        <X size={compact ? 12 : 14} />
        {!compact && "Failed"}
      </>
    );
  } else {
    triggerInner = (
      <>
        <Send size={compact ? 12 : 14} />
        {!compact && (label ?? "Push to Scheduler")}
      </>
    );
  }

  const baseClass = compact
    ? `${ICON_BTN} p-2 bg-white/10 hover:bg-emerald-500/40 text-white`
    : `${ICON_BTN} px-3 py-1.5 border border-emerald-500/35 text-emerald-200 hover:bg-emerald-500/15`;

  const stateOverride =
    phase.kind === "done"
      ? compact
        ? "bg-emerald-500/45 text-white"
        : "bg-emerald-500/15 border-emerald-400/50 text-emerald-100"
      : phase.kind === "error"
        ? compact
          ? "bg-red-500/45 text-white"
          : "bg-red-500/10 border-red-500/40 text-red-200"
        : "";

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => {
          if (triggerDisabled) return;
          if (phase.kind === "done" || phase.kind === "error") {
            setPhase({ kind: "idle" });
          }
          setOpen((v) => !v);
        }}
        disabled={triggerDisabled}
        title={
          !accountReady
            ? "Choose a brand first"
            : label || "Push this image to the AI Scheduler"
        }
        className={[baseClass, stateOverride, className].filter(Boolean).join(" ")}
      >
        {triggerInner}
      </button>

      {open && accountReady && !busy && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-72 rounded-xl border border-white/[0.08] bg-[#0f0f17] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.85)] p-2 text-left"
          role="menu"
        >
          <div className="px-2 pt-1 pb-2 border-b border-white/[0.05] mb-1">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              Send to {account?.company || account?.name || "brand"}'s scheduler
            </p>
          </div>

          <button
            type="button"
            onClick={() => void push("ai_auto")}
            className="w-full flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-emerald-500/10 transition-colors text-left"
          >
            <span className="mt-0.5 p-1.5 rounded-md bg-emerald-500/15 text-emerald-300 shrink-0">
              <Zap size={14} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-white">Auto-schedule with AI</span>
              <span className="block text-[11px] text-zinc-400 mt-0.5 leading-snug">
                AI writes a caption and picks a publish time. You review &amp; approve in the AI Scheduler.
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => void push("manual")}
            className="w-full flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-amber-500/10 transition-colors text-left"
          >
            <span className="mt-0.5 p-1.5 rounded-md bg-amber-500/15 text-amber-300 shrink-0">
              <Calendar size={14} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-white">Send to queue</span>
              <span className="block text-[11px] text-zinc-400 mt-0.5 leading-snug">
                Drops it in your scheduler queue — you handle the caption + time yourself.
              </span>
            </span>
          </button>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-72 rounded-xl border border-red-500/35 bg-[#1a0e10] p-3 text-[11px] text-red-200 leading-snug shadow-lg">
          {phase.message}
        </div>
      )}

      {phase.kind === "done" && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-72 rounded-xl border border-emerald-500/35 bg-[#0d1814] p-3 text-[11px] text-emerald-100 leading-snug shadow-lg">
          {phase.mode === "ai_auto" ? (
            <>
              Caption &amp; time queued. Open <span className="font-semibold">Content → AI Scheduler</span> to review and approve.
            </>
          ) : (
            <>
              Added to your scheduler queue. Open <span className="font-semibold">Content → AI Scheduler</span> to finish it.
            </>
          )}
        </div>
      )}
    </div>
  );
}
