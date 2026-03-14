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
export interface Account {
  id: number;
  name: string;
  company: string;
  email: string | null;
  avatar: string | null;
  platform: string | null;
  metadata: Record<string, unknown> | null;
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<Account[]>('/accounts')
      .then(setAccounts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { accounts, loading };
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
