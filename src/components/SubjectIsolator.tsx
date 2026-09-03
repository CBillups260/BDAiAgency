import { authedFetch } from '../lib/api';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload,
  X,
  Download,
  Loader,
  RefreshCw,
  Check,
  Package,
  Send,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import { addToFlowBucket } from './FlowBucket';
import { usePersistedState } from '../hooks/usePersistedState';
import { useFirestoreAccounts, type FirestoreAccount as Account } from '../hooks/useFirestore';
import { firestore, storage, COLLECTIONS } from '../lib/firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

const RATIOS = [
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:5', label: '4:5', w: 4, h: 5 },
  { id: '5:4', label: '5:4', w: 5, h: 4 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '2:3', label: '2:3', w: 2, h: 3 },
  { id: '3:2', label: '3:2', w: 3, h: 2 },
] as const;

export default function SubjectIsolator() {
  // Input
  const [sourceImage, setSourceImage] = usePersistedState<string | null>('isolator.sourceImage', null);
  const [sourceBase64, setSourceBase64] = usePersistedState<string | null>('isolator.sourceBase64', null);
  const [sourceMime, setSourceMime] = usePersistedState<string>('isolator.sourceMime', 'image/jpeg');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Options
  const [aspectRatio, setAspectRatio] = usePersistedState<string>('isolator.aspectRatio', '1:1');

  // Result
  const [resultImage, setResultImage] = usePersistedState<string | null>('isolator.resultImage', null);
  const [resultBase64, setResultBase64] = usePersistedState<string | null>('isolator.resultBase64', null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Export
  const [flowAdded, setFlowAdded] = useState(false);

  // Send to Account
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<
    | { kind: 'success'; accountName: string; assetName: string; menuMatch: string | null; tags: string[]; category: string }
    | { kind: 'error'; message: string }
    | null
  >(null);

  // ── File handling ─────────────────────────────────────
  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 20 * 1024 * 1024) {
      setError('Image must be under 20 MB');
      return;
    }
    const url = URL.createObjectURL(file);
    setSourceImage(url);
    setSourceMime(file.type);
    setResultImage(null);
    setResultBase64(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = () => setSourceBase64((reader.result as string).split(',')[1]);
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

  const clearAll = () => {
    setSourceImage(null);
    setSourceBase64(null);
    setResultImage(null);
    setResultBase64(null);
    setError(null);
  };

  // ── Generate ──────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!sourceBase64) return;
    setLoading(true);
    setError(null);
    setResultImage(null);
    setResultBase64(null);
    setSendStatus(null);
    try {
      const res = await authedFetch('/api/content/extract-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: { base64: sourceBase64, mimeType: sourceMime },
          aspectRatio,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || 'Background extraction failed');
      }
      const data = await res.json();
      if (!data.images?.length) throw new Error('No image returned');
      const img = data.images[0];
      setResultBase64(img.base64);
      setResultImage(`data:${img.mimeType};base64,${img.base64}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sourceBase64, sourceMime, aspectRatio]);

  // ── Export ─────────────────────────────────────────────
  const handleDownload = () => {
    if (!resultImage) return;
    const a = document.createElement('a');
    a.href = resultImage;
    a.download = `background-${Date.now()}.png`;
    a.click();
  };

  const handleFlowBucket = async () => {
    if (!resultBase64) return;
    await addToFlowBucket({ name: 'Extracted Background', base64: resultBase64, mimeType: 'image/png' });
    setFlowAdded(true);
    setTimeout(() => setFlowAdded(false), 2000);
  };

  const handleSendToAccount = useCallback(async (account: Account) => {
    if (!resultBase64) return;
    setShowAccountPicker(false);
    setSendingTo(account.id);
    setSendStatus(null);
    try {
      const menuSnap = await getDocs(
        query(collection(firestore, COLLECTIONS.menuItems), where('accountId', '==', account.id))
      );
      const menuItems = menuSnap.docs.map((d) => {
        const data = d.data() as { name?: string; category?: string; description?: string };
        return {
          name: data.name || '',
          category: data.category || '',
          description: data.description || undefined,
        };
      }).filter((m) => m.name);

      let analysis: {
        name?: string;
        category?: string;
        tags?: string[];
        description?: string | null;
        menuMatch?: string | null;
      } = {};
      try {
        const res = await authedFetch('/api/content/analyze-asset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: resultBase64,
            imageMimeType: 'image/png',
            menuItems,
          }),
        });
        if (res.ok) analysis = await res.json();
      } catch {
        // Analysis is best-effort — fall back to defaults below
      }

      const safeName = (analysis.name || 'Extracted Background').replace(/\s+/g, '-').toLowerCase();
      const fileName = `${Date.now()}-${safeName}.png`;
      const sref = storageRef(storage, `assets/${account.id}/${fileName}`);
      const bytes = Uint8Array.from(atob(resultBase64), (c) => c.charCodeAt(0));
      await uploadBytes(sref, bytes, { contentType: 'image/png' });
      const imageUrl = await getDownloadURL(sref);

      const assetName = analysis.name || 'Extracted Background';
      const category = analysis.category || 'Uncategorized';
      const tags = analysis.tags || [];
      const menuMatch = analysis.menuMatch || null;

      await addDoc(collection(firestore, COLLECTIONS.mediaAssets), {
        accountId: account.id,
        name: assetName,
        category,
        tags,
        description: analysis.description || null,
        menuMatch,
        imageUrl,
        mimeType: 'image/png',
        source: 'ai-enhancer',
        createdAt: serverTimestamp(),
      });

      setSendStatus({
        kind: 'success',
        accountName: account.company,
        assetName,
        menuMatch,
        tags,
        category,
      });
    } catch (e: any) {
      setSendStatus({ kind: 'error', message: e?.message || 'Failed to send to account' });
    } finally {
      setSendingTo(null);
    }
  }, [resultBase64]);

  return (
    <div className="max-w-4xl space-y-5">
      {/* ── Upload ────────────────────────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-1">Upload Image</h3>
        <p className="text-[10px] text-zinc-600 mb-4">Upload a photo with a subject in it &mdash; AI will remove the subject and give you a clean, usable background.</p>

        {!sourceImage ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-all ${
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
            <p className="text-sm text-zinc-400 mb-1">Drop an image to extract its background</p>
            <p className="text-[10px] text-zinc-600">
              JPG, PNG, WebP &mdash; or press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <img
                src={sourceImage}
                alt="Source"
                className="w-32 h-32 rounded-xl object-cover border border-[#27273A]"
              />
              <button
                onClick={clearAll}
                className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-[#12121A] border border-[#27273A] text-zinc-500 hover:text-white transition-colors"
              >
                <X size={10} />
              </button>
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <p className="text-xs text-zinc-400">Image uploaded. Pick your output aspect ratio and extract the background.</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg border border-[#27273A] hover:bg-[#181824]"
              >
                Replace image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Aspect Ratio + Generate ───────────────────────── */}
      <AnimatePresence>
        {sourceImage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden space-y-5"
          >
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Output Aspect Ratio</h3>
              <div className="flex flex-wrap gap-2">
                {RATIOS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setAspectRatio(r.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                      aspectRatio === r.id
                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                        : 'border-[#27273A] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <div
                      className={`border rounded-sm ${
                        aspectRatio === r.id ? 'border-purple-400' : 'border-zinc-600'
                      }`}
                      style={{
                        width: `${Math.round((r.w / Math.max(r.w, r.h)) * 16)}px`,
                        height: `${Math.round((r.h / Math.max(r.w, r.h)) * 16)}px`,
                      }}
                    />
                    <span className="text-xs font-medium">{r.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-600 mt-2">
                AI will extend or crop the background to fill the selected ratio.
              </p>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading || !sourceBase64}
              className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  Removing subject &amp; extracting background...
                </>
              ) : resultImage ? (
                <>
                  <RefreshCw size={16} />
                  Regenerate
                </>
              ) : (
                'Extract Background'
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Error ─────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* ── Result ────────────────────────────────────────── */}
      <AnimatePresence>
        {resultImage && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5"
          >
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Extracted Background</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAccountPicker(true)}
                  disabled={sendingTo !== null}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#27273A] text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors disabled:opacity-50"
                >
                  {sendingTo ? <Loader size={12} className="animate-spin text-purple-400" /> : <Send size={12} />}
                  {sendingTo ? 'Filing…' : 'Send to Account'}
                </button>
                <button
                  onClick={handleFlowBucket}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[#27273A] text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors"
                >
                  {flowAdded ? <Check size={12} className="text-emerald-400" /> : <Package size={12} />}
                  {flowAdded ? 'Added' : 'Flow Bucket'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-purple-500 text-white hover:from-purple-500 hover:to-purple-400 transition-all"
                >
                  <Download size={12} />
                  Download
                </button>
              </div>
            </div>

            {sendStatus && sendStatus.kind === 'success' && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-start gap-3">
                <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-emerald-300">
                    Filed to <span className="font-medium text-emerald-200">{sendStatus.accountName}</span> as <span className="font-medium text-emerald-200">"{sendStatus.assetName}"</span>
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-1">
                    {sendStatus.menuMatch ? <>Matched menu item: <span className="text-emerald-300">{sendStatus.menuMatch}</span> · </> : null}
                    {sendStatus.category && sendStatus.category !== 'Uncategorized' ? <>Category: <span className="text-zinc-400">{sendStatus.category}</span></> : null}
                    {sendStatus.tags.length > 0 ? <> · Tags: <span className="text-zinc-400">{sendStatus.tags.join(', ')}</span></> : null}
                    {' '}<span className="text-zinc-600">— edit in Accounts (Second Brain)</span>
                  </p>
                </div>
                <button onClick={() => setSendStatus(null)} className="text-zinc-500 hover:text-white shrink-0">
                  <X size={12} />
                </button>
              </div>
            )}
            {sendStatus && sendStatus.kind === 'error' && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/5 border border-red-500/20 flex items-start gap-3">
                <X size={14} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-300 flex-1">{sendStatus.message}</p>
                <button onClick={() => setSendStatus(null)} className="text-zinc-500 hover:text-white shrink-0">
                  <X size={12} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Original */}
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Original</p>
                <div className="rounded-xl overflow-hidden border border-[#27273A] bg-[#0A0A0F]">
                  <img
                    src={sourceImage!}
                    alt="Original"
                    className="w-full object-contain max-h-[400px]"
                  />
                </div>
              </div>
              {/* Clean background */}
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Clean Background &middot; {aspectRatio}</p>
                <div className="rounded-xl overflow-hidden border border-[#27273A] bg-[#0A0A0F]">
                  <img
                    src={resultImage}
                    alt="Extracted background"
                    className="w-full object-contain max-h-[400px]"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showAccountPicker && (
        <AccountPickerModal
          onPick={handleSendToAccount}
          onClose={() => setShowAccountPicker(false)}
        />
      )}
    </div>
  );
}

function AccountPickerModal({
  onPick,
  onClose,
}: {
  onPick: (account: Account) => void;
  onClose: () => void;
}) {
  const { accounts, loading } = useFirestoreAccounts();
  const [search, setSearch] = useState('');
  const filtered = accounts.filter((a) =>
    a.company?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl w-full max-w-2xl max-h-[80dvh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[#27273A]">
          <div>
            <h3 className="text-lg font-medium text-white">Send to Account</h3>
            <p className="text-xs text-zinc-500 mt-0.5">AI will auto-categorize and link it to a menu item if it matches.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#181824] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 border-b border-[#27273A]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts…"
            autoFocus
            className="w-full bg-[#12121A] border border-[#27273A] rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-sm text-zinc-600 text-center py-8">Loading accounts…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-zinc-600 text-center py-8">
              {search ? 'No accounts match that search.' : 'No accounts yet. Add one in Accounts (Second Brain).'}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filtered.map((acct) => (
                <button
                  key={acct.id}
                  onClick={() => onPick(acct)}
                  className="flex items-center gap-3 p-3 rounded-xl border border-[#27273A] hover:border-purple-500/40 hover:bg-purple-500/5 transition-colors text-left"
                >
                  <img
                    src={acct.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(acct.company || '')}&background=27273A&color=fff&size=40`}
                    alt=""
                    className="w-10 h-10 rounded-lg border border-[#27273A] object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{acct.company}</p>
                    {acct.industry && <p className="text-[10px] text-zinc-500 truncate">{acct.industry}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
