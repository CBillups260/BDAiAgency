import React, { useState, useRef, useEffect, useMemo } from 'react';
import IsometricOffice from './components/IsometricOffice';
import ContentCreation from './components/ContentCreation';
import SocialAnalytics from './components/SocialAnalytics';
import FlowBucket from './components/FlowBucket';
import AccountsCRM from './components/AccountsCRM';
import Prospecting from './components/Prospecting';
import Services from './components/Services';
import Settings from './components/Settings';
import FinanceDashboard from './components/FinanceDashboard';
import Tasks from './components/Tasks';
import LoginScreen from './components/LoginScreen';
import AccessPendingScreen from './components/AccessPendingScreen';
import AuthGateLoader from './components/AuthGateLoader';
import { useAuth } from './hooks/useAuth';
import { useTeamMemberProfile } from './hooks/useTeamMemberProfile';
import { APP_ROLES, type AppUserRole } from './lib/userRoles';
import { useAgents, useActivityFeed, useChat, useTaskUpdates } from './hooks/useApi';
import { useFirestoreAccounts } from './hooks/useFirestore';
import { syncTeamMember } from './hooks/useScheduleHandoffs';
import {
  Layout,
  Users,
  Briefcase,
  BarChart2,
  DollarSign,
  Search,
  Star,
  Send,
  Copy,
  ChevronDown,
  CheckCircle,
  Menu,
  X,
  ArrowUpRight,
  Activity,
  TrendingUp,
  FileText,
  Plus,
  Eye,
  RefreshCw,
  ChevronRight,
  Package,
  Shield,
  BookOpen,
  Tag,
  Target,
  CheckSquare,
  AlertTriangle,
  Zap,
  Globe,
  Edit3,
  LogOut,
  Settings as SettingsIcon,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';

// ─── Navigation ─────────────────────────────────────────────
const navItems: {
  id: string;
  label: string;
  icon: typeof Layout;
  featured?: boolean;
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Layout },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare, featured: true },
  { id: 'accounts', label: 'Accounts', icon: Users },
  { id: 'content', label: 'Content Creation', icon: Edit3 },
  { id: 'social', label: 'Social Analytics', icon: TrendingUp },
  { id: 'prospecting', label: 'Prospecting', icon: Target },
  { id: 'services', label: 'Services', icon: Briefcase },
  { id: 'reports', label: 'Reports', icon: BarChart2 },
  { id: 'financials', label: 'Financials', icon: DollarSign },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

// ─── Mock Data: Accounts ────────────────────────────────────
const suggestedSteps = [
  { text: "Follow up with Pinnacle Group regarding Q2 strategy call", type: "follow-up" },
  { text: "Prepare NovaTech for quarterly business review", type: "review" },
  { text: "Onboarding check-in for Meridian Labs — Week 2", type: "onboarding" },
  { text: "Upsell SEO package to Crestline Brands", type: "upsell" },
];

const communications = [
  { id: 1, name: "Sarah Mitchell", company: "Pinnacle Group", time: "12 min ago", message: "Hey team, just wanted to check in on the social media calendar for March. Can we schedule a quick sync?", avatar: "https://i.pravatar.cc/150?u=sarah", platform: "Slack", unread: true },
  { id: 2, name: "James Ortega", company: "NovaTech", time: "2h ago", message: "Monthly performance report looks great. Can we discuss the paid ads recommendations?", avatar: "https://i.pravatar.cc/150?u=james", platform: "Email", unread: false },
  { id: 3, name: "Lisa Chen", company: "Meridian Labs", time: "5h ago", message: "We are onboarding our new product line next month. Can we get ahead on the content strategy?", avatar: "https://i.pravatar.cc/150?u=lisa", platform: "Slack", unread: true },
  { id: 4, name: "David Park", company: "Crestline Brands", time: "1d ago", message: "Really happy with the social growth this quarter. Let's talk about expanding into email marketing.", avatar: "https://i.pravatar.cc/150?u=david", platform: "Email", unread: false },
];

const drafts = [
  { id: 1, client: "Pinnacle Group", title: "Q2 Strategy Sync — Calendar Invite Follow-Up", content: "Hi Sarah, great to hear from you! I've prepared the March social calendar and attached it below. I'd love to schedule a 30-minute sync this Thursday at 2 PM to walk through the content themes and make sure everything aligns with your Q2 launch timeline. Let me know if that works!", priority: "high" },
  { id: 2, client: "NovaTech", title: "Monthly Performance Deep-Dive + Paid Ads Proposal", content: "Hi James, glad the report resonated! As you mentioned, the paid ads section has some strong opportunities. I've put together a brief proposal for scaling your Google Ads budget by 20% — projected to drive an additional 1,200 qualified leads this quarter. Attached for your review.", priority: "medium" },
  { id: 3, client: "Meridian Labs", title: "Week 2 Onboarding Check-In + Content Strategy Kickoff", content: "Hi Lisa, thanks for the heads-up on the new product line! I've started drafting a content strategy framework that covers blog posts, social campaigns, and email sequences for the launch. Let's schedule a kickoff call next Tuesday to align on messaging and timelines.", priority: "high" },
];


