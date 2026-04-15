import { useState, useEffect, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let settled = false;
    const unsub = onAuthStateChanged(auth, (u) => {
      settled = true;
      setUser(u);
      setLoading(false);
    });
    // Fallback: if Firebase never responds, stop loading after 4s
    const timeout = setTimeout(() => {
      if (!settled) {
        console.warn("Firebase auth timed out — showing login screen");
        setLoading(false);
      }
    }, 4000);
    return () => { unsub(); clearTimeout(timeout); };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    return signInWithPopup(auth, googleProvider);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    return signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Same roster UX as Google: Firebase often leaves displayName empty for email/password.
    if (!cred.user.displayName) {
      const local = email.trim().split("@")[0]?.replace(/[._]+/g, " ").trim();
      if (local) await updateProfile(cred.user, { displayName: local });
    }
    return cred;
  }, []);

  const signOut = useCallback(async () => {
    return firebaseSignOut(auth);
  }, []);

  return { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut };
}
