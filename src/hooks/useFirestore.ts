import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  serverTimestamp,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firestore, COLLECTIONS } from "../lib/firebase";

function docToObj<T>(snap: QueryDocumentSnapshot): T {
  return { id: snap.id, ...snap.data() } as T;
}

// ─── Shared CRM types (Firestore uses string IDs) ───────

export const ACCOUNT_TYPES = [
  "General",
  "Restaurant",
  "Agency",
  "SaaS",
  "E-commerce",
  "Healthcare",
  "Real Estate",
  "Professional Services",
  "Media & Entertainment",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface FirestoreAccount {
  id: string;
  name: string;
  company: string;
  email: string | null;
  avatar: string | null;
  logo: string | null;
  platform: string | null;
  industry: string | null;
  website: string | null;
  description: string | null;
  brandVoice: string | null;
  targetAudience: string | null;
  brandColors: string[] | null;
  primaryLogo: string | null;
  lightLogo: string | null;
  darkLogo: string | null;
  brandFont: string | null;
  brandFontData: string | null; // base64 font file for custom uploads
  socialHandles: Record<string, string> | null;
  servicesSubscribed: string[] | null;
  contractStart: string | null;
  contractEnd: string | null;
  monthlyRetainer: string | null;
  status: string;
  accountType: AccountType | null;
  notes: string | null;
  /** Go High Level sub-account id for Social Planner / API (set in CRM). */
  ghlLocationId?: string | null;
  /** Optional location-level Private Integration token (Social Planner scopes); server also supports GHL_LOCATION_TOKENS. */
  ghlPrivateIntegrationToken?: string | null;
  metadata: Record<string, unknown> | null;
  createdAt?: any;
}

export interface FirestoreContact {
  id: string;
  accountId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
  avatar: string | null;
  createdAt?: any;
}

export interface FirestoreMenuItem {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  price: string | null;
  category: string;
  image: string | null;
  available: boolean;
  createdAt?: any;
}

export interface FirestoreAccountWithContacts extends FirestoreAccount {
  contacts: FirestoreContact[];
  menuItems: FirestoreMenuItem[];
}

// ─── Accounts (real-time) ────────────────────────────────

export function useFirestoreAccounts() {
  const [accounts, setAccounts] = useState<FirestoreAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(firestore, COLLECTIONS.accounts);
    const q = query(col, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setAccounts(snap.docs.map((d) => docToObj<FirestoreAccount>(d)));
      setLoading(false);
    }, () => {
      setLoading(false);
    });
    return unsub;
  }, []);

  return { accounts, loading };
}

// ─── Single Account + Contacts (both real-time) ─────────

export function useFirestoreAccount(id: string | null) {
  const [account, setAccount] = useState<FirestoreAccountWithContacts | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) {
      setAccount(null);
      return;
    }
    setLoading(true);

    let accountData: FirestoreAccount | null = null;
    let contactsData: FirestoreContact[] = [];
    let menuItemsData: FirestoreMenuItem[] = [];
    let gotAccount = false;
    let gotContacts = false;
    let gotMenuItems = false;

    function merge() {
      if (!gotAccount || !gotContacts || !gotMenuItems) return;
      if (accountData) {
        setAccount({ ...accountData, contacts: contactsData, menuItems: menuItemsData });
      } else {
        setAccount(null);
      }
      setLoading(false);
    }

    const unsubAccount = onSnapshot(
      doc(firestore, COLLECTIONS.accounts, id),
      (snap) => {
        gotAccount = true;
        accountData = snap.exists()
          ? ({ id: snap.id, ...snap.data() } as FirestoreAccount)
          : null;
        merge();
      },
      () => { gotAccount = true; merge(); }
    );

    const contactsQuery = query(
      collection(firestore, COLLECTIONS.contacts),
      where("accountId", "==", id)
    );
    const unsubContacts = onSnapshot(contactsQuery, (snap) => {
      gotContacts = true;
      contactsData = snap.docs.map((d) => docToObj<FirestoreContact>(d));
      merge();
    }, () => { gotContacts = true; merge(); });

    const menuItemsQuery = query(
      collection(firestore, COLLECTIONS.menuItems),
      where("accountId", "==", id)
    );
    const unsubMenuItems = onSnapshot(menuItemsQuery, (snap) => {
      gotMenuItems = true;
      menuItemsData = snap.docs.map((d) => docToObj<FirestoreMenuItem>(d));
      merge();
    }, () => { gotMenuItems = true; merge(); });

    return () => {
      unsubAccount();
      unsubContacts();
      unsubMenuItems();
    };
  }, [id]);

  return { account, loading };
}

