import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, ChevronDown, ChevronRight, Check, X, Sparkles, Clock } from 'lucide-react';
import {
  MODELS,
  PROVIDER_MAP,
  providersWithModels,
  modelsByProvider,
  getModel,
  BEST_FOR_TAGS,
  FEATURE_TAGS,
  type CatalogModel,
  type Provider,
  type BestForTag,
  type FeatureTag,
} from '../lib/modelCatalog';

interface ModelPickerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedId: string;
  onSelect: (id: string) => void;
  recentIds?: string[];
  /** When true, hide models that can't take reference images (refs === 'none'). */
  requireRefs?: boolean;
}

/** Feature set a model satisfies (derived + explicit), for the Features filter/chips. */
function modelFeatures(m: CatalogModel): Set<FeatureTag> {
  const s = new Set<FeatureTag>(m.features ?? []);
  if (m.refs !== 'none') s.add('refs');
  if (m.maxRes === '4K') s.add('hires');
  if (m.isNew) s.add('new');
  return s;
}

function ProviderAvatar({ provider, size = 26 }: { provider: Provider; size?: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-full shrink-0 font-semibold"
      style={{
        width: size,
        height: size,
        background: `${provider.color}22`,
        color: provider.color,
        fontSize: size * 0.5,
      }}
    >
      {provider.icon}
    </div>
  );
}

function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'ref' }) {
  const cls =
    tone === 'ref'
      ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
      : 'bg-[#1C1C28] text-zinc-400 border-[#2A2A3A]';
  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border ${cls}`}>{children}</span>
  );
}

function TierDots({ tier = 2 }: { tier?: number }) {
  return (
    <span className="flex items-center gap-0.5" title={`Relative cost: ${tier}/4`}>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="rounded-full"
          style={{
            width: 4,
            height: 4,
            background: i <= tier ? '#7C6BF0' : '#2A2A3A',
          }}
        />
      ))}
    </span>
  );
}

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: CatalogModel;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const provider = PROVIDER_MAP[model.provider];
  return (
    <button
      onClick={() => onSelect(model.id)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
        selected
          ? 'bg-purple-500/10 border-purple-500/40'
          : 'border-transparent hover:bg-[#16161F] hover:border-[#27273A]'
      }`}
    >
      <ProviderAvatar provider={provider} />
      <span className={`text-[13px] font-medium truncate ${selected ? 'text-purple-200' : 'text-zinc-200'}`}>
        {model.name}
      </span>
      {model.isNew && (
        <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold bg-pink-500/15 text-pink-300 border border-pink-500/25">
          New
        </span>
      )}
      <span className="flex-1" />
      <span className="hidden sm:flex items-center gap-1.5">
        {model.refs !== 'none' && <Chip tone="ref">Refs</Chip>}
        <Chip>{model.maxRes === '4K' ? '2K–4K' : model.maxRes}</Chip>
      </span>
      <TierDots tier={model.tier} />
      {selected && <Check size={15} className="text-purple-300 shrink-0" />}
    </button>
  );
}

