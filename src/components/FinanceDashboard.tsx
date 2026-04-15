import React, { useState, useMemo, useCallback } from 'react';
import {
  DollarSign,
  TrendingUp,
  Target,
  AlertTriangle,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Briefcase,
  Users,
  Search,
  Loader,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import {
  useFirestoreAccounts,
  useFirestoreServices,
  useFinancialGoals,
  useExpenses,
  useFirestoreProspects,
  type FirestoreAccount,
  type FirestoreService,
  type FinancialGoal,
  type ServiceMix,
  type Expense,
  type ExpenseCategory,
} from '../hooks/useFirestore';

type FinanceTab = 'overview' | 'goal-builder' | 'expenses' | 'forecast';

const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string; color: string }[] = [
  { id: 'outsourcing', label: 'Outsourcing', color: 'text-blue-400' },
  { id: 'vendors', label: 'Vendors', color: 'text-purple-400' },
  { id: 'tools', label: 'Tools & Software', color: 'text-cyan-400' },
  { id: 'overhead', label: 'Overhead', color: 'text-amber-400' },
  { id: 'salaries', label: 'Salaries & Payroll', color: 'text-emerald-400' },
  { id: 'marketing', label: 'Marketing', color: 'text-pink-400' },
  { id: 'other', label: 'Other', color: 'text-zinc-400' },
];

function parseRetainer(val: string | null | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}

