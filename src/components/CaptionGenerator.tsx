import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Star,
  Loader,
  Copy,
  Check,
  Hash,
  Type,
  Upload,
  X,
  Film,
  Music,
  FileText,
  Image,
  ChevronDown,
  RefreshCw,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import { useFirestoreAccounts } from '../hooks/useFirestore';
import SocialPostPreview from './SocialPostPreview';

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', limit: 2200 },
  { id: 'twitter', label: 'Twitter / X', limit: 280 },
  { id: 'linkedin', label: 'LinkedIn', limit: 3000 },
  { id: 'tiktok', label: 'TikTok', limit: 2200 },
  { id: 'facebook', label: 'Facebook', limit: 63206 },
];

const CAPTION_STYLES = [
  { id: 'short-sweet', label: 'Short & Sweet', desc: '1-2 punchy sentences max' },
  { id: 'long-form', label: 'Long Form', desc: 'Storytelling, detailed, paragraph-style' },
  { id: 'engaging', label: 'Engaging', desc: 'Questions, polls, call to comment' },
  { id: 'witty', label: 'Witty', desc: 'Clever wordplay, puns, humor' },
  { id: 'bold', label: 'Bold & Direct', desc: 'Strong statements, hot takes' },
  { id: 'storytelling', label: 'Storytelling', desc: 'Mini narrative, behind the moment' },
  { id: 'hype', label: 'Hype', desc: 'Excited energy, ALL CAPS moments' },
  { id: 'chill', label: 'Chill & Casual', desc: 'Laid-back, effortless, low-key' },
  { id: 'emotional', label: 'Emotional', desc: 'Heartfelt, sentimental, deep' },
  { id: 'educational', label: 'Educational', desc: 'Did you know? Tips, facts' },
  { id: 'trendy', label: 'Trendy', desc: 'Current slang, memes, viral vibes' },
  { id: 'professional', label: 'Professional', desc: 'Polished, brand-forward, clean' },
  { id: 'promo', label: 'Promo / Sale', desc: 'Limited time, deals, urgency' },
  { id: 'seasonal', label: 'Seasonal', desc: 'Holiday, weather, time-of-year themed' },
  { id: 'fomo', label: 'FOMO', desc: 'Fear of missing out, scarcity' },
  { id: 'question', label: 'Question Hook', desc: 'Opens with a compelling question' },
  { id: 'listicle', label: 'Listicle', desc: 'Top 3, 5 reasons, numbered format' },
  { id: 'testimonial', label: 'Testimonial', desc: 'Customer voice, social proof' },
  { id: 'nostalgic', label: 'Nostalgic', desc: 'Throwback, memories, "remember when"' },
  { id: 'inspirational', label: 'Inspirational', desc: 'Motivational, uplifting, aspirational' },
  { id: 'behind-scenes', label: 'Behind the Scenes', desc: 'Insider look, making-of, process' },
  { id: 'controversial', label: 'Hot Take', desc: 'Unpopular opinion, debate starter' },
  { id: 'minimal', label: 'Minimal', desc: 'Ultra short — 5 words or less' },
  { id: 'poetic', label: 'Poetic', desc: 'Lyrical, rhythmic, artistic flow' },
] as const;

const ACCEPT_TYPES = 'image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/mpeg,audio/wav,application/pdf';
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_MEDIA_SIZE = 20 * 1024 * 1024;

interface MediaFile {
  base64: string;
  mimeType: string;
  name: string;
  preview: string | null;
  size: number;
}

interface CaptionResult {
  captions: string[];
  platform: string;
  charLimit: number;
}