// ─── Account & Contact Mutations ─────────────────────────

export function useFirestoreAccountMutations() {
  const createAccount = useCallback(
    async (data: Partial<FirestoreAccount>) => {
      const { id: _id, ...rest } = data as any;
      const ref = await addDoc(collection(firestore, COLLECTIONS.accounts), {
        ...rest,
        createdAt: serverTimestamp(),
      });
      return { ...rest, id: ref.id } as FirestoreAccount;
    },
    []
  );

  const updateAccount = useCallback(
    async (id: string, data: Partial<FirestoreAccount>) => {
      const { id: _id, ...rest } = data as any;
      await updateDoc(
        doc(firestore, COLLECTIONS.accounts, id),
        rest as DocumentData
      );
      return { ...rest, id } as FirestoreAccount;
    },
    []
  );

  const deleteAccount = useCallback(async (id: string) => {
    const contactsSnap = await getDocs(
      query(
        collection(firestore, COLLECTIONS.contacts),
        where("accountId", "==", id)
      )
    );
    await Promise.all(contactsSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(firestore, COLLECTIONS.accounts, id));
    return { ok: true };
  }, []);

  const createContact = useCallback(
    async (accountId: string, data: Partial<FirestoreContact>) => {
      const { id: _id, ...rest } = data as any;
      const ref = await addDoc(collection(firestore, COLLECTIONS.contacts), {
        ...rest,
        accountId,
        createdAt: serverTimestamp(),
      });
      return { ...rest, id: ref.id, accountId } as FirestoreContact;
    },
    []
  );

  const updateContact = useCallback(
    async (_accountId: string, contactId: string, data: Partial<FirestoreContact>) => {
      const { id: _id, ...rest } = data as any;
      await updateDoc(
        doc(firestore, COLLECTIONS.contacts, contactId),
        rest as DocumentData
      );
      return { ...rest, id: contactId } as FirestoreContact;
    },
    []
  );

  const deleteContact = useCallback(
    async (_accountId: string, contactId: string) => {
      await deleteDoc(doc(firestore, COLLECTIONS.contacts, contactId));
      return { ok: true };
    },
    []
  );

  const createMenuItem = useCallback(
    async (accountId: string, data: Partial<FirestoreMenuItem>) => {
      const { id: _id, ...rest } = data as any;
      const ref = await addDoc(collection(firestore, COLLECTIONS.menuItems), {
        ...rest,
        accountId,
        createdAt: serverTimestamp(),
      });
      return { ...rest, id: ref.id, accountId } as FirestoreMenuItem;
    },
    []
  );

  const updateMenuItem = useCallback(
    async (_accountId: string, itemId: string, data: Partial<FirestoreMenuItem>) => {
      const { id: _id, ...rest } = data as any;
      await updateDoc(
        doc(firestore, COLLECTIONS.menuItems, itemId),
        rest as DocumentData
      );
      return { ...rest, id: itemId } as FirestoreMenuItem;
    },
    []
  );

  const deleteMenuItem = useCallback(
    async (_accountId: string, itemId: string) => {
      await deleteDoc(doc(firestore, COLLECTIONS.menuItems, itemId));
      return { ok: true };
    },
    []
  );

  return {
    createAccount,
    updateAccount,
    deleteAccount,
    createContact,
    updateContact,
    deleteContact,
    createMenuItem,
    updateMenuItem,
    deleteMenuItem,
  };
}

