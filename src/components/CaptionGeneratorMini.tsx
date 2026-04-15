import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Loader, Image as ImageIcon, Check } from "@geist-ui/icons";
import { useFirestoreAccounts } from "../hooks/useFirestore";

const PLATFORMS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "twitter", label: "X" },
  { id: "tiktok", label: "TikTok" },
];

const CAPTION_STYLES = [
  { id: "short-sweet", label: "Short & Sweet", desc: "1-2 punchy sentences" },
  { id: "long-form", label: "Long Form", desc: "Storytelling, detailed" },
  { id: "engaging", label: "Engaging", desc: "Questions, polls, CTAs" },
  { id: "witty", label: "Witty", desc: "Wordplay, puns, humor" },
  { id: "bold", label: "Bold & Direct", desc: "Strong statements" },
  { id: "storytelling", label: "Storytelling", desc: "Mini narrative" },
  { id: "hype", label: "Hype", desc: "Excited energy, FOMO" },
  { id: "chill", label: "Chill & Casual", desc: "Laid-back, effortless" },
  { id: "emotional", label: "Emotional", desc: "Heartfelt, sentimental" },
  { id: "educational", label: "Educational", desc: "Tips, facts, insights" },
  { id: "trendy", label: "Trendy", desc: "Current slang, viral" },
  { id: "professional", label: "Professional", desc: "Polished, brand-forward" },
  { id: "promo", label: "Promo / Sale", desc: "Deals, urgency" },
  { id: "seasonal", label: "Seasonal", desc: "Holiday, time-of-year" },
  { id: "fomo", label: "FOMO", desc: "Scarcity, exclusivity" },
  { id: "question", label: "Question Hook", desc: "Opens with a question" },
  { id: "listicle", label: "Listicle", desc: "Top 3, numbered" },
  { id: "testimonial", label: "Testimonial", desc: "Customer voice" },
  { id: "nostalgic", label: "Nostalgic", desc: "Throwback, memories" },
  { id: "inspirational", label: "Inspirational", desc: "Motivational" },
  { id: "behind-scenes", label: "Behind the Scenes", desc: "Insider look" },
  { id: "controversial", label: "Hot Take", desc: "Debate starter" },
  { id: "minimal", label: "Minimal", desc: "5 words or less" },
  { id: "poetic", label: "Poetic", desc: "Lyrical, artistic" },
] as const;

async function urlToBase64AndMime(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = r.result as string;
        resolve(s.includes(",") ? s.split(",")[1] : s);
      };
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(blob);
    });
    return { base64, mimeType };
  } catch {
    return null;
  }
}

