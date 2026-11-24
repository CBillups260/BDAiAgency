import { authedFetch } from '../lib/api';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload,
  X,
  Download,
  Loader,
  RefreshCw,
  Check,
  Maximize,
  Film,
  Link as LinkIcon,
  AlertTriangle,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import { usePersistedState } from '../hooks/usePersistedState';

/**
 * Upscale + frame-rate tool, running Topaz video models on Fal.
 *
 * Fal pulls the source itself, so a local file is uploaded to the public-read
 * Firebase Storage prefix first (the same one GHL fetches scheduler media
 * from) and only its download URL goes to the API. Jobs are queued and polled
 * rather than awaited — minutes of Topaz runtime outlast any HTTP request.
 */

// Mirrors UPSCALE_MODELS in functions/src/lib/falVideo.ts.
const UPSCALE_MODELS = [
  { id: 'Proteus', label: 'Proteus', sub: 'General purpose — the right default for most footage' },
  { id: 'Artemis HQ', label: 'Artemis HQ', sub: 'Clean source, light compression' },
  { id: 'Artemis MQ', label: 'Artemis MQ', sub: 'Typical social/web video' },
  { id: 'Artemis LQ', label: 'Artemis LQ', sub: 'Heavily compressed or re-uploaded footage' },
  { id: 'Gaia HQ', label: 'Gaia HQ', sub: 'High-quality live action, gentle detail recovery' },
  { id: 'Gaia CG', label: 'Gaia CG', sub: 'Rendered content, 3D, screen recordings' },
  { id: 'Gaia 2', label: 'Gaia 2', sub: 'Animation & motion graphics — 2x only, half price' },
  { id: 'Nyx', label: 'Nyx', sub: 'Noise reduction first, detail second' },
  { id: 'Nyx Fast', label: 'Nyx Fast', sub: 'Quicker denoise pass' },
  { id: 'Starlight Precise 2.5', label: 'Starlight Precise 2.5', sub: 'Generative restoration — slowest, strongest' },
  { id: 'Starlight Fast 2', label: 'Starlight Fast 2', sub: 'Generative restoration, quicker' },
] as const;

// Mirrors INTERPOLATE_MODELS in functions/src/lib/falVideo.ts.
const INTERPOLATE_MODELS = [
  { id: 'Apollo', label: 'Apollo', sub: 'General purpose — the right default for most footage' },
  { id: 'Chronos', label: 'Chronos', sub: 'Real-world motion, handheld and camera moves' },
  { id: 'Aion', label: 'Aion', sub: 'Extreme or complex motion — costs more' },
] as const;

const UPSCALE_FACTORS = [
  { v: 1, label: 'Off', sub: 'Keep size' },
  { v: 2, label: '2x', sub: 'Most common' },
  { v: 3, label: '3x', sub: '' },
  { v: 4, label: '4x', sub: 'Max' },
] as const;

/** The upscaler caps interpolation at 60fps; the dedicated interpolator goes to 120. */
const FPS_CHOICES = [
  { v: 0, label: 'Off', sub: 'Keep source' },
  { v: 30, label: '30', sub: 'Standard' },
  { v: 48, label: '48', sub: 'Smoother' },
  { v: 60, label: '60', sub: 'Fluid' },
  { v: 120, label: '120', sub: '1x only' },
] as const;

/**
 * Frame rate we assume the source runs at when estimating cost. The browser
 * can't read a file's real frame rate from a <video> element, and the
 * interpolator bills per *newly generated* frame, so the estimate below is
 * only ever a ballpark — it is labelled as one in the UI.
 */
const ASSUMED_SOURCE_FPS = 30;

/**
 * Topaz refuses H.264 output above 4096px on either edge — a 4x pass on a
 * 1080x1920 reel lands at 4320x7680 and comes back rejected. H.265 has no such
 * ceiling but won't play in Chrome, so the trade is the user's to make.
 */
const H264_MAX_EDGE = 4096;

/** Gaia 2 is the one model Topaz restricts to a single factor. */
const GAIA2_FACTOR = 2;