/** A single filter dropdown (Provider / Features / Best for). */
function FilterDropdown({
  label,
  active,
  options,
  value,
  onChange,
}: {
  label: string;
  active: boolean;
  options: { key: string; label: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const current = value ? options.find((o) => o.key === value)?.label : null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-colors ${
          active
            ? 'bg-purple-500/10 border-purple-500/30 text-purple-200'
            : 'bg-[#0F0F16] border-[#27273A] text-zinc-300 hover:border-zinc-600'
        }`}
      >
        {current ?? label}
        <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-20 mt-1 min-w-[180px] max-h-[280px] overflow-y-auto bg-[#14141C] border border-[#27273A] rounded-xl p-1 shadow-2xl"
          >
            <button
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-[12px] hover:bg-[#1C1C28] ${
                !value ? 'text-purple-300' : 'text-zinc-400'
              }`}
            >
              All
            </button>
            {options.map((o) => (
              <button
                key={o.key}
                onClick={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-[12px] hover:bg-[#1C1C28] ${
                  value === o.key ? 'text-purple-300' : 'text-zinc-300'
                }`}
              >
                {o.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 px-3 mt-4 mb-1.5">
      {children}
    </p>
  );
}

export default function ModelPicker({
  isOpen,
  onClose,
  selectedId,
  onSelect,
  recentIds = [],
  requireRefs = false,
}: ModelPickerProps) {
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [featureFilter, setFeatureFilter] = useState<string | null>(null);
  const [bestForFilter, setBestForFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 60);
    } else {
      // reset transient state on close
      setQuery('');
      setProviderFilter(null);
      setFeatureFilter(null);
      setBestForFilter(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  const select = (id: string) => {
    onSelect(id);
    onClose();
  };

  const base = useMemo(() => (requireRefs ? MODELS.filter((m) => m.refs !== 'none') : MODELS), [requireRefs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return base.filter((m) => {
      if (providerFilter && m.provider !== providerFilter) return false;
      if (bestForFilter && !m.bestFor.includes(bestForFilter as BestForTag)) return false;
      if (featureFilter && !modelFeatures(m).has(featureFilter as FeatureTag)) return false;
      if (q) {
        const hay = `${m.name} ${PROVIDER_MAP[m.provider]?.name ?? ''} ${m.id} ${m.bestFor.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [base, query, providerFilter, featureFilter, bestForFilter]);

  const isFiltering = !!(query.trim() || providerFilter || featureFilter || bestForFilter);

  const featured = base.filter((m) => m.featured);
  const recents = recentIds.map((id) => getModel(id)).filter((m): m is CatalogModel => !!m && base.includes(m));

  const providerOptions = providersWithModels().map((p) => ({ key: p.key, label: p.name }));
  const featureOptions = (Object.keys(FEATURE_TAGS) as FeatureTag[]).map((k) => ({ key: k, label: FEATURE_TAGS[k] }));
  const bestForOptions = (Object.keys(BEST_FOR_TAGS) as BestForTag[]).map((k) => ({ key: k, label: BEST_FOR_TAGS[k] }));

  const toggleProvider = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.16 }}
            className="relative w-full max-w-2xl mt-4 sm:mt-10 max-h-[82dvh] flex flex-col bg-[#0C0C12] border border-[#27273A] rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Search */}
            <div className="p-3 border-b border-[#1C1C28]">
              <div className="flex items-center gap-2 bg-[#12121A] border border-[#27273A] rounded-xl px-3">
                <Search size={16} className="text-zinc-500 shrink-0" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models, providers, styles…"
                  className="flex-1 bg-transparent py-2.5 text-[13px] text-zinc-200 placeholder-zinc-600 outline-none"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="text-zinc-500 hover:text-zinc-300">
                    <X size={14} />
                  </button>
                )}
                <button onClick={onClose} className="ml-1 text-zinc-500 hover:text-zinc-300 sm:hidden">
                  <X size={16} />
                </button>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <FilterDropdown label="Provider" active={!!providerFilter} options={providerOptions} value={providerFilter} onChange={setProviderFilter} />
                <FilterDropdown label="Features" active={!!featureFilter} options={featureOptions} value={featureFilter} onChange={setFeatureFilter} />
                <FilterDropdown label="Best for" active={!!bestForFilter} options={bestForOptions} value={bestForFilter} onChange={setBestForFilter} />
                {isFiltering && (
                  <button
                    onClick={() => {
                      setQuery('');
                      setProviderFilter(null);
                      setFeatureFilter(null);
                      setBestForFilter(null);
                    }}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 px-2"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-2 pb-3">
              {isFiltering ? (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 px-3 mt-3 mb-1.5">
                    {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
                  </p>
                  {filtered.length === 0 && (
                    <p className="text-[13px] text-zinc-500 px-3 py-8 text-center">No models match your filters.</p>
                  )}
                  <div className="space-y-0.5">
                    {filtered.map((m) => (
                      <ModelRow key={m.id} model={m} selected={m.id === selectedId} onSelect={select} />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {featured.length > 0 && (
                    <>
                      <SectionLabel>
                        <span className="inline-flex items-center gap-1.5">
                          <Sparkles size={11} /> Featured
                        </span>
                      </SectionLabel>
                      <div className="space-y-0.5">
                        {featured.map((m) => (
                          <ModelRow key={m.id} model={m} selected={m.id === selectedId} onSelect={select} />
                        ))}
                      </div>
                    </>
                  )}

                  {recents.length > 0 && (
                    <>
                      <SectionLabel>
                        <span className="inline-flex items-center gap-1.5">
                          <Clock size={11} /> Recent
                        </span>
                      </SectionLabel>
                      <div className="space-y-0.5">
                        {recents.map((m) => (
                          <ModelRow key={`r-${m.id}`} model={m} selected={m.id === selectedId} onSelect={select} />
                        ))}
                      </div>
                    </>
                  )}

                  <SectionLabel>All models</SectionLabel>
                  <div className="space-y-0.5">
                    {providersWithModels().map((p) => {
                      const models = requireRefs
                        ? modelsByProvider(p.key).filter((m) => m.refs !== 'none')
                        : modelsByProvider(p.key);
                      if (models.length === 0) return null;
                      const isOpen = expanded.has(p.key);
                      return (
                        <div key={p.key}>
                          <button
                            onClick={() => toggleProvider(p.key)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#16161F] transition-colors"
                          >
                            <ProviderAvatar provider={p} />
                            <span className="text-[13px] font-medium text-zinc-200">{p.name}</span>
                            <span className="flex-1" />
                            <span className="text-[11px] text-zinc-500">{models.length} models</span>
                            <ChevronRight
                              size={15}
                              className={`text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            />
                          </button>
                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="overflow-hidden pl-3"
                              >
                                <div className="space-y-0.5 py-0.5">
                                  {models.map((m) => (
                                    <ModelRow key={m.id} model={m} selected={m.id === selectedId} onSelect={select} />
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
