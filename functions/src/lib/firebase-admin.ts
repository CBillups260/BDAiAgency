import { initializeApp, getApps, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

if (getApps().length === 0) {
  // In Cloud Functions, applicationDefault() picks up the runtime service account.
  // For local dev with the Functions emulator, GOOGLE_APPLICATION_CREDENTIALS env var
  // (path to a service account JSON) is honored automatically.
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    initializeApp({ credential: applicationDefault() });
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    initializeApp({ credential: cert(parsed) });
  } else {
    initializeApp();
  }
}

export const db = getFirestore();
export const auth = getAuth();

// Deployed functions get the default bucket from FIREBASE_CONFIG; local dev has
// no such env, so name it explicitly (overridable for other environments).
const BUCKET =
  process.env.STORAGE_BUCKET || "ai-designer-b3ea6.firebasestorage.app";
export const storageBucket = () => getStorage().bucket(BUCKET);
