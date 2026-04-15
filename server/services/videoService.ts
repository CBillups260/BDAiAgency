import { fal } from "@fal-ai/client";
import { GoogleGenAI } from "@google/genai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import fs from "fs/promises";
import path from "path";
import { sse } from "../sse/emitter.js";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Configure fal.ai — reads FAL_KEY from env automatically, but let's be explicit
if (process.env.FAL_KEY) {
  fal.config({ credentials: process.env.FAL_KEY });
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─── Types ────────────────────────────────────────────────

export type VideoStyle = "ugc" | "cinematic" | "montage" | "slow-motion" | "story-reel";

export interface GenerateParams {
  accountId: string;
  dishName: string;
  description: string;
  style: VideoStyle;
  aspectRatio: "9:16" | "16:9" | "1:1";
  clipCount: number;
  startingFrame?: { base64: string; mimeType: string };
}

export interface SceneSegment {
  startTime: number;
  endTime: number;
  description: string;
  quality: "excellent" | "good" | "fair" | "poor";
  hasBlur: boolean;
  hasTransition: boolean;
  moneyFrame: boolean;
  score: number;
}

export interface ClipAnalysis {
  clipIndex: number;
  angle: string;
  scenes: SceneSegment[];
  bestSegments: { startTime: number; endTime: number; reason: string }[];
  totalDuration: number;
}

export interface FullAnalysis {
  clips: ClipAnalysis[];
  recommendedOrder: number[];
  estimatedFinalDuration: number;
}

export interface CompileSegment {
  clipIndex: number;
  startTime: number;
  endTime: number;
}

export interface CompileOptions {
  targetDuration: number;
  outputFormat: "9:16" | "16:9" | "1:1";
  transitionType: "cut" | "crossfade" | "fade-black";
}

// ─── Camera Angles ────────────────────────────────────────

const CAMERA_ANGLES = [
  { id: "close-up", label: "Close-up Macro", prompt: "extreme close-up macro shot, shallow depth of field, capturing every texture and detail" },
  { id: "wide-establishing", label: "Wide Establishing", prompt: "wide establishing shot showing the full table setting and restaurant ambiance, slowly zooming in" },
  { id: "overhead", label: "Overhead", prompt: "top-down overhead shot looking directly down, slowly drifting across the arrangement" },
  { id: "pan-left", label: "Panning", prompt: "smooth horizontal pan from left to right, revealing the dish in context with surrounding elements" },
  { id: "handheld-ugc", label: "Handheld UGC", prompt: "handheld UGC-style shot, natural camera movement, as if someone filming with their phone" },
  { id: "hero-low", label: "Hero Low Angle", prompt: "low angle hero shot looking up at the dish, making it look grand and appetizing, shallow depth of field" },
  { id: "tracking", label: "Tracking", prompt: "smooth tracking shot circling around the dish at table height, revealing from multiple sides" },
  { id: "pull-focus", label: "Pull Focus", prompt: "rack focus shot starting blurry on foreground element then pulling focus to reveal the dish sharply" },
] as const;

// Style modifiers applied to all prompts
const STYLE_MODIFIERS: Record<VideoStyle, string> = {
  ugc: "UGC style, natural lighting, authentic feel, casual handheld movement, organic and real, no cinematic color grading",
  cinematic: "cinematic look, anamorphic lens flare, professional color grading, smooth dolly movement, film grain, shallow depth of field",
  montage: "fast-paced energy, dynamic angles, quick movement, punchy transitions between elements, energetic feel",
  "slow-motion": "slow motion at 120fps, silky smooth movement, every detail visible, time stretched, dramatic reveal",
  "story-reel": "vertical 9:16 social media format, eye-catching movement, social media optimized, bright vivid colors, trend-worthy",
};

// ─── Job State ────────────────────────────────────────────

interface JobState {
  stage: "generating" | "analyzing" | "compiling" | "complete" | "error";
  params: GenerateParams;
  clips: { index: number; angle: string; filePath: string; thumbnailPath?: string }[];
  analysis?: FullAnalysis;
  finalVideoUrl?: string;
  error?: string;
}

const jobs = new Map<string, JobState>();

export function getJobState(jobId: string): JobState | undefined {
  return jobs.get(jobId);
}

function getJobDir(jobId: string): string {
  return path.join(process.cwd(), "tmp", "video-jobs", jobId);
}

// ─── Step 1: Select Angles with Gemini ────────────────────

async function selectAngles(dishName: string, description: string, style: VideoStyle, count: number): Promise<typeof CAMERA_ANGLES[number][]> {
  try {
    const angleList = CAMERA_ANGLES.map(a => `- ${a.id}: ${a.label}`).join("\n");
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: `You are a food videography director. Given a dish/drink and style, pick the ${count} best camera angles from this list:

${angleList}

Dish: ${dishName}
Description: ${description}
Style: ${style}

Return ONLY a JSON array of the angle IDs, e.g. ["close-up", "overhead", "pan-left", "hero-low"]. No other text.`,
    });

    const text = response.text?.trim() || "";
    const parsed = JSON.parse(text.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
    const selected = parsed
      .map((id: string) => CAMERA_ANGLES.find(a => a.id === id))
      .filter(Boolean)
      .slice(0, count);

    if (selected.length >= 2) return selected;
  } catch (e) {
    console.error("Angle selection fallback:", e);
  }

  // Fallback: pick based on style
  const defaults: Record<VideoStyle, string[]> = {
    ugc: ["handheld-ugc", "close-up", "overhead", "pan-left"],
    cinematic: ["hero-low", "tracking", "pull-focus", "wide-establishing"],
    montage: ["close-up", "overhead", "pan-left", "hero-low"],
    "slow-motion": ["close-up", "pull-focus", "tracking", "overhead"],
    "story-reel": ["handheld-ugc", "close-up", "overhead", "hero-low"],
  };
  return defaults[style]
    .slice(0, count)
    .map(id => CAMERA_ANGLES.find(a => a.id === id)!)
    .filter(Boolean);
}