// ─── Mock Data: Reports ─────────────────────────────────────
const reportClients = [
  { id: 1, name: "Pinnacle Group", services: ["Social Media Management", "Paid Advertising"], lastReport: "Feb 28, 2026", status: "ready" },
  { id: 2, name: "NovaTech", services: ["SEO & Content Marketing", "Web Design"], lastReport: "Mar 1, 2026", status: "ready" },
  { id: 3, name: "Meridian Labs", services: ["Social Media Management", "Email Marketing"], lastReport: "Feb 15, 2026", status: "overdue" },
  { id: 4, name: "Crestline Brands", services: ["Social Media Management", "SEO & Content Marketing"], lastReport: "Mar 5, 2026", status: "ready" },
  { id: 5, name: "Vertex Solutions", services: ["Paid Advertising", "Email Marketing"], lastReport: "Mar 8, 2026", status: "generating" },
];

const reportMetrics = [
  { label: "Reports Generated", value: "24", change: "+6 this month", trend: "up" },
  { label: "Avg. Client Satisfaction", value: "9.2/10", change: "+0.4 vs last month", trend: "up" },
  { label: "Overdue Reports", value: "1", change: "Meridian Labs", trend: "down" },
  { label: "Next Batch Due", value: "Mar 15", change: "3 reports", trend: "neutral" },
];




// ─── Agent Orchestration ────────────────────────────────────
const agentDefinitions = [
  {
    id: 'orchestrator',
    name: 'Orchestrator Agent',
    role: 'Main Agent — coordinates all sub-agents, manages task delegation, and ensures system-wide coherence',
    icon: Globe,
    color: 'from-violet-600 to-fuchsia-500',
    dotColor: 'bg-violet-400',
    currentTask: 'Monitoring all agent workflows',
    tasksCompleted: 47,
    isCore: true,
    pixelColor: '#a855f7',
  },
  {
    id: 'accounts',
    name: 'Account Agent',
    role: 'Client relationships, communications, follow-ups, upsells, onboarding',
    icon: Users,
    color: 'from-purple-600 to-purple-400',
    dotColor: 'bg-purple-400',
    currentTask: 'Drafting follow-up for Pinnacle Group',
    tasksCompleted: 12,
    isCore: false,
    pixelColor: '#c084fc',
  },
  {
    id: 'services',
    name: 'Service Agent',
    role: 'Service plans, pricing, SOPs, vendor management, training docs',
    icon: Briefcase,
    color: 'from-blue-600 to-blue-400',
    dotColor: 'bg-blue-400',
    currentTask: 'Updating Paid Advertising SOP',
    tasksCompleted: 8,
    isCore: false,
    pixelColor: '#60a5fa',
  },
  {
    id: 'reports',
    name: 'Report Agent',
    role: 'Performance reports, social media analytics, Google Analytics insights',
    icon: BarChart2,
    color: 'from-emerald-600 to-emerald-400',
    dotColor: 'bg-emerald-400',
    currentTask: 'Generating March report for Vertex Solutions',
    tasksCompleted: 6,
    isCore: false,
    pixelColor: '#34d399',
  },
  {
    id: 'financials',
    name: 'Financial Agent',
    role: 'Financial health, profitability, scope creep detection, margin tracking',
    icon: DollarSign,
    color: 'from-amber-600 to-amber-400',
    dotColor: 'bg-amber-400',
    currentTask: 'Analyzing Orion Creative scope creep',
    tasksCompleted: 9,
    isCore: false,
    pixelColor: '#fbbf24',
  },
];

// ─── Mock Data: Dashboard ───────────────────────────────────
const agentActivity = [
  { agent: "Account Agent", action: "Drafted follow-up email for Pinnacle Group", time: "5 min ago", icon: Users },
  { agent: "Service Agent", action: "Updated SOP for Paid Advertising service", time: "22 min ago", icon: Briefcase },
  { agent: "Report Agent", action: "Generated March report for Crestline Brands", time: "1h ago", icon: BarChart2 },
  { agent: "Financial Agent", action: "Flagged scope creep on Orion Creative account", time: "2h ago", icon: DollarSign },
  { agent: "Account Agent", action: "Suggested upsell opportunity for Crestline Brands", time: "3h ago", icon: Users },
  { agent: "Financial Agent", action: "Updated monthly revenue tracking", time: "4h ago", icon: DollarSign },
];

