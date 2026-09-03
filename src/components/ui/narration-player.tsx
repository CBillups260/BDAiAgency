import React, { useEffect, useRef, useState, type FC } from "react";
import { PlayFill, PauseFill, Rewind, FastForward } from "@geist-ui/icons";
import { cn } from "../../lib/utils";
import { AudioOrb, getAudioChain } from "./audio-orb";

/**
 * NarrationPlayer — the chapter audiobook player, styled like a small symphony
 * instead of the browser's gray default.
 *
 * Inspired by the "ai-voice-input" community component's visualizer-bar strip,
 * adapted for playback: the bars are driven by the REAL frequency spectrum of
 * the narrator's voice (shared analyser with the AudioOrb), and the strip
 * doubles as the seek bar — bars behind the playhead glow purple, bars ahead
 * wait dim, and clicking/dragging anywhere scrubs the narration.
 */

interface NarrationPlayerProps {
  src: string;
  className?: string;
  /** Parent receives the media element (read-along seeks + autoplay use it). */
  onElement?: (el: HTMLAudioElement | null) => void;
  onTimeUpdate?: () => void;
  onEnded?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Extra chip rendered at the right edge (e.g. the read-along indicator). */
  rightSlot?: React.ReactNode;
  bars?: number;
}

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEEDS = [1, 1.25, 1.5, 1.75];

