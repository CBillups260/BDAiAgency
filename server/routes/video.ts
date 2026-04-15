import { Router } from "express";
import { v4 as uuid } from "uuid";
import {
  generateClips,
  analyzeClips,
  compileVideo,
  getJobState,
  cleanupJob,
  type VideoStyle,
  type CompileSegment,
} from "../services/videoService.js";

const router = Router();

// ─── Generate Clips (async — returns jobId, SSE for progress) ───

router.post("/generate-clips", async (req, res) => {
  try {
    const {
      accountId,
      dishName,
      description,
      style = "ugc",
      aspectRatio = "9:16",
      clipCount = 4,
      startingFrame,
    } = req.body as {
      accountId?: string;
      dishName?: string;
      description?: string;
      style?: VideoStyle;
      aspectRatio?: "9:16" | "16:9" | "1:1";
      clipCount?: number;
      startingFrame?: { base64: string; mimeType: string };
    };

    if (!accountId?.trim()) {
      return res.status(400).json({ error: "Account ID is required." });
    }
    if (!dishName?.trim()) {
      return res.status(400).json({ error: "Dish/drink name is required." });
    }
    if (!description?.trim()) {
      return res.status(400).json({ error: "Description is required." });
    }

    const validStyles: VideoStyle[] = ["ugc", "cinematic", "montage", "slow-motion", "story-reel"];
    if (!validStyles.includes(style)) {
      return res.status(400).json({ error: `Invalid style. Use: ${validStyles.join(", ")}` });
    }

    const validRatios = ["9:16", "16:9", "1:1"];
    if (!validRatios.includes(aspectRatio)) {
      return res.status(400).json({ error: `Invalid aspect ratio. Use: ${validRatios.join(", ")}` });
    }

    const count = Math.max(2, Math.min(6, clipCount));
    const jobId = uuid();

    // Return immediately — generation happens async
    res.json({ jobId, clipCount: count });

    // Fire-and-forget the async pipeline
    generateClips(jobId, {
      accountId,
      dishName: dishName.trim(),
      description: description.trim(),
      style,
      aspectRatio,
      clipCount: count,
      startingFrame: startingFrame?.base64 ? startingFrame : undefined,
    }).catch((err) => {
      console.error(`Video generation job ${jobId} failed:`, err.message);
    });
  } catch (err: any) {
    console.error("Generate clips error:", err.message);
    res.status(500).json({ error: err.message || "Failed to start video generation." });
  }
});

// ─── Analyze Clips (async — SSE for progress) ──────────────

router.post("/analyze-clips", async (req, res) => {
  try {
    const { jobId } = req.body as { jobId?: string };

    if (!jobId?.trim()) {
      return res.status(400).json({ error: "Job ID is required." });
    }

    const job = getJobState(jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }
    if (job.clips.length === 0) {
      return res.status(400).json({ error: "No clips available for analysis." });
    }

    // Return immediately
    res.json({ status: "analyzing", clipCount: job.clips.length });

    // Fire-and-forget
    analyzeClips(jobId).catch((err) => {
      console.error(`Video analysis job ${jobId} failed:`, err.message);
    });
  } catch (err: any) {
    console.error("Analyze clips error:", err.message);
    res.status(500).json({ error: err.message || "Failed to start analysis." });
  }
});

// ─── Compile Final Video ────────────────────────────────────

router.post("/compile", async (req, res) => {
  try {
    const {
      jobId,
      segments,
      targetDuration = 12,
      outputFormat = "9:16",
      transitionType = "cut",
    } = req.body as {
      jobId?: string;
      segments?: CompileSegment[];
      targetDuration?: number;
      outputFormat?: "9:16" | "16:9" | "1:1";
      transitionType?: "cut" | "crossfade" | "fade-black";
    };

    if (!jobId?.trim()) {
      return res.status(400).json({ error: "Job ID is required." });
    }
    if (!segments?.length) {
      return res.status(400).json({ error: "At least one segment is required." });
    }

    const result = await compileVideo(jobId, segments, {
      targetDuration: Math.max(5, Math.min(30, targetDuration)),
      outputFormat,
      transitionType,
    });

    res.json({
      videoBase64: result.videoUrl,
      thumbnailBase64: result.thumbnailUrl,
      duration: result.duration,
      mimeType: "video/mp4",
    });
  } catch (err: any) {
    console.error("Compile error:", err.message);
    res.status(500).json({ error: err.message || "Failed to compile video." });
  }
});

// ─── Job Status (fallback polling) ──────────────────────────

router.get("/job/:jobId", async (req, res) => {
  try {
    const job = getJobState(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found." });
    }

    res.json({
      stage: job.stage,
      clipCount: job.clips.length,
      clips: job.clips.map((c) => ({
        index: c.index,
        angle: c.angle,
        ready: !!c.filePath,
      })),
      analysis: job.analysis || null,
      error: job.error || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cleanup ────────────────────────────────────────────────

router.delete("/job/:jobId", async (req, res) => {
  try {
    await cleanupJob(req.params.jobId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
