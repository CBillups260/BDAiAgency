import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

/** Shown on access troubleshooting; must match the project where `team_members` lives. */
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;

export const app = initializeApp(firebaseConfig);
export const firestore = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const analytics = isSupported().then((supported) =>
  supported ? getAnalytics(app) : null
);

export const COLLECTIONS = {
  agents: "agents",
  tasks: "tasks",
  activityLog: "activity_log",
  conversations: "conversations",
  messages: "messages",
  accounts: "accounts",
  contacts: "contacts",
  servicesCatalog: "services_catalog",
  menuItems: "menu_items",
  mediaAssets: "media_assets",
  prospects: "prospects",
  emailSequences: "email_sequences",
  gmailTokens: "gmail_tokens",
  searchCache: "prospecting_search_cache",
  enrichmentCache: "prospecting_enrichment_cache",
  businessSettings: "business_settings",
  financialGoals: "financial_goals",
  expenses: "expenses",
  territoryState: "territory_state",
  teamMembers: "team_members",
  scheduleHandoffs: "schedule_handoffs",
} as const;