function mediaIcon(mimeType: string) {
  if (mimeType.startsWith('video/')) return <Film size={20} className="text-blue-400" />;
  if (mimeType.startsWith('audio/')) return <Music size={20} className="text-amber-400" />;
  if (mimeType === 'application/pdf') return <FileText size={20} className="text-red-400" />;
  return <Image size={20} className="text-emerald-400" />;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CaptionGenerator() {
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [platform, setPlatform] = useState('instagram');
  const [captionStyle, setCaptionStyle] = useState('short-sweet');
  const [context, setContext] = useState('');
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [includeEmojis, setIncludeEmojis] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [selectedCaptionIdx, setSelectedCaptionIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CaptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;
  const activePlatform = PLATFORMS.find((p) => p.id === platform)!;

  // -- Auto-generate: ref-based trigger to avoid stale closures in useEffect --
  const pendingGenRef = useRef(false);
  const generateRef = useRef<(() => Promise<void>) | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!selectedAccount || !mediaFiles.length) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content/generate-caption', {
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
          media: mediaFiles.map(({ base64, mimeType }) => ({ base64, mimeType })),
          platform,
          captionStyle,
          topic: context.trim() || undefined,
          includeHashtags,
          includeEmojis,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = 'Generation failed';
        try {
          const body = JSON.parse(text);
          msg = body.error || msg;
        } catch {
          msg = text || res.statusText || msg;
        }
        throw new Error(msg);
      }
      setResult(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, mediaFiles, platform, captionStyle, context, includeHashtags, includeEmojis]);

  generateRef.current = handleGenerate;

  useEffect(() => {
    if (pendingGenRef.current && mediaFiles.length > 0 && selectedAccount && !loading) {
      pendingGenRef.current = false;
      generateRef.current?.();
    }
  }, [mediaFiles, selectedAccount, loading]);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const newFiles: MediaFile[] = [];
    for (const file of Array.from(files)) {
      const maxSize = file.type.startsWith('image/') ? MAX_IMAGE_SIZE : MAX_MEDIA_SIZE;
      if (file.size > maxSize) {
        setError(`${file.name} exceeds ${formatSize(maxSize)} limit`);
        continue;
      }
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const r = reader.result as string;
          resolve(r.split(',')[1]);
        };
        reader.readAsDataURL(file);
      });

      let preview: string | null = null;
      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file);
      } else if (file.type.startsWith('video/')) {
        preview = await new Promise<string | null>((resolve) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadeddata = () => { video.currentTime = 0.5; };
          video.onseeked = () => {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d')?.drawImage(video, 0, 0);
            resolve(canvas.toDataURL('image/jpeg'));
            URL.revokeObjectURL(video.src);
          };
          video.onerror = () => resolve(null);
          video.src = URL.createObjectURL(file);
        });
      }

      newFiles.push({ base64, mimeType: file.type, name: file.name, preview, size: file.size });
    }
    if (newFiles.length > 0) {
      pendingGenRef.current = true;
      setMediaFiles((prev) => [...prev, ...newFiles]);
      setError(null);
    }
  }, []);

  const removeMedia = (idx: number) => {
    setMediaFiles((prev) => prev.filter((_, i) => i !== idx));
    setResult(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const copyCaption = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        processFiles(files);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [processFiles]);

  const hasMedia = mediaFiles.length > 0;
  const primaryPreview = mediaFiles[0]?.preview ?? null;
  const primaryMime = mediaFiles[0]?.mimeType ?? '';

  return (
    <div className="space-y-5 max-w-4xl">
      {/* ── Brand Selector ────────────────────────────── */}
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
                  alt="" className="w-7 h-7 rounded-lg border border-[#27273A] object-cover shrink-0"
                />
                <span className="text-xs font-medium text-white truncate max-w-[120px]">{acct.company}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Upload Zone ───────────────────────────────── */}
      <AnimatePresence>
        {selectedAccount && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                  Drop your content
                </h3>
                {hasMedia && (
                  <button
                    onClick={() => { setMediaFiles([]); setResult(null); }}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
                  >
                    <X size={10} /> Clear all
                  </button>
                )}
              </div>

              {!hasMedia ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                    dragOver
                      ? 'border-purple-500 bg-purple-500/5'
                      : 'border-[#27273A] hover:border-zinc-600 hover:bg-[#0A0A0F]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_TYPES}
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && processFiles(e.target.files)}
                  />
                  <Upload size={32} className="mx-auto mb-3 text-zinc-500" />
                  <p className="text-sm text-zinc-400 mb-1">
                    Drop an image or video and captions will generate automatically
                  </p>
                  <p className="text-[10px] text-zinc-600">
                    Images &middot; Video &middot; Audio &middot; PDF &mdash; AI analyzes your content + brand context
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-2">
                    or press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste from clipboard
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-4">
                  {/* Primary media thumbnail with loading overlay */}
                  <div className="relative shrink-0">
                    <div className={`w-28 h-28 rounded-xl overflow-hidden bg-[#0A0A0F] border border-[#27273A] flex items-center justify-center ${loading ? 'animate-pulse' : ''}`}>
                      {primaryPreview ? (
                        <img src={primaryPreview} alt="" className="w-full h-full object-cover" />
                      ) : (
                        mediaIcon(primaryMime)
                      )}
                    </div>
                    {loading && (
                      <div className="absolute inset-0 bg-black/50 rounded-xl flex items-center justify-center">
                        <Loader size={20} className="text-purple-400 animate-spin" />
                      </div>
                    )}
                    {mediaFiles.length > 1 && (
                      <span className="absolute -bottom-1.5 -right-1.5 bg-purple-500 text-white text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                        +{mediaFiles.length - 1}
                      </span>
                    )}
                  </div>

                  {/* Info + actions */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-xs text-zinc-300 truncate">{mediaFiles.map(f => f.name).join(', ')}</p>
                    <p className="text-[10px] text-zinc-500">
                      {mediaFiles.length} file{mediaFiles.length > 1 ? 's' : ''} &middot; {selectedAccount.company} &middot; {activePlatform.label}
                    </p>

                    {loading ? (
                      <p className="text-xs text-purple-400 flex items-center gap-1.5">
                        <Loader size={12} className="animate-spin" />
                        Analyzing content &amp; generating captions...
                      </p>
                    ) : result?.captions?.length ? (
                      <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                        <Check size={12} />
                        {result.captions.length} captions ready
                      </p>
                    ) : null}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg border border-[#27273A] hover:bg-[#181824]"
                      >
                        + Add more
                      </button>
                      {result && !loading && (
                        <button
                          onClick={handleGenerate}
                          className="text-[10px] text-purple-400 hover:text-purple-300 transition-colors px-2 py-1 rounded-lg border border-purple-500/20 hover:bg-purple-500/10 flex items-center gap-1"
                        >
                          <RefreshCw size={10} /> Regenerate
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Hidden file input reused for "Add more" */}
              {hasMedia && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_TYPES}
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && processFiles(e.target.files)}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Caption Style ─────────────────────────────── */}
      <AnimatePresence>
        {selectedAccount && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Caption Style</h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                {CAPTION_STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setCaptionStyle(s.id)}
                    className={`px-2 py-2.5 rounded-xl border text-center transition-all ${
                      captionStyle === s.id
                        ? 'bg-purple-500/10 border-purple-500/30'
                        : 'border-[#27273A] bg-[#0A0A0F] hover:border-zinc-600'
                    }`}
                  >
                    <p className={`text-[11px] font-semibold leading-tight ${captionStyle === s.id ? 'text-purple-300' : 'text-zinc-300'}`}>{s.label}</p>
                    <p className="text-[8px] text-zinc-500 mt-0.5 leading-tight">{s.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Options (Platform, Toggles, Context) ───────── */}
      <AnimatePresence>
        {selectedAccount && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl">
              <button
                onClick={() => setShowOptions(!showOptions)}
                className="w-full flex items-center justify-between px-5 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Options</span>
                  <span className="text-[10px] text-zinc-600">
                    {activePlatform.label} &middot; {includeHashtags ? 'Hashtags on' : 'No hashtags'} &middot; {includeEmojis ? 'Emojis on' : 'No emojis'}
                  </span>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-zinc-500 transition-transform ${showOptions ? 'rotate-180' : ''}`}
                />
              </button>

              <AnimatePresence>
                {showOptions && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: 'auto' }}
                    exit={{ height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4 space-y-4 border-t border-[#27273A] pt-4">
                      {/* Platform */}
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium shrink-0">Platform</p>
                        <div className="flex flex-wrap gap-1.5">
                          {PLATFORMS.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => setPlatform(p.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                                platform === p.id
                                  ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                                  : 'border-[#27273A] text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Toggles */}
                      <div className="flex items-center gap-6">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={includeHashtags} onChange={(e) => setIncludeHashtags(e.target.checked)} className="accent-purple-500" />
                          <span className="text-xs text-zinc-300 flex items-center gap-1"><Hash size={10} /> Hashtags</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={includeEmojis} onChange={(e) => setIncludeEmojis(e.target.checked)} className="accent-purple-500" />
                          <span className="text-xs text-zinc-300 flex items-center gap-1"><Type size={10} /> Emojis</span>
                        </label>
                      </div>

                      {/* Optional context + regenerate */}
                      <div className="flex gap-3">
                        <input
                          type="text"
                          value={context}
                          onChange={(e) => setContext(e.target.value)}
                          placeholder="Optional extra context... e.g. 'This is our new lunch special'"
                          className="flex-1 bg-[#0A0A0F] border border-[#27273A] rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
                        />
                        {hasMedia && (
                          <button
                            onClick={handleGenerate}
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-xs text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                          >
                            <RefreshCw size={12} /> Regenerate
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error ─────────────────────────────────────── */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* ── Results: Platform Preview + Captions ──────── */}
      <AnimatePresence>
        {result?.captions?.length ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 lg:grid-cols-[minmax(0,460px)_1fr] gap-5"
          >
            {/* Platform Preview */}
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-4">
                Platform Preview
              </h3>
              <SocialPostPreview
                accountName={selectedAccount?.company || ''}
                accountAvatar={selectedAccount?.avatar}
                defaultPlatform={platform}
                caption={result.captions[selectedCaptionIdx] || result.captions[0]}
                image={primaryPreview || undefined}
              />
            </div>

            {/* Captions list */}
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
                  Captions
                </h3>
                <span className="text-[10px] text-zinc-600">
                  {result.captions.length} variants &middot; {activePlatform.label}
                </span>
              </div>
              <div className="space-y-3">
                {result.captions.map((caption, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.06 }}
                    onClick={() => setSelectedCaptionIdx(idx)}
                    className={`rounded-xl p-4 cursor-pointer transition-all border ${
                      selectedCaptionIdx === idx
                        ? 'bg-purple-500/5 border-purple-500/30'
                        : 'bg-[#0A0A0F] border-[#27273A] hover:border-zinc-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`text-[10px] font-mono mt-0.5 shrink-0 w-4 text-right ${
                        selectedCaptionIdx === idx ? 'text-purple-400' : 'text-zinc-600'
                      }`}>
                        {idx + 1}
                      </span>
                      <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-line flex-1">{caption}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                          caption.length > activePlatform.limit
                            ? 'bg-red-500/10 text-red-400'
                            : 'bg-emerald-500/10 text-emerald-400'
                        }`}>
                          {caption.length}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyCaption(caption, idx); }}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#181824] transition-colors"
                          title="Copy"
                        >
                          {copiedIdx === idx ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