// ─── Step 2: Generate Clips with Sora Pro ─────────────────

async function generateSingleClip(
  jobId: string,
  clipIndex: number,
  angle: typeof CAMERA_ANGLES[number],
  params: GenerateParams,
  jobDir: string,
): Promise<string> {
  if (!process.env.FAL_KEY) throw new Error("FAL_KEY is not set in .env");

  const styleModifier = STYLE_MODIFIERS[params.style];
  const prompt = `Professional food/drink video of ${params.dishName}. ${params.description}. ${angle.prompt}. ${styleModifier}. Warm appetizing lighting, restaurant setting, food photography quality.`;

  const aspectMap: Record<string, "9:16" | "16:9"> = {
    "9:16": "9:16",
    "16:9": "16:9",
    "1:1": "9:16",  // No square option — default to portrait
  };

  let result: any;

  if (params.startingFrame) {
    // Image-to-video via fal.ai Sora 2 Pro
    const imageDataUrl = `data:${params.startingFrame.mimeType};base64,${params.startingFrame.base64}`;
    result = await fal.subscribe("fal-ai/sora-2/image-to-video/pro", {
      input: {
        prompt,
        image_url: imageDataUrl,
        duration: "4" as const,
        aspect_ratio: "auto",
        resolution: "720p",
      },
      logs: true,
      onQueueUpdate: (update: any) => {
        if (update.status === "IN_PROGRESS") {
          sse.broadcast("video_clip_progress", { jobId, clipIndex, status: "rendering" });
        }
      },
    });
  } else {
    // Text-to-video via fal.ai Sora 2
    result = await fal.subscribe("fal-ai/sora-2/text-to-video", {
      input: {
        prompt,
        duration: "4" as const,
        aspect_ratio: aspectMap[params.aspectRatio] || "9:16",
      },
      logs: true,
      onQueueUpdate: (update: any) => {
        if (update.status === "IN_PROGRESS") {
          sse.broadcast("video_clip_progress", { jobId, clipIndex, status: "rendering" });
        }
      },
    });
  }

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(`Sora returned no video for clip ${clipIndex}`);
  }

  // Download video to disk
  const clipPath = path.join(jobDir, `clip-${clipIndex}.mp4`);
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Failed to download clip ${clipIndex}: ${videoRes.status}`);
  const buffer = Buffer.from(await videoRes.arrayBuffer());
  await fs.writeFile(clipPath, buffer);

  return clipPath;
}

export async function generateClips(jobId: string, params: GenerateParams): Promise<void> {
  const jobDir = getJobDir(jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const job: JobState = {
    stage: "generating",
    params,
    clips: [],
  };
  jobs.set(jobId, job);

  try {
    // Step 1: AI selects best angles
    const angles = await selectAngles(params.dishName, params.description, params.style, params.clipCount);

    sse.broadcast("video_progress", {
      jobId,
      type: "angles_selected",
      angles: angles.map(a => ({ id: a.id, label: a.label })),
    });

    // Step 2: Generate clips (2 concurrent max)
    const concurrency = 2;
    for (let i = 0; i < angles.length; i += concurrency) {
      const batch = angles.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((angle, batchIdx) => {
          const clipIndex = i + batchIdx;
          return generateSingleClip(jobId, clipIndex, angle, params, jobDir);
        })
      );

      for (let j = 0; j < results.length; j++) {
        const clipIndex = i + j;
        const result = results[j];

        if (result.status === "fulfilled") {
          const clip = { index: clipIndex, angle: angles[clipIndex].id, filePath: result.value };
          job.clips.push(clip);

          sse.broadcast("video_clip_ready", {
            jobId,
            clipIndex,
            angle: angles[clipIndex].id,
            angleLabel: angles[clipIndex].label,
            status: "ready",
            total: angles.length,
          });
        } else {
          const errMsg = result.reason?.message || "Generation failed";
          console.error(`Clip ${clipIndex} failed:`, errMsg);
          sse.broadcast("video_clip_ready", {
            jobId,
            clipIndex,
            angle: angles[clipIndex].id,
            angleLabel: angles[clipIndex].label,
            status: "failed",
            error: errMsg,
            total: angles.length,
          });
        }
      }
    }

    if (job.clips.length > 0) {
      sse.broadcast("video_clips_complete", {
        jobId,
        clipCount: job.clips.length,
        totalRequested: angles.length,
      });
    } else {
      // Collect actual error messages from failed clips
      const clipErrors: string[] = [];
      for (let i = 0; i < angles.length; i += concurrency) {
        // errors were already logged above
      }
      job.stage = "error";
      job.error = "All clips failed to generate. Check your OpenAI API key and Sora Pro access. Check server logs for details.";
      sse.broadcast("video_error", {
        jobId,
        error: job.error,
      });
    }
  } catch (err: any) {
    job.stage = "error";
    job.error = err.message;
    sse.broadcast("video_error", { jobId, error: err.message });
    throw err;
  }
}

// ─── Step 3: Analyze Clips with Gemini ────────────────────

async function analyzeSingleClip(
  jobId: string,
  clip: { index: number; angle: string; filePath: string },
): Promise<ClipAnalysis> {
  const videoBuffer = await fs.readFile(clip.filePath);
  const base64 = videoBuffer.toString("base64");

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: base64, mimeType: "video/mp4" } },
          {
            text: `You are a professional video editor analyzing a food/drink video clip. Analyze this clip and return a JSON object with this exact structure:

