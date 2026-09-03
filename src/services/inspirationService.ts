import { authedFetch } from '../lib/api';

/**
 * Client for the /api/inspiration backend. Powers the on-demand Inspiration
 * widget under the composer: day + brand aware post ideas, plus browsable
 * reference images from Pinterest and a brand's Google reviews.
 */

export type ImageProvider = 'pinterest' | 'google-reviews';

export interface InspirationIdea {
  title: string;
  hook: string;
  idea: string;
  caption: string;
  imageQuery: string;
  hashtags: string[];
}

export interface InspirationImage {
  id: string;
  url: string;
  title?: string;
  source?: string;
  reviewText?: string;
  author?: string;
  rating?: number | null;
  provider: ImageProvider;
}

export interface BrandContext {
  company: string;
  industry?: string | null;
  description?: string | null;
  brandVoice?: string | null;
  targetAudience?: string | null;
  website?: string | null;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await authedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || res.statusText);
  return data as T;
}

/** Build a same-origin URL that proxies an external image (avoids CORS/hotlink). */
export function proxiedImageUrl(url: string): string {
  return `/api/content/image-proxy?url=${encodeURIComponent(url)}`;
}

export async function generateIdeas(input: {
  brandContext: BrandContext;
  dayOfWeek?: string;
  date?: string;
  menuItems?: { name: string; category?: string | null }[];
  themes?: { title: string; notes?: string | null }[];
  topic?: string;
  count?: number;
}): Promise<InspirationIdea[]> {
  const data = await postJson<{ ideas: InspirationIdea[] }>(
    '/api/inspiration/ideas',
    input,
  );
  return data.ideas || [];
}

/**
 * Pinterest search. Pass the `cursor` from a previous call to fetch the NEXT
 * page of results (fresh pins) instead of re-buying the same first page.
 */
export async function searchPinterest(
  query: string,
  cursor?: string | null,
): Promise<{ images: InspirationImage[]; cursor: string | null }> {
  const params = new URLSearchParams({ query });
  if (cursor) params.set('cursor', cursor);
  const res = await authedFetch(`/api/inspiration/pinterest?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || res.statusText);
  return {
    images: ((data as any).images || []) as InspirationImage[],
    cursor: (data as any).cursor ?? null,
  };
}

export async function fetchReviewPhotos(input: {
  query?: string;
  placeId?: string;
  limit?: number;
}): Promise<{ placeId: string | null; placeName: string; images: InspirationImage[]; note?: string }> {
  return postJson('/api/inspiration/review-photos', input);
}
