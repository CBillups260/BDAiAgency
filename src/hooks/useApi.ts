import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = '/api';

// ─── Generic fetch helper ─────────────────────────────────
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ─── Agents ───────────────────────────────────────────────
export interface AgentInfo {
  id: string;
  name: string;
  enabled: boolean;
  role: string;
  schedule: string | null;
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const data = await apiFetch<AgentInfo[]>('/agents');
      setAgents(data);
    } catch (e) {
      console.error('Failed to fetch agents:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const toggleAgent = useCallback(async (id: string, enabled: boolean) => {
    try {
      await apiFetch(`/agents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      setAgents(prev => prev.map(a => a.id === id ? { ...a, enabled } : a));
    } catch (e) {
      console.error('Failed to toggle agent:', e);
    }
  }, []);

  return { agents, loading, toggleAgent, refetch: fetchAgents };
}

// ─── Activity Feed (SSE) ─────────────────────────────────
export interface ActivityItem {
  id?: number;
  agentId: string;
  agentName?: string;
  action: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export function useActivityFeed(limit = 20) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  // Load recent activities on mount
  useEffect(() => {
    apiFetch<ActivityItem[]>(`/activity/recent?limit=${limit}`)
      .then(setActivities)
      .catch(console.error);
  }, [limit]);

  // SSE live stream
  useEffect(() => {
    const source = new EventSource(`${API_BASE}/activity/stream`);

    source.addEventListener('activity', (e) => {
      const data = JSON.parse(e.data) as ActivityItem;
      setActivities(prev => [data, ...prev].slice(0, limit));
    });

    source.onerror = () => {
      // EventSource will auto-reconnect
      console.warn('SSE connection lost, reconnecting...');
    };

    return () => source.close();
  }, [limit]);

  return activities;
}

// ─── Chat ─────────────────────────────────────────────────
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

export function useChat(agentId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const sendMessage = useCallback(async (message: string) => {
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setLoading(true);

    try {
      const result = await apiFetch<{ conversationId: string; response: string }>(
        `/chat/${agentId}`,
        {
          method: 'POST',
          body: JSON.stringify({ message, conversationId }),
        }
      );

      setConversationId(result.conversationId);
      setMessages(prev => [...prev, { role: 'assistant', content: result.response }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }, [agentId, conversationId]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
  }, []);

  return { messages, loading, sendMessage, clearChat };
}

// ─── Accounts ─────────────────────────────────────────────
export interface SocialHandles {
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  tiktok?: string;
  facebook?: string;
  youtube?: string;
}

export interface Account {
  id: number;
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
  socialHandles: SocialHandles | null;
  servicesSubscribed: string[] | null;
  contractStart: string | null;
  contractEnd: string | null;
  monthlyRetainer: string | null;
  status: string;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  createdAt?: string;
}

export interface Contact {
  id: number;
  accountId: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
  avatar: string | null;
  createdAt?: string;
}

export interface AccountWithContacts extends Account {
  contacts: Contact[];
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await apiFetch<Account[]>('/accounts');
      setAccounts(data);
    } catch (e) {
      console.error('Failed to fetch accounts:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  return { accounts, loading, refetch: fetchAccounts };
}

export function useAccount(id: number | null) {
  const [account, setAccount] = useState<AccountWithContacts | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchAccount = useCallback(async () => {
    if (!id) { setAccount(null); return; }
    setLoading(true);
    try {
      const data = await apiFetch<AccountWithContacts>(`/accounts/${id}`);
      setAccount(data);
    } catch (e) {
      console.error('Failed to fetch account:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAccount(); }, [fetchAccount]);

  return { account, loading, refetch: fetchAccount };
}

export function useAccountMutations() {
  const createAccount = useCallback(async (data: Partial<Account>) => {
    return apiFetch<Account>('/accounts', { method: 'POST', body: JSON.stringify(data) });
  }, []);

  const updateAccount = useCallback(async (id: number, data: Partial<Account>) => {
    return apiFetch<Account>(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }, []);

  const deleteAccount = useCallback(async (id: number) => {
    return apiFetch<{ ok: boolean }>(`/accounts/${id}`, { method: 'DELETE' });
  }, []);

  const createContact = useCallback(async (accountId: number, data: Partial<Contact>) => {
    return apiFetch<Contact>(`/accounts/${accountId}/contacts`, { method: 'POST', body: JSON.stringify(data) });
  }, []);

  const updateContact = useCallback(async (accountId: number, contactId: number, data: Partial<Contact>) => {
    return apiFetch<Contact>(`/accounts/${accountId}/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify(data) });
  }, []);

  const deleteContact = useCallback(async (accountId: number, contactId: number) => {
    return apiFetch<{ ok: boolean }>(`/accounts/${accountId}/contacts/${contactId}`, { method: 'DELETE' });
  }, []);

  return { createAccount, updateAccount, deleteAccount, createContact, updateContact, deleteContact };
}

// ─── Caption Generation ──────────────────────────────────
export interface CaptionRequest {
  accountId: number;
  platform: string;
  topic: string;
  style: string;
  includeHashtags: boolean;
  includeEmojis: boolean;
  captionLength: string;
}