{
  "scenes": [
    {
      "startTime": <number in seconds>,
      "endTime": <number in seconds>,
      "description": "<what's happening in this segment>",
      "quality": "<excellent|good|fair|poor>",
      "hasBlur": <boolean>,
      "hasTransition": <boolean>,
      "moneyFrame": <boolean — is this a visually striking, social-media-worthy moment?>,
      "score": <0-100 quality score>
    }
  ],
  "bestSegments": [
    { "startTime": <number>, "endTime": <number>, "reason": "<why this segment is best>" }
  ],
  "totalDuration": <total clip duration in seconds>
}

Focus on:
- Identifying the crispest, most appetizing moments (money frames)
- Finding natural cut points (before/after camera movement changes, focus shifts)
- Scoring based on sharpness, lighting quality, composition, and food appeal
- Breaking the clip into logical scene segments

Return ONLY the JSON, no other text.`,
          },
        ],
      },
    ],
  });

  const text = response.text?.trim() || "";
  const parsed = JSON.parse(text.replace(/```json?\n?/g, "").replace(/```/g, "").trim());

  return {
    clipIndex: clip.index,
    angle: clip.angle,
    scenes: parsed.scenes || [],
    bestSegments: parsed.bestSegments || [],
    totalDuration: parsed.totalDuration || 5,
  };
}

export async function analyzeClips(jobId: string): Promise<FullAnalysis> {
  const job = jobs.get(jobId);
  if (!job) throw new Error("Job not found");
  if (job.clips.length === 0) throw new Error("No clips to analyze");

  job.stage = "analyzing";

  const analyses: ClipAnalysis[] = [];

  for (const clip of job.clips) {
    try {
      const analysis = await analyzeSingleClip(jobId, clip);
      analyses.push(analysis);

      sse.broadcast("video_analysis_progress", {
        jobId,
        clipIndex: clip.index,
        analysis,
        completed: analyses.length,
        total: job.clips.length,
      });
    } catch (err: any) {
      console.error(`Analysis failed for clip ${clip.index}:`, err.message);
      // Push a minimal analysis so the clip isn't lost
      analyses.push({
        clipIndex: clip.index,
        angle: clip.angle,
        scenes: [{ startTime: 0, endTime: 5, description: "Full clip", quality: "good", hasBlur: false, hasTransition: false, moneyFrame: true, score: 70 }],
        bestSegments: [{ startTime: 0, endTime: 5, reason: "Full clip (analysis unavailable)" }],
        totalDuration: 5,
      });
    }
  }

  // Sort clips by best segment scores to recommend order
  const recommendedOrder = analyses
    .map((a) => ({
      index: a.clipIndex,
      topScore: Math.max(...a.scenes.map(s => s.score), 0),
    }))
    .sort((a, b) => b.topScore - a.topScore)
    .map(x => x.index);

  // Estimate final duration from best segments
  const estimatedDuration = analyses.reduce(
    (sum, a) => sum + a.bestSegments.reduce((s, seg) => s + (seg.endTime - seg.startTime), 0),
    0
  );

  const fullAnalysis: FullAnalysis = {
    clips: analyses,
    recommendedOrder,
    estimatedFinalDuration: Math.min(estimatedDuration, 15),
  };

  job.analysis = fullAnalysis;

  // Save analysis to disk
  const jobDir = getJobDir(jobId);
  await fs.writeFile(path.join(jobDir, "analysis.json"), JSON.stringify(fullAnalysis, null, 2));

  sse.broadcast("video_analysis_complete", { jobId, fullAnalysis });

  return fullAnalysis;
}

// ─── Step 4: Compile with FFmpeg ──────────────────────────

function ffmpegTrim(inputPath: string, outputPath: string, startTime: number, endTime: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(startTime)
      .setDuration(endTime - startTime)
      .output(outputPath)
      .outputOptions(["-c", "copy", "-avoid_negative_ts", "make_zero"])
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

function ffmpegConcat(inputs: string[], outputPath: string, transitionType: string): Promise<void> {
  return new Promise(async (resolve, reject) => {
    // Write concat list file
    const listPath = outputPath.replace(".mp4", "-list.txt");
    const listContent = inputs.map(f => `file '${f}'`).join("\n");
    await fs.writeFile(listPath, listContent);

    if (transitionType === "cut") {
      // Simple concat
      ffmpeg()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .output(outputPath)
        .outputOptions(["-c", "copy"])
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    } else {
      // For crossfade/fade-black, we need to re-encode
      const fadeFilter = transitionType === "crossfade" ? "xfade=transition=fade:duration=0.5" : "fade=t=out:d=0.3,fade=t=in:d=0.3";

      ffmpeg()
        .input(listPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .output(outputPath)
        .outputOptions(["-vf", fadeFilter, "-c:v", "libx264", "-preset", "fast", "-crf", "23"])
        .on("end", () => resolve())
        .on("error", () => {
          // Fallback to simple concat if filter fails
          ffmpeg()
            .input(listPath)
            .inputOptions(["-f", "concat", "-safe", "0"])
            .output(outputPath)
            .outputOptions(["-c", "copy"])
            .on("end", () => resolve())
            .on("error", (err2) => reject(err2))
            .run();
        })
        .run();
    }
  });
}

function ffmpegThumbnail(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: ["50%"],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: "480x?",
      })
      .on("end", () => resolve())
      .on("error", (err) => reject(err));
  });
}

export async function compileVideo(
  jobId: string,
  segments: CompileSegment[],
  options: CompileOptions,
): Promise<{ videoUrl: string; thumbnailUrl: string; duration: number }> {
  const job = jobs.get(jobId);
  if (!job) throw new Error("Job not found");

  job.stage = "compiling";
  const jobDir = getJobDir(jobId);

  sse.broadcast("video_compile_progress", { jobId, step: "trimming", progress: 0 });

  // Step 1: Trim each segment
  const trimmedPaths: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const clip = job.clips.find(c => c.index === seg.clipIndex);
    if (!clip) throw new Error(`Clip ${seg.clipIndex} not found`);

    const trimmedPath = path.join(jobDir, `trimmed-${i}.mp4`);
    await ffmpegTrim(clip.filePath, trimmedPath, seg.startTime, seg.endTime);
    trimmedPaths.push(trimmedPath);

    sse.broadcast("video_compile_progress", {
      jobId,
      step: "trimming",
      progress: Math.round(((i + 1) / segments.length) * 50),
    });
  }

  // Step 2: Concatenate
  sse.broadcast("video_compile_progress", { jobId, step: "concatenating", progress: 50 });
  const finalPath = path.join(jobDir, "final.mp4");
  await ffmpegConcat(trimmedPaths, finalPath, options.transitionType);

  // Step 3: Generate thumbnail
  sse.broadcast("video_compile_progress", { jobId, step: "thumbnail", progress: 80 });
  const thumbPath = path.join(jobDir, "thumbnail.jpg");
  try {
    await ffmpegThumbnail(finalPath, thumbPath);
  } catch {
    // Thumbnail extraction is non-critical
  }

  // Step 4: Upload to Firebase Storage
  sse.broadcast("video_compile_progress", { jobId, step: "uploading", progress: 90 });

  const finalBuffer = await fs.readFile(finalPath);
  const videoBase64 = finalBuffer.toString("base64");

  let thumbnailBase64: string | null = null;
  try {
    const thumbBuffer = await fs.readFile(thumbPath);
    thumbnailBase64 = thumbBuffer.toString("base64");
  } catch {}

  // Calculate duration from segments
  const duration = segments.reduce((sum, seg) => sum + (seg.endTime - seg.startTime), 0);

  job.stage = "complete";
  job.finalVideoUrl = `data:video/mp4;base64,${videoBase64}`;

  sse.broadcast("video_compile_complete", {
    jobId,
    duration,
    hasVideo: true,
    hasThumbnail: !!thumbnailBase64,
  });

  return {
    videoUrl: videoBase64,
    thumbnailUrl: thumbnailBase64 || "",
    duration,
  };
}

// ─── Cleanup ──────────────────────────────────────────────

export async function cleanupJob(jobId: string): Promise<void> {
  const jobDir = getJobDir(jobId);
  try {
    await fs.rm(jobDir, { recursive: true, force: true });
  } catch {}
  jobs.delete(jobId);
}
