import { authedFetch } from '../lib/api';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Upload, Loader, Plus, Download, Trash2, X, AtSign, Zap, Star, Check } from '@geist-ui/icons';
import PushToSchedulerButton from './PushToSchedulerButton';
import InspirationWidget from './InspirationWidget';
import ModelPicker from './ModelPicker';
import { modelName, getModel, PROVIDER_MAP } from '../lib/modelCatalog';
import { motion } from 'motion/react';
import { useFirestoreAccounts, useFirestoreAccount } from '../hooks/useFirestore';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  classifyReferences,
  buildComposePlan,
  requestArtDirection,
  requestPromptArchitect,
  critiqueComposition,
  type ClassifierResponse,
  type AssetRole,
  type LogoVariant,
  type ArtDirectionBrief,
} from '../lib/autoCompose';
import { compositeLogo, fetchAsDataUrl } from '../lib/logoComposite';

// Image models now live in the shared catalog (src/lib/modelCatalog.ts) and are
// browsed via <ModelPicker />.

const RATIOS = [
  { id: '1:1', label: '1:1', sub: 'Square' },
  { id: '4:5', label: '4:5', sub: 'IG Post' },
  { id: '5:4', label: '5:4', sub: 'Landscape' },
  { id: '3:4', label: '3:4', sub: 'Portrait' },
  { id: '4:3', label: '4:3', sub: 'Standard' },
  { id: '2:3', label: '2:3', sub: 'Pinterest' },
  { id: '3:2', label: '3:2', sub: 'Photo' },
  { id: '9:16', label: '9:16', sub: 'Story / Reel' },
  { id: '16:9', label: '16:9', sub: 'Wide / YT' },
];

const THINKING_LEVELS = [
  { id: '', label: 'Off', sub: 'Fastest' },
  { id: 'low', label: 'Low', sub: 'Quick reasoning' },
  { id: 'medium', label: 'Medium', sub: 'Balanced' },
  { id: 'high', label: 'High', sub: 'Deep reasoning' },
];

const RESOLUTIONS = [
  { id: '1K', label: '1K', sub: 'Standard' },
  { id: '2K', label: '2K', sub: 'High-res' },
  { id: '4K', label: '4K', sub: 'Ultra · max detail' },
];

const OPENAI_QUALITIES = [
  { id: 'low', label: 'Low', sub: 'Fast, cheap' },
  { id: 'medium', label: 'Medium', sub: 'Balanced' },
  { id: 'high', label: 'High', sub: 'Best detail' },
];

const MAX_REFS = 8;
const MAX_TABS = 8;

interface Reference {
  id: string;
  label: string;
  base64: string;
  mimeType: string;
  preview: string;
}

interface GeneratedAsset {
  base64: string;
  mimeType: string;
  timestamp: number;
  /** True once AI-provenance metadata has been stripped (auto or via the ★ button). */
  metaStripped?: boolean;
}

interface CachedPlan {
  fingerprint: string;
  classifier: ClassifierResponse;
  labelMap: Record<number, string>;
  builtPrompt: string;
  autoInjectedLogo: { base64: string; mimeType: string; label: string } | null;
  autoInjectedFont: { base64: string; mimeType: string; label: string } | null;
  brief: ArtDirectionBrief | null;
  spec: string | null;
  targetRatio: string;
}

type AutoStage = 'idle' | 'classifying' | 'deliberating' | 'architecting' | 'generating';

interface CaptionState {
  loading: boolean;
  captions: string[] | null;
  error?: string;
  copied?: number | null;
}

/**
 * One independent generation context. Multiple tabs let the user fire off
 * several generations at once instead of sitting around waiting on a single
 * request — each tab keeps its own prompt, refs, settings, and in-flight state.
 */
interface ComposerTab {
  id: string;
  name: string;
  createdAt: number;
  references: Reference[];
  prompt: string;
  model: string;
  ratio: string;
  thinkingLevel: string;
  resolution: string;
  quality: string;
  count: number;
  applyBrandContext: boolean;
  composeDepth: 'quick' | 'deep';
  composeGuidance: string;
  qaReview: boolean;
  jsonSpec: boolean;
  /** Auto-strip AI "Made with AI" metadata (C2PA/EXIF/XMP) from every generation. */
  stripMetadata: boolean;
  customW: string;
  customH: string;
  generating: boolean;
  autoStage: AutoStage;
  progress: { done: number; total: number };
  quickAdjust: string;
  quickRetrying: boolean;
  assets: GeneratedAsset[];
  error: string | null;
  lastPlan:
    | { classifier: ClassifierResponse; labelMap: Record<number, string>; builtPrompt: string; brief?: ArtDirectionBrief | null }
    | null;
  cachedPlan: CachedPlan | null;
  captionsByAsset: Record<number, CaptionState>;
}

const nextTabId = () => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createDefaultTab = (overrides: Partial<ComposerTab> = {}): ComposerTab => ({
  id: nextTabId(),
  name: 'Prompt',
  createdAt: Date.now(),
  references: [],
  prompt: '',
  model: 'gemini-3-pro-image-preview',
  ratio: '4:5',
  thinkingLevel: '',
  resolution: '2K',
  quality: 'high',
  count: 1,
  applyBrandContext: false,
  composeDepth: 'quick',
  composeGuidance: '',
  qaReview: true,
  jsonSpec: false,
  stripMetadata: true,
  customW: '',
  customH: '',
  generating: false,
  autoStage: 'idle',
  progress: { done: 0, total: 0 },
  quickAdjust: '',
  quickRetrying: false,
  assets: [],
  error: null,
  lastPlan: null,
  cachedPlan: null,
  captionsByAsset: {},
  ...overrides,
});

const inheritSettings = (from: ComposerTab): Partial<ComposerTab> => ({
  model: from.model,
  ratio: from.ratio,
  thinkingLevel: from.thinkingLevel,
  resolution: from.resolution,
  quality: from.quality,
  count: from.count,
  applyBrandContext: from.applyBrandContext,
  composeDepth: from.composeDepth,
  qaReview: from.qaReview,
  jsonSpec: from.jsonSpec,
  stripMetadata: from.stripMetadata,
  customW: from.customW,
  customH: from.customH,
});

const tabDisplayName = (tab: ComposerTab, idx: number): string => {
  const trimmed = tab.prompt.trim();
  if (trimmed) {
    const oneLine = trimmed.replace(/\s+/g, ' ');
    return oneLine.length > 22 ? `${oneLine.slice(0, 22)}…` : oneLine;
  }
  return `Prompt ${idx + 1}`;
};

const isTabBusy = (t: ComposerTab) => t.generating || t.autoStage !== 'idle' || t.quickRetrying;

