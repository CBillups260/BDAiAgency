import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  Plus,
  X,
  Users,
  Phone,
  Mail,
  Edit3,
  Trash2,
  ExternalLink,
  Briefcase,
  Calendar,
  DollarSign,
  FileText,
  Upload,
  Loader,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import {
  useFirestoreAccounts,
  useFirestoreAccount,
  useFirestoreAccountMutations,
  ACCOUNT_TYPES,
  type FirestoreAccount as Account,
  type FirestoreContact as Contact,
  type FirestoreMenuItem as MenuItem,
  type FirestoreAccountWithContacts as AccountWithContacts,
} from '../hooks/useFirestore';
import { getGhlLocationId, getGhlPrivateIntegrationToken } from '../lib/utils';

// ─── Font Picker ─────────────────────────────────────────

function registerCustomFont(family: string, dataUrl: string) {
  const style = document.createElement('style');
  style.textContent = `@font-face { font-family: '${family}'; src: url('${dataUrl}'); font-display: swap; }`;
  style.setAttribute('data-custom-font', family);
  document.head.appendChild(style);
}

function FontPicker({ value, onChange, inputCls, fontData, onFontDataChange }: {
  value: string;
  onChange: (font: string) => void;
  inputCls: string;
  fontData?: string | null;
  onFontDataChange?: (data: string | null) => void;
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<{ family: string; category: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isCustom, setIsCustom] = useState(!!fontData);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);

  // Load the selected font for preview
  useEffect(() => {
    if (!value) return;
    if (fontData) {
      // Custom font — register @font-face
      registerCustomFont(value, fontData);
    } else {
      // Google Font
      const link = document.createElement('link');
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(value)}&display=swap`;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
      return () => { document.head.removeChild(link); };
    }
  }, [value, fontData]);

  const search = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    fetch(`/api/content/fonts?q=${encodeURIComponent(q.trim())}`)
      .then(r => r.json())
      .then(data => { setResults(data.fonts || []); setOpen(true); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const selectFont = (family: string) => {
    setQuery(family);
    onChange(family);
    setIsCustom(false);
    onFontDataChange?.(null);
    setOpen(false);
    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  };

  const handleFontUpload = async (file: File) => {
    const name = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '').replace(/[_-]/g, ' ');
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      registerCustomFont(name, dataUrl);
      setQuery(name);
      onChange(name);
      onFontDataChange?.(dataUrl);
      setIsCustom(true);
      setOpen(false);
      setResults([]);
    };
    reader.readAsDataURL(file);
  };

  const clearFont = () => {
    setQuery('');
    onChange('');
    onFontDataChange?.(null);
    setIsCustom(false);
    setResults([]);
    // Remove any custom @font-face we added
    document.querySelectorAll('[data-custom-font]').forEach(el => el.remove());
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <input
          className={inputCls + ' flex-1'}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true); }}
          placeholder="Search Google Fonts..."
        />
        <label className="shrink-0 px-3 py-2 rounded-lg border border-[#27273A] bg-[#0A0A0F] text-[10px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 cursor-pointer transition-colors flex items-center gap-1.5">
          <Upload size={12} /> Upload
          <input
            ref={fontInputRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFontUpload(file);
            }}
          />
        </label>
        {value && (
          <button type="button" onClick={clearFont} className="px-2 text-zinc-500 hover:text-zinc-300">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Preview */}
      {value && (
        <div className="mt-2 p-3 bg-[#0A0A0F] border border-[#27273A] rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[10px] text-zinc-500">Preview</p>
            {isCustom && <span className="text-[8px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full">Custom Font</span>}
          </div>
          <p style={{ fontFamily: `'${value}', serif`, fontSize: 24 }} className="text-white">{value}</p>
          <p style={{ fontFamily: `'${value}', serif`, fontSize: 14 }} className="text-zinc-400 mt-1">The quick brown fox jumps over the lazy dog</p>
        </div>
      )}

      {/* Search results dropdown */}
      {open && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-[#12121A] border border-[#27273A] rounded-xl shadow-2xl">
          {results.map((font) => (
            <button
              key={font.family}
              type="button"
              onClick={() => selectFont(font.family)}
              className="w-full text-left px-3 py-2.5 hover:bg-purple-500/10 transition-colors border-b border-[#27273A] last:border-0"
            >
              <link href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family)}&text=${encodeURIComponent(font.family)}&display=swap`} rel="stylesheet" />
              <span style={{ fontFamily: `'${font.family}', ${font.category}` }} className="text-sm text-white">{font.family}</span>
              <span className="text-[9px] text-zinc-600 ml-2 capitalize">{font.category}</span>
            </button>
          ))}
        </div>
      )}
      {loading && <p className="text-[10px] text-zinc-500 mt-1">Searching fonts...</p>}
    </div>
  );
}

// ─── Business Search Modal ───────────────────────────────

interface BusinessResult {
  placeId: string;
  name: string;
  type: string;
  address: string;
  phone: string;
  website: string;
  rating: number;
  reviews: number;
  thumbnail: string;
  description: string;
}

