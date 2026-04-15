import React, { useState, useCallback } from 'react';
import {
  Plus,
  ArrowLeft,
  Loader,
  Trash2,
  RefreshCw,
  Check,
  ChevronDown,
  Copy,
  Edit3,
  X,
  Briefcase,
  DollarSign,
  FileText,
  BookOpen,
  Mail,
  Users,
  Star,
  Package,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import {
  useFirestoreServices,
  useFirestoreServiceMutations,
  type FirestoreService,
  type PricingTier,
  type OnboardingStep,
  type OnboardingEmail,
  type SOPPart,
  type ServiceAnalysis,
} from '../hooks/useFirestore';

type View = 'list' | 'add' | 'detail';
type DetailTab = 'overview' | 'sop' | 'training' | 'onboarding' | 'pricing';

// ─── Component ────────────────────────────────────────────

export default function Services() {
  const { services, loading } = useFirestoreServices();
  const { createService, updateService, deleteService } = useFirestoreServiceMutations();

  // Navigation
  const [view, setView] = useState<View>('list');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');

  // Add flow
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [generatedData, setGeneratedData] = useState<Partial<FirestoreService> | null>(null);
  const [saving, setSaving] = useState(false);

  // Editing
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');

  // Regeneration
  const [regenSection, setRegenSection] = useState<string | null>(null);

  // Copied
  const [copiedEmail, setCopiedEmail] = useState<number | null>(null);

  const selectedService = services.find((s) => s.id === selectedServiceId) || null;

  // ── Generate service ──────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!newName.trim()) return;
    setGenerating(true);
    setGenError(null);
    setGeneratedData(null);
    try {
      const res = await fetch('/api/services/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || 'Generation failed');
      }
      setGeneratedData(await res.json());
    } catch (err: any) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  }, [newName, newDescription]);

  // ── Save generated service ────────────────────────────
  const handleSave = useCallback(async () => {
    if (!generatedData) return;
    setSaving(true);
    try {
      await createService(generatedData);
      setView('list');
      setGeneratedData(null);
      setNewName('');
      setNewDescription('');
    } catch (err: any) {
      setGenError(err.message);
    } finally {
      setSaving(false);
    }
  }, [generatedData, createService]);

  // ── Delete service ────────────────────────────────────
  const handleDelete = useCallback(async (id: string) => {
    await deleteService(id);
    if (selectedServiceId === id) {
      setView('list');
      setSelectedServiceId(null);
    }
  }, [deleteService, selectedServiceId]);

  // ── Regenerate section ────────────────────────────────
  const handleRegenerate = useCallback(async (section: string) => {
    if (!selectedService) return;
    setRegenSection(section);
    try {
      const res = await fetch('/api/services/regenerate-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName: selectedService.name, section }),
      });
      if (!res.ok) throw new Error('Regeneration failed');
      const data = await res.json();

      const updates: Partial<FirestoreService> = {};
      if (section === 'sop') updates.sop = data.content;
      else if (section === 'training') updates.trainingDocs = data.content;
      else if (section === 'onboarding') updates.onboardingSteps = data.steps;
      else if (section === 'emails') updates.onboardingEmails = data.emails;
      else if (section === 'pricing') {
        updates.pricingTiers = data.pricingTiers;
        updates.pricingNotes = data.pricingNotes;
        updates.margin = data.margin;
        const pricing: Record<string, string> = {};
        for (const tier of data.pricingTiers || []) {
          pricing[tier.name.toLowerCase()] = tier.price;
        }
        updates.pricing = pricing;
      }

      await updateService(selectedService.id, updates);
    } catch {
    } finally {
      setRegenSection(null);
    }
  }, [selectedService, updateService]);

  // ── Save inline edit ──────────────────────────────────
  const saveEdit = useCallback(async (field: string) => {
    if (!selectedService) return;
    await updateService(selectedService.id, { [field]: editBuffer } as any);
    setEditingField(null);
    setEditBuffer('');
  }, [selectedService, updateService, editBuffer]);

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedEmail(idx);
    setTimeout(() => setCopiedEmail(null), 2000);
  };

  // ─── LIST VIEW ────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Services</h2>
            <p className="text-sm text-zinc-500 mt-1">AI-powered service operations and planning</p>
          </div>
          <button
            onClick={() => { setView('add'); setGeneratedData(null); setGenError(null); setNewName(''); setNewDescription(''); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all"
          >
            <Plus size={16} />
            Add Service
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader size={24} className="text-purple-400 animate-spin" />
          </div>
        ) : services.length === 0 ? (
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-12 text-center">
            <Briefcase size={40} className="mx-auto mb-4 text-zinc-600" />
            <p className="text-zinc-400 mb-2">No services yet</p>
            <p className="text-xs text-zinc-600 mb-6">Add your first service and AI will generate SOPs, training docs, onboarding flows, and pricing recommendations.</p>
            <button
              onClick={() => setView('add')}
              className="px-4 py-2 rounded-xl bg-purple-600 text-sm text-white font-medium hover:bg-purple-500 transition-colors"
            >
              Add Your First Service
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {services.map((svc) => (
              <motion.div
                key={svc.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 cursor-pointer hover:border-purple-500/30 transition-all group"
                onClick={() => { setSelectedServiceId(svc.id); setView('detail'); setDetailTab('overview'); }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600/20 to-purple-400/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                      <Briefcase size={16} className="text-purple-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white">{svc.name}</h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        svc.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-400'
                      }`}>
                        {svc.status}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(svc.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2 mb-4">{svc.description || 'No description'}</p>

                <div className="flex items-center gap-4 text-[10px] text-zinc-500">
                  {svc.clients != null && (
                    <span className="flex items-center gap-1"><Users size={10} /> {svc.clients} clients</span>
                  )}
                  {svc.margin != null && (
                    <span className="flex items-center gap-1"><DollarSign size={10} /> {svc.margin}% margin</span>
                  )}
                  {svc.sopStatus && (
                    <span className={`flex items-center gap-1 ${svc.sopStatus === 'complete' ? 'text-emerald-400' : 'text-amber-400'}`}>
                      <FileText size={10} /> SOP {svc.sopStatus}
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── ADD SERVICE FLOW (AI-assisted) ────────────────────
  if (view === 'add') {
    const analysis = generatedData?.analysis as ServiceAnalysis | undefined;
    const genStage = !generatedData ? 'input' : 'review';

    return (
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setView('list')}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-white">AI Service Builder</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Tell us the service — AI handles the rest</p>
          </div>
          {generatedData && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-sm text-white font-medium hover:bg-emerald-500 transition-colors disabled:opacity-40"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
              Save Service
            </button>
          )}
        </div>

        {/* Chat-like flow */}
        <div className="space-y-4">
          {/* AI welcome message */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_12px_rgba(168,85,247,0.3)]">
              <Star size={14} className="text-white" />
            </div>
            <div className="flex-1 bg-[#12121A] border border-[#27273A] rounded-2xl rounded-tl-md p-4">
              <p className="text-sm text-zinc-300 leading-relaxed">
                What service would you like to add? Give me a name and any details about how your agency delivers it — I'll analyze the market, identify failure points, and build out everything: pricing, SOPs, training docs, onboarding, and emails.
              </p>
            </div>
          </div>

          {/* User input area */}
          <div className="flex gap-3">
            <div className="w-8 h-8 shrink-0" />
            <div className="flex-1 space-y-3">
              <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl rounded-tl-md p-4 space-y-3">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Service name (e.g. Social Media Management)"
                  className="w-full bg-transparent text-white text-sm placeholder-zinc-600 outline-none font-medium"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim() && !generating) handleGenerate();
                  }}
                />
                {newName.trim() && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                    <textarea
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="Add details... how do you deliver it, what makes it unique, target clients? (optional)"
                      rows={2}
                      className="w-full bg-transparent text-sm text-zinc-400 placeholder-zinc-700 outline-none resize-none border-t border-[#27273A] pt-3"
                    />
                  </motion.div>
                )}
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating || !newName.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-xs text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <Loader size={12} className="animate-spin" />
                    Analyzing &amp; building service package...
                  </>
                ) : generatedData ? (
                  <>
                    <RefreshCw size={12} />
                    Re-analyze
                  </>
                ) : (
                  <>
                    <Star size={12} />
                    Build Service
                  </>
                )}
              </button>
            </div>
          </div>

          {genError && (
            <div className="flex gap-3">
              <div className="w-8 shrink-0" />
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex-1">
                <p className="text-xs text-red-400">{genError}</p>
              </div>
            </div>
          )}

          {/* AI Analysis Response */}
          <AnimatePresence>
            {analysis && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3"
              >
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-600 to-purple-400 flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_12px_rgba(168,85,247,0.3)]">
                  <Star size={14} className="text-white" />
                </div>
                <div className="flex-1 space-y-3">
                  {/* Analysis insight message */}
                  <div className="bg-[#12121A] border border-purple-500/20 rounded-2xl rounded-tl-md p-4">
                    <p className="text-sm text-zinc-300 leading-relaxed mb-3">
                      I've analyzed <span className="text-white font-medium">{generatedData?.name}</span>. Here's what I found — this analysis drives every recommendation below:
                    </p>

                    {/* Compact analysis grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {/* Ideal client */}
                      <div className="md:col-span-2 bg-[#0A0A0F] rounded-xl p-3">
                        <p className="text-[9px] font-medium text-blue-400 uppercase tracking-wider mb-1">Ideal Client</p>
                        <p className="text-xs text-zinc-300">{analysis.idealClient}</p>
                      </div>

                      {/* Failure points - most important */}
                      <div className="bg-[#0A0A0F] border border-red-500/10 rounded-xl p-3">
                        <p className="text-[9px] font-medium text-red-400 uppercase tracking-wider mb-1.5">Why This Service Fails</p>
                        <ul className="space-y-1">
                          {analysis.commonFailurePoints.map((f, i) => (
                            <li key={i} className="text-[11px] text-zinc-400 flex items-start gap-1.5">
                              <span className="mt-1.5 w-1 h-1 rounded-full bg-red-400 shrink-0" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Differentiators */}
                      <div className="bg-[#0A0A0F] border border-emerald-500/10 rounded-xl p-3">
                        <p className="text-[9px] font-medium text-emerald-400 uppercase tracking-wider mb-1.5">What Makes It Work</p>
                        <ul className="space-y-1">
                          {analysis.keyDifferentiators.map((d, i) => (
                            <li key={i} className="text-[11px] text-zinc-400 flex items-start gap-1.5">
                              <span className="mt-1.5 w-1 h-1 rounded-full bg-emerald-400 shrink-0" />
                              {d}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Deliverables + Skills */}
                      <div className="bg-[#0A0A0F] rounded-xl p-3">
                        <p className="text-[9px] font-medium text-purple-400 uppercase tracking-wider mb-1.5">Core Deliverables</p>
                        <div className="flex flex-wrap gap-1">
                          {analysis.coreDeliverables.map((d, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300">{d}</span>
                          ))}
                        </div>
                      </div>

                      <div className="bg-[#0A0A0F] rounded-xl p-3">
                        <p className="text-[9px] font-medium text-amber-400 uppercase tracking-wider mb-1.5">Margin Protectors</p>
                        <div className="flex flex-wrap gap-1">
                          {analysis.marginProtectors.map((m, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300">{m}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AI says: here's what I built */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl rounded-tl-md p-4">
                    <p className="text-sm text-zinc-300 leading-relaxed">
                      Based on this analysis, I've built your complete service package. Each section is designed to prevent the failure points above. Review and save when ready.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Generated content sections - presented as AI outputs */}
          <AnimatePresence>
            {generatedData && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="flex gap-3"
              >
                <div className="w-8 shrink-0" />
                <div className="flex-1 space-y-3">
                  {/* Description */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-4">
                    <p className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Service Description</p>
                    <p className="text-sm text-zinc-200 leading-relaxed">{generatedData.description}</p>
                  </div>

                  {/* Pricing */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <p className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider">Pricing Recommendation</p>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">{generatedData.margin}% margin</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {generatedData.pricingTiers?.map((tier, i) => (
                        <div key={i} className={`bg-[#0A0A0F] rounded-xl p-3 border ${i === 1 ? 'border-purple-500/30' : 'border-[#27273A]'}`}>
                          <p className="text-[10px] font-semibold text-purple-300 mb-0.5">{tier.name}</p>
                          <p className="text-base font-bold text-white mb-2">{tier.price}</p>
                          <ul className="space-y-0.5">
                            {tier.features.map((f, j) => (
                              <li key={j} className="text-[10px] text-zinc-400 flex items-start gap-1">
                                <Check size={8} className="text-emerald-400 mt-0.5 shrink-0" />
                                {f}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    {generatedData.pricingNotes && (
                      <p className="text-[10px] text-zinc-500 leading-relaxed italic">{generatedData.pricingNotes}</p>
                    )}
                  </div>

                  {/* Vendors & Upsells row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-4">
                      <p className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Tools & Vendors</p>
                      <div className="flex flex-wrap gap-1">
                        {generatedData.vendors?.map((v, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-lg text-[10px] bg-[#0A0A0F] border border-[#27273A] text-zinc-300">{v}</span>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-4">
                      <p className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Upsell Opportunities</p>
                      <div className="flex flex-wrap gap-1">
                        {generatedData.upsells?.map((u, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-lg text-[10px] bg-purple-500/10 border border-purple-500/20 text-purple-300">{u}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* SOP outline */}
                  <ReviewSection title={`SOP Outline · ${generatedData.sopParts?.length || 0} parts`} icon={<FileText size={14} />} collapsible>
                    <p className="text-[10px] text-zinc-500 mb-3">Generate each part individually after saving. Recommended parts build the foundation.</p>
                    <div className="space-y-1.5">
                      {generatedData.sopParts?.map((part, i) => (
                        <div key={i} className="flex items-start gap-2.5 p-2.5 bg-[#0A0A0F] border border-[#27273A] rounded-lg">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                            part.recommended ? 'bg-purple-500/20' : 'bg-[#12121A]'
                          }`}>
                            <span className={`text-[8px] font-bold ${part.recommended ? 'text-purple-300' : 'text-zinc-600'}`}>{part.order}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-zinc-200">{part.title}
                              {part.recommended && <span className="ml-1.5 text-[8px] text-purple-400">recommended</span>}
                            </p>
                            <p className="text-[10px] text-zinc-500 leading-relaxed">{part.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ReviewSection>

                  {/* Training */}
                  <ReviewSection title="Training Documentation" icon={<BookOpen size={14} />} collapsible>
                    <StyledMarkdown>{generatedData.trainingDocs || ''}</StyledMarkdown>
                  </ReviewSection>

                  {/* Onboarding */}
                  <ReviewSection title={`Onboarding · ${generatedData.onboardingSteps?.length || 0} steps`} icon={<Users size={14} />} collapsible>
                    <div className="space-y-1.5">
                      {generatedData.onboardingSteps?.map((step, i) => (
                        <div key={i} className="flex items-start gap-2.5 p-2.5 bg-[#0A0A0F] border border-[#27273A] rounded-lg">
                          <div className="w-5 h-5 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="text-[8px] font-bold text-purple-300">{step.order}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-zinc-200">{step.title}
                              <span className="ml-1.5 text-[9px] text-zinc-600">{step.timeline}</span>
                            </p>
                            <p className="text-[10px] text-zinc-500 leading-relaxed">{step.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ReviewSection>

                  {/* Emails */}
                  <ReviewSection title={`Onboarding Emails · ${generatedData.onboardingEmails?.length || 0}`} icon={<Mail size={14} />} collapsible>
                    <div className="space-y-2">
                      {generatedData.onboardingEmails?.map((email, i) => (
                        <EmailCard key={i} email={email} idx={i} copiedIdx={copiedEmail} onCopy={copyToClipboard} />
                      ))}
                    </div>
                  </ReviewSection>

                  {/* Save */}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 text-sm text-white font-medium hover:bg-emerald-500 transition-colors disabled:opacity-40"
                  >
                    {saving ? <Loader size={16} className="animate-spin" /> : <Check size={16} />}
                    Save Service to Library
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // ─── DETAIL VIEW ──────────────────────────────────────
  if (view === 'detail' && selectedService) {
    const TABS: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
      { id: 'overview', label: 'Overview', icon: <Briefcase size={14} /> },
      { id: 'sop', label: 'SOP', icon: <FileText size={14} /> },
      { id: 'training', label: 'Training', icon: <BookOpen size={14} /> },
      { id: 'onboarding', label: 'Onboarding', icon: <Users size={14} /> },
      { id: 'pricing', label: 'Pricing', icon: <DollarSign size={14} /> },
    ];

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setView('list'); setSelectedServiceId(null); }}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{selectedService.name}</h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{selectedService.description}</p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${
            selectedService.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-400'
          }`}>
            {selectedService.status}
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-[#12121A] border border-[#27273A] rounded-xl p-1 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setDetailTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                detailTab === tab.id
                  ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.2)]'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={detailTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {detailTab === 'overview' && (
              <div className="space-y-4">
                {/* AI Analysis */}
                {selectedService.analysis && (
                  <AnalysisPanel analysis={selectedService.analysis} />
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Clients', value: selectedService.clients ?? 0, icon: <Users size={14} /> },
                    { label: 'Margin', value: `${selectedService.margin ?? 0}%`, icon: <DollarSign size={14} /> },
                    { label: 'SOP', value: selectedService.sopStatus || 'N/A', icon: <FileText size={14} /> },
                    { label: 'Vendors', value: selectedService.vendors?.length ?? 0, icon: <Package size={14} /> },
                  ].map((stat, i) => (
                    <div key={i} className="bg-[#12121A] border border-[#27273A] rounded-xl p-4">
                      <div className="flex items-center gap-1.5 mb-1 text-zinc-500">{stat.icon}<span className="text-[10px] uppercase tracking-wider">{stat.label}</span></div>
                      <p className="text-lg font-bold text-white">{stat.value}</p>
                    </div>
                  ))}
                </div>

                {/* Description */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Description</h3>
                    <button
                      onClick={() => { setEditingField('description'); setEditBuffer(selectedService.description || ''); }}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#181824] transition-colors"
                    >
                      <Edit3 size={12} />
                    </button>
                  </div>
                  {editingField === 'description' ? (
                    <div className="space-y-2">
                      <textarea
                        value={editBuffer}
                        onChange={(e) => setEditBuffer(e.target.value)}
                        rows={3}
                        className="w-full bg-[#0A0A0F] border border-purple-500/30 rounded-xl px-4 py-3 text-sm text-white outline-none resize-none"
                      />
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit('description')} className="px-3 py-1.5 rounded-lg bg-purple-600 text-xs text-white">Save</button>
                        <button onClick={() => setEditingField(null)} className="px-3 py-1.5 rounded-lg border border-[#27273A] text-xs text-zinc-400">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-300 leading-relaxed">{selectedService.description || 'No description'}</p>
                  )}
                </div>

                {/* Vendors & Upsells */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Vendors & Tools</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedService.vendors?.map((v, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-lg text-[11px] bg-[#0A0A0F] border border-[#27273A] text-zinc-300">{v}</span>
                      )) || <p className="text-xs text-zinc-600">None</p>}
                    </div>
                  </div>
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Upsell Opportunities</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedService.upsells?.map((u, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-lg text-[11px] bg-purple-500/10 border border-purple-500/20 text-purple-300">{u}</span>
                      )) || <p className="text-xs text-zinc-600">None</p>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {detailTab === 'sop' && (
              <SOPTab
                service={selectedService}
                updateService={updateService}
              />
            )}

            {detailTab === 'training' && (
              <MarkdownTab
                title="Training Documentation"
                content={selectedService.trainingDocs}
                section="training"
                regenSection={regenSection}
                onRegenerate={handleRegenerate}
                serviceId={selectedService.id}
                field="trainingDocs"
                updateService={updateService}
              />
            )}

            {detailTab === 'onboarding' && (
              <div className="space-y-5">
                {/* Steps */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                      Onboarding Steps · {selectedService.onboardingSteps?.length || 0}
                    </h3>
                    <button
                      onClick={() => handleRegenerate('onboarding')}
                      disabled={regenSection === 'onboarding'}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-zinc-500 hover:text-purple-300 border border-[#27273A] hover:border-purple-500/30 transition-all disabled:opacity-40"
                    >
                      {regenSection === 'onboarding' ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                      Regenerate
                    </button>
                  </div>
                  <div className="space-y-2">
                    {selectedService.onboardingSteps?.map((step, i) => (
                      <div key={i} className="flex gap-3 p-3 bg-[#0A0A0F] border border-[#27273A] rounded-xl">
                        <div className="w-7 h-7 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-bold text-purple-300">{step.order}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-xs font-medium text-white">{step.title}</p>
                            <span className="text-[9px] text-zinc-500 bg-[#12121A] px-1.5 py-0.5 rounded">{step.timeline}</span>
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">{step.description}</p>
                        </div>
                      </div>
                    )) || <p className="text-xs text-zinc-600 py-4 text-center">No onboarding steps generated yet.</p>}
                  </div>
                </div>

                {/* Emails */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                      Onboarding Emails · {selectedService.onboardingEmails?.length || 0}
                    </h3>
                    <button
                      onClick={() => handleRegenerate('emails')}
                      disabled={regenSection === 'emails'}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-zinc-500 hover:text-purple-300 border border-[#27273A] hover:border-purple-500/30 transition-all disabled:opacity-40"
                    >
                      {regenSection === 'emails' ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                      Regenerate
                    </button>
                  </div>
                  <div className="space-y-3">
                    {selectedService.onboardingEmails?.map((email, i) => (
                      <EmailCard key={i} email={email} idx={i} copiedIdx={copiedEmail} onCopy={copyToClipboard} />
                    )) || <p className="text-xs text-zinc-600 py-4 text-center">No onboarding emails generated yet.</p>}
                  </div>
                </div>
              </div>
            )}

            {detailTab === 'pricing' && (
              <div className="space-y-4">
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Pricing Tiers</h3>
                    <button
                      onClick={() => handleRegenerate('pricing')}
                      disabled={regenSection === 'pricing'}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-zinc-500 hover:text-purple-300 border border-[#27273A] hover:border-purple-500/30 transition-all disabled:opacity-40"
                    >
                      {regenSection === 'pricing' ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                      Regenerate
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {selectedService.pricingTiers?.map((tier, i) => (
                      <div key={i} className="bg-[#0A0A0F] border border-[#27273A] rounded-xl p-5">
                        <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider mb-1">{tier.name}</p>
                        <p className="text-2xl font-bold text-white mb-4">{tier.price}</p>
                        <ul className="space-y-2">
                          {tier.features.map((f, j) => (
                            <li key={j} className="text-xs text-zinc-400 flex items-start gap-2">
                              <Check size={12} className="text-emerald-400 mt-0.5 shrink-0" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )) || <p className="text-xs text-zinc-600 py-4 text-center col-span-3">No pricing generated yet.</p>}
                  </div>
                </div>

                {selectedService.pricingNotes && (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Pricing Rationale</h3>
                    <p className="text-sm text-zinc-400 leading-relaxed">{selectedService.pricingNotes}</p>
                  </div>
                )}

                {selectedService.margin != null && (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-2">Estimated Margin</h3>
                    <div className="flex items-center gap-3">
                      <div className="text-3xl font-bold text-white">{selectedService.margin}%</div>
                      <div className="flex-1">
                        <div className="w-full bg-[#0A0A0F] rounded-full h-3">
                          <div
                            className="bg-gradient-to-r from-purple-600 to-emerald-500 h-3 rounded-full transition-all"
                            style={{ width: `${selectedService.margin}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return null;
}

// ─── SOP Tab (parts-based) ────────────────────────────────

function SOPTab({ service, updateService }: {
  service: FirestoreService;
  updateService: (id: string, data: Partial<FirestoreService>) => Promise<any>;
}) {
  const [generatingOutline, setGeneratingOutline] = useState(false);
  const [generatingPart, setGeneratingPart] = useState<string | null>(null);
  const [expandedPart, setExpandedPart] = useState<string | null>(null);
  const [editingPart, setEditingPart] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parts = service.sopParts || [];
  const completedCount = parts.filter((p) => p.content).length;
  const recommendedParts = parts.filter((p) => p.recommended);
  const otherParts = parts.filter((p) => !p.recommended);

  // Generate outline
  const handleGenerateOutline = async () => {
    setGeneratingOutline(true);
    setError(null);
    try {
      const res = await fetch('/api/services/sop/generate-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceName: service.name, serviceDescription: service.description }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || 'Failed to generate outline');
      }
      const data = await res.json();
      await updateService(service.id, { sopParts: data.parts, sopStatus: 'outline-ready' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGeneratingOutline(false);
    }
  };

  // Generate a single part
  const handleGeneratePart = async (part: SOPPart) => {
    setGeneratingPart(part.id);
    setError(null);
    try {
      const res = await fetch('/api/services/sop/generate-part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName: service.name,
          partTitle: part.title,
          partDescription: part.description,
          allParts: parts.map((p) => ({ title: p.title, order: p.order })),
          analysis: service.analysis || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || 'Failed to generate part');
      }
      const data = await res.json();
      const updated = parts.map((p) =>
        p.id === part.id ? { ...p, content: data.content } : p
      );
      const allDone = updated.every((p) => p.content);
      await updateService(service.id, {
        sopParts: updated,
        sopStatus: allDone ? 'complete' : 'in-progress',
      });
      setExpandedPart(part.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGeneratingPart(null);
    }
  };

  // Save inline edit
  const handleSaveEdit = async (partId: string) => {
    const updated = parts.map((p) =>
      p.id === partId ? { ...p, content: editBuffer } : p
    );
    await updateService(service.id, { sopParts: updated });
    setEditingPart(null);
    setEditBuffer('');
  };

  // No outline yet
  if (parts.length === 0) {
    return (
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-8 text-center">
        <FileText size={32} className="mx-auto mb-3 text-zinc-600" />
        <p className="text-sm text-zinc-400 mb-2">No SOP outline generated yet</p>
        <p className="text-xs text-zinc-600 mb-5">Generate an outline first, then build each section individually.</p>
        <button
          onClick={handleGenerateOutline}
          disabled={generatingOutline}
          className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40"
        >
          {generatingOutline ? <Loader size={14} className="animate-spin" /> : <Star size={14} />}
          Generate SOP Outline
        </button>
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
            SOP Progress · {completedCount}/{parts.length} parts
          </h3>
          <button
            onClick={handleGenerateOutline}
            disabled={generatingOutline}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-zinc-500 hover:text-purple-300 border border-[#27273A] hover:border-purple-500/30 transition-all disabled:opacity-40"
          >
            {generatingOutline ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Regenerate Outline
          </button>
        </div>
        <div className="w-full bg-[#0A0A0F] rounded-full h-2">
          <div
            className="bg-gradient-to-r from-purple-600 to-emerald-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${parts.length > 0 ? (completedCount / parts.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Recommended parts */}
      {recommendedParts.length > 0 && (
        <div>
          <p className="text-[10px] text-purple-400 uppercase tracking-wider font-medium mb-2 flex items-center gap-1.5 px-1">
            <Star size={10} /> Recommended — generate these first
          </p>
          <div className="space-y-2">
            {recommendedParts.map((part) => (
              <SOPPartCard
                key={part.id}
                part={part}
                isExpanded={expandedPart === part.id}
                isGenerating={generatingPart === part.id}
                isEditing={editingPart === part.id}
                editBuffer={editBuffer}
                onToggle={() => setExpandedPart(expandedPart === part.id ? null : part.id)}
                onGenerate={() => handleGeneratePart(part)}
                onStartEdit={() => { setEditingPart(part.id); setEditBuffer(part.content || ''); }}
                onCancelEdit={() => setEditingPart(null)}
                onSaveEdit={() => handleSaveEdit(part.id)}
                onEditChange={setEditBuffer}
              />
            ))}
          </div>
        </div>
      )}

      {/* Other parts */}
      {otherParts.length > 0 && (
        <div>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2 px-1">
            Additional Sections
          </p>
          <div className="space-y-2">
            {otherParts.map((part) => (
              <SOPPartCard
                key={part.id}
                part={part}
                isExpanded={expandedPart === part.id}
                isGenerating={generatingPart === part.id}
                isEditing={editingPart === part.id}
                editBuffer={editBuffer}
                onToggle={() => setExpandedPart(expandedPart === part.id ? null : part.id)}
                onGenerate={() => handleGeneratePart(part)}
                onStartEdit={() => { setEditingPart(part.id); setEditBuffer(part.content || ''); }}
                onCancelEdit={() => setEditingPart(null)}
                onSaveEdit={() => handleSaveEdit(part.id)}
                onEditChange={setEditBuffer}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SOPPartCard({ part, isExpanded, isGenerating, isEditing, editBuffer, onToggle, onGenerate, onStartEdit, onCancelEdit, onSaveEdit, onEditChange }: {
  part: SOPPart;
  isExpanded: boolean;
  isGenerating: boolean;
  isEditing: boolean;
  editBuffer: string;
  onToggle: () => void;
  onGenerate: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditChange: (v: string) => void;
}) {
  const hasContent = !!part.content;

  return (
    <div className={`bg-[#12121A] border rounded-xl overflow-hidden transition-colors ${
      hasContent ? 'border-emerald-500/20' : 'border-[#27273A]'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          hasContent
            ? 'bg-emerald-500/20 border border-emerald-500/30'
            : part.recommended
              ? 'bg-purple-500/20 border border-purple-500/30'
              : 'bg-[#0A0A0F] border border-[#27273A]'
        }`}>
          {hasContent ? (
            <Check size={12} className="text-emerald-400" />
          ) : (
            <span className={`text-[10px] font-bold ${part.recommended ? 'text-purple-300' : 'text-zinc-500'}`}>{part.order}</span>
          )}
        </div>

        <button onClick={onToggle} className="flex-1 min-w-0 text-left">
          <p className="text-xs font-medium text-white truncate">{part.title}</p>
          <p className="text-[10px] text-zinc-500 truncate">{part.description}</p>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasContent && (
            <>
              <button
                onClick={onStartEdit}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-[#181824] transition-colors"
                title="Edit"
              >
                <Edit3 size={11} />
              </button>
              <button
                onClick={onGenerate}
                disabled={isGenerating}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-purple-300 hover:bg-purple-500/10 transition-colors disabled:opacity-40"
                title="Regenerate"
              >
                {isGenerating ? <Loader size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              </button>
            </>
          )}
          {!hasContent && (
            <button
              onClick={onGenerate}
              disabled={isGenerating}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40"
            >
              {isGenerating ? <Loader size={10} className="animate-spin" /> : <Star size={10} />}
              {isGenerating ? 'Generating...' : 'Generate'}
            </button>
          )}
          {hasContent && (
            <button onClick={onToggle} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors">
              <ChevronDown size={12} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && hasContent && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-[#27273A] pt-3">
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={editBuffer}
                    onChange={(e) => onEditChange(e.target.value)}
                    rows={16}
                    className="w-full bg-[#0A0A0F] border border-purple-500/30 rounded-xl px-4 py-3 text-xs text-zinc-300 font-mono outline-none resize-y"
                  />
                  <div className="flex gap-2">
                    <button onClick={onSaveEdit} className="px-3 py-1.5 rounded-lg bg-purple-600 text-xs text-white">Save</button>
                    <button onClick={onCancelEdit} className="px-3 py-1.5 rounded-lg border border-[#27273A] text-xs text-zinc-400">Cancel</button>
                  </div>
                </div>
              ) : (
                <StyledMarkdown>{part.content || ''}</StyledMarkdown>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generating state */}
      {isGenerating && !hasContent && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 text-xs text-purple-400">
            <Loader size={12} className="animate-spin" />
            Generating "{part.title}"...
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Analysis Panel ───────────────────────────────────────

// ─── Styled Markdown Renderer ─────────────────────────────

function StyledMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => (
          <div className="mb-5 pb-3 border-b border-[#27273A]">
            <h1 className="text-lg font-bold text-white">{children}</h1>
          </div>
        ),
        h2: ({ children }) => (
          <div className="mt-6 mb-3 flex items-center gap-2.5">
            <div className="w-1 h-5 rounded-full bg-gradient-to-b from-purple-500 to-purple-400 shrink-0" />
            <h2 className="text-sm font-semibold text-white">{children}</h2>
          </div>
        ),
        h3: ({ children }) => (
          <h3 className="text-xs font-semibold text-zinc-200 mt-4 mb-2 uppercase tracking-wider">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-xs font-medium text-zinc-300 mt-3 mb-1.5">{children}</h4>
        ),
        p: ({ children }) => {
          const text = String(children);
          // Style WARNING and CHECKPOINT callouts
          if (text.startsWith('WARNING') || text.startsWith('⚠')) {
            return (
              <div className="my-2 flex gap-2.5 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
                <span className="text-amber-400 text-xs mt-0.5 shrink-0">⚠</span>
                <p className="text-xs text-amber-200/80 leading-relaxed">{text.replace(/^(WARNING:?\s*|⚠\s*)/, '')}</p>
              </div>
            );
          }
          if (text.startsWith('CHECKPOINT') || text.startsWith('✓')) {
            return (
              <div className="my-2 flex gap-2.5 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                <span className="text-emerald-400 text-xs mt-0.5 shrink-0">✓</span>
                <p className="text-xs text-emerald-200/80 leading-relaxed">{text.replace(/^(CHECKPOINT:?\s*|✓\s*)/, '')}</p>
              </div>
            );
          }
          if (text.startsWith('TIP') || text.startsWith('💡')) {
            return (
              <div className="my-2 flex gap-2.5 p-3 rounded-lg bg-blue-500/5 border border-blue-500/15">
                <span className="text-blue-400 text-xs mt-0.5 shrink-0">💡</span>
                <p className="text-xs text-blue-200/80 leading-relaxed">{text.replace(/^(TIP:?\s*|💡\s*)/, '')}</p>
              </div>
            );
          }
          return <p className="text-[13px] text-zinc-400 leading-relaxed my-2">{children}</p>;
        },
        ul: ({ children }) => (
          <ul className="my-2 space-y-1.5 ml-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-2 space-y-1.5 ml-1 counter-reset-item">{children}</ol>
        ),
        li: ({ children, ...props }) => {
          const isOrdered = (props as any).ordered;
          const index = (props as any).index;
          return (
            <li className="flex items-start gap-2 text-[13px] text-zinc-400 leading-relaxed">
              {isOrdered ? (
                <span className="text-[10px] font-bold text-purple-400 bg-purple-500/10 w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5">
                  {(index ?? 0) + 1}
                </span>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400/50 shrink-0 mt-1.5" />
              )}
              <span className="flex-1">{children}</span>
            </li>
          );
        },
        blockquote: ({ children }) => (
          <blockquote className="my-3 pl-4 border-l-2 border-purple-500/30 text-zinc-400 italic">
            {children}
          </blockquote>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return (
              <div className="my-3 rounded-xl bg-[#0A0A0F] border border-[#27273A] overflow-hidden">
                <div className="px-4 py-1.5 bg-[#0f0f18] border-b border-[#27273A]">
                  <span className="text-[9px] text-zinc-600 uppercase tracking-wider">{className?.replace('language-', '') || 'code'}</span>
                </div>
                <pre className="px-4 py-3 overflow-x-auto">
                  <code className="text-xs text-purple-300 font-mono">{children}</code>
                </pre>
              </div>
            );
          }
          return (
            <code className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 text-[11px] font-mono">{children}</code>
          );
        },
        strong: ({ children }) => (
          <strong className="font-semibold text-zinc-200">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="text-zinc-300 italic">{children}</em>
        ),
        hr: () => (
          <hr className="my-4 border-[#27273A]" />
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline underline-offset-2">
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-lg border border-[#27273A]">
            <table className="w-full text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-[#0A0A0F] border-b border-[#27273A]">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-zinc-300 border-b border-[#27273A]/50">{children}</td>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function AnalysisPanel({ analysis }: { analysis: ServiceAnalysis }) {
  const [open, setOpen] = useState(true);

  const sections: { key: keyof ServiceAnalysis; label: string; color: string; isList: boolean }[] = [
    { key: 'idealClient', label: 'Ideal Client', color: 'text-blue-400', isList: false },
    { key: 'coreDeliverables', label: 'Core Deliverables', color: 'text-emerald-400', isList: true },
    { key: 'commonFailurePoints', label: 'Common Failure Points', color: 'text-red-400', isList: true },
    { key: 'keyDifferentiators', label: 'Key Differentiators', color: 'text-purple-400', isList: true },
    { key: 'requiredSkills', label: 'Required Skills', color: 'text-amber-400', isList: true },
    { key: 'marginProtectors', label: 'Margin Protectors', color: 'text-cyan-400', isList: true },
  ];

  return (
    <div className="bg-gradient-to-br from-[#12121A] to-[#0f0f1a] border border-purple-500/20 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-5 py-3.5 text-left hover:bg-[#181824]/50 transition-colors"
      >
        <div className="w-6 h-6 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <Star size={12} className="text-purple-400" />
        </div>
        <span className="text-sm font-medium text-purple-300 flex-1">AI Service Analysis</span>
        <span className="text-[9px] text-purple-400/60 uppercase tracking-wider mr-2">Informs all outputs</span>
        <ChevronDown size={14} className={`text-purple-400/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-purple-500/10 pt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {sections.map(({ key, label, color, isList }) => {
                const value = analysis[key];
                if (!value || (Array.isArray(value) && value.length === 0)) return null;
                return (
                  <div key={key} className={`bg-[#0A0A0F] border border-[#27273A] rounded-xl p-3.5 ${key === 'idealClient' ? 'md:col-span-2' : ''}`}>
                    <p className={`text-[10px] font-medium uppercase tracking-wider mb-2 ${color}`}>{label}</p>
                    {isList ? (
                      <ul className="space-y-1">
                        {(value as string[]).map((item, i) => (
                          <li key={i} className="text-xs text-zinc-400 flex items-start gap-2">
                            <span className={`mt-1.5 w-1 h-1 rounded-full shrink-0 ${color.replace('text-', 'bg-')}`} />
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-300 leading-relaxed">{value as string}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────

function ReviewSection({ title, icon, children, collapsible }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);

  return (
    <div className="bg-[#12121A] border border-[#27273A] rounded-2xl overflow-hidden">
      <button
        onClick={() => collapsible && setOpen(!open)}
        className={`w-full flex items-center gap-2 px-5 py-3.5 text-left ${collapsible ? 'cursor-pointer hover:bg-[#181824]' : ''}`}
      >
        <span className="text-purple-400">{icon}</span>
        <span className="text-sm font-medium text-zinc-300 flex-1">{title}</span>
        {collapsible && (
          <ChevronDown size={14} className={`text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={collapsible ? { height: 0 } : undefined}
            animate={{ height: 'auto' }}
            exit={collapsible ? { height: 0 } : undefined}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 border-t border-[#27273A] pt-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MarkdownTab({ title, content, section, regenSection, onRegenerate, serviceId, field, updateService }: {
  title: string;
  content: string | null;
  section: string;
  regenSection: string | null;
  onRegenerate: (section: string) => void;
  serviceId: string;
  field: string;
  updateService: (id: string, data: Partial<FirestoreService>) => Promise<any>;
}) {
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState('');

  return (
    <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">{title}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (editing) {
                updateService(serviceId, { [field]: buffer } as any);
                setEditing(false);
              } else {
                setBuffer(content || '');
                setEditing(true);
              }
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-zinc-500 hover:text-zinc-300 border border-[#27273A] hover:border-zinc-600 transition-all"
          >
            {editing ? <><Check size={10} /> Save</> : <><Edit3 size={10} /> Edit</>}
          </button>
          {editing && (
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-zinc-500 hover:text-zinc-300 border border-[#27273A] transition-all"
            >
              <X size={10} /> Cancel
            </button>
          )}
          <button
            onClick={() => onRegenerate(section)}
            disabled={regenSection === section}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] text-zinc-500 hover:text-purple-300 border border-[#27273A] hover:border-purple-500/30 transition-all disabled:opacity-40"
          >
            {regenSection === section ? <Loader size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Regenerate
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          rows={24}
          className="w-full bg-[#0A0A0F] border border-purple-500/30 rounded-xl px-4 py-3 text-xs text-zinc-300 font-mono outline-none resize-y"
        />
      ) : content ? (
        <StyledMarkdown>{content}</StyledMarkdown>
      ) : (
        <p className="text-xs text-zinc-600 py-8 text-center">No content generated yet. Click "Regenerate" to create.</p>
      )}
    </div>
  );
}

function EmailCard({ email, idx, copiedIdx, onCopy }: {
  email: OnboardingEmail;
  idx: number;
  copiedIdx: number | null;
  onCopy: (text: string, idx: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const fullText = `Subject: ${email.subject}\n\n${email.body}`;

  return (
    <div className="bg-[#0A0A0F] border border-[#27273A] rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#12121A] transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
          <Mail size={12} className="text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white truncate">{email.name}</p>
          <p className="text-[10px] text-zinc-500">{email.sendDay} · {email.subject}</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(fullText, idx); }}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#181824] transition-colors"
        >
          {copiedIdx === idx ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
        <ChevronDown size={12} className={`text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-[#27273A] pt-3">
              <p className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Subject</p>
              <p className="text-xs text-zinc-200 mb-3">{email.subject}</p>
              <p className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wider">Body</p>
              <StyledMarkdown>{email.body}</StyledMarkdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