export const NarrationPlayer: FC<NarrationPlayerProps> = ({
  src,
  className,
  onElement,
  onTimeUpdate,
  onEnded,
  onPlayingChange,
  rightSlot,
  bars = 56,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioNode, setAudioNode] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const barLevels = useRef<number[]>(new Array(bars).fill(0));
  const stripRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  // ── The symphony: bar heights driven by the live voice spectrum ──
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      const el = audioRef.current;
      const isPlaying = !!el && !el.paused && !el.ended;
      const dur = el?.duration || 0;
      const progress = dur > 0 && el ? el.currentTime / dur : 0;

      const chain = isPlaying && el ? getAudioChain(el) : null;
      let bins: Uint8Array | null = null;
      let lo = 0;
      let span = 0;
      if (chain) {
        chain.analyser.getByteFrequencyData(chain.data);
        const binHz = chain.ctx.sampleRate / chain.analyser.fftSize;
        lo = Math.max(1, Math.floor(85 / binHz));
        const hi = Math.min(chain.data.length - 1, Math.ceil(6000 / binHz));
        span = hi - lo;
        bins = chain.data;
      }

      for (let i = 0; i < bars; i++) {
        const node = barRefs.current[i];
        if (!node) continue;
        // Resting shape: a gentle sine "sleeping waveform".
        let target = 0.12 + 0.1 * Math.abs(Math.sin((i / bars) * Math.PI * 3));
        if (isPlaying) {
          if (bins && span > 0) {
            const v = (bins[lo + Math.floor((i / bars) * span)] || 0) / 255;
            target = 0.12 + Math.min(v * 1.5, 1) * 0.88;
          } else {
            // Analyser unavailable: synthetic ripple so the strip still plays.
            target =
              0.2 +
              0.5 *
                Math.abs(Math.sin(t * 0.004 + i * 0.55)) *
                Math.abs(Math.sin(t * 0.0013 + i * 0.21));
          }
        }
        // Fast attack, musical decay — same envelope philosophy as the orb.
        const cur = barLevels.current[i];
        const rate = target > cur ? 24 : 7;
        const next = cur + (target - cur) * Math.min(1, dt * rate);
        barLevels.current[i] = next;
        node.style.height = `${Math.round(next * 100)}%`;
        const played = i / bars <= progress;
        if (played) {
          // Violet → sky interpolation across the strip: the one accent, as a
          // gradient the playhead reveals.
          const f = i / bars;
          const r = Math.round(139 + (56 - 139) * f);
          const g = Math.round(92 + (189 - 92) * f);
          const b = Math.round(246 + (248 - 246) * f);
          node.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${0.55 + next * 0.45})`;
        } else {
          node.style.backgroundColor = `rgba(161, 161, 170, ${0.15 + next * 0.25})`;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bars]);

  // ── Scrub by pointer on the strip ──
  const seekFromPointer = (clientX: number) => {
    const el = audioRef.current;
    const strip = stripRef.current;
    if (!el || !strip || !el.duration) return;
    const rect = strip.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = frac * el.duration;
    setCurrentTime(el.currentTime);
  };

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };

  const skip = (delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.min(el.duration || 0, Math.max(0, el.currentTime + delta));
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 bg-[#0A0A0F] border border-white/[0.08] rounded-2xl px-4 py-3",
        className
      )}
    >
      <audio
        ref={(el) => {
          audioRef.current = el;
          setAudioNode(el);
          onElement?.(el);
        }}
        src={src}
        crossOrigin="anonymous"
        preload="metadata"
        className="hidden"
        onTimeUpdate={() => {
          if (!scrubbing.current) setCurrentTime(audioRef.current?.currentTime || 0);
          onTimeUpdate?.();
        }}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onDurationChange={() => setDuration(audioRef.current?.duration || 0)}
        onPlay={() => {
          setPlaying(true);
          onPlayingChange?.(true);
          if (audioRef.current) audioRef.current.playbackRate = speed;
        }}
        onPause={() => {
          setPlaying(false);
          onPlayingChange?.(false);
        }}
        onEnded={() => {
          setPlaying(false);
          onPlayingChange?.(false);
          onEnded?.();
        }}
      />

      {/* The orb — breathes with the voice. */}
      <div
        className={cn(
          "relative shrink-0 transition-all duration-700",
          playing ? "w-14 h-14" : "w-10 h-10 opacity-70"
        )}
      >
        <AudioOrb audioEl={audioNode} className="w-full h-full" />
      </div>

      {/* Transport */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => skip(-10)}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#181824] transition-all"
          title="Back 10s"
        >
          <Rewind size={14} />
        </button>
        <button
          onClick={toggle}
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center transition-all",
            "bg-gradient-to-br from-violet-600 to-sky-500 text-white",
            "hover:from-violet-500 hover:to-sky-400 shadow-[0_0_16px_rgba(139,92,246,0.25)]",
            playing && "shadow-[0_0_24px_rgba(139,92,246,0.4)]"
          )}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseFill size={16} /> : <PlayFill size={16} className="translate-x-[1px]" />}
        </button>
        <button
          onClick={() => skip(10)}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#181824] transition-all"
          title="Forward 10s"
        >
          <FastForward size={14} />
        </button>
      </div>

      <span className="text-[11px] font-mono text-zinc-500 shrink-0 w-10 text-right">
        {fmt(currentTime)}
      </span>

      {/* The visualizer strip — also the seek bar. */}
      <div
        ref={stripRef}
        className="flex-1 h-10 flex items-center gap-[2px] cursor-pointer select-none touch-none px-0.5"
        title="Click or drag to scrub"
        onPointerDown={(e) => {
          scrubbing.current = true;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) seekFromPointer(e.clientX);
        }}
        onPointerUp={() => {
          scrubbing.current = false;
        }}
        onPointerCancel={() => {
          scrubbing.current = false;
        }}
      >
        {Array.from({ length: bars }).map((_, i) => (
          <div
            key={i}
            ref={(el) => {
              barRefs.current[i] = el;
            }}
            className="flex-1 min-w-[2px] rounded-full transition-none"
            style={{ height: "12%", backgroundColor: "rgba(113,113,122,0.25)" }}
          />
        ))}
      </div>

      <span className="text-[11px] font-mono text-zinc-600 shrink-0 w-10">{fmt(duration)}</span>

      <button
        onClick={cycleSpeed}
        className="shrink-0 text-[11px] font-semibold text-zinc-400 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-lg px-2 py-1 transition-all"
        title="Playback speed"
      >
        {speed}×
      </button>

      {rightSlot}
    </div>
  );
};