// ─── Agents (real-time) ──────────────────────────────────

export interface FirestoreAgentInfo {
  id: string;
  name: string;
  enabled: boolean;
  role: string;
  schedule: string | null;
}

export function useFirestoreAgents() {
  const [agents, setAgents] = useState<FirestoreAgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(firestore, COLLECTIONS.agents);
    const unsub = onSnapshot(col, (snap) => {
      setAgents(snap.docs.map((d) => docToObj<FirestoreAgentInfo>(d)));
      setLoading(false);
    });
    return unsub;
  }, []);

  const toggleAgent = useCallback(async (id: string, enabled: boolean) => {
    await updateDoc(doc(firestore, COLLECTIONS.agents, id), { enabled });
  }, []);

  return { agents, loading, toggleAgent };
}

// ─── Activity Feed (real-time) ───────────────────────────

export interface FirestoreActivityItem {
  id: string;
  agentId: string;
  agentName?: string;
  action: string;
  metadata?: Record<string, unknown>;
  createdAt: any;
}

export function useFirestoreActivityFeed(feedLimit = 20) {
  const [activities, setActivities] = useState<FirestoreActivityItem[]>([]);

  useEffect(() => {
    const col = collection(firestore, COLLECTIONS.activityLog);
    const q = query(col, orderBy("createdAt", "desc"), firestoreLimit(feedLimit));
    const unsub = onSnapshot(q, (snap) => {
      setActivities(snap.docs.map((d) => docToObj<FirestoreActivityItem>(d)));
    });
    return unsub;
  }, [feedLimit]);

  return activities;
}

// ─── Services (real-time) ────────────────────────────────

export interface PricingTier {
  name: string;
  price: string;
  features: string[];
}

export interface OnboardingStep {
  order: number;
  title: string;
  description: string;
  timeline: string;
}

export interface OnboardingEmail {
  order: number;
  name: string;
  sendDay: string;
  subject: string;
  body: string;
}

export interface ServiceAnalysis {
  coreDeliverables: string[];
  idealClient: string;
  commonFailurePoints: string[];
  keyDifferentiators: string[];
  requiredSkills: string[];
  marginProtectors: string[];
}

export interface SOPPart {
  id: string;
  title: string;
  description: string;
  order: number;
  content: string | null;
  recommended: boolean;
}

export interface FirestoreService {
  id: string;
  name: string;
  description: string | null;
  analysis: ServiceAnalysis | null;
  status: string;
  clients: number | null;
  pricing: Record<string, string> | null;
  pricingTiers: PricingTier[] | null;
  pricingNotes: string | null;
  margin: number | null;
  sopStatus: string | null;
  sop: string | null;
  sopParts: SOPPart[] | null;
  trainingDocs: string | null;
  onboardingSteps: OnboardingStep[] | null;
  onboardingEmails: OnboardingEmail[] | null;
  vendors: string[] | null;
  upsells: string[] | null;
  createdAt?: any;
}

export function useFirestoreServices() {
  const [services, setServices] = useState<FirestoreService[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(firestore, COLLECTIONS.servicesCatalog);
    const unsub = onSnapshot(col, (snap) => {
      setServices(snap.docs.map((d) => docToObj<FirestoreService>(d)));
      setLoading(false);
    });
    return unsub;
  }, []);

  return { services, loading };
}

export function useFirestoreServiceMutations() {
  const createService = useCallback(
    async (data: Partial<FirestoreService>) => {
      const { id: _id, ...rest } = data as any;
      const ref = await addDoc(collection(firestore, COLLECTIONS.servicesCatalog), {
        ...rest,
        createdAt: serverTimestamp(),
      });
      return { ...rest, id: ref.id } as FirestoreService;
    },
    []
  );

  const updateService = useCallback(
    async (id: string, data: Partial<FirestoreService>) => {
      const { id: _id, ...rest } = data as any;
      await updateDoc(
        doc(firestore, COLLECTIONS.servicesCatalog, id),
        rest as DocumentData
      );
      return { ...rest, id } as FirestoreService;
    },
    []
  );

  const deleteService = useCallback(async (id: string) => {
    await deleteDoc(doc(firestore, COLLECTIONS.servicesCatalog, id));
    return { ok: true };
  }, []);

  return { createService, updateService, deleteService };
}

