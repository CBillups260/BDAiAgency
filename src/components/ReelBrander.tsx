import React, { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { authedFetch } from '../lib/api';
import { useFirestoreAccounts, useFirestoreAccount } from '../hooks/useFirestore';
import { usePersistedState } from '../hooks/usePersistedState';
import { fetchAsDataUrl } from '../lib/logoComposite';
import { Loader, Film, Image as ImageIcon } from '@geist-ui/icons';

interface Props {
  /** Remote thumbnail of the reel (preview background). */
  thumbnailUrl: string | null;
  /** Direct CDN video URL to brand (the recommended download). */
  downloadUrl: string | null;
  /** Base filename for the branded export, e.g. "tiktok-zachking". */
  defaultName: string;
  /** Reel aspect ratio (width / height). Defaults to portrait 9:16. */
  aspect?: number;
}

type Align = 'left' | 'right';
type LogoSize = 'S' | 'M' | 'L';

const LOGO_PX: Record<LogoSize, number> = { S: 44, M: 60, L: 80 };

// Preview canvas fits within this box while preserving the reel's aspect ratio,
// then exported at 3× → the overlay PNG the server burns in. A 9:16 reel lands
// on the original 360×640 (→ 1080×1920) canvas; other ratios size accordingly.
const PREVIEW_MAX_W = 360;
const PREVIEW_MAX_H = 640;
const EXPORT_SCALE = 3;
const DEFAULT_ASPECT = 9 / 16;

/** Largest box with the given aspect (w/h) that fits inside maxW×maxH. */
function fitBox(aspect: number, maxW: number, maxH: number): { w: number; h: number } {
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

/** Reduce w:h to a tidy label ("9:16", "16:9", "1:1"). */
function ratioLabel(aspect: number): string {
  const common: [number, number][] = [
    [9, 16], [16, 9], [1, 1], [4, 5], [5, 4], [3, 4], [4, 3], [2, 3], [3, 2],
  ];
  for (const [a, b] of common) {
    if (Math.abs(aspect - a / b) < 0.03) return `${a}:${b}`;
  }
  return aspect >= 1 ? 'landscape' : 'portrait';
}

const TEXT_SHADOW = '0 1px 5px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.6)';

/** Pull "Address: ..." / "Phone: ..." lines out of an account's description. */
function parseField(desc: string | null | undefined, label: string): string {
  const m = (desc || '').match(new RegExp(`${label}\\s*:\\s*(.+)`, 'i'));
  return m ? m[1].split('\n')[0].trim() : '';
}

/** Break an address into tidy lines: street on line 1, city/state/zip on line 2. */
function formatAddress(addr: string): string[] {
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return [addr.trim()];
  return [parts[0], parts.slice(1).join(', ')];
}

export default function ReelBrander({ thumbnailUrl, downloadUrl, defaultName, aspect }: Props) {
  const { w: cardW, h: cardH } = fitBox(aspect || DEFAULT_ASPECT, PREVIEW_MAX_W, PREVIEW_MAX_H);
  const { accounts } = useFirestoreAccounts();
  const [accountId, setAccountId] = usePersistedState<string | null>('reel.brand.accountId', null);
  const { account } = useFirestoreAccount(accountId);

  const [headline, setHeadline] = usePersistedState<string>('reel.brand.headline', '');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [showLogo, setShowLogo] = useState(true);
  const [logoSize, setLogoSize] = usePersistedState<LogoSize>('reel.brand.logoSize', 'M');
  const [align, setAlign] = usePersistedState<Align>('reel.brand.align', 'left');

  const [bg, setBg] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);

  // Load the reel frame as a data URL (same-origin proxy) for the preview.
  useEffect(() => {
    let cancelled = false;
    if (!thumbnailUrl) return;
    fetchAsDataUrl(thumbnailUrl)
      .then((d) => !cancelled && setBg(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [thumbnailUrl]);

  // Pre-fill from the selected account (fields stay editable).
  useEffect(() => {
    if (!account) return;
    const primary = account.contacts?.find((c) => c.isPrimary) || account.contacts?.[0];
    setPhone(account.phone || primary?.phone || parseField(account.description, 'Phone') || '');
    setAddress(account.address || parseField(account.description, 'Address') || primary?.notes || '');
  }, [account]);

  const logoSrc = account?.lightLogo || account?.primaryLogo || account?.logo || account?.darkLogo || null;

  /** The bare, container-less brand stack — shared by preview and export. */
  const Strip = () => (
    <div
      style={{
        position: 'absolute',
        bottom: 24,
        left: align === 'left' ? 18 : undefined,
        right: align === 'right' ? 18 : undefined,
        maxWidth: '82%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: align === 'left' ? 'flex-start' : 'flex-end',
        textAlign: align,
        gap: 4,
      }}
    >
      {showLogo && logoSrc && (
        <img
          src={logoSrc}
          alt=""
          style={{
            height: LOGO_PX[logoSize],
            maxWidth: '100%',
            objectFit: 'contain',
            display: 'block',
            marginBottom: 4,
            filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.55))',
          }}
        />
      )}
      {phone && (
        <div style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1.15, textShadow: TEXT_SHADOW }}>
          {phone}
        </div>
      )}
      {address && (
        <div
          style={{
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            lineHeight: 1.3,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            textShadow: TEXT_SHADOW,
          }}
        >
          {formatAddress(address).map((ln, i) => (
            <div key={i}>{ln}</div>
          ))}
        </div>
      )}
      {headline.trim() && (
        <div style={{ color: '#fff', fontSize: 10.5, fontWeight: 500, lineHeight: 1.25, marginTop: 1, textShadow: TEXT_SHADOW }}>
          {headline.trim()}
        </div>
      )}
    </div>
  );

  const createVideo = async () => {
    if (!previewRef.current || !downloadUrl) return;
    setRendering(true);
    setErr(null);
    try {
      // Capture the visible preview with its video background hidden → a
      // transparent overlay PNG (sized to the reel's aspect ratio) containing
      // just the brand stack. The server scales the video to these same dims.
      setCapturing(true);
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      let overlayBase64: string;
      try {
        overlayBase64 = await toPng(previewRef.current, { pixelRatio: EXPORT_SCALE, cacheBust: true });
      } finally {
        setCapturing(false);
      }
      const fname = `${defaultName}-branded`.replace(/[^a-z0-9._-]/gi, '-').toLowerCase() + '.mp4';

      const res = await authedFetch('/api/social/brand-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: downloadUrl,
          overlayBase64,
          filename: fname,
          overlayWidth: Math.round(cardW * EXPORT_SCALE),
          overlayHeight: Math.round(cardH * EXPORT_SCALE),
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(e.error || 'Branding failed');
      }
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(u);
    } catch (e: any) {
      setErr(e?.message || 'Failed to brand the video');
    } finally {
      setRendering(false);
    }
  };

  const inputCls =
    'w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors';
  const segBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs border transition-all ${
      active ? 'border-purple-500/40 bg-purple-500/10 text-purple-300' : 'border-[#27273A] bg-[#0A0A0F] text-zinc-400 hover:border-zinc-600'
    }`;

  return (
    <div className="mt-4 border-t border-[#27273A] pt-5">
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        {/* ── Live preview (also the capture source) ─────── */}
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl overflow-hidden shadow-xl border border-[#27273A]">
            <div
              ref={previewRef}
              style={{
                width: cardW,
                height: cardH,
                backgroundColor: capturing ? 'transparent' : '#000',
                backgroundImage: !capturing && bg ? `url(${bg})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                position: 'relative',
              }}
            >
              {!bg && !capturing && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
                  <ImageIcon size={30} strokeWidth={1} />
                </div>
              )}
              <Strip />
            </div>
          </div>
          <p className="text-[10px] text-zinc-600">Burned into the video · audio kept · {ratioLabel(aspect || DEFAULT_ASPECT)}</p>
        </div>

        {/* ── Controls ───────────────────────────────────── */}
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Pull branding from (Brain)</label>
            <select value={accountId || ''} onChange={(e) => setAccountId(e.target.value || null)} className={inputCls}>
              <option value="">Select an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.company || a.name}
                </option>
              ))}
            </select>
            {accountId && !logoSrc && (
              <p className="text-[10px] text-amber-400/80 mt-1">No logo on this account — add one in Accounts, or it'll be skipped.</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Phone</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(260) 833-1717" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="4340 W Orland Road, Angola, IN 46703" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Short text (optional)</label>
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Shop MasterCraft at The Marina" className={inputCls} />
            </div>
          </div>
          <p className="text-[10px] text-zinc-600 -mt-1">Pre-filled from the account — edit anything. Leave a field blank to hide it.</p>

          {/* Logo + alignment */}
          <div className="flex items-end gap-6 flex-wrap">
            <div>
              <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Logo</label>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowLogo((v) => !v)} className={segBtn(showLogo)}>{showLogo ? 'On' : 'Off'}</button>
                {(['S', 'M', 'L'] as LogoSize[]).map((s) => (
                  <button key={s} onClick={() => setLogoSize(s)} disabled={!showLogo} className={segBtn(logoSize === s) + ' disabled:opacity-30'}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">Align</label>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setAlign('left')} className={segBtn(align === 'left')}>Left</button>
                <button onClick={() => setAlign('right')} className={segBtn(align === 'right')}>Right</button>
              </div>
            </div>
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}

          <div className="pt-1">
            <button
              onClick={createVideo}
              disabled={!downloadUrl || rendering}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-sm text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {rendering ? <Loader size={15} className="animate-spin" /> : <Film size={15} />}
              {rendering ? 'Branding your video…' : 'Create branded video'}
            </button>
            {rendering && <p className="text-[11px] text-zinc-500 mt-2">Downloading, overlaying your branding, and re-encoding — takes a few seconds.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