function BusinessSearchModal({ onSelect, onClose }: {
  onSelect: (data: Partial<any>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BusinessResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setResults([]);
    try {
      const res = await fetch('/api/content/search-business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results || []);
      if (!data.results?.length) setError('No businesses found.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  };

  const selectBusiness = async (biz: BusinessResult) => {
    setLoadingDetails(biz.placeId);
    try {
      const res = await fetch('/api/content/business-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: biz.placeId }),
      });
      const details = await res.json();
      if (details.error) throw new Error(details.error);

      // Map to account fields
      onSelect({
        company: details.name || biz.name,
        industry: details.type || biz.type,
        description: details.description || biz.description || '',
        website: details.website || biz.website || '',
        avatar: details.thumbnail || biz.thumbnail || '',
        logo: details.thumbnail || biz.thumbnail || '',
        notes: [
          details.address && `Address: ${details.address}`,
          details.phone && `Phone: ${details.phone}`,
          details.rating && `Rating: ${details.rating}/5 (${details.reviewCount || biz.reviews} reviews)`,
          details.placeId && `Google Place ID: ${details.placeId}`,
        ].filter(Boolean).join('\n'),
      });
    } catch (e: any) {
      setError(e.message);
      setLoadingDetails(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#27273A]">
          <h2 className="text-sm font-semibold text-white">Add Business from Google</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Search */}
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Search for a business..."
              className="flex-1 bg-[#0A0A0F] border border-[#27273A] rounded-xl px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40"
              autoFocus
            />
            <button
              onClick={search}
              disabled={searching || !query.trim()}
              className="px-4 py-2.5 rounded-xl bg-purple-600 text-white text-sm hover:bg-purple-500 transition-colors disabled:opacity-40"
            >
              {searching ? <Loader size={14} className="animate-spin" /> : <Search size={14} />}
            </button>
          </div>

          {error && <p className="text-[11px] text-amber-400">{error}</p>}

          {/* Results */}
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {results.map((biz) => (
              <button
                key={biz.placeId}
                onClick={() => selectBusiness(biz)}
                disabled={loadingDetails === biz.placeId}
                className="w-full flex items-start gap-3 p-3 rounded-xl border border-[#27273A] hover:border-purple-500/30 hover:bg-purple-500/5 transition-all text-left disabled:opacity-60"
              >
                {biz.thumbnail && (
                  <img src={biz.thumbnail} alt="" className="w-14 h-14 rounded-lg object-cover border border-[#27273A] shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{biz.name}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{biz.type} &middot; {biz.address}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {biz.rating && <span className="text-[10px] text-amber-400">{'*'.repeat(Math.round(biz.rating))} {biz.rating}</span>}
                    {biz.reviews && <span className="text-[9px] text-zinc-600">({biz.reviews} reviews)</span>}
                  </div>
                  {biz.description && <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2">{biz.description}</p>}
                </div>
                {loadingDetails === biz.placeId && <Loader size={14} className="animate-spin text-purple-400 shrink-0 mt-1" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Logo compression (keep under Firestore 1MB limit) ───

function compressImage(file: File, maxWidth = 400, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, maxWidth / Math.max(img.width, img.height));
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png', quality));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

// ─── Color extraction from logo ──────────────────────────

function extractDominantColors(dataUrl: string, count = 5): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 100;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      // Bucket colors into groups
      const buckets = new Map<string, { r: number; g: number; b: number; count: number }>();

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        // Skip transparent / near-white / near-black pixels
        if (a < 128) continue;
        if (r > 240 && g > 240 && b > 240) continue;
        if (r < 15 && g < 15 && b < 15) continue;

        // Quantize to reduce similar colors
        const qr = Math.round(r / 32) * 32;
        const qg = Math.round(g / 32) * 32;
        const qb = Math.round(b / 32) * 32;
        const key = `${qr},${qg},${qb}`;

        const existing = buckets.get(key);
        if (existing) {
          existing.r = (existing.r * existing.count + r) / (existing.count + 1);
          existing.g = (existing.g * existing.count + g) / (existing.count + 1);
          existing.b = (existing.b * existing.count + b) / (existing.count + 1);
          existing.count++;
        } else {
          buckets.set(key, { r, g, b, count: 1 });
        }
      }

      // Sort by frequency, take top N
      const sorted = [...buckets.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, count);

      const hexColors = sorted.map(({ r, g, b }) => {
        const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
      });

      resolve(hexColors);
    };
    img.src = dataUrl;
  });
}

// ─── Sub-components ──────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    paused: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    churned: 'bg-red-500/10 text-red-400 border-red-500/20',
    prospect: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${styles[status] || styles.active}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function SocialIcon({ platform }: { platform: string }) {
  const labels: Record<string, string> = {
    instagram: 'IG', twitter: 'X', linkedin: 'in',
    tiktok: 'TT', facebook: 'FB', youtube: 'YT',
  };
  return (
    <span className="text-[9px] font-bold uppercase w-6 h-6 rounded-md bg-[#12121A] border border-[#27273A] flex items-center justify-center text-zinc-400">
      {labels[platform] || platform.charAt(0).toUpperCase()}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────

export default function AccountsCRM() {
  const { accounts, loading } = useFirestoreAccounts();
  const mutations = useFirestoreAccountMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showBusinessSearch, setShowBusinessSearch] = useState(false);
  const [prefillData, setPrefillData] = useState<Partial<any> | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showMenuItemForm, setShowMenuItemForm] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<MenuItem | null>(null);

  const { account: selectedAccount } = useFirestoreAccount(selectedId);

  const filteredAccounts = accounts.filter(
    (a) =>
      a.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.industry?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.accountType?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDeleteAccount = async (id: string) => {
    await mutations.deleteAccount(id);
    if (selectedId === id) setSelectedId(null);
  };

  const handleSaveAccount = async (data: Partial<Account>) => {
    try {
      if (editingAccount) {
        await mutations.updateAccount(editingAccount.id, data);
      } else {
        await mutations.createAccount(data);
      }
      setShowAccountForm(false);
      setEditingAccount(null);
    } catch (err: any) {
      alert('Save failed: ' + (err?.message || 'Unknown error. Logo images may be too large — try smaller files.'));
    }
  };

  const handleSaveContact = async (data: Partial<Contact>) => {
    if (!selectedId) return;
    if (editingContact) {
      await mutations.updateContact(selectedId, editingContact.id, data);
    } else {
      await mutations.createContact(selectedId, data);
    }
    setShowContactForm(false);
    setEditingContact(null);
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!selectedId) return;
    await mutations.deleteContact(selectedId, contactId);
  };

  const handleSaveMenuItem = async (data: Partial<MenuItem>) => {
    if (!selectedId) return;
    if (editingMenuItem) {
      await mutations.updateMenuItem(selectedId, editingMenuItem.id, data);
    } else {
      await mutations.createMenuItem(selectedId, data);
    }
    setShowMenuItemForm(false);
    setEditingMenuItem(null);
  };

  const handleDeleteMenuItem = async (itemId: string) => {
    if (!selectedId) return;
    await mutations.deleteMenuItem(selectedId, itemId);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 min-h-[600px]">
      {/* ── Left: Account List ───────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl p-5 shadow-lg flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Accounts</h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowBusinessSearch(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-purple-500/30 text-purple-300 text-xs font-medium hover:bg-purple-500/10 transition-colors"
              title="Search Google for a business"
            >
              <Search size={11} /> Google
            </button>
            <button
              onClick={() => { setEditingAccount(null); setPrefillData(null); setShowAccountForm(true); }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-500 transition-colors"
            >
              <Plus size={12} /> Add
            </button>
          </div>
        </div>

        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search accounts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1">
          {loading ? (
            <p className="text-sm text-zinc-500 text-center py-8">Loading...</p>
          ) : filteredAccounts.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No accounts found</p>
          ) : (
            filteredAccounts.map((acct) => (
              <button
                key={acct.id}
                onClick={() => setSelectedId(acct.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                  selectedId === acct.id
                    ? 'bg-purple-500/10 border border-purple-500/30'
                    : 'hover:bg-[#181824] border border-transparent'
                }`}
              >
                <img
                  src={acct.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(acct.company)}&background=27273A&color=fff&size=40`}
                  alt="" className="w-9 h-9 rounded-lg border border-[#27273A] object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-white truncate">{acct.company}</p>
                    {acct.accountType && acct.accountType !== 'General' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 shrink-0">
                        {acct.accountType}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-zinc-500 truncate">{acct.industry || 'No industry'}</span>
                    <StatusBadge status={acct.status} />
                  </div>
                </div>
                {acct.monthlyRetainer && (
                  <span className="text-[10px] text-zinc-500 shrink-0">{acct.monthlyRetainer}</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right: Account Detail ────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-3xl shadow-lg min-w-0 overflow-y-auto">
        {selectedAccount ? (
          <AccountDetail
            account={selectedAccount}
            onEdit={() => { setEditingAccount(selectedAccount); setShowAccountForm(true); }}
            onDelete={() => handleDeleteAccount(selectedAccount.id)}
            onAddContact={() => { setEditingContact(null); setShowContactForm(true); }}
            onEditContact={(c) => { setEditingContact(c); setShowContactForm(true); }}
            onDeleteContact={handleDeleteContact}
            onAddMenuItem={() => { setEditingMenuItem(null); setShowMenuItemForm(true); }}
            onEditMenuItem={(m) => { setEditingMenuItem(m); setShowMenuItemForm(true); }}
            onDeleteMenuItem={handleDeleteMenuItem}
            onUpdateNotes={async (notes) => {
              await mutations.updateAccount(selectedAccount.id, { notes });
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full min-h-[500px] text-center p-8">
            <div className="w-16 h-16 bg-[#0A0A0F] border border-[#27273A] rounded-2xl flex items-center justify-center mb-4">
              <Users size={28} className="text-zinc-600" />
            </div>
            <p className="text-zinc-400 text-sm mb-1">Select an account to view details</p>
            <p className="text-zinc-600 text-xs">Or add a new account to get started</p>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────── */}
      <AnimatePresence>
        {showAccountForm && (
          <AccountFormModal
            key={editingAccount?.id ?? "new-account"}
            account={editingAccount}
            prefill={prefillData}
            onSave={handleSaveAccount}
            onClose={() => { setShowAccountForm(false); setEditingAccount(null); setPrefillData(null); }}
          />
        )}
        {showBusinessSearch && (
          <BusinessSearchModal
            onSelect={(data) => {
              setShowBusinessSearch(false);
              setPrefillData(data);
              setEditingAccount(null);
              setShowAccountForm(true);
            }}
            onClose={() => setShowBusinessSearch(false)}
          />
        )}
        {showContactForm && (
          <ContactFormModal
            contact={editingContact}
            onSave={handleSaveContact}
            onClose={() => { setShowContactForm(false); setEditingContact(null); }}
          />
        )}
        {showMenuItemForm && (
          <OfferingFormModal
            item={editingMenuItem}
            config={getOfferingConfig(selectedAccount?.accountType)}
            onSave={handleSaveMenuItem}
            onClose={() => { setShowMenuItemForm(false); setEditingMenuItem(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Account Detail ──────────────────────────────────────

function AccountDetail({
  account,
  onEdit,
  onDelete,
  onAddContact,
  onEditContact,
  onDeleteContact,
  onAddMenuItem,
  onEditMenuItem,
  onDeleteMenuItem,
  onUpdateNotes,
}: {
  account: AccountWithContacts;
  onEdit: () => void;
  onDelete: () => void;
  onAddContact: () => void;
  onEditContact: (c: Contact) => void;
  onDeleteContact: (id: string) => void;
  onAddMenuItem: () => void;
  onEditMenuItem: (m: MenuItem) => void;
  onDeleteMenuItem: (id: string) => void;
  onUpdateNotes: (notes: string) => void;
}) {
  const [notesValue, setNotesValue] = useState(account.notes || '');
  const socialHandles = (account.socialHandles || {}) as Record<string, string>;
  const brandColors = (account.brandColors || []) as string[];
  const services = (account.servicesSubscribed || []) as string[];
  const ghlLoc = getGhlLocationId(account);
  const ghlTokSaved = Boolean(getGhlPrivateIntegrationToken(account));

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <img
            src={account.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(account.company)}&background=27273A&color=fff&size=56`}
            alt="" className="w-14 h-14 rounded-2xl border border-[#27273A] object-cover"
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-semibold text-white">{account.company}</h3>
              <StatusBadge status={account.status} />
            </div>
            <div className="flex items-center gap-3 mt-1">
              {account.accountType && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border bg-orange-500/10 text-orange-400 border-orange-500/20">
                  {account.accountType}
                </span>
              )}
              {account.industry && <span className="text-xs text-zinc-500">{account.industry}</span>}
              {account.website && (
                <a href={account.website} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1">
                  <ExternalLink size={10} /> Website
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors">
            <Edit3 size={15} />
          </button>
          <button onClick={onDelete} className="p-2 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Overview */}
        <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl p-5">
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Overview</h4>
          {account.description && <p className="text-sm text-zinc-300 leading-relaxed mb-4">{account.description}</p>}
          <div className="grid grid-cols-2 gap-3">
            {account.monthlyRetainer && (
              <div>
                <p className="text-[10px] text-zinc-500 mb-0.5">Monthly Retainer</p>
                <p className="text-sm font-medium text-white flex items-center gap-1"><DollarSign size={12} className="text-emerald-400" />{account.monthlyRetainer}</p>
              </div>
            )}
            {account.contractStart && (
              <div>
                <p className="text-[10px] text-zinc-500 mb-0.5">Contract</p>
                <p className="text-sm text-zinc-300 flex items-center gap-1"><Calendar size={12} className="text-zinc-500" />{account.contractStart} — {account.contractEnd || '∞'}</p>
              </div>
            )}
            {account.email && (
              <div>
                <p className="text-[10px] text-zinc-500 mb-0.5">Email</p>
                <p className="text-sm text-zinc-300 truncate">{account.email}</p>
              </div>
            )}
            {account.platform && (
              <div>
                <p className="text-[10px] text-zinc-500 mb-0.5">Preferred Channel</p>
                <p className="text-sm text-zinc-300">{account.platform}</p>
              </div>
            )}
            {(ghlLoc || ghlTokSaved) && (
              <div className="col-span-2 space-y-2">
                {ghlLoc ? (
                  <div>
                    <p className="text-[10px] text-zinc-500 mb-0.5">Go High Level — Location ID</p>
                    <p className="text-xs text-zinc-300 font-mono break-all">{ghlLoc}</p>
                  </div>
                ) : null}
                {ghlTokSaved ? (
                  <p className="text-[10px] text-emerald-400/90">GHL: location Private Integration token is saved (not shown).</p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* Brand Identity */}
        <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl p-5">
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Brand Identity</h4>
          {account.brandVoice && (
            <div className="mb-3">
              <p className="text-[10px] text-zinc-500 mb-1">Brand Voice</p>
              <p className="text-sm text-zinc-300 leading-relaxed">{account.brandVoice}</p>
            </div>
          )}
          {account.targetAudience && (
            <div className="mb-3">
              <p className="text-[10px] text-zinc-500 mb-1">Target Audience</p>
              <p className="text-sm text-zinc-300 leading-relaxed">{account.targetAudience}</p>
            </div>
          )}
          {brandColors.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] text-zinc-500 mb-1.5">Brand Colors</p>
              <div className="flex items-center gap-1.5">
                {brandColors.map((c, i) => (
                  <div key={i} className="w-7 h-7 rounded-lg border border-[#27273A]" style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
            </div>
          )}
          {/* Logos */}
          {(account.primaryLogo || account.lightLogo || account.darkLogo) && (
            <div className="mb-3">
              <p className="text-[10px] text-zinc-500 mb-1.5">Logos</p>
              <div className="flex items-center gap-2">
                {[
                  { src: account.primaryLogo, label: 'Primary', bg: 'bg-[#1a1a2e]' },
                  { src: account.lightLogo, label: 'Light', bg: 'bg-[#1a1a2e]' },
                  { src: account.darkLogo, label: 'Dark', bg: 'bg-white' },
                ].filter(l => l.src).map((l, i) => (
                  <div key={i} className="text-center">
                    <div className={`w-16 h-12 rounded-lg border border-[#27273A] ${l.bg} flex items-center justify-center p-1.5`}>
                      <img src={l.src!} alt="" className="max-h-full max-w-full object-contain" />
                    </div>
                    <p className="text-[8px] text-zinc-600 mt-0.5">{l.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Brand Font */}
          {account.brandFont && (
            <div>
              <p className="text-[10px] text-zinc-500 mb-1">Brand Font</p>
              <p className="text-sm text-zinc-300" style={{ fontFamily: `'${account.brandFont}', serif` }}>{account.brandFont}</p>
            </div>
          )}
        </div>

        {/* Social Handles */}
        {Object.keys(socialHandles).length > 0 && (
          <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl p-5">
            <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Social Handles</h4>
            <div className="space-y-2">
              {Object.entries(socialHandles).map(([platform, handle]) => (
                <div key={platform} className="flex items-center gap-2.5">
                  <SocialIcon platform={platform} />
                  <span className="text-sm text-zinc-300">{handle}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Services */}
        {services.length > 0 && (
          <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl p-5">
            <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Briefcase size={12} className="text-purple-400" /> Services
            </h4>
            <div className="flex flex-wrap gap-2">
              {services.map((s, i) => (
                <span key={i} className="text-xs px-3 py-1.5 rounded-lg bg-[#12121A] border border-[#27273A] text-zinc-300">{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Contacts */}
      <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl p-5 mt-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
            <Users size={12} className="text-purple-400" /> Contacts
          </h4>
          <button
            onClick={onAddContact}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600/20 text-purple-400 text-[11px] font-medium hover:bg-purple-600/30 transition-colors border border-purple-500/20"
          >
            <Plus size={11} /> Add Contact
          </button>
        </div>
        {account.contacts?.length > 0 ? (
          <div className="space-y-2">
            {account.contacts.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#12121A] border border-[#27273A] group">
                <img
                  src={c.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=27273A&color=fff&size=36`}
                  alt="" className="w-9 h-9 rounded-full border border-[#27273A] object-cover shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{c.name}</p>
                    {c.isPrimary && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 font-medium uppercase">Primary</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {c.title && <span className="text-[10px] text-zinc-500">{c.title}</span>}
                    {c.email && <span className="text-[10px] text-zinc-500 flex items-center gap-0.5"><Mail size={8} />{c.email}</span>}
                    {c.phone && <span className="text-[10px] text-zinc-500 flex items-center gap-0.5"><Phone size={8} />{c.phone}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onEditContact(c)} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#181824] transition-colors">
                    <Edit3 size={12} />
                  </button>
                  <button onClick={() => onDeleteContact(c.id)} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-600 text-center py-4">No contacts yet</p>
        )}
      </div>

      {/* Products, Services & Menu Items */}
      <OfferingsSection
        items={account.menuItems || []}
        config={getOfferingConfig(account.accountType)}
        onAdd={onAddMenuItem}
        onEdit={onEditMenuItem}
        onDelete={onDeleteMenuItem}
      />

      {/* Notes */}
      <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl p-5 mt-4">
        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <FileText size={12} className="text-purple-400" /> Notes
        </h4>
        <textarea
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          onBlur={() => onUpdateNotes(notesValue)}
          placeholder="Add notes about this account..."
          rows={3}
          className="w-full bg-[#12121A] border border-[#27273A] rounded-xl p-3 text-sm text-white placeholder-zinc-600 outline-none resize-none focus:border-purple-500/40 transition-colors"
        />
      </div>
    </div>
  );
}

// ─── Account Form Modal ──────────────────────────────────

function AccountFormModal({
  account,
  prefill,
  onSave,
  onClose,
}: {
  account: Account | null;
  prefill?: Partial<any> | null;
  onSave: (data: Partial<Account>) => void;
  onClose: () => void;
}) {
  const src = prefill || account || ({} as any);
  const [form, setForm] = useState({
    company: src.company || account?.company || '',
    name: src.name || account?.name || '',
    email: src.email || account?.email || '',
    industry: src.industry || account?.industry || '',
    website: src.website || account?.website || '',
    description: src.description || account?.description || '',
    brandVoice: account?.brandVoice || '',
    targetAudience: account?.targetAudience || '',
    brandColors: (account?.brandColors || []).join(', '),
    primaryLogo: src.logo || account?.primaryLogo || '',
    lightLogo: account?.lightLogo || '',
    darkLogo: account?.darkLogo || '',
    brandFont: account?.brandFont || '',
    brandFontData: account?.brandFontData || '',
    platform: account?.platform || '',
    monthlyRetainer: account?.monthlyRetainer || '',
    contractStart: account?.contractStart || '',
    contractEnd: account?.contractEnd || '',
    status: account?.status || 'active',
    accountType: account?.accountType || 'General',
    instagram: (account?.socialHandles as any)?.instagram || '',
    twitter: (account?.socialHandles as any)?.twitter || '',
    linkedin: (account?.socialHandles as any)?.linkedin || '',
    tiktok: (account?.socialHandles as any)?.tiktok || '',
    facebook: (account?.socialHandles as any)?.facebook || '',
    youtube: (account?.socialHandles as any)?.youtube || '',
    servicesSubscribed: (account?.servicesSubscribed || []).join(', '),
    ghlLocationId: account ? getGhlLocationId(account) : '',
    ghlPrivateIntegrationToken: '',
    clearGhlPrivateIntegrationToken: false,
  });

  const [suggestedColors, setSuggestedColors] = useState<string[]>([]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const hasSavedGhlToken = Boolean(account && getGhlPrivateIntegrationToken(account));

  // When primary logo changes, extract colors
  const handlePrimaryLogoUpload = async (file: File) => {
    const compressed = await compressImage(file);
    set('primaryLogo', compressed);
    const colors = await extractDominantColors(compressed);
    setSuggestedColors(colors);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const socials: Record<string, string> = {};
    if (form.instagram) socials.instagram = form.instagram;
    if (form.twitter) socials.twitter = form.twitter;
    if (form.linkedin) socials.linkedin = form.linkedin;
    if (form.tiktok) socials.tiktok = form.tiktok;
    if (form.facebook) socials.facebook = form.facebook;
    if (form.youtube) socials.youtube = form.youtube;

    onSave({
      company: form.company, name: form.name || form.company,
      email: form.email || null, industry: form.industry || null,
      website: form.website || null, description: form.description || null,
      brandVoice: form.brandVoice || null, targetAudience: form.targetAudience || null,
      brandColors: form.brandColors ? form.brandColors.split(',').map((s) => s.trim()).filter(Boolean) : null,
      primaryLogo: form.primaryLogo || null,
      lightLogo: form.lightLogo || null,
      darkLogo: form.darkLogo || null,
      brandFont: form.brandFont || null,
      brandFontData: form.brandFontData || null,
      socialHandles: Object.keys(socials).length ? socials : null,
      platform: form.platform || null,
      monthlyRetainer: form.monthlyRetainer || null,
      contractStart: form.contractStart || null, contractEnd: form.contractEnd || null,
      status: form.status,
      accountType: form.accountType || null,
      servicesSubscribed: form.servicesSubscribed ? form.servicesSubscribed.split(',').map((s) => s.trim()).filter(Boolean) : null,
      ghlLocationId: form.ghlLocationId.trim() || null,
      ...(form.clearGhlPrivateIntegrationToken
        ? { ghlPrivateIntegrationToken: null }
        : form.ghlPrivateIntegrationToken.trim()
          ? { ghlPrivateIntegrationToken: form.ghlPrivateIntegrationToken.trim() }
          : {}),
      ...(prefill?.avatar && !account ? { avatar: prefill.avatar } : {}),
      ...(prefill?.notes && !account ? { notes: prefill.notes } : {}),
    } as any);
  };

  const inputCls = "w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors";
  const labelCls = "text-[11px] text-zinc-500 mb-1 block";

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-[5vh] overflow-y-auto">
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20 }} className="bg-[#12121A] border border-[#27273A] rounded-3xl shadow-2xl w-full max-w-2xl mx-4 mb-8">
        <div className="flex items-center justify-between p-6 border-b border-[#27273A]">
          <h3 className="text-lg font-medium text-white">{account ? 'Edit Account' : 'New Account'}</h3>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Company / Brand Name *</label><input className={inputCls} value={form.company} onChange={(e) => set('company', e.target.value)} required /></div>
            <div><label className={labelCls}>Contact Name</label><input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><label className={labelCls}>Email</label><input type="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div><label className={labelCls}>Industry</label><input className={inputCls} value={form.industry} onChange={(e) => set('industry', e.target.value)} placeholder="e.g. SaaS & Technology" /></div>
            <div><label className={labelCls}>Website</label><input className={inputCls} value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" /></div>
            <div>
              <label className={labelCls}>Account Type</label>
              <select className={inputCls} value={form.accountType} onChange={(e) => set('accountType', e.target.value)}>
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Preferred Channel</label><input className={inputCls} value={form.platform} onChange={(e) => set('platform', e.target.value)} placeholder="Slack, Email..." /></div>
          </div>
          <div className="border border-[#27273A] rounded-xl p-4 bg-[#0A0A0F]">
            <p className="text-[11px] text-zinc-500 mb-2 uppercase tracking-wider">Go High Level</p>
            <div>
              <label className={labelCls}>Location ID (sub-account)</label>
              <input
                className={inputCls + ' font-mono text-xs'}
                value={form.ghlLocationId}
                onChange={(e) => set('ghlLocationId', e.target.value)}
                placeholder="Paste from HighLevel → Settings → Business Profile"
                autoComplete="off"
              />
              <p className="text-[10px] text-zinc-600 mt-1.5">
                Used for Content → AI Scheduler. Only clients with this field set appear in that list.
              </p>
            </div>
            <div className="mt-4">
              <label className={labelCls}>Location Private Integration token (optional)</label>
              <input
                type="password"
                className={inputCls + ' font-mono text-xs'}
                value={form.ghlPrivateIntegrationToken}
                onChange={(e) => set('ghlPrivateIntegrationToken', e.target.value)}
                placeholder="From sub-account → Settings → Private Integrations"
                autoComplete="off"
              />
              <p className="text-[10px] text-zinc-600 mt-1.5">
                Sub-account token with Social Planner scopes. Leave blank to keep the current stored token, or rely on server{" "}
                <code className="text-zinc-500">GHL_LOCATION_TOKENS</code> / <code className="text-zinc-500">GHL_PRIVATE_INTEGRATION_TOKEN</code>.
              </p>
              {hasSavedGhlToken && !form.ghlPrivateIntegrationToken.trim() ? (
                <p className="text-[10px] text-emerald-500/90 mt-1">A token is already saved for this client; paste a new one only to replace it.</p>
              ) : null}
              <label className="flex items-center gap-2 mt-2 text-[11px] text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.clearGhlPrivateIntegrationToken}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, clearGhlPrivateIntegrationToken: e.target.checked }))
                  }
                  className="rounded border-[#27273A] bg-[#0A0A0F]"
                />
                Remove stored location token
              </label>
            </div>
          </div>
          <div><label className={labelCls}>Description</label><textarea className={inputCls + ' resize-none'} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Brief overview of the brand..." /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className={labelCls}>Brand Voice</label><textarea className={inputCls + ' resize-none'} rows={2} value={form.brandVoice} onChange={(e) => set('brandVoice', e.target.value)} placeholder="Tone, style, personality..." /></div>
            <div><label className={labelCls}>Target Audience</label><textarea className={inputCls + ' resize-none'} rows={2} value={form.targetAudience} onChange={(e) => set('targetAudience', e.target.value)} placeholder="Who are they trying to reach?" /></div>
          </div>
          {/* Logo uploads + Brand Colors side-by-side */}
          <div className="border-t border-[#27273A] pt-4">
            <p className="text-xs text-zinc-400 mb-3 uppercase tracking-wider">Brand Logos</p>
            <div className="grid grid-cols-3 gap-3">
              {([['primaryLogo', 'Primary Logo'], ['lightLogo', 'Light Logo'], ['darkLogo', 'Dark Logo']] as const).map(([key, label]) => (
                <div key={key}>
                  <label className={labelCls}>{label}</label>
                  {(form as any)[key] ? (
                    <div className="relative group">
                      <div className={`w-full h-20 rounded-lg border border-[#27273A] flex items-center justify-center p-2 ${key === 'darkLogo' ? 'bg-white' : 'bg-[#0A0A0F]'}`}>
                        <img src={(form as any)[key]} alt="" className="max-h-full max-w-full object-contain" />
                      </div>
                      <button
                        type="button"
                        onClick={() => { set(key, ''); if (key === 'primaryLogo') setSuggestedColors([]); }}
                        className="absolute top-1 right-1 p-1 rounded bg-black/70 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <label className="w-full h-20 rounded-lg border-2 border-dashed border-[#27273A] flex flex-col items-center justify-center cursor-pointer hover:border-zinc-600 transition-colors bg-[#0A0A0F]">
                      <span className="text-zinc-500 text-lg">+</span>
                      <span className="text-[9px] text-zinc-600">Upload</span>
                      <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (key === 'primaryLogo') {
                          await handlePrimaryLogoUpload(file);
                        } else {
                          const compressed = await compressImage(file);
                          set(key, compressed);
                        }
                      }} />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Brand Colors — Color Picker with Logo Side-by-Side */}
          <div className="border-t border-[#27273A] pt-4">
            <p className="text-xs text-zinc-400 mb-3 uppercase tracking-wider">Brand Colors</p>
            <div className="flex gap-4">
              {/* Logo reference (for sampling colors visually) */}
              {form.primaryLogo && (
                <div className="shrink-0">
                  <p className="text-[9px] text-zinc-600 mb-1">Logo reference</p>
                  <div className="w-28 h-28 rounded-xl border border-[#27273A] bg-[#0A0A0F] flex items-center justify-center p-2">
                    <img src={form.primaryLogo} alt="" className="max-h-full max-w-full object-contain" />
                  </div>
                </div>
              )}

              {/* Color swatches + pickers */}
              <div className="flex-1 space-y-3">
                {/* Current colors as interactive swatches */}
                <div className="flex flex-wrap items-center gap-2">
                  {(form.brandColors ? form.brandColors.split(',').map(s => s.trim()).filter(Boolean) : []).map((color, i, arr) => (
                    <div key={i} className="group/color flex flex-col items-center gap-1">
                      <div className="relative">
                        <label className="cursor-pointer block">
                          <div
                            className="w-10 h-10 rounded-xl border-2 border-[#27273A] group-hover/color:border-purple-500 transition-colors shadow-lg"
                            style={{ backgroundColor: color }}
                          />
                          <input
                            type="color"
                            value={color.startsWith('#') ? color : '#000000'}
                            onChange={(e) => {
                              const updated = [...arr];
                              updated[i] = e.target.value;
                              set('brandColors', updated.join(', '));
                            }}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = arr.filter((_, j) => j !== i);
                            set('brandColors', updated.join(', '));
                          }}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center opacity-0 group-hover/color:opacity-100 transition-opacity"
                        >
                          &times;
                        </button>
                      </div>
                      <span className="text-[8px] text-zinc-500 font-mono">{color}</span>
                    </div>
                  ))}

                  {/* Add color button */}
                  <label className="cursor-pointer flex flex-col items-center gap-1">
                    <div className="relative w-10 h-10 rounded-xl border-2 border-dashed border-[#27273A] hover:border-purple-500/50 flex items-center justify-center transition-colors">
                      <span className="text-zinc-500 text-lg">+</span>
                      <input
                        type="color"
                        value="#6B21A8"
                        onChange={(e) => {
                          const current = form.brandColors ? form.brandColors.split(',').map(s => s.trim()).filter(Boolean) : [];
                          set('brandColors', [...current, e.target.value].join(', '));
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                    <span className="text-[8px] text-zinc-600">Add</span>
                  </label>
                </div>

                {/* Manual hex input */}
                <input
                  className={inputCls}
                  value={form.brandColors}
                  onChange={(e) => set('brandColors', e.target.value)}
                  placeholder="#1A1A2E, #C9A96E, #FFFFFF"
                />
              </div>
            </div>
          </div>

          {/* Suggested brand colors from logo */}
          {suggestedColors.length > 0 && (
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3">
              <p className="text-[10px] text-purple-300 mb-2 font-medium">Colors detected from logo — click to add</p>
              <div className="flex items-center gap-2">
                {suggestedColors.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      const current = form.brandColors ? form.brandColors.split(',').map(s => s.trim()).filter(Boolean) : [];
                      if (!current.includes(c)) {
                        set('brandColors', [...current, c].join(', '));
                      }
                    }}
                    className="group/swatch flex flex-col items-center gap-1"
                  >
                    <div className="w-9 h-9 rounded-lg border-2 border-[#27273A] group-hover/swatch:border-purple-500 transition-colors" style={{ backgroundColor: c }} />
                    <span className="text-[8px] text-zinc-500 font-mono">{c}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => set('brandColors', suggestedColors.join(', '))}
                  className="ml-2 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 transition-colors"
                >
                  Use all
                </button>
              </div>
            </div>
          )}

          {/* Brand Font */}
          <div className="border-t border-[#27273A] pt-4">
            <p className="text-xs text-zinc-400 mb-3 uppercase tracking-wider">Brand Font</p>
            <FontPicker
              value={form.brandFont}
              onChange={(font) => set('brandFont', font)}
              inputCls={inputCls}
              fontData={form.brandFontData || null}
              onFontDataChange={(data) => set('brandFontData', data || '')}
            />
          </div>

          <div className="border-t border-[#27273A] pt-4">
            <p className="text-xs text-zinc-400 mb-3 uppercase tracking-wider">Social Handles</p>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={labelCls}>Instagram</label><input className={inputCls} value={form.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="@handle" /></div>
              <div><label className={labelCls}>Twitter / X</label><input className={inputCls} value={form.twitter} onChange={(e) => set('twitter', e.target.value)} placeholder="@handle" /></div>
              <div><label className={labelCls}>LinkedIn</label><input className={inputCls} value={form.linkedin} onChange={(e) => set('linkedin', e.target.value)} placeholder="company-slug" /></div>
              <div><label className={labelCls}>TikTok</label><input className={inputCls} value={form.tiktok} onChange={(e) => set('tiktok', e.target.value)} placeholder="@handle" /></div>
              <div><label className={labelCls}>Facebook</label><input className={inputCls} value={form.facebook} onChange={(e) => set('facebook', e.target.value)} placeholder="PageName" /></div>
              <div><label className={labelCls}>YouTube</label><input className={inputCls} value={form.youtube} onChange={(e) => set('youtube', e.target.value)} placeholder="@channel" /></div>
            </div>
          </div>

          <div className="border-t border-[#27273A] pt-4">
            <p className="text-xs text-zinc-400 mb-3 uppercase tracking-wider">Contract</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div><label className={labelCls}>Retainer</label><input className={inputCls} value={form.monthlyRetainer} onChange={(e) => set('monthlyRetainer', e.target.value)} placeholder="$5,000" /></div>
              <div><label className={labelCls}>Start</label><input type="date" className={inputCls} value={form.contractStart} onChange={(e) => set('contractStart', e.target.value)} /></div>
              <div><label className={labelCls}>End</label><input type="date" className={inputCls} value={form.contractEnd} onChange={(e) => set('contractEnd', e.target.value)} /></div>
              <div>
                <label className={labelCls}>Status</label>
                <select className={inputCls} value={form.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="churned">Churned</option>
                  <option value="prospect">Prospect</option>
                </select>
              </div>
            </div>
          </div>

          <div><label className={labelCls}>Services (comma-separated)</label><input className={inputCls} value={form.servicesSubscribed} onChange={(e) => set('servicesSubscribed', e.target.value)} placeholder="Social Media Management, SEO & Content Marketing" /></div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#27273A] text-sm text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors">Cancel</button>
            <button type="submit" className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              {account ? 'Save Changes' : 'Create Account'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── Products & Services / Menu Items Section ───────────

type OfferingConfig = {
  sectionTitle: string;
  icon: string;
  addLabel: string;
  emptyTitle: string;
  emptySubtitle: string;
  formTitle: string;
  nameLabel: string;
  namePlaceholder: string;
  descPlaceholder: string;
  pricePlaceholder: string;
  availableLabel: string;
  categories: readonly string[];
  defaultCategory: string;
};

const OFFERING_CONFIGS: Record<string, OfferingConfig> = {
  Restaurant: {
    sectionTitle: 'Menu Items',
    icon: '🍽',
    addLabel: 'Add Item',
    emptyTitle: 'No menu items yet',
    emptySubtitle: "Add items to build this restaurant's menu",
    formTitle: 'Menu Item',
    nameLabel: 'Item Name',
    namePlaceholder: 'e.g. Chicken Parmigiana',
    descPlaceholder: 'Brief description of the dish...',
    pricePlaceholder: '$14.99',
    availableLabel: 'Currently available',
    categories: ['Appetizers', 'Salads', 'Pasta', 'Pizza', 'Entrees', 'Seafood', 'Sides', 'Desserts', 'Beverages', 'Wine & Cocktails', 'Kids Menu', 'Specials'],
    defaultCategory: 'Entrees',
  },
  'Professional Services': {
    sectionTitle: 'Services Offered',
    icon: '🔧',
    addLabel: 'Add Service',
    emptyTitle: 'No services listed yet',
    emptySubtitle: "Add this company's services and capabilities",
    formTitle: 'Service',
    nameLabel: 'Service Name',
    namePlaceholder: 'e.g. 24-Hour Emergency Towing',
    descPlaceholder: 'Describe the service...',
    pricePlaceholder: '$150/call',
    availableLabel: 'Currently offered',
    categories: ['Core Services', 'Emergency Services', 'Maintenance', 'Consulting', 'Support', 'Specialty', 'Add-Ons', 'Fleet Services'],
    defaultCategory: 'Core Services',
  },
  SaaS: {
    sectionTitle: 'Products & Plans',
    icon: '💻',
    addLabel: 'Add Product',
    emptyTitle: 'No products listed yet',
    emptySubtitle: "Add this company's software products and pricing plans",
    formTitle: 'Product',
    nameLabel: 'Product / Plan Name',
    namePlaceholder: 'e.g. Enterprise Plan',
    descPlaceholder: 'Describe the product or plan...',
    pricePlaceholder: '$99/mo',
    availableLabel: 'Currently available',
    categories: ['Products', 'Starter Plans', 'Growth Plans', 'Enterprise Plans', 'Add-Ons', 'Integrations', 'Professional Services'],
    defaultCategory: 'Products',
  },
  'E-commerce': {
    sectionTitle: 'Product Catalog',
    icon: '🛍',
    addLabel: 'Add Product',
    emptyTitle: 'No products listed yet',
    emptySubtitle: "Add this brand's products and collections",
    formTitle: 'Product',
    nameLabel: 'Product Name',
    namePlaceholder: 'e.g. Trail Runner Pro Jacket',
    descPlaceholder: 'Describe the product...',
    pricePlaceholder: '$89.99',
    availableLabel: 'In stock',
    categories: ['Apparel', 'Accessories', 'Footwear', 'Equipment', 'Bundles', 'Gift Cards', 'Limited Edition', 'Bestsellers', 'New Arrivals', 'Sale'],
    defaultCategory: 'Bestsellers',
  },
  Agency: {
    sectionTitle: 'Service Offerings',
    icon: '📋',
    addLabel: 'Add Service',
    emptyTitle: 'No services listed yet',
    emptySubtitle: "Add this agency's service offerings",
    formTitle: 'Service',
    nameLabel: 'Service Name',
    namePlaceholder: 'e.g. Brand Strategy & Identity',
    descPlaceholder: 'Describe the service offering...',
    pricePlaceholder: '$5,000/mo',
    availableLabel: 'Currently offered',
    categories: ['Strategy', 'Creative', 'Digital', 'Media', 'Analytics', 'Production', 'Retainer Packages', 'Project-Based'],
    defaultCategory: 'Strategy',
  },
  Healthcare: {
    sectionTitle: 'Services & Products',
    icon: '🏥',
    addLabel: 'Add Service',
    emptyTitle: 'No services listed yet',
    emptySubtitle: "Add this organization's services and products",
    formTitle: 'Service / Product',
    nameLabel: 'Name',
    namePlaceholder: 'e.g. Rapid Diagnostic Test Kit',
    descPlaceholder: 'Describe the service or product...',
    pricePlaceholder: '$29.99',
    availableLabel: 'Currently available',
    categories: ['Diagnostics', 'Treatments', 'Devices', 'Wellness', 'Consulting', 'Research', 'Consumer Products'],
    defaultCategory: 'Diagnostics',
  },
  'Real Estate': {
    sectionTitle: 'Listings & Services',
    icon: '🏢',
    addLabel: 'Add Listing',
    emptyTitle: 'No listings or services yet',
    emptySubtitle: "Add property listings or services offered",
    formTitle: 'Listing / Service',
    nameLabel: 'Name',
    namePlaceholder: 'e.g. Waterfront Luxury Condo',
    descPlaceholder: 'Describe the listing or service...',
    pricePlaceholder: '$1,200,000',
    availableLabel: 'Currently active',
    categories: ['Residential', 'Commercial', 'Luxury', 'Rentals', 'Land', 'Property Management', 'Consulting'],
    defaultCategory: 'Residential',
  },
  'Media & Entertainment': {
    sectionTitle: 'Content & Services',
    icon: '🎬',
    addLabel: 'Add Offering',
    emptyTitle: 'No content or services yet',
    emptySubtitle: "Add media offerings, shows, or services",
    formTitle: 'Offering',
    nameLabel: 'Name',
    namePlaceholder: 'e.g. Branded Short-Form Video Package',
    descPlaceholder: 'Describe the content or service...',
    pricePlaceholder: '$3,500/video',
    availableLabel: 'Currently offered',
    categories: ['Video Production', 'Podcasts', 'Newsletters', 'Campaigns', 'Influencer', 'Events', 'Sponsorship Packages'],
    defaultCategory: 'Video Production',
  },
};

const DEFAULT_OFFERING_CONFIG: OfferingConfig = {
  sectionTitle: 'Products & Services',
  icon: '📦',
  addLabel: 'Add Item',
  emptyTitle: 'No products or services yet',
  emptySubtitle: "Add this company's products and services",
  formTitle: 'Product / Service',
  nameLabel: 'Name',
  namePlaceholder: 'e.g. Premium Consulting Package',
  descPlaceholder: 'Describe the product or service...',
  pricePlaceholder: '$500',
  availableLabel: 'Currently available',
  categories: ['Products', 'Services', 'Packages', 'Add-Ons', 'Subscriptions', 'Custom'],
  defaultCategory: 'Services',
};

function getOfferingConfig(accountType: string | null | undefined): OfferingConfig {
  return OFFERING_CONFIGS[accountType || ''] || DEFAULT_OFFERING_CONFIG;
}

function OfferingsSection({
  items,
  config,
  onAdd,
  onEdit,
  onDelete,
}: {
  items: MenuItem[];
  config: OfferingConfig;
  onAdd: () => void;
  onEdit: (m: MenuItem) => void;
  onDelete: (id: string) => void;
}) {
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const categories = Array.from(new Set(items.map((i) => i.category))).sort();
  const filtered = filterCategory === 'all' ? items : items.filter((i) => i.category === filterCategory);
  const grouped = filtered.reduce<Record<string, MenuItem[]>>((acc, item) => {
    const cat = item.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const sortedCategories = Object.keys(grouped).sort();

  return (
    <div className="bg-[#0A0A0F] border border-[#27273A] rounded-2xl p-5 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
          <span className="text-purple-400 text-sm">{config.icon}</span> {config.sectionTitle}
          <span className="text-[10px] text-zinc-600 ml-1">({items.length})</span>
        </h4>
        <div className="flex items-center gap-2">
          {categories.length > 1 && (
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="text-[11px] bg-[#12121A] border border-[#27273A] rounded-lg px-2 py-1.5 text-zinc-400 outline-none focus:border-purple-500/40"
            >
              <option value="all">All Categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button
            onClick={onAdd}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600/20 text-purple-400 text-[11px] font-medium hover:bg-purple-600/30 transition-colors border border-purple-500/20"
          >
            <Plus size={11} /> {config.addLabel}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-zinc-600 mb-1">{config.emptyTitle}</p>
          <p className="text-xs text-zinc-700">{config.emptySubtitle}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {sortedCategories.map((category) => (
            <div key={category}>
              <h5 className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-2 border-b border-[#27273A] pb-1.5">
                {category}
              </h5>
              <div className="space-y-1.5">
                {grouped[category].map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#12121A] border border-[#27273A] group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{item.name}</p>
                        {!item.available && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium uppercase">Unavailable</span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{item.description}</p>
                      )}
                    </div>
                    {item.price && (
                      <span className="text-sm font-medium text-emerald-400 shrink-0">{item.price}</span>
                    )}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => onEdit(item)} className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#181824] transition-colors">
                        <Edit3 size={12} />
                      </button>
                      <button onClick={() => onDelete(item.id)} className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Offering Form Modal (Menu Item / Product / Service) ─

function OfferingFormModal({
  item,
  config,
  onSave,
  onClose,
}: {
  item: MenuItem | null;
  config: OfferingConfig;
  onSave: (data: Partial<MenuItem>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: item?.name || '',
    description: item?.description || '',
    price: item?.price || '',
    category: item?.category || config.defaultCategory,
    available: item?.available ?? true,
  });

  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));
  const inputCls = "w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors";
  const labelCls = "text-[11px] text-zinc-500 mb-1 block";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: form.name,
      description: form.description || null,
      price: form.price || null,
      category: form.category,
      available: form.available,
    });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20 }} className="bg-[#12121A] border border-[#27273A] rounded-3xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-[#27273A]">
          <h3 className="text-lg font-medium text-white">{item ? `Edit ${config.formTitle}` : `New ${config.formTitle}`}</h3>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div><label className={labelCls}>{config.nameLabel} *</label><input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder={config.namePlaceholder} /></div>
          <div><label className={labelCls}>Description</label><textarea className={inputCls + ' resize-none'} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder={config.descPlaceholder} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Price</label><input className={inputCls} value={form.price} onChange={(e) => set('price', e.target.value)} placeholder={config.pricePlaceholder} /></div>
            <div>
              <label className={labelCls}>Category</label>
              <select className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)}>
                {config.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.available} onChange={(e) => set('available', e.target.checked)} className="accent-purple-500" />
            <span className="text-sm text-zinc-300">{config.availableLabel}</span>
          </label>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#27273A] text-sm text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors">Cancel</button>
            <button type="submit" className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              {item ? 'Save' : config.addLabel}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── Contact Form Modal ──────────────────────────────────

function ContactFormModal({
  contact,
  onSave,
  onClose,
}: {
  contact: Contact | null;
  onSave: (data: Partial<Contact>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: contact?.name || '',
    title: contact?.title || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    isPrimary: contact?.isPrimary || false,
  });

  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));
  const inputCls = "w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors";
  const labelCls = "text-[11px] text-zinc-500 mb-1 block";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: form.name,
      title: form.title || null,
      email: form.email || null,
      phone: form.phone || null,
      isPrimary: form.isPrimary,
    });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20 }} className="bg-[#12121A] border border-[#27273A] rounded-3xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-[#27273A]">
          <h3 className="text-lg font-medium text-white">{contact ? 'Edit Contact' : 'New Contact'}</h3>
          <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div><label className={labelCls}>Name *</label><input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} required /></div>
          <div><label className={labelCls}>Title / Role</label><input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. VP of Marketing" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Email</label><input type="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div><label className={labelCls}>Phone</label><input className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.isPrimary} onChange={(e) => set('isPrimary', e.target.checked)} className="accent-purple-500" />
            <span className="text-sm text-zinc-300">Primary contact</span>
          </label>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#27273A] text-sm text-zinc-400 hover:text-white hover:bg-[#181824] transition-colors">Cancel</button>
            <button type="submit" className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              {contact ? 'Save' : 'Add Contact'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