// ─── Component ──────────────────────────────────────────────
export default function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const {
    profile,
    loading: profileLoading,
    isAllowed,
    firestoreError,
    docMissing,
  } = useTeamMemberProfile(user?.uid ?? null);

  if (authLoading) {
    return <AuthGateLoader />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (profileLoading) {
    return <AuthGateLoader />;
  }

  if (!isAllowed || !profile) {
    return (
      <AccessPendingScreen
        signOut={signOut}
        email={user.email}
        authUid={user.uid}
        firestoreError={firestoreError}
        docMissing={docMissing}
      />
    );
  }

  return <AuthenticatedApp user={user} signOut={signOut} role={profile.role} />;
}

function AuthenticatedApp({
  user,
  signOut,
  role,
}: {
  user: import('firebase/auth').User;
  signOut: () => Promise<void>;
  role: AppUserRole;
}) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [message, setMessage] = useState('');
  const [isCopied, setIsCopied] = useState<number | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedReportClient, setSelectedReportClient] = useState<number | null>(null);
  const [accountsSubTab, setAccountsSubTab] = useState<'overview' | 'crm'>('overview');
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);
  const [agentStates, setAgentStates] = useState<Record<string, boolean>>(
    Object.fromEntries(agentDefinitions.map(a => [a.id, true]))
  );
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  const visibleNavItems = useMemo(
    () =>
      role === APP_ROLES.ADMIN
        ? navItems
        : navItems.filter((i) => i.id !== 'financials' && i.id !== 'settings'),
    [role]
  );

  const dashboardQuickActions = useMemo(() => {
    const items = [
      { label: "Tasks", sub: "Featured — agency task workspace", tab: "tasks" as const, icon: CheckSquare, featured: true as const },
      { label: "Review Drafts", sub: "3 pending communications", tab: "accounts" as const, icon: FileText },
      { label: "Service Health", sub: "1 SOP needs attention", tab: "services" as const, icon: Shield },
      { label: "Generate Reports", sub: "1 overdue report", tab: "reports" as const, icon: BarChart2 },
      { label: "Scope Creep Alerts", sub: "4 active warnings", tab: "financials" as const, icon: AlertTriangle },
    ];
    if (role === APP_ROLES.ADMIN) return items;
    return items.filter((a) => a.tab !== 'financials');
  }, [role]);

  useEffect(() => {
    if (role !== APP_ROLES.ADMIN && (activeTab === 'financials' || activeTab === 'settings')) {
      setActiveTab('dashboard');
    }
  }, [role, activeTab]);

  // ─── API Hooks ──────────────────────────────────────────
  const { agents: apiAgents, toggleAgent: apiToggleAgent } = useAgents();
  const activityItems = useActivityFeed(20);
  const accountsChat = useChat('accounts');
  const { accounts: apiAccounts } = useFirestoreAccounts();
  const currentTasks = useTaskUpdates();

  useEffect(() => {
    void syncTeamMember(user);
  }, [user.uid, user.displayName, user.email, user.photoURL]);

  // Sync API agent states into local state
  useEffect(() => {
    if (apiAgents.length > 0) {
      setAgentStates(Object.fromEntries(apiAgents.map(a => [a.id, a.enabled])));
    }
  }, [apiAgents]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
        setIsAgentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeAgentCount = Object.values(agentStates).filter(Boolean).length;
  const toggleAgent = (id: string) => {
    if (id === 'orchestrator') return; // Can't disable orchestrator
    const newState = !agentStates[id];
    setAgentStates(prev => ({ ...prev, [id]: newState }));
    apiToggleAgent(id, newState);
  };

  const handleCopy = (id: number) => {
    setIsCopied(id);
    setTimeout(() => setIsCopied(null), 2000);
  };

  // ─── Dashboard Tab ──────────────────────────────────────
  const renderDashboard = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-7xl mx-auto"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-semibold text-white">Dashboard</h2>
          <p className="text-zinc-400 text-sm mt-1">Agency command center — all AI agents at a glance</p>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Active Accounts", value: "8", sub: "+2 this quarter", icon: Users, color: "from-purple-600 to-purple-400" },
          { label: "Services Offered", value: "5", sub: "78% avg margin", icon: Briefcase, color: "from-blue-600 to-blue-400" },
          { label: "Monthly Revenue", value: "$68.4K", sub: "91% of goal", icon: DollarSign, color: "from-emerald-600 to-emerald-400" },
          { label: "Agent Actions Today", value: "23", sub: "Across all agents", icon: Zap, color: "from-amber-600 to-amber-400" },
        ].map((metric, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.08 }}
            className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6 relative overflow-hidden group hover:border-purple-500/30 transition-colors"
          >
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br opacity-[0.06] rounded-bl-full" style={{ backgroundImage: `linear-gradient(to bottom right, var(--tw-gradient-stops))` }}></div>
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${metric.color} flex items-center justify-center mb-4 shadow-lg`}>
              <metric.icon size={18} className="text-white" />
            </div>
            <p className="text-zinc-400 text-sm mb-1">{metric.label}</p>
            <p className="text-2xl font-semibold text-white">{metric.value}</p>
            <p className="text-xs text-zinc-500 mt-1">{metric.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* 3D Isometric Office Scene */}
      <IsometricOffice activeAgentCount={activeAgentCount} currentTasks={currentTasks} />

      {/* Agency Health + Agent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Agency Health Score */}
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <h3 className="text-lg font-medium text-white mb-6">Agency Health Score</h3>
          <div className="flex items-center justify-center mb-6">
            <div className="relative w-40 h-40">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#27273A" strokeWidth="8" />
                <circle cx="60" cy="60" r="52" fill="none" stroke="url(#healthGrad)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${82 * 3.27} ${326.73 - 82 * 3.27}`} />
                <defs>
                  <linearGradient id="healthGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#9333ea" />
                    <stop offset="100%" stopColor="#a855f7" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-white">82</span>
                <span className="text-xs text-zinc-400">out of 100</span>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {[
              { label: "Client Retention", value: "95%", bar: 95 },
              { label: "Service Delivery", value: "88%", bar: 88 },
              { label: "Financial Health", value: "72%", bar: 72 },
              { label: "Team Capacity", value: "65%", bar: 65 },
            ].map((item, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-zinc-400">{item.label}</span>
                  <span className="text-zinc-300">{item.value}</span>
                </div>
                <div className="h-1.5 bg-[#0A0A0F] rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full transition-all" style={{ width: `${item.bar}%` }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Activity Feed */}
        <div className="lg:col-span-2 bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-white">AI Agent Activity</h3>
            <span className="text-xs text-zinc-500">Live feed</span>
          </div>
          <div className="space-y-1">
            {(activityItems.length > 0 ? activityItems : agentActivity).map((item: any, i: number) => {
              const agentIconMap: Record<string, any> = { accounts: Users, services: Briefcase, reports: BarChart2, financials: DollarSign, orchestrator: Globe };
              const agentNameMap: Record<string, string> = { accounts: 'Account Agent', services: 'Service Agent', reports: 'Report Agent', financials: 'Financial Agent', orchestrator: 'Orchestrator Agent' };
              const isLive = 'agentId' in item;
              const IconComp = isLive ? (agentIconMap[item.agentId] || Activity) : item.icon;
              const agentName = isLive ? (item.agentName || agentNameMap[item.agentId] || item.agentId) : item.agent;
              const actionText = isLive ? item.action.replace(/_/g, ' ') : item.action;
              const timeText = isLive ? new Date(item.createdAt).toLocaleTimeString() : item.time;

              return (
                <motion.div
                  key={isLive ? (item.id || i) : i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.06 }}
                  className="flex items-start gap-4 p-4 rounded-2xl hover:bg-[#181824] transition-colors group"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#0A0A0F] border border-[#27273A] flex items-center justify-center shrink-0 group-hover:border-purple-500/30 transition-colors">
                    <IconComp size={16} className="text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-purple-400">{agentName}</span>
                      <span className="text-[10px] text-zinc-600">{timeText}</span>
                    </div>
                    <p className="text-sm text-zinc-300 leading-relaxed">{actionText}</p>
                  </div>
                  <ChevronRight size={14} className="text-zinc-600 shrink-0 mt-1 group-hover:text-purple-400 transition-colors" />
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick Actions Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {dashboardQuickActions.map((action, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(action.tab)}
            className={`bg-[#12121A] border rounded-2xl p-5 text-left hover:border-purple-500/40 transition-all group ${
              'featured' in action && action.featured
                ? 'border-amber-500/35 ring-1 ring-amber-500/15'
                : 'border-[#27273A]'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <action.icon size={18} className="text-zinc-500 group-hover:text-purple-400 transition-colors" />
              <ArrowUpRight size={14} className="text-zinc-600 group-hover:text-purple-400 transition-colors" />
            </div>
            <p className="text-sm font-medium text-white mb-1 flex items-center gap-2 flex-wrap">
              {action.label}
              {'featured' in action && action.featured && (
                <Star size={12} className="text-amber-400 shrink-0" />
              )}
            </p>
            <p className="text-xs text-zinc-500">{action.sub}</p>
          </button>
        ))}
      </div>
    </motion.div>
  );

  // ─── Accounts Tab ───────────────────────────────────────
  const renderAccounts = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-7xl mx-auto"
    >
      {/* Header + Sub-tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-3xl font-semibold text-white">Accounts</h2>
          <p className="text-zinc-400 text-sm mt-1">AI-powered client relationship management</p>
        </div>
      </div>
      <div className="flex items-center gap-1 mb-8 bg-[#12121A] border border-[#27273A] rounded-xl p-1 w-fit">
        {([['overview', 'AI Overview'], ['crm', 'CRM']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAccountsSubTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              accountsSubTab === id
                ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {accountsSubTab === 'crm' ? <AccountsCRM /> : (<>

      {/* AI Overview content */}

      {/* Chat Panel */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 relative overflow-hidden mb-8 shadow-lg">
        <div className="absolute top-8 left-8">
          <Star className="text-purple-500 w-8 h-8" />
        </div>
        <div className="absolute top-12 right-12">
          <Star className="text-purple-500/40 w-5 h-5" />
        </div>

        <div className="max-w-4xl mx-auto mt-8 sm:mt-12 mb-4">
          <div className="text-center mb-6">
            <h3 className="text-xl font-medium text-white mb-2">What can I help you with?</h3>
            <p className="text-sm text-zinc-500">Ask about clients, draft communications, check relationship health, or get upsell ideas</p>
          </div>
          <div className="relative rounded-full bg-[#0A0A0F] border border-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.15)] p-1.5 flex items-center transition-all focus-within:border-purple-500/60 focus-within:shadow-[0_0_30px_rgba(168,85,247,0.25)]">
            <input
              type="text"
              placeholder="Type a message to your AI Account Agent..."
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-zinc-500 px-6 py-3 text-base sm:text-lg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && message.trim() && !accountsChat.loading) {
                  accountsChat.sendMessage(message.trim());
                  setMessage('');
                }
              }}
            />
            <button
              className="p-3 mr-1 rounded-full text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
              disabled={accountsChat.loading || !message.trim()}
              onClick={() => {
                if (message.trim()) {
                  accountsChat.sendMessage(message.trim());
                  setMessage('');
                }
              }}
            >
              <Send size={20} className="sm:w-6 sm:h-6" />
            </button>
          </div>

          {/* Chat Messages */}
          {accountsChat.messages.length > 0 && (
            <div className="mt-6 space-y-4 max-h-96 overflow-y-auto">
              {accountsChat.messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-5 py-3 text-sm ${
                    msg.role === 'user'
                      ? 'bg-purple-600/30 text-purple-100 border border-purple-500/30'
                      : 'bg-[#0A0A0F] text-zinc-300 border border-[#27273A]'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {accountsChat.loading && (
                <div className="flex justify-start">
                  <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl px-5 py-3 text-sm text-zinc-500">
                    Thinking...
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Suggested Steps */}
        <div className="mt-10">
          <h3 className="text-sm font-medium text-zinc-400 mb-4 uppercase tracking-wider">AI Suggested Next Steps</h3>
          <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide">
            {suggestedSteps.map((step, i) => (
              <button key={i} className="flex-shrink-0 px-5 py-3.5 rounded-2xl border border-[#27273A] bg-[#0A0A0F] hover:border-purple-500/50 transition-colors text-sm text-zinc-300 max-w-[280px] text-left flex items-start gap-3">
                <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                  step.type === 'follow-up' ? 'bg-blue-400' : step.type === 'review' ? 'bg-amber-400' : step.type === 'onboarding' ? 'bg-emerald-400' : 'bg-purple-400'
                }`}></span>
                {step.text}
              </button>
            ))}
          </div>
        </div>

        {/* Scores */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mt-8 pt-6 border-t border-[#27273A] gap-6">
          <div className="flex-1 w-full max-w-md">
            <div className="flex justify-between text-sm mb-3">
              <span className="text-zinc-400">Overall Relationship Health</span>
              <span className="text-purple-400 font-medium">87%</span>
            </div>
            <div className="h-2 bg-[#0A0A0F] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-600 to-purple-400 w-[87%] rounded-full"></div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-zinc-500 mb-1">Agent Relationship Score</p>
              <span className="bg-gradient-to-r from-purple-600 to-purple-500 px-4 py-1.5 rounded-lg text-white font-semibold text-lg shadow-[0_0_15px_rgba(168,85,247,0.3)]">98</span>
            </div>
          </div>
        </div>
      </div>

      {/* Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Client Communications */}
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-white">Client Communications</h3>
            <span className="text-xs px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
              {communications.filter(c => c.unread).length} unread
            </span>
          </div>
          <div className="space-y-1">
            {communications.map((comm) => (
              <div key={comm.id} className="flex gap-4 p-4 rounded-2xl hover:bg-[#181824] transition-colors cursor-pointer group">
                <div className="relative">
                  <img src={comm.avatar} alt="" className="w-10 h-10 rounded-full border border-[#27273A]" />
                  {comm.unread && <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-purple-500 rounded-full border-2 border-[#12121A]"></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <div>
                      <h4 className={`font-medium text-sm ${comm.unread ? 'text-white' : 'text-zinc-300'}`}>{comm.name}</h4>
                      <p className="text-xs text-zinc-500">{comm.company}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[#27273A] text-zinc-400 border border-zinc-700">{comm.platform}</span>
                      <span className="text-xs text-zinc-600">{comm.time}</span>
                    </div>
                  </div>
                  <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed truncate">{comm.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: AI Agent Drafts */}
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-white">AI Agent Drafts</h3>
            <span className="text-xs text-zinc-500">{drafts.length} ready to send</span>
          </div>
          <div className="space-y-4">
            {drafts.map((draft) => (
              <div key={draft.id} className="border border-purple-500/20 bg-[#0A0A0F] rounded-2xl p-5 relative overflow-hidden group hover:border-purple-500/50 transition-all">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="flex items-center gap-2 mb-2 relative z-10">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    draft.priority === 'high' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    {draft.priority === 'high' ? 'High Priority' : 'Medium Priority'}
                  </span>
                  <span className="text-[10px] text-zinc-600">{draft.client}</span>
                </div>
                <h4 className="font-medium text-sm text-white mb-2 relative z-10">{draft.title}</h4>
                <p className="text-sm text-zinc-400 mb-4 line-clamp-2 relative z-10 leading-relaxed">{draft.content}</p>
                <div className="flex items-center gap-3 relative z-10">
                  <button
                    onClick={() => handleCopy(draft.id)}
                    className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white text-xs font-medium px-4 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                  >
                    {isCopied === draft.id ? (
                      <><CheckCircle size={14} /> Copied!</>
                    ) : (
                      <><Copy size={14} /> Copy Draft</>
                    )}
                  </button>
                  <button className="text-xs text-zinc-500 hover:text-purple-400 transition-colors flex items-center gap-1.5 px-3 py-2.5">
                    <Eye size={14} /> Preview Full
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      </>)}
    </motion.div>
  );


  // ─── Reports Tab ────────────────────────────────────────
  const renderReports = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-7xl mx-auto"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div>
          <h2 className="text-3xl font-semibold text-white">Reports</h2>
          <p className="text-zinc-400 text-sm mt-1">AI-generated performance reports from social media & analytics</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]">
            <Plus size={16} /> Generate Report
          </button>
        </div>
      </div>

      {/* Chat Panel */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 relative overflow-hidden mb-8 shadow-lg">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-6">
            <h3 className="text-xl font-medium text-white mb-2">Reporting Agent</h3>
            <p className="text-sm text-zinc-500">Generate client reports, analyze performance data, or ask about trends across accounts</p>
          </div>
          <div className="relative rounded-full bg-[#0A0A0F] border border-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.15)] p-1.5 flex items-center transition-all focus-within:border-purple-500/60 focus-within:shadow-[0_0_30px_rgba(168,85,247,0.25)]">
            <input
              type="text"
              placeholder="Generate a report for... or ask about client performance..."
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-zinc-500 px-6 py-3 text-base sm:text-lg"
            />
            <button className="p-3 mr-1 rounded-full text-purple-400 hover:bg-purple-500/10 transition-colors">
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Report Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {reportMetrics.map((metric, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.08 }}
            className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5"
          >
            <p className="text-zinc-400 text-xs mb-2">{metric.label}</p>
            <p className="text-2xl font-semibold text-white mb-1">{metric.value}</p>
            <p className={`text-xs ${metric.trend === 'up' ? 'text-emerald-400' : metric.trend === 'down' ? 'text-red-400' : 'text-zinc-500'}`}>
              {metric.change}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Reports Table / Client List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Client List */}
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <h3 className="text-lg font-medium text-white mb-6">Client Reports</h3>
          <div className="space-y-1">
            {reportClients.map((client) => (
              <button
                key={client.id}
                onClick={() => setSelectedReportClient(selectedReportClient === client.id ? null : client.id)}
                className={`w-full flex items-center justify-between p-4 rounded-2xl text-left transition-all ${
                  selectedReportClient === client.id ? 'bg-purple-500/10 border border-purple-500/30' : 'hover:bg-[#181824] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    client.status === 'ready' ? 'bg-emerald-400' : client.status === 'overdue' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'
                  }`}></div>
                  <div>
                    <p className="text-sm font-medium text-white">{client.name}</p>
                    <p className="text-xs text-zinc-500">Last: {client.lastReport}</p>
                  </div>
                </div>
                <ChevronRight size={14} className="text-zinc-600" />
              </button>
            ))}
          </div>
        </div>

        {/* Report Preview */}
        <div className="lg:col-span-2 bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          {selectedReportClient ? (() => {
            const client = reportClients.find(c => c.id === selectedReportClient);
            if (!client) return null;
            return (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-medium text-white">{client.name}</h3>
                    <p className="text-sm text-zinc-400 mt-0.5">Services: {client.services.join(', ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-xs font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]">
                      <RefreshCw size={12} /> Regenerate
                    </button>
                    <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-zinc-300 text-xs font-medium hover:border-purple-500/40 transition-colors">
                      <Copy size={12} /> Export
                    </button>
                  </div>
                </div>

                {/* Simulated Report Content */}
                <div className="space-y-6">
                  {/* KPI Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Followers Growth", value: "+2,340", change: "+18%" },
                      { label: "Engagement Rate", value: "4.7%", change: "+0.8%" },
                      { label: "Website Traffic", value: "12.4K", change: "+24%" },
                      { label: "Conversions", value: "186", change: "+31%" },
                    ].map((kpi, i) => (
                      <div key={i} className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{kpi.label}</p>
                        <p className="text-lg font-semibold text-white">{kpi.value}</p>
                        <p className="text-xs text-emerald-400 mt-0.5">{kpi.change}</p>
                      </div>
                    ))}
                  </div>

                  {/* Performance Bars */}
                  <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl p-5">
                    <h4 className="text-sm font-medium text-white mb-4">Service Performance Breakdown</h4>
                    <div className="space-y-4">
                      {client.services.map((svc, i) => {
                        const performance = [85, 92, 78, 88][i] || 80;
                        return (
                          <div key={i}>
                            <div className="flex justify-between text-xs mb-2">
                              <span className="text-zinc-400">{svc}</span>
                              <span className="text-zinc-300">{performance}%</span>
                            </div>
                            <div className="h-2 bg-[#12121A] rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full" style={{ width: `${performance}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* AI Insights */}
                  <div className="bg-[#0A0A0F] border border-purple-500/20 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap size={14} className="text-purple-400" />
                      <h4 className="text-sm font-medium text-white">AI Insights & Recommendations</h4>
                    </div>
                    <ul className="space-y-2.5">
                      <li className="flex items-start gap-2 text-sm text-zinc-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0"></span>
                        Strong engagement growth — recommend increasing content frequency from 4x/week to 5x/week on Instagram.
                      </li>
                      <li className="flex items-start gap-2 text-sm text-zinc-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0"></span>
                        Website traffic spike from organic search — SEO efforts paying off. Focus on converting traffic with landing page optimization.
                      </li>
                      <li className="flex items-start gap-2 text-sm text-zinc-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0"></span>
                        Recommend A/B testing ad creatives — current CTR of 2.1% could improve to 3%+ with video-first creative strategy.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            );
          })() : (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <div className="w-16 h-16 bg-[#0A0A0F] border border-[#27273A] rounded-2xl flex items-center justify-center mb-4">
                <BarChart2 size={28} className="text-zinc-600" />
              </div>
              <p className="text-zinc-400 text-sm mb-1">Select a client to preview their report</p>
              <p className="text-zinc-600 text-xs">Reports are personalized using account and service data</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );

  // ─── Content Router ─────────────────────────────────────
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return renderDashboard();
      case 'accounts': return renderAccounts();
      case 'content': return <ContentCreation />;
      case 'social': return <SocialAnalytics />;
      case 'prospecting': return <Prospecting user={user} />;
      case 'services': return <Services />;
      case 'reports': return renderReports();
      case 'financials':
        return role === APP_ROLES.ADMIN ? <FinanceDashboard /> : renderDashboard();
      case 'tasks': return <Tasks user={user} />;
      case 'settings':
        return role === APP_ROLES.ADMIN ? <Settings user={user} /> : renderDashboard();
      default: return renderDashboard();
    }
  };

  // ─── Layout ─────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed lg:sticky top-0 left-0 h-screen w-64 bg-[#12121A] border-r border-[#27273A] flex flex-col z-50
        transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6 flex items-center justify-between lg:justify-start gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.4)]">
              <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[10px] border-b-white translate-y-[-1px]"></div>
            </div>
            <span className="text-xl font-semibold text-white tracking-wide">Agency</span>
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden text-zinc-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#181824]'
                }`}
              >
                <Icon size={18} className={isActive ? 'text-white' : 'text-zinc-500'} />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {item.featured && (
                  <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/25">
                    Featured
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-[#27273A]">
          <div className="flex items-center gap-3 px-3 py-3">
            <div className="relative">
              <img
                src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email || 'U')}&background=7c3aed&color=fff&size=36`}
                alt=""
                className="w-9 h-9 rounded-full border border-[#27273A]"
              />
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#12121A]"></div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.displayName || user.email?.split('@')[0] || 'Team Member'}</p>
              <p className="text-xs text-zinc-500 truncate">{user.email}</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">
                {role === APP_ROLES.ADMIN ? 'Admin' : 'Team member'}
              </p>
            </div>
            <button
              onClick={signOut}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-[#27273A] bg-[#0A0A0F]/80 backdrop-blur-md sticky top-0 z-20 flex items-center justify-between px-6 lg:px-8 shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsMobileMenuOpen(true)} className="lg:hidden text-zinc-400 hover:text-white">
              <Menu size={24} />
            </button>
            <h1 className="text-lg font-medium text-white hidden sm:block">AI Agent Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-zinc-400 hover:text-white transition-colors p-2 rounded-xl hover:bg-[#12121A]">
              <Search size={18} />
            </button>

            {/* Agent Status Dropdown */}
            <div className="relative" ref={agentDropdownRef}>
              <button
                onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
                className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#12121A] border border-[#27273A] hover:border-purple-500/30 transition-all text-sm"
              >
                <div className="relative flex items-center">
                  <Activity size={14} className={activeAgentCount === agentDefinitions.length ? 'text-emerald-400' : 'text-amber-400'} />
                  <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                </div>
                <span className="hidden sm:inline text-zinc-300 text-xs">
                  {activeAgentCount}/{agentDefinitions.length} Agents
                </span>
                <ChevronDown size={14} className={`text-zinc-500 transition-transform ${isAgentDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {isAgentDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.2 }}
                    className="absolute right-0 top-full mt-2 w-[380px] bg-[#12121A] border border-[#27273A] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] overflow-hidden z-50"
                  >
                    {/* Dropdown Header */}
                    <div className="px-5 py-4 border-b border-[#27273A]">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-medium text-white">Agent Orchestration</h3>
                          <p className="text-[11px] text-zinc-500 mt-0.5">Multi-agent system</p>
                        </div>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                          <span className="text-[10px] font-medium text-emerald-400">{activeAgentCount} Active</span>
                        </div>
                      </div>
                    </div>

                    {/* Agent List */}
                    <div className="p-2 max-h-[420px] overflow-y-auto">
                      {agentDefinitions.map((agent) => {
                        const AgentIcon = agent.icon;
                        const isActive = agentStates[agent.id];
                        return (
                          <div
                            key={agent.id}
                            className={`p-3.5 rounded-xl mb-1 transition-all ${
                              isActive ? 'hover:bg-[#181824]' : 'opacity-50'
                            } ${agent.isCore ? 'bg-[#0A0A0F] border border-purple-500/15' : ''}`}
                          >
                            <div className="flex items-start gap-3">
                              {/* Agent Icon */}
                              <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${agent.color} flex items-center justify-center shrink-0 shadow-lg ${!isActive ? 'grayscale' : ''}`}>
                                <AgentIcon size={16} className="text-white" />
                              </div>

                              {/* Agent Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-white">{agent.name}</span>
                                  {agent.isCore && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium uppercase tracking-wider">Core</span>
                                  )}
                                </div>
                                <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{agent.role}</p>
                                {isActive && (
                                  <div className="flex items-center gap-1.5 mt-2">
                                    <div className={`w-1.5 h-1.5 rounded-full ${agent.dotColor} animate-pulse`}></div>
                                    <span className="text-[10px] text-zinc-400 truncate">{agent.currentTask}</span>
                                  </div>
                                )}
                                {isActive && (
                                  <div className="flex items-center gap-3 mt-2">
                                    <span className="text-[10px] text-zinc-600">{agent.tasksCompleted} tasks today</span>
                                  </div>
                                )}
                              </div>

                              {/* Toggle */}
                              <button
                                onClick={() => toggleAgent(agent.id)}
                                className={`shrink-0 mt-1 w-10 h-5.5 rounded-full relative transition-all ${
                                  agent.isCore
                                    ? 'bg-purple-600 cursor-default'
                                    : isActive
                                      ? 'bg-emerald-500 hover:bg-emerald-400 cursor-pointer'
                                      : 'bg-zinc-700 hover:bg-zinc-600 cursor-pointer'
                                }`}
                                style={{ width: 40, height: 22 }}
                                disabled={agent.isCore}
                              >
                                <div
                                  className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all ${
                                    isActive || agent.isCore ? 'left-[21px]' : 'left-[3px]'
                                  }`}
                                ></div>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Dropdown Footer */}
                    <div className="px-5 py-3.5 border-t border-[#27273A] bg-[#0A0A0F]/50">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Globe size={12} className="text-purple-400" />
                          <span className="text-[11px] text-zinc-500">Orchestrator manages all agent coordination</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          <AnimatePresence mode="wait">
            {renderContent()}
          </AnimatePresence>
        </div>
      </main>
      <FlowBucket />
    </div>
  );
}