// ─── Media Assets ────────────────────────────────────────

export interface FirestoreMediaAsset {
  id: string;
  accountId: string;
  name: string;
  category: string;
  tags: string[];
  description: string | null;
  menuMatch: string | null;
  imageUrl: string;       // Firebase Storage URL
  mimeType: string;
  createdAt?: any;
}

export function useFirestoreMediaAssets(accountId: string | null) {
  const [assets, setAssets] = useState<FirestoreMediaAsset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setAssets([]);
      return;
    }
    setLoading(true);
    const q = query(
      collection(firestore, COLLECTIONS.mediaAssets),
      where("accountId", "==", accountId),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setAssets(snap.docs.map((d) => docToObj<FirestoreMediaAsset>(d)));
      setLoading(false);
    }, () => { setLoading(false); });
    return unsub;
  }, [accountId]);

  const addAsset = useCallback(async (data: Omit<FirestoreMediaAsset, 'id'>) => {
    const { ...rest } = data as any;
    const ref = await addDoc(collection(firestore, COLLECTIONS.mediaAssets), {
      ...rest,
      createdAt: serverTimestamp(),
    });
    return { ...rest, id: ref.id } as FirestoreMediaAsset;
  }, []);

  const removeAsset = useCallback(async (id: string) => {
    await deleteDoc(doc(firestore, COLLECTIONS.mediaAssets, id));
  }, []);

  return { assets, loading, addAsset, removeAsset };
}

// ─── Prospects (real-time) ────────────────────────────────

export interface FirestoreProspect {
  id: string;
  serviceId: string;
  serviceName: string;
  businessName: string;
  googlePlacesData: Record<string, unknown> | null;
  facebookProfile: Record<string, unknown> | null;
  facebookPosts: Record<string, unknown>[] | null;
  email: string;
  phone: string;
  website: string;
  address: string;
  category: string;
  status: "new" | "enriched" | "emailing" | "converted" | "lost";
  lastAction: string | null;
  lastActionAt: string | null;
  createdAt?: any;
}

