import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader,
  Download,
  Trash2,
  Check,
  Plus,
  X,
  Package,
  RefreshCw,
  Star,
  ChevronUp,
  ChevronDown,
  Film,
  Play,
  Eye,
  Upload,
} from '@geist-ui/icons';
import { motion, AnimatePresence } from 'motion/react';
import { addToFlowBucket, useFlowBucketDrop, flowItemToBase64, type FlowBucketItem } from './FlowBucket';
import { useFirestoreAccounts, useFirestoreAccount, useFirestoreMediaAssets } from '../hooks/useFirestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';

// ─── Types ────────────────────────────────────────────────

type VideoStage = 'configure' | 'generating' | 'analyzing' | 'preview-edit' | 'compiling' | 'complete';
type VideoStyle = 'ugc' | 'cinematic' | 'montage' | 'slow-motion' | 'story-reel';

interface ClipState {
  index: number;
  angle: string;
  angleLabel: string;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  error?: string;
}

interface SceneSegment {
  startTime: number;
  endTime: number;
  description: string;
  quality: string;
  moneyFrame: boolean;
  score: number;
}

interface ClipAnalysis {
  clipIndex: number;
  angle: string;
  scenes: SceneSegment[];
  bestSegments: { startTime: number; endTime: number; reason: string }[];
  totalDuration: number;
}

interface EditSegment {
  clipIndex: number;
  angle: string;
  startTime: number;
  endTime: number;
  enabled: boolean;
  score: number;
  reason: string;
}

// ─── Constants ────────────────────────────────────────────

const VIDEO_STYLES: { id: VideoStyle; label: string; sub: string }[] = [
  { id: 'ugc', label: 'UGC Style', sub: 'Handheld, natural, authentic' },
  { id: 'cinematic', label: 'Cinematic', sub: 'Smooth, professional, polished' },
  { id: 'montage', label: 'Fast-Cut Montage', sub: 'Quick cuts, energetic pace' },
  { id: 'slow-motion', label: 'Slow Motion', sub: 'Macro food detail shots' },
  { id: 'story-reel', label: 'Story / Reel', sub: 'Vertical 9:16, social-first' },
];

const ASPECT_RATIOS = [
  { id: '9:16' as const, label: '9:16', sub: 'Story / Reel' },
  { id: '16:9' as const, label: '16:9', sub: 'YouTube / Wide' },
  { id: '1:1' as const, label: '1:1', sub: 'Square Feed' },
];

const TRANSITIONS = [
  { id: 'cut' as const, label: 'Hard Cut' },
  { id: 'crossfade' as const, label: 'Crossfade' },
  { id: 'fade-black' as const, label: 'Fade to Black' },
];

const API_BASE = '/api';

// ─── Component ────────────────────────────────────────────

