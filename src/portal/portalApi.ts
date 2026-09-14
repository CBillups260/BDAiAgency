/** Client-portal API helpers. No Firebase auth — a passcode session token instead. */

export interface PortalBrand {
  id: string;
  name: string;
  logo: string | null;
  color: string | null;
  connected: boolean;
  postCount?: number;
  error?: string | null;
}

export interface PortalAccount {
  id: string;
  name: string;
  platform: string | null;
  avatar: string | null;
}

export interface PortalPost {
  id: string;
  brandId: string;
  brandName: string;
  locationId: string;
  summary: string;
  scheduleDate: string;
  status: string;
  type: string;
  media: { url: string; type: string | null; thumbnail: string | null }[];
  accountIds: string[];
  accounts: PortalAccount[];
  platforms: string[];
}

export interface PortalPostsResponse {
  name: string;
  window: { from: string; to: string; days: number };
  brands: PortalBrand[];
  posts: PortalPost[];
}

export class PortalApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const tokenKey = (slug: string) => `bdai:portal:${slug}:token`;

export function readPortalToken(slug: string): string | null {
  try {
    return localStorage.getItem(tokenKey(slug));
  } catch {
    return null;
  }
}

export function writePortalToken(slug: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(tokenKey(slug), token);
    else localStorage.removeItem(tokenKey(slug));
  } catch {
    /* private mode — session just won't persist */
  }
}

async function request<T>(slug: string, path: string, init: RequestInit = {}, withToken = true): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (withToken) {
    const t = readPortalToken(slug);
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`/api/portal/public/${encodeURIComponent(slug)}${path}`, { ...init, headers });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    throw new PortalApiError(res.status, (data && typeof data.error === "string" && data.error) || res.statusText || "Request failed");
  }
  return data as T;
}

export const portalApi = {
  meta: (slug: string) => request<{ slug: string; name: string; brandCount: number }>(slug, "", {}, false),
  auth: (slug: string, passcode: string) =>
    request<{ token: string; exp: number; name: string }>(slug, "/auth", { method: "POST", body: JSON.stringify({ passcode }) }, false),
  posts: (slug: string, days = 31) => request<PortalPostsResponse>(slug, `/posts?days=${days}`),
  editCaption: (slug: string, postId: string, brandId: string, summary: string) =>
    request<{ ok: true; postId: string; summary: string }>(slug, `/posts/${encodeURIComponent(postId)}`, {
      method: "PUT",
      body: JSON.stringify({ brandId, summary }),
    }),
};
