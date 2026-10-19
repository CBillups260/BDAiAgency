import { authedFetch } from '../lib/api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Scissors,
  Trash2,
  RotateCcw,
  Download,
  Loader,
  AlertCircle,
} from '@geist-ui/icons';

/**
 * Timeline editor for an extracted video: trim the ends, cut chunks out of the
 * middle, preview the result, export the cut.
 *
 * The clip is pulled down once through /api/social/download and held as a blob
 * URL. That buys frame-accurate seeking and a filmstrip we can draw locally
 * (a blob source doesn't taint the canvas), and it is also the only way the
 * YouTube path can work at all, since those files come from yt-dlp rather than
 * a URL the browser could stream.
 *
 * `segments` are the spans to KEEP, always sorted and non-overlapping. One
 * segment is a trim; several mean the gaps between them get cut. The export
 * posts that list to /api/social/trim and ffmpeg concatenates them.
 */

interface Segment {
  id: string;
  start: number;
  end: number;
}

interface Props {
  /** Source passed straight back to the backend — CDN URL, or watch URL + #h=. */
  videoUrl: string;
  /** Runtime from the extractor, used before the video's own metadata lands. */
  duration?: number | null;
  /** Base for the exported filename. */
  defaultName?: string;
}

const MIN_SEGMENT = 0.2; // seconds — below this a segment isn't meaningful
const FILMSTRIP_FRAMES = 12;

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${cs}`;
}

const newId = () => Math.random().toString(36).slice(2, 9);

export default function VideoTimelineEditor({ videoUrl, duration: durationProp, defaultName }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(durationProp || 0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [drag, setDrag] = useState<{ id: string; edge: 'start' | 'end' } | null>(null);

  // ── Load the clip once, as a blob ──────────────────────
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      setStatus('loading');
      setError(null);
      try {
        const res = await authedFetch(
          `/api/social/download?url=${encodeURIComponent(videoUrl)}&filename=source.mp4`,
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || 'Could not load that video for editing.');
        }
        const blob = await res.blob();
        if (cancelled) return;
        const obj = URL.createObjectURL(blob);
        revoked = obj;
        setBlobUrl(obj);
        setStatus('ready');
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message);
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [videoUrl]);

  // ── Seed one full-length segment once we know the runtime ──
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : durationProp || 0;
    setDuration(d);
    setSegments([{ id: newId(), start: 0, end: d }]);
    void buildFilmstrip(d);
  };

  /**
   * Draw evenly spaced frames into a filmstrip. Seeking and painting one frame
   * at a time is slow but predictable; the strip is decorative, so failures
   * (codec quirks, a seek that never resolves) just leave it empty.
   */
  const buildFilmstrip = useCallback(async (d: number) => {
    const v = videoRef.current;
    if (!v || !d) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 160;
    canvas.height = Math.max(1, Math.round((160 * (v.videoHeight || 9)) / (v.videoWidth || 16)));

    const shots: string[] = [];
    for (let i = 0; i < FILMSTRIP_FRAMES; i++) {
      const t = (d / FILMSTRIP_FRAMES) * (i + 0.5);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('seek timeout')), 3000);
          const done = () => {
            clearTimeout(timer);
            v.removeEventListener('seeked', done);
            resolve();
          };
          v.addEventListener('seeked', done);
          v.currentTime = Math.min(t, d - 0.05);
        });
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        shots.push(canvas.toDataURL('image/jpeg', 0.6));
      } catch {
        break;
      }
    }
    v.currentTime = 0;
    setFrames(shots);
  }, []);

  // ── Playback: skip the cut gaps so preview == export ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const t = v.currentTime;
      setPlayhead(t);
      if (!segments.length) return;
      const inside = segments.some((s) => t >= s.start - 0.01 && t <= s.end + 0.01);
      if (inside) return;
      const next = segments.find((s) => s.start > t);
      if (next) v.currentTime = next.start;
      else {
        v.pause();
        v.currentTime = segments[0].start;
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [segments]);

  // ── Timeline geometry ──────────────────────────────────
  const pctOf = (t: number) => (duration ? (t / duration) * 100 : 0);

  const timeAtClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || !duration) return 0;
      const r = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return ratio * duration;
    },
    [duration],
  );

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(t, 0), duration);
    setPlayhead(v.currentTime);
  };

  // ── Handle dragging ────────────────────────────────────
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const t = timeAtClientX(e.clientX);
      setSegments((prev) => {
        const i = prev.findIndex((s) => s.id === drag.id);
        if (i === -1) return prev;
        const seg = prev[i];
        // Stay inside the neighbours so segments can't cross or overlap.
        const lo = i > 0 ? prev[i - 1].end : 0;
        const hi = i < prev.length - 1 ? prev[i + 1].start : duration;
        const next = [...prev];
        next[i] =
          drag.edge === 'start'
            ? { ...seg, start: Math.min(Math.max(t, lo), seg.end - MIN_SEGMENT) }
            : { ...seg, end: Math.max(Math.min(t, hi), seg.start + MIN_SEGMENT) };
        return next;
      });
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag, duration, timeAtClientX]);

  // ── Segment operations ─────────────────────────────────
  const splitAtPlayhead = () => {
    setSegments((prev) => {
      const i = prev.findIndex((s) => playhead > s.start + MIN_SEGMENT && playhead < s.end - MIN_SEGMENT);
      if (i === -1) return prev;
      const seg = prev[i];
      return [
        ...prev.slice(0, i),
        { id: newId(), start: seg.start, end: playhead },
        { id: newId(), start: playhead, end: seg.end },
        ...prev.slice(i + 1),
      ];
    });
  };

  const removeSegment = (id: string) => setSegments((prev) => prev.filter((s) => s.id !== id));

  const reset = () => setSegments([{ id: newId(), start: 0, end: duration }]);

  const keptDuration = useMemo(
    () => segments.reduce((sum, s) => sum + (s.end - s.start), 0),
    [segments],
  );

  const splittable = segments.some(
    (s) => playhead > s.start + MIN_SEGMENT && playhead < s.end - MIN_SEGMENT,
  );

  // ── Export ─────────────────────────────────────────────
  const exportEdit = async () => {
    if (!segments.length || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const fname = `${(defaultName || 'clip').replace(/[^a-z0-9._-]/gi, '_')}-edit.mp4`;
      const res = await authedFetch('/api/social/trim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl,
          duration,
          filename: fname,
          segments: segments.map((s) => ({ start: s.start, end: s.end })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Export failed');
      }
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = obj;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(obj);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-[#27273A] bg-[#0A0A0F] p-6 text-sm text-zinc-400">
        <Loader size={16} className="animate-spin text-purple-400" />
        Loading the clip for editing — YouTube pulls can take a minute.
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mt-5 flex items-start gap-2 rounded-2xl border border-red-500/25 bg-red-500/5 p-4 text-xs text-red-300">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4 rounded-2xl border border-[#27273A] bg-[#0A0A0F] p-4 sm:p-5">
      {/* Preview */}
      <video
        ref={videoRef}
        src={blobUrl || undefined}
        onLoadedMetadata={onLoadedMetadata}
        playsInline
        className="w-full max-h-[52dvh] rounded-xl bg-black"
        controls={false}
      />

      {/* Transport */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) {
              if (!segments.some((s) => v.currentTime >= s.start && v.currentTime <= s.end)) {
                v.currentTime = segments[0]?.start ?? 0;
              }
              void v.play();
            } else {
              v.pause();
            }
          }}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-purple-500 px-4 py-2.5 text-sm font-medium text-white transition-all hover:from-purple-500 hover:to-purple-400"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? 'Pause' : 'Preview edit'}
        </button>

        <button
          onClick={splitAtPlayhead}
          disabled={!splittable}
          title={splittable ? 'Split at the playhead' : 'Move the playhead inside a segment to split'}
          className="flex items-center gap-2 rounded-xl border border-[#27273A] bg-[#12121A] px-4 py-2.5 text-sm text-zinc-300 transition-all hover:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Scissors size={14} /> Split
        </button>

        <button
          onClick={reset}
          className="flex items-center gap-2 rounded-xl border border-[#27273A] bg-[#12121A] px-4 py-2.5 text-sm text-zinc-300 transition-all hover:border-zinc-600"
        >
          <RotateCcw size={14} /> Reset
        </button>

        <div className="ml-auto text-xs tabular-nums text-zinc-500">
          {fmt(playhead)} / {fmt(duration)}
          <span className="ml-3 text-purple-300">keeping {fmt(keptDuration)}</span>
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.handle) return;
          seekTo(timeAtClientX(e.clientX));
        }}
        className="relative h-20 w-full cursor-pointer select-none overflow-hidden rounded-xl border border-[#27273A] bg-[#12121A]"
      >
        {/* Filmstrip */}
        <div className="pointer-events-none absolute inset-0 flex">
          {frames.length > 0 ? (
            frames.map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                className="h-full flex-1 object-cover opacity-55"
                style={{ minWidth: 0 }}
              />
            ))
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] text-zinc-600">
              building filmstrip…
            </div>
          )}
        </div>

        {/* Everything outside a kept segment is dimmed */}
        <div className="pointer-events-none absolute inset-0 bg-black/60" />
        {segments.map((s) => (
          <div
            key={s.id}
            className="pointer-events-none absolute inset-y-0 border-y-2 border-purple-500/70 bg-purple-500/10"
            style={{ left: `${pctOf(s.start)}%`, width: `${pctOf(s.end - s.start)}%` }}
          />
        ))}

        {/* Drag handles */}
        {segments.map((s) => (
          <React.Fragment key={`h-${s.id}`}>
            <div
              data-handle="1"
              onPointerDown={(e) => {
                e.stopPropagation();
                setDrag({ id: s.id, edge: 'start' });
              }}
              title="Drag to trim the start"
              className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-purple-400 hover:bg-purple-300"
              style={{ left: `${pctOf(s.start)}%` }}
            />
            <div
              data-handle="1"
              onPointerDown={(e) => {
                e.stopPropagation();
                setDrag({ id: s.id, edge: 'end' });
              }}
              title="Drag to trim the end"
              className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded bg-purple-400 hover:bg-purple-300"
              style={{ left: `${pctOf(s.end)}%` }}
            />
          </React.Fragment>
        ))}

        {/* Playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white"
          style={{ left: `${pctOf(playhead)}%` }}
        />
      </div>

      {/* Segment list */}
      <div className="space-y-1.5">
        {segments.map((s, i) => (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-[#27273A] bg-[#12121A] px-3 py-2 text-xs"
          >
            <span className="font-medium text-zinc-400">#{i + 1}</span>
            <span className="tabular-nums text-zinc-300">
              {fmt(s.start)} → {fmt(s.end)}
            </span>
            <span className="text-zinc-600">({fmt(s.end - s.start)})</span>
            <button
              onClick={() => seekTo(s.start)}
              className="ml-auto rounded-lg px-2 py-1 text-zinc-500 transition-colors hover:text-purple-300"
            >
              Go to
            </button>
            <button
              onClick={() => removeSegment(s.id)}
              disabled={segments.length === 1}
              title={segments.length === 1 ? 'Split first, then you can cut a piece out' : 'Cut this piece out'}
              className="rounded-lg p-1.5 text-zinc-600 transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={exportEdit}
          disabled={exporting || !segments.length}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-2.5 text-sm font-medium text-white transition-all hover:from-emerald-500 hover:to-emerald-400 disabled:opacity-50"
        >
          {exporting ? <Loader size={14} className="animate-spin" /> : <Download size={14} />}
          {exporting ? 'Rendering…' : `Export ${fmt(keptDuration)}`}
        </button>
        <p className="text-[10px] text-zinc-600">
          Re-encoded server-side so the cuts land exactly where you put them.
        </p>
      </div>
    </div>
  );
}