export interface CaptionResponse {
  captions: string[];
  platform: string;
  charLimit: number;
  account: { id: number; company: string; avatar: string | null };
}

export function useGenerateCaption() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CaptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (req: CaptionRequest) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<CaptionResponse>('/content/generate-caption', {
        method: 'POST',
        body: JSON.stringify(req),
      });
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { generate, result, loading, error };
}

// ─── Services ─────────────────────────────────────────────
export interface Service {
  id: number;
  name: string;
  description: string | null;
  status: string;
  clients: number | null;
  pricing: Record<string, string> | null;
  margin: number | null;
  sopStatus: string | null;
  vendors: string[] | null;
  upsells: string[] | null;
}

export function useServices() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Service[]>('/services')
      .then(setServices)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { services, loading };
}

// ─── SSE Task Updates ─────────────────────────────────────
export interface TaskUpdate {
  taskId: string;
  agentId: string;
  status: string;
  type?: string;
}

export function useTaskUpdates() {
  const [currentTasks, setCurrentTasks] = useState<Record<string, string>>({});

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/activity/stream`);

    source.addEventListener('agent_status', (e) => {
      const data = JSON.parse(e.data) as { agentId: string; currentTask: string };
      setCurrentTasks(prev => ({ ...prev, [data.agentId]: data.currentTask }));
    });

    source.addEventListener('task_update', (e) => {
      const data = JSON.parse(e.data) as TaskUpdate;
      if (data.status === 'completed' || data.status === 'failed') {
        setCurrentTasks(prev => {
          const next = { ...prev };
          delete next[data.agentId];
          return next;
        });
      }
    });

    return () => source.close();
  }, []);

  return currentTasks;
}

// ─── Prospecting ─────────────────────────────────────────

export function useProspecting() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchBusiness = useCallback(
    async (businessName: string, location?: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ results: any[] }>("/prospecting/search", {
          method: "POST",
          body: JSON.stringify({ businessName, location }),
        });
        return data.results;
      } catch (err: any) {
        setError(err.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const findFacebookUrl = useCallback(
    async (businessName: string, location?: string) => {
      try {
        const data = await apiFetch<{ facebookUrl: string | null }>(
          "/prospecting/find-facebook",
          {
            method: "POST",
            body: JSON.stringify({ businessName, location }),
          }
        );
        return data.facebookUrl;
      } catch {
        return null;
      }
    },
    []
  );

  const enrichFacebook = useCallback(async (facebookUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ profile: any; posts: any[] }>(
        "/prospecting/enrich",
        {
          method: "POST",
          body: JSON.stringify({ facebookUrl }),
        }
      );
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const draftOutreach = useCallback(
    async (
      prospect: {
        businessName: string;
        email: string;
        category: string;
        address: string;
        website: string;
        pageIntro: string;
        recentPosts: { text: string; date: string }[];
        googleRating: number | null;
        googleReviewCount: number | null;
        followerCount: number;
        prospectLat: number | null;
        prospectLng: number | null;
      },
      serviceName: string,
      serviceDescription: string,
      sender?: {
        userName?: string;
        userEmail?: string;
        agencyName?: string;
        agencyDescription?: string;
        agencyWebsite?: string;
        agencyEmail?: string;
        agencyPhone?: string;
        ownerName?: string;
        ownerTitle?: string;
        brandVoice?: string;
        valuePropositions?: string[];
        caseStudies?: string;
        signOffName?: string;
        agencyLat?: number;
        agencyLng?: number;
        localRadiusMiles?: number;
      }
    ) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{
          drafts: {
            dayNumber: number;
            emailSubject: string;
            emailBody: string;
            dmBody: string;
          }[];
        }>("/prospecting/draft-emails", {
          method: "POST",
          body: JSON.stringify({ prospect, serviceName, serviceDescription, sender }),
        });
        return data.drafts;
      } catch (err: any) {
        setError(err.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const getGmailAuthUrl = useCallback(async () => {
    try {
      const data = await apiFetch<{ url: string }>("/prospecting/gmail/auth-url");
      return data.url;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, []);

  const getGmailStatus = useCallback(async () => {
    try {
      return await apiFetch<{ connected: boolean; email: string | null }>(
        "/prospecting/gmail/status"
      );
    } catch {
      return { connected: false, email: null };
    }
  }, []);

  const sendEmail = useCallback(
    async (to: string, subject: string, body: string) => {
      try {
        const data = await apiFetch<{ messageId: string }>(
          "/prospecting/gmail/send",
          {
            method: "POST",
            body: JSON.stringify({ to, subject, body }),
          }
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        return null;
      }
    },
    []
  );

  const searchNearby = useCallback(
    async (lat: number, lng: number, radius?: number, type?: string, keyword?: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ results: any[] }>("/prospecting/nearby", {
          method: "POST",
          body: JSON.stringify({ lat, lng, radius, type: type || undefined, keyword: keyword || undefined }),
        });
        return data.results;
      } catch (err: any) {
        setError(err.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    loading,
    error,
    searchBusiness,
    searchNearby,
    findFacebookUrl,
    enrichFacebook,
    draftOutreach,
    getGmailAuthUrl,
    getGmailStatus,
    sendEmail,
  };
}
