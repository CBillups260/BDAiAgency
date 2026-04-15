import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload,
  X,
  Download,
  Loader,
  Check,
  RefreshCw,
  ChevronDown,
  Package,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import { addToFlowBucket } from './FlowBucket';
import { useFirestoreAccounts, type FirestoreAccount } from '../hooks/useFirestore';

// ─── Google Fonts catalog ─────────────────────────────────
const GOOGLE_FONTS = [
  'Playfair Display',
  'Montserrat',
  'Lora',
  'Raleway',
  'Oswald',
  'Dancing Script',
  'Bebas Neue',
  'Merriweather',
  'Poppins',
  'Cormorant Garamond',
  'Abril Fatface',
  'Libre Baskerville',
  'Josefin Sans',
  'Cinzel',
  'Great Vibes',
  'Archivo Black',
  'Crimson Text',
  'Satisfy',
  'Bitter',
  'Quicksand',
] as const;

const FONT_PAIRINGS: { label: string; primary: string; secondary: string }[] = [
  { label: 'Classic Serif + Sans', primary: 'Playfair Display', secondary: 'Montserrat' },
  { label: 'Bold + Clean', primary: 'Bebas Neue', secondary: 'Poppins' },
  { label: 'Elegant + Refined', primary: 'Cormorant Garamond', secondary: 'Raleway' },
  { label: 'Script + Modern', primary: 'Great Vibes', secondary: 'Josefin Sans' },
  { label: 'Display + Body', primary: 'Abril Fatface', secondary: 'Lora' },
  { label: 'Statement + Minimal', primary: 'Archivo Black', secondary: 'Quicksand' },
  { label: 'Ornate + Serif', primary: 'Cinzel', secondary: 'Crimson Text' },
  { label: 'Casual + Warm', primary: 'Satisfy', secondary: 'Merriweather' },
];

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
type TextAlign = (typeof TEXT_ALIGNS)[number];

const LOGO_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
type LogoPosition = (typeof LOGO_POSITIONS)[number];

interface CustomFont {
  name: string;
  base64: string;
  format: string;
}

interface SuggestedQuote {
  text: string;
  attribution?: string;
}

// ─── Helpers ──────────────────────────────────────────────

function loadGoogleFonts(fonts: string[]) {
  const id = 'quote-gen-google-fonts';
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;700`).join('&')}&display=swap`;
  document.head.appendChild(link);
}

function registerCustomFont(font: CustomFont) {
  const face = new FontFace(font.name, `url(data:font/${font.format};base64,${font.base64})`);
  return face.load().then((loaded) => {
    (document.fonts as any).add(loaded);
    return loaded;
  });
}

function getStoredCustomFonts(): CustomFont[] {
  try {
    return JSON.parse(localStorage.getItem('quote-gen-custom-fonts') || '[]');
  } catch {
    return [];
  }
}

function storeCustomFonts(fonts: CustomFont[]) {
  localStorage.setItem('quote-gen-custom-fonts', JSON.stringify(fonts));
}

const LOGO_POS_STYLES: Record<LogoPosition, React.CSSProperties> = {
  'top-left': { top: 16, left: 16 },
  'top-right': { top: 16, right: 16 },
  'bottom-left': { bottom: 16, left: 16 },
  'bottom-right': { bottom: 16, right: 16 },
};

// ─── Component ────────────────────────────────────────────

