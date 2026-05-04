import { useState, useCallback } from "react";
import { authedFetch } from "../lib/api";

const API_BASE = "/api";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await authedFetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export function useProspecting() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchBusiness = useCallback(
    async (businessName: string, location?: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ results: any[] }>("/prospecting/search", {
          method: "POST",
          body: JSON.stringify({ businessName, location }),
        });
        return data.results;
      } catch (err: any) {
        setError(err.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const findFacebookUrl = useCallback(
    async (businessName: string, location?: string) => {
      try {
        const data = await apiFetch<{ facebookUrl: string | null }>(
          "/prospecting/find-facebook",
          {
            method: "POST",
            body: JSON.stringify({ businessName, location }),
          }
        );
        return data.facebookUrl;
      } catch {
        return null;
      }
    },
    []
  );

  const enrichFacebook = useCallback(async (facebookUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ profile: any; posts: any[] }>(
        "/prospecting/enrich",
        {
          method: "POST",
          body: JSON.stringify({ facebookUrl }),
        }
      );
      return data;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const draftOutreach = useCallback(
    async (
      prospect: {
        businessName: string;
        email: string;
        category: string;
        address: string;
        website: string;
        pageIntro: string;
        recentPosts: { text: string; date: string }[];
        googleRating: number | null;
        googleReviewCount: number | null;
        followerCount: number;
        prospectLat: number | null;
        prospectLng: number | null;
      },
      serviceName: string,
      serviceDescription: string,
      sender?: {
        userName?: string;
        userEmail?: string;
        agencyName?: string;
        agencyDescription?: string;
        agencyWebsite?: string;
        agencyEmail?: string;
        agencyPhone?: string;
        ownerName?: string;
        ownerTitle?: string;
        brandVoice?: string;
        valuePropositions?: string[];
        caseStudies?: string;
        signOffName?: string;
        agencyLat?: number;
        agencyLng?: number;
        localRadiusMiles?: number;
      }
    ) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{
          drafts: {
            dayNumber: number;
            emailSubject: string;
            emailBody: string;
            dmBody: string;
          }[];
        }>("/prospecting/draft-emails", {
          method: "POST",
          body: JSON.stringify({ prospect, serviceName, serviceDescription, sender }),
        });
        return data.drafts;
      } catch (err: any) {
        setError(err.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const getGmailAuthUrl = useCallback(async () => {
    try {
      const data = await apiFetch<{ url: string }>("/prospecting/gmail/auth-url");
      return data.url;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, []);

  const getGmailStatus = useCallback(async () => {
    try {
      return await apiFetch<{ connected: boolean; email: string | null }>(
        "/prospecting/gmail/status"
      );
    } catch {
      return { connected: false, email: null };
    }
  }, []);

  const sendEmail = useCallback(
    async (to: string, subject: string, body: string) => {
      try {
        const data = await apiFetch<{ messageId: string }>(
          "/prospecting/gmail/send",
          {
            method: "POST",
            body: JSON.stringify({ to, subject, body }),
          }
        );
        return data;
      } catch (err: any) {
        setError(err.message);
        return null;
      }
    },
    []
  );

  const searchNearby = useCallback(
    async (lat: number, lng: number, radius?: number, type?: string, keyword?: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ results: any[] }>("/prospecting/nearby", {
          method: "POST",
          body: JSON.stringify({ lat, lng, radius, type: type || undefined, keyword: keyword || undefined }),
        });
        return data.results;
      } catch (err: any) {
        setError(err.message);
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    loading,
    error,
    searchBusiness,
    searchNearby,
    findFacebookUrl,
    enrichFacebook,
    draftOutreach,
    getGmailAuthUrl,
    getGmailStatus,
    sendEmail,
  };
}