export default function Composer() {
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();
  const [selectedAccountId, setSelectedAccountId] = usePersistedState<string | null>(
    'composer.accountId',
    null,
  );
  const { account: fullAccount } = useFirestoreAccount(selectedAccountId);
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;

  const initialTabs = useMemo(() => [createDefaultTab()], []);
  const [tabs, setTabs] = usePersistedState<ComposerTab[]>('composer.tabs.v1', initialTabs);
  const [activeTabId, setActiveTabId] = usePersistedState<string>(
    'composer.activeTabId.v1',
    initialTabs[0].id,
  );

  // On first mount, drop any in-flight flags that came back from sessionStorage —
  // the actual fetches died with the previous page load.
  useEffect(() => {
    setTabs((prev) => {
      const needsReset = prev.some(
        (t) => t.generating || t.autoStage !== 'idle' || t.quickRetrying,
      );
      if (!needsReset) return prev;
      return prev.map((t) => ({
        ...t,
        generating: false,
        autoStage: 'idle' as const,
        progress: { done: 0, total: 0 },
        quickRetrying: false,
      }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep tabs non-empty and activeTabId pointing at a real tab.
  useEffect(() => {
    if (tabs.length === 0) {
      const fresh = createDefaultTab();
      setTabs([fresh]);
      setActiveTabId(fresh.id);
    } else if (!tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, activeTabId, setTabs, setActiveTabId]);

  const activeTab: ComposerTab = tabs.find((t) => t.id === activeTabId) || tabs[0] || initialTabs[0];

  const updateTab = useCallback(
    (id: string, fn: (t: ComposerTab) => ComposerTab) => {
      setTabs((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
    },
    [setTabs],
  );

  const setActiveField = useCallback(
    <K extends keyof ComposerTab>(
      key: K,
      value: ComposerTab[K] | ((prev: ComposerTab[K]) => ComposerTab[K]),
    ) => {
      updateTab(activeTab.id, (t) => ({
        ...t,
        [key]:
          typeof value === 'function'
            ? (value as (prev: ComposerTab[K]) => ComposerTab[K])(t[key])
            : value,
      }));
    },
    [updateTab, activeTab.id],
  );

  const [dragOver, setDragOver] = useState(false);
  const [addingBrandRef, setAddingBrandRef] = useState<string | null>(null);
  // Asset timestamps currently being cleaned by the watermark remover.
  const [cleaningAssets, setCleaningAssets] = useState<Record<number, boolean>>({});
  // Model picker (Freepik-style catalog browser) + recently-used models.
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [recentModels, setRecentModels] = usePersistedState<string[]>('composer.recentModels.v1', []);
  const selectModel = useCallback(
    (id: string) => {
      setActiveField('model', id);
      setRecentModels((prev) => [id, ...prev.filter((x) => x !== id)].slice(0, 6));
    },
    [setActiveField, setRecentModels],
  );
  // Asset timestamps the auto metadata-strip has already attempted this session
  // (success or failure), so the effect never reprocesses the same asset.
  const autoStripRef = useRef<Set<number>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const isPresetRatio = RATIOS.some((r) => r.id === activeTab.ratio);
  const customRatioValid = (() => {
    const w = Number(activeTab.customW);
    const h = Number(activeTab.customH);
    if (!w || !h || w <= 0 || h <= 0) return false;
    const r = w / h;
    return r >= 1 / 3 - 1e-6 && r <= 3 + 1e-6;
  })();
  const applyCustomRatio = () => {
    if (!customRatioValid) return;
    setActiveField('ratio', `${Number(activeTab.customW)}:${Number(activeTab.customH)}`);
  };

  // If the user switches off OpenAI to a Gemini model, drop any custom ratio.
  useEffect(() => {
    if (activeTab.model !== 'gpt-image-2' && !RATIOS.some((r) => r.id === activeTab.ratio)) {
      updateTab(activeTab.id, (t) => ({ ...t, ratio: '1:1' }));
    }
  }, [activeTab.model, activeTab.ratio, activeTab.id, updateTab]);

  /** Tab management ------------------------------------------------------ */
  const openNewTab = () => {
    if (tabs.length >= MAX_TABS) return;
    const fresh = createDefaultTab(inheritSettings(activeTab));
    setTabs((prev) => [...prev, fresh]);
    setActiveTabId(fresh.id);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((t) => t.id !== id);
      // If we closed the active tab, jump to the neighbor.
      if (id === activeTabId) {
        const closedIdx = prev.findIndex((t) => t.id === id);
        const fallback = next[closedIdx] || next[closedIdx - 1] || next[0];
        if (fallback) setActiveTabId(fallback.id);
      }
      return next;
    });
  };

  /** Reference upload / paste -------------------------------------------- */
  const processFiles = useCallback(
    (files: FileList | File[], targetTabId: string = activeTab.id) => {
      const arr = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (!arr.length) return;

      // Read each file first, then compute labels inside the state updater
      // off the LATEST refs — otherwise concurrent uploads (or rapid sequential
      // ones whose FileReaders interleave) all snapshot an empty `existing`
      // and collide on @img1.
      const loaded: { base64: string; mimeType: string; preview: string }[] = [];
      let pending = arr.length;
      arr.forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          loaded.push({ base64, mimeType: file.type, preview: dataUrl });
          pending--;
          if (pending === 0) {
            updateTab(targetTabId, (t) => {
              const remaining = MAX_REFS - t.references.length;
              if (remaining <= 0) {
                return { ...t, error: `Max ${MAX_REFS} reference images.` };
              }
              const existingImgNums = t.references
                .map((r) => /^img(\d+)$/.exec(r.label))
                .filter((m): m is RegExpExecArray => !!m)
                .map((m) => parseInt(m[1], 10));
              const startNum =
                existingImgNums.length === 0 ? 1 : Math.max(...existingImgNums) + 1;
              const newRefs: Reference[] = loaded.slice(0, remaining).map((l, idx) => ({
                id: `${Date.now()}-${Math.random()}-${idx}`,
                label: `img${startNum + idx}`,
                base64: l.base64,
                mimeType: l.mimeType,
                preview: l.preview,
              }));
              return {
                ...t,
                references: [...t.references, ...newRefs],
                error: null,
              };
            });
          }
        };
        reader.readAsDataURL(file);
      });
    },
    [activeTab.id, updateTab],
  );

  const removeReference = (refId: string) => {
    setActiveField('references', (cur) => cur.filter((r) => r.id !== refId));
  };

  const insertAtCursor = (text: string) => {
    const el = promptRef.current;
    const currentPrompt = activeTab.prompt;
    if (!el) {
      setActiveField('prompt', currentPrompt ? `${currentPrompt} ${text}` : text);
      return;
    }
    const start = el.selectionStart ?? currentPrompt.length;
    const end = el.selectionEnd ?? currentPrompt.length;
    const before = currentPrompt.slice(0, start);
    const after = currentPrompt.slice(end);
    const needsSpaceBefore = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
    const needsSpaceAfter = after.length > 0 && !after.startsWith(' ') && !after.startsWith('\n');
    const insert = `${needsSpaceBefore ? ' ' : ''}${text}${needsSpaceAfter ? ' ' : ''}`;
    const next = before + insert + after;
    setActiveField('prompt', next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = (before + insert).length;
      el.setSelectionRange(pos, pos);
    });
  };

  const insertMention = (label: string) => insertAtCursor(`@${label}`);

  const addBrandLogoAsReference = async (url: string, label: string) => {
    if (activeTab.references.some((r) => r.label === label)) {
      insertMention(label);
      return;
    }
    if (activeTab.references.length >= MAX_REFS) {
      setActiveField('error', `Max ${MAX_REFS} reference images.`);
      return;
    }
    setAddingBrandRef(label);
    const targetTabId = activeTab.id;
    try {
      let base64: string;
      let mimeType: string;
      if (url.startsWith('data:')) {
        const [header, b64] = url.split(',');
        base64 = b64;
        mimeType = header.split(';')[0].split(':')[1] || 'image/png';
      } else {
        const res = await authedFetch(`/api/content/image-proxy?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error('Failed to load logo');
        const blob = await res.blob();
        mimeType = blob.type || 'image/png';
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('read failed'));
          reader.readAsDataURL(blob);
        });
        base64 = dataUrl.split(',')[1];
      }
      const preview = `data:${mimeType};base64,${base64}`;
      updateTab(targetTabId, (t) => ({
        ...t,
        references: [
          ...t.references,
          { id: `${Date.now()}-${Math.random()}`, label, base64, mimeType, preview },
        ],
        error: null,
      }));
    } catch (e: any) {
      updateTab(targetTabId, (t) => ({ ...t, error: e.message || 'Could not load logo' }));
    } finally {
      setAddingBrandRef(null);
    }
  };

  /** Add an inspiration image (Pinterest / Google review) as a composer reference. */
  const addInspirationReference = (url: string) => {
    const used = new Set(activeTab.references.map((r) => r.label));
    let n = 1;
    while (used.has(`img${n}`)) n++;
    return addBrandLogoAsReference(url, `img${n}`);
  };

  /** Drop an inspiration idea into the active prompt (append, never clobber). */
  const useInspirationIdea = (text: string) => {
    if (!text?.trim()) return;
    setActiveField('prompt', (prev) =>
      prev?.trim() ? `${prev.trim()}\n${text.trim()}` : text.trim(),
    );
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files);
    },
    [processFiles],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (document.activeElement === promptRef.current) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        processFiles(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [processFiles]);

  /** Auto Compose plan caching ------------------------------------------- */
  const buildAutoFingerprint = (tab: ComposerTab): string => {
    const refsKey = tab.references
      .map((r) => `${r.mimeType}:${r.base64.length}:${r.base64.slice(0, 24)}:${r.base64.slice(-24)}`)
      .join('||');
    const brandKey = selectedAccount
      ? [
          selectedAccount.id,
          selectedAccount.company || '',
          selectedAccount.industry || '',
          selectedAccount.brandVoice || '',
          selectedAccount.targetAudience || '',
          (selectedAccount.brandColors || []).join(','),
          selectedAccount.primaryLogo ? '1' : '0',
          selectedAccount.lightLogo ? '1' : '0',
          selectedAccount.darkLogo ? '1' : '0',
          selectedAccount.simplisticLogo ? '1' : '0',
          selectedAccount.brandFont || '',
          selectedAccount.brandFontImage ? '1' : '0',
        ].join('|')
      : 'none';
    const menuKey = (fullAccount?.menuItems ?? [])
      .map((m) => m.name)
      .sort()
      .join('|');
    return `v6::${tab.composeDepth || 'quick'}::${(tab.composeGuidance || '').trim()}::${refsKey}::${brandKey}::${menuKey}`;
  };

  const isCacheHot =
    !!activeTab.cachedPlan &&
    activeTab.cachedPlan.fingerprint === buildAutoFingerprint(activeTab) &&
    activeTab.references.length > 0;

  const fetchLogoAsRef = async (url: string, label: string) => {
    if (url.startsWith('data:')) {
      const [header, b64] = url.split(',');
      return { base64: b64, mimeType: header.split(';')[0].split(':')[1] || 'image/png', label };
    }
    const res = await authedFetch(`/api/content/image-proxy?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error('Failed to load logo');
    const blob = await res.blob();
    const mimeType = blob.type || 'image/png';
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(blob);
    });
    return { base64: dataUrl.split(',')[1], mimeType, label };
  };

  /** ---------------------------------------------------------------------
   *  Auto Compose — runs async; captures the tab ID so that switching tabs
   *  during the run still writes results to the correct tab.
   * --------------------------------------------------------------------- */
  const autoCompose = async () => {
    const tab = activeTab;
    const tabId = tab.id;
    if (tab.references.length < 1 || tab.autoStage !== 'idle' || tab.generating) return;
    if (!selectedAccount) {
      updateTab(tabId, (t) => ({
        ...t,
        error: 'Select a brand first so Auto Compose can plan on-brand.',
      }));
      return;
    }
    updateTab(tabId, (t) => ({ ...t, error: null }));

    // Reference-only logo handling: the prompt references @logo and the model
    // draws it; the QA critic verifies it matches your file and retries on drift.
    const logoLockActive: boolean = false;
    const brandForCritic = {
      company: selectedAccount.company,
      industry: selectedAccount.industry || undefined,
      brandVoice: selectedAccount.brandVoice || undefined,
      targetAudience: selectedAccount.targetAudience || undefined,
      brandColors: selectedAccount.brandColors || undefined,
    };

    try {
      const fingerprint = buildAutoFingerprint(tab);
      const cacheHit = !!tab.cachedPlan && tab.cachedPlan.fingerprint === fingerprint;

      let classifier: ClassifierResponse;
      let labelMap: Record<number, string>;
      let builtPrompt: string;
      let autoInjectedLogo: { base64: string; mimeType: string; label: string } | null;
      let autoInjectedFont: { base64: string; mimeType: string; label: string } | null;
      let brief: ArtDirectionBrief | null;
      let architectSpec: string | null;
      let targetRatio: string;

      if (cacheHit && tab.cachedPlan) {
        classifier = tab.cachedPlan.classifier;
        labelMap = tab.cachedPlan.labelMap;
        builtPrompt = tab.cachedPlan.builtPrompt;
        autoInjectedLogo = tab.cachedPlan.autoInjectedLogo;
        autoInjectedFont = tab.cachedPlan.autoInjectedFont;
        brief = tab.cachedPlan.brief;
        architectSpec = tab.cachedPlan.spec;
        targetRatio = tab.cachedPlan.targetRatio;
        updateTab(tabId, (t) => ({ ...t, lastPlan: { classifier, labelMap, builtPrompt, brief } }));
      } else {
        updateTab(tabId, (t) => ({ ...t, autoStage: 'classifying' }));
        const brand = {
          company: selectedAccount.company,
          industry: selectedAccount.industry || undefined,
          brandVoice: selectedAccount.brandVoice || undefined,
          targetAudience: selectedAccount.targetAudience || undefined,
          brandColors: selectedAccount.brandColors || undefined,
          brandFont: selectedAccount.brandFont || undefined,
          hasPrimaryLogo: !!selectedAccount.primaryLogo,
          hasLightLogo: !!selectedAccount.lightLogo,
          hasDarkLogo: !!selectedAccount.darkLogo,
          hasSimplisticLogo: !!selectedAccount.simplisticLogo,
        };
        const menuItems = (fullAccount?.menuItems ?? []).map((m) => ({
          name: m.name,
          category: m.category || undefined,
          description: m.description || undefined,
        }));

        classifier = await classifyReferences(
          tab.references.map((r) => ({ base64: r.base64, mimeType: r.mimeType })),
          brand,
          menuItems,
          (tab.composeGuidance || '').trim() || undefined,
          tab.references.map((r) => r.label),
        );
        if (!classifier.assets.length) throw new Error('Classification returned no results.');

        autoInjectedLogo = null;
        autoInjectedFont = null;
        const userDroppedLogo = classifier.assets.some((a) => a.role === 'logo');
        const variant = classifier.recommended_logo_variant;
        const variantUrl =
          variant === 'light'
            ? selectedAccount.lightLogo
            : variant === 'dark'
              ? selectedAccount.darkLogo
              : variant === 'primary'
                ? selectedAccount.primaryLogo
                : variant === 'simplistic'
                  ? selectedAccount.simplisticLogo
                  : selectedAccount.lightLogo ||
                    selectedAccount.darkLogo ||
                    selectedAccount.primaryLogo ||
                    selectedAccount.simplisticLogo;
        if (!logoLockActive && !userDroppedLogo && variantUrl && tab.references.length < MAX_REFS) {
          try {
            autoInjectedLogo = await fetchLogoAsRef(variantUrl, 'logo');
          } catch (e) {
            console.warn('Auto Compose: could not auto-inject logo', e);
            updateTab(tabId, (t) => ({
              ...t,
              error: `Could not load brand logo for auto-injection — generating without it. (${(e as Error).message})`,
            }));
          }
        }

        // Auto-inject the brand's font-style reference image (a photo of the
        // lettering to replicate) so the model can match the typography.
        const userDroppedFont = tab.references.some((r) => r.label === 'fontstyle');
        const usedSlots = tab.references.length + (autoInjectedLogo ? 1 : 0);
        if (!userDroppedFont && selectedAccount.brandFontImage && usedSlots < MAX_REFS) {
          try {
            autoInjectedFont = await fetchLogoAsRef(selectedAccount.brandFontImage, 'fontstyle');
          } catch (e) {
            console.warn('Auto Compose: could not auto-inject font style image', e);
          }
        }

        // ── Deep Compose: convene the art-direction roundtable ────
        brief = null;
        if ((tab.composeDepth || 'quick') === 'deep') {
          updateTab(tabId, (t) => ({ ...t, autoStage: 'deliberating' }));
          try {
            brief = await requestArtDirection({
              references: tab.references.map((r) => ({ base64: r.base64, mimeType: r.mimeType })),
              brand,
              classifier,
              menuItems,
              guidance: (tab.composeGuidance || '').trim() || undefined,
            });
          } catch (e) {
            console.warn('Deep Compose: roundtable failed, composing without it', e);
            updateTab(tabId, (t) => ({
              ...t,
              error: `The art-direction panel hit a snag — composing without it. (${(e as Error).message})`,
            }));
            brief = null;
          }
        }

        const plan = buildComposePlan(classifier, brand, {
          autoInjectedLogoLabel: autoInjectedLogo?.label ?? null,
          autoInjectedFontLabel: autoInjectedFont?.label ?? null,
          brief,
          guidance: (tab.composeGuidance || '').trim() || null,
          logoLock: logoLockActive,
          logoCorner: 'bottom-right',
        });
        builtPrompt = plan.builtPrompt;
        labelMap = {};
        plan.relabeledRefs.forEach((r) => {
          labelMap[r.originalIndex] = r.newLabel;
        });

        const recommendedRatio = classifier.recommended_aspect_ratio;
        targetRatio = RATIOS.some((r) => r.id === recommendedRatio) ? recommendedRatio : tab.ratio;

        // ── PROMPT ARCHITECT: distill the brief into the proven imperative prompt ──
        architectSpec = null;
        updateTab(tabId, (t) => ({ ...t, autoStage: 'architecting' }));
        try {
          const architectAssets = plan.relabeledRefs.map((r) => ({
            label: r.newLabel,
            role: r.role,
            description: classifier.assets.find((a) => a.index === r.originalIndex)?.description || '',
          }));
          const fontLabel =
            autoInjectedFont?.label ||
            (tab.references.some((r) => r.label === 'fontstyle') ? 'fontstyle' : '');
          const architect = await requestPromptArchitect({
            draft: plan.builtPrompt,
            assets: architectAssets,
            fontLabel,
            ratio: targetRatio,
            logoLock: logoLockActive,
            logoCorner: 'bottom-right',
          });
          const must: string[] = [];
          if (logoLockActive) must.push('Render NO logo; leave the bottom-right corner clean for it.');
          must.push('No call-to-action button, badge, or "Order Now"-style text.');
          if (selectedAccount.company)
            must.push(`Never print "${selectedAccount.company}" or its tagline anywhere — the logo carries it.`);
          if (selectedAccount.brandColors?.length)
            must.push(`Use only the brand palette for type and accents: ${selectedAccount.brandColors.join(', ')}.`);
          builtPrompt = `${architect.prompt}\n\nMUST:\n- ${must.join('\n- ')}`;
          architectSpec = architect.spec ? JSON.stringify(architect.spec) : null;
        } catch (e) {
          console.warn('Prompt Architect failed — using the deterministic prompt', e);
          // builtPrompt remains the deterministic plan.builtPrompt (fallback).
        }

        const finalAutoInjected = autoInjectedLogo;
        const finalAutoInjectedFont = autoInjectedFont;
        const finalBrief = brief;
        updateTab(tabId, (t) => ({
          ...t,
          ratio: targetRatio,
          lastPlan: { classifier, labelMap, builtPrompt, brief: finalBrief },
          cachedPlan: {
            fingerprint,
            classifier,
            labelMap,
            builtPrompt,
            autoInjectedLogo: finalAutoInjected,
            autoInjectedFont: finalAutoInjectedFont,
            brief: finalBrief,
            spec: architectSpec,
            targetRatio,
          },
        }));
      }

      const logoIndices = new Set(
        classifier.assets.filter((a) => a.role === 'logo').map((a) => a.index),
      );
      const relabeledForRequest = tab.references
        .map((r, i) => ({ base64: r.base64, mimeType: r.mimeType, label: labelMap[i] || r.label, _i: i }))
        .filter((r) => !(logoLockActive && logoIndices.has(r._i)))
        .map(({ _i, ...r }) => r);
      if (!logoLockActive && autoInjectedLogo && relabeledForRequest.length < MAX_REFS) {
        relabeledForRequest.push(autoInjectedLogo);
      }
      if (autoInjectedFont && relabeledForRequest.length < MAX_REFS) {
        relabeledForRequest.push(autoInjectedFont);
      }

      // Assets the QA critic compares the output against — logo, subject, font.
      const critiqueRefs = tab.references
        .map((r, i) => ({ r, a: classifier.assets.find((x) => x.index === i) }))
        .filter(({ a }) => a && (a.role === 'dish' || a.role === 'product' || a.role === 'logo' || a.role === 'fontstyle'))
        .slice(0, 4)
        .map(({ r, a }) => ({ base64: r.base64, mimeType: r.mimeType, role: a!.role as string }));

      // Prefetch the brand's logo variants (transparent PNGs) for compositing.
      let logoAssets: { light: string | null; dark: string | null } = { light: null, dark: null };
      if (logoLockActive) {
        const lightSrc = selectedAccount.lightLogo;
        const darkSrc =
          selectedAccount.darkLogo || selectedAccount.primaryLogo || selectedAccount.simplisticLogo;
        const [lightData, darkData] = await Promise.all([
          lightSrc ? fetchAsDataUrl(lightSrc).catch(() => null) : Promise.resolve(null),
          darkSrc ? fetchAsDataUrl(darkSrc).catch(() => null) : Promise.resolve(null),
        ]);
        logoAssets = { light: lightData, dark: darkData };
      }

      const n = Math.min(Math.max(tab.count, 1), 4);
      updateTab(tabId, (t) => ({
        ...t,
        autoStage: 'generating',
        progress: { done: 0, total: n },
      }));

      const specSuffix =
        (tab.jsonSpec ?? false) && architectSpec
          ? `\n\nSPEC (structured guide for the prompt above — honor it):\n${architectSpec}`
          : '';
      const body = {
        model: tab.model,
        prompt: builtPrompt + specSuffix,
        aspectRatio: targetRatio,
        thinkingLevel: tab.model === 'gemini-3.1-flash-image-preview' ? tab.thinkingLevel : '',
        resolution: tab.resolution,
        ...(tab.model === 'gpt-image-2' ? { quality: tab.quality } : {}),
        references: relabeledForRequest,
      };

      const genOnce = async (
        extra?: string,
      ): Promise<{ base64: string; mimeType: string } | null> => {
        const res = await authedFetch('/api/content/generate-composite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            extra
              ? { ...body, prompt: `${body.prompt}\n\nREVISION — fix these issues without changing anything else: ${extra}` }
              : body,
          ),
        });
        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(text || 'Generation failed');
        }
        if (!res.ok) throw new Error(data.error || 'Generation failed');
        const img = (data.images ?? [])[0];
        return img ? { base64: img.base64, mimeType: img.mimeType } : null;
      };

      // Logo Lock: paste the real brand logo into the reserved corner.
      const finishImage = async (img: { base64: string; mimeType: string }) => {
        if (logoLockActive && (logoAssets.light || logoAssets.dark)) {
          try {
            return await compositeLogo({
              baseBase64: img.base64,
              baseMime: img.mimeType,
              lightLogo: logoAssets.light,
              darkLogo: logoAssets.dark,
              corner: 'bottom-right',
            });
          } catch (e) {
            console.warn('Logo Lock: composite failed, using raw image', e);
          }
        }
        return img;
      };

      const produceOne = async () => {
        try {
          let img = await genOnce();
          if (!img) return { ok: false as const, error: 'No image returned' };
          img = await finishImage(img);
          // QA Critic: review against the source assets; one corrective retry.
          if ((tab.qaReview ?? true) && critiqueRefs.length) {
            try {
              const verdict = await critiqueComposition({
                image: img,
                references: critiqueRefs,
                brand: brandForCritic,
                planSummary: builtPrompt,
                guidance: (tab.composeGuidance || '').trim() || undefined,
              });
              if (!verdict.pass && verdict.corrective) {
                const retry = await genOnce(verdict.corrective);
                if (retry) img = await finishImage(retry);
              }
            } catch (e) {
              console.warn('QA critic failed (skipping)', e);
            }
          }
          return { ok: true as const, images: [img] };
        } catch (e: any) {
          return { ok: false as const, error: e.message || 'Network error' };
        } finally {
          updateTab(tabId, (t) => ({
            ...t,
            progress: { ...t.progress, done: t.progress.done + 1 },
          }));
        }
      };

      const results = await Promise.all(Array.from({ length: n }, () => produceOne()));
      const ts = Date.now();
      const newAssets: GeneratedAsset[] = [];
      const errors: string[] = [];
      results.forEach((r, i) => {
        if (r.ok) {
          r.images.forEach((img, j) => {
            newAssets.push({
              base64: img.base64,
              mimeType: img.mimeType,
              timestamp: ts + i * 1000 + j,
            });
          });
        } else {
          errors.push(r.error);
        }
      });
      updateTab(tabId, (t) => {
        const errMsg =
          errors.length === 0
            ? t.error
            : newAssets.length
              ? `${errors.length} of ${n} failed: ${errors[0]}`
              : errors[0];
        return {
          ...t,
          assets: newAssets.length ? [...newAssets, ...t.assets] : t.assets,
          error: errMsg,
        };
      });
    } catch (e: any) {
      updateTab(tabId, (t) => ({ ...t, error: e?.message || 'Auto Compose failed.' }));
    } finally {
      updateTab(tabId, (t) => ({ ...t, autoStage: 'idle', progress: { done: 0, total: 0 } }));
    }
  };

  const quickRegenerate = async () => {
    const tab = activeTab;
    const tabId = tab.id;
    if (!tab.cachedPlan) return;
    if (!tab.quickAdjust.trim() || tab.quickRetrying || tab.generating || tab.autoStage !== 'idle')
      return;
    if (tab.references.length < 1) return;

    updateTab(tabId, (t) => ({ ...t, quickRetrying: true, error: null }));

    const qrSpecSuffix =
      (tab.jsonSpec ?? false) && tab.cachedPlan.spec
        ? `\n\nSPEC (structured guide — honor it):\n${tab.cachedPlan.spec}`
        : '';
    const adjustedPrompt = `${tab.cachedPlan.builtPrompt}${qrSpecSuffix}

USER ADJUSTMENT (this overrides anything above that conflicts — apply this exactly):
${tab.quickAdjust.trim()}`;

    const qrLogoLockActive: boolean = false;
    const qrLogoIndices = new Set(
      tab.cachedPlan.classifier.assets.filter((a) => a.role === 'logo').map((a) => a.index),
    );
    const relabeledForRequest = tab.references
      .map((r, i) => ({ base64: r.base64, mimeType: r.mimeType, label: tab.cachedPlan!.labelMap[i] || r.label, _i: i }))
      .filter((r) => !(qrLogoLockActive && qrLogoIndices.has(r._i)))
      .map(({ _i, ...r }) => r);
    if (!qrLogoLockActive && tab.cachedPlan.autoInjectedLogo && relabeledForRequest.length < MAX_REFS) {
      relabeledForRequest.push(tab.cachedPlan.autoInjectedLogo);
    }
    if (tab.cachedPlan.autoInjectedFont && relabeledForRequest.length < MAX_REFS) {
      relabeledForRequest.push(tab.cachedPlan.autoInjectedFont);
    }

    let qrLogoAssets: { light: string | null; dark: string | null } = { light: null, dark: null };
    if (qrLogoLockActive && selectedAccount) {
      const lightSrc = selectedAccount.lightLogo;
      const darkSrc =
        selectedAccount.darkLogo || selectedAccount.primaryLogo || selectedAccount.simplisticLogo;
      const [lightData, darkData] = await Promise.all([
        lightSrc ? fetchAsDataUrl(lightSrc).catch(() => null) : Promise.resolve(null),
        darkSrc ? fetchAsDataUrl(darkSrc).catch(() => null) : Promise.resolve(null),
      ]);
      qrLogoAssets = { light: lightData, dark: darkData };
    }

    const n = Math.min(Math.max(tab.count, 1), 4);
    updateTab(tabId, (t) => ({ ...t, progress: { done: 0, total: n } }));

    const body = {
      model: tab.model,
      prompt: adjustedPrompt,
      aspectRatio: tab.cachedPlan.targetRatio,
      thinkingLevel: tab.model === 'gemini-3.1-flash-image-preview' ? tab.thinkingLevel : '',
      resolution: tab.resolution,
      ...(tab.model === 'gpt-image-2' ? { quality: tab.quality } : {}),
      references: relabeledForRequest,
    };

    const requestOne = async () => {
      try {
        const res = await authedFetch('/api/content/generate-composite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          return { ok: false as const, error: text || 'Generation failed' };
        }
        if (!res.ok) return { ok: false as const, error: data.error || 'Generation failed' };
        let images = (data.images ?? []) as { base64: string; mimeType: string }[];
        if (qrLogoLockActive && (qrLogoAssets.light || qrLogoAssets.dark)) {
          images = await Promise.all(
            images.map(async (im) => {
              try {
                return await compositeLogo({
                  baseBase64: im.base64,
                  baseMime: im.mimeType,
                  lightLogo: qrLogoAssets.light,
                  darkLogo: qrLogoAssets.dark,
                  corner: 'bottom-right',
                });
              } catch {
                return im;
              }
            }),
          );
        }
        return { ok: true as const, images };
      } catch (e: any) {
        return { ok: false as const, error: e.message || 'Network error' };
      } finally {
        updateTab(tabId, (t) => ({
          ...t,
          progress: { ...t.progress, done: t.progress.done + 1 },
        }));
      }
    };

    try {
      const results = await Promise.all(Array.from({ length: n }, () => requestOne()));
      const ts = Date.now();
      const newAssets: GeneratedAsset[] = [];
      const errors: string[] = [];
      results.forEach((r, i) => {
        if (r.ok) {
          r.images.forEach((img, j) => {
            newAssets.push({
              base64: img.base64,
              mimeType: img.mimeType,
              timestamp: ts + i * 1000 + j,
            });
          });
        } else {
          errors.push(r.error);
        }
      });
      updateTab(tabId, (t) => {
        const errMsg =
          errors.length === 0
            ? t.error
            : newAssets.length
              ? `${errors.length} of ${n} failed: ${errors[0]}`
              : errors[0];
        return {
          ...t,
          assets: newAssets.length ? [...newAssets, ...t.assets] : t.assets,
          error: errMsg,
        };
      });
    } finally {
      updateTab(tabId, (t) => ({
        ...t,
        quickRetrying: false,
        progress: { done: 0, total: 0 },
      }));
    }
  };

  /** Build a topic hint for captioning / scheduler handoffs. */
  const buildAssetTopicHint = useCallback(
    (tab: ComposerTab) => {
      const topicParts: string[] = [];
      if (tab.lastPlan) {
        const c = tab.lastPlan.classifier;
        const subjectIdx =
          c.subject_grouping.subject_indices[0] ??
          c.assets.find((a) => a.role === 'dish' || a.role === 'product')?.index;
        const subject = subjectIdx != null ? c.assets.find((a) => a.index === subjectIdx) : null;
        if (subject?.menu_match) topicParts.push(`Featured menu item: ${subject.menu_match}`);
        else if (subject?.description) topicParts.push(`Featured subject: ${subject.description}`);
        if (c.suggested_title) topicParts.push(`Headline on the graphic: "${c.suggested_title}"`);
        if (c.suggested_cta) topicParts.push(`CTA on the graphic: "${c.suggested_cta}"`);
        if (c.inspiration_format && c.inspiration_format !== 'standard_promo') {
          topicParts.push(
            `Post format: ${c.inspiration_format.replace(/_/g, ' ')}${c.engagement_mechanic ? ` (${c.engagement_mechanic})` : ''}`,
          );
        }
      }
      if (topicParts.length === 0 && tab.prompt.trim()) topicParts.push(tab.prompt.trim());
      return topicParts.join('. ') || 'New social post for the brand.';
    },
    [],
  );

  const generateCaptionForAsset = async (asset: GeneratedAsset) => {
    const tabId = activeTab.id;
    if (!selectedAccount) {
      updateTab(tabId, (t) => ({
        ...t,
        captionsByAsset: {
          ...t.captionsByAsset,
          [asset.timestamp]: { loading: false, captions: null, error: 'Select a brand first.' },
        },
      }));
      return;
    }
    updateTab(tabId, (t) => ({
      ...t,
      captionsByAsset: {
        ...t.captionsByAsset,
        [asset.timestamp]: {
          loading: true,
          captions: t.captionsByAsset[asset.timestamp]?.captions ?? null,
          copied: null,
        },
      },
    }));

    const topic = buildAssetTopicHint(activeTab);

    try {
      const res = await authedFetch('/api/content/generate-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandContext: {
            company: selectedAccount.company,
            industry: selectedAccount.industry,
            description: selectedAccount.description,
            brandVoice: selectedAccount.brandVoice,
            targetAudience: selectedAccount.targetAudience,
            socialHandles: selectedAccount.socialHandles,
          },
          media: [{ base64: asset.base64, mimeType: asset.mimeType }],
          platform: 'instagram',
          captionStyle: 'short-sweet',
          topic,
          includeHashtags: false,
          includeEmojis: false,
        }),
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text || 'Caption failed');
      }
      if (!res.ok) throw new Error(data.error || 'Caption failed');
      const captions: string[] = Array.isArray(data.captions) ? data.captions.slice(0, 3) : [];
      updateTab(tabId, (t) => ({
        ...t,
        captionsByAsset: {
          ...t.captionsByAsset,
          [asset.timestamp]: { loading: false, captions, copied: null },
        },
      }));
    } catch (e: any) {
      updateTab(tabId, (t) => ({
        ...t,
        captionsByAsset: {
          ...t.captionsByAsset,
          [asset.timestamp]: { loading: false, captions: null, error: e.message || 'Caption failed' },
        },
      }));
    }
  };

  const copyCaption = async (assetTimestamp: number, idx: number, text: string) => {
    const tabId = activeTab.id;
    try {
      await navigator.clipboard.writeText(text);
      updateTab(tabId, (t) => ({
        ...t,
        captionsByAsset: {
          ...t.captionsByAsset,
          [assetTimestamp]: {
            ...(t.captionsByAsset[assetTimestamp] || { loading: false, captions: null }),
            copied: idx,
          },
        },
      }));
      setTimeout(() => {
        updateTab(tabId, (t) => {
          const cur = t.captionsByAsset[assetTimestamp];
          if (!cur || cur.copied !== idx) return t;
          return {
            ...t,
            captionsByAsset: { ...t.captionsByAsset, [assetTimestamp]: { ...cur, copied: null } },
          };
        });
      }, 1500);
    } catch {
      /* ignore */
    }
  };

  /** Manual generate ----------------------------------------------------- */
  const generate = async () => {
    const tab = activeTab;
    const tabId = tab.id;
    if (!tab.prompt.trim() || tab.generating) return;
    const n = Math.min(Math.max(tab.count, 1), 4);
    updateTab(tabId, (t) => ({
      ...t,
      generating: true,
      error: null,
      progress: { done: 0, total: n },
    }));

    let finalPrompt = tab.prompt.trim();
    if (tab.applyBrandContext && selectedAccount) {
      const ctx: string[] = [];
      if (selectedAccount.company) ctx.push(`Brand: ${selectedAccount.company}`);
      if (selectedAccount.industry) ctx.push(`Industry: ${selectedAccount.industry}`);
      if (selectedAccount.brandVoice) ctx.push(`Voice: ${selectedAccount.brandVoice}`);
      if (selectedAccount.targetAudience) ctx.push(`Audience: ${selectedAccount.targetAudience}`);
      if (selectedAccount.brandColors?.length)
        ctx.push(`Brand colors: ${selectedAccount.brandColors.join(', ')}`);
      if (selectedAccount.brandFont) ctx.push(`Brand font: ${selectedAccount.brandFont}`);
      if (ctx.length) {
        finalPrompt = `[Brand Context]\n${ctx.join('\n')}\n\n[Task]\n${finalPrompt}`;
      }
    }

    const body = {
      model: tab.model,
      prompt: finalPrompt,
      aspectRatio: tab.ratio,
      thinkingLevel: tab.model === 'gemini-3.1-flash-image-preview' ? tab.thinkingLevel : '',
      resolution: tab.resolution,
      ...(tab.model === 'gpt-image-2' ? { quality: tab.quality } : {}),
      references: tab.references.map((r) => ({
        base64: r.base64,
        mimeType: r.mimeType,
        label: r.label,
      })),
    };

    type ReqResult =
      | { ok: true; images: { base64: string; mimeType: string }[] }
      | { ok: false; error: string };
    const requestOne = async (): Promise<ReqResult> => {
      try {
        const res = await authedFetch('/api/content/generate-composite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const text = await res.text();
        let data: any;
        try {
          data = JSON.parse(text);
        } catch {
          return { ok: false, error: text || 'Generation failed' };
        }
        if (!res.ok) return { ok: false, error: data.error || 'Generation failed' };
        return { ok: true, images: data.images ?? [] };
      } catch (e: any) {
        return { ok: false, error: e.message || 'Network error' };
      } finally {
        updateTab(tabId, (t) => ({
          ...t,
          progress: { ...t.progress, done: t.progress.done + 1 },
        }));
      }
    };

    try {
      const results = await Promise.all(Array.from({ length: n }, () => requestOne()));
      const ts = Date.now();
      const newAssets: GeneratedAsset[] = [];
      const errors: string[] = [];
      results.forEach((r, i) => {
        if (r.ok === true) {
          r.images.forEach((img, j) => {
            newAssets.push({
              base64: img.base64,
              mimeType: img.mimeType,
              timestamp: ts + i * 1000 + j,
            });
          });
        } else {
          errors.push(r.error);
        }
      });
      updateTab(tabId, (t) => {
        const errMsg =
          errors.length === 0
            ? t.error
            : newAssets.length
              ? `${errors.length} of ${n} failed: ${errors[0]}`
              : errors[0];
        return {
          ...t,
          assets: newAssets.length ? [...newAssets, ...t.assets] : t.assets,
          error: errMsg,
        };
      });
    } finally {
      updateTab(tabId, (t) => ({
        ...t,
        generating: false,
        progress: { done: 0, total: 0 },
      }));
    }
  };

  const downloadAsset = (asset: GeneratedAsset) => {
    const link = document.createElement('a');
    link.href = `data:${asset.mimeType};base64,${asset.base64}`;
    link.download = `composite-${asset.timestamp}.png`;
    link.click();
  };

  /**
   * One-click watermark removal on a generated asset: strips the visible Gemini
   * sparkle and the "Made with AI" metadata, replacing the asset in place. CPU-only
   * server-side; recovers the real pixels rather than regenerating the image.
   */
  const cleanAsset = async (tabId: string, asset: GeneratedAsset) => {
    setCleaningAssets((prev) => ({ ...prev, [asset.timestamp]: true }));
    try {
      const res = await authedFetch('/api/content/remove-watermark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: { base64: asset.base64, mimeType: asset.mimeType },
          removeSparkle: true,
          stripMetadata: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Watermark removal failed');
      const cleaned = data.images?.[0];
      if (!cleaned) throw new Error('No image returned');
      updateTab(tabId, (t) => ({
        ...t,
        assets: t.assets.map((a) =>
          a.timestamp === asset.timestamp
            ? { ...a, base64: cleaned.base64, mimeType: cleaned.mimeType || 'image/png', metaStripped: true }
            : a,
        ),
      }));
      autoStripRef.current.add(asset.timestamp);
    } catch (e: any) {
      updateTab(tabId, (t) => ({ ...t, error: e.message || 'Watermark removal failed' }));
    } finally {
      setCleaningAssets((prev) => {
        const next = { ...prev };
        delete next[asset.timestamp];
        return next;
      });
    }
  };

  /**
   * Auto metadata strip: when the active tab's "Strip AI metadata" toggle is on,
   * drop the C2PA / EXIF / XMP "Made with AI" provenance from every generated asset
   * that hasn't been processed yet. Metadata-only (removeSparkle:false) — lossless,
   * ~250ms, no GPU. Covers all generation paths since they all land in tab.assets.
   * The metaStripped flag + the ref keep it idempotent and prevent reprocessing.
   */
  useEffect(() => {
    const t = activeTab;
    if (!t || t.stripMetadata === false) return;
    const pending = t.assets.filter(
      (a) => !a.metaStripped && !autoStripRef.current.has(a.timestamp),
    );
    if (pending.length === 0) return;
    pending.forEach((a) => autoStripRef.current.add(a.timestamp));
    const tabId = t.id;
    (async () => {
      for (const a of pending) {
        try {
          const res = await authedFetch('/api/content/remove-watermark', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: { base64: a.base64, mimeType: a.mimeType },
              removeSparkle: false,
              stripMetadata: true,
            }),
          });
          const data = await res.json().catch(() => ({}));
          const cleaned = res.ok ? data.images?.[0] : null;
          if (cleaned) {
            updateTab(tabId, (tt) => ({
              ...tt,
              assets: tt.assets.map((x) =>
                x.timestamp === a.timestamp
                  ? { ...x, base64: cleaned.base64, mimeType: cleaned.mimeType || 'image/png', metaStripped: true }
                  : x,
              ),
            }));
          }
          // On failure leave the asset unmarked; the ref still blocks a retry this
          // session (a reload will re-attempt). Silent — it's a background nicety.
        } catch {
          /* ignore — background best-effort */
        }
      }
    })();
  }, [activeTab?.id, activeTab?.assets, activeTab?.stripMetadata]);

  /** Render -------------------------------------------------------------- */
  const tab = activeTab;
  const variantLabel: Record<LogoVariant, string> = {
    light: 'Light logo',
    dark: 'Dark logo',
    primary: 'Primary logo',
    simplistic: 'Simplistic logo',
    none: 'No logo',
  };

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Brand */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Select Brand</h3>
        {accountsLoading ? (
          <p className="text-sm text-zinc-600">Loading accounts...</p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-zinc-500">No accounts yet. Add one in the CRM.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {accounts.map((acct) => (
              <button
                key={acct.id}
                onClick={() => setSelectedAccountId(acct.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all border ${
                  selectedAccountId === acct.id
                    ? 'bg-purple-500/10 border-purple-500/30'
                    : 'border-[#27273A] hover:bg-[#181824]'
                }`}
              >
                <img
                  src={acct.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(acct.company)}&background=27273A&color=fff&size=28`}
                  alt=""
                  className="w-7 h-7 rounded-lg border border-[#27273A] object-cover shrink-0"
                />
                <span className="text-xs font-medium text-white truncate max-w-[120px]">{acct.company}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedAccount && (
        <>
          {/* Tab bar — each tab is an independent prompt + generation state.
              Generations keep running in the background when the user switches
              tabs, so multiple images can be in flight at once. */}
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-2 flex items-center gap-1.5 overflow-x-auto">
            {tabs.map((t, idx) => {
              const busy = isTabBusy(t);
              const pct =
                t.progress.total > 0 ? Math.min(100, (t.progress.done / t.progress.total) * 100) : 0;
              const showBar = busy && t.progress.total > 0;
              const showIndeterminate = busy && t.progress.total === 0;
              const hasError = !!t.error;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTabId(t.id)}
                  className={`relative group flex items-center gap-2 pl-3 pr-2 py-2 rounded-xl border transition-all min-w-[140px] max-w-[240px] ${
                    activeTabId === t.id
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-100'
                      : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600 text-zinc-300'
                  }`}
                  title={tabDisplayName(t, idx)}
                >
                  {busy ? (
                    <Loader size={11} className="animate-spin text-amber-400 shrink-0" />
                  ) : hasError ? (
                    <span className="w-2 h-2 rounded-full bg-red-500/80 shrink-0" />
                  ) : t.assets.length > 0 ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-500/70 shrink-0" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-zinc-700 shrink-0" />
                  )}
                  <span className="text-xs font-medium truncate flex-1 text-left">
                    {tabDisplayName(t, idx)}
                  </span>
                  {busy && t.progress.total > 1 && (
                    <span className="text-[9px] text-amber-300 font-mono shrink-0">
                      {t.progress.done}/{t.progress.total}
                    </span>
                  )}
                  {tabs.length > 1 && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Close tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          closeTab(t.id);
                        }
                      }}
                      className="ml-0.5 w-5 h-5 rounded-md flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Close tab"
                    >
                      <X size={11} />
                    </span>
                  )}
                  {showBar && (
                    <div className="absolute bottom-0 left-1 right-1 h-[2px] bg-purple-500/10 overflow-hidden rounded-full">
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 via-pink-500 to-purple-500 transition-[width] duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                  {showIndeterminate && (
                    <div className="absolute bottom-0 left-1 right-1 h-[2px] overflow-hidden rounded-full">
                      <div className="h-full w-1/3 bg-gradient-to-r from-amber-400 via-pink-500 to-purple-500 animate-[shimmer_1.2s_ease-in-out_infinite]" />
                    </div>
                  )}
                </button>
              );
            })}
            <button
              onClick={openNewTab}
              disabled={tabs.length >= MAX_TABS}
              className="flex items-center gap-1 px-3 py-2 rounded-xl border border-dashed border-[#27273A] hover:border-purple-500/40 hover:bg-purple-500/5 text-zinc-400 hover:text-purple-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
              title={tabs.length >= MAX_TABS ? `Max ${MAX_TABS} tabs` : 'New prompt tab'}
            >
              <Plus size={13} />
              <span className="text-[11px] font-medium">New</span>
            </button>
            <style>{`@keyframes shimmer {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(300%); }
            }`}</style>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
            {/* Left: Brand Assets + References + Prompt + Results */}
            <div className="space-y-5">
              {/* Brand Assets */}
              {(() => {
                const logos = [
                  { url: selectedAccount.primaryLogo, label: 'logo', sub: 'Primary' },
                  { url: selectedAccount.lightLogo, label: 'logoLight', sub: 'Light' },
                  { url: selectedAccount.darkLogo, label: 'logoDark', sub: 'Dark' },
                  { url: selectedAccount.simplisticLogo, label: 'logoSimple', sub: 'Simple' },
                  { url: selectedAccount.logo, label: 'logoAlt', sub: 'Alt' },
                ].filter((l): l is { url: string; label: string; sub: string } => !!l.url);
                const colors = selectedAccount.brandColors ?? [];
                const fontImage = selectedAccount.brandFontImage;
                const hasBrandText =
                  !!selectedAccount.brandVoice ||
                  !!selectedAccount.targetAudience ||
                  !!selectedAccount.industry ||
                  !!selectedAccount.brandFont;
                if (logos.length === 0 && colors.length === 0 && !hasBrandText && !fontImage) return null;
                return (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-4">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Brand Assets</h3>

                    {logos.length > 0 && (
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Logos</p>
                        <div className="flex flex-wrap gap-2">
                          {logos.map((l) => {
                            const already = tab.references.some((r) => r.label === l.label);
                            const adding = addingBrandRef === l.label;
                            return (
                              <button
                                key={l.label}
                                onClick={() => addBrandLogoAsReference(l.url, l.label)}
                                disabled={adding}
                                className={`relative w-20 rounded-xl border bg-[#0A0A0F] overflow-hidden hover:border-purple-500/40 transition-all group disabled:opacity-50 ${
                                  already ? 'border-purple-500/40' : 'border-[#27273A]'
                                }`}
                                title={
                                  already
                                    ? `Already added — click to insert @${l.label}`
                                    : `Add @${l.label} as a reference`
                                }
                              >
                                <div className="w-full aspect-square flex items-center justify-center bg-white/5 p-1.5">
                                  <img src={l.url} alt={l.sub} className="max-w-full max-h-full object-contain" />
                                </div>
                                <div className="bg-black/70 text-[9px] font-mono text-purple-200 py-0.5 text-center flex items-center justify-center gap-0.5">
                                  {adding ? (
                                    <Loader size={9} className="animate-spin" />
                                  ) : (
                                    <>
                                      <AtSign size={8} />
                                      {l.label}
                                    </>
                                  )}
                                </div>
                                <span className="absolute top-1 right-1 text-[8px] text-zinc-500 bg-black/50 px-1 rounded">
                                  {l.sub}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {fontImage && (() => {
                      const already = tab.references.some((r) => r.label === 'fontstyle');
                      const adding = addingBrandRef === 'fontstyle';
                      return (
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Font Style</p>
                          <button
                            onClick={() => addBrandLogoAsReference(fontImage, 'fontstyle')}
                            disabled={adding}
                            className={`relative rounded-xl border bg-white overflow-hidden hover:border-purple-500/40 transition-all group disabled:opacity-50 ${
                              already ? 'border-purple-500/40' : 'border-[#27273A]'
                            }`}
                            title={
                              already
                                ? 'Already added — click to insert @fontstyle'
                                : 'Add @fontstyle as a reference so generated text matches this lettering'
                            }
                          >
                            <div className="flex items-center justify-center p-2 max-w-[16rem]">
                              <img src={fontImage} alt="Font style" className="max-h-16 max-w-full object-contain" />
                            </div>
                            <div className="bg-black/70 text-[9px] font-mono text-purple-200 py-0.5 text-center flex items-center justify-center gap-0.5">
                              {adding ? (
                                <Loader size={9} className="animate-spin" />
                              ) : (
                                <>
                                  <AtSign size={8} />
                                  fontstyle
                                </>
                              )}
                            </div>
                          </button>
                          <p className="text-[10px] text-zinc-600 mt-1.5">Auto Compose uses this automatically. For manual prompts, click to add it, then reference <span className="font-mono text-zinc-500">@fontstyle</span>.</p>
                        </div>
                      );
                    })()}

                    {colors.length > 0 && (
                      <div>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Brand Colors</p>
                        <div className="flex flex-wrap gap-1.5">
                          {colors.map((c, i) => (
                            <button
                              key={`${c}-${i}`}
                              onClick={() => insertAtCursor(c)}
                              className="group relative w-12 h-12 rounded-lg border border-[#27273A] hover:border-purple-500/40 transition-all"
                              style={{ backgroundColor: c }}
                              title={`Insert ${c} into prompt`}
                            >
                              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono opacity-0 group-hover:opacity-100 bg-black/70 text-white rounded-lg">
                                {c}
                              </span>
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-zinc-600 mt-1.5">Click a swatch to insert its hex into the prompt.</p>
                      </div>
                    )}

                    {hasBrandText && (
                      <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-[#27273A]">
                        <input
                          type="checkbox"
                          checked={tab.applyBrandContext}
                          onChange={(e) => setActiveField('applyBrandContext', e.target.checked)}
                          className="mt-1 accent-purple-500"
                        />
                        <div className="flex-1">
                          <p className="text-[12px] text-zinc-300 font-medium">Apply brand context</p>
                          <p className="text-[10px] text-zinc-500 leading-snug">
                            Prepend
                            {selectedAccount.brandVoice ? ' voice,' : ''}
                            {selectedAccount.targetAudience ? ' audience,' : ''}
                            {selectedAccount.industry ? ' industry,' : ''}
                            {selectedAccount.brandFont ? ' font,' : ''}
                            {' '}and colors so the model stays on-brand.
                          </p>
                        </div>
                      </label>
                    )}
                  </div>
                );
              })()}

              {/* References */}
              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                    References <span className="text-[10px] text-zinc-600 normal-case tracking-normal ml-1">{tab.references.length}/{MAX_REFS}</span>
                  </h3>
                  {tab.references.length > 0 && tab.references.length < MAX_REFS && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg border border-[#27273A] hover:bg-[#181824]"
                    >
                      + Add more
                    </button>
                  )}
                </div>

                {tab.references.length === 0 ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                      dragOver ? 'border-purple-500 bg-purple-500/5' : 'border-[#27273A] hover:border-zinc-600 hover:bg-[#0A0A0F]'
                    }`}
                  >
                    <Upload size={28} className="mx-auto mb-3 text-zinc-500" />
                    <p className="text-sm text-zinc-400 mb-1">Drop images or click to upload</p>
                    <p className="text-[10px] text-zinc-600">
                      Up to {MAX_REFS} references &middot; each labeled @img1, @img2, @img3…
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                    {tab.references.map((r) => (
                      <div key={r.id} className="relative group">
                        <button
                          onClick={() => insertMention(r.label)}
                          className="block w-full aspect-square rounded-xl overflow-hidden bg-[#0A0A0F] border border-[#27273A] hover:border-purple-500/40 transition-all"
                          title={`Insert @${r.label}`}
                        >
                          <img src={r.preview} alt={r.label} className="w-full h-full object-cover" />
                        </button>
                        <div className="absolute bottom-1 left-1 bg-black/70 backdrop-blur rounded px-1.5 py-0.5 flex items-center gap-0.5">
                          <AtSign size={9} className="text-purple-300" />
                          <span className="text-[10px] font-mono text-purple-200">{r.label}</span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeReference(r.id); }}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-500/70"
                          title="Remove"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && processFiles(e.target.files)}
                />

                {tab.references.length > 0 && (
                  <p className="text-[10px] text-zinc-600">
                    Click a thumbnail to insert its @mention into the prompt.
                  </p>
                )}
              </div>

              {/* Prompt */}
              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Prompt</h3>
                  {isTabBusy(tab) && (
                    <span className="flex items-center gap-1.5 text-[10px] text-amber-300">
                      <Loader size={10} className="animate-spin" />
                      {tab.autoStage === 'classifying'
                        ? 'Classifying refs…'
                        : tab.autoStage === 'deliberating'
                          ? 'Studio panel deliberating…'
                          : tab.autoStage === 'architecting'
                            ? 'Writing the prompt…'
                            : tab.progress.total > 1
                              ? `Generating ${tab.progress.done}/${tab.progress.total}…`
                              : 'Generating…'}
                    </span>
                  )}
                </div>
                <textarea
                  ref={promptRef}
                  value={tab.prompt}
                  onChange={(e) => setActiveField('prompt', e.target.value)}
                  placeholder={
                    tab.references.length
                      ? `Describe what you want, referencing your images by @mention...\ne.g. "Use the building in @${tab.references[0].label} as the background for ${tab.references[1] ? `@${tab.references[1].label}` : 'the subject'}"`
                      : 'Describe the image you want to generate...'
                  }
                  rows={5}
                  className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none resize-none focus:border-purple-500/40 transition-colors font-mono"
                />
                {/* Inline progress bar — visible right under the prompt so the
                    user has a clear "this is generating" signal without needing
                    to look at the tab bar. */}
                {isTabBusy(tab) && (
                  <div className="h-1 bg-[#0A0A0F] border border-[#27273A] rounded-full overflow-hidden">
                    {tab.progress.total > 0 ? (
                      <div
                        className="h-full bg-gradient-to-r from-amber-400 via-pink-500 to-purple-500 transition-[width] duration-300"
                        style={{
                          width: `${Math.min(100, (tab.progress.done / tab.progress.total) * 100)}%`,
                        }}
                      />
                    ) : (
                      <div className="h-full w-1/3 bg-gradient-to-r from-amber-400 via-pink-500 to-purple-500 animate-[shimmer_1.2s_ease-in-out_infinite]" />
                    )}
                  </div>
                )}
                {tab.references.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tab.references.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => insertMention(r.label)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[#27273A] bg-[#0A0A0F] hover:border-purple-500/40 hover:bg-purple-500/5 transition-all text-[11px] text-purple-300 font-mono"
                      >
                        <AtSign size={10} />
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
                {isTabBusy(tab) && (
                  <p className="text-[10px] text-zinc-500 leading-snug">
                    Generation is running in the background — feel free to open a new tab
                    (<span className="text-purple-300">+ New</span>) and start another prompt while
                    this one finishes.
                  </p>
                )}
              </div>

              {tab.error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                  <p className="text-xs text-red-400">{tab.error}</p>
                </div>
              )}

              {/* Auto Compose plan */}
              {tab.lastPlan && (() => {
                const { classifier, labelMap, builtPrompt, brief } = tab.lastPlan;
                const intentLabel = classifier.intent === 'recreate' ? 'Recreate' : 'Create from inspiration';
                return (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                        <Zap size={12} className="text-amber-400" />
                        AI Plan
                      </h3>
                      <button
                        onClick={() => {
                          updateTab(tab.id, (t) => ({ ...t, prompt: builtPrompt, lastPlan: null }));
                        }}
                        className="text-[10px] text-purple-300 hover:text-purple-200 transition-colors px-2 py-1 rounded-lg border border-purple-500/30 hover:bg-purple-500/10"
                        title="Copy this prompt into the manual editor so you can tweak and re-run."
                      >
                        Edit in prompt
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
                      <div className="rounded-lg border border-[#27273A] bg-[#0A0A0F] p-2">
                        <p className="text-zinc-500 uppercase tracking-wider">Intent</p>
                        <p className={`font-medium mt-0.5 ${classifier.intent === 'recreate' ? 'text-emerald-300' : 'text-amber-300'}`}>{intentLabel}</p>
                      </div>
                      <div className="rounded-lg border border-[#27273A] bg-[#0A0A0F] p-2">
                        <p className="text-zinc-500 uppercase tracking-wider">Format</p>
                        <p className="text-zinc-200 font-medium mt-0.5">{classifier.inspiration_format.replace(/_/g, ' ')}</p>
                      </div>
                      <div className="rounded-lg border border-[#27273A] bg-[#0A0A0F] p-2">
                        <p className="text-zinc-500 uppercase tracking-wider">Ratio</p>
                        <p className="text-zinc-200 font-medium mt-0.5">{classifier.recommended_aspect_ratio}</p>
                      </div>
                      <div className="rounded-lg border border-[#27273A] bg-[#0A0A0F] p-2">
                        <p className="text-zinc-500 uppercase tracking-wider">Logo</p>
                        <p className="text-zinc-200 font-medium mt-0.5">{variantLabel[classifier.recommended_logo_variant]}</p>
                      </div>
                      <div className="rounded-lg border border-[#27273A] bg-[#0A0A0F] p-2">
                        <p className="text-zinc-500 uppercase tracking-wider">Title</p>
                        <p className="text-zinc-200 font-medium mt-0.5">{classifier.title_strategy === 'preserve' ? 'Preserve' : 'Invent'}</p>
                      </div>
                    </div>

                    {classifier.engagement_mechanic && (
                      <div className="rounded-lg border border-pink-500/30 bg-pink-500/5 p-3">
                        <p className="text-[10px] text-pink-400/80 uppercase tracking-wider mb-0.5">Engagement mechanic</p>
                        <p className="text-[11px] text-pink-100 leading-snug">{classifier.engagement_mechanic}</p>
                      </div>
                    )}

                    {classifier.intent_reason && (
                      <p className="text-[11px] text-zinc-500 italic leading-snug">"{classifier.intent_reason}"</p>
                    )}

                    {(classifier.suggested_title || classifier.suggested_cta) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {classifier.title_strategy === 'invent' && classifier.suggested_title && (
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                            <p className="text-[10px] text-amber-400/80 uppercase tracking-wider mb-0.5">Suggested title</p>
                            <p className="text-sm text-amber-200 font-medium">{classifier.suggested_title}</p>
                          </div>
                        )}
                        {classifier.suggested_cta && (
                          <div className="rounded-lg border border-pink-500/30 bg-pink-500/5 p-3">
                            <p className="text-[10px] text-pink-400/80 uppercase tracking-wider mb-0.5">Call to action</p>
                            <p className="text-sm text-pink-200 font-medium">{classifier.suggested_cta}</p>
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Classified References</p>
                      <div className="flex flex-wrap gap-2">
                        {classifier.assets.map((c) => {
                          const ref = tab.references[c.index];
                          const newLabel = labelMap[c.index];
                          const roleColors: Record<AssetRole, string> = {
                            inspiration: 'border-amber-500/40 text-amber-300',
                            dish: 'border-emerald-500/40 text-emerald-300',
                            logo: 'border-purple-500/40 text-purple-300',
                            fontstyle: 'border-pink-500/40 text-pink-300',
                            product: 'border-sky-500/40 text-sky-300',
                            background: 'border-zinc-500/40 text-zinc-300',
                            other: 'border-zinc-700 text-zinc-500',
                          };
                          return (
                            <div
                              key={c.index}
                              className={`flex items-start gap-2 rounded-xl border bg-[#0A0A0F] p-2 ${roleColors[c.role]} max-w-[220px]`}
                              title={c.description}
                            >
                              {ref && (
                                <img src={ref.preview} alt="" className="w-12 h-12 rounded-lg object-cover border border-[#27273A] shrink-0" />
                              )}
                              <div className="flex flex-col min-w-0">
                                <span className="text-[11px] font-mono leading-tight">@{newLabel}</span>
                                <span className="text-[9px] uppercase tracking-wider opacity-70">{c.role} · {Math.round(c.confidence * 100)}%</span>
                                {c.menu_match && (
                                  <span className="text-[10px] text-emerald-300 mt-1 truncate" title={c.menu_match}>
                                    ↳ {c.menu_match}
                                  </span>
                                )}
                                {c.extracted_title && (
                                  <span className="text-[10px] text-amber-200 mt-1 truncate" title={c.extracted_title}>
                                    "{c.extracted_title}"
                                  </span>
                                )}
                                {c.is_on_brand && (
                                  <span className="text-[9px] text-zinc-500 mt-0.5">on-brand</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {brief && (
                      <details className="group" open>
                        <summary className="cursor-pointer text-[11px] text-purple-300 hover:text-purple-200 transition-colors flex items-center gap-1.5">
                          <Zap size={11} className="text-purple-400" />
                          Studio art direction (roundtable)
                        </summary>
                        <div className="mt-2 space-y-2">
                          {brief.director_summary && (
                            <p className="text-[11px] text-zinc-200 italic leading-snug border-l-2 border-purple-500/40 pl-2">
                              {brief.director_summary}
                            </p>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px]">
                            {([
                              ['Composition', brief.composition],
                              ['Negative space', brief.negative_space],
                              ['Subject', brief.subject],
                              ['Background', brief.background],
                              ['Lighting & mood', brief.lighting],
                              ['Color', brief.color],
                              ['Logo placement', brief.logo_placement],
                              ['Typography', brief.typography],
                            ] as const).map(([label, val]) =>
                              val ? (
                                <div key={label} className="rounded-lg border border-[#27273A] bg-[#0A0A0F] p-2">
                                  <p className="text-purple-300/70 uppercase tracking-wider text-[9px]">{label}</p>
                                  <p className="text-zinc-300 mt-0.5 leading-snug">{val}</p>
                                </div>
                              ) : null,
                            )}
                          </div>
                          {brief.panel && brief.panel.length > 0 && (
                            <details className="group/panel">
                              <summary className="cursor-pointer text-[10px] text-zinc-500 hover:text-zinc-300">
                                Panel notes ({brief.panel.length} specialists)
                              </summary>
                              <div className="mt-1.5 space-y-1.5">
                                {brief.panel.map((p) => (
                                  <div key={p.specialist} className="rounded-lg border border-[#27273A] bg-[#0A0A0F] p-2">
                                    <p className="text-[10px] text-zinc-300 font-medium">
                                      {p.title} <span className="text-zinc-600">· {Math.round((p.confidence || 0) * 100)}%</span>
                                    </p>
                                    {p.assessment && (
                                      <p className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{p.assessment}</p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      </details>
                    )}

                    <details className="group">
                      <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                        Show generated prompt
                      </summary>
                      <pre className="mt-2 text-[10px] text-zinc-400 bg-[#0A0A0F] border border-[#27273A] rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                        {builtPrompt}
                      </pre>
                    </details>
                  </div>
                );
              })()}

              {/* Results */}
              {tab.assets.length > 0 && (
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Results</h3>

                  {tab.cachedPlan && (
                    <div className="mb-3 space-y-1.5">
                      <div className="flex items-stretch gap-2">
                        <input
                          type="text"
                          value={tab.quickAdjust}
                          onChange={(e) => setActiveField('quickAdjust', e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              quickRegenerate();
                            }
                          }}
                          placeholder="Quick adjust — e.g. 'This dish is actually Pasta Special' or 'Make title more dramatic'"
                          disabled={tab.quickRetrying || tab.generating || tab.autoStage !== 'idle'}
                          className="flex-1 min-w-0 bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-amber-500/40 transition-colors disabled:opacity-50"
                        />
                        <button
                          onClick={quickRegenerate}
                          disabled={!tab.quickAdjust.trim() || tab.quickRetrying || tab.generating || tab.autoStage !== 'idle'}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs font-medium hover:bg-amber-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                          title="Regenerate with this adjustment applied to the existing plan — skips classification."
                        >
                          {tab.quickRetrying ? (
                            <>
                              <Loader size={12} className="animate-spin" />
                              {tab.progress.total > 1 ? `${tab.progress.done}/${tab.progress.total}` : 'Retrying'}
                            </>
                          ) : (
                            <>
                              <Zap size={12} />
                              Retry{tab.count > 1 ? ` × ${tab.count}` : ''}
                            </>
                          )}
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-600">
                        Reuses the existing plan with your tweak — skips classification, only regenerates images.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {tab.assets.map((asset) => {
                      const capState = tab.captionsByAsset[asset.timestamp];
                      return (
                        <motion.div
                          key={asset.timestamp}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="rounded-xl overflow-hidden bg-[#0A0A0F] border border-[#27273A] flex flex-col"
                        >
                          <div className="relative group">
                            <img
                              src={`data:${asset.mimeType};base64,${asset.base64}`}
                              alt=""
                              className="w-full h-auto block"
                            />
                            {asset.metaStripped && (
                              <span
                                className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/55 text-emerald-300 text-[9px] font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                                title="AI 'Made with AI' metadata (C2PA/EXIF/XMP) stripped"
                              >
                                <Check size={9} /> Metadata stripped
                              </span>
                            )}
                            <div className="hover-scrim absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <PushToSchedulerButton
                                account={selectedAccount}
                                getImageBytes={() => ({ base64: asset.base64, mimeType: asset.mimeType })}
                                source={{ id: 'composer', topicHint: buildAssetTopicHint(tab) }}
                                compact
                                label="Push to AI Scheduler"
                              />
                              <button
                                onClick={() => cleanAsset(tab.id, asset)}
                                disabled={cleaningAssets[asset.timestamp]}
                                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-60"
                                title="Remove watermark (sparkle + AI metadata)"
                              >
                                {cleaningAssets[asset.timestamp] ? (
                                  <Loader size={14} className="animate-spin" />
                                ) : (
                                  <Star size={14} />
                                )}
                              </button>
                              <button
                                onClick={() => downloadAsset(asset)}
                                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                                title="Download"
                              >
                                <Download size={14} />
                              </button>
                              <button
                                onClick={() =>
                                  updateTab(tab.id, (t) => ({
                                    ...t,
                                    assets: t.assets.filter((a) => a.timestamp !== asset.timestamp),
                                  }))
                                }
                                className="p-2 rounded-lg bg-white/10 hover:bg-red-500/40 text-white transition-colors"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>

                          {/* Caption footer */}
                          <div className="px-2 py-2 border-t border-[#27273A] space-y-1.5">
                            {capState?.captions && capState.captions.length > 0 ? (
                              <>
                                {capState.captions.map((cap, i) => (
                                  <button
                                    key={i}
                                    onClick={() => copyCaption(asset.timestamp, i, cap)}
                                    className="block w-full text-left text-[10px] leading-snug text-zinc-300 bg-[#0A0A0F] border border-[#27273A] hover:border-purple-500/40 hover:bg-purple-500/5 rounded-lg px-2 py-1.5 transition-colors"
                                    title="Click to copy"
                                  >
                                    {capState.copied === i ? (
                                      <span className="text-emerald-300">Copied!</span>
                                    ) : (
                                      cap
                                    )}
                                  </button>
                                ))}
                                <button
                                  onClick={() => generateCaptionForAsset(asset)}
                                  disabled={capState.loading}
                                  className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
                                >
                                  {capState.loading ? 'Writing more…' : '↻ More options'}
                                </button>
                              </>
                            ) : capState?.error ? (
                              <>
                                <p className="text-[10px] text-red-400">{capState.error}</p>
                                <button
                                  onClick={() => generateCaptionForAsset(asset)}
                                  className="text-[10px] text-zinc-400 hover:text-zinc-200"
                                >
                                  Try again
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => generateCaptionForAsset(asset)}
                                disabled={capState?.loading}
                                className="w-full flex items-center justify-center gap-1.5 text-[10px] text-zinc-400 hover:text-zinc-200 py-1 transition-colors disabled:opacity-40"
                                title="Write a short Instagram caption using the dish, headline, and CTA as context."
                              >
                                {capState?.loading ? (
                                  <>
                                    <Loader size={10} className="animate-spin" />
                                    Writing…
                                  </>
                                ) : (
                                  <>
                                    <Zap size={10} />
                                    Write caption
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Right: Controls */}
            <div className="space-y-5">
              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">AI Model</h3>
                {(() => {
                  const cur = getModel(tab.model);
                  const prov = cur ? PROVIDER_MAP[cur.provider] : undefined;
                  return (
                    <button
                      onClick={() => setModelPickerOpen(true)}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600 transition-all text-left"
                    >
                      {prov && (
                        <div
                          className="flex items-center justify-center rounded-full shrink-0 font-semibold"
                          style={{ width: 28, height: 28, background: `${prov.color}22`, color: prov.color, fontSize: 14 }}
                        >
                          {prov.icon}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-zinc-200 truncate">{modelName(tab.model)}</p>
                        <p className="text-[10px] text-zinc-500 truncate">
                          {prov ? prov.name : 'Custom'}
                          {cur?.refs !== 'none' && cur ? ' · references' : ''}
                          {cur ? ` · up to ${cur.maxRes}` : ''}
                        </p>
                      </div>
                      <span className="text-[11px] text-purple-300/80 shrink-0">Change</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-zinc-500 shrink-0">
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  );
                })()}
              </div>

              {tab.model === 'gemini-3.1-flash-image-preview' && (
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Thinking Mode</h3>
                  <div className="flex gap-1.5">
                    {THINKING_LEVELS.map((th) => (
                      <button
                        key={th.id}
                        onClick={() => setActiveField('thinkingLevel', th.id)}
                        className={`flex-1 py-2 rounded-xl border text-center transition-all ${
                          tab.thinkingLevel === th.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                        }`}
                      >
                        <p className={`text-[11px] font-semibold ${tab.thinkingLevel === th.id ? 'text-purple-300' : 'text-zinc-300'}`}>{th.label}</p>
                        <p className="text-[8px] text-zinc-500">{th.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Aspect Ratio</h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {RATIOS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setActiveField('ratio', r.id)}
                      className={`px-2 py-2 rounded-lg border text-center transition-all ${
                        tab.ratio === r.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                      }`}
                    >
                      <p className={`text-[11px] font-semibold ${tab.ratio === r.id ? 'text-purple-300' : 'text-zinc-300'}`}>{r.label}</p>
                      <p className="text-[8px] text-zinc-500 mt-0.5 leading-tight">{r.sub}</p>
                    </button>
                  ))}
                </div>

                {tab.model === 'gpt-image-2' && (
                  <div className="mt-3 pt-3 border-t border-[#27273A] space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Custom Ratio</p>
                      <p className="text-[9px] text-zinc-600">1:3 to 3:1 · OpenAI only</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        value={tab.customW}
                        onChange={(e) => setActiveField('customW', e.target.value)}
                        placeholder="W"
                        className="w-16 bg-[#0A0A0F] border border-[#27273A] rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 text-center"
                      />
                      <span className="text-zinc-500 text-sm">:</span>
                      <input
                        type="number"
                        min="1"
                        value={tab.customH}
                        onChange={(e) => setActiveField('customH', e.target.value)}
                        placeholder="H"
                        className="w-16 bg-[#0A0A0F] border border-[#27273A] rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 text-center"
                      />
                      <button
                        onClick={applyCustomRatio}
                        disabled={!customRatioValid}
                        className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-medium bg-purple-500/15 border border-purple-500/30 text-purple-200 hover:bg-purple-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-[#0A0A0F] disabled:border-[#27273A] disabled:text-zinc-500"
                      >
                        Use
                      </button>
                    </div>
                    {!isPresetRatio && (
                      <p className="text-[10px] text-purple-300 font-mono">Active: {tab.ratio}</p>
                    )}
                    {tab.customW && tab.customH && !customRatioValid && (
                      <p className="text-[10px] text-red-400">Ratio must be between 1:3 and 3:1.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Resolution</h3>
                    <p className="text-[9px] text-zinc-600">Higher = sharper · costs more</p>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {RESOLUTIONS.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => setActiveField('resolution', r.id)}
                        className={`px-2 py-2 rounded-lg border text-center transition-all ${
                          tab.resolution === r.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                        }`}
                      >
                        <p className={`text-[11px] font-semibold ${tab.resolution === r.id ? 'text-purple-300' : 'text-zinc-300'}`}>{r.label}</p>
                        <p className="text-[8px] text-zinc-500 mt-0.5 leading-tight">{r.sub}</p>
                      </button>
                    ))}
                  </div>
                  {tab.resolution === '4K' && tab.model === 'gpt-image-2' && (
                    <p className="text-[10px] text-amber-400/80 mt-2">
                      4K is "experimental" per OpenAI. Only 16:9 / 9:16 reach full 3840 — other ratios scale to fit the 8.3M-pixel budget.
                    </p>
                  )}
                  {tab.resolution === '4K' && tab.model !== 'gpt-image-2' && (
                    <p className="text-[10px] text-amber-400/80 mt-2">
                      4K renders at maximum native detail — slower and a bit pricier per image.
                    </p>
                  )}
                </div>
                {tab.model === 'gpt-image-2' && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Quality</h3>
                    <div className="grid grid-cols-3 gap-1.5">
                      {OPENAI_QUALITIES.map((q) => (
                        <button
                          key={q.id}
                          onClick={() => setActiveField('quality', q.id)}
                          className={`px-2 py-2 rounded-lg border text-center transition-all ${
                            tab.quality === q.id ? 'bg-purple-500/10 border-purple-500/30' : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                          }`}
                        >
                          <p className={`text-[11px] font-semibold ${tab.quality === q.id ? 'text-purple-300' : 'text-zinc-300'}`}>{q.label}</p>
                          <p className="text-[8px] text-zinc-500 mt-0.5 leading-tight">{q.sub}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Count</h3>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        onClick={() => setActiveField('count', n)}
                        disabled={tab.generating}
                        className={`w-9 h-9 rounded-lg border text-xs font-medium transition-all ${
                          tab.count === n
                            ? 'bg-purple-500/15 border-purple-500/40 text-purple-200'
                            : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Optional guidance — a short hint the whole construct considers */}
                <div className="rounded-xl border border-[#27273A] bg-[#0A0A0F] p-2.5">
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wider">
                    Guidance <span className="text-zinc-600 normal-case tracking-normal">· optional</span>
                  </label>
                  <input
                    type="text"
                    value={tab.composeGuidance || ''}
                    onChange={(e) => setActiveField('composeGuidance', e.target.value)}
                    placeholder="e.g. “Lobster Dinner”, “cozy winter vibe”"
                    disabled={tab.autoStage !== 'idle' || tab.generating}
                    className="w-full mt-1.5 bg-[#12121A] border border-[#27273A] rounded-lg px-2.5 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors disabled:opacity-50"
                  />
                  <p className="text-[9px] text-zinc-600 mt-1 leading-snug">A short steer the whole panel takes into account — subject, theme, and copy.</p>
                </div>
                {/* Compose depth — Quick vs Deep (the studio roundtable) */}
                <div className="rounded-xl border border-[#27273A] bg-[#0A0A0F] p-2.5">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Compose depth</span>
                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    {([
                      ['quick', 'Quick', 'Single pass'],
                      ['deep', 'Deep · Studio', '6 minds + director'],
                    ] as const).map(([id, label, sub]) => {
                      const active = (tab.composeDepth || 'quick') === id;
                      return (
                        <button
                          key={id}
                          onClick={() => setActiveField('composeDepth', id)}
                          disabled={tab.autoStage !== 'idle' || tab.generating}
                          className={`flex flex-col items-start px-2.5 py-2 rounded-lg border text-left transition-all disabled:opacity-50 ${
                            active
                              ? 'bg-purple-500/15 border-purple-500/40'
                              : 'border-[#27273A] bg-[#12121A] hover:border-zinc-600'
                          }`}
                        >
                          <span className={`text-[11px] font-medium ${active ? 'text-purple-200' : 'text-zinc-300'}`}>{label}</span>
                          <span className="text-[9px] text-zinc-500">{sub}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Self-review — the QA critic checks the result and retries once */}
                <button
                  onClick={() => setActiveField('qaReview', !(tab.qaReview ?? true))}
                  disabled={tab.autoStage !== 'idle' || tab.generating}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border transition-all disabled:opacity-50 ${
                    (tab.qaReview ?? true) ? 'bg-purple-500/15 border-purple-500/40' : 'border-[#27273A] bg-[#0A0A0F]'
                  }`}
                  title="After rendering, an AI critic checks the logo, subject, text, and colors against your assets and retries once if it drifted."
                >
                  <span className="flex flex-col text-left">
                    <span className={`text-[11px] font-medium ${(tab.qaReview ?? true) ? 'text-purple-200' : 'text-zinc-400'}`}>Self-review</span>
                    <span className="text-[9px] text-zinc-500">AI checks logo · subject · text, retries once</span>
                  </span>
                  <span className={`w-7 h-4 rounded-full relative shrink-0 transition-colors ${(tab.qaReview ?? true) ? 'bg-purple-500/60' : 'bg-zinc-700'}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${(tab.qaReview ?? true) ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                </button>
                <button
                  onClick={() => setActiveField('jsonSpec', !(tab.jsonSpec ?? false))}
                  disabled={tab.autoStage !== 'idle' || tab.generating}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border transition-all disabled:opacity-50 ${
                    (tab.jsonSpec ?? false) ? 'bg-purple-500/15 border-purple-500/40' : 'border-[#27273A] bg-[#0A0A0F]'
                  }`}
                  title="Append a structured JSON spec sheet to the generated prompt — experimental A/B for adherence."
                >
                  <span className="flex flex-col text-left">
                    <span className={`text-[11px] font-medium ${(tab.jsonSpec ?? false) ? 'text-purple-200' : 'text-zinc-400'}`}>
                      Append JSON spec
                    </span>
                    <span className="text-[9px] text-zinc-500">Experimental · test adherence</span>
                  </span>
                  <span className={`w-7 h-4 rounded-full relative shrink-0 transition-colors ${(tab.jsonSpec ?? false) ? 'bg-purple-500/60' : 'bg-zinc-700'}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${(tab.jsonSpec ?? false) ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                </button>
                {/* Strip AI metadata — auto-remove the C2PA/EXIF "Made with AI" tag from every generation */}
                <button
                  onClick={() => setActiveField('stripMetadata', !(tab.stripMetadata ?? true))}
                  className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border transition-all ${
                    (tab.stripMetadata ?? true) ? 'bg-purple-500/15 border-purple-500/40' : 'border-[#27273A] bg-[#0A0A0F]'
                  }`}
                  title="Automatically strip the C2PA / EXIF / XMP 'Made with AI' metadata from every generated image, so platforms don't auto-label it. Lossless — pixels are untouched."
                >
                  <span className="flex flex-col text-left">
                    <span className={`text-[11px] font-medium ${(tab.stripMetadata ?? true) ? 'text-purple-200' : 'text-zinc-400'}`}>
                      Strip AI metadata
                    </span>
                    <span className="text-[9px] text-zinc-500">Removes “Made with AI” tag · lossless</span>
                  </span>
                  <span className={`w-7 h-4 rounded-full relative shrink-0 transition-colors ${(tab.stripMetadata ?? true) ? 'bg-purple-500/60' : 'bg-zinc-700'}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${(tab.stripMetadata ?? true) ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                </button>
                <button
                  onClick={autoCompose}
                  disabled={tab.references.length < 1 || tab.generating || tab.autoStage !== 'idle'}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 via-pink-500 to-purple-600 text-sm text-white font-medium hover:brightness-110 transition-all shadow-[0_0_15px_rgba(244,114,182,0.25)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    tab.references.length < 1
                      ? 'Drop at least one reference image first.'
                      : 'Let Firebase AI Logic classify your references and write the prompt for you.'
                  }
                >
                  {tab.autoStage === 'classifying' ? (
                    <>
                      <Loader size={14} className="animate-spin" />
                      Organizing assets…
                    </>
                  ) : tab.autoStage === 'deliberating' ? (
                    <>
                      <Loader size={14} className="animate-spin" />
                      Studio deliberating…
                    </>
                  ) : tab.autoStage === 'architecting' ? (
                    <>
                      <Loader size={14} className="animate-spin" />
                      Writing prompt…
                    </>
                  ) : tab.autoStage === 'generating' ? (
                    <>
                      <Loader size={14} className="animate-spin" />
                      Auto-composing
                      {tab.progress.total > 1 ? ` ${tab.progress.done}/${tab.progress.total}…` : '…'}
                    </>
                  ) : (
                    <>
                      <Zap size={14} />
                      Auto Compose
                      {tab.count > 1 ? ` × ${tab.count}` : ''}
                    </>
                  )}
                </button>
                <button
                  onClick={generate}
                  disabled={!tab.prompt.trim() || tab.generating || tab.autoStage !== 'idle'}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0A0A0F] border border-[#27273A] text-sm text-zinc-300 font-medium hover:border-purple-500/40 hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Generate using your manual prompt as-is."
                >
                  {tab.generating ? (
                    <>
                      <Loader size={14} className="animate-spin" />
                      Generating
                      {tab.progress.total > 1 ? ` ${tab.progress.done}/${tab.progress.total}…` : '…'}
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      Manual Generate
                      {tab.count > 1 ? ` × ${tab.count}` : ''}
                    </>
                  )}
                </button>
                {isTabBusy(tab) && (
                  <button
                    onClick={openNewTab}
                    disabled={tabs.length >= MAX_TABS}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-xs text-purple-200 font-medium hover:bg-purple-500/15 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Open a new prompt tab — this one keeps generating in the background."
                  >
                    <Plus size={12} />
                    Start another while this runs
                  </button>
                )}
                {isCacheHot && tab.autoStage === 'idle' && (
                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-300/90 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2 py-1.5">
                    <Zap size={10} />
                    <span>Plan cached — next click skips classification, just regenerates.</span>
                  </div>
                )}
                <p className="text-[10px] text-zinc-600 leading-snug">
                  <span className="text-zinc-400 font-medium">Auto Compose</span> uses Firebase AI to label your references (inspiration / dish / logo / etc.) and write the on-brand prompt for you. <span className="text-zinc-400 font-medium">Manual</span> uses your prompt as-is. <span className="text-purple-300 font-medium">Deep · Studio</span> convenes a roundtable of art directors (composition, subject, background, lighting, logo, typography) that deliberate before composing — cached, so regenerating is free.
                </p>
              </div>
            </div>
          </div>

          <InspirationWidget
            account={selectedAccount}
            menuItems={(fullAccount?.menuItems || []).map((m) => ({
              name: m.name,
              category: m.category,
            }))}
            onAddReference={addInspirationReference}
            onUseIdea={useInspirationIdea}
          />

          <ModelPicker
            isOpen={modelPickerOpen}
            onClose={() => setModelPickerOpen(false)}
            selectedId={tab.model}
            onSelect={selectModel}
            recentIds={recentModels}
          />
        </>
      )}
    </div>
  );
}
