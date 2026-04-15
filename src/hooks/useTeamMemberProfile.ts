import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { firestore, COLLECTIONS } from "../lib/firebase";
import { normalizeAppUserRole, type AppUserRole } from "../lib/userRoles";

export interface TeamMemberProfile {
  role: AppUserRole;
  email?: string | null;
  displayName?: string | null;
}

export function useTeamMemberProfile(uid: string | null) {
  const [profile, setProfile] = useState<TeamMemberProfile | null>(null);
  const [loading, setLoading] = useState(Boolean(uid));
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const [docMissing, setDocMissing] = useState(false);

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setFirestoreError(null);
      setDocMissing(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFirestoreError(null);
    setDocMissing(false);
    const ref = doc(firestore, COLLECTIONS.teamMembers, uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setProfile(null);
          setDocMissing(true);
          setLoading(false);
          return;
        }
        setDocMissing(false);
        const data = snap.data();
        const role = normalizeAppUserRole(data.role);
        if (!role) {
          setProfile(null);
          setLoading(false);
          return;
        }
        setProfile({
          role,
          email: (data.email as string | undefined) ?? null,
          displayName: (data.displayName as string | undefined) ?? null,
        });
        setLoading(false);
      },
      (err) => {
        console.error("[team_members] listener error:", err?.code, err?.message);
        setProfile(null);
        setFirestoreError(err?.code || err?.message || "firestore_error");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [uid]);

  const isAllowed = profile !== null;
  const isAdmin = profile?.role === "admin";

  return { profile, loading, isAllowed, isAdmin, firestoreError, docMissing };
}
