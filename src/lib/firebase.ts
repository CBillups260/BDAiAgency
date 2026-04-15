import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyAkvNPMQ5UPnUcmXXfR9bRxGGRsxKarvr0",
  authDomain: "ai-designer-b3ea6.firebaseapp.com",
  projectId: "ai-designer-b3ea6",
  storageBucket: "ai-designer-b3ea6.firebasestorage.app",
  messagingSenderId: "309126109469",
  appId: "1:309126109469:web:781b7beaaf4900bcf1e9f4",
  measurementId: "G-P9CMTRVVHR",
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