export function useFirestoreProspects() {
  const [prospects, setProspects] = useState<FirestoreProspect[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(firestore, COLLECTIONS.prospects);
    const q = query(col, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProspects(snap.docs.map((d) => docToObj<FirestoreProspect>(d)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const addProspect = useCallback(
    async (data: Omit<FirestoreProspect, "id">) => {
      const ref = await addDoc(collection(firestore, COLLECTIONS.prospects), {
        ...data,
        createdAt: serverTimestamp(),
      });
      return { ...data, id: ref.id } as FirestoreProspect;
    },
    []
  );

  const updateProspect = useCallback(
    async (id: string, data: Partial<FirestoreProspect>) => {
      const { id: _id, ...rest } = data as any;
      await updateDoc(
        doc(firestore, COLLECTIONS.prospects, id),
        rest as DocumentData
      );
    },
    []
  );

  const deleteProspect = useCallback(async (id: string) => {
    const seqSnap = await getDocs(
      query(
        collection(firestore, COLLECTIONS.emailSequences),
        where("prospectId", "==", id)
      )
    );
    await Promise.all(seqSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(firestore, COLLECTIONS.prospects, id));
  }, []);

  return { prospects, loading, addProspect, updateProspect, deleteProspect };
}

// ─── Email/DM Sequences (real-time) ─────────────────────

export interface FirestoreEmailSequence {
  id: string;
  prospectId: string;
  dayNumber: number;
  type: "email" | "dm";
  subject: string;
  body: string;
  status: "draft" | "scheduled" | "sent" | "opened" | "replied";
  sentAt: string | null;
  openedAt: string | null;
  openedVia: "gmail" | "messenger" | null;
  scheduledFor: string | null;
  createdAt?: any;
}

export function useFirestoreEmailSequences(prospectId: string | null) {
  const [sequences, setSequences] = useState<FirestoreEmailSequence[]>([]);
  const [loading, setLoading] = useState(false);
  const cleanedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!prospectId) {
      setSequences([]);
      return;
    }
    setLoading(true);
    const q = query(
      collection(firestore, COLLECTIONS.emailSequences),
      where("prospectId", "==", prospectId),
      orderBy("dayNumber", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map((d) => docToObj<FirestoreEmailSequence>(d));

        const newest = new Map<string, FirestoreEmailSequence>();
        const duplicateIds: string[] = [];
        for (const seq of all) {
          const key = `${seq.dayNumber}-${seq.type}`;
          const existing = newest.get(key);
          if (!existing) {
            newest.set(key, seq);
          } else {
            const existingTime = existing.createdAt?.toMillis?.() ?? existing.createdAt?.seconds * 1000 ?? 0;
            const seqTime = seq.createdAt?.toMillis?.() ?? seq.createdAt?.seconds * 1000 ?? 0;
            if (seqTime > existingTime) {
              duplicateIds.push(existing.id);
              newest.set(key, seq);
            } else {
              duplicateIds.push(seq.id);
            }
          }
        }

        setSequences(Array.from(newest.values()).sort((a, b) => a.dayNumber - b.dayNumber));
        setLoading(false);

        if (duplicateIds.length > 0 && !cleanedRef.current.has(prospectId)) {
          cleanedRef.current.add(prospectId);
          Promise.all(
            duplicateIds.map((id) =>
              deleteDoc(doc(firestore, COLLECTIONS.emailSequences, id))
            )
          ).catch(() => {});
        }
      },
      () => setLoading(false)
    );
    return unsub;
  }, [prospectId]);

  const saveEmailSequence = useCallback(
    async (
      prospectId: string,
      drafts: {
        dayNumber: number;
        emailSubject: string;
        emailBody: string;
        dmBody: string;
      }[]
    ) => {
      const existingSnap = await getDocs(
        query(
          collection(firestore, COLLECTIONS.emailSequences),
          where("prospectId", "==", prospectId)
        )
      );
      if (!existingSnap.empty) {
        await Promise.all(existingSnap.docs.map((d) => deleteDoc(d.ref)));
      }

      const docs: Parameters<typeof addDoc>[1][] = [];
      for (const draft of drafts) {
        docs.push({
          prospectId,
          dayNumber: draft.dayNumber,
          type: "email",
          subject: draft.emailSubject,
          body: draft.emailBody,
          status: "draft",
          sentAt: null,
          openedAt: null,
          openedVia: null,
          scheduledFor: null,
          createdAt: serverTimestamp(),
        });
        docs.push({
          prospectId,
          dayNumber: draft.dayNumber,
          type: "dm",
          subject: "",
          body: draft.dmBody,
          status: "draft",
          sentAt: null,
          openedAt: null,
          openedVia: null,
          scheduledFor: null,
          createdAt: serverTimestamp(),
        });
      }
      await Promise.all(
        docs.map((d) =>
          addDoc(collection(firestore, COLLECTIONS.emailSequences), d)
        )
      );
    },
    []
  );

  const updateEmailStatus = useCallback(
    async (
      emailId: string,
      status: FirestoreEmailSequence["status"],
      sentAt?: string
    ) => {
      const updates: Record<string, unknown> = { status };
      if (sentAt) updates.sentAt = sentAt;
      await updateDoc(
        doc(firestore, COLLECTIONS.emailSequences, emailId),
        updates as DocumentData
      );
    },
    []
  );

  const markOpened = useCallback(
    async (
      emailId: string,
      via: "gmail" | "messenger"
    ) => {
      await updateDoc(
        doc(firestore, COLLECTIONS.emailSequences, emailId),
        {
          openedAt: new Date().toISOString(),
          openedVia: via,
          status: "opened",
        } as DocumentData
      );
    },
    []
  );

  const emails = sequences.filter((s) => s.type === "email");
  const dms = sequences.filter((s) => s.type === "dm");

  return { sequences, emails, dms, loading, saveEmailSequence, updateEmailStatus, markOpened };
}

// ─── Prospecting Cache ──────────────────────────────────

export function useProspectingCache() {
  const getCachedSearch = useCallback(
    async (queryKey: string): Promise<any[] | null> => {
      const q = query(
        collection(firestore, COLLECTIONS.searchCache),
        where("queryKey", "==", queryKey),
        firestoreLimit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const data = snap.docs[0].data();
      const age = Date.now() - (data.createdAt?.toMillis?.() || 0);
      if (age > 7 * 24 * 60 * 60 * 1000) return null;
      return data.results || null;
    },
    []
  );

  const setCachedSearch = useCallback(
    async (queryKey: string, results: any[]) => {
      const q = query(
        collection(firestore, COLLECTIONS.searchCache),
        where("queryKey", "==", queryKey),
        firestoreLimit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        await updateDoc(snap.docs[0].ref, {
          results,
          createdAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(firestore, COLLECTIONS.searchCache), {
          queryKey,
          results,
          createdAt: serverTimestamp(),
        });
      }
    },
    []
  );

  const getCachedEnrichment = useCallback(
    async (
      facebookUrl: string
    ): Promise<{ profile: any; posts: any[] } | null> => {
      const q = query(
        collection(firestore, COLLECTIONS.enrichmentCache),
        where("facebookUrl", "==", facebookUrl),
        firestoreLimit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const data = snap.docs[0].data();
      const age = Date.now() - (data.createdAt?.toMillis?.() || 0);
      if (age > 7 * 24 * 60 * 60 * 1000) return null;
      return { profile: data.profile, posts: data.posts };
    },
    []
  );

  const setCachedEnrichment = useCallback(
    async (facebookUrl: string, profile: any, posts: any[]) => {
      const q = query(
        collection(firestore, COLLECTIONS.enrichmentCache),
        where("facebookUrl", "==", facebookUrl),
        firestoreLimit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        await updateDoc(snap.docs[0].ref, {
          profile,
          posts,
          createdAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(firestore, COLLECTIONS.enrichmentCache), {
          facebookUrl,
          profile,
          posts,
          createdAt: serverTimestamp(),
        });
      }
    },
    []
  );

  const getCachedFacebookUrl = useCallback(
    async (businessKey: string): Promise<string | null> => {
      const q = query(
        collection(firestore, COLLECTIONS.enrichmentCache),
        where("businessKey", "==", businessKey),
        firestoreLimit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) return null;
      return snap.docs[0].data().facebookUrl || null;
    },
    []
  );

  return {
    getCachedSearch,
    setCachedSearch,
    getCachedEnrichment,
    setCachedEnrichment,
    getCachedFacebookUrl,
  };
}

// ─── Generic helpers ─────────────────────────────────────

export function useFirestoreCollection<T>(
  collectionName: string,
  ...constraints: QueryConstraint[]
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(firestore, collectionName);
    const q = constraints.length ? query(col, ...constraints) : query(col);
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map((d) => docToObj<T>(d)));
      setLoading(false);
    });
    return unsub;
  }, [collectionName]);

  return { data, loading };
}