async function fetchImageBase64ViaServer(url: string): Promise<{ base64: string; mimeType: string } | null> {
  if (!url.startsWith("https://")) return null;
  try {
    const res = await fetch("/api/content/fetch-image-base64", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as { base64?: string; mimeType?: string; error?: string };
    if (!res.ok || !data.base64) return null;
    return { base64: data.base64, mimeType: data.mimeType || "image/jpeg" };
  } catch {
    return null;
  }
}

/**
 * Caption AI for AI Scheduler — uses the single post image from the parent (upload or handoff).
 */
export default function CaptionGeneratorMini({
  accountId,
  postImageUrl,
  /** When the parent already has pixels (file picker), pass base64 so we never rely on fetch(blob/https). */
  postImageDataBase64,
  postImageDataMimeType,
  topicHint,
  onApplyCaption,
  autoSuggestWhenImageReady = true,
}: {
  accountId: string | null;
  postImageUrl: string | null;
  postImageDataBase64?: string | null;
  postImageDataMimeType?: string | null;
  topicHint?: string;
  onApplyCaption: (text: string) => void;
  autoSuggestWhenImageReady?: boolean;
}) {
  const { accounts } = useFirestoreAccounts();
  const account = accounts.find((a) => a.id === accountId) ?? null;

  const [platform, setPlatform] = useState("instagram");
  const [captionStyle, setCaptionStyle] = useState("short-sweet");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState("image/jpeg");
  const [syncingImage, setSyncingImage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captions, setCaptions] = useState<string[]>([]);
  const [pickIdx, setPickIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [showStylePicker, setShowStylePicker] = useState(true);

  const topicFromHint = topicHint?.trim() ?? "";

  const imageIdentityKey = useMemo(() => {
    if (postImageDataBase64 && postImageDataBase64.length > 0) {
      return `inj:${postImageDataBase64.length}:${postImageDataBase64.slice(0, 48)}`;
    }
    return postImageUrl?.trim() || "";
  }, [postImageDataBase64, postImageUrl]);

  useEffect(() => {
    setCaptions([]);
    setPickIdx(0);
  }, [imageIdentityKey]);

  useEffect(() => {
    setError(null);
    if (postImageDataBase64 && postImageDataBase64.length > 0) {
      setImageBase64(postImageDataBase64);
      setImageMimeType(postImageDataMimeType?.trim() || "image/jpeg");
      setSyncingImage(false);
      return;
    }

    if (!postImageUrl?.trim()) {
      setImageBase64(null);
      setSyncingImage(false);
      return;
    }

    let cancelled = false;
    setSyncingImage(true);
    setImageBase64(null);
    void (async () => {
      let parsed = await urlToBase64AndMime(postImageUrl);
      if (!parsed && postImageUrl.startsWith("https://")) {
        parsed = await fetchImageBase64ViaServer(postImageUrl);
      }
      if (cancelled) return;
      if (parsed) {
        setImageBase64(parsed.base64);
        setImageMimeType(parsed.mimeType);
      } else {
        setImageBase64(null);
        setError(
          "Couldn’t read this image for caption AI. If it’s from a handoff, ensure the dev server is running so we can load it securely."
        );
      }
      setSyncingImage(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [postImageUrl, postImageDataBase64, postImageDataMimeType]);

  const generate = useCallback(async () => {
    if (!account) return;
    const hasMedia = !!imageBase64;
    if (!hasMedia && !topicFromHint) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/generate-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandContext: {
            company: account.company,
            industry: account.industry,
            description: account.description,
            brandVoice: account.brandVoice,
            targetAudience: account.targetAudience,
            socialHandles: account.socialHandles,
          },
          ...(hasMedia ? { media: [{ base64: imageBase64!, mimeType: imageMimeType }] } : { media: [] }),
          ...(topicFromHint ? { topic: topicFromHint } : {}),
          platform,
          captionStyle,
          includeHashtags,
          includeEmojis: false,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = "Couldn't generate captions.";
        try {
          const body = JSON.parse(text);
          msg = body.error || msg;
        } catch {
          if (text) msg = text;
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as { captions?: string[] };
      const list = Array.isArray(data.captions) ? data.captions : [];
      setCaptions(list);
      setPickIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setCaptions([]);
    } finally {
      setLoading(false);
    }
  }, [account, imageBase64, imageMimeType, platform, captionStyle, includeHashtags, topicFromHint]);

  const activeCaption = captions[pickIdx] ?? "";
  const busy = loading || syncingImage;
  const hasImage = !!postImageUrl?.trim();

  const selectedStyleLabel = CAPTION_STYLES.find((s) => s.id === captionStyle)?.label || "Short & Sweet";

  return (
    <div className="rounded-xl border border-purple-500/25 bg-[#0c0c12] p-4 space-y-3 shadow-[0_0_0_1px_rgba(168,85,247,0.08)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">Write caption with AI</p>
        <span className="text-[10px] text-zinc-500">Uses post image above + brand from Accounts</span>
      </div>

      {!accountId || !account ? (
        <p className="text-xs text-zinc-500 py-2">Choose a client above to unlock caption ideas.</p>
      ) : (
        <>
          {/* Platform row */}
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlatform(p.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                  platform === p.id
                    ? "border-purple-500/40 bg-purple-500/10 text-purple-200"
                    : "border-[#2a2a38] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Caption Style Picker */}
          <div>
            <button
              type="button"
              onClick={() => setShowStylePicker(!showStylePicker)}
              className="flex items-center gap-2 w-full text-left mb-2"
            >
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Caption Style</p>
              <span className="text-[10px] text-purple-300 font-medium">{selectedStyleLabel}</span>
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="currentColor"
                className={`text-zinc-500 transition-transform ${showStylePicker ? "rotate-180" : ""}`}
              >
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </svg>
            </button>
            {showStylePicker && (
              <div className="grid grid-cols-3 gap-1 max-h-48 overflow-y-auto pr-1">
                {CAPTION_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setCaptionStyle(s.id)}
                    className={`px-1.5 py-2 rounded-lg border text-center transition-all ${
                      captionStyle === s.id
                        ? "bg-purple-500/10 border-purple-500/30"
                        : "border-[#2a2a38] bg-[#0a0a0f] hover:border-zinc-600"
                    }`}
                  >
                    <p className={`text-[10px] font-semibold leading-tight ${captionStyle === s.id ? "text-purple-300" : "text-zinc-300"}`}>
                      {s.label}
                    </p>
                    <p className="text-[7px] text-zinc-500 mt-0.5 leading-tight">{s.desc}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Image preview + controls */}
          <div className="flex gap-3">
            <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-[#2a2a38] shrink-0 bg-black/40 flex items-center justify-center">
              {hasImage ? (
                <>
                  <img src={postImageUrl!} alt="" className="w-full h-full object-cover" />
                  {busy && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <Loader size={18} className="text-purple-400 animate-spin" />
                    </div>
                  )}
                </>
              ) : (
                <span className="text-[10px] text-zinc-600 text-center px-2 leading-snug">No post image yet</span>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                Pick a <span className="text-purple-300">caption style</span> above, then generate.
                Handoffs load the image automatically.
              </p>
              <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeHashtags}
                  onChange={(e) => setIncludeHashtags(e.target.checked)}
                  className="rounded border-zinc-600 accent-purple-500"
                />
                Include hashtags
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => generate()}
                  disabled={busy || (!imageBase64 && !topicFromHint)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-violet-500 text-xs font-medium text-white disabled:opacity-45"
                >
                  {loading ? <Loader size={12} className="animate-spin" /> : <ImageIcon size={12} />}
                  {captions.length ? "Regenerate" : "Generate captions"}
                </button>
              </div>
              {!imageBase64 && topicFromHint ? (
                <p className="text-[10px] text-zinc-600">Text-only: using your post caption as the topic.</p>
              ) : null}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          {captions.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Pick one</p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {captions.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPickIdx(i)}
                    className={`w-full text-left text-xs rounded-lg px-3 py-2.5 border transition-colors ${
                      pickIdx === i
                        ? "border-purple-500/40 bg-purple-500/10 text-zinc-100"
                        : "border-[#2a2a38] text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    <span className="line-clamp-3 whitespace-pre-line">{c}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => activeCaption && onApplyCaption(activeCaption)}
                disabled={!activeCaption}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/[0.08] border border-white/[0.12] text-sm font-medium text-white hover:bg-white/[0.12] disabled:opacity-40"
              >
                <Check size={14} className="text-emerald-400" />
                Use this caption for your post
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