function parseTierPrice(price: string): number {
  const cleaned = price.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export default function FinanceDashboard() {
  const { accounts } = useFirestoreAccounts();
  const { services } = useFirestoreServices();
  const { activeGoal, goals, createGoal, updateGoal, deleteGoal, loading: goalsLoading } = useFinancialGoals();
  const { expenses, addExpense, updateExpense, deleteExpense, totalMonthly: totalExpenses } = useExpenses();
  const { prospects } = useFirestoreProspects();
  const [activeTab, setActiveTab] = useState<FinanceTab>('overview');

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.status === 'active'),
    [accounts]
  );

  const currentMRR = useMemo(
    () => activeAccounts.reduce((sum, a) => sum + parseRetainer(a.monthlyRetainer), 0),
    [activeAccounts]
  );

  const targetMRR = activeGoal?.targetMRR || 0;
  const mrrGap = Math.max(0, targetMRR - currentMRR);
  const netProfit = currentMRR - totalExpenses;
  const profitMargin = currentMRR > 0 ? (netProfit / currentMRR) * 100 : 0;

  const serviceMixRevenue = useMemo(() => {
    if (!activeGoal?.serviceMix) return 0;
    return activeGoal.serviceMix.reduce((sum, m) => sum + m.tierPrice * m.targetClients, 0);
  }, [activeGoal]);

  const goalAlignment = targetMRR > 0 ? Math.min(100, ((currentMRR + serviceMixRevenue) / targetMRR) * 100) : 0;

  const serviceRevenueMap = useMemo(() => {
    const map: Record<string, { service: FirestoreService; clients: FirestoreAccount[]; revenue: number }> = {};
    for (const svc of services) {
      map[svc.id] = { service: svc, clients: [], revenue: 0 };
    }
    for (const acct of activeAccounts) {
      const subs = acct.servicesSubscribed || [];
      for (const subName of subs) {
        const match = services.find((s) => s.name === subName || s.id === subName);
        if (match && map[match.id]) {
          map[match.id].clients.push(acct);
        }
      }
      const retainer = parseRetainer(acct.monthlyRetainer);
      if (retainer > 0) {
        const perService = subs.length > 0 ? retainer / subs.length : retainer;
        for (const subName of subs) {
          const match = services.find((s) => s.name === subName || s.id === subName);
          if (match && map[match.id]) {
            map[match.id].revenue += perService;
          }
        }
      }
    }
    return Object.values(map);
  }, [services, activeAccounts]);

  const prospectsInPipeline = prospects.filter((p) => p.status === 'new' || p.status === 'enriched' || p.status === 'emailing').length;
  const closeRate = activeGoal?.closeRate || 20;
  const clientsNeeded = mrrGap > 0 && serviceMixRevenue > 0
    ? Math.ceil(mrrGap / (serviceMixRevenue / Math.max(1, activeGoal?.serviceMix?.reduce((s, m) => s + m.targetClients, 0) || 1)))
    : 0;
  const prospectsNeeded = clientsNeeded > 0 ? Math.ceil(clientsNeeded / (closeRate / 100)) : 0;

  const TABS: { id: FinanceTab; label: string }[] = [
    { id: 'overview', label: 'Command Center' },
    { id: 'goal-builder', label: 'Goal Builder' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'forecast', label: 'Forecast' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="max-w-7xl mx-auto space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold text-white">Financials</h2>
          <p className="text-zinc-400 text-sm mt-1">Performance-based forecasting — every number has to add up</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-[#12121A] border border-[#27273A] rounded-xl p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === 'overview' && (
            <OverviewTab
              currentMRR={currentMRR}
              targetMRR={targetMRR}
              mrrGap={mrrGap}
              netProfit={netProfit}
              profitMargin={profitMargin}
              totalExpenses={totalExpenses}
              activeAccounts={activeAccounts}
              serviceRevenueMap={serviceRevenueMap}
              goalAlignment={goalAlignment}
              serviceMixRevenue={serviceMixRevenue}
              prospectsInPipeline={prospectsInPipeline}
              prospectsNeeded={prospectsNeeded}
              clientsNeeded={clientsNeeded}
              closeRate={closeRate}
              activeGoal={activeGoal}
              onSetTab={setActiveTab}
            />
          )}
          {activeTab === 'goal-builder' && (
            <GoalBuilderTab
              activeGoal={activeGoal}
              services={services}
              currentMRR={currentMRR}
              createGoal={createGoal}
              updateGoal={updateGoal}
              goalsLoading={goalsLoading}
            />
          )}
          {activeTab === 'expenses' && (
            <ExpensesTab
              expenses={expenses}
              addExpense={addExpense}
              updateExpense={updateExpense}
              deleteExpense={deleteExpense}
              services={services}
              currentMRR={currentMRR}
            />
          )}
          {activeTab === 'forecast' && (
            <ForecastTab
              currentMRR={currentMRR}
              targetMRR={targetMRR}
              serviceMixRevenue={serviceMixRevenue}
              totalExpenses={totalExpenses}
              activeGoal={activeGoal}
              activeAccounts={activeAccounts}
              clientsNeeded={clientsNeeded}
              prospectsNeeded={prospectsNeeded}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

// ─── OVERVIEW TAB ─────────────────────────────────────────

function OverviewTab({
  currentMRR, targetMRR, mrrGap, netProfit, profitMargin, totalExpenses,
  activeAccounts, serviceRevenueMap, goalAlignment, serviceMixRevenue,
  prospectsInPipeline, prospectsNeeded, clientsNeeded, closeRate,
  activeGoal, onSetTab,
}: {
  currentMRR: number;
  targetMRR: number;
  mrrGap: number;
  netProfit: number;
  profitMargin: number;
  totalExpenses: number;
  activeAccounts: FirestoreAccount[];
  serviceRevenueMap: { service: FirestoreService; clients: FirestoreAccount[]; revenue: number }[];
  goalAlignment: number;
  serviceMixRevenue: number;
  prospectsInPipeline: number;
  prospectsNeeded: number;
  clientsNeeded: number;
  closeRate: number;
  activeGoal: FinancialGoal | null;
  onSetTab: (tab: FinanceTab) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Current MRR', value: fmt(currentMRR), sub: `${activeAccounts.length} active clients`, icon: DollarSign, color: 'from-emerald-600 to-emerald-400', valueColor: 'text-white' },
          { label: 'Target MRR', value: targetMRR > 0 ? fmt(targetMRR) : 'Not set', sub: targetMRR > 0 ? `Gap: ${fmt(mrrGap)}` : 'Set in Goal Builder', icon: Target, color: 'from-purple-600 to-purple-400', valueColor: targetMRR > 0 ? 'text-white' : 'text-zinc-500' },
          { label: 'Net Profit', value: fmt(netProfit), sub: `${fmtPct(profitMargin)} margin`, icon: TrendingUp, color: 'from-blue-600 to-blue-400', valueColor: netProfit >= 0 ? 'text-white' : 'text-red-400' },
          { label: 'Monthly Expenses', value: fmt(totalExpenses), sub: `${((totalExpenses / Math.max(currentMRR, 1)) * 100).toFixed(0)}% of revenue`, icon: ArrowDownRight, color: 'from-amber-600 to-amber-400', valueColor: 'text-white' },
        ].map((card, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.08 }}
            className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6 relative overflow-hidden group hover:border-purple-500/30 transition-colors"
          >
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center mb-4 shadow-lg`}>
              <card.icon size={18} className="text-white" />
            </div>
            <p className="text-zinc-400 text-xs mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.valueColor}`}>{card.value}</p>
            <p className="text-xs text-zinc-500 mt-1">{card.sub}</p>
          </motion.div>
        ))}
      </div>

      {/* Goal Alignment Gauge */}
      {targetMRR > 0 && (
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-medium text-white">Goal Alignment</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Does your service mix + pricing + client count add up to your target?</p>
            </div>
            <div className={`text-sm font-bold px-3 py-1.5 rounded-lg ${
              goalAlignment >= 90 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
              goalAlignment >= 60 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
              'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {fmtPct(goalAlignment)} aligned
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Current Revenue</p>
              <p className="text-xl font-bold text-emerald-400">{fmt(currentMRR)}</p>
              <p className="text-xs text-zinc-500 mt-1">from {activeAccounts.length} active clients</p>
            </div>
            <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Projected from New Clients</p>
              <p className="text-xl font-bold text-purple-400">{fmt(serviceMixRevenue)}</p>
              <p className="text-xs text-zinc-500 mt-1">from service mix plan</p>
            </div>
            <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Remaining Gap</p>
              <p className={`text-xl font-bold ${mrrGap - serviceMixRevenue <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {mrrGap - serviceMixRevenue <= 0 ? fmt(0) : fmt(mrrGap - serviceMixRevenue)}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {mrrGap - serviceMixRevenue <= 0 ? 'Goal covered!' : 'still needed'}
              </p>
            </div>
          </div>

          <div className="h-3 bg-[#0A0A0F] rounded-full overflow-hidden relative">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, (currentMRR / targetMRR) * 100)}%` }}
            />
            <div
              className="absolute inset-y-0 bg-gradient-to-r from-purple-600 to-purple-400 rounded-full transition-all duration-700"
              style={{
                left: `${Math.min(100, (currentMRR / targetMRR) * 100)}%`,
                width: `${Math.min(100 - (currentMRR / targetMRR) * 100, (serviceMixRevenue / targetMRR) * 100)}%`,
              }}
            />
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-zinc-500">
            <span>Current: {fmt(currentMRR)}</span>
            <span>Target: {fmt(targetMRR)}</span>
          </div>
        </div>
      )}

      {/* Two columns: Service Revenue + Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service Revenue Map */}
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-medium text-white">Revenue by Service</h3>
            <button
              onClick={() => onSetTab('goal-builder')}
              className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
            >
              Configure <ChevronRight size={12} />
            </button>
          </div>
          {serviceRevenueMap.length === 0 ? (
            <div className="text-center py-8">
              <Briefcase size={28} className="mx-auto mb-3 text-zinc-600" />
              <p className="text-xs text-zinc-500">Add services to see revenue breakdown</p>
            </div>
          ) : (
            <div className="space-y-1">
              {serviceRevenueMap.map(({ service, clients, revenue }) => (
                <div key={service.id} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-[#181824] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600/20 to-purple-400/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                      <Briefcase size={14} className="text-purple-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{service.name}</p>
                      <p className="text-[10px] text-zinc-500">{clients.length} clients</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-white">{fmt(revenue)}</p>
                    <p className="text-[10px] text-zinc-500">/month</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pipeline Requirements */}
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <h3 className="text-lg font-medium text-white mb-6">Pipeline to Hit Goal</h3>
          {!activeGoal || targetMRR === 0 ? (
            <div className="text-center py-8">
              <Target size={28} className="mx-auto mb-3 text-zinc-600" />
              <p className="text-xs text-zinc-500 mb-4">Set a revenue goal to see pipeline requirements</p>
              <button
                onClick={() => onSetTab('goal-builder')}
                className="px-4 py-2 rounded-xl bg-purple-600 text-xs text-white font-medium hover:bg-purple-500 transition-colors"
              >
                Set Goal
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">New Clients Needed</p>
                  <p className="text-2xl font-bold text-white">{clientsNeeded}</p>
                  <p className="text-[10px] text-zinc-500 mt-1">to close the gap</p>
                </div>
                <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Prospects Needed</p>
                  <p className="text-2xl font-bold text-amber-400">{prospectsNeeded}</p>
                  <p className="text-[10px] text-zinc-500 mt-1">at {closeRate}% close rate</p>
                </div>
              </div>

              <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-3">Pipeline Funnel</p>
                <div className="space-y-3">
                  {[
                    { label: 'Prospects in Pipeline', count: prospectsInPipeline, target: prospectsNeeded, color: 'from-blue-600 to-blue-400' },
                    { label: 'Expected Conversations', count: Math.round(prospectsInPipeline * 0.5), target: Math.round(prospectsNeeded * 0.5), color: 'from-purple-600 to-purple-400' },
                    { label: 'Expected Closes', count: Math.round(prospectsInPipeline * (closeRate / 100)), target: clientsNeeded, color: 'from-emerald-600 to-emerald-400' },
                  ].map((step, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-zinc-400">{step.label}</span>
                        <span className={step.count >= step.target ? 'text-emerald-400' : 'text-amber-400'}>
                          {step.count} / {step.target}
                        </span>
                      </div>
                      <div className="h-2 bg-[#12121A] rounded-full overflow-hidden">
                        <div
                          className={`h-full bg-gradient-to-r ${step.color} rounded-full transition-all`}
                          style={{ width: `${Math.min(100, step.target > 0 ? (step.count / step.target) * 100 : 0)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Referral Impact */}
              {activeGoal.referralRate > 0 && (
                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap size={14} className="text-emerald-400" />
                    <p className="text-xs font-medium text-emerald-300">Referral Impact</p>
                  </div>
                  <p className="text-xs text-zinc-400">
                    At {activeGoal.referralRate}% referral rate, expect ~{Math.round(activeAccounts.length * (activeGoal.referralRate / 100))} referrals
                    from existing clients, reducing prospecting needs by ~{Math.round(prospectsNeeded * (activeGoal.referralRate / 100))} prospects.
                  </p>
                </div>
              )}

              {/* Churn Warning */}
              {activeGoal.churnRate > 0 && (
                <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle size={14} className="text-red-400" />
                    <p className="text-xs font-medium text-red-300">Churn Factor</p>
                  </div>
                  <p className="text-xs text-zinc-400">
                    At {activeGoal.churnRate}% monthly churn, you could lose ~{Math.round(activeAccounts.length * (activeGoal.churnRate / 100))} clients
                    ({fmt(currentMRR * (activeGoal.churnRate / 100))}/mo). Factor this into your growth targets.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Client Revenue Table */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
        <h3 className="text-lg font-medium text-white mb-6">Client Revenue Breakdown</h3>
        {activeAccounts.length === 0 ? (
          <div className="text-center py-8">
            <Users size={28} className="mx-auto mb-3 text-zinc-600" />
            <p className="text-xs text-zinc-500">No active accounts. Add clients in the Accounts tab.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {activeAccounts
              .sort((a, b) => parseRetainer(b.monthlyRetainer) - parseRetainer(a.monthlyRetainer))
              .map((acct) => {
                const retainer = parseRetainer(acct.monthlyRetainer);
                const pctOfTotal = currentMRR > 0 ? (retainer / currentMRR) * 100 : 0;
                return (
                  <div key={acct.id} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-[#181824] transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600/20 to-purple-400/10 border border-purple-500/20 flex items-center justify-center shrink-0 text-xs font-bold text-purple-400">
                        {acct.company?.charAt(0) || acct.name?.charAt(0) || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{acct.company || acct.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {(acct.servicesSubscribed || []).slice(0, 3).map((s, i) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-[#0A0A0F] border border-[#27273A] text-zinc-400">{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 shrink-0">
                      <div className="hidden sm:block w-32">
                        <div className="h-1.5 bg-[#0A0A0F] rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full" style={{ width: `${pctOfTotal}%` }} />
                        </div>
                        <p className="text-[9px] text-zinc-600 mt-1 text-right">{fmtPct(pctOfTotal)} of MRR</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-white">{retainer > 0 ? fmt(retainer) : '—'}</p>
                        <p className="text-[10px] text-zinc-500">/month</p>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── GOAL BUILDER TAB ─────────────────────────────────────

function GoalBuilderTab({
  activeGoal, services, currentMRR, createGoal, updateGoal, goalsLoading,
}: {
  activeGoal: FinancialGoal | null;
  services: FirestoreService[];
  currentMRR: number;
  createGoal: (data?: Partial<FinancialGoal>) => Promise<FinancialGoal>;
  updateGoal: (id: string, data: Partial<FinancialGoal>) => Promise<void>;
  goalsLoading: boolean;
}) {
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [showAddMix, setShowAddMix] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [selectedTierName, setSelectedTierName] = useState('');
  const [selectedTierPrice, setSelectedTierPrice] = useState(0);
  const [targetClients, setTargetClients] = useState(1);

  const handleCreateGoal = async () => {
    await createGoal({ targetMRR: 0, currentMRR: currentMRR });
  };

  const handleSaveTarget = async () => {
    if (!activeGoal) return;
    const val = parseFloat(targetInput.replace(/[^0-9.]/g, ''));
    if (!isNaN(val)) {
      await updateGoal(activeGoal.id, { targetMRR: val, currentMRR: currentMRR });
    }
    setEditingTarget(false);
  };

  const handleAddServiceMix = async () => {
    if (!activeGoal || !selectedServiceId) return;
    const svc = services.find((s) => s.id === selectedServiceId);
    if (!svc) return;
    const newMix: ServiceMix = {
      serviceId: svc.id,
      serviceName: svc.name,
      tierName: selectedTierName || 'Standard',
      tierPrice: selectedTierPrice,
      targetClients: targetClients,
    };
    const updated = [...(activeGoal.serviceMix || []), newMix];
    await updateGoal(activeGoal.id, { serviceMix: updated });
    setShowAddMix(false);
    setSelectedServiceId('');
    setSelectedTierName('');
    setSelectedTierPrice(0);
    setTargetClients(1);
  };

  const handleRemoveMix = async (index: number) => {
    if (!activeGoal) return;
    const updated = activeGoal.serviceMix.filter((_, i) => i !== index);
    await updateGoal(activeGoal.id, { serviceMix: updated });
  };

  const handleUpdateRate = async (field: string, value: number) => {
    if (!activeGoal) return;
    await updateGoal(activeGoal.id, { [field]: value } as any);
  };

  const selectedService = services.find((s) => s.id === selectedServiceId);
  const tiers = selectedService?.pricingTiers || [];

  const totalFromMix = activeGoal?.serviceMix?.reduce((sum, m) => sum + m.tierPrice * m.targetClients, 0) || 0;
  const targetMRR = activeGoal?.targetMRR || 0;
  const gap = targetMRR - currentMRR;
  const mixCoverage = gap > 0 ? Math.min(100, (totalFromMix / gap) * 100) : totalFromMix > 0 ? 100 : 0;

  if (goalsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader size={24} className="text-purple-400 animate-spin" />
      </div>
    );
  }

  if (!activeGoal) {
    return (
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-12 text-center">
        <Target size={40} className="mx-auto mb-4 text-zinc-600" />
        <h3 className="text-lg font-medium text-white mb-2">Set Your Revenue Goal</h3>
        <p className="text-sm text-zinc-500 mb-6 max-w-md mx-auto">
          Define your target MRR, map it to your services and pricing tiers,
          and see exactly what it takes to get there — clients, prospects, and bottom line.
        </p>
        <button
          onClick={handleCreateGoal}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]"
        >
          Create Revenue Goal
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Target MRR */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-medium text-white">Revenue Target</h3>
            <p className="text-xs text-zinc-500 mt-0.5">What's your total MRR goal? Everything below maps to this.</p>
          </div>
          {!editingTarget && (
            <button
              onClick={() => { setEditingTarget(true); setTargetInput(String(targetMRR)); }}
              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors"
            >
              <Edit3 size={14} />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-5">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Current MRR</p>
            <p className="text-2xl font-bold text-emerald-400">{fmt(currentMRR)}</p>
          </div>
          <div className="bg-[#0A0A0F] border border-purple-500/20 rounded-xl p-5">
            <p className="text-[10px] text-purple-400 uppercase tracking-wider mb-2">Target MRR</p>
            {editingTarget ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 flex-1">
                  <span className="text-xl font-bold text-white">$</span>
                  <input
                    type="number"
                    value={targetInput}
                    onChange={(e) => setTargetInput(e.target.value)}
                    className="flex-1 bg-transparent text-2xl font-bold text-white outline-none w-full"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveTarget()}
                  />
                </div>
                <button onClick={handleSaveTarget} className="p-1.5 rounded-lg bg-purple-600 text-white"><Check size={14} /></button>
                <button onClick={() => setEditingTarget(false)} className="p-1.5 rounded-lg bg-zinc-700 text-white"><X size={14} /></button>
              </div>
            ) : (
              <p className="text-2xl font-bold text-white cursor-pointer" onClick={() => { setEditingTarget(true); setTargetInput(String(targetMRR)); }}>
                {targetMRR > 0 ? fmt(targetMRR) : 'Click to set'}
              </p>
            )}
          </div>
          <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-5">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Growth Needed</p>
            <p className={`text-2xl font-bold ${gap > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {gap > 0 ? `+${fmt(gap)}` : 'On target'}
            </p>
          </div>
        </div>
      </div>

      {/* Service Mix Builder */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-lg font-medium text-white">Service Mix Plan</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Map your services × pricing × client count to your revenue target</p>
          </div>
          <button
            onClick={() => setShowAddMix(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-xs text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all"
          >
            <Plus size={14} /> Add Service
          </button>
        </div>

        {/* Coverage bar */}
        {gap > 0 && (
          <div className="mt-4 mb-6">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-zinc-400">Mix covers gap</span>
              <span className={mixCoverage >= 100 ? 'text-emerald-400' : mixCoverage >= 60 ? 'text-amber-400' : 'text-red-400'}>
                {fmt(totalFromMix)} / {fmt(gap)} ({fmtPct(mixCoverage)})
              </span>
            </div>
            <div className="h-2.5 bg-[#0A0A0F] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  mixCoverage >= 100 ? 'bg-gradient-to-r from-emerald-600 to-emerald-400' :
                  mixCoverage >= 60 ? 'bg-gradient-to-r from-amber-600 to-amber-400' :
                  'bg-gradient-to-r from-red-600 to-red-400'
                }`}
                style={{ width: `${Math.min(100, mixCoverage)}%` }}
              />
            </div>
            {mixCoverage < 100 && (
              <p className="text-[10px] text-red-400 mt-1.5">
                Your service mix doesn't cover the full gap. Add more services or increase client targets.
              </p>
            )}
            {mixCoverage >= 100 && (
              <p className="text-[10px] text-emerald-400 mt-1.5">
                Your service mix covers the revenue gap. The numbers add up.
              </p>
            )}
          </div>
        )}

        {/* Add Service Mix Form */}
        <AnimatePresence>
          {showAddMix && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-[#0A0A0F] border border-purple-500/20 rounded-xl p-5 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Service</label>
                    <select
                      value={selectedServiceId}
                      onChange={(e) => {
                        setSelectedServiceId(e.target.value);
                        setSelectedTierName('');
                        setSelectedTierPrice(0);
                      }}
                      className="w-full bg-[#12121A] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="">Select a service...</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Pricing Tier</label>
                    {tiers.length > 0 ? (
                      <select
                        value={selectedTierName}
                        onChange={(e) => {
                          const tier = tiers.find((t) => t.name === e.target.value);
                          setSelectedTierName(e.target.value);
                          setSelectedTierPrice(tier ? parseTierPrice(tier.price) : 0);
                        }}
                        className="w-full bg-[#12121A] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white outline-none"
                      >
                        <option value="">Select tier...</option>
                        {tiers.map((t, i) => (
                          <option key={i} value={t.name}>{t.name} — {t.price}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-400 text-sm">$</span>
                        <input
                          type="number"
                          value={selectedTierPrice || ''}
                          onChange={(e) => {
                            setSelectedTierPrice(parseFloat(e.target.value) || 0);
                            setSelectedTierName('Custom');
                          }}
                          placeholder="Monthly price"
                          className="flex-1 bg-[#12121A] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white outline-none"
                        />
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Price per Client ($/mo)</label>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-400 text-sm">$</span>
                      <input
                        type="number"
                        value={selectedTierPrice || ''}
                        onChange={(e) => setSelectedTierPrice(parseFloat(e.target.value) || 0)}
                        className="flex-1 bg-[#12121A] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Target # of Clients</label>
                    <input
                      type="number"
                      min={1}
                      value={targetClients}
                      onChange={(e) => setTargetClients(parseInt(e.target.value) || 1)}
                      className="w-full bg-[#12121A] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                </div>
                {selectedTierPrice > 0 && (
                  <div className="bg-[#12121A] border border-emerald-500/20 rounded-lg p-3 mb-4">
                    <p className="text-xs text-emerald-400">
                      = {fmt(selectedTierPrice * targetClients)}/mo from {targetClients} client{targetClients > 1 ? 's' : ''} × {fmt(selectedTierPrice)}
                    </p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleAddServiceMix}
                    disabled={!selectedServiceId || selectedTierPrice <= 0}
                    className="px-4 py-2 rounded-lg bg-purple-600 text-xs text-white font-medium hover:bg-purple-500 transition-colors disabled:opacity-40"
                  >
                    Add to Mix
                  </button>
                  <button
                    onClick={() => setShowAddMix(false)}
                    className="px-4 py-2 rounded-lg border border-[#27273A] text-xs text-zinc-400 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Service Mix List */}
        {(activeGoal?.serviceMix || []).length === 0 ? (
          <div className="text-center py-8 bg-[#0A0A0F] border border-[#27273A] rounded-xl mt-4">
            <Briefcase size={28} className="mx-auto mb-3 text-zinc-600" />
            <p className="text-xs text-zinc-500">No services in your mix yet. Add services with pricing to build your revenue plan.</p>
          </div>
        ) : (
          <div className="space-y-2 mt-4">
            {activeGoal!.serviceMix.map((mix, i) => (
              <div key={i} className="flex items-center justify-between p-4 bg-[#0A0A0F] border border-[#27273A] rounded-xl group hover:border-purple-500/20 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-600/20 to-purple-400/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                    <Briefcase size={14} className="text-purple-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{mix.serviceName}</p>
                    <p className="text-[10px] text-zinc-500">{mix.tierName} tier · {fmt(mix.tierPrice)}/client</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">{mix.targetClients} clients</p>
                    <p className="text-xs text-emerald-400">{fmt(mix.tierPrice * mix.targetClients)}/mo</p>
                  </div>
                  <button
                    onClick={() => handleRemoveMix(i)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
            {/* Total */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#27273A]">
              <p className="text-sm font-medium text-zinc-300">Total from Mix</p>
              <p className="text-lg font-bold text-white">{fmt(totalFromMix)}/mo</p>
            </div>
          </div>
        )}
      </div>

      {/* Conversion & Growth Rates */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
        <h3 className="text-lg font-medium text-white mb-2">Growth Assumptions</h3>
        <p className="text-xs text-zinc-500 mb-6">These rates determine how realistic your projections are. Be honest.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Close Rate', field: 'closeRate', value: activeGoal.closeRate, suffix: '%', hint: 'What % of prospects become clients' },
            { label: 'Avg Sales Cycle', field: 'avgSalesCycle', value: activeGoal.avgSalesCycle, suffix: ' days', hint: 'Days from first contact to close' },
            { label: 'Referral Rate', field: 'referralRate', value: activeGoal.referralRate, suffix: '%', hint: '% of clients who refer new business' },
            { label: 'Monthly Churn', field: 'churnRate', value: activeGoal.churnRate, suffix: '%', hint: '% of clients lost per month' },
          ].map((rate) => (
            <RateInput
              key={rate.field}
              label={rate.label}
              value={rate.value}
              suffix={rate.suffix}
              hint={rate.hint}
              onChange={(v) => handleUpdateRate(rate.field, v)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RateInput({ label, value, suffix, hint, onChange }: {
  label: string; value: number; suffix: string; hint: string; onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState('');

  return (
    <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            className="w-full bg-transparent text-xl font-bold text-white outline-none"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onChange(parseFloat(buffer) || 0);
                setEditing(false);
              }
            }}
            onBlur={() => {
              onChange(parseFloat(buffer) || 0);
              setEditing(false);
            }}
          />
          <span className="text-zinc-400 text-sm">{suffix}</span>
        </div>
      ) : (
        <p
          className="text-xl font-bold text-white cursor-pointer hover:text-purple-300 transition-colors"
          onClick={() => { setEditing(true); setBuffer(String(value)); }}
        >
          {value}{suffix}
        </p>
      )}
      <p className="text-[10px] text-zinc-600 mt-1">{hint}</p>
    </div>
  );
}

// ─── EXPENSES TAB ─────────────────────────────────────────

function ExpensesTab({
  expenses, addExpense, updateExpense, deleteExpense, services, currentMRR,
}: {
  expenses: Expense[];
  addExpense: (data: Omit<Expense, 'id'>) => Promise<Expense>;
  updateExpense: (id: string, data: Partial<Expense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  services: FirestoreService[];
  currentMRR: number;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<ExpenseCategory>('tools');
  const [newAmount, setNewAmount] = useState('');
  const [newRecurring, setNewRecurring] = useState(true);
  const [newLinkedService, setNewLinkedService] = useState('');

  const recurring = expenses.filter((e) => e.recurring);
  const oneTime = expenses.filter((e) => !e.recurring);
  const totalRecurring = recurring.reduce((s, e) => s + e.amount, 0);
  const totalOneTime = oneTime.reduce((s, e) => s + e.amount, 0);
  const expensesByCategory = EXPENSE_CATEGORIES.map((cat) => ({
    ...cat,
    total: recurring.filter((e) => e.category === cat.id).reduce((s, e) => s + e.amount, 0),
    count: recurring.filter((e) => e.category === cat.id).length,
  })).filter((c) => c.count > 0);

  const handleAdd = async () => {
    const amount = parseFloat(newAmount.replace(/[^0-9.]/g, ''));
    if (!newName.trim() || isNaN(amount)) return;
    await addExpense({
      name: newName.trim(),
      category: newCategory,
      amount,
      recurring: newRecurring,
      linkedServiceId: newLinkedService || null,
      notes: '',
    });
    setShowAdd(false);
    setNewName('');
    setNewAmount('');
    setNewLinkedService('');
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6">
          <p className="text-zinc-400 text-xs mb-1">Monthly Recurring Expenses</p>
          <p className="text-2xl font-semibold text-white">{fmt(totalRecurring)}</p>
          <p className="text-xs text-zinc-500 mt-1">{recurring.length} items</p>
        </div>
        <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6">
          <p className="text-zinc-400 text-xs mb-1">One-Time Expenses</p>
          <p className="text-2xl font-semibold text-white">{fmt(totalOneTime)}</p>
          <p className="text-xs text-zinc-500 mt-1">{oneTime.length} items</p>
        </div>
        <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6">
          <p className="text-zinc-400 text-xs mb-1">Expense Ratio</p>
          <p className={`text-2xl font-semibold ${totalRecurring / Math.max(currentMRR, 1) > 0.5 ? 'text-red-400' : 'text-emerald-400'}`}>
            {currentMRR > 0 ? fmtPct((totalRecurring / currentMRR) * 100) : '—'}
          </p>
          <p className="text-xs text-zinc-500 mt-1">of MRR</p>
        </div>
      </div>

      {/* Category Breakdown */}
      {expensesByCategory.length > 0 && (
        <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
          <h3 className="text-lg font-medium text-white mb-6">Expense Breakdown</h3>
          <div className="space-y-3">
            {expensesByCategory.sort((a, b) => b.total - a.total).map((cat) => (
              <div key={cat.id}>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className={`font-medium ${cat.color}`}>{cat.label}</span>
                  <span className="text-zinc-300">{fmt(cat.total)} ({cat.count})</span>
                </div>
                <div className="h-2 bg-[#0A0A0F] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full transition-all"
                    style={{ width: `${totalRecurring > 0 ? (cat.total / totalRecurring) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Expense */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-white">Expenses</h3>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-xs text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all"
          >
            <Plus size={14} /> Add Expense
          </button>
        </div>

        <AnimatePresence>
          {showAdd && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-[#0A0A0F] border border-purple-500/20 rounded-xl p-5 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Name</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Canva Pro, VA, Hosting..."
                      className="w-full bg-[#12121A] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Category</label>
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value as ExpenseCategory)}
                      className="w-full bg-[#12121A] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white outline-none"
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Amount ($/mo)</label>
                    <input
                      type="number"
                      value={newAmount}
                      onChange={(e) => setNewAmount(e.target.value)}
                      placeholder="0"
                      className="w-full bg-[#12121A] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 block">Linked Service (optional)</label>
                    <select
                      value={newLinkedService}
                      onChange={(e) => setNewLinkedService(e.target.value)}
                      className="w-full bg-[#12121A] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white outline-none"
                    >
                      <option value="">None</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newRecurring}
                        onChange={(e) => setNewRecurring(e.target.checked)}
                        className="accent-purple-500"
                      />
                      <span className="text-sm text-zinc-300">Recurring monthly</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAdd} className="px-4 py-2 rounded-lg bg-purple-600 text-xs text-white font-medium hover:bg-purple-500 transition-colors">
                    Add
                  </button>
                  <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border border-[#27273A] text-xs text-zinc-400">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expense List */}
        {expenses.length === 0 ? (
          <div className="text-center py-8 bg-[#0A0A0F] border border-[#27273A] rounded-xl">
            <DollarSign size={28} className="mx-auto mb-3 text-zinc-600" />
            <p className="text-xs text-zinc-500">No expenses tracked yet. Add outsourcing costs, tool subscriptions, overhead, etc.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {expenses.map((exp) => {
              const catInfo = EXPENSE_CATEGORIES.find((c) => c.id === exp.category);
              return (
                <div key={exp.id} className="flex items-center justify-between p-3.5 rounded-xl hover:bg-[#181824] transition-colors group">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${catInfo?.color.replace('text-', 'bg-') || 'bg-zinc-400'}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{exp.name}</p>
                      <p className="text-[10px] text-zinc-500">{catInfo?.label} · {exp.recurring ? 'Monthly' : 'One-time'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <p className="text-sm font-medium text-white">{fmt(exp.amount)}</p>
                    <button
                      onClick={() => deleteExpense(exp.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── FORECAST TAB ─────────────────────────────────────────

function ForecastTab({
  currentMRR, targetMRR, serviceMixRevenue, totalExpenses, activeGoal,
  activeAccounts, clientsNeeded, prospectsNeeded,
}: {
  currentMRR: number;
  targetMRR: number;
  serviceMixRevenue: number;
  totalExpenses: number;
  activeGoal: FinancialGoal | null;
  activeAccounts: FirestoreAccount[];
  clientsNeeded: number;
  prospectsNeeded: number;
}) {
  const timeline = activeGoal?.timeline || 6;
  const churnRate = activeGoal?.churnRate || 0;
  const closeRate = activeGoal?.closeRate || 20;
  const referralRate = activeGoal?.referralRate || 0;
  const avgSalesCycle = activeGoal?.avgSalesCycle || 30;

  const avgRevenuePerNewClient = clientsNeeded > 0 ? serviceMixRevenue / clientsNeeded : 0;
  const expenseGrowthRate = 0.05;

  const months = useMemo(() => {
    const result: {
      month: number;
      label: string;
      revenue: number;
      expenses: number;
      profit: number;
      clients: number;
      newClients: number;
      churnedClients: number;
    }[] = [];

    let runningRevenue = currentMRR;
    let runningClients = activeAccounts.length;
    const monthlyNewClients = timeline > 0 ? clientsNeeded / timeline : 0;

    for (let m = 0; m < Math.max(timeline, 12); m++) {
      const churned = Math.round(runningClients * (churnRate / 100));
      const referrals = Math.round(runningClients * (referralRate / 100) * (closeRate / 100) / 12);
      const directNew = Math.round(monthlyNewClients);
      const totalNew = directNew + referrals;
      const newRevenue = totalNew * avgRevenuePerNewClient;
      const churnedRevenue = churned * (runningClients > 0 ? runningRevenue / runningClients : 0);

      runningClients = runningClients - churned + totalNew;
      runningRevenue = runningRevenue - churnedRevenue + newRevenue;

      const monthExpenses = totalExpenses * Math.pow(1 + expenseGrowthRate, m / 12);
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const now = new Date();
      const futureMonth = (now.getMonth() + m + 1) % 12;

      result.push({
        month: m + 1,
        label: monthNames[futureMonth],
        revenue: Math.round(runningRevenue),
        expenses: Math.round(monthExpenses),
        profit: Math.round(runningRevenue - monthExpenses),
        clients: Math.max(0, runningClients),
        newClients: totalNew,
        churnedClients: churned,
      });
    }
    return result;
  }, [currentMRR, activeAccounts.length, clientsNeeded, timeline, churnRate, referralRate, closeRate, avgRevenuePerNewClient, totalExpenses]);

  const maxRevenue = Math.max(...months.map((m) => m.revenue), 1);
  const monthEnd = months[months.length - 1];

  return (
    <div className="space-y-6">
      {/* Forecast Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: `Revenue in ${timeline}mo`, value: fmt(months[Math.min(timeline - 1, months.length - 1)]?.revenue || 0), color: 'text-emerald-400' },
          { label: `Profit in ${timeline}mo`, value: fmt(months[Math.min(timeline - 1, months.length - 1)]?.profit || 0), color: months[Math.min(timeline - 1, months.length - 1)]?.profit >= 0 ? 'text-emerald-400' : 'text-red-400' },
          { label: `Clients in ${timeline}mo`, value: String(months[Math.min(timeline - 1, months.length - 1)]?.clients || 0), color: 'text-purple-400' },
          { label: 'Annual Revenue (12mo)', value: fmt(monthEnd?.revenue * 12 || 0), color: 'text-white' },
        ].map((card, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.08 }}
            className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6"
          >
            <p className="text-zinc-400 text-xs mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Revenue Chart (bar chart) */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg">
        <h3 className="text-lg font-medium text-white mb-6">Revenue Forecast</h3>
        <div className="flex items-end gap-1 h-48">
          {months.map((m, i) => {
            const revenueHeight = (m.revenue / maxRevenue) * 100;
            const expenseHeight = (m.expenses / maxRevenue) * 100;
            const isTarget = targetMRR > 0 && m.revenue >= targetMRR && (i === 0 || months[i - 1].revenue < targetMRR);
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                {isTarget && (
                  <div className="absolute -top-6 text-[8px] text-emerald-400 font-bold whitespace-nowrap">TARGET HIT</div>
                )}
                <div className="w-full flex flex-col justify-end h-40 relative">
                  <div
                    className="w-full bg-gradient-to-t from-purple-600 to-purple-400 rounded-t-sm transition-all duration-300 relative"
                    style={{ height: `${revenueHeight}%` }}
                  >
                    <div
                      className="absolute bottom-0 w-full bg-gradient-to-t from-red-600/50 to-red-400/30 rounded-t-sm"
                      style={{ height: `${revenueHeight > 0 ? (expenseHeight / revenueHeight) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <span className="text-[8px] text-zinc-600">{m.label}</span>
                {/* Tooltip on hover */}
                <div className="absolute bottom-full mb-8 hidden group-hover:block bg-[#0A0A0F] border border-[#27273A] rounded-lg p-2 text-[10px] z-10 whitespace-nowrap shadow-lg">
                  <p className="text-white font-medium">Month {m.month}</p>
                  <p className="text-emerald-400">Rev: {fmt(m.revenue)}</p>
                  <p className="text-red-400">Exp: {fmt(m.expenses)}</p>
                  <p className={m.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>Profit: {fmt(m.profit)}</p>
                  <p className="text-zinc-400">{m.clients} clients</p>
                </div>
              </div>
            );
          })}
        </div>
        {/* Target line */}
        {targetMRR > 0 && (
          <div className="relative mt-2">
            <div
              className="absolute w-full border-t border-dashed border-emerald-500/40"
              style={{ bottom: `${(targetMRR / maxRevenue) * 160}px` }}
            />
          </div>
        )}
        <div className="flex items-center gap-4 mt-4 text-[10px] text-zinc-500">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-gradient-to-t from-purple-600 to-purple-400" />
            Revenue
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-gradient-to-t from-red-600/50 to-red-400/30" />
            Expenses
          </div>
        </div>
      </div>

      {/* Month-by-Month Table */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-6 sm:p-8 shadow-lg overflow-x-auto">
        <h3 className="text-lg font-medium text-white mb-6">Month-by-Month Projection</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#27273A]">
              <th className="text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider pb-3 px-3">Month</th>
              <th className="text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider pb-3 px-3">Revenue</th>
              <th className="text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider pb-3 px-3">Expenses</th>
              <th className="text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider pb-3 px-3">Profit</th>
              <th className="text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider pb-3 px-3">Clients</th>
              <th className="text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider pb-3 px-3">New</th>
              <th className="text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider pb-3 px-3">Churned</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={i} className={`border-b border-[#27273A]/30 hover:bg-[#181824] transition-colors ${
                targetMRR > 0 && m.revenue >= targetMRR ? 'bg-emerald-500/5' : ''
              }`}>
                <td className="py-3 px-3 text-zinc-300 font-medium">{m.label} (M{m.month})</td>
                <td className="py-3 px-3 text-right text-emerald-400">{fmt(m.revenue)}</td>
                <td className="py-3 px-3 text-right text-red-400">{fmt(m.expenses)}</td>
                <td className={`py-3 px-3 text-right font-medium ${m.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(m.profit)}</td>
                <td className="py-3 px-3 text-right text-zinc-300">{m.clients}</td>
                <td className="py-3 px-3 text-right text-purple-400">+{m.newClients}</td>
                <td className="py-3 px-3 text-right text-zinc-500">-{m.churnedClients}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reality Check */}
      <div className="bg-gradient-to-br from-[#12121A] to-[#0f0f1a] border border-purple-500/20 rounded-3xl p-6 sm:p-8 shadow-lg">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} className="text-purple-400" />
          <h3 className="text-lg font-medium text-white">Reality Check</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RealityCheckItem
            label="Can your services support this growth?"
            status={serviceMixRevenue >= (targetMRR - currentMRR) ? 'good' : 'warning'}
            detail={serviceMixRevenue >= (targetMRR - currentMRR)
              ? `Your service mix of ${fmt(serviceMixRevenue)}/mo covers the ${fmt(targetMRR - currentMRR)} gap.`
              : `Service mix only covers ${fmt(serviceMixRevenue)} of the ${fmt(targetMRR - currentMRR)} gap. Adjust pricing or add services.`
            }
          />
          <RealityCheckItem
            label="Do you have enough prospects?"
            status={prospectsNeeded <= 0 ? 'good' : 'warning'}
            detail={prospectsNeeded <= 0
              ? 'No additional prospects needed — your pipeline covers it.'
              : `You need ${prospectsNeeded} prospects at ${closeRate}% close rate to get ${clientsNeeded} new clients.`
            }
          />
          <RealityCheckItem
            label="Is churn factored in?"
            status={(churnRate || 0) > 0 ? 'good' : 'info'}
            detail={churnRate > 0
              ? `${churnRate}% monthly churn (~${Math.round(activeAccounts.length * churnRate / 100)} clients/mo) is factored into projections.`
              : 'Set a churn rate in Goal Builder for more accurate projections.'
            }
          />
          <RealityCheckItem
            label="Are margins healthy?"
            status={(currentMRR - totalExpenses) / Math.max(currentMRR, 1) > 0.4 ? 'good' : 'warning'}
            detail={`Current margin: ${fmtPct((currentMRR - totalExpenses) / Math.max(currentMRR, 1) * 100)}. Agency target should be 40-60%+.`}
          />
        </div>
      </div>
    </div>
  );
}

function RealityCheckItem({ label, status, detail }: {
  label: string;
  status: 'good' | 'warning' | 'info';
  detail: string;
}) {
  const colors = {
    good: { bg: 'bg-emerald-500/5', border: 'border-emerald-500/15', dot: 'bg-emerald-400', text: 'text-emerald-300' },
    warning: { bg: 'bg-amber-500/5', border: 'border-amber-500/15', dot: 'bg-amber-400', text: 'text-amber-300' },
    info: { bg: 'bg-blue-500/5', border: 'border-blue-500/15', dot: 'bg-blue-400', text: 'text-blue-300' },
  };
  const c = colors[status];
  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${c.dot}`} />
        <p className={`text-xs font-medium ${c.text}`}>{label}</p>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed">{detail}</p>
    </div>
  );
}