export function useFirestoreDoc<T>(
  collectionName: string,
  docId: string | null
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!docId) {
      setData(null);
      return;
    }
    setLoading(true);
    const ref = doc(firestore, collectionName, docId);
    const unsub = onSnapshot(ref, (snap) => {
      setData(snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null);
      setLoading(false);
    });
    return unsub;
  }, [collectionName, docId]);

  return { data, loading };
}

// ─── Financial Goals ─────────────────────────────────────

export interface ServiceMix {
  serviceId: string;
  serviceName: string;
  tierName: string;
  tierPrice: number;
  targetClients: number;
}

export interface FinancialGoal {
  id: string;
  name: string;
  targetMRR: number;
  currentMRR: number;
  timeline: number;
  serviceMix: ServiceMix[];
  closeRate: number;
  avgSalesCycle: number;
  referralRate: number;
  churnRate: number;
  notes: string;
  active: boolean;
  createdAt?: any;
  updatedAt?: any;
}

const DEFAULT_GOAL: Omit<FinancialGoal, "id"> = {
  name: "Growth Goal",
  targetMRR: 0,
  currentMRR: 0,
  timeline: 6,
  serviceMix: [],
  closeRate: 20,
  avgSalesCycle: 30,
  referralRate: 10,
  churnRate: 5,
  notes: "",
  active: true,
};