export default function QuoteGenerator() {
  // Brand
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) || null;

  // Background
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [bgBase64, setBgBase64] = useState<string | null>(null);
  const [bgMime, setBgMime] = useState<string>('image/jpeg');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Quote
  const [quoteText, setQuoteText] = useState('');
  const [attribution, setAttribution] = useState('');

  // AI suggestions
  const [suggestions, setSuggestions] = useState<SuggestedQuote[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // Font mode
  const [fontMode, setFontMode] = useState<'single' | 'dual'>('dual');
  const [primaryFont, setPrimaryFont] = useState('Playfair Display');
  const [secondaryFont, setSecondaryFont] = useState('Montserrat');
  const [fontSize, setFontSize] = useState(32);
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [textAlign, setTextAlign] = useState<TextAlign>('center');
  const [textShadow, setTextShadow] = useState(true);

  // Overlay
  const [overlayOpacity, setOverlayOpacity] = useState(0.45);
  const [overlayColor, setOverlayColor] = useState('#000000');

  // Logo
  const [showLogo, setShowLogo] = useState(false);
  const [logoVariant, setLogoVariant] = useState<'primary' | 'light' | 'dark'>('light');
  const [logoPosition, setLogoPosition] = useState<LogoPosition>('bottom-right');
  const [logoSize, setLogoSize] = useState(60);

  // Custom fonts
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [showFontPanel, setShowFontPanel] = useState(false);
  const customFontInputRef = useRef<HTMLInputElement>(null);

  // Export
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Load Google Fonts + custom fonts on mount
  useEffect(() => {
    loadGoogleFonts([...GOOGLE_FONTS]);
    const stored = getStoredCustomFonts();
    setCustomFonts(stored);
    stored.forEach((f) => registerCustomFont(f).catch(() => {}));
  }, []);

  // When a brand is selected, apply its colors, font, and logo
  useEffect(() => {
    if (!selectedAccount) return;

    // Apply brand font if available
    if (selectedAccount.brandFont) {
      if (selectedAccount.brandFontData) {
        const font: CustomFont = {
          name: selectedAccount.brandFont,
          base64: selectedAccount.brandFontData,
          format: 'truetype',
        };
        registerCustomFont(font).then(() => {
          setPrimaryFont(selectedAccount.brandFont!);
        }).catch(() => {});
      } else {
        // Assume it's a Google Font name
        setPrimaryFont(selectedAccount.brandFont);
      }
    }

    // Apply brand colors
    if (selectedAccount.brandColors?.length) {
      // Use first brand color as overlay tint
      setOverlayColor(selectedAccount.brandColors[0]);
    }

    // Auto-enable logo if available
    const hasLogo = selectedAccount.primaryLogo || selectedAccount.lightLogo || selectedAccount.darkLogo;
    if (hasLogo) {
      setShowLogo(true);
      if (selectedAccount.lightLogo) setLogoVariant('light');
      else if (selectedAccount.primaryLogo) setLogoVariant('primary');
      else if (selectedAccount.darkLogo) setLogoVariant('dark');
    }
  }, [selectedAccountId]);

  const allFonts = [...GOOGLE_FONTS, ...customFonts.map((f) => f.name)];
  // Add brand font to list if not already present
  if (selectedAccount?.brandFont && !allFonts.includes(selectedAccount.brandFont)) {
    allFonts.unshift(selectedAccount.brandFont);
  }

  const logoUrl = selectedAccount
    ? logoVariant === 'light'
      ? selectedAccount.lightLogo
      : logoVariant === 'dark'
        ? selectedAccount.darkLogo
        : selectedAccount.primaryLogo
    : null;

  // ── Upload background ─────────────────────────────────
  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 20 * 1024 * 1024) return;
    const objectUrl = URL.createObjectURL(file);
    setBgImage(objectUrl);
    setBgMime(file.type);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setBgBase64(result.split(',')[1]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); processFile(file); }
          return;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [processFile]);

  // ── Custom font upload ────────────────────────────────
  const handleFontUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const formatMap: Record<string, string> = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' };
    const format = formatMap[ext];
    if (!format) return;

    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(file);
    });

    const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const font: CustomFont = { name, base64, format };

    await registerCustomFont(font);

    const updated = [...customFonts.filter((f) => f.name !== name), font];
    setCustomFonts(updated);
    storeCustomFonts(updated);
    setPrimaryFont(name);

    e.target.value = '';
  }, [customFonts]);

  const removeCustomFont = useCallback((name: string) => {
    const updated = customFonts.filter((f) => f.name !== name);
    setCustomFonts(updated);
    storeCustomFonts(updated);
    if (primaryFont === name) setPrimaryFont('Playfair Display');
    if (secondaryFont === name) setSecondaryFont('Montserrat');
  }, [customFonts, primaryFont, secondaryFont]);

  // ── AI quote suggestions ──────────────────────────────
  const suggestQuotes = useCallback(async () => {
    if (!bgBase64) return;
    setSuggestLoading(true);
    setSuggestError(null);
    try {
      const res = await fetch('/api/content/generate-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: { base64: bgBase64, mimeType: bgMime },
          brandContext: selectedAccount ? {
            company: selectedAccount.company,
            industry: selectedAccount.industry,
            brandVoice: selectedAccount.brandVoice,
            targetAudience: selectedAccount.targetAudience,
          } : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || 'Failed to generate quotes');
      }
      const data = await res.json();
      setSuggestions(data.quotes || []);
    } catch (err: any) {
      setSuggestError(err.message);
    } finally {
      setSuggestLoading(false);
    }
  }, [bgBase64, bgMime, selectedAccount]);

  // ── Apply pairing ─────────────────────────────────────
  const applyPairing = (p: typeof FONT_PAIRINGS[number]) => {
    setFontMode('dual');
    setPrimaryFont(p.primary);
    setSecondaryFont(p.secondary);
  };

  // ── Export ─────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    if (!canvasRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(canvasRef.current, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `quote-${selectedAccount?.company?.replace(/\s+/g, '-') || 'post'}-${Date.now()}.png`;
      a.click();
    } catch {
    } finally {
      setExporting(false);
    }
  }, [selectedAccount]);

  const handleFlowBucket = useCallback(async () => {
    if (!canvasRef.current) return;
    setExporting(true);
    try {
      const dataUrl = await toPng(canvasRef.current, { pixelRatio: 2, cacheBust: true });
      const base64 = dataUrl.split(',')[1];
      await addToFlowBucket({
        name: quoteText.slice(0, 40) || 'Quote',
        base64,
        mimeType: 'image/png',
      });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
    } finally {
      setExporting(false);
    }
  }, [quoteText]);

  const hasContent = bgImage && quoteText.trim();

  // Brand color swatches (merge defaults + brand colors)
  const brandColors = selectedAccount?.brandColors?.length ? selectedAccount.brandColors : [];
  const overlaySwatches = ['#000000', '#1a1a2e', '#0f3460', '#2c003e', ...brandColors.filter((c) => !['#000000', '#1a1a2e', '#0f3460', '#2c003e'].includes(c))].slice(0, 8);
  const textSwatches = ['#FFFFFF', '#F5F5DC', '#FFD700', '#E0E0E0', ...brandColors.filter((c) => !['#FFFFFF', '#F5F5DC', '#FFD700', '#E0E0E0'].includes(c))].slice(0, 8);

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* ── Brand Selector ─────────────────────────────────── */}
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

      {/* ── Main content (only after brand selected) ──────── */}
      <AnimatePresence>
        {selectedAccount && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/* Brand context bar */}
            <div className="flex items-center gap-3 mb-5 px-1">
              {selectedAccount.avatar && (
                <img src={selectedAccount.avatar} alt="" className="w-8 h-8 rounded-lg border border-[#27273A] object-cover" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{selectedAccount.company}</p>
                <p className="text-[10px] text-zinc-500 truncate">
                  {[selectedAccount.industry, selectedAccount.brandVoice].filter(Boolean).join(' · ') || 'No brand details'}
                </p>
              </div>
              {brandColors.length > 0 && (
                <div className="flex gap-1">
                  {brandColors.slice(0, 5).map((c, i) => (
                    <div key={i} className="w-4 h-4 rounded-full border border-[#27273A]" style={{ backgroundColor: c }} />
                  ))}
                </div>
              )}
              {selectedAccount.brandFont && (
                <span className="text-[10px] text-zinc-500 bg-[#12121A] border border-[#27273A] rounded-lg px-2 py-1">
                  {selectedAccount.brandFont}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
              {/* ── Left: Canvas ─────────────────────────────── */}
              <div className="space-y-4">
                {/* Canvas preview */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Preview</h3>
                    {hasContent && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleFlowBucket}
                          disabled={exporting}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#27273A] text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors disabled:opacity-40"
                        >
                          {copied ? <Check size={12} className="text-emerald-400" /> : <Package size={12} />}
                          {copied ? 'Added' : 'Flow Bucket'}
                        </button>
                        <button
                          onClick={handleDownload}
                          disabled={exporting}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40"
                        >
                          {exporting ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
                          Download
                        </button>
                      </div>
                    )}
                  </div>

                  {!bgImage ? (
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`relative border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all ${
                        dragOver ? 'border-purple-500 bg-purple-500/5' : 'border-[#27273A] hover:border-zinc-600 hover:bg-[#0A0A0F]'
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
                      />
                      <Upload size={36} className="mx-auto mb-3 text-zinc-500" />
                      <p className="text-sm text-zinc-400 mb-1">Drop a background photo to start</p>
                      <p className="text-[10px] text-zinc-600">
                        JPG, PNG, WebP &mdash; or press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste
                      </p>
                    </div>
                  ) : (
                    <div className="relative">
                      <button
                        onClick={() => { setBgImage(null); setBgBase64(null); setSuggestions([]); setQuoteText(''); setAttribution(''); }}
                        className="absolute top-2 right-2 z-10 p-1.5 rounded-lg bg-black/60 text-zinc-400 hover:text-white transition-colors"
                      >
                        <X size={14} />
                      </button>

                      {/* The exportable canvas */}
                      <div
                        ref={canvasRef}
                        className="relative w-full overflow-hidden rounded-xl"
                        style={{ aspectRatio: '1 / 1' }}
                      >
                        {/* Background image */}
                        <img
                          src={bgImage}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          crossOrigin="anonymous"
                        />

                        {/* Color overlay */}
                        <div
                          className="absolute inset-0"
                          style={{ backgroundColor: overlayColor, opacity: overlayOpacity }}
                        />

                        {/* Quote text */}
                        <div
                          className="absolute inset-0 flex flex-col items-center justify-center p-10"
                          style={{ textAlign }}
                        >
                          {quoteText && (
                            <p
                              style={{
                                fontFamily: `'${primaryFont}', serif`,
                                fontSize: `${fontSize}px`,
                                lineHeight: 1.35,
                                color: textColor,
                                textShadow: textShadow ? '0 2px 12px rgba(0,0,0,0.6)' : 'none',
                                textAlign,
                                wordBreak: 'break-word',
                                fontWeight: 700,
                              }}
                            >
                              {quoteText}
                            </p>
                          )}
                          {attribution && (
                            <p
                              className="mt-4"
                              style={{
                                fontFamily: `'${fontMode === 'dual' ? secondaryFont : primaryFont}', sans-serif`,
                                fontSize: `${Math.max(14, fontSize * 0.45)}px`,
                                color: textColor,
                                opacity: 0.8,
                                textShadow: textShadow ? '0 1px 6px rgba(0,0,0,0.5)' : 'none',
                                textAlign,
                                letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                              }}
                            >
                              &mdash; {attribution}
                            </p>
                          )}
                        </div>

                        {/* Brand logo watermark */}
                        {showLogo && logoUrl && (
                          <img
                            src={logoUrl}
                            alt=""
                            className="absolute object-contain"
                            crossOrigin="anonymous"
                            style={{
                              ...LOGO_POS_STYLES[logoPosition],
                              width: `${logoSize}px`,
                              height: `${logoSize}px`,
                              opacity: 0.85,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Quote input ──────────────────────────────── */}
                {bgImage && (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-3">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Quote Text</h3>
                    <textarea
                      value={quoteText}
                      onChange={(e) => setQuoteText(e.target.value)}
                      placeholder="Type your quote here..."
                      rows={3}
                      className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors resize-none"
                    />
                    <input
                      type="text"
                      value={attribution}
                      onChange={(e) => setAttribution(e.target.value)}
                      placeholder="Attribution (e.g. author name)"
                      className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
                    />
                  </div>
                )}

                {/* ── AI Suggestions ───────────────────────────── */}
                {bgImage && (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">AI Quote Suggestions</h3>
                      <button
                        onClick={suggestQuotes}
                        disabled={suggestLoading || !bgBase64}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {suggestLoading ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        {suggestions.length > 0 ? 'Regenerate' : 'Suggest Quotes'}
                      </button>
                    </div>

                    {suggestError && (
                      <p className="text-xs text-red-400 mb-2">{suggestError}</p>
                    )}

                    {suggestLoading && (
                      <p className="text-xs text-purple-400 flex items-center gap-1.5 py-4">
                        <Loader size={12} className="animate-spin" />
                        Analyzing photo and generating quotes for {selectedAccount.company}...
                      </p>
                    )}

                    <AnimatePresence>
                      {suggestions.length > 0 && !suggestLoading && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="space-y-2"
                        >
                          {suggestions.map((q, idx) => (
                            <motion.button
                              key={idx}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.05 }}
                              onClick={() => { setQuoteText(q.text); if (q.attribution) setAttribution(q.attribution); }}
                              className={`w-full text-left rounded-xl p-3 border transition-all ${
                                quoteText === q.text
                                  ? 'bg-purple-500/10 border-purple-500/30'
                                  : 'bg-[#0A0A0F] border-[#27273A] hover:border-zinc-600'
                              }`}
                            >
                              <p className="text-sm text-zinc-200 leading-relaxed">"{q.text}"</p>
                              {q.attribution && (
                                <p className="text-[11px] text-zinc-500 mt-1">&mdash; {q.attribution}</p>
                              )}
                            </motion.button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {!suggestLoading && suggestions.length === 0 && (
                      <p className="text-xs text-zinc-600 py-2">Click "Suggest Quotes" to get AI-generated quotes based on your photo + {selectedAccount.company}'s brand.</p>
                    )}
                  </div>
                )}
              </div>

              {/* ── Right: Controls ────────────────────────────── */}
              <div className="space-y-4">
                {/* ── Logo Controls ─────────────────────────────── */}
                {(selectedAccount.primaryLogo || selectedAccount.lightLogo || selectedAccount.darkLogo) && (
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Brand Logo</h3>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showLogo}
                          onChange={(e) => setShowLogo(e.target.checked)}
                          className="accent-purple-500"
                        />
                        <span className="text-xs text-zinc-300">{showLogo ? 'On' : 'Off'}</span>
                      </label>
                    </div>

                    {showLogo && (
                      <>
                        {/* Logo variant */}
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Variant</p>
                          <div className="flex gap-1.5">
                            {([
                              ['primary', 'Primary', selectedAccount.primaryLogo],
                              ['light', 'Light', selectedAccount.lightLogo],
                              ['dark', 'Dark', selectedAccount.darkLogo],
                            ] as const).filter(([, , url]) => url).map(([key, label]) => (
                              <button
                                key={key}
                                onClick={() => setLogoVariant(key)}
                                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                                  logoVariant === key ? 'bg-purple-500/20 text-purple-300' : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Logo position */}
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Position</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {LOGO_POSITIONS.map((pos) => (
                              <button
                                key={pos}
                                onClick={() => setLogoPosition(pos)}
                                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                                  logoPosition === pos ? 'bg-purple-500/20 text-purple-300' : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                              >
                                {pos.replace('-', ' ')}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Logo size */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-zinc-500">Size</span>
                            <span className="text-xs text-zinc-400 font-mono">{logoSize}px</span>
                          </div>
                          <input
                            type="range"
                            min={24}
                            max={120}
                            value={logoSize}
                            onChange={(e) => setLogoSize(Number(e.target.value))}
                            className="w-full accent-purple-500"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── Overlay Controls ─────────────────────────── */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-4">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Overlay</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">Opacity</span>
                      <span className="text-xs text-zinc-400 font-mono">{Math.round(overlayOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(overlayOpacity * 100)}
                      onChange={(e) => setOverlayOpacity(Number(e.target.value) / 100)}
                      className="w-full accent-purple-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 shrink-0">Color</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {overlaySwatches.map((c) => (
                        <button
                          key={c}
                          onClick={() => setOverlayColor(c)}
                          className={`w-6 h-6 rounded-md border-2 transition-all ${
                            overlayColor === c ? 'border-purple-500 scale-110' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <input
                        type="color"
                        value={overlayColor}
                        onChange={(e) => setOverlayColor(e.target.value)}
                        className="w-6 h-6 rounded-md cursor-pointer bg-transparent border border-zinc-700"
                      />
                    </div>
                  </div>
                </div>

                {/* ── Font Controls ────────────────────────────── */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Typography</h3>
                    <div className="flex items-center gap-1 bg-[#0A0A0F] rounded-lg p-0.5">
                      {(['single', 'dual'] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setFontMode(m)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                            fontMode === m ? 'bg-purple-500/20 text-purple-300' : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          {m === 'single' ? 'Single' : 'Two-Font'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Brand font shortcut */}
                  {selectedAccount.brandFont && (
                    <button
                      onClick={() => setPrimaryFont(selectedAccount.brandFont!)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-left ${
                        primaryFont === selectedAccount.brandFont
                          ? 'bg-purple-500/10 border-purple-500/30'
                          : 'border-[#27273A] hover:bg-[#181824]'
                      }`}
                    >
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider shrink-0">Brand Font</span>
                      <span className="text-xs text-zinc-200 truncate" style={{ fontFamily: `'${selectedAccount.brandFont}'` }}>
                        {selectedAccount.brandFont}
                      </span>
                    </button>
                  )}

                  {/* Font pairings (quick-apply) */}
                  {fontMode === 'dual' && (
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Quick Pairings</p>
                      <div className="flex flex-wrap gap-1.5">
                        {FONT_PAIRINGS.map((p) => (
                          <button
                            key={p.label}
                            onClick={() => applyPairing(p)}
                            className={`px-2 py-1 rounded-lg text-[10px] border transition-all ${
                              primaryFont === p.primary && secondaryFont === p.secondary
                                ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                                : 'border-[#27273A] text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Primary font */}
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">
                      {fontMode === 'dual' ? 'Quote Font' : 'Font'}
                    </p>
                    <select
                      value={primaryFont}
                      onChange={(e) => setPrimaryFont(e.target.value)}
                      className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-purple-500/40"
                      style={{ fontFamily: `'${primaryFont}'` }}
                    >
                      {allFonts.map((f) => (
                        <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>
                      ))}
                    </select>
                  </div>

                  {/* Secondary font (dual mode) */}
                  {fontMode === 'dual' && (
                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Attribution Font</p>
                      <select
                        value={secondaryFont}
                        onChange={(e) => setSecondaryFont(e.target.value)}
                        className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-purple-500/40"
                        style={{ fontFamily: `'${secondaryFont}'` }}
                      >
                        {allFonts.map((f) => (
                          <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>{f}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Custom font upload */}
                  <div>
                    <button
                      onClick={() => setShowFontPanel(!showFontPanel)}
                      className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <ChevronDown size={10} className={`transition-transform ${showFontPanel ? 'rotate-180' : ''}`} />
                      Custom Fonts ({customFonts.length})
                    </button>
                    <AnimatePresence>
                      {showFontPanel && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 space-y-2">
                            {customFonts.map((f) => (
                              <div
                                key={f.name}
                                className="flex items-center justify-between px-3 py-2 bg-[#0A0A0F] border border-[#27273A] rounded-lg"
                              >
                                <span className="text-xs text-zinc-300" style={{ fontFamily: `'${f.name}'` }}>{f.name}</span>
                                <button
                                  onClick={() => removeCustomFont(f.name)}
                                  className="text-zinc-600 hover:text-red-400 transition-colors"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => customFontInputRef.current?.click()}
                              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#27273A] text-[10px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors"
                            >
                              <Upload size={10} /> Upload Font (.ttf, .otf, .woff, .woff2)
                            </button>
                            <input
                              ref={customFontInputRef}
                              type="file"
                              accept=".ttf,.otf,.woff,.woff2"
                              className="hidden"
                              onChange={handleFontUpload}
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* ── Text Style ───────────────────────────────── */}
                <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-4">
                  <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Text Style</h3>

                  {/* Size */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-500">Size</span>
                      <span className="text-xs text-zinc-400 font-mono">{fontSize}px</span>
                    </div>
                    <input
                      type="range"
                      min={16}
                      max={72}
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                  </div>

                  {/* Color */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 shrink-0">Color</span>
                    <div className="flex gap-1.5 flex-wrap">
                      {textSwatches.map((c) => (
                        <button
                          key={c}
                          onClick={() => setTextColor(c)}
                          className={`w-6 h-6 rounded-md border-2 transition-all ${
                            textColor === c ? 'border-purple-500 scale-110' : 'border-zinc-700'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <input
                        type="color"
                        value={textColor}
                        onChange={(e) => setTextColor(e.target.value)}
                        className="w-6 h-6 rounded-md cursor-pointer bg-transparent border border-zinc-700"
                      />
                    </div>
                  </div>

                  {/* Alignment */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 shrink-0">Align</span>
                    <div className="flex gap-1">
                      {TEXT_ALIGNS.map((a) => (
                        <button
                          key={a}
                          onClick={() => setTextAlign(a)}
                          className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                            textAlign === a ? 'bg-purple-500/20 text-purple-300' : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          {a.charAt(0).toUpperCase() + a.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Shadow */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={textShadow}
                      onChange={(e) => setTextShadow(e.target.checked)}
                      className="accent-purple-500"
                    />
                    <span className="text-xs text-zinc-300">Text shadow</span>
                  </label>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
