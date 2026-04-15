import React, { useState } from "react";
import { Copy, LogOut } from "@geist-ui/icons";
import { motion } from "motion/react";
import { COLLECTIONS, FIREBASE_PROJECT_ID } from "../lib/firebase";

interface AccessPendingScreenProps {
  signOut: () => Promise<void>;
  email?: string | null;
  authUid: string;
  firestoreError?: string | null;
  docMissing?: boolean;
}

export default function AccessPendingScreen({
  signOut,
  email,
  authUid,
  firestoreError,
  docMissing,
}: AccessPendingScreenProps) {
  const [copied, setCopied] = useState(false);
  const docPath = `${COLLECTIONS.teamMembers}/${authUid}`;

  const copyUid = async () => {
    try {
      await navigator.clipboard.writeText(authUid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="min-h-screen bg-[#09090F] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-lg"
      >
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-600/80 to-amber-500/60 flex items-center justify-center mx-auto mb-4 border border-amber-500/25">
            <span className="text-white font-bold text-lg">!</span>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Access not enabled</h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            You are signed in{email ? ` as ${email}` : ""}. The app loads{" "}
            <code className="text-zinc-300 bg-[#12121A] px-1.5 py-0.5 rounded border border-[#27273A] text-xs">
              {docPath}
            </code>{" "}
            in project{" "}
            <code className="text-zinc-300 bg-[#12121A] px-1.5 py-0.5 rounded border border-[#27273A] text-xs">
              {FIREBASE_PROJECT_ID}
            </code>
            .
          </p>
        </div>

        <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-4 mb-6 text-left">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Your Firebase Auth user ID</p>
          <p className="text-xs text-amber-200/90 mb-2">
            The Firestore document ID must match this exactly (not your email).
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-zinc-300 break-all bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2">
              {authUid}
            </code>
            <button
              type="button"
              onClick={copyUid}
              className="shrink-0 p-2 rounded-lg border border-[#27273A] text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
              title="Copy UID"
            >
              <Copy size={16} />
            </button>
          </div>
          {copied && <p className="text-[11px] text-emerald-400 mt-2">Copied.</p>}
        </div>

        {firestoreError && (
          <div className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <p className="font-medium text-red-200 mb-1">Firestore error: {firestoreError}</p>
            <p className="text-xs text-red-300/80">
              If this is <code className="text-red-200">permission-denied</code>, deploy the project&apos;s{" "}
              <code className="text-red-200">firestore.rules</code> or confirm you&apos;re using the same Firebase project as the console.
            </p>
          </div>
        )}

        {!firestoreError && docMissing && (
          <p className="text-sm text-zinc-500 mb-6 text-center">
            No document found at that path. In Firestore, rename or recreate the doc so its ID equals the UID above, or add a new doc with that ID and{" "}
            <code className="text-zinc-400">role: &quot;admin&quot;</code>.
          </p>
        )}

        {!firestoreError && !docMissing && (
          <p className="text-sm text-zinc-500 mb-6 text-center">
            If a doc exists but you still see this, check that <code className="text-zinc-400">role</code> is{" "}
            <code className="text-zinc-400">admin</code> or <code className="text-zinc-400">team_member</code>.
          </p>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => signOut()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#12121A] border border-[#27273A] text-sm text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </motion.div>
    </div>
  );
}