interface SourceMeta {
  name: string;
  durationSec: number;
  width: number;
  height: number;
}

interface JobState {
  requestId: string;
  endpoint: string;
}

export default function VideoEnhancer() {
  // ── Source ────────────────────────────────────────────
  // The public URL Fal fetches. Survives a reload, unlike an object URL, so it
  // doubles as the preview source once an upload finishes.
  const [sourceUrl, setSourceUrl] = usePersistedState<string | null>('enhance.sourceUrl', null);
  const [meta, setMeta] = usePersistedState<SourceMeta | null>('enhance.meta', null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Settings ──────────────────────────────────────────
  const [upscaleFactor, setUpscaleFactor] = usePersistedState<number>('enhance.upscaleFactor', 2);
  const [targetFps, setTargetFps] = usePersistedState<number>('enhance.targetFps', 0);
  const [upscaleModel, setUpscaleModel] = usePersistedState<string>('enhance.upscaleModel', 'Proteus');
  const [interpModel, setInterpModel] = usePersistedState<string>('enhance.interpModel', 'Apollo');
  const [h264, setH264] = usePersistedState<boolean>('enhance.h264', true);

  // ── Job ───────────────────────────────────────────────
  const [job, setJob] = usePersistedState<JobState | null>('enhance.job', null);
  const [status, setStatus] = useState<string | null>(null);
  const [queuePos, setQueuePos] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [startedAt, setStartedAt] = usePersistedState<number | null>('enhance.startedAt', null);
  const [elapsed, setElapsed] = useState(0);
  const [resultUrl, setResultUrl] = usePersistedState<string | null>('enhance.resultUrl', null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const isUpscaling = upscaleFactor > 1;
  const models = isUpscaling ? UPSCALE_MODELS : INTERPOLATE_MODELS;
  const model = isUpscaling ? upscaleModel : interpModel;
  const setModel = isUpscaling ? setUpscaleModel : setInterpModel;
  const running = !!job;

  // 120fps lives on the interpolation-only endpoint, so it's unreachable while
  // upscaling. Pull the selection back rather than letting the server clamp it
  // silently to 60 after the user has been quoted a price.
  useEffect(() => {
    if (isUpscaling && targetFps > 60) setTargetFps(60);
  }, [isUpscaling, targetFps, setTargetFps]);

  // Gaia 2 only ever upscales 2x; Fal takes the job and only refuses it minutes
  // later, so don't let the combination be selected in the first place.
  useEffect(() => {
    if (upscaleFactor > 1 && upscaleModel === 'Gaia 2' && upscaleFactor !== GAIA2_FACTOR) {
      setUpscaleFactor(GAIA2_FACTOR);
    }
  }, [upscaleModel, upscaleFactor, setUpscaleFactor]);

  // Keep the model valid for whichever endpoint the current settings imply.
  useEffect(() => {
    const ids = (models as readonly { id: string }[]).map((m) => m.id);
    if (!ids.includes(model)) setModel(ids[0]);
  }, [models, model, setModel]);

  // ── File handling ─────────────────────────────────────
  const readMeta = (file: File): Promise<Omit<SourceMeta, 'name'>> =>
    new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        resolve({ durationSec: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
        URL.revokeObjectURL(v.src);
      };
      v.onerror = () => reject(new Error("Couldn't read that video — try an MP4 or MOV."));
      v.src = URL.createObjectURL(file);
    });

  const processFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('video/')) {
        setError('That file isn’t a video.');
        return;
      }
      setError(null);
      setResultUrl(null);
      setJob(null);
      setStatus(null);
      setLogs([]);
      setLocalPreview(URL.createObjectURL(file));

      try {
        const dims = await readMeta(file);
        setMeta({ name: file.name, ...dims });

        // Fal fetches the source itself, so it has to live somewhere public.
        // flow-bucket/scheduler/** is already world-readable for exactly this
        // reason (HighLevel pulls scheduled media from it).
        const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
        const path = `flow-bucket/scheduler/enhance/${crypto.randomUUID()}.${ext || 'mp4'}`;
        const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type });
        setUploadPct(0);
        await new Promise<void>((resolve, reject) => {
          task.on(
            'state_changed',
            (snap) => setUploadPct(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
            reject,
            resolve,
          );
        });
        setSourceUrl(await getDownloadURL(task.snapshot.ref));
      } catch (e: any) {
        setError(e?.message || 'Upload failed.');
        setLocalPreview(null);
      } finally {
        setUploadPct(null);
      }
    },
    [setMeta, setSourceUrl, setResultUrl, setJob],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files[0]) void processFile(e.dataTransfer.files[0]);
    },
    [processFile],
  );

  const useUrl = async () => {
    const u = urlInput.trim();
    if (!u) return;
    try {
      new URL(u);
    } catch {
      setError('That isn’t a valid URL.');
      return;
    }
    setError(null);
    setResultUrl(null);
    setJob(null);
    setLocalPreview(null);
    setSourceUrl(u);
    setMeta({ name: u.split('/').pop()?.slice(0, 60) || 'Remote video', durationSec: 0, width: 0, height: 0 });
    setShowUrlInput(false);
    setUrlInput('');
  };

  /** Fill in duration/dimensions once the preview element has them. */
  const onPreviewMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (!meta || meta.width) return;
    setMeta({ ...meta, durationSec: v.duration || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
  };

  const clearAll = () => {
    setSourceUrl(null);
    setMeta(null);
    setLocalPreview(null);
    setResultUrl(null);
    setJob(null);
    setStatus(null);
    setLogs([]);
    setError(null);
  };

  // ── Estimate ──────────────────────────────────────────
  const outW = meta?.width ? Math.round(meta.width * upscaleFactor) : 0;
  const outH = meta?.height ? Math.round(meta.height * upscaleFactor) : 0;

  /** Why this factor can't be used, or null. Drives the disabled pills. */
  const factorBlocked = (f: number): string | null => {
    if (f <= 1) return null;
    if (upscaleModel === 'Gaia 2' && f !== GAIA2_FACTOR) return 'Gaia 2 is 2x only';
    return null;
  };

  // H.264's size ceiling isn't a dead end — switching the codec fixes it — so
  // it blocks the render with an offered way out rather than greying the pill.
  const h264TooBig =
    h264 && isUpscaling && Math.max(outW, outH) > H264_MAX_EDGE;

  const estimate = (): number | null => {
    if (!meta?.durationSec) return null;
    const shortSide = outW && outH ? Math.min(outW, outH) : 1080;
    if (isUpscaling) {
      // $0.01/s up to 720p, $0.02/s to 1080p, $0.08/s above — doubled at 60fps,
      // halved for Gaia 2.
      let rate = shortSide <= 720 ? 0.01 : shortSide <= 1080 ? 0.02 : 0.08;
      if (targetFps >= 60) rate *= 2;
      if (model === 'Gaia 2') rate /= 2;
      return meta.durationSec * rate;
    }
    // Interpolation bills the frames it invents, not the clip.
    const newFrames = Math.max(0, targetFps - ASSUMED_SOURCE_FPS) * meta.durationSec;
    const perFrame = model === 'Aion'
      ? shortSide > 1080 ? 0.00567 : 0.00167
      : shortSide > 1080 ? 0.002 : 0.001;
    return newFrames * perFrame;
  };

  const cost = estimate();
  const nothingToDo = upscaleFactor === 1 && targetFps === 0;

  // ── Run ───────────────────────────────────────────────
  const handleEnhance = async () => {
    if (!sourceUrl || nothingToDo) return;
    setError(null);
    setResultUrl(null);
    setLogs([]);
    setStatus('IN_QUEUE');
    try {
      const res = await authedFetch('/api/content/enhance-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: sourceUrl,
          upscaleFactor,
          targetFps: targetFps || null,
          model,
          h264,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || 'Failed to start the job');
      }
      const data = await res.json();
      setJob({ requestId: data.requestId, endpoint: data.endpoint });
      setStartedAt(Date.now());
    } catch (e: any) {
      setError(e.message);
      setStatus(null);
    }
  };

  const cancelJob = () => {
    setJob(null);
    setStatus(null);
    setLogs([]);
    setStartedAt(null);
  };

  // Poll while a job is live. Persisting `job` means a page reload picks the
  // same job back up instead of stranding a running (billed) render.
  useEffect(() => {
    if (!job) return;
    let stop = false;

    const tick = async () => {
      try {
        const res = await authedFetch(
          `/api/content/enhance-video/status?requestId=${encodeURIComponent(job.requestId)}` +
            `&endpoint=${encodeURIComponent(job.endpoint)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || 'Lost track of the job');
        }
        const data = await res.json();
        if (stop) return;
        setStatus(data.status);
        setQueuePos(data.queuePosition ?? null);
        if (Array.isArray(data.logs) && data.logs.length) setLogs(data.logs);
        if (data.status === 'COMPLETED' && data.videoUrl) {
          setResultUrl(data.videoUrl);
          setJob(null);
          setStartedAt(null);
        }
      } catch (e: any) {
        if (stop) return;
        setError(e.message);
        setJob(null);
        setStatus(null);
      }
    };

    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [job, setJob, setResultUrl, setStartedAt]);

  // Elapsed timer — Topaz runs for minutes, so a spinner alone reads as hung.
  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // ── Download ──────────────────────────────────────────
  const handleDownload = async () => {
    if (!resultUrl) return;
    setDownloading(true);
    setError(null);
    try {
      const fname = `enhanced-${upscaleFactor > 1 ? `${upscaleFactor}x-` : ''}${targetFps ? `${targetFps}fps-` : ''}${Date.now()}.mp4`;
      // Straight to the fal.media URL would be a cross-origin navigation, which
      // ignores `download` — go through the proxy that the Reel Extractor uses.
      const res = await authedFetch(
        `/api/social/download?url=${encodeURIComponent(resultUrl)}&filename=${encodeURIComponent(fname)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || 'Download failed');
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  };

  /** Feed the result back in for a second pass (upscale, then smooth). */
  const useResultAsSource = () => {
    if (!resultUrl) return;
    setSourceUrl(resultUrl);
    setLocalPreview(null);
    setMeta({ name: 'Enhanced result', durationSec: meta?.durationSec || 0, width: outW, height: outH });
    setResultUrl(null);
  };

  const previewSrc = localPreview || sourceUrl;
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const Pill = ({
    active, onClick, label, sub, disabled,
  }: { active: boolean; onClick: () => void; label: string; sub: string; disabled?: boolean }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 rounded-xl border text-left transition-all disabled:opacity-35 disabled:cursor-not-allowed ${
        active ? 'bg-purple-500/10 border-purple-500/40' : 'border-[#27273A] hover:border-zinc-600'
      }`}
    >
      <div className={`text-sm font-medium ${active ? 'text-purple-200' : 'text-zinc-300'}`}>{label}</div>
      {sub && <div className="text-[9px] text-zinc-500 mt-0.5">{sub}</div>}
    </button>
  );

  return (
    <div className="max-w-4xl space-y-5">
      {/* ── Source ────────────────────────────────────────── */}
      <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-1">
          Upscaler &amp; Frame Rate
        </h3>
        <p className="text-[10px] text-zinc-600 mb-4">
          Topaz video models &mdash; enlarge up to 4x and interpolate up to 120fps. Feed it an extracted
          reel, AI-generated footage, or anything that looks soft or juddery.
        </p>

        {!previewSrc ? (
          <>
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
                accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void processFile(e.target.files[0])}
              />
              {uploadPct !== null ? (
                <>
                  <Loader size={36} className="mx-auto mb-3 text-purple-400 animate-spin" />
                  <p className="text-sm text-zinc-400 mb-2">Uploading &mdash; {uploadPct}%</p>
                  <div className="h-1 w-48 mx-auto rounded-full bg-[#27273A] overflow-hidden">
                    <div className="h-full bg-purple-500 transition-all" style={{ width: `${uploadPct}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <Upload size={36} className="mx-auto mb-3 text-zinc-500" />
                  <p className="text-sm text-zinc-400 mb-1">Drop a video to enhance it</p>
                  <p className="text-[10px] text-zinc-600">MP4, MOV, WebM</p>
                </>
              )}
            </div>

            {showUrlInput ? (
              <div className="flex items-center gap-2 mt-3">
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void useUrl()}
                  placeholder="https://… a direct video URL"
                  className="flex-1 bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50"
                />
                <button
                  onClick={() => void useUrl()}
                  className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition-colors"
                >
                  Use
                </button>
                <button onClick={() => setShowUrlInput(false)} className="p-2 text-zinc-500 hover:text-zinc-300">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowUrlInput(true)}
                className="flex items-center gap-1.5 mt-3 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <LinkIcon size={11} /> or paste a video URL
              </button>
            )}
          </>
        ) : (
          <div className="flex items-start gap-4">
            <video
              src={previewSrc}
              onLoadedMetadata={onPreviewMeta}
              muted
              playsInline
              controls
              className="w-44 rounded-xl border border-[#27273A] bg-black shrink-0"
            />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-xs text-zinc-300 truncate">{meta?.name}</p>
              <p className="text-[10px] text-zinc-500">
                {meta?.width ? `${meta.width}×${meta.height}` : 'Reading size…'}
                {meta?.durationSec ? ` · ${fmtTime(Math.round(meta.durationSec))}` : ''}
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={running}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg border border-[#27273A] hover:bg-[#181824] disabled:opacity-40"
                >
                  Replace
                </button>
                <button
                  onClick={clearAll}
                  disabled={running}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-lg border border-[#27273A] hover:bg-[#181824] disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void processFile(e.target.files[0])}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Settings ──────────────────────────────────────── */}
      <AnimatePresence>
        {sourceUrl && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden space-y-5"
          >
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 space-y-5">
              {/* Upscale */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Maximize size={14} className="text-purple-400" />
                  <span className="text-xs font-medium text-zinc-300">Upscale</span>
                  {outW > 0 && upscaleFactor > 1 && (
                    <span className="text-[10px] text-zinc-500">&rarr; {outW}&times;{outH}</span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {UPSCALE_FACTORS.map((f) => {
                    const blocked = factorBlocked(f.v);
                    return (
                      <Pill
                        key={f.v}
                        active={upscaleFactor === f.v}
                        onClick={() => setUpscaleFactor(f.v)}
                        label={f.label}
                        sub={blocked || f.sub}
                        disabled={running || !!blocked}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Frame rate */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Film size={14} className="text-purple-400" />
                  <span className="text-xs font-medium text-zinc-300">Frame rate</span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {FPS_CHOICES.map((f) => (
                    <Pill
                      key={f.v}
                      active={targetFps === f.v}
                      onClick={() => setTargetFps(f.v)}
                      label={f.label}
                      sub={f.sub}
                      disabled={running || (f.v > 60 && isUpscaling)}
                    />
                  ))}
                </div>
                <p className="text-[9px] text-zinc-600 mt-1.5">
                  {isUpscaling
                    ? 'Interpolation rides along with the upscale in one pass, capped at 60fps.'
                    : '120fps needs upscaling off — it runs on the dedicated interpolation model.'}
                  {' '}A target at or below the clip&rsquo;s own frame rate adds nothing.
                </p>
              </div>

              {/* Model */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-medium text-zinc-300">
                    {isUpscaling ? 'Upscale model' : 'Interpolation model'}
                  </span>
                  <button
                    onClick={() => setH264(!h264)}
                    disabled={running}
                    className={`text-[9px] px-2 py-1 rounded-lg border transition-colors disabled:opacity-40 ${
                      h264 ? 'border-purple-500/40 text-purple-200 bg-purple-500/10' : 'border-[#27273A] text-zinc-500'
                    }`}
                    title="H.265 is smaller but won't play in Chrome and is rejected by some uploaders."
                  >
                    {h264 ? 'H.264' : 'H.265'}
                  </button>
                </div>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={running}
                  className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-purple-500/50 disabled:opacity-40"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <p className="text-[9px] text-zinc-600 mt-1.5">
                  {(models as readonly { id: string; sub: string }[]).find((m) => m.id === model)?.sub}
                </p>
              </div>

              {/* Run */}
              <div className="flex items-center justify-between gap-4 pt-1 border-t border-[#27273A]">
                <div className="text-[10px] text-zinc-500 pt-4">
                  {nothingToDo ? (
                    <span className="text-amber-300/90 flex items-center gap-1">
                      <AlertTriangle size={11} /> Pick an upscale factor or a frame rate.
                    </span>
                  ) : h264TooBig ? (
                    <span className="text-amber-300/90 flex items-center gap-1 flex-wrap">
                      <AlertTriangle size={11} />
                      {outW}&times;{outH} is past H.264&rsquo;s {H264_MAX_EDGE}px limit.
                      <button
                        onClick={() => setH264(false)}
                        className="underline underline-offset-2 hover:text-amber-200"
                      >
                        Switch to H.265
                      </button>
                      <span className="text-zinc-600">or drop the factor.</span>
                    </span>
                  ) : cost != null ? (
                    <>
                      <span className="text-zinc-300">&asymp; ${cost.toFixed(2)}</span> for this render
                      {!isUpscaling && <> &mdash; assumes a {ASSUMED_SOURCE_FPS}fps source</>}
                    </>
                  ) : (
                    'Cost scales with length and output resolution.'
                  )}
                </div>
                <button
                  onClick={() => void handleEnhance()}
                  disabled={running || nothingToDo || h264TooBig || uploadPct !== null}
                  className="mt-4 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-sm font-medium shadow-[0_0_10px_rgba(168,85,247,0.2)] disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
                >
                  {running ? 'Rendering…' : 'Enhance video'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Progress ──────────────────────────────────────── */}
      {running && (
        <div className="bg-[#12121A] border border-purple-500/30 rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <Loader size={16} className="text-purple-400 animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-200">
                {status === 'IN_QUEUE'
                  ? queuePos != null ? `Queued — position ${queuePos}` : 'Queued at Fal'
                  : 'Topaz is rendering'}
              </p>
              <p className="text-[10px] text-zinc-500">
                {fmtTime(elapsed)} elapsed · a minute of footage typically takes a few minutes
              </p>
            </div>
            <button
              onClick={cancelJob}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded-lg border border-[#27273A]"
              title="Stops watching. The render keeps going at Fal and is still billed."
            >
              Stop watching
            </button>
          </div>
          {logs.length > 0 && (
            <div className="bg-[#0A0A0F] border border-[#27273A] rounded-lg p-2.5 font-mono text-[9px] text-zinc-500 space-y-0.5">
              {logs.map((l, i) => <div key={i} className="truncate">{l}</div>)}
            </div>
          )}
        </div>
      )}

      {/* ── Result ────────────────────────────────────────── */}
      {resultUrl && (
        <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Check size={14} className="text-green-400" />
            <span className="text-sm font-medium text-zinc-200">Done</span>
            <span className="text-[10px] text-zinc-500">
              {upscaleFactor > 1 && outW ? `${outW}×${outH}` : 'Original size'}
              {targetFps ? ` · ${targetFps}fps` : ''}
            </span>
          </div>
          <video src={resultUrl} controls playsInline className="w-full rounded-xl border border-[#27273A] bg-black" />
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white text-sm font-medium disabled:opacity-50 transition-all"
            >
              {downloading ? <Loader size={14} className="animate-spin" /> : <Download size={14} />}
              {downloading ? 'Downloading…' : 'Download MP4'}
            </button>
            <button
              onClick={useResultAsSource}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#27273A] text-zinc-300 text-sm hover:bg-[#181824] transition-colors"
              title="Run a second pass — e.g. upscale first, then smooth."
            >
              <RefreshCw size={14} /> Enhance again
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
