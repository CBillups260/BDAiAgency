import { useState, useCallback } from "react";
import { authedFetch } from "../lib/api";
import type { NexusReport, NexusProposal, CraftPlan } from "./useCreativeWriter";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await authedFetch(`/api${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export interface BibleCandidates {
  characters: {
    name: string;
    role?: string;
    archetype?: string;
    bio?: string;
    voice?: string;
    goals?: string;
    appearance?: string;
  }[];
  lore: { type?: string; title: string; content?: string }[];
  plotThreads: { title: string; description?: string; status?: string }[];
}

export function useCreativeApi() {
  const [analyzing, setAnalyzing] = useState(false);
  const [running, setRunning] = useState(false);
  const [crafting, setCrafting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(
    async (bookId: string, scope: "chapter" | "book", chapterId?: string) => {
      setAnalyzing(true);
      setError(null);
      try {
        return await apiFetch<{ reportId: string; report: NexusReport }>(
          "/creative/analyze",
          {
            method: "POST",
            body: JSON.stringify({ bookId, scope, chapterId }),
          }
        );
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setAnalyzing(false);
      }
    },
    []
  );

  const runRound = useCallback(async (sessionId: string) => {
    setRunning(true);
    setError(null);
    try {
      return await apiFetch<{
        status: string;
        round: number;
        turnsAdded: number;
        stopped: boolean;
        grade: any;
      }>("/creative/roundtable/run", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      });
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setRunning(false);
    }
  }, []);

  const finalizeSession = useCallback(async (sessionId: string) => {
    setCrafting(true);
    setError(null);
    try {
      return await apiFetch<{
        sceneId: string;
        grade: { overall: number; dialogue: number; tension: number; consistency: number };
        verdict: string;
        angles: string[];
        ahaMoments: string[];
        recommendation: string;
        cleanedPlayout: string;
      }>("/creative/roundtable/finalize", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      });
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setCrafting(false);
    }
  }, []);

  const stopSession = useCallback(async (sessionId: string) => {
    try {
      await apiFetch<{ ok: boolean }>("/creative/roundtable/stop", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      });
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    }
  }, []);

  const craftScene = useCallback(
    async (sceneId: string, chapterId: string, instructions?: string) => {
      setCrafting(true);
      setError(null);
      try {
        return await apiFetch<{
          draftId: string;
          content: string;
          integrationNote: string;
        }>("/creative/craft", {
          method: "POST",
          body: JSON.stringify({ sceneId, chapterId, instructions }),
        });
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setCrafting(false);
      }
    },
    []
  );

  const [transforming, setTransforming] = useState(false);

  const transform = useCallback(async (bookId: string, focus?: string) => {
    setTransforming(true);
    setError(null);
    try {
      return await apiFetch<{
        editorNote: string;
        proposals: NexusProposal[];
        planned: number;
        executed: number;
      }>("/creative/transform", {
        method: "POST",
        body: JSON.stringify({ bookId, focus }),
      });
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setTransforming(false);
    }
  }, []);

  const ingestChapter = useCallback(
    async (bookId: string, chapterId: string, force = false) => {
      // Fire-and-observe: Story Intelligence runs after a save; errors surface
      // through the return value, not the shared error banner.
      try {
        return await apiFetch<{
          skipped: boolean;
          reason?: string;
          applied?: {
            charactersAdded: number;
            charactersEnriched: number;
            loreAdded: number;
            loreEnriched: number;
            threadsAdded: number;
            threadsAdvanced: number;
          };
          chapterSummary?: string;
        }>("/creative/ingest-chapter", {
          method: "POST",
          body: JSON.stringify({ bookId, chapterId, force }),
        });
      } catch (err: any) {
        return { skipped: true, reason: err.message } as any;
      }
    },
    []
  );

  const [formatting, setFormatting] = useState(false);
  const [titling, setTitling] = useState(false);
  const [restructuring, setRestructuring] = useState(false);
  const [editingSelection, setEditingSelection] = useState(false);

  const [crafting2, setCrafting2] = useState(false);

  const craftPlan = useCallback(async (bookId: string, chapterId: string) => {
    setCrafting2(true);
    setError(null);
    try {
      return await apiFetch<CraftPlan & { planId: string }>("/creative/craft-plan", {
        method: "POST",
        body: JSON.stringify({ bookId, chapterId }),
      });
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setCrafting2(false);
    }
  }, []);

  const titleChapter = useCallback(async (chapterId: string) => {
    setTitling(true);
    setError(null);
    try {
      return await apiFetch<{ title: string; summary: string }>("/creative/title-chapter", {
        method: "POST",
        body: JSON.stringify({ chapterId }),
      });
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setTitling(false);
    }
  }, []);

  const restructure = useCallback(async (bookId: string) => {
    setRestructuring(true);
    setError(null);
    try {
      return await apiFetch<{ editorNote: string; changed: number; changes: string[] }>(
        "/creative/restructure",
        { method: "POST", body: JSON.stringify({ bookId }) }
      );
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setRestructuring(false);
    }
  }, []);

  const editSelection = useCallback(
    async (
      bookId: string,
      chapterId: string,
      selection: string,
      action: string,
      instruction?: string
    ) => {
      setEditingSelection(true);
      try {
        return await apiFetch<{ replacement: string; action: string }>(
          "/creative/edit-selection",
          {
            method: "POST",
            body: JSON.stringify({ bookId, chapterId, selection, action, instruction }),
          }
        );
      } catch (err: any) {
        setError(err.message);
        return null;
      } finally {
        setEditingSelection(false);
      }
    },
    []
  );

  const formatChapter = useCallback(async (text: string, styleNotes?: string) => {
    setFormatting(true);
    setError(null);
    try {
      return await apiFetch<{
        formatted: string;
        wordDelta: number;
        contentWarning: string | null;
      }>("/creative/format-chapter", {
        method: "POST",
        body: JSON.stringify({ text, styleNotes }),
      });
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setFormatting(false);
    }
  }, []);

  const narrateChapter = useCallback(async (chapterId: string, voice: string) => {
    return apiFetch<{
      url: string;
      timeline: { start: number; end: number; startChar: number; endChar: number }[];
      narratedChars: number;
      cached: boolean;
      truncated: boolean;
      voice: string;
    }>("/creative/narrate", { method: "POST", body: JSON.stringify({ chapterId, voice }) });
  }, []);

  const extractBible = useCallback(async (bookId: string, text: string) => {
    setExtracting(true);
    setError(null);
    try {
      return await apiFetch<BibleCandidates>("/creative/extract-bible", {
        method: "POST",
        body: JSON.stringify({ bookId, text }),
      });
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setExtracting(false);
    }
  }, []);

  return {
    analyzing,
    running,
    crafting,
    extracting,
    transforming,
    formatting,
    craftingPlan: crafting2,
    craftPlan,
    titling,
    restructuring,
    editingSelection,
    error,
    setError,
    analyze,
    transform,
    formatChapter,
    titleChapter,
    restructure,
    editSelection,
    runRound,
    stopSession,
    finalizeSession,
    craftScene,
    extractBible,
    ingestChapter,
    narrateChapter,
  };
}
