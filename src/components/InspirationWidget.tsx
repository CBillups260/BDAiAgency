import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Zap,
  Loader,
  Plus,
  Check,
  Search,
  RefreshCw,
  Copy,
  ChevronDown,
  ChevronUp,
} from '@geist-ui/icons';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  generateIdeas,
  searchPinterest,
  fetchReviewPhotos,
  proxiedImageUrl,
  type InspirationIdea,
  type InspirationImage,
  type ImageProvider,
} from '../services/inspirationService';

interface WidgetAccount {
  id: string;
  company: string;
  name?: string | null;
  industry?: string | null;
  description?: string | null;
  brandVoice?: string | null;
  targetAudience?: string | null;
  website?: string | null;
}

interface InspirationWidgetProps {
  account: WidgetAccount;
  /** Menu items / offerings for richer, on-brand idea generation. */
  menuItems?: { name: string; category?: string | null }[];
  /** Adds an external image URL to the active composer tab as a reference. */
  onAddReference: (url: string) => void | Promise<void>;
  /** Drops idea text into the active composer prompt. */
  onUseIdea: (text: string) => void;
}

const PANEL = 'bg-[#12121A] border border-[#27273A] rounded-2xl';
const BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#27273A] text-[11px] font-medium text-zinc-300 px-2.5 py-1.5 hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

const PIN_PAGE = 12; // images shown per "page" / regenerate

/** Per-query Pinterest browse state, kept in a ref to avoid stale closures. */
interface PinBrowse {
  query: string;
  cursor: string | null; // next-page token; null once exhausted
  pool: InspirationImage[]; // fetched-but-not-yet-shown (fresh) pins
  seen: Set<string>; // pin IDs already shown/pooled this session
  fetched: boolean; // whether we've made at least one API call for this query
}
const freshPinBrowse = (query = ''): PinBrowse => ({
  query,
  cursor: null,
  pool: [],
  seen: new Set<string>(),
  fetched: false,
});

