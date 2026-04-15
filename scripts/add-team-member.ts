/**
 * Create or update team_members/{uid} (Firestore). Requires Firebase Admin credentials.
 *
 * Usage:
 *   npm run team:add -- <firebaseAuthUid> <admin|team_member>
 *   npm run team:add -- --email user@company.com <admin|team_member>
 *
 * Credentials: set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path, or use gcloud auth application-default login.
 */
import { readFileSync } from "fs";
import admin from "firebase-admin";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "ai-designer-b3ea6";

const ROLES = ["admin", "team_member"] as const;
type Role = (typeof ROLES)[number];

function initAdmin() {
  if (admin.apps.length) return;
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    const cred = JSON.parse(readFileSync(path, "utf8")) as admin.ServiceAccount;
    admin.initializeApp({ credential: admin.credential.cert(cred), projectId: PROJECT_ID });
  } else {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
}

function parseRole(s: string): Role {
  const r = s.trim().toLowerCase();
  if (r === "admin" || r === "team_member") return r;
  console.error(`Invalid role "${s}". Use: admin | team_member`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: tsx scripts/add-team-member.ts <firebaseAuthUid> <admin|team_member>\n" +
        "   or: tsx scripts/add-team-member.ts --email user@x.com <admin|team_member>"
    );
    process.exit(1);
  }

  initAdmin();
  const auth = admin.auth();
  const db = admin.firestore();

  let uid: string;
  let emailForDoc: string | undefined;

  if (args[0] === "--email") {
    if (args.length < 3) {
      console.error("Expected: --email user@x.com <admin|team_member>");
      process.exit(1);
    }
    const email = args[1].trim();
    const role = parseRole(args[2]);
    const user = await auth.getUserByEmail(email);
    uid = user.uid;
    emailForDoc = user.email ?? email;
    const displayName = user.displayName ?? null;
    await db.doc(`team_members/${uid}`).set(
      {
        role,
        email: emailForDoc,
        displayName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`team_members/${uid} set to role=${role} (${emailForDoc})`);
    return;
  }

  uid = args[0].trim();
  const role = parseRole(args[1]);
  let displayName: string | null = null;
  try {
    const user = await auth.getUser(uid);
    emailForDoc = user.email;
    displayName = user.displayName ?? null;
  } catch {
    // User may not exist yet in Auth; still allow doc for pre-provisioning
  }

  await db.doc(`team_members/${uid}`).set(
    {
      role,
      ...(emailForDoc ? { email: emailForDoc } : {}),
      ...(displayName != null ? { displayName } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log(`team_members/${uid} set to role=${role}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