export default function VideoCreator() {
  // Account
  const { accounts, loading: accountsLoading } = useFirestoreAccounts();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const { account: fullAccount } = useFirestoreAccount(selectedAccountId);
  const { addAsset: addMediaAsset } = useFirestoreMediaAssets(selectedAccountId);

  // Stage
  const [stage, setStage] = useState<VideoStage>('configure');
  const [jobId, setJobId] = useState<string | null>(null);

  // Configure
  const [dishName, setDishName] = useState('');
  const [description, setDescription] = useState('');
  const [style, setStyle] = useState<VideoStyle>('ugc');
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [clipCount, setClipCount] = useState(4);
  const [startingFrame, setStartingFrame] = useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const frameInputRef = useRef<HTMLInputElement>(null);

  // Generating
  const [clips, setClips] = useState<ClipState[]>([]);
  const [selectedAngles, setSelectedAngles] = useState<{ id: string; label: string }[]>([]);

  // Analysis
  const [analyses, setAnalyses] = useState<ClipAnalysis[]>([]);
  const [analysisProgress, setAnalysisProgress] = useState({ completed: 0, total: 0 });

  // Preview & Edit
  const [editSegments, setEditSegments] = useState<EditSegment[]>([]);
  const [transition, setTransition] = useState<'cut' | 'crossfade' | 'fade-black'>('cut');

  // Compile
  const [compiling, setCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState({ step: '', progress: 0 });

  // Complete
  const [finalVideo, setFinalVideo] = useState<{ base64: string; mimeType: string; duration: number } | null>(null);
  const [saving, setSaving] = useState(false);

  // Error
  const [error, setError] = useState<string | null>(null);

  // SSE ref for cleanup
  const sseRef = useRef<EventSource | null>(null);

  // ─── Starting Frame: FlowBucket drop, file upload, paste ─

  const flowDrop = useFlowBucketDrop(async (item: FlowBucketItem) => {
    const data = await flowItemToBase64(item);
    setStartingFrame({ base64: data.base64, mimeType: data.mimeType, preview: data.preview });
  });

  const handleFrameUpload = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setStartingFrame({ base64: dataUrl.split(',')[1], mimeType: file.type, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  }, []);

  // Paste image from clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (stage !== 'configure') return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            setStartingFrame({ base64: dataUrl.split(',')[1], mimeType: file.type, preview: dataUrl });
          };
          reader.readAsDataURL(file);
          break;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [stage]);

  // ─── SSE Listener ────────────────────────────────────────

  useEffect(() => {
    if (!jobId || (stage !== 'generating' && stage !== 'analyzing' && stage !== 'compiling')) return;

    const source = new EventSource(`${API_BASE}/activity/stream`);
    sseRef.current = source;

    // Clip generation events
    source.addEventListener('video_progress', (e) => {
      const data = JSON.parse(e.data);
      if (data.jobId !== jobId) return;
      if (data.type === 'angles_selected') {
        setSelectedAngles(data.angles);
        setClips(data.angles.map((a: any, i: number) => ({
          index: i,
          angle: a.id,
          angleLabel: a.label,
          status: 'generating' as const,
        })));
      }
    });

    source.addEventListener('video_clip_ready', (e) => {
      const data = JSON.parse(e.data);
      if (data.jobId !== jobId) return;
      setClips((prev) =>
        prev.map((c) =>
          c.index === data.clipIndex
            ? { ...c, status: data.status, error: data.error, angleLabel: data.angleLabel || c.angleLabel }
            : c
        )
      );
    });

    source.addEventListener('video_clips_complete', (e) => {
      const data = JSON.parse(e.data);
      if (data.jobId !== jobId) return;
      if (data.clipCount > 0) {
        setStage('analyzing');
        triggerAnalysis(jobId);
      }
    });

    // Analysis events
    source.addEventListener('video_analysis_progress', (e) => {
      const data = JSON.parse(e.data);
      if (data.jobId !== jobId) return;
      setAnalyses((prev) => {
        const existing = prev.findIndex((a) => a.clipIndex === data.clipIndex);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = data.analysis;
          return updated;
        }
        return [...prev, data.analysis];
      });
      setAnalysisProgress({ completed: data.completed, total: data.total });
    });

    source.addEventListener('video_analysis_complete', (e) => {
      const data = JSON.parse(e.data);
      if (data.jobId !== jobId) return;
      buildEditSegments(data.fullAnalysis);
      setStage('preview-edit');
    });

    // Compile events
    source.addEventListener('video_compile_progress', (e) => {
      const data = JSON.parse(e.data);
      if (data.jobId !== jobId) return;
      setCompileProgress({ step: data.step, progress: data.progress });
    });

    source.addEventListener('video_compile_complete', (e) => {
      const data = JSON.parse(e.data);
      if (data.jobId !== jobId) return;
      // Video data comes from the fetch response, not SSE
    });

    source.addEventListener('video_error', (e) => {
      const data = JSON.parse(e.data);
      if (data.jobId !== jobId) return;
      setError(data.error);
      setStage('configure');
    });

    source.onerror = () => {
      console.warn('Video SSE connection lost, reconnecting...');
    };

    return () => {
      source.close();
      sseRef.current = null;
    };
  }, [jobId, stage]);

  // ─── Actions ─────────────────────────────────────────────

  const startGeneration = useCallback(async () => {
    if (!selectedAccountId || !dishName.trim() || !description.trim()) return;
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/video/generate-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccountId,
          dishName: dishName.trim(),
          description: description.trim(),
          style,
          aspectRatio,
          clipCount,
          startingFrame: startingFrame ? { base64: startingFrame.base64, mimeType: startingFrame.mimeType } : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start generation');

      setJobId(data.jobId);
      setClips(Array.from({ length: data.clipCount }, (_, i) => ({
        index: i,
        angle: '',
        angleLabel: `Clip ${i + 1}`,
        status: 'pending',
      })));
      setStage('generating');
    } catch (e: any) {
      setError(e.message);
    }
  }, [selectedAccountId, dishName, description, style, aspectRatio, clipCount, startingFrame]);

  const triggerAnalysis = useCallback(async (jId: string) => {
    try {
      const res = await fetch(`${API_BASE}/video/analyze-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start analysis');
      setAnalysisProgress({ completed: 0, total: data.clipCount });
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  const buildEditSegments = useCallback((analysis: any) => {
    const segments: EditSegment[] = [];
    const clipAnalyses: ClipAnalysis[] = analysis.clips || [];
    const order: number[] = analysis.recommendedOrder || clipAnalyses.map((_, i) => i);

    for (const clipIdx of order) {
      const ca = clipAnalyses.find((a) => a.clipIndex === clipIdx);
      if (!ca) continue;
      for (const seg of ca.bestSegments) {
        segments.push({
          clipIndex: clipIdx,
          angle: ca.angle,
          startTime: seg.startTime,
          endTime: seg.endTime,
          enabled: true,
          score: Math.max(...ca.scenes.filter(s => s.startTime >= seg.startTime && s.endTime <= seg.endTime).map(s => s.score), 70),
          reason: seg.reason,
        });
      }
    }

    // Trim to ~12s target
    let total = 0;
    const trimmed = segments.map((seg) => {
      const dur = seg.endTime - seg.startTime;
      if (total + dur > 15) {
        return { ...seg, enabled: false };
      }
      total += dur;
      return seg;
    });

    setEditSegments(trimmed);
  }, []);

  const compileVideo = useCallback(async () => {
    if (!jobId) return;
    setCompiling(true);
    setError(null);

    const enabledSegments = editSegments
      .filter((s) => s.enabled)
      .map((s) => ({
        clipIndex: s.clipIndex,
        startTime: s.startTime,
        endTime: s.endTime,
      }));

    if (enabledSegments.length === 0) {
      setError('Enable at least one segment to compile.');
      setCompiling(false);
      return;
    }

    try {
      setStage('compiling');
      const res = await fetch(`${API_BASE}/video/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          segments: enabledSegments,
          targetDuration: 12,
          outputFormat: aspectRatio,
          transitionType: transition,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Compilation failed');

      setFinalVideo({
        base64: data.videoBase64,
        mimeType: data.mimeType || 'video/mp4',
        duration: data.duration,
      });
      setStage('complete');
    } catch (e: any) {
      setError(e.message);
      setStage('preview-edit');
    } finally {
      setCompiling(false);
    }
  }, [jobId, editSegments, aspectRatio, transition]);

  const downloadVideo = useCallback(() => {
    if (!finalVideo) return;
    const link = document.createElement('a');
    link.href = `data:${finalVideo.mimeType};base64,${finalVideo.base64}`;
    link.download = `${dishName.replace(/\s+/g, '-').toLowerCase()}-${style}-${Date.now()}.mp4`;
    link.click();
  }, [finalVideo, dishName, style]);

  const saveToLibrary = useCallback(async () => {
    if (!finalVideo || !selectedAccountId) return;
    setSaving(true);
    try {
      const bytes = Uint8Array.from(atob(finalVideo.base64), (c) => c.charCodeAt(0));
      const fileName = `${dishName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.mp4`;
      const storageRef = ref(storage, `videos/${selectedAccountId}/${fileName}`);
      await uploadBytes(storageRef, bytes, { contentType: 'video/mp4' });
      const url = await getDownloadURL(storageRef);

      await addMediaAsset({
        accountId: selectedAccountId,
        name: dishName || 'AI Video',
        category: 'Video',
        tags: [style, aspectRatio, 'ai-generated'],
        description: description.slice(0, 200),
        menuMatch: null,
        imageUrl: url,
        mimeType: 'video/mp4',
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [finalVideo, selectedAccountId, dishName, description, style, aspectRatio, addMediaAsset]);

  const sendToFlowBucket = useCallback(() => {
    if (!finalVideo) return;
    addToFlowBucket({
      name: `${dishName || 'Video'} - ${style}`,
      base64: finalVideo.base64,
      mimeType: finalVideo.mimeType,
    });
  }, [finalVideo, dishName, style]);

  const resetAll = useCallback(() => {
    if (jobId) {
      fetch(`${API_BASE}/video/job/${jobId}`, { method: 'DELETE' }).catch(() => {});
    }
    sseRef.current?.close();
    setStage('configure');
    setJobId(null);
    setClips([]);
    setSelectedAngles([]);
    setAnalyses([]);
    setAnalysisProgress({ completed: 0, total: 0 });
    setEditSegments([]);
    setFinalVideo(null);
    setError(null);
    setCompileProgress({ step: '', progress: 0 });
  }, [jobId]);

  // ─── Computed ────────────────────────────────────────────

  const enabledDuration = editSegments
    .filter((s) => s.enabled)
    .reduce((sum, s) => sum + (s.endTime - s.startTime), 0);

  const readyClips = clips.filter((c) => c.status === 'ready').length;

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Stage indicator */}
      <div className="flex items-center gap-2 px-1">
        {(['configure', 'generating', 'analyzing', 'preview-edit', 'compiling', 'complete'] as VideoStage[]).map((s, i) => {
          const labels: Record<VideoStage, string> = {
            configure: 'Configure',
            generating: 'Generating',
            analyzing: 'AI Analysis',
            'preview-edit': 'Edit',
            compiling: 'Compile',
            complete: 'Done',
          };
          const stageOrder = ['configure', 'generating', 'analyzing', 'preview-edit', 'compiling', 'complete'];
          const current = stageOrder.indexOf(stage);
          const thisIdx = stageOrder.indexOf(s);
          const isPast = thisIdx < current;
          const isCurrent = thisIdx === current;

          return (
            <React.Fragment key={s}>
              {i > 0 && <div className={`flex-1 h-px ${isPast ? 'bg-purple-500/40' : 'bg-[#27273A]'}`} />}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium transition-all ${
                isCurrent ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' :
                isPast ? 'text-purple-400/60' : 'text-zinc-600'
              }`}>
                {isPast ? <Check size={10} /> : isCurrent ? <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" /> : null}
                {labels[s]}
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <X size={14} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-300 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300"><X size={14} /></button>
        </div>
      )}

      {/* ─── Stage 1: Configure ─────────────────────────── */}
      {stage === 'configure' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Account Selector */}
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

          {selectedAccountId && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
                {/* Left: Starting frame + Dish name + description */}
                <div className="space-y-6">
                  {/* Starting Frame */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Starting Frame</h3>
                    <p className="text-[10px] text-zinc-600 mb-3">Upload an image to use as the first frame — Sora will animate from it</p>
                    {startingFrame ? (
                      <div
                        className={`relative group rounded-xl border-2 transition-all ${flowDrop.dragOver ? 'border-amber-400' : 'border-transparent'}`}
                        onDragOver={flowDrop.handleDragOver}
                        onDragLeave={flowDrop.handleDragLeave}
                        onDrop={flowDrop.handleDrop}
                      >
                        <img src={startingFrame.preview} alt="" className="w-full h-44 rounded-xl object-cover border border-[#27273A]" />
                        {flowDrop.dragOver && (
                          <div className="absolute inset-0 bg-amber-500/20 rounded-xl flex items-center justify-center">
                            <span className="text-xs text-amber-300 font-medium bg-black/60 px-3 py-1.5 rounded-lg">Drop to replace</span>
                          </div>
                        )}
                        <button
                          onClick={() => setStartingFrame(null)}
                          className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={() => frameInputRef.current?.click()}
                        onDragOver={flowDrop.handleDragOver}
                        onDragLeave={flowDrop.handleDragLeave}
                        onDrop={flowDrop.handleDrop}
                        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                          flowDrop.dragOver ? 'border-amber-400 bg-amber-500/10' : 'border-[#27273A] hover:border-zinc-600 hover:bg-[#0A0A0F]'
                        }`}
                      >
                        <Upload size={24} className="mx-auto mb-2 text-zinc-500" />
                        <p className="text-xs text-zinc-400">Upload a food photo as the starting frame</p>
                        <p className="text-[10px] text-zinc-600 mt-1">Drag from Flow Bucket or upload a file</p>
                        <p className="text-[10px] text-zinc-500 mt-2">
                          or press <kbd className="px-1.5 py-0.5 rounded bg-[#1a1a2e] border border-[#27273A] text-zinc-400 font-mono text-[9px]">&#8984;V</kbd> to paste from clipboard
                        </p>
                      </div>
                    )}
                    <input ref={frameInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFrameUpload(e.target.files)} />
                  </div>

                  {/* Dish Name */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Dish / Drink Name</h3>
                    <input
                      value={dishName}
                      onChange={(e) => setDishName(e.target.value)}
                      placeholder='e.g. "Wagyu Steak with Truffle Butter" or "Espresso Martini"'
                      className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-purple-500/40 transition-colors"
                    />
                  </div>

                  {/* Description */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Description & Vibe</h3>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe the food, the setting, and the mood you want. e.g. 'Sizzling steak being plated on a dark slate board, steam rising, warm moody restaurant lighting, garnished with fresh herbs and drizzled sauce'"
                      rows={4}
                      className="w-full bg-[#0A0A0F] border border-[#27273A] rounded-xl p-4 text-sm text-white placeholder-zinc-600 outline-none resize-none focus:border-purple-500/40 transition-colors"
                    />
                  </div>

                  {/* Video Style */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Video Style</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {VIDEO_STYLES.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setStyle(s.id)}
                          className={`p-3.5 rounded-xl border text-left transition-all ${
                            style === s.id
                              ? 'bg-purple-500/10 border-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.1)]'
                              : 'border-[#27273A] hover:border-zinc-600 bg-[#0A0A0F]'
                          }`}
                        >
                          <p className={`text-xs font-medium ${style === s.id ? 'text-purple-300' : 'text-zinc-300'}`}>{s.label}</p>
                          <p className="text-[10px] text-zinc-500 mt-0.5">{s.sub}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right: Settings */}
                <div className="space-y-6">
                  {/* Aspect Ratio */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Format</h3>
                    <div className="space-y-1.5">
                      {ASPECT_RATIOS.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setAspectRatio(r.id)}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                            aspectRatio === r.id
                              ? 'bg-purple-500/10 border-purple-500/40'
                              : 'border-[#27273A] hover:border-zinc-600 bg-[#0A0A0F]'
                          }`}
                        >
                          <span className={`text-xs font-medium ${aspectRatio === r.id ? 'text-purple-300' : 'text-zinc-300'}`}>{r.label}</span>
                          <span className="text-[10px] text-zinc-500">{r.sub}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Clip Count */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Clips</h3>
                      <span className="text-sm font-medium text-purple-300">{clipCount}</span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={6}
                      value={clipCount}
                      onChange={(e) => setClipCount(parseInt(e.target.value))}
                      className="w-full accent-purple-500"
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px] text-zinc-600">2 clips</span>
                      <span className="text-[9px] text-zinc-600">6 clips</span>
                    </div>
                    <p className="text-[10px] text-zinc-600 mt-2">AI will pick the best {clipCount} camera angles for this dish</p>
                  </div>

                  {/* Info Card */}
                  <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                    <div className="flex items-start gap-3">
                      <Film size={16} className="text-purple-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-zinc-300 font-medium">How it works</p>
                        <ol className="text-[10px] text-zinc-500 mt-1.5 space-y-1 list-decimal list-inside">
                          <li>AI picks the best camera angles for your dish</li>
                          <li>Sora Pro generates {clipCount} video clips</li>
                          <li>Gemini AI analyzes each clip for best moments</li>
                          <li>You review & adjust, then compile into 10-15s video</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Generate Button */}
              <button
                onClick={startGeneration}
                disabled={!dishName.trim() || !description.trim()}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-500 text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_20px_rgba(168,85,247,0.15)] disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                <Film size={16} />
                Generate {clipCount} AI Video Clips
              </button>
            </>
          )}
        </motion.div>
      )}

      {/* ─── Stage 2: Generating Clips ──────────────────── */}
      {stage === 'generating' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Generating Clips with Sora Pro</h3>
              <span className="text-xs text-zinc-500">
                {readyClips} / {clips.length} ready
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {clips.map((clip) => (
                <div
                  key={clip.index}
                  className={`rounded-xl border p-4 transition-all ${
                    clip.status === 'ready'
                      ? 'border-green-500/30 bg-green-500/5'
                      : clip.status === 'failed'
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'border-[#27273A] bg-[#0A0A0F]'
                  }`}
                >
                  <div className="flex items-center justify-center h-20 mb-3">
                    {clip.status === 'ready' ? (
                      <Check size={24} className="text-green-400" />
                    ) : clip.status === 'failed' ? (
                      <X size={24} className="text-red-400" />
                    ) : (
                      <Loader size={24} className="text-purple-400 animate-spin" />
                    )}
                  </div>
                  <p className="text-[11px] font-medium text-zinc-300 text-center truncate">{clip.angleLabel || `Clip ${clip.index + 1}`}</p>
                  <p className={`text-[9px] text-center mt-0.5 ${
                    clip.status === 'ready' ? 'text-green-400' :
                    clip.status === 'failed' ? 'text-red-400' :
                    'text-zinc-600'
                  }`}>
                    {clip.status === 'ready' ? 'Ready' : clip.status === 'failed' ? 'Failed' : clip.status === 'generating' ? 'Generating...' : 'Queued'}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <div className="w-full bg-[#0A0A0F] rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-purple-600 to-purple-400 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${clips.length ? (readyClips / clips.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ─── Stage 3: AI Analysis ───────────────────────── */}
      {stage === 'analyzing' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Gemini AI Analyzing Clips</h3>
              <span className="text-xs text-zinc-500">
                {analysisProgress.completed} / {analysisProgress.total} analyzed
              </span>
            </div>

            <div className="space-y-3">
              {clips.filter(c => c.status === 'ready').map((clip) => {
                const analysis = analyses.find((a) => a.clipIndex === clip.index);
                return (
                  <div key={clip.index} className="rounded-xl border border-[#27273A] bg-[#0A0A0F] p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Film size={12} className="text-purple-400" />
                        <span className="text-xs font-medium text-zinc-300">{clip.angleLabel}</span>
                      </div>
                      {analysis ? (
                        <span className="text-[10px] text-green-400 flex items-center gap-1"><Check size={10} /> Analyzed</span>
                      ) : (
                        <span className="text-[10px] text-zinc-500 flex items-center gap-1"><Loader size={10} className="animate-spin" /> Analyzing...</span>
                      )}
                    </div>

                    {analysis && (
                      <div className="mt-2">
                        {/* Scene timeline visualization */}
                        <div className="flex gap-0.5 h-6 rounded-lg overflow-hidden">
                          {analysis.scenes.map((scene, si) => {
                            const width = ((scene.endTime - scene.startTime) / analysis.totalDuration) * 100;
                            const color = scene.moneyFrame
                              ? 'bg-amber-500/60'
                              : scene.score >= 80
                              ? 'bg-green-500/40'
                              : scene.score >= 60
                              ? 'bg-purple-500/30'
                              : 'bg-zinc-700/40';
                            return (
                              <div
                                key={si}
                                className={`${color} relative group cursor-default flex items-center justify-center`}
                                style={{ width: `${width}%`, minWidth: 4 }}
                                title={`${scene.description} (Score: ${scene.score})`}
                              >
                                {scene.moneyFrame && <Star size={8} className="text-amber-300" />}
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-[9px] text-zinc-600">{analysis.totalDuration.toFixed(1)}s</span>
                          <span className="text-[9px] text-zinc-600">{analysis.bestSegments.length} best segments</span>
                          {analysis.scenes.some(s => s.moneyFrame) && (
                            <span className="text-[9px] text-amber-400 flex items-center gap-0.5"><Star size={8} /> Money frames</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <div className="w-full bg-[#0A0A0F] rounded-full h-1.5">
                <div
                  className="bg-gradient-to-r from-purple-600 to-amber-400 h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${analysisProgress.total ? (analysisProgress.completed / analysisProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ─── Stage 4: Preview & Edit ────────────────────── */}
      {stage === 'preview-edit' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
            {/* Left: Segment list */}
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-white">Video Segments</h3>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium ${
                    enabledDuration >= 10 && enabledDuration <= 15 ? 'text-green-400' :
                    enabledDuration > 15 ? 'text-amber-400' : 'text-zinc-400'
                  }`}>
                    {enabledDuration.toFixed(1)}s / 10-15s
                  </span>
                </div>
              </div>

              {/* Duration bar */}
              <div className="mb-4">
                <div className="relative w-full bg-[#0A0A0F] rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      enabledDuration >= 10 && enabledDuration <= 15
                        ? 'bg-gradient-to-r from-green-600 to-green-400'
                        : enabledDuration > 15
                        ? 'bg-gradient-to-r from-amber-600 to-amber-400'
                        : 'bg-gradient-to-r from-purple-600 to-purple-400'
                    }`}
                    style={{ width: `${Math.min((enabledDuration / 15) * 100, 100)}%` }}
                  />
                  {/* 10s and 15s markers */}
                  <div className="absolute top-0 h-2 border-l border-dashed border-zinc-600" style={{ left: `${(10 / 15) * 100}%` }} />
                  <div className="absolute top-0 h-2 border-l border-dashed border-zinc-600" style={{ left: '100%' }} />
                </div>
                <div className="flex justify-between mt-0.5">
                  <span className="text-[8px] text-zinc-600">0s</span>
                  <span className="text-[8px] text-zinc-600">10s</span>
                  <span className="text-[8px] text-zinc-600">15s</span>
                </div>
              </div>

              <div className="space-y-2">
                {editSegments.map((seg, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                      seg.enabled
                        ? 'border-purple-500/20 bg-purple-500/5'
                        : 'border-[#27273A] bg-[#0A0A0F] opacity-50'
                    }`}
                  >
                    {/* Enable toggle */}
                    <button
                      onClick={() => {
                        setEditSegments((prev) =>
                          prev.map((s, idx) => (idx === i ? { ...s, enabled: !s.enabled } : s))
                        );
                      }}
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all ${
                        seg.enabled
                          ? 'bg-purple-500 border-purple-400'
                          : 'border-zinc-600 hover:border-zinc-400'
                      }`}
                    >
                      {seg.enabled && <Check size={10} className="text-white" />}
                    </button>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-zinc-300">{seg.angle}</span>
                        <span className="text-[9px] text-zinc-600">
                          {seg.startTime.toFixed(1)}s - {seg.endTime.toFixed(1)}s
                        </span>
                      </div>
                      <p className="text-[9px] text-zinc-500 truncate">{seg.reason}</p>
                    </div>

                    {/* Score */}
                    <div className={`px-2 py-0.5 rounded-full text-[9px] font-medium ${
                      seg.score >= 80 ? 'bg-green-500/15 text-green-400' :
                      seg.score >= 60 ? 'bg-amber-500/15 text-amber-400' :
                      'bg-zinc-500/15 text-zinc-400'
                    }`}>
                      {seg.score}
                    </div>

                    {/* Duration */}
                    <span className="text-[10px] text-zinc-500 w-10 text-right shrink-0">
                      {(seg.endTime - seg.startTime).toFixed(1)}s
                    </span>

                    {/* Reorder */}
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        onClick={() => {
                          if (i === 0) return;
                          setEditSegments((prev) => {
                            const arr = [...prev];
                            [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                            return arr;
                          });
                        }}
                        disabled={i === 0}
                        className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"
                      >
                        <ChevronUp size={10} />
                      </button>
                      <button
                        onClick={() => {
                          if (i === editSegments.length - 1) return;
                          setEditSegments((prev) => {
                            const arr = [...prev];
                            [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                            return arr;
                          });
                        }}
                        disabled={i === editSegments.length - 1}
                        className="text-zinc-600 hover:text-zinc-300 disabled:opacity-30"
                      >
                        <ChevronDown size={10} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Settings */}
            <div className="space-y-6">
              {/* Transition */}
              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Transition</h3>
                <div className="space-y-1.5">
                  {TRANSITIONS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTransition(t.id)}
                      className={`w-full p-3 rounded-xl border text-left transition-all ${
                        transition === t.id
                          ? 'bg-purple-500/10 border-purple-500/40'
                          : 'border-[#27273A] hover:border-zinc-600 bg-[#0A0A0F]'
                      }`}
                    >
                      <span className={`text-xs font-medium ${transition === t.id ? 'text-purple-300' : 'text-zinc-300'}`}>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Summary</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Segments</span>
                    <span className="text-zinc-300">{editSegments.filter(s => s.enabled).length} of {editSegments.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Duration</span>
                    <span className="text-zinc-300">{enabledDuration.toFixed(1)}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Format</span>
                    <span className="text-zinc-300">{aspectRatio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Style</span>
                    <span className="text-zinc-300">{VIDEO_STYLES.find(s => s.id === style)?.label}</span>
                  </div>
                </div>
              </div>

              {/* Compile button */}
              <button
                onClick={compileVideo}
                disabled={editSegments.filter(s => s.enabled).length === 0}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-purple-500 text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all shadow-[0_0_15px_rgba(168,85,247,0.15)] disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                <Play size={14} />
                Compile Final Video
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* ─── Stage 5: Compiling ─────────────────────────── */}
      {stage === 'compiling' && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-8">
            <div className="flex flex-col items-center gap-4">
              <Loader size={32} className="text-purple-400 animate-spin" />
              <h3 className="text-sm font-medium text-white">Stitching Your Video</h3>
              <p className="text-xs text-zinc-500 capitalize">{compileProgress.step || 'Preparing...'}</p>
              <div className="w-full max-w-xs bg-[#0A0A0F] rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-purple-600 to-purple-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${compileProgress.progress}%` }}
                />
              </div>
              <span className="text-[10px] text-zinc-600">{compileProgress.progress}%</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* ─── Stage 6: Complete ──────────────────────────── */}
      {stage === 'complete' && finalVideo && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
            {/* Video Player */}
            <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-white">Your Video</h3>
                <span className="text-xs text-zinc-500">{finalVideo.duration.toFixed(1)}s</span>
              </div>
              <div className="rounded-xl overflow-hidden bg-black">
                <video
                  src={`data:${finalVideo.mimeType};base64,${finalVideo.base64}`}
                  controls
                  autoPlay
                  loop
                  className="w-full"
                  style={{ maxHeight: 500 }}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <button
                onClick={downloadVideo}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 text-white font-medium hover:from-purple-500 hover:to-purple-400 transition-all text-sm"
              >
                <Download size={14} /> Download MP4
              </button>

              <button
                onClick={sendToFlowBucket}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-all text-sm font-medium"
              >
                <Package size={14} /> Add to Flow Bucket
              </button>

              {selectedAccountId && (
                <button
                  onClick={saveToLibrary}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-purple-500/30 text-purple-300 hover:bg-purple-500/10 transition-all text-sm font-medium disabled:opacity-40"
                >
                  {saving ? <Loader size={14} className="animate-spin" /> : <Star size={14} />}
                  {saving ? 'Saving...' : 'Save to Library'}
                </button>
              )}

              {/* Details card */}
              <div className="bg-[#12121A] border border-[#27273A] rounded-2xl p-5 mt-4">
                <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Details</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Dish</span>
                    <span className="text-zinc-300 truncate ml-2">{dishName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Style</span>
                    <span className="text-zinc-300">{VIDEO_STYLES.find(s => s.id === style)?.label}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Format</span>
                    <span className="text-zinc-300">{aspectRatio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Duration</span>
                    <span className="text-zinc-300">{finalVideo.duration.toFixed(1)}s</span>
                  </div>
                </div>
              </div>

              <button
                onClick={resetAll}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-[#27273A] text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-all text-sm"
              >
                <RefreshCw size={14} /> Create Another
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