export function useFinancialGoals() {
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(firestore, COLLECTIONS.financialGoals);
    const q = query(col, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setGoals(snap.docs.map((d) => docToObj<FinancialGoal>(d)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const createGoal = useCallback(async (data?: Partial<FinancialGoal>) => {
    const payload = { ...DEFAULT_GOAL, ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    const ref = await addDoc(collection(firestore, COLLECTIONS.financialGoals), payload);
    return { ...payload, id: ref.id } as FinancialGoal;
  }, []);

  const updateGoal = useCallback(async (id: string, data: Partial<FinancialGoal>) => {
    const { id: _id, ...rest } = data as any;
    await updateDoc(doc(firestore, COLLECTIONS.financialGoals, id), {
      ...rest,
      updatedAt: serverTimestamp(),
    } as DocumentData);
  }, []);

  const deleteGoal = useCallback(async (id: string) => {
    await deleteDoc(doc(firestore, COLLECTIONS.financialGoals, id));
  }, []);

  const activeGoal = goals.find((g) => g.active) || goals[0] || null;

  return { goals, activeGoal, loading, createGoal, updateGoal, deleteGoal };
}

// ─── Expenses ────────────────────────────────────────────

export type ExpenseCategory =
  | "outsourcing"
  | "vendors"
  | "tools"
  | "overhead"
  | "salaries"
  | "marketing"
  | "other";

export interface Expense {
  id: string;
  name: string;
  category: ExpenseCategory;
  amount: number;
  recurring: boolean;
  linkedServiceId: string | null;
  notes: string;
  createdAt?: any;
}

export function useExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(firestore, COLLECTIONS.expenses);
    const unsub = onSnapshot(
      col,
      (snap) => {
        setExpenses(snap.docs.map((d) => docToObj<Expense>(d)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const addExpense = useCallback(async (data: Omit<Expense, "id">) => {
    const ref = await addDoc(collection(firestore, COLLECTIONS.expenses), {
      ...data,
      createdAt: serverTimestamp(),
    });
    return { ...data, id: ref.id } as Expense;
  }, []);

  const updateExpense = useCallback(async (id: string, data: Partial<Expense>) => {
    const { id: _id, ...rest } = data as any;
    await updateDoc(doc(firestore, COLLECTIONS.expenses, id), rest as DocumentData);
  }, []);

  const deleteExpense = useCallback(async (id: string) => {
    await deleteDoc(doc(firestore, COLLECTIONS.expenses, id));
  }, []);

  const totalMonthly = expenses.filter((e) => e.recurring).reduce((sum, e) => sum + e.amount, 0);
  const totalOneTime = expenses.filter((e) => !e.recurring).reduce((sum, e) => sum + e.amount, 0);

  return { expenses, loading, addExpense, updateExpense, deleteExpense, totalMonthly, totalOneTime };
}

// ─── Outreach Stats (aggregate across all prospects) ─────

export function useOutreachStats() {
  const [stats, setStats] = useState({
    totalEmails: 0,
    emailsSent: 0,
    emailsOpened: 0,
    totalDms: 0,
    dmsSent: 0,
    dmsOpened: 0,
    responded: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const col = collection(firestore, COLLECTIONS.emailSequences);
    const unsub = onSnapshot(
      col,
      (snap) => {
        let totalEmails = 0, emailsSent = 0, emailsOpened = 0;
        let totalDms = 0, dmsSent = 0, dmsOpened = 0;
        let responded = 0;

        snap.docs.forEach((d) => {
          const data = d.data();
          if (data.type === "email") {
            totalEmails++;
            if (["sent", "opened", "replied"].includes(data.status)) emailsSent++;
            if (["opened", "replied"].includes(data.status)) emailsOpened++;
            if (data.status === "replied") responded++;
          } else if (data.type === "dm") {
            totalDms++;
            if (["sent", "opened", "replied"].includes(data.status)) dmsSent++;
            if (["opened", "replied"].includes(data.status)) dmsOpened++;
            if (data.status === "replied") responded++;
          }
        });

        setStats({ totalEmails, emailsSent, emailsOpened, totalDms, dmsSent, dmsOpened, responded });
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  return { stats, loading };
}

// ─── Business Settings (singleton doc) ───────────────────

export interface BusinessSettings {
  agencyName: string;
  agencyDescription: string;
  agencyWebsite: string;
  agencyEmail: string;
  agencyPhone: string;
  agencyAddress: string;
  ownerName: string;
  ownerTitle: string;
  brandVoice: string;
  valuePropositions: string[];
  caseStudies: string;
  signOffName: string;
  localRadiusMiles: number;
  agencyLat: number;
  agencyLng: number;
  /** HighLevel user id used when creating Social Planner posts (shared for the whole team). */
  ghlDefaultUserId?: string;
  /** HighLevel company (agency) id — used with an agency token to look up users by location. */
  ghlCompanyId?: string;
  updatedAt?: any;
}

const DEFAULT_SETTINGS: BusinessSettings = {
  agencyName: "BrandD AI Agency",
  agencyDescription: "",
  agencyWebsite: "",
  agencyEmail: "",
  agencyPhone: "",
  agencyAddress: "",
  ownerName: "",
  ownerTitle: "",
  brandVoice: "",
  valuePropositions: [],
  caseStudies: "",
  signOffName: "The BrandD AI Agency Team",
  localRadiusMiles: 40,
  agencyLat: 0,
  agencyLng: 0,
  ghlDefaultUserId: "",
  ghlCompanyId: "",
};

export function useBusinessSettings() {
  const [settings, setSettings] = useState<BusinessSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(firestore, COLLECTIONS.businessSettings, "default");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...snap.data() } as BusinessSettings);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  const saveSettings = useCallback(async (data: Partial<BusinessSettings>) => {
    const ref = doc(firestore, COLLECTIONS.businessSettings, "default");
    const {
      updatedAt: _omit,
      ...rest
    } = data as BusinessSettings & { updatedAt?: unknown };
    const payload: Record<string, unknown> = { ...rest, updatedAt: serverTimestamp() };
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }
    await setDoc(ref, payload as DocumentData, { merge: true });
  }, []);

  return { settings, loading, saveSettings };
}

// ─── Territory State (map location + discovered businesses) ──

export interface TerritoryState {
  city: string;
  lat: number;
  lng: number;
  category: string;
  businesses: any[];
}

const EMPTY_TERRITORY: TerritoryState = {
  city: "",
  lat: 0,
  lng: 0,
  category: "all",
  businesses: [],
};

export function useTerritoryState() {
  const [territory, setTerritory] = useState<TerritoryState>(EMPTY_TERRITORY);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ref = doc(firestore, COLLECTIONS.territoryState, "default");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setTerritory({
            city: d.city || "",
            lat: d.lat || 0,
            lng: d.lng || 0,
            category: d.category || "all",
            businesses: d.businesses || [],
          });
        }
        setLoaded(true);
      },
      () => setLoaded(true)
    );
    return unsub;
  }, []);

  const saveTerritory = useCallback(
    async (data: Partial<TerritoryState>) => {
      const ref = doc(firestore, COLLECTIONS.territoryState, "default");
      await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
    },
    []
  );

  return { territory, loaded, saveTerritory };
}