export default function InspirationWidget({
  account,
  menuItems = [],
  onAddReference,
  onUseIdea,
}: InspirationWidgetProps) {
  const { dayOfWeek, dateLabel, dateISO } = useMemo(() => {
    const now = new Date();
    return {
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
      dateLabel: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
      dateISO: now.toISOString().slice(0, 10),
    };
  }, []);

  const [collapsed, setCollapsed] = usePersistedState('composer.inspiration.collapsed', false);
  const [provider, setProvider] = usePersistedState<ImageProvider>(
    'composer.inspiration.provider',
    'pinterest',
  );

  const [topic, setTopic] = useState('');
  const [ideas, setIdeas] = useState<InspirationIdea[] | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const [pinQuery, setPinQuery] = useState('');
  const [pinActiveQuery, setPinActiveQuery] = useState('');
  const pinRef = useRef<PinBrowse>(freshPinBrowse());
  const [images, setImages] = useState<InspirationImage[] | null>(null);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [imagesNote, setImagesNote] = useState<string | null>(null);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);

  // Reset everything when the selected brand changes.
  useEffect(() => {
    setIdeas(null);
    setIdeasError(null);
    setExpanded(null);
    setImages(null);
    setImagesError(null);
    setImagesNote(null);
    setPlaceId(null);
    setAddedIds(new Set());
    setTopic('');
    setPinQuery('');
    setPinActiveQuery('');
    pinRef.current = freshPinBrowse();
  }, [account.id]);

  const brandContext = useMemo(
    () => ({
      company: account.company,
      industry: account.industry,
      description: account.description,
      brandVoice: account.brandVoice,
      targetAudience: account.targetAudience,
      website: account.website,
    }),
    [account],
  );

  const runIdeas = useCallback(async () => {
    setIdeasLoading(true);
    setIdeasError(null);
    try {
      const result = await generateIdeas({
        brandContext,
        dayOfWeek,
        date: dateISO,
        menuItems,
        topic: topic.trim() || undefined,
        count: 4,
      });
      setIdeas(result);
      setExpanded(null);
    } catch (e: any) {
      setIdeasError(e?.message || 'Could not generate ideas.');
    } finally {
      setIdeasLoading(false);
    }
  }, [brandContext, dayOfWeek, dateISO, menuItems, topic]);

  const loadPinterest = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setPinQuery(q);
    setPinActiveQuery(q);
    setImagesError(null);
    setImagesNote(null);

    let st = pinRef.current;
    if (q !== st.query) {
      // Brand-new search — start a fresh browse session for this query.
      st = freshPinBrowse(q);
      pinRef.current = st;
      setImages(null);
    }

    // Serve the next batch straight from the local pool — no API call, no credits.
    if (st.pool.length >= PIN_PAGE) {
      setImages(st.pool.slice(0, PIN_PAGE));
      st.pool = st.pool.slice(PIN_PAGE);
      return;
    }

    setImagesLoading(true);
    try {
      let apiCalls = 0;
      // Refill the pool with FRESH pins (via cursor) until we can show a full
      // page or we run out of new results.
      while (st.pool.length < PIN_PAGE) {
        if (st.fetched && !st.cursor) break; // already paged to the end
        const { images: fetched, cursor: next } = await searchPinterest(q, st.cursor);
        st.fetched = true;
        st.cursor = next;
        apiCalls++;
        const fresh = fetched.filter((im) => im.url && !st.seen.has(im.id));
        fresh.forEach((im) => st.seen.add(im.id));
        st.pool.push(...fresh);
        if (!next) break; // no more pages
        if (fresh.length === 0) break; // page was all duplicates — stop, don't burn credits
        if (apiCalls >= 3) break; // hard safety cap per click
      }

      const batch = st.pool.slice(0, PIN_PAGE);
      st.pool = st.pool.slice(PIN_PAGE);
      setImages(batch);

      if (!batch.length) {
        setImagesNote(
          st.fetched
            ? "That's all the fresh pins for this search — try a different one."
            : 'No pins found — try a different search.',
        );
      } else if (!st.pool.length && !st.cursor) {
        setImagesNote("You've reached the end of fresh results for this search.");
      }
    } catch (e: any) {
      setImagesError(e?.message || 'Could not load Pinterest images.');
    } finally {
      setImagesLoading(false);
    }
  }, []);

  const loadReviewPhotos = useCallback(async () => {
    setImagesLoading(true);
    setImagesError(null);
    setImagesNote(null);
    try {
      const result = await fetchReviewPhotos({
        query: placeId ? undefined : account.company,
        placeId: placeId || undefined,
        limit: 16,
      });
      if (result.placeId) setPlaceId(result.placeId);
      setImages(result.images);
      if (result.note) setImagesNote(result.note);
    } catch (e: any) {
      setImagesError(e?.message || 'Could not load review photos.');
    } finally {
      setImagesLoading(false);
    }
  }, [account.company, placeId]);

  const findImagesForIdea = useCallback(
    (idea: InspirationIdea) => {
      if (provider === 'pinterest') {
        loadPinterest(idea.imageQuery || idea.title);
      } else {
        loadReviewPhotos();
      }
    },
    [provider, loadPinterest, loadReviewPhotos],
  );

  const switchProvider = (next: ImageProvider) => {
    if (next === provider) return;
    setProvider(next);
    setImages(null);
    setImagesError(null);
    setImagesNote(null);
  };

  const handleAdd = useCallback(
    async (img: InspirationImage) => {
      if (addedIds.has(img.id) || addingId) return;
      setAddingId(img.id);
      try {
        await onAddReference(img.url);
        setAddedIds((prev) => new Set(prev).add(img.id));
      } finally {
        setAddingId(null);
      }
    },
    [addedIds, addingId, onAddReference],
  );

  const copyCaption = (idx: number, text: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(idx);
      setTimeout(() => setCopied((c) => (c === idx ? null : c)), 1500);
    });
  };

  return (
    <div className={PANEL}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/15 text-purple-300">
            <Zap size={15} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Inspiration</h3>
            <p className="text-[11px] text-zinc-500">
              It&apos;s {dayOfWeek}, {dateLabel} · {account.company}
            </p>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300 transition-colors"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {!collapsed && (
        <div className="px-5 pb-5 space-y-5">
          {/* Idea generation */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !ideasLoading) runIdeas();
                }}
                placeholder={`Optional theme for today — e.g. "Martini Monday", "weekend special"`}
                className="flex-1 rounded-lg bg-[#0A0A0F] border border-[#27273A] px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50"
              />
              <button
                onClick={runIdeas}
                disabled={ideasLoading}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 text-xs font-medium text-purple-200 px-3.5 py-2 hover:bg-purple-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {ideasLoading ? (
                  <>
                    <Loader size={13} className="animate-spin" /> Thinking…
                  </>
                ) : (
                  <>
                    <Zap size={13} /> {ideas ? 'New ideas' : 'Get ideas'}
                  </>
                )}
              </button>
            </div>

            {ideasError && <p className="text-[11px] text-red-400">{ideasError}</p>}

            {ideas && ideas.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {ideas.map((idea, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[#27273A] bg-[#0A0A0F] p-3.5 flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-100">{idea.title}</span>
                    </div>
                    {idea.hook && (
                      <p className="text-[12px] text-purple-200/90 italic leading-snug">
                        “{idea.hook}”
                      </p>
                    )}
                    {idea.idea && (
                      <p className="text-[11px] text-zinc-400 leading-relaxed">{idea.idea}</p>
                    )}

                    {expanded === i && idea.caption && (
                      <div className="rounded-lg bg-[#12121A] border border-[#27273A] p-2.5 mt-0.5">
                        <p className="text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                          {idea.caption}
                        </p>
                        {idea.hashtags?.length > 0 && (
                          <p className="text-[10px] text-purple-300/70 mt-1.5">
                            {idea.hashtags.join(' ')}
                          </p>
                        )}
                        <button
                          onClick={() => copyCaption(i, idea.caption)}
                          className="mt-2 inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                        >
                          {copied === i ? <Check size={11} /> : <Copy size={11} />}
                          {copied === i ? 'Copied' : 'Copy caption'}
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-1">
                      <button className={BTN} onClick={() => onUseIdea(idea.idea || idea.hook)}>
                        <Plus size={12} /> Use idea
                      </button>
                      <button className={BTN} onClick={() => findImagesForIdea(idea)}>
                        <Search size={12} /> Find images
                      </button>
                      {idea.caption && (
                        <button
                          className={BTN}
                          onClick={() => setExpanded(expanded === i ? null : i)}
                        >
                          {expanded === i ? 'Hide caption' : 'Caption'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reference images */}
          <div className="space-y-3 border-t border-[#27273A] pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              {/* Source toggle */}
              <div className="inline-flex rounded-lg border border-[#27273A] p-0.5 bg-[#0A0A0F]">
                {(['pinterest', 'google-reviews'] as ImageProvider[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => switchProvider(p)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      provider === p
                        ? 'bg-purple-500/20 text-purple-200'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {p === 'pinterest' ? 'Pinterest' : 'Google reviews'}
                  </button>
                ))}
              </div>

              {provider === 'pinterest' ? (
                <div className="flex-1 flex gap-2">
                  <input
                    value={pinQuery}
                    onChange={(e) => setPinQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !imagesLoading) loadPinterest(pinQuery);
                    }}
                    placeholder="Search Pinterest — e.g. plated pasta, cozy cafe"
                    className="flex-1 rounded-lg bg-[#0A0A0F] border border-[#27273A] px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50"
                  />
                  <button
                    className={BTN}
                    onClick={() => loadPinterest(pinQuery)}
                    disabled={imagesLoading || !pinQuery.trim()}
                  >
                    <Search size={12} /> Search
                  </button>
                </div>
              ) : (
                <button
                  className={BTN + ' sm:ml-auto'}
                  onClick={loadReviewPhotos}
                  disabled={imagesLoading}
                >
                  <RefreshCw size={12} /> Load {account.company}&apos;s review photos
                </button>
              )}
            </div>

            {imagesError && <p className="text-[11px] text-red-400">{imagesError}</p>}

            {imagesLoading && (
              <div className="flex items-center gap-2 text-[11px] text-zinc-500 py-6 justify-center">
                <Loader size={14} className="animate-spin" /> Pulling images…
              </div>
            )}

            {!imagesLoading && images && images.length > 0 && (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {images.map((img) => {
                    const added = addedIds.has(img.id);
                    return (
                      <button
                        key={img.id}
                        onClick={() => handleAdd(img)}
                        disabled={added || !!addingId}
                        title={img.reviewText || img.title || 'Add as reference'}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-[#27273A] bg-[#0A0A0F]"
                      >
                        <img
                          src={proxiedImageUrl(img.url)}
                          alt={img.title || 'inspiration'}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                        <div
                          className={`absolute inset-0 flex items-center justify-center transition-opacity ${
                            added ? 'bg-emerald-500/30 opacity-100' : 'bg-black/45 opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          {addingId === img.id ? (
                            <Loader size={16} className="animate-spin text-white" />
                          ) : added ? (
                            <Check size={18} className="text-white" />
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-1 text-[10px] font-medium text-white">
                              <Plus size={11} /> Reference
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-zinc-600">
                    {provider === 'pinterest'
                      ? 'Pinterest results · click any image to add it as a reference.'
                      : 'Customer photos from Google reviews · click to add as a reference.'}
                  </p>
                  {provider === 'pinterest' && (
                    <button
                      className={BTN}
                      onClick={() => loadPinterest(pinActiveQuery || pinQuery)}
                      disabled={imagesLoading || !(pinActiveQuery || pinQuery).trim()}
                      title="Cycle in fresh pins (uses your saved pool first to save credits)"
                    >
                      <RefreshCw size={12} /> More fresh
                    </button>
                  )}
                </div>
              </>
            )}

            {!imagesLoading && imagesNote && (!images || images.length === 0) && (
              <p className="text-[11px] text-zinc-500 py-2">{imagesNote}</p>
            )}

            {!imagesLoading && !images && !imagesNote && (
              <p className="text-[11px] text-zinc-600 py-2">
                {provider === 'pinterest'
                  ? 'Search Pinterest above, or hit “Find images” on an idea to pull visual references.'
                  : `Pull real customer photos from ${account.company}'s Google reviews — great shareable content.`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
