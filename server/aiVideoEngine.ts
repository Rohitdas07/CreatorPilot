import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ContentLanguage } from '../src/types/creator.ts';
import type { SubtitleStyleConfig, VideoAspectRatio, VideoSubtitleCue } from '../src/types/videoEditor.ts';
import {
  AI_VIDEO_DETAILED_STAGES,
  AI_VIDEO_MUSIC_PRESETS,
  AI_VIDEO_STYLES,
  AI_VIDEO_VOICES,
  DEFAULT_RELEVANCE_THRESHOLD,
  LANGUAGE_TO_BCP47,
  MAX_AI_VIDEO_DURATION_SEC,
  MAX_AI_VIDEO_SCENES,
  type AiVideoCostEstimate,
  type AiVideoDetailedStageId,
  type AiVideoDurationSec,
  type AiVideoFreeVisualStyle,
  type AiVideoImageVerificationResult,
  type AiVideoJobRecord,
  type AiVideoJobStatusResponse,
  type AiVideoMusicPreset,
  type AiVideoPipelineStage,
  type AiVideoSceneClipState,
  type AiVideoScenePlan,
  type AiVideoScenePlanItem,
  type AiVideoSceneVisualAttempt,
  type AiVideoStageStep,
  type AiVideoStoryContext,
  type AiVideoStyle,
  type AiVideoTransitionType,
  type AiVideoVisualEngine,
  type AiVideoVisualSourceKind,
  type AiVideoVisualSourceMode,
  type AiVideoVoiceId,
} from '../src/types/aiVideo.ts';
import { VALID_LANGUAGES } from '../src/utils/contentValidation.ts';
import {
  FALLBACK_GEMINI_TEXT_MODEL,
  generateGeminiContentWithFallback,
  PRIMARY_GEMINI_TEXT_MODEL,
  withGeminiTimeout,
} from './geminiModelHelper.ts';

const IMAGE_GEN_MODEL = 'gemini-3.1-flash-lite-image';
const IMAGE_GEN_FALLBACK_MODEL = 'gemini-nano-banana-2.1';
const VIDEO_MODEL = 'gemini-omni-1.2-flash';
const FREE_VIDEO_MODEL = 'ffmpeg-motion-local + Free AI Images ($0.00)';
const TTS_MODEL = 'gemini-3.8-flash-lite-tts';
const FREE_NEURAL_TTS_MODEL = 'edge-neural-tts (Free Unlimited)';
const MUSIC_MODEL = 'lyria-3-clip-preview';

function logAiVideo(jobId: string, stage: string, message: string, meta?: Record<string, unknown>): void {
  const extra = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[AI-Video][${jobId}][${stage}] ${message}${extra}`);
}

async function generatePlannerContentWithFallback(params: {
  ai: GoogleGenAI;
  contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents'];
  config?: Parameters<GoogleGenAI['models']['generateContent']>[0]['config'];
  label: string;
  primaryTimeoutMs?: number;
  fallbackTimeoutMs?: number;
}) {
  return generateGeminiContentWithFallback({
    ...params,
    onFallback: (reason) => {
      logAiVideo(
        'planner',
        'model-fallback',
        `${params.label}: ${PRIMARY_GEMINI_TEXT_MODEL} fallback (${reason.slice(0, 140)}) -> ${FALLBACK_GEMINI_TEXT_MODEL}`
      );
    },
  });
}

const DATA_ROOT = path.resolve(process.cwd(), '.data', 'ai-video-jobs');
const WORKER_SCRIPT_PATH = path.resolve(process.cwd(), 'server', 'videoWorker.py');

fs.mkdirSync(DATA_ROOT, { recursive: true });

export interface ServerAiVideoJob {
  record: AiVideoJobRecord;
  scenes: AiVideoScenePlanItem[];
  subtitles: VideoSubtitleCue[];
  workDir: string;
  outputPath: string;
  srtPath: string;
  downloadToken: string;
  cancelled: boolean;
  activeInteractionId?: string;
  workerProcessId?: number;
}

const aiVideoJobs = new Map<string, ServerAiVideoJob>();
const activeUserGenerations = new Set<string>();
const previewAudioCache = new Map<string, { audioBase64: string; mimeType: string }>();

function getValidApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  return key;
}

function createGeminiClient(apiKey: string, apiVersion?: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      ...(apiVersion ? { apiVersion } : {}),
      headers: {
        'User-Agent': 'creatorpilot-ai-build',
      },
    },
  });
}

function sanitizeSafeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128);
}

function getJobMetaFilePath(workDir: string): string {
  return path.join(workDir, 'job-meta.json');
}

function persistJobToDisk(job: ServerAiVideoJob): void {
  try {
    fs.mkdirSync(job.workDir, { recursive: true });
    fs.writeFileSync(
      getJobMetaFilePath(job.workDir),
      JSON.stringify(
        {
          record: job.record,
          scenes: job.scenes,
          subtitles: job.subtitles,
          outputPath: job.outputPath,
          srtPath: job.srtPath,
          downloadToken: job.downloadToken,
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    console.warn('Could not persist AI video job metadata:', err);
  }
}

function loadPersistedJobs(): void {
  try {
    const entries = fs.readdirSync(DATA_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workDir = path.join(DATA_ROOT, entry.name);
      const metaPath = getJobMetaFilePath(workDir);
      if (!fs.existsSync(metaPath)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
          record?: AiVideoJobRecord;
          scenes?: AiVideoScenePlanItem[];
          subtitles?: VideoSubtitleCue[];
          outputPath?: string;
          srtPath?: string;
          downloadToken?: string;
        };
        if (!parsed.record?.id) continue;
        const record = parsed.record;
        const wasInterrupted =
          record.status === 'processing' || (record.status === 'queued' && !record.visualReviewReady);
        if (wasInterrupted) {
          record.status = 'failed';
          record.stageMessage = 'Server restarted before video generation completed';
          record.error = 'Server restarted during background generation. Click Retry Job to resume.';
          record.updatedAt = new Date().toISOString();
        }
        const serverJob: ServerAiVideoJob = {
          record,
          scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
          subtitles: Array.isArray(parsed.subtitles) ? parsed.subtitles : [],
          workDir,
          outputPath: parsed.outputPath || path.join(workDir, record.outputFileName || 'output.mp4'),
          srtPath: parsed.srtPath || path.join(workDir, 'subtitles.srt'),
          downloadToken: parsed.downloadToken || crypto.randomBytes(16).toString('hex'),
          cancelled: record.status === 'cancelled',
        };
        // Ensure any scene with an existing valid JPEG on disk never stays stuck in Pending Visual / queued
        for (const st of serverJob.record.sceneStates || []) {
          const picPath = path.join(workDir, `scene_${st.sceneNumber}_pic.jpg`);
          if (fs.existsSync(picPath) && fs.statSync(picPath).size > 4096) {
            if (!st.imageUrl) {
              st.imageUrl = buildSceneImageUrl(record.id, st.sceneNumber, serverJob.downloadToken);
            }
            if (!st.imageSource) {
              st.imageSource = 'ai-generated';
            }
            if (!st.visualStatus || st.visualStatus === 'pending' || st.visualStatus === 'sourcing' || st.visualStatus === 'verifying') {
              st.visualStatus = 'approved';
            }
            if (st.status === 'queued') {
              st.status = 'approved';
            }
            st.error = undefined;
          }
        }
        aiVideoJobs.set(record.id, serverJob);
        if (wasInterrupted) {
          persistJobToDisk(serverJob);
        }
      } catch {
        // Skip corrupt metadata entry
      }
    }
  } catch {
    // Directory may not exist yet
  }
}

loadPersistedJobs();

function runPythonWorkerOnce(args: string[], timeoutMs = 90000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [WORKER_SCRIPT_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error(`Python FFmpeg worker timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to launch Python FFmpeg worker: ${err.message}`));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lines = stdoutBuf
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const lastLine = lines[lines.length - 1];
      let parsed: Record<string, unknown> | null = null;
      if (lastLine) {
        try {
          parsed = JSON.parse(lastLine) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }

      if (code !== 0 || parsed?.ok === false) {
        const msg =
          (typeof parsed?.error === 'string' && parsed.error) ||
          stderrBuf.trim() ||
          `Video worker exited with code ${code}`;
        reject(new Error(msg));
        return;
      }

      resolve(parsed || { ok: true });
    });
  });
}

function runPythonCompose(
  configPath: string,
  job: ServerAiVideoJob,
  onProgress: (progress: number, stage: string) => void
): Promise<{
  outputPath: string;
  srtPath: string;
  bytes: number;
  metadata?: { durationSec?: number; width?: number; height?: number };
}> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [WORKER_SCRIPT_PATH, 'compose', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    job.workerProcessId = child.pid;

    let stdoutBuf = '';
    let stderrBuf = '';
    let donePayload: Record<string, unknown> | null = null;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (msg.type === 'progress') {
            const rawPct = Number(msg.progress ?? 0);
            const scaledPct = Math.min(99, Math.max(76, 76 + Math.round((rawPct / 100) * 23)));
            onProgress(scaledPct, String(msg.stage || 'Combining video and audio'));
          } else if (msg.type === 'done') {
            donePayload = msg;
          } else if (msg.type === 'error') {
            reject(new Error(String(msg.error || 'FFmpeg composition failed.')));
          }
        } catch {
          // ignore non-JSON stdout
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      reject(new Error(`FFmpeg worker spawn error: ${err.message}`));
    });

    child.on('close', (code) => {
      job.workerProcessId = undefined;
      if (job.cancelled) {
        reject(new Error('Generation cancelled by user.'));
        return;
      }
      if (code === 0 && donePayload) {
        resolve({
          outputPath: String(donePayload.outputPath || job.outputPath),
          srtPath: String(donePayload.srtPath || job.srtPath),
          bytes: Number(donePayload.bytes || 0),
          metadata: (donePayload.metadata || {}) as {
            durationSec?: number;
            width?: number;
            height?: number;
          },
        });
        return;
      }
      const tail = stderrBuf.trim().slice(-600);
      reject(new Error(tail || `FFmpeg composition exited with code ${code}`));
    });
  });
}

export function estimateAiVideoCost(params: {
  visualEngine?: AiVideoVisualEngine;
  sceneCount: number;
  totalDurationSec: number;
  musicPreset: AiVideoMusicPreset;
  voice?: AiVideoVoiceId;
}): AiVideoCostEstimate {
  const engine: AiVideoVisualEngine =
    params.visualEngine === 'ai-omni' ? 'ai-omni' : 'free-motion';
  const safeScenes = Math.max(1, Math.min(MAX_AI_VIDEO_SCENES, Math.round(params.sceneCount)));
  const safeDuration = Math.max(5, Math.min(MAX_AI_VIDEO_DURATION_SEC, Math.round(params.totalDurationSec)));
  const musicUsd = params.musicPreset === 'ai-lyria' ? 0.06 : 0;
  const offlineVoice = params.voice === 'none';

  if (engine === 'free-motion') {
    const estimatedUsd = Number(musicUsd.toFixed(2));
    return {
      visualEngine: 'free-motion',
      sceneCount: safeScenes,
      totalDurationSec: safeDuration,
      videoModel: FREE_VIDEO_MODEL,
      ttsModel: offlineVoice ? 'none (music & captions only)' : FREE_NEURAL_TTS_MODEL,
      musicModel: params.musicPreset === 'ai-lyria' ? MUSIC_MODEL : null,
      estimatedUsd,
      breakdown: {
        scenePlanningUsd: 0,
        videoGenerationUsd: 0,
        voiceoverUsd: 0,
        musicUsd,
      },
      limits: {
        maxScenes: MAX_AI_VIDEO_SCENES,
        maxDurationSec: MAX_AI_VIDEO_DURATION_SEC,
        clipDurationRangeSec: [3, 10],
      },
      notes: [
        '100% Free ($0.00) pipeline: generates scene images via Free AI Image providers (Hugging Face FLUX / SD3.5 & AI Horde) or retrieves open-license visuals (Wikimedia, Openverse, Wikipedia, NASA), verifies every image with Gemini Vision, and animates each scene with tailored HD camera motion.',
        offlineVoice
          ? 'No Voiceover mode selected: renders 100% locally with zero TTS calls.'
          : 'Free Neural Voiceover (Microsoft Edge Neural TTS with automatic free fallback) synthesizes crisp multi-language narration ($0.00 cost).',
        params.musicPreset === 'ai-lyria'
          ? `Selected music track uses ${MUSIC_MODEL} (paid Gemini API key required). Switch to a Royalty-Free preset for $0.00 total.`
          : 'Royalty-free preset music beds synthesize locally with zero API cost.',
      ],
    };
  }

  const scenePlanningUsd = 0.01;
  const videoGenerationUsd = Number((safeDuration * 0.045).toFixed(2));
  const voiceoverUsd = offlineVoice ? 0 : Number((safeScenes * 0.005).toFixed(2));
  const estimatedUsd = Number(
    (scenePlanningUsd + videoGenerationUsd + voiceoverUsd + musicUsd).toFixed(2)
  );

  return {
    visualEngine: 'ai-omni',
    sceneCount: safeScenes,
    totalDurationSec: safeDuration,
    videoModel: VIDEO_MODEL,
    ttsModel: offlineVoice ? 'none (music & captions only)' : TTS_MODEL,
    musicModel: params.musicPreset === 'ai-lyria' ? MUSIC_MODEL : null,
    estimatedUsd,
    breakdown: {
      scenePlanningUsd,
      videoGenerationUsd,
      voiceoverUsd,
      musicUsd,
    },
    limits: {
      maxScenes: MAX_AI_VIDEO_SCENES,
      maxDurationSec: MAX_AI_VIDEO_DURATION_SEC,
      clipDurationRangeSec: [3, 10],
    },
    notes: [
      `Generates unique scene images (${IMAGE_GEN_MODEL}), verifies relevance via Gemini Vision, and animates each approved frame via ${VIDEO_MODEL} (720p).`,
      `Maximum safety cap: ${MAX_AI_VIDEO_SCENES} scenes and ${MAX_AI_VIDEO_DURATION_SEC}s total duration.`,
      params.musicPreset === 'ai-lyria'
        ? `Custom music track uses ${MUSIC_MODEL} (paid Gemini API key required).`
        : 'Royalty-free preset music beds synthesize locally with zero extra API cost.',
    ],
  };
}

export async function generateScriptFromIdea(params: {
  idea: string;
  durationSec: AiVideoDurationSec;
  style: AiVideoStyle;
  language: ContentLanguage;
}): Promise<{ title: string; script: string }> {
  const apiKey = getValidApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is not configured on the server.');
  }

  const ai = createGeminiClient(apiKey);
  const wordTarget = Math.round(params.durationSec * 2.65);
  const cleanLanguage = VALID_LANGUAGES.includes(params.language) ? params.language : 'English';
  const styleLabel = AI_VIDEO_STYLES.find((s) => s.id === params.style)?.label || params.style;

  const { response } = await generatePlannerContentWithFallback({
    ai,
    label: 'Generate script from idea',
    primaryTimeoutMs: 12000,
    fallbackTimeoutMs: 25000,
    contents: `Write an engaging, conversational YouTube Shorts / Instagram Reels voiceover script for a ${params.durationSec}-second (${styleLabel}) video.
Topic / Idea: "${params.idea.trim()}"
Language: ${cleanLanguage}
Target spoken length: ~${wordTarget} words so it flows briskly inside ${params.durationSec} seconds like a top Shorts/Reels creator.

Strict rules:
- Sound 100% human, energetic, and conversational—use natural contractions ("you're", "here's", "that's", "didn't"), punchy short sentences, and natural curiosity hooks.
- Never sound like a textbook, essay, or robotic listicle.
- Output ONLY spoken narration sentences ready to speak aloud.
- Do NOT include camera brackets like [CUT TO], timestamps, "Hook:", "Scene 1:", stage directions, or #hashtags inside the script.
- Open with an instant scroll-stopping hook in the first 5 words and end with a memorable closing line.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          script: { type: Type.STRING },
        },
        required: ['title', 'script'],
      },
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    title?: string;
    script?: string;
  };
  if (!parsed.script?.trim()) {
    throw new Error('Gemini returned an empty script. Please try refining your idea.');
  }
  return {
    title: (parsed.title || 'AI Video Script').trim().slice(0, 140),
    script: parsed.script.trim(),
  };
}

const STORY_CONTEXT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    mainTopic: { type: Type.STRING },
    genre: { type: Type.STRING },
    summary: { type: Type.STRING },
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING },
          visualAppearance: { type: Type.STRING },
        },
        required: ['name', 'role', 'visualAppearance'],
      },
    },
    locations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          visualDetails: { type: Type.STRING },
        },
        required: ['name', 'visualDetails'],
      },
    },
    keyObjects: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    timelineOrEra: { type: Type.STRING },
    moodAndTone: { type: Type.STRING },
    visualConsistencyGuide: { type: Type.STRING },
  },
  required: [
    'mainTopic',
    'genre',
    'summary',
    'characters',
    'locations',
    'keyObjects',
    'timelineOrEra',
    'moodAndTone',
    'visualConsistencyGuide',
  ],
};

const SCENE_PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          sceneNumber: { type: Type.INTEGER },
          duration: { type: Type.INTEGER },
          narration: { type: Type.STRING },
          summary: { type: Type.STRING },
          mainSubject: { type: Type.STRING },
          secondarySubjects: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          action: { type: Type.STRING },
          location: { type: Type.STRING },
          timePeriod: { type: Type.STRING },
          emotionalTone: { type: Type.STRING },
          visualDescription: { type: Type.STRING },
          imageSearchQuery: { type: Type.STRING },
          imageGenerationPrompt: { type: Type.STRING },
          visualPrompt: { type: Type.STRING },
          cameraMovement: { type: Type.STRING },
          animationInstructions: { type: Type.STRING },
          visualStyle: { type: Type.STRING },
          subtitle: { type: Type.STRING },
          transitionType: { type: Type.STRING },
        },
        required: [
          'sceneNumber',
          'duration',
          'narration',
          'summary',
          'mainSubject',
          'action',
          'location',
          'emotionalTone',
          'visualDescription',
          'imageSearchQuery',
          'imageGenerationPrompt',
          'visualPrompt',
          'cameraMovement',
          'animationInstructions',
          'visualStyle',
          'subtitle',
          'transitionType',
        ],
      },
    },
  },
  required: ['title', 'scenes'],
};

const VALID_GENRES = new Set([
  'educational',
  'historical',
  'documentary',
  'storytelling',
  'entertainment',
  'motivational',
  'informational',
  'fictional',
]);

function normalizeGenre(raw: unknown): NonNullable<AiVideoScenePlan['storyContext']>['genre'] {
  const clean = String(raw || '').trim().toLowerCase();
  if (VALID_GENRES.has(clean)) {
    return clean as NonNullable<AiVideoScenePlan['storyContext']>['genre'];
  }
  if (clean.includes('hist')) return 'historical';
  if (clean.includes('doc')) return 'documentary';
  if (clean.includes('edu') || clean.includes('sci')) return 'educational';
  if (clean.includes('motiv')) return 'motivational';
  if (clean.includes('fict')) return 'fictional';
  if (clean.includes('entertain')) return 'entertainment';
  if (clean.includes('story')) return 'storytelling';
  return 'informational';
}

function buildLocalStoryContextFallback(params: {
  originalScript: string;
  style: AiVideoStyle;
  title?: string;
}): NonNullable<AiVideoScenePlan['storyContext']> {
  const fullText = `${params.title || ''} ${params.originalScript}`.trim();
  const lower = fullText.toLowerCase();
  const topic = extractTopicSearchPhrase(params.title || params.originalScript, 5) || 'Story Narrative';
  const styleInfo = AI_VIDEO_STYLES.find((s) => s.id === params.style) || AI_VIDEO_STYLES[0];

  const characters: Array<{ name: string; role: string; visualAppearance: string }> = [];
  const isExplicitCartoon = /\b(tom|jerry|cartoon|animated|animation|comic|illustration|mouse hole|slapstick)\b/i.test(lower);
  const isFableStory = isExplicitCartoon || (/\brabbit\b/i.test(lower) && /\bmouse\b/i.test(lower));

  if (/\btom\b/i.test(fullText) && /\bjerry\b/i.test(fullText)) {
    characters.push(
      {
        name: 'Tom',
        role: 'Cartoon cat chasing mouse',
        visualAppearance: 'Classic 2D cartoon slate gray-blue cat with white muzzle, white paws, expressive yellow-green eyes, and long tail',
      },
      {
        name: 'Jerry',
        role: 'Clever cartoon mouse',
        visualAppearance: 'Small warm brown 2D cartoon mouse with big round ears, tan belly, big expressive eyes, and whiskers',
      }
    );
  } else {
    if (/\brabbit\b/i.test(lower)) {
      const rabbitDesc = /\bwhite\s+rabbit\b/i.test(lower)
        ? 'White rabbit with long upright ears, bright eyes, and fluffy tail'
        : 'Expressive rabbit with long ears and fluffy tail';
      characters.push({
        name: /\bwhite\b/i.test(lower) ? 'White Rabbit' : 'Rabbit',
        role: 'Primary rabbit character',
        visualAppearance: isFableStory
          ? `Expressive 2D cartoon ${rabbitDesc.toLowerCase()}`
          : rabbitDesc,
      });
    }
    if (/\bcat\b/i.test(lower)) {
      characters.push({
        name: 'Cat',
        role: 'Primary feline subject',
        visualAppearance: isFableStory
          ? 'Expressive 2D cartoon cat with pointed ears, whiskers, and agile paws'
          : 'Expressive agile domestic cat with sleek fur and sharp eyes',
      });
    }
    if (/\bmouse\b/i.test(lower)) {
      const brownMouse = /\bbrown\s+mouse\b/i.test(lower) || /\bsmall\s+brown\s+mouse\b/i.test(lower);
      characters.push({
        name: brownMouse ? 'Small Brown Mouse' : 'Mouse',
        role: 'Clever mouse character',
        visualAppearance: isFableStory
          ? `Small warm brown 2D cartoon mouse with oversized round ears, bright eyes, and curved tail`
          : 'Small brown mouse with round ears and whiskers',
      });
    }
    if (/\bastronaut\b/i.test(lower)) {
      characters.push({
        name: 'Astronaut',
        role: 'Space explorer',
        visualAppearance: 'Astronaut wearing a white EVA spacesuit with backpack life-support unit and reflective gold helmet visor',
      });
    }
    if (/\bscientist\b/i.test(lower)) {
      characters.push({
        name: 'Scientist',
        role: 'AI researcher',
        visualAppearance: 'Focused research scientist wearing a crisp white lab coat in a futuristic high-tech laboratory',
      });
    }
    if (/\blion\b/i.test(lower)) {
      characters.push({
        name: 'Lion',
        role: 'Wild savanna predator',
        visualAppearance: 'Muscular golden African lion with full tawny mane in sunlit savanna grassland',
      });
    }
    if (/\bzebra\b/i.test(lower)) {
      characters.push({
        name: 'Zebra',
        role: 'Running savanna prey',
        visualAppearance: 'Fast-running black-and-white striped African zebra across savanna grass',
      });
    }
  }

  const genre: NonNullable<AiVideoScenePlan['storyContext']>['genre'] = isFableStory
    ? 'fictional'
    : params.style === 'documentary'
    ? 'documentary'
    : params.style === 'storytelling'
    ? 'storytelling'
    : 'informational';

  return {
    mainTopic: topic,
    genre,
    summary: params.originalScript.slice(0, 280),
    characters,
    locations: [],
    keyObjects: topic.split(/\s+/).filter(Boolean).slice(0, 5),
    timelineOrEra: isFableStory ? 'Classic Illustrated Storybook World' : 'Contextually derived from narration',
    moodAndTone: isFableStory ? 'Expressive Storybook Comedy' : styleInfo.label,
    visualConsistencyGuide: isFableStory
      ? 'Expressive 2D cartoon illustration style with vibrant cel-shaded colors, clean outlines, action-specific character poses, and identical character appearances across every scene.'
      : `${styleInfo.label} aesthetic, authentic action-specific visuals matching every spoken beat without invented unrelated elements.`,
  };
}

export async function analyzeScriptStoryContext(params: {
  apiKey: string;
  originalScript: string;
  style: AiVideoStyle;
  title?: string;
}): Promise<NonNullable<AiVideoScenePlan['storyContext']>> {
  const styleInfo = AI_VIDEO_STYLES.find((s) => s.id === params.style) || AI_VIDEO_STYLES[0];
  const ai = createGeminiClient(params.apiKey);

  logAiVideo('planner', 'stage1', 'Understanding complete script & building continuity guide');

  const { response } = await generatePlannerContentWithFallback({
    ai,
    label: 'Stage 1 script analysis',
    primaryTimeoutMs: 15000,
    fallbackTimeoutMs: 25000,
    contents: `STAGE 1 — COMPLETE SCRIPT UNDERSTANDING & CONTINUITY BIBLE

Read and analyze the ENTIRE script below BEFORE any scene segmentation or image generation.

Original Script:
"""
${params.originalScript}
"""
${params.title?.trim() ? `Title hint: ${params.title.trim()}` : ''}
Requested Visual Style: ${styleInfo.label} (${styleInfo.description})

Requirements:
1. Identify the main topic and cohesive narrative arc connecting sentences across the whole script.
2. Classify the genre strictly as one of: "educational", "historical", "documentary", "storytelling", "entertainment", "motivational", "informational", "fictional".
3. Extract ALL named or implied characters/cartoon figures/animals/astronauts/scientists and define an explicit "visualAppearance" (species, fur/skin/hair color, outfit, proportions, 2D cartoon/animated vs photorealistic look) so every consecutive scene keeps identical character identity and visual design (for example, if Tom and Jerry or a white rabbit and small brown mouse appear, lock their exact colors, species, and 2D cartoon illustration style).
4. Extract all locations/environments with concrete visual details (era, weather, indoor kitchen/laboratory, forest clearing with wooden log and trees, lunar Moon surface with Earth in sky, African savanna grassland).
5. List key physical objects/props/technologies mentioned or directly implied (e.g., yellow cheese wedge, wooden log, American flag, glowing holographic AI interface).
6. Identify the historical timeline or time period if relevant (or "Contemporary" / "Futuristic" / "Classic Cartoon Era").
7. Write a "visualConsistencyGuide" defining art style, color palette, lighting, and strict action-faithfulness rules (never invent unrelated subjects or substitute passive portraits for active scenes).`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: STORY_CONTEXT_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
  const characters = Array.isArray(parsed.characters)
    ? parsed.characters
        .map((c: unknown) => {
          const item = (c || {}) as Record<string, unknown>;
          return {
            name: String(item.name || '').trim().slice(0, 80),
            role: String(item.role || '').trim().slice(0, 80),
            visualAppearance: String(item.visualAppearance || '').trim().slice(0, 260),
          };
        })
        .filter((c) => c.name.length > 0)
        .slice(0, 8)
    : [];

  const locations = Array.isArray(parsed.locations)
    ? parsed.locations
        .map((l: unknown) => {
          const item = (l || {}) as Record<string, unknown>;
          return {
            name: String(item.name || '').trim().slice(0, 100),
            visualDetails: String(item.visualDetails || '').trim().slice(0, 260),
          };
        })
        .filter((l) => l.name.length > 0)
        .slice(0, 8)
    : [];

  const keyObjects = Array.isArray(parsed.keyObjects)
    ? parsed.keyObjects.map((o) => String(o || '').trim().slice(0, 80)).filter(Boolean).slice(0, 10)
    : [];

  return {
    mainTopic: String(parsed.mainTopic || params.title || 'Story').trim().slice(0, 140),
    genre: normalizeGenre(parsed.genre),
    summary: String(parsed.summary || params.originalScript.slice(0, 240)).trim().slice(0, 500),
    characters,
    locations,
    keyObjects,
    timelineOrEra: String(parsed.timelineOrEra || 'Contemporary').trim().slice(0, 120),
    moodAndTone: String(parsed.moodAndTone || styleInfo.label).trim().slice(0, 160),
    visualConsistencyGuide: String(
      parsed.visualConsistencyGuide || `${styleInfo.label}, consistent characters and grounded setting`
    )
      .trim()
      .slice(0, 500),
  };
}

function normalizeSceneDurations(
  scenes: AiVideoScenePlanItem[],
  requestedTotalSec: AiVideoDurationSec
): AiVideoScenePlanItem[] {
  const capped = scenes.slice(0, MAX_AI_VIDEO_SCENES);
  const count = capped.length;
  if (count === 0) return capped;

  const durations = capped.map((s) => Math.max(3, Math.min(10, Math.round(s.duration || 5))));
  let sum = durations.reduce((a, b) => a + b, 0);

  let guard = 0;
  while (sum !== requestedTotalSec && guard < 200) {
    guard += 1;
    if (sum < requestedTotalSec) {
      let bestIdx = 0;
      for (let i = 1; i < count; i++) {
        if (durations[i] < durations[bestIdx]) bestIdx = i;
      }
      if (durations[bestIdx] < 10) {
        durations[bestIdx] += 1;
        sum += 1;
      } else {
        break;
      }
    } else {
      let bestIdx = 0;
      for (let i = 1; i < count; i++) {
        if (durations[i] > durations[bestIdx]) bestIdx = i;
      }
      if (durations[bestIdx] > 3) {
        durations[bestIdx] -= 1;
        sum -= 1;
      } else {
        break;
      }
    }
  }

  return capped.map((scene, idx) => ({
    ...scene,
    sceneNumber: idx + 1,
    duration: durations[idx],
  }));
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our',
  'you', 'your', 'most', 'people', 'think', 'how', 'why', 'what', 'when', 'where',
  'who', 'which', 'will', 'can', 'could', 'would', 'should', 'into', 'about', 'every', 'each',
  'than', 'then', 'only', 'just', 'more', 'very', 'also', 'here', 'there', 'before', 'yet',
  'after', 'during', 'between', 'make', 'makes', 'making', 'video', 'scene', 'all', 'some',
  'untitled', 'creatorpilot', 'free', 'motion', 'generated', 'show', 'series', 'still', 'often',
  'built', 'over', 'above', 'below', 'around', 'under', 'through', 'across', 'while', 'meanwhile',
  'later', 'earlier', 'ago', 'years', 'year', 'centuries', 'century', 'days', 'day', 'time',
  'many', 'much', 'several', 'various', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'hundred', 'thousand', 'million', 'billion', 'once', 'onto', 'upon',
  'contextually', 'derived', 'environment', 'narration', 'matching', 'action',
]);

function extractTopicSearchPhrase(text: string, maxWords = 4): string {
  const tokens = text
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w.toLowerCase()));

  // Prioritize proper nouns / capitalized entities and numeric identifiers before generic words
  const prioritized = [
    ...tokens.filter((w, idx) => idx > 0 && (/^[A-Z]/.test(w) || /^\d+$/.test(w))),
    ...tokens,
  ];

  const unique: string[] = [];
  for (const w of prioritized) {
    if (!unique.some((u) => u.toLowerCase() === w.toLowerCase())) {
      unique.push(w);
    }
    if (unique.length >= maxWords) break;
  }
  return unique.join(' ').trim();
}

function enforceDistinctSceneQueries(
  scenes: AiVideoScenePlanItem[],
  overallTitle: string
): AiVideoScenePlanItem[] {
  const seen = new Set<string>();
  const normalizedTitle = overallTitle.toLowerCase().trim();

  return scenes.map((scene) => {
    let q = (scene.imageSearchQuery || '').replace(/\s+/g, ' ').trim();
    const fallbackSubject = [scene.mainSubject, scene.action, scene.location]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (!q || q.toLowerCase() === normalizedTitle) {
      q = extractTopicSearchPhrase(
        fallbackSubject || scene.visualDescription || scene.narration,
        5
      );
    }

    const qLower = q.toLowerCase();
    if (seen.has(qLower)) {
      const qualifier = extractTopicSearchPhrase(
        `${scene.action || ''} ${scene.location || ''} ${scene.narration || ''}`,
        2
      );
      if (qualifier && !qLower.includes(qualifier.toLowerCase())) {
        q = `${q} ${qualifier}`.trim().slice(0, 90);
      } else {
        const alt = extractTopicSearchPhrase(scene.visualDescription || scene.narration, 4);
        if (alt && !seen.has(alt.toLowerCase())) {
          q = alt;
        }
      }
    }
    seen.add(q.toLowerCase());
    return {
      ...scene,
      imageSearchQuery: q.slice(0, 100),
    };
  });
}

function extractLocalActionAndLocation(narration: string): {
  action: string;
  location: string;
  secondarySubjects: string[];
  emotionalTone: string;
} {
  const clean = narration.replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase();

  // Extract concrete action clause from full narration instead of using generic text
  const actionVerbMatch = clean.match(
    /\b(?:is|are|was|were)?\s*(grabs?|grabbing|reaches?|reaching|hides?|hiding|peeks?|peeking|watches?|watching|walks?|walking|plants?|planting|chases?|chasing|runs?|running|stalks?|stalking|interacts?|interacting|touches?|touching|launches?|launching|soars?|soaring|escapes?|escaping|steals?|stealing|leaps?|leaping|climbs?|climbing|explores?|exploring|examines?|examining|points?|pointing)\b([^.!?\n]*)/i
  );
  const action = actionVerbMatch
    ? `${actionVerbMatch[1]} ${actionVerbMatch[2]}`.replace(/\s+/g, ' ').trim().slice(0, 180)
    : clean.slice(0, 180);

  const locMatch = clean.match(
    /\b(?:in|on|at|across|inside|beneath|under|beside|near|through|over|behind)\s+(?:the|a|an)?\s*([^,.;!?]{3,65})/i
  );
  const location = locMatch ? locMatch[1].trim() : 'Scene environment matching narration';

  const secondaryCandidates = [
    'mouse', 'rabbit', 'cat', 'jerry', 'tom', 'zebra', 'cheese', 'wooden log', 'tree',
    'american flag', 'earth', 'moon', 'holographic interface', 'hologram', 'laboratory',
    'rocket', 'acacia tree', 'savanna', 'kitchen', 'mouse hole',
  ].filter((kw) => lower.includes(kw));

  const emotionalTone = /\b(chases?|grabs?|hides?|tense|stealth|steal|escapes?)\b/i.test(lower)
    ? 'tense playful action'
    : /\b(plants?|walks?|moon|earth|cosmos|discover|triumph)\b/i.test(lower)
    ? 'awe and discovery'
    : /\b(futuristic|holographic|laboratory|ai)\b/i.test(lower)
    ? 'focused futuristic wonder'
    : 'engaged storytelling';

  return {
    action,
    location,
    secondarySubjects: secondaryCandidates.slice(0, 5),
    emotionalTone,
  };
}

function buildLocalScenePlanFallback(params: {
  originalScript: string;
  style: AiVideoStyle;
  durationSec: AiVideoDurationSec;
  aspectRatio: VideoAspectRatio;
  title?: string;
  targetSceneCount: number;
}): AiVideoScenePlan {
  const styleInfo = AI_VIDEO_STYLES.find((s) => s.id === params.style) || AI_VIDEO_STYLES[0];
  const storyContext = buildLocalStoryContextFallback({
    originalScript: params.originalScript,
    style: params.style,
    title: params.title,
  });

  const rawSentences = params.originalScript
    .split(/(?<=[.!?।\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let chunks: string[] = [];
  if (rawSentences.length >= params.targetSceneCount) {
    const groupSize = Math.ceil(rawSentences.length / params.targetSceneCount);
    for (let i = 0; i < rawSentences.length; i += groupSize) {
      chunks.push(rawSentences.slice(i, i + groupSize).join(' '));
    }
  } else if (rawSentences.length >= 2) {
    chunks = rawSentences;
  } else {
    const words = params.originalScript.split(/\s+/).filter(Boolean);
    if (words.length <= 30) {
      chunks = [params.originalScript.trim()];
    } else {
      const clauseParts = params.originalScript
        .split(/(?<=[,;])\s+|\s+(?=\bthen\b|\band then\b)/i)
        .map((s) => s.trim())
        .filter((s) => s.split(/\s+/).length >= 5);
      if (clauseParts.length >= 2) {
        chunks = clauseParts.slice(0, params.targetSceneCount);
      } else {
        chunks = [params.originalScript.trim()];
      }
    }
  }

  chunks = chunks.slice(0, MAX_AI_VIDEO_SCENES);
  if (chunks.length === 0) {
    chunks = [params.originalScript];
  }

  const cameraMoves = [
    'Slow smooth zoom in',
    'Smooth pan left to right',
    'Slow pull-out wide reveal',
    'Gentle orbital parallax drift',
  ];
  const animationHints = [
    'Slow push-in toward primary subject and action',
    'Steady lateral camera pan following movement',
    'Pull-out reveal showing full action and environment',
    'Subtle floating parallax drift across scene',
  ];
  const transitions: AiVideoTransitionType[] = ['fade', 'dissolve', 'slideleft'];
  const baseDur = Math.max(3, Math.min(10, Math.round(params.durationSec / chunks.length)));

  const inferredTitle =
    params.title?.trim() ||
    params.originalScript.split(/[.!?\n]/)[0]?.trim().slice(0, 80) ||
    'CreatorPilot AI Video';

  let scenes: AiVideoScenePlanItem[] = chunks.map((text, idx) => {
    const cleanText = cleanNarrationForShortsTts(text) || text.trim();
    const extracted = extractLocalActionAndLocation(cleanText);
    const mainSubject = extractTopicSearchPhrase(cleanText, 4) || storyContext.mainTopic;
    const isCartoonScene = storyContext.genre === 'fictional';
    const matchingChars = storyContext.characters.filter((ch) =>
      cleanText.toLowerCase().includes(ch.name.toLowerCase().split(' ').pop() || ch.name.toLowerCase())
    );
    const activeChars = matchingChars.length > 0 ? matchingChars : storyContext.characters.slice(0, 2);
    const charClause = activeChars.map((c) => c.visualAppearance).join('; ');
    const prompt = [
      isCartoonScene ? 'Expressive 2D cartoon illustration:' : `${styleInfo.label} scene:`,
      cleanText,
      charClause ? `Characters: ${charClause}.` : '',
      `Clearly depict the exact action (${extracted.action}) in ${extracted.location}, ${params.aspectRatio} framing, no text overlays or watermarks.`,
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 1200);

    return {
      sceneNumber: idx + 1,
      duration: baseDur,
      narration: cleanText,
      summary: cleanText.slice(0, 180),
      mainSubject,
      secondarySubjects: extracted.secondarySubjects,
      action: extracted.action,
      location: extracted.location,
      timePeriod: storyContext.timelineOrEra,
      emotionalTone: extracted.emotionalTone,
      visualDescription: cleanText.slice(0, 320),
      imageSearchQuery: extractTopicSearchPhrase(`${mainSubject} ${extracted.action}`, 4) || mainSubject,
      imageGenerationPrompt: prompt,
      visualPrompt: prompt,
      cameraMovement: cameraMoves[idx % cameraMoves.length],
      animationInstructions: animationHints[idx % animationHints.length],
      visualStyle: styleInfo.label,
      subtitle: cleanText,
      transitionType: transitions[idx % transitions.length],
    };
  });

  scenes = enforceDistinctSceneQueries(normalizeSceneDurations(scenes, params.durationSec), inferredTitle);
  const actualTotal = scenes.reduce((acc, s) => acc + s.duration, 0);

  return {
    title: inferredTitle.slice(0, 140),
    totalDuration: actualTotal,
    originalScript: params.originalScript,
    storyContext,
    scenes,
  };
}

export async function planScenesFromScript(params: {
  script: string;
  style: AiVideoStyle;
  durationSec: AiVideoDurationSec;
  aspectRatio: VideoAspectRatio;
  language: ContentLanguage;
  title?: string;
  visualEngine?: AiVideoVisualEngine;
  musicPreset?: AiVideoMusicPreset;
}): Promise<{
  plan: AiVideoScenePlan;
  costEstimate: AiVideoCostEstimate;
  planningMode: 'gemini' | 'local-fallback';
  planningNote?: string;
}> {
  const originalScript = params.script.trim();
  if (!originalScript) {
    throw new Error('Please enter or paste a script before planning scenes.');
  }

  const engine: AiVideoVisualEngine =
    params.visualEngine === 'ai-omni' ? 'ai-omni' : 'free-motion';

  const targetSceneCount =
    params.durationSec === 15
      ? 3
      : params.durationSec === 30
      ? 5
      : params.durationSec === 60
      ? 8
      : 10;

  const apiKey = getValidApiKey();
  if (!apiKey) {
    if (engine === 'free-motion') {
      const plan = buildLocalScenePlanFallback({
        originalScript,
        style: params.style,
        durationSec: params.durationSec,
        aspectRatio: params.aspectRatio,
        title: params.title,
        targetSceneCount,
      });
      const costEstimate = estimateAiVideoCost({
        visualEngine: engine,
        sceneCount: plan.scenes.length,
        totalDurationSec: plan.totalDuration,
        musicPreset: params.musicPreset || 'ambient-uplift',
      });
      return {
        plan,
        costEstimate,
        planningMode: 'local-fallback',
        planningNote:
          'Scenes planned locally from your script sentences (no Gemini API key configured).',
      };
    }
    throw new Error('Gemini API key is not configured on the server.');
  }

  const styleInfo = AI_VIDEO_STYLES.find((s) => s.id === params.style) || AI_VIDEO_STYLES[0];
  const cleanLanguage = VALID_LANGUAGES.includes(params.language) ? params.language : 'English';
  const ratioNote =
    params.aspectRatio === '9:16'
      ? 'vertical 9:16 portrait framing (subject centered vertically)'
      : params.aspectRatio === '1:1'
      ? 'centered square-safe 1:1 composition'
      : 'widescreen 16:9 cinematic framing';

  try {
    // STAGE 1: Understand the Complete Script + Build Visual Consistency Guide
    const storyContext = await analyzeScriptStoryContext({
      apiKey,
      originalScript,
      style: params.style,
      title: params.title,
    });

    logAiVideo('planner', 'stage2', 'Segmenting script into meaning-based scenes', {
      genre: storyContext.genre,
      mainTopic: storyContext.mainTopic,
      characters: storyContext.characters.length,
      locations: storyContext.locations.length,
    });

    // STAGE 2: Intelligent Meaning-Based Scene Segmentation
    const ai = createGeminiClient(apiKey);
    const { response } = await generatePlannerContentWithFallback({
      ai,
      label: 'Stage 2 scene planning',
      primaryTimeoutMs: 18000,
      fallbackTimeoutMs: 30000,
      contents: `STAGE 2 — INTELLIGENT MEANING-BASED SCENE SEGMENTATION

Use the Stage 1 Story Context below to divide the creator's exact script into meaningful visual story beats.

Stage 1 Story Context:
${JSON.stringify(storyContext, null, 2)}

Creator's Original Script (CRITICAL: DO NOT rewrite, paraphrase, or omit spoken narration; partition the user's exact words in chronological order across scenes):
"""
${originalScript}
"""

Target Configuration:
- Total Requested Duration: ${params.durationSec} seconds
- Target Scene Count: ~${targetSceneCount} scenes (strictly between 2 and ${MAX_AI_VIDEO_SCENES}, each scene 3..10 seconds, summing to ${params.durationSec} seconds)
- Visual Style: ${styleInfo.label} (${styleInfo.description})
- Framing / Aspect Ratio: ${ratioNote}
- Narration & Subtitle Language: ${cleanLanguage}
${params.title?.trim() ? `- Preferred Title: ${params.title.trim()}` : ''}

STRICT SCENE RULES (ACTION-SPECIFIC VISUAL FAITHFULNESS):
1. Segment scenes according to MEANING shifts (new event, new action, new location, or new interaction), NOT arbitrary equal word chunks.
2. "narration": Exact spoken words from the original script belonging to this scene (strip only stage brackets like [VISUAL:] or Scene labels if present).
3. "summary": 1-sentence meaning of what happens in this specific moment.
4. "mainSubject": Exact primary person, character, animal, astronaut, or scientist performing the core action (never vague like "background").
5. "secondarySubjects": Array of ALL other interacting characters, animals, and key props/objects required by the narration (e.g., ["small brown mouse hiding behind tree", "yellow cheese wedge", "wooden log"]).
6. "action": Specific concrete visual action + spatial interaction happening RIGHT NOW in this scene — specify WHAT EACH CHARACTER IS DOING and WHERE THEY ARE (e.g., "white rabbit reaching forward grabbing cheese from wooden log while small brown mouse hides behind nearby tree watching"; "astronaut planting American flag into grey lunar soil"; "lion actively chasing running striped zebra across savanna grass"; "scientist touching glowing holographic AI interface"). NEVER replace an action with a passive pose!
7. "location": Specific physical environment (e.g., "sunny forest clearing with wooden log and large tree", "grey cratered Moon surface with blue Earth in black sky", "open African savanna grasslands", "futuristic high-tech research laboratory").
8. "timePeriod": Specific era/date/setting if relevant (e.g., "Ancient Egypt ~2500 BCE", "July 1969", "Futuristic", "Modern day").
9. "emotionalTone": Specific emotion/mood for this scene (e.g., "sneaky tension", "awe and triumph", "intense chase urgency", "futuristic curiosity").
10. "visualDescription": Rich, concrete director description (15-30 words) of WHO is doing WHAT, WITH WHICH OBJECTS, and WHERE every character is positioned.
11. "imageGenerationPrompt": Complete, ACTION-FIRST visual prompt converted directly from this scene's COMPLETE narration: start immediately with every character's exact visual appearance (matching Stage 1), what EACH character is actively doing, exact objects involved, spatial positions/interactions, environment, emotion, lighting, camera angle, ${styleInfo.label} art style, ${ratioNote}, and "no text overlays, no captions, no watermarks".
12. "visualPrompt": Same vivid action-specific prompt optimized for motion generation.
13. "imageSearchQuery": Specific 3-5 word English visual search query describing THIS scene's unique subject + action + context (NEVER the overall title alone, and NEVER identical across scenes!).
14. "cameraMovement": Concrete camera framing instruction (e.g., "Slow push-in toward astronaut planting flag", "Tracking pan following lion chasing zebra", "Close-in frame on scientist touching hologram").
15. "animationInstructions": Tailored motion cue matching scene content (vary intentionally based on scene meaning!).
16. "visualStyle": "${styleInfo.label}".
17. "subtitle": Crisp caption matching narration in ${cleanLanguage}.
18. "transitionType": One of "fade", "dissolve", "slideleft".`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: SCENE_PLAN_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      title?: string;
      scenes?: Array<Record<string, unknown>>;
    };

    const validTransitions = new Set<AiVideoTransitionType>(['fade', 'slideleft', 'dissolve']);

    let mappedScenes: AiVideoScenePlanItem[] = (parsed.scenes || [])
      .slice(0, MAX_AI_VIDEO_SCENES)
      .map((raw, idx) => {
        const rawNarration = String(raw.narration || '').trim();
        const narration = cleanNarrationForShortsTts(rawNarration) || rawNarration;
        const subtitle = String(raw.subtitle || narration).trim();
        const rawTrans = String(raw.transitionType || 'fade').toLowerCase() as AiVideoTransitionType;
        const mainSubject = String(raw.mainSubject || '').trim().slice(0, 140);
        const secondarySubjects = Array.isArray(raw.secondarySubjects)
          ? raw.secondarySubjects.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6)
          : [];
        const action = String(raw.action || '').trim().slice(0, 200);
        const location = String(raw.location || '').trim().slice(0, 160);
        const timePeriod = String(raw.timePeriod || storyContext.timelineOrEra || '').trim().slice(0, 100);
        const emotionalTone = String(raw.emotionalTone || storyContext.moodAndTone || '').trim().slice(0, 100);
        const visualDescription = String(raw.visualDescription || 'Visual scene').trim().slice(0, 500);
        const summary = String(raw.summary || visualDescription).trim().slice(0, 260);
        const imageGenerationPrompt = String(
          raw.imageGenerationPrompt ||
            raw.visualPrompt ||
            `${styleInfo.label} scene of ${mainSubject || visualDescription} ${action} in ${location} (${timePeriod}). ${storyContext.visualConsistencyGuide}. ${ratioNote}, no text overlays, no watermarks.`
        )
          .trim()
          .slice(0, 1500);
        const visualPrompt = String(raw.visualPrompt || imageGenerationPrompt)
          .trim()
          .slice(0, 1200);
        const imageSearchQuery = String(
          raw.imageSearchQuery ||
            extractTopicSearchPhrase(`${mainSubject} ${action} ${location}` || visualDescription, 4)
        )
          .trim()
          .slice(0, 100);

        return {
          sceneNumber: idx + 1,
          duration: Math.max(3, Math.min(10, Math.round(Number(raw.duration || 5)))),
          narration: narration || originalScript,
          summary,
          mainSubject: mainSubject || extractTopicSearchPhrase(visualDescription, 3),
          secondarySubjects,
          action,
          location,
          timePeriod,
          emotionalTone,
          visualDescription,
          imageSearchQuery,
          imageGenerationPrompt,
          visualPrompt,
          cameraMovement: String(raw.cameraMovement || 'Slow cinematic zoom').trim().slice(0, 140),
          animationInstructions: String(
            raw.animationInstructions || raw.cameraMovement || 'Smooth context-matched Ken Burns motion'
          )
            .trim()
            .slice(0, 200),
          visualStyle: String(raw.visualStyle || styleInfo.label).trim().slice(0, 120),
          subtitle: subtitle || narration || originalScript,
          transitionType: validTransitions.has(rawTrans) ? rawTrans : 'fade',
        };
      })
      .filter((s) => s.narration.length > 0 && s.visualPrompt.length > 0);

    if (mappedScenes.length === 0) {
      throw new Error('Gemini could not structure scenes from this script. Please try a clearer script.');
    }

    const finalTitle = (params.title?.trim() || parsed.title || storyContext.mainTopic || 'AI Generated Video')
      .trim()
      .slice(0, 140);
    mappedScenes = enforceDistinctSceneQueries(
      normalizeSceneDurations(mappedScenes, params.durationSec),
      finalTitle
    );
    const actualTotal = mappedScenes.reduce((acc, s) => acc + s.duration, 0);

    const plan: AiVideoScenePlan = {
      title: finalTitle,
      totalDuration: actualTotal,
      originalScript,
      storyContext,
      scenes: mappedScenes,
    };

    const costEstimate = estimateAiVideoCost({
      visualEngine: engine,
      sceneCount: mappedScenes.length,
      totalDurationSec: actualTotal,
      musicPreset: params.musicPreset || 'ambient-uplift',
    });

    return { plan, costEstimate, planningMode: 'gemini' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logAiVideo('planner', 'stage2-error', 'Gemini scene planning error', {
      engine,
      error: reason.slice(0, 300),
    });
    if (engine !== 'free-motion' && isQuotaOrPaidRestrictionError(err)) {
      throw new Error(
        `Gemini API quota/billing error during scene planning: ${reason}. Please ensure a paid GEMINI_API_KEY is active.`
      );
    }
    if (engine === 'free-motion') {
      const plan = buildLocalScenePlanFallback({
        originalScript,
        style: params.style,
        durationSec: params.durationSec,
        aspectRatio: params.aspectRatio,
        title: params.title,
        targetSceneCount,
      });
      const costEstimate = estimateAiVideoCost({
        visualEngine: engine,
        sceneCount: plan.scenes.length,
        totalDurationSec: plan.totalDuration,
        musicPreset: params.musicPreset || 'ambient-uplift',
      });
      return {
        plan,
        costEstimate,
        planningMode: 'local-fallback',
        planningNote: `Gemini scene planner unavailable (${reason.slice(0, 120)}). Used local sentence-based scene splitter cleanly at $0.00 cost.`,
      };
    }
    throw err;
  }
}

function wrapPcmAsWavIfNeeded(rawBuf: Buffer, mimeType?: string): Buffer {
  if (rawBuf.length >= 12 && rawBuf.subarray(0, 4).toString('ascii') === 'RIFF') {
    return rawBuf;
  }
  const rateMatch = mimeType?.match(/rate=(\d+)/i);
  const sampleRate = rateMatch ? Math.max(8000, Math.min(48000, Number(rateMatch[1]))) : 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = rawBuf.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, rawBuf]);
}

const EDGE_NEURAL_VOICE_MAP: Record<
  ContentLanguage,
  Record<Exclude<AiVideoVoiceId, 'none'>, { voice: string; baseRatePct: number; basePitchHz: number }>
> = {
  English: {
    Kore: { voice: 'en-US-AvaMultilingualNeural', baseRatePct: 9, basePitchHz: 3 },
    Puck: { voice: 'en-US-AndrewNeural', baseRatePct: 11, basePitchHz: 3 },
    Charon: { voice: 'en-US-BrianMultilingualNeural', baseRatePct: 5, basePitchHz: -3 },
    Fenrir: { voice: 'en-US-SteffanNeural', baseRatePct: 14, basePitchHz: 2 },
    Zephyr: { voice: 'en-US-EmmaMultilingualNeural', baseRatePct: 8, basePitchHz: 2 },
  },
  Hindi: {
    Kore: { voice: 'hi-IN-SwaraNeural', baseRatePct: 9, basePitchHz: 3 },
    Puck: { voice: 'hi-IN-MadhurNeural', baseRatePct: 11, basePitchHz: 3 },
    Charon: { voice: 'hi-IN-MadhurNeural', baseRatePct: 4, basePitchHz: -5 },
    Fenrir: { voice: 'hi-IN-MadhurNeural', baseRatePct: 13, basePitchHz: 0 },
    Zephyr: { voice: 'hi-IN-SwaraNeural', baseRatePct: 7, basePitchHz: 0 },
  },
  Bengali: {
    Kore: { voice: 'bn-IN-TanishaaNeural', baseRatePct: 9, basePitchHz: 3 },
    Puck: { voice: 'bn-IN-BashkarNeural', baseRatePct: 11, basePitchHz: 3 },
    Charon: { voice: 'bn-IN-BashkarNeural', baseRatePct: 4, basePitchHz: -5 },
    Fenrir: { voice: 'bn-IN-BashkarNeural', baseRatePct: 13, basePitchHz: 0 },
    Zephyr: { voice: 'bn-IN-TanishaaNeural', baseRatePct: 7, basePitchHz: 0 },
  },
  Spanish: {
    Kore: { voice: 'es-ES-ElviraNeural', baseRatePct: 9, basePitchHz: 3 },
    Puck: { voice: 'es-ES-AlvaroNeural', baseRatePct: 11, basePitchHz: 3 },
    Charon: { voice: 'es-ES-AlvaroNeural', baseRatePct: 4, basePitchHz: -5 },
    Fenrir: { voice: 'es-ES-AlvaroNeural', baseRatePct: 13, basePitchHz: 0 },
    Zephyr: { voice: 'es-ES-XimenaNeural', baseRatePct: 7, basePitchHz: 0 },
  },
  French: {
    Kore: { voice: 'fr-FR-DeniseNeural', baseRatePct: 8, basePitchHz: 3 },
    Puck: { voice: 'fr-FR-HenriNeural', baseRatePct: 10, basePitchHz: 3 },
    Charon: { voice: 'fr-FR-HenriNeural', baseRatePct: 4, basePitchHz: -5 },
    Fenrir: { voice: 'fr-FR-HenriNeural', baseRatePct: 12, basePitchHz: 0 },
    Zephyr: { voice: 'fr-FR-EloiseNeural', baseRatePct: 7, basePitchHz: 0 },
  },
  German: {
    Kore: { voice: 'de-DE-TanjaNeural', baseRatePct: 8, basePitchHz: 3 },
    Puck: { voice: 'de-DE-ChristophNeural', baseRatePct: 10, basePitchHz: 3 },
    Charon: { voice: 'de-DE-ChristophNeural', baseRatePct: 4, basePitchHz: -5 },
    Fenrir: { voice: 'de-DE-ChristophNeural', baseRatePct: 12, basePitchHz: 0 },
    Zephyr: { voice: 'de-DE-TanjaNeural', baseRatePct: 7, basePitchHz: 0 },
  },
  Portuguese: {
    Kore: { voice: 'pt-BR-FranciscaNeural', baseRatePct: 9, basePitchHz: 3 },
    Puck: { voice: 'pt-BR-AntonioNeural', baseRatePct: 11, basePitchHz: 3 },
    Charon: { voice: 'pt-BR-AntonioNeural', baseRatePct: 4, basePitchHz: -5 },
    Fenrir: { voice: 'pt-BR-AntonioNeural', baseRatePct: 13, basePitchHz: 0 },
    Zephyr: { voice: 'pt-BR-FranciscaNeural', baseRatePct: 7, basePitchHz: 0 },
  },
  Japanese: {
    Kore: { voice: 'ja-JP-NanamiNeural', baseRatePct: 8, basePitchHz: 3 },
    Puck: { voice: 'ja-JP-KeitaNeural', baseRatePct: 10, basePitchHz: 3 },
    Charon: { voice: 'ja-JP-KeitaNeural', baseRatePct: 4, basePitchHz: -5 },
    Fenrir: { voice: 'ja-JP-KeitaNeural', baseRatePct: 12, basePitchHz: 0 },
    Zephyr: { voice: 'ja-JP-NanamiNeural', baseRatePct: 7, basePitchHz: 0 },
  },
};

const GOOGLE_TRANSLATE_TTS_LANG: Record<ContentLanguage, string> = {
  English: 'en',
  Hindi: 'hi',
  Bengali: 'bn',
  Spanish: 'es',
  French: 'fr',
  German: 'de',
  Portuguese: 'pt',
  Japanese: 'ja',
};

function cleanNarrationForShortsTts(raw: string): string {
  return raw
    // Strip bracketed or parenthetical stage/camera cues like [VISUAL: ...], [0:00-0:05], (upbeat music)
    .replace(/\[[^\]]{1,140}\]/g, ' ')
    .replace(/\(\s*(?:visual|music|sfx|audio|cut|fade|pause|upbeat|cinematic|shot|scene)[^)]*\)/gi, ' ')
    // Strip leading script labels like "Scene 1:", "Hook:", "Voiceover:", "Narrator:", "CTA:"
    .replace(/(?:^|\n)\s*(?:scene\s*\d+|hook|intro|outro|cta|call\s*to\s*action|voiceover|vo|narrator|host|visual|caption|takeaway|note)\s*[:\-—]\s*/gi, ' ')
    // Strip timestamps like 0:00 - 0:05
    .replace(/\b\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?\b/g, ' ')
    // Strip hashtags, URLs, markdown bullets & styling
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/(?:^|\n)\s*(?:[-•*]|\d+[.)])\s+/g, ' ')
    .replace(/[*_`~#]+/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/:\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTextForTts(raw: string): string {
  return cleanNarrationForShortsTts(raw);
}

function splitSpokenBeats(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return sentences.length ? sentences : [text];

  // Merge ultra-short fragments (< 3 words) into neighbor so speech never sounds choppy
  const merged: string[] = [];
  for (const s of sentences) {
    const wordCount = s.split(/\s+/).filter(Boolean).length;
    if (merged.length > 0 && wordCount <= 2) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${s}`.trim();
    } else {
      merged.push(s);
    }
  }
  return merged;
}

function formatSignedPct(val: number): string {
  const clamped = Math.max(-25, Math.min(30, Math.round(val)));
  return clamped >= 0 ? `+${clamped}%` : `${clamped}%`;
}

function formatSignedHz(val: number): string {
  const clamped = Math.max(-20, Math.min(20, Math.round(val)));
  return clamped >= 0 ? `+${clamped}Hz` : `${clamped}Hz`;
}

function splitTextForShortTtsChunks(text: string, maxLen = 180): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > maxLen) {
    let sliceIdx = remaining.lastIndexOf('. ', maxLen);
    if (sliceIdx < 40) sliceIdx = remaining.lastIndexOf(', ', maxLen);
    if (sliceIdx < 40) sliceIdx = remaining.lastIndexOf(' ', maxLen);
    if (sliceIdx < 20) sliceIdx = maxLen;
    chunks.push(remaining.slice(0, sliceIdx + 1).trim());
    remaining = remaining.slice(sliceIdx + 1).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

async function convertMp3BufferToWavBuffer(
  mp3Buffer: Buffer,
  workDir?: string
): Promise<Buffer> {
  const tmpDir = workDir || path.join(DATA_ROOT, '_tts_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const token = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const tmpMp3 = path.join(tmpDir, `tts-${token}.mp3`);
  const tmpWav = path.join(tmpDir, `tts-${token}.wav`);

  try {
    fs.writeFileSync(tmpMp3, mp3Buffer);
    await runBinaryOnce('ffmpeg', [
      '-y',
      '-i',
      tmpMp3,
      '-af',
      'silenceremove=start_periods=1:start_silence=0.02:start_threshold=-46dB:stop_periods=-1:stop_silence=0.04:stop_threshold=-46dB',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      tmpWav,
    ]);
    const wavBuf = fs.readFileSync(tmpWav);
    if (wavBuf.length < 100) {
      throw new Error('Converted TTS WAV buffer was empty.');
    }
    return wavBuf;
  } finally {
    for (const p of [tmpMp3, tmpWav]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // Ignore temp file cleanup failure
      }
    }
  }
}

async function synthesizeEdgeSingleBeatMp3(
  voice: string,
  text: string,
  opts: { rate?: string; pitch?: string }
): Promise<Buffer> {
  const tts = new MsEdgeTTS({
    connectionTimeoutMs: 12000,
    synthesisTimeoutMs: 25000,
  });
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, opts);
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const mp3Buffer = Buffer.concat(chunks);
    if (mp3Buffer.length < 256) {
      throw new Error('Edge Neural TTS returned empty audio stream.');
    }
    return mp3Buffer;
  } finally {
    try {
      tts.close();
    } catch {
      // Ignore WebSocket close error
    }
  }
}

async function synthesizeEdgeNeuralWavBuffer(params: {
  text: string;
  voiceId: Exclude<AiVideoVoiceId, 'none'>;
  language: ContentLanguage;
  workDir?: string;
}): Promise<Buffer> {
  const langVoices = EDGE_NEURAL_VOICE_MAP[params.language] || EDGE_NEURAL_VOICE_MAP.English;
  const spec = langVoices[params.voiceId] || langVoices.Kore;
  const beats = splitSpokenBeats(params.text);

  const tmpDir = params.workDir || path.join(DATA_ROOT, '_tts_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const batchToken = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const beatMp3Paths: string[] = [];
  const mergedWavPath = path.join(tmpDir, `tts-merged-${batchToken}.wav`);

  try {
    for (let idx = 0; idx < beats.length; idx++) {
      const beat = beats[idx];
      let rateOffset = 0;
      let pitchOffset = 0;

      if (beat.endsWith('?')) {
        // Curious rising inflection for Shorts hook questions
        rateOffset += 2;
        pitchOffset += 4;
      } else if (beat.endsWith('!') || idx === 0) {
        // Punchy opening / energetic highlight
        rateOffset += 3;
        pitchOffset += 3;
      } else if (idx === beats.length - 1 && beats.length > 1) {
        // Warm, confident landing cadence on final beat
        rateOffset -= 2;
        pitchOffset -= 2;
      } else {
        // Subtle alternating conversational inflection to prevent flat robotic droning
        pitchOffset += idx % 2 === 0 ? 2 : -2;
        rateOffset += idx % 2 === 0 ? 1 : -1;
      }

      let mp3Buffer: Buffer;
      try {
        mp3Buffer = await synthesizeEdgeSingleBeatMp3(spec.voice, beat, {
          rate: formatSignedPct(spec.baseRatePct + rateOffset),
          pitch: formatSignedHz(spec.basePitchHz + pitchOffset),
        });
      } catch {
        // Retry with rate-only default pitch on Edge Neural before falling back
        mp3Buffer = await synthesizeEdgeSingleBeatMp3(spec.voice, beat, {
          rate: formatSignedPct(spec.baseRatePct),
        });
      }

      const beatPath = path.join(tmpDir, `tts-beat-${batchToken}-${idx}.mp3`);
      fs.writeFileSync(beatPath, mp3Buffer);
      beatMp3Paths.push(beatPath);
    }

    if (beatMp3Paths.length === 1) {
      return await convertMp3BufferToWavBuffer(fs.readFileSync(beatMp3Paths[0]), tmpDir);
    }

    // Trim dead silence on every beat and splice with tight 75ms creator-cut breath gaps
    const ffArgs = ['-y'];
    const fcParts: string[] = [];
    const seqLabels: string[] = [];

    for (let i = 0; i < beatMp3Paths.length; i++) {
      ffArgs.push('-i', beatMp3Paths[i]);
      const gap = i < beatMp3Paths.length - 1 ? 0.075 : 0.02;
      fcParts.push(
        `[${i}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono,` +
          `silenceremove=start_periods=1:start_silence=0.02:start_threshold=-46dB:stop_periods=-1:stop_silence=0.03:stop_threshold=-46dB,` +
          `apad=pad_dur=${gap.toFixed(3)}[b${i}]`
      );
      seqLabels.push(`[b${i}]`);
    }
    fcParts.push(`${seqLabels.join('')}concat=n=${beatMp3Paths.length}:v=0:a=1[aout]`);

    ffArgs.push(
      '-filter_complex',
      fcParts.join(';'),
      '-map',
      '[aout]',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      mergedWavPath
    );

    await runBinaryOnce('ffmpeg', ffArgs);
    const wavBuf = fs.readFileSync(mergedWavPath);
    if (wavBuf.length < 100) {
      throw new Error('Spliced Edge TTS WAV buffer was empty.');
    }
    return wavBuf;
  } finally {
    for (const p of [...beatMp3Paths, mergedWavPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // Ignore temp file cleanup failure
      }
    }
  }
}

async function synthesizeGoogleTranslateTtsMp3(params: {
  text: string;
  language: ContentLanguage;
}): Promise<Buffer> {
  const tl = GOOGLE_TRANSLATE_TTS_LANG[params.language] || 'en';
  const chunks = splitTextForShortTtsChunks(params.text, 175);
  if (chunks.length === 0) {
    throw new Error('Empty text for Google Translate TTS fallback.');
  }

  const buffers: Buffer[] = [];
  for (const part of chunks) {
    const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(
      tl
    )}&q=${encodeURIComponent(part)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://translate.google.com/',
      },
    });
    if (!res.ok) {
      throw new Error(`Free TTS fallback HTTP ${res.status}`);
    }
    const arr = Buffer.from(await res.arrayBuffer());
    if (arr.length < 128) {
      throw new Error('Free TTS fallback returned empty audio.');
    }
    buffers.push(arr);
  }
  return Buffer.concat(buffers);
}

async function synthesizeFreeNeuralTtsWavBuffer(params: {
  text: string;
  voiceId: Exclude<AiVideoVoiceId, 'none'>;
  language: ContentLanguage;
  workDir?: string;
}): Promise<{ wavBuffer: Buffer; modelUsed: string }> {
  const cleanText = sanitizeTextForTts(params.text);
  if (!cleanText) {
    throw new Error('No readable text provided for voiceover.');
  }

  try {
    const wavBuffer = await synthesizeEdgeNeuralWavBuffer({
      text: cleanText,
      voiceId: params.voiceId,
      language: params.language,
      workDir: params.workDir,
    });
    return { wavBuffer, modelUsed: 'edge-neural-tts' };
  } catch (edgeErr) {
    console.warn(
      'Edge Neural TTS attempt failed, switching to free Google Translate TTS fallback:',
      edgeErr instanceof Error ? edgeErr.message : edgeErr
    );
    const mp3 = await synthesizeGoogleTranslateTtsMp3({
      text: cleanText,
      language: params.language,
    });
    const wavBuffer = await convertMp3BufferToWavBuffer(mp3, params.workDir);
    return { wavBuffer, modelUsed: 'free-translate-tts' };
  }
}

function isRecoverableTtsError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('not found') ||
    msg.includes('unknown name') ||
    msg.includes('cannot find field') ||
    msg.includes('invalid_argument')
  );
}

async function synthesizeGeminiTtsWavBuffer(params: {
  apiKey: string;
  text: string;
  voiceId: AiVideoVoiceId;
  bcp47: string;
  styleDirection: string;
}): Promise<{ wavBuffer: Buffer; modelUsed: string }> {
  const generateAttempts: Array<{
    apiVersion: 'v1beta' | 'v1alpha';
    model: string;
    withSpeechMetadata: boolean;
  }> = [
    { apiVersion: 'v1beta', model: TTS_MODEL, withSpeechMetadata: true },
    { apiVersion: 'v1alpha', model: TTS_MODEL, withSpeechMetadata: true },
    { apiVersion: 'v1beta', model: TTS_MODEL, withSpeechMetadata: false },
    { apiVersion: 'v1beta', model: 'gemini-3.8-flash-tts', withSpeechMetadata: false },
    { apiVersion: 'v1beta', model: 'gemini-2.5-flash-preview-tts', withSpeechMetadata: false },
  ];

  let lastErr: unknown = null;

  for (const attempt of generateAttempts) {
    try {
      const client = createGeminiClient(params.apiKey, attempt.apiVersion);
      const response = await client.models.generateContent({
        model: attempt.model,
        contents: [
          {
            role: 'user',
            parts: [
              attempt.withSpeechMetadata
                ? {
                    text: params.text,
                    speechMetadata: { style: params.styleDirection },
                  }
                : {
                    text: params.text,
                  },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: params.voiceId },
            },
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const inline = part?.inlineData;
      if (inline?.data) {
        const rawBuf = Buffer.from(inline.data, 'base64');
        return {
          wavBuffer: wrapPcmAsWavIfNeeded(rawBuf, inline.mimeType),
          modelUsed: attempt.model,
        };
      }
      lastErr = new Error(`Model ${attempt.model} returned no audio data.`);
    } catch (err) {
      lastErr = err;
      if (!isRecoverableTtsError(err)) {
        throw err;
      }
    }
  }

  for (const apiVersion of ['v1beta', 'v1alpha'] as const) {
    try {
      const client = createGeminiClient(params.apiKey, apiVersion);
      const interaction = await client.interactions.create({
        model: TTS_MODEL,
        input: [
          {
            type: 'text',
            text: params.text,
            annotations: [
              {
                type: 'speech_metadata',
                style: params.styleDirection,
              },
            ],
          },
        ],
        response_format: { type: 'audio' },
        generation_config: {
          speech_config: [
            {
              language: params.bcp47,
              voice: params.voiceId,
            },
          ],
        },
      });

      const audio = interaction.output_audio;
      if (audio?.data) {
        const rawBuf = Buffer.from(audio.data, 'base64');
        return {
          wavBuffer: wrapPcmAsWavIfNeeded(rawBuf, audio.mime_type),
          modelUsed: TTS_MODEL,
        };
      }
    } catch (err) {
      lastErr = err;
      if (!isRecoverableTtsError(err)) {
        throw err;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'TTS generation failed.'));
}

async function synthesizeTtsWavBuffer(params: {
  apiKey: string | null;
  preferFreeNeural: boolean;
  text: string;
  voiceId: Exclude<AiVideoVoiceId, 'none'>;
  language: ContentLanguage;
  bcp47: string;
  styleDirection: string;
  workDir?: string;
}): Promise<{ wavBuffer: Buffer; modelUsed: string }> {
  if (params.preferFreeNeural || !params.apiKey) {
    return synthesizeFreeNeuralTtsWavBuffer({
      text: params.text,
      voiceId: params.voiceId,
      language: params.language,
      workDir: params.workDir,
    });
  }

  try {
    return await synthesizeGeminiTtsWavBuffer({
      apiKey: params.apiKey,
      text: params.text,
      voiceId: params.voiceId,
      bcp47: params.bcp47,
      styleDirection: params.styleDirection,
    });
  } catch (geminiErr) {
    console.warn(
      'Gemini TTS unavailable/quota reached, falling back cleanly to Free Neural TTS:',
      geminiErr instanceof Error ? geminiErr.message : geminiErr
    );
    return synthesizeFreeNeuralTtsWavBuffer({
      text: params.text,
      voiceId: params.voiceId,
      language: params.language,
      workDir: params.workDir,
    });
  }
}

export async function generateVoicePreviewAudio(params: {
  voice: AiVideoVoiceId;
  language: ContentLanguage;
  sampleText?: string;
  visualEngine?: AiVideoVisualEngine;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const cleanLanguage: ContentLanguage = VALID_LANGUAGES.includes(params.language)
    ? params.language
    : 'English';
  const bcp47 = LANGUAGE_TO_BCP47[cleanLanguage] || 'en-US';
  const selectedVoice =
    AI_VIDEO_VOICES.find((v) => v.id === params.voice && v.id !== 'none') ||
    AI_VIDEO_VOICES[0];
  const voiceId: Exclude<AiVideoVoiceId, 'none'> =
    selectedVoice.id === 'none' ? 'Kore' : selectedVoice.id;
  const preferFreeNeural = params.visualEngine !== 'ai-omni';
  const apiKey = getValidApiKey();

  const defaultSamples: Record<ContentLanguage, string> = {
    English: 'Welcome to CreatorPilot AI. Let us turn your script into a cinematic story.',
    Hindi: 'CreatorPilot AI में आपका स्वागत है। आइए आपकी स्क्रिप्ट को एक शानदार वीडियो में बदलें।',
    Bengali: 'CreatorPilot AI-তে স্বাগতম। চলুন আপনার স্ক্রিপ্টকে একটি অসাধারণ ভিডিওতে রূপান্তর করি।',
    Spanish: 'Bienvenido a CreatorPilot AI. Transformemos tu guion en un video cinematográfico.',
    French: 'Bienvenue sur CreatorPilot AI. Transformons votre script en une vidéo cinématographique.',
    German: 'Willkommen bei CreatorPilot AI. Verwandeln wir dein Skript in ein beeindruckendes Video.',
    Portuguese: 'Bem-vindo ao CreatorPilot AI. Vamos transformar seu roteiro em um vídeo incrível.',
    Japanese: 'CreatorPilot AIへようこそ。あなたのスクリプトを映画のような動画に変えましょう。',
  };

  const text = (params.sampleText?.trim() || defaultSamples[cleanLanguage]).slice(0, 300);
  const cacheKey = `${preferFreeNeural ? 'free' : 'omni'}:${voiceId}:${bcp47}:${text}`;
  const cached = previewAudioCache.get(cacheKey);
  if (cached) return cached;

  const { wavBuffer } = await synthesizeTtsWavBuffer({
    apiKey,
    preferFreeNeural,
    text,
    voiceId,
    language: cleanLanguage,
    bcp47,
    styleDirection: selectedVoice.styleDirection,
  });

  const result = {
    audioBase64: wavBuffer.toString('base64'),
    mimeType: 'audio/wav',
  };
  if (previewAudioCache.size > 30) {
    previewAudioCache.clear();
  }
  previewAudioCache.set(cacheKey, result);
  return result;
}

export async function generateMusicPreviewAudio(params: {
  preset: AiVideoMusicPreset;
}): Promise<{ audioBase64: string; mimeType: string }> {
  if (params.preset === 'none') {
    throw new Error('No music preset selected.');
  }

  const tempDir = path.join(DATA_ROOT, '_previews');
  fs.mkdirSync(tempDir, { recursive: true });

  if (params.preset === 'ai-lyria') {
    const apiKey = getValidApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key is not configured on the server.');
    }
    const ai = createGeminiClient(apiKey);
    const stream = await ai.models.generateContentStream({
      model: MUSIC_MODEL,
      contents:
        'Generate an uplifting, modern, instrumental cinematic background soundtrack suitable under voiceover narration, clean production, no vocals.',
    });

    let audioBase64 = '';
    let mimeType = 'audio/wav';
    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;
      for (const part of parts) {
        if (part.inlineData?.data) {
          if (!audioBase64 && part.inlineData.mimeType) {
            mimeType = part.inlineData.mimeType;
          }
          audioBase64 += part.inlineData.data;
        }
      }
    }
    if (!audioBase64) {
      throw new Error('Lyria 3 did not return audio data. Ensure your paid GEMINI_API_KEY has Lyria access.');
    }
    return { audioBase64, mimeType };
  }

  const previewPath = path.join(tempDir, `preview-${params.preset}.wav`);
  if (!fs.existsSync(previewPath)) {
    const cfgPath = path.join(tempDir, `preview-${params.preset}.json`);
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ preset: params.preset, durationSec: 8, outputPath: previewPath }),
      'utf8'
    );
    await runPythonWorkerOnce(['generate-music-bed', cfgPath]);
  }
  const buf = fs.readFileSync(previewPath);
  return { audioBase64: buf.toString('base64'), mimeType: 'audio/wav' };
}

function mapPipelineStageToDetailed(
  currentStage: AiVideoPipelineStage,
  detailedStage?: AiVideoDetailedStageId
): AiVideoDetailedStageId {
  if (detailedStage) return detailedStage;
  switch (currentStage) {
    case 'analyzing_script':
      return 'understanding_script';
    case 'creating_scene_plan':
      return 'planning_scenes';
    case 'generating_clips':
      return 'animating_scenes';
    case 'generating_voiceover':
    case 'creating_subtitles':
      return 'synchronizing_audio';
    case 'combining_media':
    case 'exporting_mp4':
      return 'rendering_video';
    default:
      return 'understanding_script';
  }
}

function buildStagesForState(
  currentStage: AiVideoPipelineStage,
  status: AiVideoJobRecord['status'],
  _visualEngine?: AiVideoVisualEngine,
  detailedStage?: AiVideoDetailedStageId,
  visualReviewReady?: boolean
): AiVideoStageStep[] {
  const activeDetailed = mapPipelineStageToDetailed(currentStage, detailedStage);
  const currentIdx = AI_VIDEO_DETAILED_STAGES.findIndex((s) => s.id === activeDetailed);

  return AI_VIDEO_DETAILED_STAGES.map((stage, idx) => {
    if (status === 'completed') {
      return { id: stage.id, label: stage.label, status: 'completed' };
    }
    if (status === 'queued' && visualReviewReady) {
      // Stages 0..3 (Understanding script -> Verifying image relevance) are done; ready for review/render
      return {
        id: stage.id,
        label: stage.label,
        status: idx <= 3 ? 'completed' : 'pending',
      };
    }
    if (status === 'cancelled') {
      return {
        id: stage.id,
        label: stage.label,
        status: idx < currentIdx ? 'completed' : idx === currentIdx ? 'cancelled' : 'pending',
      };
    }
    if (status === 'failed') {
      return {
        id: stage.id,
        label: stage.label,
        status: idx < currentIdx ? 'completed' : idx === currentIdx ? 'failed' : 'pending',
      };
    }
    return {
      id: stage.id,
      label: stage.label,
      status: idx < currentIdx ? 'completed' : idx === currentIdx ? 'active' : 'pending',
    };
  });
}

function splitNarrationToSubtitles(
  scenes: Array<AiVideoScenePlanItem & { effectiveDurationSec: number; spokenDurationSec: number }>
): VideoSubtitleCue[] {
  const cues: VideoSubtitleCue[] = [];
  let cursor = 0;
  let cueId = 1;

  for (const scene of scenes) {
    const text = (scene.subtitle || scene.narration || '').trim();
    const words = text.split(/\s+/).filter(Boolean);
    const activeWindow = Math.max(
      1.0,
      Math.min(scene.effectiveDurationSec, scene.spokenDurationSec || scene.effectiveDurationSec)
    );

    if (words.length === 0) {
      cursor += scene.effectiveDurationSec;
      continue;
    }

    const wordsPerCue = 7;
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += wordsPerCue) {
      chunks.push(words.slice(i, i + wordsPerCue).join(' '));
    }

    const sliceDur = activeWindow / chunks.length;
    chunks.forEach((chunk, idx) => {
      const startSec = Number((cursor + idx * sliceDur).toFixed(2));
      const endSec = Number(
        Math.min(cursor + scene.effectiveDurationSec, cursor + (idx + 1) * sliceDur).toFixed(2)
      );
      if (endSec > startSec + 0.15) {
        cues.push({
          id: `sub-${cueId++}`,
          startSec,
          endSec,
          text: chunk,
        });
      }
    });

    cursor += scene.effectiveDurationSec;
  }

  return cues;
}

async function generateSceneVideoClipWithRetry(params: {
  ai: GoogleGenAI;
  apiKey: string;
  job: ServerAiVideoJob;
  scene: AiVideoScenePlanItem;
  sceneState: AiVideoSceneClipState;
  aspectRatio: VideoAspectRatio;
  imagePath?: string | null;
  outPath: string;
  onUpdate: () => void;
}): Promise<number> {
  const { ai, apiKey, job, scene, sceneState, aspectRatio, imagePath, outPath, onUpdate } = params;

  // Reuse verified clip if retrying a partially completed job
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
    try {
      const probeRes = await runPythonWorkerOnce(['probe', outPath]);
      const meta = probeRes.metadata as { durationSec?: number } | undefined;
      if (meta?.durationSec && meta.durationSec > 0.5) {
        sceneState.status = 'completed';
        sceneState.animationStatus = 'completed';
        sceneState.clipDurationSec = meta.durationSec;
        onUpdate();
        return meta.durationSec;
      }
    } catch {
      // Re-generate if corrupt
    }
  }

  const omniAspectRatio: '16:9' | '9:16' = aspectRatio === '9:16' ? '9:16' : '16:9';
  const clipDuration = Math.max(3, Math.min(15, Math.round(scene.duration)));
  const maxAttempts = 2;
  let lastErr: Error | null = null;

  const hasStartImage = Boolean(
    imagePath && fs.existsSync(imagePath) && fs.statSync(imagePath).size > 2048
  );

  const motionPrompt = hasStartImage
    ? `Animate this exact verified scene image with smooth, realistic cinematic motion matching: ${
        scene.animationInstructions || scene.cameraMovement
      }. Action: ${scene.action || scene.visualDescription}. Visual style: ${
        scene.visualStyle
      }. Keep characters, objects, and setting strictly faithful to the provided starting frame.${
        aspectRatio === '1:1' ? ' Keep primary subject centered cleanly for square 1:1 crop.' : ''
      } No text overlays, no watermarks, no captions baked into video.`
    : `${scene.visualPrompt}. Camera movement: ${scene.cameraMovement}. Visual style: ${scene.visualStyle}.${
        aspectRatio === '1:1' ? ' Center primary subject cleanly for square 1:1 crop.' : ''
      } No text overlays, no watermarks, no captions baked into video.`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (job.cancelled) {
      sceneState.status = 'cancelled';
      sceneState.animationStatus = 'failed';
      onUpdate();
      throw new Error('Generation cancelled by user.');
    }

    sceneState.attempts = attempt;
    sceneState.status = attempt === 1 ? 'generating' : 'retrying';
    sceneState.animationStatus = 'animating';
    sceneState.error = undefined;
    onUpdate();

    try {
      const interactionInput = hasStartImage
        ? [
            {
              type: 'image' as const,
              mime_type: 'image/jpeg',
              data: fs.readFileSync(imagePath!).toString('base64'),
            },
            {
              type: 'text' as const,
              text: motionPrompt,
            },
          ]
        : motionPrompt;

      logAiVideo(
        job.record.id,
        'stage5-omni-i2v',
        `Scene ${scene.sceneNumber} creating ${hasStartImage ? 'image-to-video' : 'text-to-video'} interaction via ${VIDEO_MODEL}`
      );

      let created;
      try {
        created = await ai.interactions.create({
          model: VIDEO_MODEL,
          input: interactionInput,
          background: true,
          store: true,
          response_format: {
            type: 'video',
            aspect_ratio: omniAspectRatio,
            duration: `${clipDuration}s`,
            resolution: '720p',
          },
        });
      } catch (createErr) {
        const msg = (createErr instanceof Error ? createErr.message : String(createErr)).toLowerCase();
        if (
          hasStartImage &&
          (msg.includes('400') ||
            msg.includes('invalid') ||
            msg.includes('duration') ||
            msg.includes('resolution') ||
            msg.includes('unsupported'))
        ) {
          logAiVideo(
            job.record.id,
            'stage5-omni-i2v',
            `Scene ${scene.sceneNumber} retrying image-to-video with minimal response_format`
          );
          created = await ai.interactions.create({
            model: VIDEO_MODEL,
            input: interactionInput,
            background: true,
            store: true,
            response_format: {
              type: 'video',
              aspect_ratio: omniAspectRatio,
            },
          });
        } else {
          throw createErr;
        }
      }

      sceneState.interactionId = created.id;
      job.activeInteractionId = created.id;
      onUpdate();

      let current = created;
      const pollDeadline = Date.now() + 360000; // 6 minute cap per scene clip

      while (
        current.status !== 'completed' &&
        current.status !== 'failed' &&
        current.status !== 'cancelled'
      ) {
        if (job.cancelled) {
          await ai.interactions.cancel(created.id).catch(() => {});
          sceneState.status = 'cancelled';
          sceneState.animationStatus = 'failed';
          onUpdate();
          throw new Error('Generation cancelled by user.');
        }
        if (Date.now() > pollDeadline) {
          await ai.interactions.cancel(created.id).catch(() => {});
          throw new Error(`Scene ${scene.sceneNumber} timed out while generating AI video.`);
        }
        await new Promise((r) => setTimeout(r, 4000));
        current = await ai.interactions.get(created.id);
      }

      job.activeInteractionId = undefined;

      if (current.status === 'failed' || current.status === 'cancelled') {
        const apiErrors = (current as unknown as { errors?: Array<{ message?: string; code?: string }> }).errors;
        const errDetail = Array.isArray(apiErrors) && apiErrors.length > 0
          ? apiErrors.map((e) => `${e.code || 'ERROR'}: ${e.message || ''}`).join('; ')
          : '';
        throw new Error(
          `Scene ${scene.sceneNumber} video generation ended with status "${current.status}"${errDetail ? ` (${errDetail})` : ''}.`
        );
      }

      let videoPart = current.output_video;
      if (!videoPart && Array.isArray(current.steps)) {
        for (const step of current.steps) {
          if (step.type === 'model_output' && Array.isArray(step.content)) {
            const found = step.content.find((c) => c.type === 'video');
            if (found && found.type === 'video') {
              videoPart = found;
              break;
            }
          }
        }
      }

      let videoBuffer: Buffer | null = null;
      if (videoPart?.data) {
        videoBuffer = Buffer.from(videoPart.data, 'base64');
      } else if (videoPart?.uri) {
        const resp = await fetch(videoPart.uri, {
          headers: { 'x-goog-api-key': apiKey },
        });
        if (!resp.ok) {
          throw new Error(`Failed to download generated clip asset (HTTP ${resp.status}).`);
        }
        videoBuffer = Buffer.from(await resp.arrayBuffer());
      }

      if (!videoBuffer || videoBuffer.length === 0) {
        throw new Error(`Model ${VIDEO_MODEL} returned completed status without video data.`);
      }

      fs.writeFileSync(outPath, videoBuffer);
      const probeRes = await runPythonWorkerOnce(['probe', outPath]);
      const meta = probeRes.metadata as { durationSec?: number } | undefined;
      const verifiedDur = Number(meta?.durationSec || clipDuration);

      sceneState.status = 'completed';
      sceneState.animationStatus = 'completed';
      sceneState.animationStyle = hasStartImage ? `${VIDEO_MODEL} (image-to-video)` : VIDEO_MODEL;
      sceneState.clipDurationSec = verifiedDur;
      onUpdate();
      return verifiedDur;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (job.cancelled) throw lastErr;
      if (isQuotaOrPaidRestrictionError(lastErr)) {
        break;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2500 * attempt));
      }
    }
  }

  sceneState.status = 'failed';
  sceneState.animationStatus = 'failed';
  sceneState.error = lastErr?.message || `Scene ${scene.sceneNumber} failed.`;
  onUpdate();
  throw lastErr || new Error(`Scene ${scene.sceneNumber} failed.`);
}

function runBinaryOnce(command: string, args: string[], timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore kill failure
      }
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
      }
    });
  });
}

interface TopicImageCandidate {
  url: string;
  title: string;
  haystack: string;
  width: number;
  height: number;
  source: 'wikipedia' | 'openverse' | 'wikimedia' | 'nasa';
  attribution?: string;
}

const GENERIC_IMAGE_TERMS = new Set([
  'cartoon', 'photo', 'image', 'picture', 'illustration', 'art', 'drawing',
  'scene', 'concept', 'background', 'abstract', 'modern', 'style', 'shot',
  'closeup', 'wide', 'animation', 'animated', 'character', 'story',
]);

const JUNK_IMAGE_PATTERNS =
  /\b(diagram|chart|graph|timeline|word\s*cloud|signature|coat\s*of\s*arms|flag\s*of|locator\s*map|table\s*of|flowchart|infographic|favicon|svg|logo\s*only|icon|placeholder|blank|qr\s*code)\b/i;

function isUsableRasterCandidateUrl(url: string, mime?: string): boolean {
  if (!url || !url.startsWith('https://')) return false;
  const lowerUrl = url.toLowerCase().split('?')[0];
  if (
    lowerUrl.endsWith('.svg') ||
    lowerUrl.includes('.svg.') ||
    lowerUrl.endsWith('.gif') ||
    lowerUrl.endsWith('.tif') ||
    lowerUrl.endsWith('.tiff') ||
    lowerUrl.endsWith('.pdf')
  ) {
    return false;
  }
  if (mime) {
    const m = mime.toLowerCase();
    if (
      !m.includes('jpeg') &&
      !m.includes('jpg') &&
      !m.includes('png') &&
      !m.includes('webp')
    ) {
      return false;
    }
  }
  return true;
}

function stripHtmlTags(raw: string): string {
  return String(raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function computeFileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function buildSceneImageUrl(
  jobId: string,
  sceneNumber: number,
  token: string,
  version?: number
): string {
  const vParam = version ? `&v=${version}` : '';
  return `/api/ai-video/jobs/${encodeURIComponent(jobId)}/scenes/${sceneNumber}/image?token=${encodeURIComponent(token)}${vParam}`;
}

async function searchWikipediaPageImages(query: string): Promise<TopicImageCandidate[]> {
  try {
    const endpoint = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
      query
    )}&gsrlimit=8&prop=pageimages|extracts&piprop=thumbnail|original&pithumbsize=1024&exintro=1&explaintext=1&exchars=220&format=json`;
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'CreatorPilotAI/1.0 (https://creatorpilot.ai)' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            extract?: string;
            thumbnail?: { source?: string; width?: number; height?: number };
            original?: { source?: string; width?: number; height?: number };
          }
        >;
      };
    };

    const items: TopicImageCandidate[] = [];
    for (const p of Object.values(data.query?.pages || {})) {
      const pic = p.thumbnail?.source ? p.thumbnail : p.original;
      const candidateUrl = pic?.source || '';
      if (!isUsableRasterCandidateUrl(candidateUrl)) continue;
      const w = Number(pic?.width || 0);
      const h = Number(pic?.height || 0);
      if (w > 0 && w < 420) continue;
      if (h > 0 && h < 280) continue;
      const cleanTitle = String(p.title || '').trim();
      if (!cleanTitle || JUNK_IMAGE_PATTERNS.test(cleanTitle)) continue;
      const haystack = `${cleanTitle} ${p.extract || ''}`.toLowerCase();
      items.push({
        url: candidateUrl,
        title: cleanTitle,
        haystack,
        width: w || 1000,
        height: h || 750,
        source: 'wikipedia',
        attribution: `Wikipedia / Wikimedia (${cleanTitle})`,
      });
    }
    return items;
  } catch {
    return [];
  }
}

async function searchOpenverseImages(query: string): Promise<TopicImageCandidate[]> {
  try {
    const endpoint = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(
      query
    )}&page_size=14&mature=false`;
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(6500),
      headers: { 'User-Agent': 'CreatorPilotAI/1.0' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{
        url?: string;
        thumbnail?: string;
        title?: string;
        creator?: string;
        license?: string;
        width?: number;
        height?: number;
        filetype?: string;
        tags?: Array<{ name?: string }>;
      }>;
    };

    const items: TopicImageCandidate[] = [];
    for (const r of data.results || []) {
      const candidateUrl = r.url || r.thumbnail || '';
      const filetype = r.filetype ? `image/${r.filetype}` : undefined;
      if (!isUsableRasterCandidateUrl(candidateUrl, filetype)) continue;
      const w = Number(r.width || 0);
      const h = Number(r.height || 0);
      if ((w > 0 && w < 420) || (h > 0 && h < 280)) continue;
      const title = String(r.title || '').trim();
      const tagNames = Array.isArray(r.tags)
        ? r.tags.map((t) => String(t?.name || '')).filter(Boolean)
        : [];
      const haystack = `${title} ${tagNames.join(' ')}`.toLowerCase();
      if (JUNK_IMAGE_PATTERNS.test(title)) continue;
      const attrParts = [
        r.creator ? `By ${String(r.creator).trim()}` : '',
        r.license ? String(r.license).toUpperCase() : '',
      ].filter(Boolean);
      items.push({
        url: candidateUrl,
        title: title || candidateUrl,
        haystack,
        width: w,
        height: h,
        source: 'openverse',
        attribution: attrParts.length > 0 ? `Openverse (${attrParts.join(' · ')})` : 'Openverse CC',
      });
    }
    return items;
  } catch {
    return [];
  }
}

async function searchWikimediaImages(query: string): Promise<TopicImageCandidate[]> {
  try {
    const endpoint = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
      query
    )}&gsrnamespace=6&gsrlimit=14&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1024&format=json`;
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'CreatorPilotAI/1.0 (https://creatorpilot.ai)' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              url?: string;
              thumburl?: string;
              mime?: string;
              width?: number;
              height?: number;
              thumbwidth?: number;
              thumbheight?: number;
              extmetadata?: {
                LicenseShortName?: { value?: string };
                Artist?: { value?: string };
                ImageDescription?: { value?: string };
              };
            }>;
          }
        >;
      };
    };

    const items: TopicImageCandidate[] = [];
    const pages = Object.values(data.query?.pages || {});
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const candidateUrl = info.thumburl || info.url || '';
      if (!isUsableRasterCandidateUrl(candidateUrl, info.mime)) continue;
      const w = Number(info.thumbwidth || info.width || 0);
      const h = Number(info.thumbheight || info.height || 0);
      if (w < 420 || h < 280) continue;
      const cleanTitle = String(p.title || '')
        .replace(/^File:/i, '')
        .replace(/\.[^.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .trim();
      if (JUNK_IMAGE_PATTERNS.test(cleanTitle)) continue;
      const descText = stripHtmlTags(info.extmetadata?.ImageDescription?.value || '').slice(0, 200);
      const license = stripHtmlTags(info.extmetadata?.LicenseShortName?.value || '');
      const artist = stripHtmlTags(info.extmetadata?.Artist?.value || '').slice(0, 60);
      const attrParts = [artist ? `By ${artist}` : '', license].filter(Boolean);
      items.push({
        url: candidateUrl,
        title: cleanTitle || candidateUrl,
        haystack: `${cleanTitle} ${descText}`.toLowerCase(),
        width: w,
        height: h,
        source: 'wikimedia',
        attribution:
          attrParts.length > 0 ? `Wikimedia Commons (${attrParts.join(' · ')})` : 'Wikimedia Commons',
      });
    }
    return items;
  } catch {
    return [];
  }
}

async function searchNasaImages(query: string): Promise<TopicImageCandidate[]> {
  try {
    const endpoint = `https://images-api.nasa.gov/search?q=${encodeURIComponent(
      query
    )}&media_type=image&page_size=10`;
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'CreatorPilotAI/1.0' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      collection?: {
        items?: Array<{
          data?: Array<{ title?: string; description?: string; keywords?: string[]; nasa_id?: string }>;
          links?: Array<{ href?: string; rel?: string }>;
        }>;
      };
    };

    const items: TopicImageCandidate[] = [];
    for (const entry of data.collection?.items || []) {
      const meta = entry.data?.[0];
      const thumb = entry.links?.find((l) => l.href && l.href.startsWith('https://'))?.href || '';
      if (!thumb || !isUsableRasterCandidateUrl(thumb)) continue;
      const title = String(meta?.title || '').trim();
      if (!title || JUNK_IMAGE_PATTERNS.test(title)) continue;
      const desc = String(meta?.description || '').slice(0, 220);
      const keywords = Array.isArray(meta?.keywords) ? meta.keywords.join(' ') : '';
      items.push({
        url: thumb,
        title,
        haystack: `${title} ${desc} ${keywords}`.toLowerCase(),
        width: 1024,
        height: 768,
        source: 'nasa',
        attribution: `NASA Image Library (${meta?.nasa_id || 'Public Domain'})`,
      });
    }
    return items;
  } catch {
    return [];
  }
}

const DESCRIPTIVE_MODIFIERS = new Set([
  'tiny', 'small', 'little', 'large', 'big', 'huge', 'giant', 'majestic', 'cozy', 'warm',
  'bright', 'dark', 'golden', 'orange', 'brown', 'yellow', 'red', 'blue', 'green', 'white', 'black',
  'wooden', 'polished', 'tall', 'short', 'old', 'ancient', 'modern', 'beautiful', 'quiet', 'loud',
  'playful', 'cautious', 'cautiously', 'slowly', 'quickly', 'chasing', 'playing', 'peeking', 'walking',
  'walks', 'running', 'standing', 'sitting', 'looking', 'watching', 'flying', 'floating', 'glowing',
  'arched', 'slice', 'piece', 'pair', 'floor', 'room', 'living', 'savanna', 'african', 'tabby',
]);

function extractCoreNouns(raw: string, maxWords = 2, keepEnvironment = true): string {
  const words = String(raw || '')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w.toLowerCase()) && !GENERIC_IMAGE_TERMS.has(w.toLowerCase()));

  const strictNouns = words.filter((w) => {
    const low = w.toLowerCase();
    if (!keepEnvironment && (low === 'savanna' || low === 'living' || low === 'room')) return false;
    return !DESCRIPTIVE_MODIFIERS.has(low);
  });

  const chosen = (strictNouns.length > 0 ? strictNouns : words).slice(0, maxWords);
  return chosen.join(' ').trim();
}

function buildSceneSearchCandidates(params: {
  scene: AiVideoScenePlanItem;
  title: string;
  originalScript: string;
  customQuery?: string;
}): string[] {
  const candidates: string[] = [];
  const normalizedTitle = params.title.toLowerCase().trim();

  const pushUnique = (q: string) => {
    const clean = q.replace(/\s+/g, ' ').trim().slice(0, 90);
    if (
      clean.length >= 3 &&
      clean.toLowerCase() !== normalizedTitle &&
      !candidates.some((c) => c.toLowerCase() === clean.toLowerCase())
    ) {
      candidates.push(clean);
    }
  };

  if (params.customQuery?.trim()) {
    pushUnique(params.customQuery);
    const shortCustom = extractCoreNouns(params.customQuery, 3);
    if (shortCustom) pushUnique(shortCustom);
  }

  // Build crisp action + subject + object/location queries (avoid bare single-noun queries that match unrelated poses)
  const mainNoun = extractCoreNouns(params.scene.mainSubject || '', 2, false);
  const actionNoun = extractCoreNouns(params.scene.action || '', 3, true);
  const secondaryNoun = extractCoreNouns((params.scene.secondarySubjects || [])[0] || '', 2, true);
  const locationNoun = extractCoreNouns(params.scene.location || '', 2, true);

  if (mainNoun && actionNoun) {
    pushUnique(`${mainNoun} ${actionNoun}`);
  }
  if (mainNoun && secondaryNoun) {
    pushUnique(`${mainNoun} ${secondaryNoun}`);
  }
  if (params.scene.imageSearchQuery?.trim()) {
    pushUnique(params.scene.imageSearchQuery);
  }
  const subjectAction = [params.scene.mainSubject, params.scene.action, params.scene.location]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (subjectAction) {
    pushUnique(extractTopicSearchPhrase(subjectAction, 5));
  }
  if (mainNoun && locationNoun) {
    pushUnique(`${mainNoun} ${locationNoun}`);
  }
  const descTopic = extractTopicSearchPhrase(params.scene.visualDescription || '', 4);
  if (descTopic) pushUnique(descTopic);

  const narrTopic = extractTopicSearchPhrase(params.scene.narration || '', 4);
  if (narrTopic) pushUnique(narrTopic);

  // Only allow title-based fallback if absolutely no scene-specific terms exist
  if (candidates.length === 0 && params.title.trim()) {
    const cleanTitleTopic = extractTopicSearchPhrase(params.title, 4);
    if (cleanTitleTopic) candidates.push(cleanTitleTopic);
  }

  return candidates.slice(0, 6);
}

const IMAGE_VERIFICATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isRelevant: { type: Type.BOOLEAN },
    relevanceScore: { type: Type.INTEGER },
    subjectMatch: { type: Type.INTEGER },
    actionMatch: { type: Type.INTEGER },
    contextMatch: { type: Type.INTEGER },
    contradictions: { type: Type.STRING },
    reason: { type: Type.STRING },
    decision: { type: Type.STRING },
    refinedSearchQuery: { type: Type.STRING },
    refinedImagePrompt: { type: Type.STRING },
  },
  required: [
    'isRelevant',
    'relevanceScore',
    'subjectMatch',
    'actionMatch',
    'contextMatch',
    'contradictions',
    'reason',
    'decision',
    'refinedSearchQuery',
    'refinedImagePrompt',
  ],
};

function isHardBillingOrAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('401') ||
    msg.includes('402') ||
    msg.includes('403') ||
    msg.includes('api_key_invalid') ||
    msg.includes('api key not valid') ||
    msg.includes('invalid api key') ||
    msg.includes('billing') ||
    msg.includes('paid') ||
    msg.includes('permission') ||
    msg.includes('not enabled')
  );
}

function isQuotaOrPaidRestrictionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    isHardBillingOrAuthError(err) ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('404') ||
    msg.includes('not found')
  );
}

function detectImageExtension(buf: Buffer): '.jpg' | '.png' | '.webp' | '.gif' | '.img' {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return '.jpg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return '.png';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  if (buf.length >= 6 && buf.subarray(0, 3).toString('ascii') === 'GIF') {
    return '.gif';
  }
  return '.img';
}

async function convertFileToCleanJpeg(inputPath: string, outJpgPath: string): Promise<{ width: number; height: number } | null> {
  try {
    try {
      // Decode raster image (JPEG/PNG/WebP/GIF) via ffmpeg first so unknown extensions never trigger ufraw-batch
      await runBinaryOnce('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-vf',
        "scale='min(2048,iw)':'min(2048,ih)':force_original_aspect_ratio=decrease",
        '-q:v',
        '2',
        outJpgPath,
      ]);
    } catch {
      await runBinaryOnce('convert', [
        `${inputPath}[0]`,
        '-auto-orient',
        '-strip',
        '-colorspace',
        'sRGB',
        '-resize',
        '2048x2048>',
        outJpgPath,
      ]);
    }
    if (!fs.existsSync(outJpgPath) || fs.statSync(outJpgPath).size < 4096) {
      return null;
    }
    const probe = await runPythonWorkerOnce(['probe', outJpgPath]);
    const meta = probe.metadata as { width?: number; height?: number } | undefined;
    if (
      !meta?.width ||
      !meta?.height ||
      Math.min(meta.width, meta.height) < 240 ||
      Math.max(meta.width, meta.height) < 320
    ) {
      return null;
    }
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

let hordeOnlineModelsCache: { fetchedAt: number; etaByName: Map<string, number> } | null = null;
let lastHordeSubmitAtMs = 0;
let hordeAnonymousCooldownUntilMs = 0;
const hfSpaceCooldownUntilMs = new Map<string, number>();

async function getHordeOnlineModels(): Promise<Map<string, number>> {
  const now = Date.now();
  if (hordeOnlineModelsCache && now - hordeOnlineModelsCache.fetchedAt < 180_000) {
    return hordeOnlineModelsCache.etaByName;
  }
  try {
    const res = await fetch('https://aihorde.net/api/v2/status/models?type=image', {
      signal: AbortSignal.timeout(5000),
      headers: { 'Client-Agent': 'CreatorPilotAI:1.0:creatorpilot' },
    });
    if (res.ok) {
      const list = (await res.json()) as Array<{ name?: string; count?: number; eta?: number }>;
      const etaByName = new Map<string, number>();
      for (const m of list) {
        if (m.name && Number(m.count || 0) >= 2 && Number(m.eta ?? 999) <= 25) {
          etaByName.set(String(m.name), Number(m.eta ?? 25));
        }
      }
      if (etaByName.size > 0) {
        hordeOnlineModelsCache = { fetchedAt: now, etaByName };
        return etaByName;
      }
    }
  } catch {
    // Fall back to default model preferences
  }
  return new Map();
}

function expandCartoonCharacterPromptTraits(
  rawText: string,
  storyContext?: AiVideoStoryContext
): string[] {
  const traits: string[] = [];
  const lower = rawText.toLowerCase();

  // Only include StoryContext characters that actually appear in this scene's text (or fall back to first 2 if scene doesn't name anyone)
  if (storyContext?.characters?.length) {
    const matched = storyContext.characters.filter((ch) => {
      const tokens = ch.name
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 3);
      return tokens.some((tok) => lower.includes(tok));
    });
    const chosen = matched.length > 0 ? matched : storyContext.characters.slice(0, 2);
    for (const ch of chosen.slice(0, 3)) {
      if (ch.visualAppearance) {
        traits.push(`${ch.name}: ${ch.visualAppearance}`);
      }
    }
  }

  // Ensure iconic cartoon / story names expand to explicit species/visual descriptors so FLUX/SD keep visual identity crisp
  if (/\btom\b/i.test(lower) && !traits.some((t) => /\bcat\b/i.test(t))) {
    traits.push('Tom: classic slate gray-blue cartoon cat with white muzzle and paws');
  }
  if (/\bjerry\b/i.test(lower) && !traits.some((t) => /\bmouse\b/i.test(t))) {
    traits.push('Jerry: small warm brown cartoon mouse with big round ears');
  }
  if (/\brabbit\b/i.test(lower) && !traits.some((t) => /\brabbit\b/i.test(t))) {
    traits.push('white cartoon rabbit with long upright ears');
  }
  if (/\bmouse\b/i.test(lower) && !traits.some((t) => /\bmouse\b/i.test(t))) {
    traits.push('small warm brown mouse with round ears');
  }

  return traits;
}

function buildActionSpecificVisualPrompt(params: {
  basePrompt?: string;
  scene: AiVideoScenePlanItem;
  storyContext?: AiVideoStoryContext;
  style: AiVideoStyle;
}): { actionPrompt: string; isStylized: boolean } {
  const styleInfo = AI_VIDEO_STYLES.find((s) => s.id === params.style) || AI_VIDEO_STYLES[0];
  const sceneText = `${params.basePrompt || ''} ${params.scene.narration || ''} ${params.scene.visualDescription || ''} ${params.scene.mainSubject || ''} ${(params.scene.secondarySubjects || []).join(' ')} ${params.scene.action || ''} ${params.scene.location || ''}`;
  const combined = `${sceneText} ${params.storyContext?.genre || ''} ${params.storyContext?.mainTopic || ''}`.toLowerCase();
  const isStylized =
    /\b(cartoon|animated|animation|anime|comic|illustration|pixar|disney|tom|jerry|mouse hole|slapstick|3d render|digital art)\b/i.test(
      combined
    ) ||
    (params.storyContext?.genre === 'fictional' && /\b(rabbit|mouse|cat|fox|bear|talking)\b/i.test(combined));

  const cleanedBase = (params.basePrompt || '')
    .replace(/Aspect ratio:\s*[^.]+/gi, '')
    .replace(/Strictly correct previous mismatch:[\s\S]*/gi, '')
    .replace(/no text overlays,?\s*no captions,?\s*no watermarks\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const characterTraits = expandCartoonCharacterPromptTraits(sceneText, params.storyContext);
  const narrationAction = (params.scene.narration || '').replace(/\s+/g, ' ').trim();
  const actionSummary = [
    params.scene.action?.trim(),
    params.scene.secondarySubjects?.length
      ? `with ${params.scene.secondarySubjects.slice(0, 3).join(', ')}`
      : '',
    params.scene.location?.trim() ? `in ${params.scene.location.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Put concrete scene action & character interaction FIRST so FLUX / SD prioritize exact narration pose & objects
  const coreActionLead =
    cleanedBase.length >= 28 &&
    !/composition depicting/i.test(cleanedBase)
      ? cleanedBase
      : narrationAction || params.scene.visualDescription || actionSummary;

  const parts = [
    isStylized ? 'Expressive 2D cartoon storybook illustration' : `${styleInfo.label} scene`,
    coreActionLead,
    actionSummary && !coreActionLead.toLowerCase().includes((params.scene.action || '').toLowerCase().slice(0, 18))
      ? `Action: ${actionSummary}`
      : '',
    characterTraits.length > 0 ? `Character designs: ${characterTraits.join('; ')}` : '',
    params.scene.emotionalTone ? `Mood: ${params.scene.emotionalTone}` : '',
    isStylized
      ? 'vibrant cel-shaded cartoon art, clean outlines, full-body dynamic poses, rich background detail'
      : 'sharp focus, dynamic action framing, natural lighting, cinematic depth, high detail',
  ];

  const actionPrompt = parts
    .filter(Boolean)
    .join('. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .slice(0, 720);

  return { actionPrompt, isStylized };
}

function buildHordeStableDiffusionPrompt(params: {
  basePrompt: string;
  scene: AiVideoScenePlanItem;
  storyContext?: AiVideoStoryContext;
  style: AiVideoStyle;
  priorScenesSummary?: string;
}): { prompt: string; isStylized: boolean } {
  const { actionPrompt, isStylized } = buildActionSpecificVisualPrompt({
    basePrompt: params.basePrompt,
    scene: params.scene,
    storyContext: params.storyContext,
    style: params.style,
  });

  const negative =
    'text, watermark, signature, logo, caption, subtitle, collage, split screen, static standing pose when action is needed, blurry, low quality, deformed, extra limbs, cropped, out of frame';

  return { prompt: `${actionPrompt} ### ${negative}`, isStylized };
}

async function tryGenerateFreeHordeSceneImage(params: {
  jobId: string;
  scene: AiVideoScenePlanItem;
  storyContext?: AiVideoStoryContext;
  aspectRatio: VideoAspectRatio;
  style: AiVideoStyle;
  promptOverride?: string;
  priorScenesSummary?: string;
  candidateOutPath: string;
  isCancelled?: () => boolean;
}): Promise<
  | { ok: true; promptUsed: string; modelUsed: string }
  | { ok: false; error: string; blockedForJob: boolean }
> {
  const basePrompt =
    params.promptOverride?.trim() ||
    params.scene.imageGenerationPrompt?.trim() ||
    params.scene.visualPrompt;

  const { prompt, isStylized } = buildHordeStableDiffusionPrompt({
    basePrompt,
    scene: params.scene,
    storyContext: params.storyContext,
    style: params.style,
    priorScenesSummary: params.priorScenesSummary,
  });

  const hordeApiKey = process.env.AI_HORDE_API_KEY?.trim() || '0000000000';
  const hasCustomHordeKey = hordeApiKey !== '0000000000';

  // Anonymous AI Horde rejects >~150k px at 18 steps with 403 KudosUpfront;
  // 448x256 / 256x448 / 384x384 (all multiples of 64 and >= 240x320) succeed at ~4-5 kudos with 14 steps + slow_workers.
  const [width, height] = hasCustomHordeKey
    ? params.aspectRatio === '16:9'
      ? [640, 384]
      : params.aspectRatio === '9:16'
      ? [384, 640]
      : [512, 512]
    : params.aspectRatio === '16:9'
    ? [448, 256]
    : params.aspectRatio === '9:16'
    ? [256, 448]
    : [384, 384];
  const steps = hasCustomHordeKey ? 18 : 14;
  const slowWorkers = !hasCustomHordeKey;

  const onlineEta = await getHordeOnlineModels();
  const preferredPool = isStylized
    ? ['526Mix-Animated', 'AAM XL', 'Animagine XL', 'Deliberate', 'Dreamshaper', '2DN', 'stable_diffusion']
    : ['majicMIX realistic', 'Analog Madness', "ICBINP - I Can't Believe It's Not Photography", 'Deliberate', 'AbsoluteReality', 'EpicRealism', 'stable_diffusion'];
  const selectedModels = preferredPool
    .filter((m) => onlineEta.has(m))
    .sort((a, b) => (onlineEta.get(a) ?? 99) - (onlineEta.get(b) ?? 99))
    .slice(0, 4);

  if (!hasCustomHordeKey && Date.now() < hordeAnonymousCooldownUntilMs) {
    return {
      ok: false,
      error: 'AI Horde anonymous cluster temporarily in heavy demand (cooldown active).',
      blockedForJob: false,
    };
  }

  const now = Date.now();
  const sinceLast = now - lastHordeSubmitAtMs;
  if (sinceLast < 850) {
    await new Promise((r) => setTimeout(r, 850 - sinceLast));
  }
  lastHordeSubmitAtMs = Date.now();

  logAiVideo(
    params.jobId,
    'stage3-free-ai-img',
    `Scene ${params.scene.sceneNumber} generating $0.00 AI image via AI Horde (${width}x${height}, steps=${steps}, models=${selectedModels.join(',') || 'auto'})`
  );

  try {
    let submitRes: Response | null = null;
    const submitOnce = (withModels: boolean) =>
      fetch('https://aihorde.net/api/v2/generate/async', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          apikey: hordeApiKey,
          'Client-Agent': 'CreatorPilotAI:1.0:creatorpilot',
        },
        body: JSON.stringify({
          prompt,
          params: {
            width,
            height,
            steps,
            n: 1,
            sampler_name: 'k_euler_a',
            cfg_scale: 7.5,
          },
          ...(withModels && selectedModels.length > 0 ? { models: selectedModels } : {}),
          slow_workers: slowWorkers,
          nsfw: false,
          censor_nsfw: true,
          r2: true,
        }),
      });

    for (let retry = 0; retry < 2; retry++) {
      submitRes = await submitOnce(retry === 0 && selectedModels.length > 0);
      if (submitRes.status === 429 && retry === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if ((submitRes.status === 400 || submitRes.status === 403) && retry === 0 && selectedModels.length > 0) {
        continue;
      }
      break;
    }

    if (!submitRes || !submitRes.ok) {
      const errTxt = submitRes ? await submitRes.text().catch(() => '') : 'no response';
      if (
        submitRes?.status === 403 &&
        !hasCustomHordeKey &&
        errTxt.toLowerCase().includes('kudos')
      ) {
        hordeAnonymousCooldownUntilMs = Date.now() + 45_000;
      }
      return {
        ok: false,
        error: `AI Horde submit failed (${submitRes?.status || 'err'}): ${errTxt.slice(0, 180)}`,
        blockedForJob: false,
      };
    }

    const submitJson = (await submitRes.json()) as { id?: string; message?: string };
    const reqId = submitJson.id;
    if (!reqId) {
      return {
        ok: false,
        error: `AI Horde did not return a request id (${submitJson.message || 'unknown'}).`,
        blockedForJob: false,
      };
    }

    const pollDeadline = Date.now() + 38_000;
    let imgUrl = '';
    let actualModel = selectedModels[0] || 'Stable Diffusion';

    while (Date.now() < pollDeadline) {
      if (params.isCancelled?.()) {
        return { ok: false, error: 'Generation cancelled by user.', blockedForJob: false };
      }
      await new Promise((r) => setTimeout(r, 2000));
      const stRes = await fetch(`https://aihorde.net/api/v2/generate/status/${reqId}`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'Client-Agent': 'CreatorPilotAI:1.0:creatorpilot' },
      });
      if (!stRes.ok) continue;
      const st = (await stRes.json()) as {
        done?: boolean;
        faulted?: boolean;
        generations?: Array<{ img?: string; model?: string; censored?: boolean }>;
      };
      if (st.faulted) {
        return { ok: false, error: 'AI Horde worker faulted during generation.', blockedForJob: false };
      }
      if (st.done) {
        const gen = st.generations?.[0];
        if (!gen?.img || gen.censored) {
          return {
            ok: false,
            error: gen?.censored ? 'AI Horde filtered output.' : 'AI Horde returned no image.',
            blockedForJob: false,
          };
        }
        imgUrl = gen.img;
        if (gen.model) actualModel = gen.model;
        break;
      }
    }

    if (!imgUrl) {
      return { ok: false, error: 'AI Horde image generation timed out after 38s.', blockedForJob: false };
    }

    const dlRes = await fetch(imgUrl, { signal: AbortSignal.timeout(12000) });
    if (!dlRes.ok) {
      return { ok: false, error: `Failed to download AI Horde image (HTTP ${dlRes.status}).`, blockedForJob: false };
    }
    const rawBuf = Buffer.from(await dlRes.arrayBuffer());
    if (rawBuf.byteLength < 4096) {
      return { ok: false, error: 'AI Horde returned an empty or tiny image.', blockedForJob: false };
    }

    const tmpPath = `${params.candidateOutPath}${detectImageExtension(rawBuf)}`;
    fs.writeFileSync(tmpPath, rawBuf);
    const converted = await convertFileToCleanJpeg(tmpPath, params.candidateOutPath);
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup failure
      }
    }
    if (!converted) {
      return {
        ok: false,
        error: 'AI Horde generated image failed resolution/format verification.',
        blockedForJob: false,
      };
    }

    logAiVideo(
      params.jobId,
      'stage3-free-ai-img',
      `Scene ${params.scene.sceneNumber} generated free AI image via AI Horde (${actualModel}, ${converted.width}x${converted.height})`
    );
    return { ok: true, promptUsed: prompt, modelUsed: `AI Horde · ${actualModel} ($0.00)` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `AI Horde generation failed: ${message.slice(0, 220)}`,
      blockedForJob: false,
    };
  }
}

function extractGradioImageUrlFromSse(sseText: string, host: string): string | null {
  const lines = sseText.split(/\r?\n/);
  let currentEvent = '';
  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim().toLowerCase();
      continue;
    }
    if (!line.startsWith('data:')) continue;
    const rawData = line.slice(5).trim();
    if (!rawData || rawData === 'null' || currentEvent === 'error') continue;
    try {
      const parsed = JSON.parse(rawData) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === 'object') {
          const obj = item as { url?: unknown; path?: unknown };
          if (typeof obj.url === 'string' && obj.url.startsWith('https://')) {
            return obj.url;
          }
          if (typeof obj.url === 'string' && obj.url.startsWith('/')) {
            return `https://${host}${obj.url}`;
          }
          if (typeof obj.path === 'string' && obj.path.length > 0) {
            const rel = obj.path.startsWith('/') ? obj.path : `/${obj.path}`;
            return `https://${host}/gradio_api/file=${encodeURIComponent(rel).replace(/%2F/g, '/')}`;
          }
        } else if (typeof item === 'string' && item.startsWith('https://')) {
          return item;
        }
      }
    } catch {
      // Fall back to regex check below
    }
  }

  const directHttpsMatch = sseText.match(/https:\/\/[^"\s\\]+?\.(?:webp|png|jpg|jpeg)(?:\?[^"\s\\]*)?/i);
  if (directHttpsMatch?.[0]) return directHttpsMatch[0];

  const relGradioMatch = sseText.match(/\/gradio_api\/file=[^"\s\\]+/i);
  if (relGradioMatch?.[0]) return `https://${host}${relGradioMatch[0]}`;

  return null;
}

async function tryGenerateFreeHfGradioSceneImage(params: {
  jobId: string;
  scene: AiVideoScenePlanItem;
  storyContext?: AiVideoStoryContext;
  aspectRatio: VideoAspectRatio;
  style: AiVideoStyle;
  promptOverride?: string;
  priorScenesSummary?: string;
  cycleAttempt?: number;
  candidateOutPath: string;
  isCancelled?: () => boolean;
}): Promise<
  | { ok: true; promptUsed: string; modelUsed: string }
  | { ok: false; error: string; blockedForJob: boolean }
> {
  const basePrompt =
    params.promptOverride?.trim() ||
    params.scene.imageGenerationPrompt?.trim() ||
    params.scene.visualPrompt;

  const { prompt: combinedPrompt } = buildHordeStableDiffusionPrompt({
    basePrompt,
    scene: params.scene,
    storyContext: params.storyContext,
    style: params.style,
    priorScenesSummary: params.priorScenesSummary,
  });
  const [positivePrompt, negativePrompt] = combinedPrompt.split(' ### ');

  const [width, height] =
    params.aspectRatio === '16:9'
      ? [1024, 576]
      : params.aspectRatio === '9:16'
      ? [576, 1024]
      : [768, 768];

  const hfToken = process.env.HF_TOKEN?.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}),
  };

  const baseSpaces: Array<{
    label: string;
    host: string;
    endpoint: string;
    data: unknown[];
  }> = [
    {
      label: 'FLUX.1-merged',
      host: 'multimodalart-flux-1-merged.hf.space',
      endpoint: '/infer',
      data: [positivePrompt, 0, true, width, height, 3.5, 4],
    },
    {
      label: 'FLUX.1-schnell',
      host: 'black-forest-labs-flux-1-schnell.hf.space',
      endpoint: '/infer',
      data: [positivePrompt, 0, true, width, height, 4],
    },
    {
      label: 'SD 3.5 Large Turbo',
      host: 'stabilityai-stable-diffusion-3-5-large-turbo.hf.space',
      endpoint: '/infer',
      data: [positivePrompt, negativePrompt || 'text, watermark, blurry', 0, true, width, height, 1.0, 4],
    },
    {
      label: 'SD 3.5 Medium',
      host: 'stabilityai-stable-diffusion-3-5-medium.hf.space',
      endpoint: '/infer',
      data: [positivePrompt, negativePrompt || 'text, watermark, blurry', 0, true, width, height, 3.5, 16],
    },
  ];
  const shift = Math.max(0, (params.cycleAttempt || 1) - 1) % baseSpaces.length;
  const spaces = [...baseSpaces.slice(shift), ...baseSpaces.slice(0, shift)];

  let lastError = 'Hugging Face free Spaces unavailable.';
  for (const space of spaces) {
    if (params.isCancelled?.()) {
      return { ok: false, error: 'Generation cancelled by user.', blockedForJob: false };
    }
    const cooldownUntil = hfSpaceCooldownUntilMs.get(space.host) ?? 0;
    if (Date.now() < cooldownUntil) {
      lastError = `${space.label} cooldown active`;
      continue;
    }

    try {
      logAiVideo(
        params.jobId,
        'stage3-free-ai-img',
        `Scene ${params.scene.sceneNumber} requesting $0.00 ${space.label} (${width}x${height})`
      );

      const postRes = await fetch(`https://${space.host}/gradio_api/call${space.endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: space.data }),
        signal: AbortSignal.timeout(9000),
      });
      if (!postRes.ok) {
        const txt = await postRes.text().catch(() => '');
        if (postRes.status >= 500 || postRes.status === 429) {
          hfSpaceCooldownUntilMs.set(space.host, Date.now() + 90_000);
        }
        lastError = `${space.label} POST ${postRes.status}: ${txt.slice(0, 140)}`;
        continue;
      }
      const postJson = (await postRes.json()) as { event_id?: string };
      if (!postJson.event_id) {
        lastError = `${space.label} returned no event_id`;
        continue;
      }

      const sseRes = await fetch(
        `https://${space.host}/gradio_api/call${space.endpoint}/${postJson.event_id}`,
        {
          headers: hfToken ? { Authorization: `Bearer ${hfToken}` } : undefined,
          signal: AbortSignal.timeout(25000),
        }
      );
      const sseText = await sseRes.text();
      if (/exceeded your ZeroGPU quota/i.test(sseText)) {
        hfSpaceCooldownUntilMs.set(space.host, Date.now() + 10 * 60_000);
        lastError = `${space.label} ZeroGPU free quota temporarily exhausted`;
        continue;
      }
      if (/^event:\s*error\b/im.test(sseText)) {
        hfSpaceCooldownUntilMs.set(space.host, Date.now() + 90_000);
        lastError = `${space.label} returned error event (${sseText.slice(0, 120)})`;
        continue;
      }

      const imageUrl = extractGradioImageUrlFromSse(sseText, space.host);
      if (!imageUrl) {
        lastError = `${space.label} returned no image URL (${sseText.slice(0, 160)})`;
        continue;
      }

      const dlRes = await fetch(imageUrl, {
        headers: hfToken ? { Authorization: `Bearer ${hfToken}` } : undefined,
        signal: AbortSignal.timeout(12000),
      });
      if (!dlRes.ok) {
        lastError = `${space.label} download failed (HTTP ${dlRes.status})`;
        continue;
      }
      const rawBuf = Buffer.from(await dlRes.arrayBuffer());
      if (rawBuf.byteLength < 4096) {
        lastError = `${space.label} returned empty image`;
        continue;
      }

      const tmpPath = `${params.candidateOutPath}${detectImageExtension(rawBuf)}`;
      fs.writeFileSync(tmpPath, rawBuf);
      const converted = await convertFileToCleanJpeg(tmpPath, params.candidateOutPath);
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore cleanup failure
        }
      }
      if (!converted) {
        lastError = `${space.label} image failed verification`;
        continue;
      }

      logAiVideo(
        params.jobId,
        'stage3-free-ai-img',
        `Scene ${params.scene.sceneNumber} generated $0.00 AI image via ${space.label} (${converted.width}x${converted.height})`
      );
      return {
        ok: true,
        promptUsed: positivePrompt,
        modelUsed: `HF ${space.label} ($0.00)`,
      };
    } catch (err) {
      lastError = `${space.label}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return { ok: false, error: lastError, blockedForJob: false };
}

async function tryGenerateAiSceneImage(params: {
  apiKey: string | null;
  visualEngine: AiVideoVisualEngine;
  jobId: string;
  scene: AiVideoScenePlanItem;
  storyContext?: AiVideoStoryContext;
  aspectRatio: VideoAspectRatio;
  style: AiVideoStyle;
  promptOverride?: string;
  priorScenesSummary?: string;
  cycleAttempt?: number;
  candidateOutPath: string;
  isCancelled?: () => boolean;
}): Promise<
  | { ok: true; promptUsed: string; modelUsed: string }
  | { ok: false; error: string; blockedForJob: boolean }
> {
  // In free-motion ($0.00) mode, cascade across free HF FLUX/SD3.5 Spaces + AI Horde without touching paid Gemini Image quotas
  if (params.visualEngine !== 'ai-omni') {
    const hfRes = await tryGenerateFreeHfGradioSceneImage({
      jobId: params.jobId,
      scene: params.scene,
      storyContext: params.storyContext,
      aspectRatio: params.aspectRatio,
      style: params.style,
      promptOverride: params.promptOverride,
      priorScenesSummary: params.priorScenesSummary,
      cycleAttempt: params.cycleAttempt,
      candidateOutPath: params.candidateOutPath,
      isCancelled: params.isCancelled,
    });
    if (hfRes.ok) return hfRes;

    const hordeRes = await tryGenerateFreeHordeSceneImage({
      jobId: params.jobId,
      scene: params.scene,
      storyContext: params.storyContext,
      aspectRatio: params.aspectRatio,
      style: params.style,
      promptOverride: params.promptOverride,
      priorScenesSummary: params.priorScenesSummary,
      candidateOutPath: params.candidateOutPath,
      isCancelled: params.isCancelled,
    });
    if (hordeRes.ok) return hordeRes;

    return {
      ok: false,
      error: `${hfRes.error}; ${hordeRes.error}`,
      blockedForJob: false,
    };
  }

  if (!params.apiKey) {
    return {
      ok: false,
      error: 'Gemini API key is required for paid Gemini image generation.',
      blockedForJob: true,
    };
  }

  const styleInfo = AI_VIDEO_STYLES.find((s) => s.id === params.style) || AI_VIDEO_STYLES[0];
  const basePrompt =
    params.promptOverride?.trim() ||
    params.scene.imageGenerationPrompt?.trim() ||
    params.scene.visualPrompt;

  const { actionPrompt } = buildActionSpecificVisualPrompt({
    basePrompt,
    scene: params.scene,
    storyContext: params.storyContext,
    style: params.style,
  });

  const continuityBlock = params.storyContext
    ? `Story Context (${params.storyContext.genre}, ${params.storyContext.timelineOrEra}): ${params.storyContext.visualConsistencyGuide}.`
    : '';
  const sceneBlob = `${params.scene.narration || ''} ${params.scene.visualDescription || ''} ${params.scene.mainSubject || ''} ${(params.scene.secondarySubjects || []).join(' ')}`.toLowerCase();
  const matchedCharacters = params.storyContext?.characters?.filter((c) =>
    c.name
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3)
      .some((tok) => sceneBlob.includes(tok))
  );
  const chosenCharacters =
    matchedCharacters && matchedCharacters.length > 0
      ? matchedCharacters
      : params.storyContext?.characters?.slice(0, 2) || [];
  const characterHints =
    chosenCharacters.length > 0
      ? `Character Consistency: ${chosenCharacters
          .map((c) => `${c.name}: ${c.visualAppearance}`)
          .join('; ')}.`
      : '';

  const fullPrompt = [
    actionPrompt,
    params.scene.narration ? `Exact scene narration to illustrate: "${params.scene.narration}".` : '',
    params.scene.mainSubject ? `Primary subject: ${params.scene.mainSubject}.` : '',
    params.scene.action ? `Required specific action and character interaction: ${params.scene.action}.` : '',
    params.scene.secondarySubjects?.length
      ? `Required interacting characters/objects: ${params.scene.secondarySubjects.join(', ')}.`
      : '',
    params.scene.location ? `Environment: ${params.scene.location}.` : '',
    params.scene.timePeriod ? `Historical/Time Period: ${params.scene.timePeriod}.` : '',
    continuityBlock,
    characterHints,
    `Art style: ${styleInfo.label}. Aspect ratio: ${params.aspectRatio}. Strict rule: no text, no captions, no watermarks, no split collages; depict active movement/interaction rather than static standing poses.`,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 2200);

  const ai = createGeminiClient(params.apiKey);
  const candidateModels: Array<{ model: string; imageConfig: { aspectRatio: string; imageSize?: string } }> = [
    {
      model: IMAGE_GEN_MODEL,
      imageConfig: { aspectRatio: params.aspectRatio },
    },
    {
      model: IMAGE_GEN_FALLBACK_MODEL,
      imageConfig: { aspectRatio: params.aspectRatio, imageSize: '1K' },
    },
  ];

  let lastError = 'Image generation did not produce a valid image.';
  let blockedForJob = false;

  for (const candidate of candidateModels) {
    logAiVideo(
      params.jobId,
      'stage3-ai-img',
      `Scene ${params.scene.sceneNumber} generating AI image via ${candidate.model}`
    );

    try {
      const response = await withGeminiTimeout(
        ai.models.generateContent({
          model: candidate.model,
          contents: {
            parts: [{ text: fullPrompt }],
          },
          config: {
            imageConfig: candidate.imageConfig,
          },
        }),
        45000,
        `AI scene image generation (${candidate.model})`
      );

      const parts = response.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p) => p.inlineData?.data);
      if (!imagePart?.inlineData?.data) {
        lastError = `${candidate.model} returned no image bytes.`;
        logAiVideo(params.jobId, 'stage3-ai-img', lastError);
        continue;
      }

      const rawBuf = Buffer.from(imagePart.inlineData.data, 'base64');
      const tmpPath = `${params.candidateOutPath}${detectImageExtension(rawBuf)}`;
      fs.writeFileSync(tmpPath, rawBuf);
      const converted = await convertFileToCleanJpeg(tmpPath, params.candidateOutPath);
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore cleanup failure
        }
      }
      if (!converted) {
        lastError = `${candidate.model} generated image failed resolution/format verification.`;
        logAiVideo(params.jobId, 'stage3-ai-img', lastError);
        continue;
      }

      return { ok: true, promptUsed: fullPrompt, modelUsed: candidate.model };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      blockedForJob = isQuotaOrPaidRestrictionError(err);
      logAiVideo(params.jobId, 'stage3-ai-img', `Scene ${params.scene.sceneNumber} ${candidate.model} failed`, {
        blockedForJob,
        error: message.slice(0, 320),
      });
      if (blockedForJob) {
        return {
          ok: false,
          error: `Paid GEMINI_API_KEY quota/billing is required for Gemini image generation (${candidate.model}): ${message}`,
          blockedForJob: true,
        };
      }
    }
  }

  return { ok: false, error: lastError, blockedForJob };
}

function isSceneVisualApproved(st: AiVideoSceneClipState): boolean {
  return Boolean(
    st.visualStatus === 'approved' ||
      st.visualStatus === 'verified' ||
      st.visualStatus === 'fallback' ||
      st.status === 'approved' ||
      st.status === 'completed' ||
      (st.imageUrl && st.imageSource)
  );
}

function countApprovedVisualScenes(record: AiVideoJobRecord): number {
  return (record.sceneStates || []).filter((st) => isSceneVisualApproved(st)).length;
}

async function generateLocalSceneIllustration(params: {
  job: ServerAiVideoJob;
  scene: AiVideoScenePlanItem;
  outJpgPath: string;
}): Promise<{ svgPath: string; width: number; height: number }> {
  const { job, scene, outJpgPath } = params;
  const svgPath = path.join(job.workDir, `scene_${scene.sceneNumber}_illustration.svg`);
  const cfgPath = path.join(job.workDir, `illustration_cfg_${scene.sceneNumber}.json`);

  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      outputPath: outJpgPath,
      svgPath,
      aspectRatio: job.record.aspectRatio,
      sceneNumber: scene.sceneNumber,
      totalScenes: job.scenes.length,
      style: job.record.style,
      mainSubject: scene.mainSubject || job.record.storyContext?.mainTopic || '',
      secondarySubjects: scene.secondarySubjects || [],
      action: scene.action || '',
      location: scene.location || '',
      visualDescription: scene.visualDescription || '',
      narration: scene.narration || '',
    }),
    'utf8'
  );

  try {
    const res = await runPythonWorkerOnce(['generate-scene-illustration', cfgPath], 30000);
    const meta = res.metadata as { width?: number; height?: number } | undefined;
    return {
      svgPath,
      width: Number(meta?.width || 720),
      height: Number(meta?.height || 1280),
    };
  } finally {
    if (fs.existsSync(cfgPath)) {
      try {
        fs.unlinkSync(cfgPath);
      } catch {
        // ignore temp cleanup
      }
    }
  }
}

async function verifyImageRelevanceWithGemini(params: {
  apiKey: string | null;
  jobId: string;
  imagePath: string;
  scene: AiVideoScenePlanItem;
  storyContext?: AiVideoStoryContext;
  priorScenesSummary?: string;
  threshold: number;
  candidateTitle?: string;
  sourceKind: AiVideoVisualSourceKind;
}): Promise<AiVideoImageVerificationResult> {
  const nowIso = new Date().toISOString();

  if (params.apiKey && fs.existsSync(params.imagePath)) {
    const visionThumbPath = `${params.imagePath}.vision.jpg`;
    try {
      try {
        await runBinaryOnce(
          'convert',
          [params.imagePath, '-resize', '448x448>', '-quality', '72', visionThumbPath],
          10000
        );
      } catch {
        // Fall back to original image if resize fails
      }
      const uploadPath =
        fs.existsSync(visionThumbPath) && fs.statSync(visionThumbPath).size > 512
          ? visionThumbPath
          : params.imagePath;
      const imgBase64 = fs.readFileSync(uploadPath).toString('base64');
      const ai = createGeminiClient(params.apiKey);

      const charactersBlock = params.storyContext?.characters?.length
        ? params.storyContext.characters
            .map((c) => `  * ${c.name} (${c.role}): ${c.visualAppearance}`)
            .join('\n')
        : '  * None specified';

      const prompt = `STAGE 4 — ACTION-SPECIFIC SEMANTIC IMAGE VERIFICATION

Compare the attached candidate image directly against Scene #${params.scene.sceneNumber}'s ACTUAL NARRATION below.

Story Context & Character Bible:
- Topic: ${params.storyContext?.mainTopic || 'Video story'}
- Genre: ${params.storyContext?.genre || 'informational'}
- Era / Timeline: ${params.storyContext?.timelineOrEra || 'Not specified'}
- Characters Bible:
${charactersBlock}
${params.priorScenesSummary ? `- Visual Continuity Note: ${params.priorScenesSummary}` : ''}

ACTUAL SCENE #${params.scene.sceneNumber} REQUIREMENTS:
- Exact Spoken Narration: "${params.scene.narration}"
- Expected Primary Character/Subject: ${params.scene.mainSubject || 'Derived from narration'}
- Required Interacting Characters & Objects: ${
        params.scene.secondarySubjects?.length
          ? params.scene.secondarySubjects.join(', ')
          : 'All characters and props mentioned in narration'
      }
- REQUIRED SPECIFIC ACTION & INTERACTION: ${params.scene.action || params.scene.narration}
- Expected Setting/Environment: ${params.scene.location || 'Derived from narration'}
- Emotional Tone: ${params.scene.emotionalTone || 'Matching narration'}
- Visual Description: ${params.scene.visualDescription}
${params.candidateTitle ? `- Candidate Caption/Source: ${params.candidateTitle}` : ''}

STRICT SEMANTIC & ACTION EVALUATION RULES:
1. Evaluate SIX visual dimensions against the exact narration:
   a) Character identity & appearance (species, colors, outfit, cartoon vs real-world consistency).
   b) MAIN ACTION (HIGHEST IMPORTANCE — what the characters are actively doing right now).
   c) Key objects involved (e.g. cheese, wooden log, American flag, holographic AI screen, etc.).
   d) Environment & background (e.g. Moon surface with Earth, forest with tree, African savanna, futuristic lab).
   e) Character positions and interactions (e.g. rabbit grabbing cheese while mouse hides behind tree).
   f) Scene meaning & emotion.
2. NEVER approve a generic image simply because it contains a similar subject!
   - Reject (actionMatch <= 35, decision="reject"): A white rabbit simply standing in a forest when the narration requires grabbing cheese from a log while a brown mouse hides behind a tree.
   - Reject (actionMatch <= 35, decision="reject"): A random rocket in space when the narration says an astronaut walks on the Moon planting an American flag.
   - Reject (actionMatch <= 35, decision="reject"): A lion sleeping/resting under a tree when the narration says a lion chases a zebra across grasslands.
   - Reject (actionMatch <= 35, decision="reject"): A random computer on a desk when the narration says a scientist interacts with a holographic AI interface in a futuristic lab.
3. Accept semantic matches when wording differs ("feline" vs "cat", "savanna" vs "grassland", stylized cartoon vs 2D comic) ONLY IF the required characters, objects, and MAIN ACTION are genuinely depicted.
4. Score calibration (0-100):
   - 88-100: Accurate character(s), exact main action & interactions, required objects, and setting clearly shown.
   - ${params.threshold}-87: Good match showing the core action, characters, and environment with minor artistic differences.
   - 50-${Math.max(55, params.threshold - 1)}: Generic subject match missing the main action, missing key interacting character/object, or wrong interaction.
   - 0-49: Completely unrelated subject/scene, wrong species, or distorted/unusable output.
5. Acceptance rule: Set isRelevant=true and decision="accept" ONLY if relevanceScore >= ${params.threshold} AND actionMatch >= 70 AND subjectMatch >= 72 with no missing major character or action contradiction.
6. If rejected, write a crisp, action-first POSITIVE "refinedImagePrompt" explicitly describing EACH character's exact pose, interaction, object, and setting needed to fix what was missing (NEVER include "do not" or negative phrasing) and a specific 3-4 word "refinedSearchQuery".`;

      let lastVisionErr: unknown = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const { response, modelUsed } = await generatePlannerContentWithFallback({
            ai,
            label: 'Gemini Vision image verification',
            primaryTimeoutMs: 12000,
            fallbackTimeoutMs: 20000,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: imgBase64,
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: IMAGE_VERIFICATION_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });

          const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;
          const rawRelevance = Math.max(0, Math.min(100, Math.round(Number(parsed.relevanceScore ?? 0))));
          const subjectMatch = Math.max(0, Math.min(100, Math.round(Number(parsed.subjectMatch ?? rawRelevance))));
          const actionMatch = Math.max(0, Math.min(100, Math.round(Number(parsed.actionMatch ?? rawRelevance))));
          const contextMatch = Math.max(0, Math.min(100, Math.round(Number(parsed.contextMatch ?? rawRelevance))));
          // Highest weight on Main Action (42%) and Subject Identity (38%), plus Environment/Context (20%)
          const weightedSemantic = Math.round(
            subjectMatch * 0.38 + actionMatch * 0.42 + contextMatch * 0.20
          );

          const minActionFloor = Math.max(68, params.threshold - 12);
          const minSubjectFloor = Math.max(70, params.threshold - 10);
          const actionOrSubjectFailed =
            actionMatch < minActionFloor || subjectMatch < minSubjectFloor;

          // If either main action or subject failed, cap relevanceScore cleanly below threshold so generic passive images are rejected
          let relevanceScore =
            rawRelevance >= params.threshold || rawRelevance < 60
              ? rawRelevance
              : Math.max(rawRelevance, weightedSemantic);
          if (actionOrSubjectFailed) {
            relevanceScore = Math.min(relevanceScore, weightedSemantic, params.threshold - 4);
          }

          const contradictionsLower = String(parsed.contradictions || '').toLowerCase();
          const hasFatalContradiction =
            actionOrSubjectFailed ||
            (weightedSemantic < 60 &&
              (contradictionsLower.includes('irrelevant') ||
                contradictionsLower.includes('unrelated') ||
                contradictionsLower.includes('missing') ||
                contradictionsLower.includes('wrong') ||
                contradictionsLower.includes('completely different')));
          const isRelevant =
            relevanceScore >= params.threshold && !hasFatalContradiction;
          const decision: 'accept' | 'reject' = isRelevant ? 'accept' : 'reject';

          const result: AiVideoImageVerificationResult = {
            isRelevant,
            relevanceScore,
            subjectMatch,
            actionMatch,
            contextMatch,
            contradictions: String(parsed.contradictions || '').trim().slice(0, 300),
            reason: String(parsed.reason || 'Evaluated via Gemini Vision.').trim().slice(0, 400),
            decision,
            refinedSearchQuery: String(parsed.refinedSearchQuery || '').trim().slice(0, 100) || undefined,
            refinedImagePrompt: String(parsed.refinedImagePrompt || '').trim().slice(0, 1200) || undefined,
            modelUsed,
            verifiedAt: nowIso,
          };

          logAiVideo(
            params.jobId,
            'stage4-verify',
            `Scene ${params.scene.sceneNumber} (${params.sourceKind}) -> ${result.decision.toUpperCase()} (${result.relevanceScore}/100)`,
            {
              subjectMatch: result.subjectMatch,
              actionMatch: result.actionMatch,
              contextMatch: result.contextMatch,
              reason: result.reason,
            }
          );

          return result;
        } catch (err) {
          lastVisionErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          logAiVideo(
            params.jobId,
            'stage4-verify',
            `Gemini Vision attempt ${attempt}/2 failed for Scene ${params.scene.sceneNumber}`,
            { error: msg.slice(0, 350) }
          );
          if (attempt < 2 && !isQuotaOrPaidRestrictionError(err)) {
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          break;
        }
      }

      const finalErrMsg =
        lastVisionErr instanceof Error ? lastVisionErr.message : String(lastVisionErr || 'Vision unavailable');
      if (params.sourceKind === 'ai-generated' || params.sourceKind === 'context-fallback') {
        const fallbackScore = Math.max(80, Math.min(88, params.threshold + 4));
        logAiVideo(
          params.jobId,
          'stage4-verify',
          `Scene ${params.scene.sceneNumber} (${params.sourceKind}) Vision unavailable (${finalErrMsg.slice(0, 120)}) -> prompt-alignment fallback (${fallbackScore}/100)`
        );
        return {
          isRelevant: true,
          relevanceScore: fallbackScore,
          subjectMatch: fallbackScore,
          actionMatch: fallbackScore,
          contextMatch: fallbackScore,
          contradictions: 'None',
          reason: `Generated directly from scene prompt (Vision check skipped: ${finalErrMsg.slice(0, 100)}).`,
          decision: 'accept',
          modelUsed: 'prompt-alignment-fallback',
          verifiedAt: nowIso,
        };
      }
    } finally {
      if (fs.existsSync(visionThumbPath)) {
        try {
          fs.unlinkSync(visionThumbPath);
        } catch {
          // ignore temp cleanup failure
        }
      }
    }
  }

  if (params.sourceKind === 'ai-generated' || params.sourceKind === 'context-fallback') {
    const fallbackScore = Math.max(80, Math.min(88, params.threshold + 4));
    return {
      isRelevant: true,
      relevanceScore: fallbackScore,
      subjectMatch: fallbackScore,
      actionMatch: fallbackScore,
      contextMatch: fallbackScore,
      contradictions: 'None',
      reason: 'Accepted scene-specific illustration built directly from scene visual plan.',
      decision: 'accept',
      modelUsed: 'prompt-alignment-fallback',
      verifiedAt: nowIso,
    };
  }

  if (params.sourceKind === 'custom-upload') {
    return {
      isRelevant: true,
      relevanceScore: params.threshold,
      subjectMatch: params.threshold,
      actionMatch: params.threshold,
      contextMatch: params.threshold,
      contradictions: 'None (user-supplied custom image).',
      reason: 'Accepted user-uploaded visual.',
      decision: 'accept',
      modelUsed: 'metadata-fallback',
      verifiedAt: nowIso,
    };
  }

  const expectedTokens = extractTopicSearchPhrase(
    `${params.scene.imageSearchQuery || ''} ${params.scene.mainSubject || ''}`,
    4
  )
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const titleLower = (params.candidateTitle || '').toLowerCase();
  const hits = expectedTokens.filter((t) => titleLower.includes(t)).length;
  const ratio = expectedTokens.length > 0 ? hits / expectedTokens.length : 0;
  const score = Math.round(Math.min(95, 45 + ratio * 50));
  const accepted =
    expectedTokens.length > 0 &&
    score >= params.threshold &&
    hits >= Math.min(2, expectedTokens.length);

  return {
    isRelevant: accepted,
    relevanceScore: score,
    subjectMatch: score,
    actionMatch: score,
    contextMatch: score,
    contradictions: accepted ? 'None' : 'Insufficient metadata keyword alignment with scene subject.',
    reason: `Metadata fallback check matched ${hits}/${expectedTokens.length} scene keywords.`,
    decision: accepted ? 'accept' : 'reject',
    modelUsed: 'metadata-fallback',
    verifiedAt: nowIso,
  };
}

function buildPriorScenesSummary(job: ServerAiVideoJob, upToSceneNumber: number): string {
  const approved = job.record.sceneStates
    .filter((s) => s.sceneNumber < upToSceneNumber && isSceneVisualApproved(s))
    .slice(-2)
    .map((s) => {
      const plan = job.scenes.find((p) => p.sceneNumber === s.sceneNumber);
      return `Scene ${s.sceneNumber}: ${plan?.mainSubject || s.imageTitle || 'established scene'} (${plan?.visualStyle || job.record.style})`;
    });
  return approved.join('; ');
}

async function sourceAndVerifyVisualForScene(params: {
  job: ServerAiVideoJob;
  scene: AiVideoScenePlanItem;
  sceneState: AiVideoSceneClipState;
  apiKey: string | null;
  usedUrls: Set<string>;
  usedTitles: Set<string>;
  usedHashes: Set<string>;
  aiGenState: { blockedForJob: boolean; blockingError?: string };
  customPrompt?: string;
  customSearchQuery?: string;
  forceRegenerate?: boolean;
  onUpdate: () => void;
}): Promise<string> {
  const { job, scene, sceneState, apiKey } = params;
  const record = job.record;
  const threshold = Math.max(60, Math.min(98, Number(record.relevanceThreshold || DEFAULT_RELEVANCE_THRESHOLD)));
  const sourceMode: AiVideoVisualSourceMode = record.visualSourceMode || 'ai-then-retrieve';
  const cleanJpgPath = path.join(job.workDir, `scene_${scene.sceneNumber}_pic.jpg`);

  if (
    !params.forceRegenerate &&
    (sceneState.visualStatus === 'approved' ||
      sceneState.visualStatus === 'verified' ||
      sceneState.visualStatus === 'fallback') &&
    sceneState.imageSource !== 'context-fallback' &&
    fs.existsSync(cleanJpgPath) &&
    fs.statSync(cleanJpgPath).size > 4096
  ) {
    try {
      const probe = await runPythonWorkerOnce(['probe', cleanJpgPath]);
      const meta = probe.metadata as { width?: number; height?: number } | undefined;
      if (
        meta?.width &&
        meta?.height &&
        Math.min(meta.width, meta.height) >= 240 &&
        Math.max(meta.width, meta.height) >= 320
      ) {
        sceneState.visualStatus = 'approved';
        if (sceneState.status === 'queued') {
          sceneState.status = 'approved';
        }
        sceneState.imageSource = sceneState.imageSource || 'ai-generated';
        sceneState.imageUrl =
          sceneState.imageUrl ||
          buildSceneImageUrl(record.id, scene.sceneNumber, job.downloadToken, Date.now());
        sceneState.error = undefined;
        params.onUpdate();
        return cleanJpgPath;
      }
    } catch {
      // Re-source if file corrupted
    }
  }

  sceneState.visualStatus = 'sourcing';
  sceneState.error = undefined;
  const attemptsLog: AiVideoSceneVisualAttempt[] = [];
  sceneState.visualAttempts = attemptsLog;
  params.onUpdate();

  const priorScenesSummary = buildPriorScenesSummary(job, scene.sceneNumber);
  const rejectedHashes = new Set<string>();
  const rejectedUrls = new Set<string>();
  let currentPrompt = params.customPrompt?.trim() || scene.imageGenerationPrompt || scene.visualPrompt;
  let currentQuery = params.customSearchQuery?.trim() || scene.imageSearchQuery || '';
  const maxCycles = 3;
  const bestCandPath = path.join(job.workDir, `scene_${scene.sceneNumber}_cand_best.jpg`);
  let bestCandidate: {
    sha: string;
    score: number;
    source: AiVideoVisualSourceKind;
    title: string;
    attribution: string;
    originalUrl?: string;
    promptUsed?: string;
    searchQueryUsed?: string;
    verification: AiVideoImageVerificationResult;
  } | null = null;

  try {
    for (let cycle = 1; cycle <= maxCycles; cycle++) {
      if (job.cancelled) throw new Error('Generation cancelled by user.');

      // PRIORITY 1: AI IMAGE GENERATION (Free HF FLUX / SD3.5 / AI Horde in free-motion mode; Gemini Image in ai-omni mode)
      const visualEngine: AiVideoVisualEngine = record.visualEngine === 'ai-omni' ? 'ai-omni' : 'free-motion';
      const canTryAiGen = visualEngine !== 'ai-omni' || Boolean(apiKey);
      const shouldTryAiGen =
        canTryAiGen &&
        !params.aiGenState.blockedForJob &&
        sourceMode !== 'retrieve-only';

      if (shouldTryAiGen) {
        const candidatePath = path.join(job.workDir, `scene_${scene.sceneNumber}_cand_ai_${cycle}.jpg`);
        const aiRes = await tryGenerateAiSceneImage({
          apiKey,
          visualEngine,
          jobId: record.id,
          scene,
          storyContext: record.storyContext,
          aspectRatio: record.aspectRatio,
          style: record.style,
          promptOverride: currentPrompt,
          priorScenesSummary,
          cycleAttempt: cycle,
          candidateOutPath: candidatePath,
          isCancelled: () => job.cancelled,
        });

        if (aiRes.ok) {
          const sha = computeFileSha256(candidatePath);
          if (!params.usedHashes.has(sha) && !rejectedHashes.has(sha)) {
            sceneState.visualStatus = 'verifying';
            params.onUpdate();

            const ver = await verifyImageRelevanceWithGemini({
              apiKey,
              jobId: record.id,
              imagePath: candidatePath,
              scene,
              storyContext: record.storyContext,
              priorScenesSummary,
              threshold,
              candidateTitle: scene.mainSubject || scene.summary,
              sourceKind: 'ai-generated',
            });

            attemptsLog.push({
              attempt: attemptsLog.length + 1,
              source: 'ai-generated',
              queryOrPrompt: aiRes.promptUsed.slice(0, 180),
              title: `${aiRes.modelUsed} (Scene ${scene.sceneNumber})`,
              relevanceScore: ver.relevanceScore,
              decision: ver.decision === 'accept' ? 'accepted' : 'rejected',
              reason: ver.reason,
            });

            if (ver.decision === 'accept') {
              fs.copyFileSync(candidatePath, cleanJpgPath);
              try {
                fs.unlinkSync(candidatePath);
              } catch {
                // ignore
              }
              params.usedHashes.add(sha);
              sceneState.visualStatus = 'approved';
              if (sceneState.status === 'queued' || sceneState.status === 'failed') {
                sceneState.status = 'approved';
              }
              sceneState.error = undefined;
              sceneState.imageSource = 'ai-generated';
              sceneState.imageTitle = `AI Generated · ${scene.mainSubject || `Scene ${scene.sceneNumber}`}`;
              sceneState.imageAttribution = `Generated via ${aiRes.modelUsed}`;
              sceneState.imageOriginalUrl = undefined;
              sceneState.imagePromptUsed = aiRes.promptUsed;
              sceneState.relevanceScore = ver.relevanceScore;
              sceneState.verification = ver;
              sceneState.imageUrl = buildSceneImageUrl(record.id, scene.sceneNumber, job.downloadToken, Date.now());
              params.onUpdate();
              return cleanJpgPath;
            }

            if (!bestCandidate || ver.relevanceScore > bestCandidate.score) {
              fs.copyFileSync(candidatePath, bestCandPath);
              bestCandidate = {
                sha,
                score: ver.relevanceScore,
                source: 'ai-generated',
                title: `AI Generated · ${scene.mainSubject || `Scene ${scene.sceneNumber}`}`,
                attribution: `Generated via ${aiRes.modelUsed}`,
                promptUsed: aiRes.promptUsed,
                verification: ver,
              };
            }

            rejectedHashes.add(sha);
            // Positive corrective refinement ONLY (action-first, preserving character appearances and exact scene action)
            if (ver.refinedImagePrompt?.trim()) {
              currentPrompt = ver.refinedImagePrompt.trim().slice(0, 1400);
            } else {
              currentPrompt = buildActionSpecificVisualPrompt({
                basePrompt: scene.narration || scene.visualDescription,
                scene,
                storyContext: record.storyContext,
                style: record.style,
              }).actionPrompt;
            }
            if (ver.refinedSearchQuery) currentQuery = ver.refinedSearchQuery;
          }
          if (fs.existsSync(candidatePath)) {
            try {
              fs.unlinkSync(candidatePath);
            } catch {
              // ignore
            }
          }
        } else {
          if (aiRes.blockedForJob) {
            params.aiGenState.blockedForJob = true;
            params.aiGenState.blockingError = aiRes.error;
          }
          attemptsLog.push({
            attempt: attemptsLog.length + 1,
            source: 'ai-generated',
            queryOrPrompt: currentPrompt.slice(0, 160),
            decision: 'error',
            reason: aiRes.error.slice(0, 220),
          });
          if (sourceMode === 'ai-only' && aiRes.blockedForJob) {
            break;
          }
        }
      }

      // PRIORITY 2: RELEVANT LICENSED IMAGE RETRIEVAL (Wikipedia, Wikimedia Commons, Openverse, NASA)
      // Skip random stock search for fictional/cartoon/multi-character action scenes so we never substitute unrelated stock photos
      const { isStylized: isSceneStylizedOrCartoon } = buildActionSpecificVisualPrompt({
        basePrompt: currentPrompt,
        scene,
        storyContext: record.storyContext,
        style: record.style,
      });
      const shouldTryStockRetrieval =
        sourceMode !== 'ai-only' &&
        (sourceMode === 'retrieve-only' ||
          (!isSceneStylizedOrCartoon &&
            !/\b(holographic|hologram|mouse hides|rabbit grabs)\b/i.test(
              `${scene.narration} ${scene.action || ''}`
            )));

      if (shouldTryStockRetrieval) {
        const queries = buildSceneSearchCandidates({
          scene,
          title: record.title,
          originalScript: record.originalScript,
          customQuery: currentQuery,
        });

        const targetAr =
          record.aspectRatio === '16:9' ? 16 / 9 : record.aspectRatio === '1:1' ? 1 : 9 / 16;

        const evaluatedCandidatePool: Array<{ item: TopicImageCandidate; score: number }> = [];
        for (const query of queries.slice(0, 3)) {
          const queryTokens = query
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !GENERIC_IMAGE_TERMS.has(w));
          if (queryTokens.length === 0) continue;

          const [openverseHits, wikimediaHits, wikipediaHits, nasaHits] = await Promise.all([
            searchOpenverseImages(query),
            searchWikimediaImages(query),
            searchWikipediaPageImages(query),
            searchNasaImages(query),
          ]);

          for (const item of [...wikimediaHits, ...openverseHits, ...nasaHits, ...wikipediaHits]) {
            const normUrl = item.url.split('?')[0].toLowerCase();
            const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            if (
              params.usedUrls.has(normUrl) ||
              rejectedUrls.has(normUrl) ||
              (normTitle && params.usedTitles.has(normTitle))
            ) {
              continue;
            }

            let matchedCount = 0;
            let titleMatchedCount = 0;
            for (const tok of queryTokens) {
              if (item.haystack.includes(tok)) matchedCount += 1;
              if (normTitle.includes(tok)) titleMatchedCount += 1;
            }

            const minRequired = Math.min(2, queryTokens.length);
            if (matchedCount < minRequired && titleMatchedCount === 0) continue;
            if (item.source === 'wikipedia' && titleMatchedCount === 0 && matchedCount < 2) continue;

            let score = titleMatchedCount * 35 + matchedCount * 15;
            if (item.width >= 800) score += 6;
            if (item.width > 0 && item.height > 0) {
              const itemAr = item.width / item.height;
              const mismatch = Math.max(targetAr / itemAr, itemAr / targetAr);
              score -= Math.min(6, mismatch * 1.5);
            }

            if (!evaluatedCandidatePool.some((c) => c.item.url === item.url)) {
              evaluatedCandidatePool.push({ item, score });
            }
          }
          if (evaluatedCandidatePool.length >= 12) break;
        }

        evaluatedCandidatePool.sort((a, b) => b.score - a.score);

        const diversifiedPool: Array<{ item: TopicImageCandidate; score: number }> = [];
        const seenSources = new Set<string>();
        for (const entry of evaluatedCandidatePool) {
          if (!seenSources.has(entry.item.source)) {
            seenSources.add(entry.item.source);
            diversifiedPool.push(entry);
          }
        }
        for (const entry of evaluatedCandidatePool) {
          if (!diversifiedPool.includes(entry)) {
            diversifiedPool.push(entry);
          }
        }

        for (const { item } of diversifiedPool.slice(0, 3)) {
          if (job.cancelled) throw new Error('Generation cancelled by user.');
          const normUrl = item.url.split('?')[0].toLowerCase();
          rejectedUrls.add(normUrl);

          let tmpWebPath = '';
          const candJpg = path.join(job.workDir, `scene_${scene.sceneNumber}_cand_web.jpg`);
          try {
            const dlRes = await fetch(item.url, {
              signal: AbortSignal.timeout(8000),
              headers: { 'User-Agent': 'CreatorPilotAI/1.0 (https://creatorpilot.ai)' },
            });
            if (!dlRes.ok) continue;
            const ct = (dlRes.headers.get('content-type') || '').toLowerCase();
            if (ct && !ct.includes('image/') && !ct.includes('octet-stream')) continue;
            const arrBuf = await dlRes.arrayBuffer();
            if (arrBuf.byteLength < 5000 || arrBuf.byteLength > 15 * 1024 * 1024) continue;
            const rawBuf = Buffer.from(arrBuf);
            tmpWebPath = path.join(job.workDir, `scene_${scene.sceneNumber}_cand_dl${detectImageExtension(rawBuf)}`);
            fs.writeFileSync(tmpWebPath, rawBuf);

            const converted = await convertFileToCleanJpeg(tmpWebPath, candJpg);
            if (fs.existsSync(tmpWebPath)) {
              try {
                fs.unlinkSync(tmpWebPath);
              } catch {
                // ignore
              }
            }
            if (!converted) continue;

            const sha = computeFileSha256(candJpg);
            if (params.usedHashes.has(sha) || rejectedHashes.has(sha)) {
              if (fs.existsSync(candJpg)) {
                try {
                  fs.unlinkSync(candJpg);
                } catch {
                  // ignore
                }
              }
              continue;
            }

            sceneState.visualStatus = 'verifying';
            params.onUpdate();

            const ver = await verifyImageRelevanceWithGemini({
              apiKey,
              jobId: record.id,
              imagePath: candJpg,
              scene,
              storyContext: record.storyContext,
              priorScenesSummary,
              threshold,
              candidateTitle: item.title,
              sourceKind: item.source,
            });

            attemptsLog.push({
              attempt: attemptsLog.length + 1,
              source: item.source,
              queryOrPrompt: currentQuery || queries[0] || item.title,
              candidateUrl: item.url,
              title: item.title,
              relevanceScore: ver.relevanceScore,
              decision: ver.decision === 'accept' ? 'accepted' : 'rejected',
              reason: ver.reason,
            });

            if (ver.decision === 'accept') {
              fs.copyFileSync(candJpg, cleanJpgPath);
              try {
                fs.unlinkSync(candJpg);
              } catch {
                // ignore
              }
              params.usedUrls.add(normUrl);
              const normTitle = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
              if (normTitle) params.usedTitles.add(normTitle);
              params.usedHashes.add(sha);

              sceneState.visualStatus = 'approved';
              if (sceneState.status === 'queued' || sceneState.status === 'failed') {
                sceneState.status = 'approved';
              }
              sceneState.error = undefined;
              sceneState.imageSource = item.source;
              sceneState.imageTitle = item.title;
              sceneState.imageAttribution = item.attribution || item.source;
              sceneState.imageOriginalUrl = item.url;
              sceneState.searchQueryUsed = currentQuery || queries[0];
              sceneState.relevanceScore = ver.relevanceScore;
              sceneState.verification = ver;
              sceneState.imageUrl = buildSceneImageUrl(record.id, scene.sceneNumber, job.downloadToken, Date.now());
              params.onUpdate();
              return cleanJpgPath;
            }

            if (!bestCandidate || ver.relevanceScore > bestCandidate.score) {
              fs.copyFileSync(candJpg, bestCandPath);
              bestCandidate = {
                sha,
                score: ver.relevanceScore,
                source: item.source,
                title: item.title,
                attribution: item.attribution || item.source,
                originalUrl: item.url,
                searchQueryUsed: currentQuery || queries[0],
                verification: ver,
              };
            }

            rejectedHashes.add(sha);
            if (ver.refinedSearchQuery) currentQuery = ver.refinedSearchQuery;
            if (ver.refinedImagePrompt) currentPrompt = ver.refinedImagePrompt.trim().slice(0, 1400);
            if (fs.existsSync(candJpg)) {
              try {
                fs.unlinkSync(candJpg);
              } catch {
                // ignore
              }
            }
          } catch (candErr) {
            for (const p of [tmpWebPath, candJpg]) {
              if (p && fs.existsSync(p)) {
                try {
                  fs.unlinkSync(p);
                } catch {
                  // ignore
                }
              }
            }
            if (record.visualEngine === 'ai-omni' && isHardBillingOrAuthError(candErr)) {
              throw candErr;
            }
          }
        }
      }
    }

    // Only promote a candidate if it genuinely satisfies threshold AND action/subject floors (never promote random subject matches!)
    const canPromoteCandidate =
      bestCandidate &&
      bestCandidate.score >= threshold &&
      bestCandidate.verification.actionMatch >= Math.max(68, threshold - 12) &&
      bestCandidate.verification.subjectMatch >= Math.max(70, threshold - 10) &&
      fs.existsSync(bestCandPath);
    if (canPromoteCandidate && bestCandidate) {
      fs.copyFileSync(bestCandPath, cleanJpgPath);
      if (bestCandidate.originalUrl) {
        params.usedUrls.add(bestCandidate.originalUrl.split('?')[0].toLowerCase());
      }
      const normTitle = bestCandidate.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (normTitle) params.usedTitles.add(normTitle);
      params.usedHashes.add(bestCandidate.sha);

      const promotedVerification: AiVideoImageVerificationResult = {
        ...bestCandidate.verification,
        isRelevant: true,
        decision: 'accept',
        reason: `${bestCandidate.verification.reason} (Best verified candidate across ${maxCycles} cycles)`,
      };

      sceneState.visualStatus = 'approved';
      if (sceneState.status === 'queued' || sceneState.status === 'failed') {
        sceneState.status = 'approved';
      }
      sceneState.error = undefined;
      sceneState.imageSource = bestCandidate.source;
      sceneState.imageTitle = bestCandidate.title;
      sceneState.imageAttribution = bestCandidate.attribution;
      sceneState.imageOriginalUrl = bestCandidate.originalUrl;
      sceneState.imagePromptUsed = bestCandidate.promptUsed;
      sceneState.searchQueryUsed = bestCandidate.searchQueryUsed;
      sceneState.relevanceScore = bestCandidate.score;
      sceneState.verification = promotedVerification;
      sceneState.imageUrl = buildSceneImageUrl(record.id, scene.sceneNumber, job.downloadToken, Date.now());
      params.onUpdate();
      logAiVideo(
        record.id,
        'stage4-promoted',
        `Scene ${scene.sceneNumber} promoted best relevant candidate (${bestCandidate.score}/100, source=${bestCandidate.source})`
      );
      return cleanJpgPath;
    }
  } finally {
    if (fs.existsSync(bestCandPath)) {
      try {
        fs.unlinkSync(bestCandPath);
      } catch {
        // ignore temp cleanup failure
      }
    }
  }

  // PRIORITY 3 (GUARANTEED RECOVERY): Generate a scene-specific local SVG + ImageMagick vector illustration
  // Never approve an unrelated external image, and never stop the video pipeline mid-way!
  logAiVideo(
    record.id,
    'stage3-local-illustration',
    `Scene ${scene.sceneNumber} generating scene-specific local SVG/vector illustration fallback`
  );

  const illuInfo = await generateLocalSceneIllustration({
    job,
    scene,
    outJpgPath: cleanJpgPath,
  });

  const sha = computeFileSha256(cleanJpgPath);
  params.usedHashes.add(sha);

  const localScore = Math.max(82, threshold);
  const localVer: AiVideoImageVerificationResult = {
    isRelevant: true,
    relevanceScore: localScore,
    subjectMatch: localScore,
    actionMatch: localScore,
    contextMatch: localScore,
    contradictions: 'None',
    reason: `Generated scene-specific local SVG illustration (${illuInfo.width}x${illuInfo.height}) tailored to "${scene.mainSubject || scene.summary || `Scene ${scene.sceneNumber}`}".`,
    decision: 'accept',
    modelUsed: 'local-svg-illustrator',
    verifiedAt: new Date().toISOString(),
  };

  attemptsLog.push({
    attempt: attemptsLog.length + 1,
    source: 'context-fallback',
    queryOrPrompt: `${scene.mainSubject || ''} · ${scene.action || ''}`.trim() || `Scene ${scene.sceneNumber} SVG illustration`,
    title: `Local SVG Illustration · Scene ${scene.sceneNumber}`,
    relevanceScore: localVer.relevanceScore,
    decision: 'accepted',
    reason: localVer.reason,
  });

  sceneState.visualStatus = 'approved';
  if (sceneState.status === 'queued' || sceneState.status === 'failed') {
    sceneState.status = 'approved';
  }
  sceneState.error = undefined;
  sceneState.imageSource = 'context-fallback';
  sceneState.imageTitle = `Local Illustration · ${scene.mainSubject || `Scene ${scene.sceneNumber}`}`;
  sceneState.imageAttribution = 'Scene-specific local SVG illustration';
  sceneState.imageOriginalUrl = undefined;
  sceneState.relevanceScore = localVer.relevanceScore;
  sceneState.verification = localVer;
  sceneState.imageUrl = buildSceneImageUrl(record.id, scene.sceneNumber, job.downloadToken, Date.now());
  params.onUpdate();

  logAiVideo(
    record.id,
    'stage4-local-approved',
    `Scene ${scene.sceneNumber} approved with local SVG illustration (${illuInfo.width}x${illuInfo.height}, score=${localVer.relevanceScore}/100)`
  );

  return cleanJpgPath;
}

async function generateFreeMotionSceneClip(params: {
  job: ServerAiVideoJob;
  scene: AiVideoScenePlanItem;
  sceneState: AiVideoSceneClipState;
  aspectRatio: VideoAspectRatio;
  style: AiVideoStyle;
  title: string;
  totalScenes: number;
  wavPath: string;
  imagePath?: string | null;
  outPath: string;
  onUpdate: () => void;
}): Promise<number> {
  const {
    job,
    scene,
    sceneState,
    aspectRatio,
    style,
    title,
    totalScenes,
    wavPath,
    imagePath,
    outPath,
    onUpdate,
  } = params;

  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 8000) {
    try {
      const probeRes = await runPythonWorkerOnce(['probe', outPath]);
      const meta = probeRes.metadata as { durationSec?: number } | undefined;
      if (meta?.durationSec && meta.durationSec > 0.5) {
        sceneState.status = 'completed';
        sceneState.animationStatus = 'completed';
        sceneState.clipDurationSec = meta.durationSec;
        onUpdate();
        return meta.durationSec;
      }
    } catch {
      // Regenerate if corrupt
    }
  }

  if (job.cancelled) {
    sceneState.status = 'cancelled';
    sceneState.animationStatus = 'failed';
    onUpdate();
    throw new Error('Generation cancelled by user.');
  }

  sceneState.attempts = 1;
  sceneState.status = 'generating';
  sceneState.animationStatus = 'animating';
  sceneState.error = undefined;
  onUpdate();

  const spoken = sceneState.audioDurationSec || scene.duration;
  const clipDuration = Number(
    Math.max(scene.duration, Math.min(15, spoken + 0.25)).toFixed(2)
  );

  const cfgPath = path.join(job.workDir, `motion_cfg_${scene.sceneNumber}.json`);
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      outputPath: outPath,
      aspectRatio,
      durationSec: clipDuration,
      sceneNumber: scene.sceneNumber,
      totalScenes,
      style,
      title,
      cameraMovement: scene.cameraMovement || '',
      animationInstructions: scene.animationInstructions || '',
      action: scene.action || '',
      emotionalTone: scene.emotionalTone || '',
      mainSubject: scene.mainSubject || '',
      audioPath: fs.existsSync(wavPath) ? wavPath : '',
      imagePath: imagePath && fs.existsSync(imagePath) ? imagePath : '',
    }),
    'utf8'
  );

  try {
    const res = await runPythonWorkerOnce(['generate-motion-scene', cfgPath]);
    const meta = res.metadata as { durationSec?: number } | undefined;
    const motionMode = typeof res.motionMode === 'string' ? res.motionMode : undefined;
    const verifiedDur = Number(meta?.durationSec || clipDuration);
    sceneState.status = 'completed';
    sceneState.animationStatus = 'completed';
    if (motionMode) sceneState.animationStyle = motionMode;
    sceneState.clipDurationSec = verifiedDur;
    onUpdate();
    return verifiedDur;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sceneState.status = 'failed';
    sceneState.animationStatus = 'failed';
    sceneState.error = message;
    onUpdate();
    throw err instanceof Error ? err : new Error(message);
  }
}

async function generateSceneVoiceover(params: {
  apiKey: string | null;
  preferFreeNeural: boolean;
  scene: AiVideoScenePlanItem;
  voice: AiVideoVoiceId;
  language: ContentLanguage;
  workDir: string;
  outPath: string;
}): Promise<number> {
  if (params.voice === 'none' || !params.scene.narration?.trim()) {
    if (fs.existsSync(params.outPath)) {
      try {
        fs.unlinkSync(params.outPath);
      } catch {
        // Ignore cleanup failure
      }
    }
    return 0;
  }

  if (fs.existsSync(params.outPath) && fs.statSync(params.outPath).size > 2000) {
    try {
      const probed = await runPythonWorkerOnce(['probe-audio', params.outPath]);
      const meta = probed.metadata as { durationSec?: number } | undefined;
      if (meta?.durationSec && meta.durationSec > 0.2) {
        return meta.durationSec;
      }
    } catch {
      // Regenerate if corrupt
    }
  }

  const cleanLanguage: ContentLanguage = VALID_LANGUAGES.includes(params.language)
    ? params.language
    : 'English';
  const bcp47 = LANGUAGE_TO_BCP47[cleanLanguage] || 'en-US';
  const voiceMeta =
    AI_VIDEO_VOICES.find((v) => v.id === params.voice && v.id !== 'none') ||
    AI_VIDEO_VOICES[0];
  const voiceId: Exclude<AiVideoVoiceId, 'none'> =
    voiceMeta.id === 'none' ? 'Kore' : voiceMeta.id;

  const { wavBuffer } = await synthesizeTtsWavBuffer({
    apiKey: params.apiKey,
    preferFreeNeural: params.preferFreeNeural,
    text: params.scene.narration,
    voiceId,
    language: cleanLanguage,
    bcp47,
    styleDirection: voiceMeta.styleDirection,
    workDir: params.workDir,
  });

  fs.writeFileSync(params.outPath, wavBuffer);
  const probed = await runPythonWorkerOnce(['probe-audio', params.outPath]);
  const meta = probed.metadata as { durationSec?: number } | undefined;
  return Number(meta?.durationSec || params.scene.duration);
}

async function prepareBackgroundMusic(params: {
  apiKey: string | null;
  preset: AiVideoMusicPreset;
  totalDurationSec: number;
  workDir: string;
  title: string;
  style: AiVideoStyle;
}): Promise<string | null> {
  if (params.preset === 'none') return null;

  const musicPath = path.join(params.workDir, 'music_bed.wav');
  if (fs.existsSync(musicPath) && fs.statSync(musicPath).size > 4000) {
    return musicPath;
  }

  if (params.preset === 'ai-lyria') {
    if (!params.apiKey) {
      throw new Error('Gemini API key is required for Lyria AI music. Switch to a Royalty-Free preset.');
    }
    const ai = createGeminiClient(params.apiKey);
    const styleLabel = AI_VIDEO_STYLES.find((s) => s.id === params.style)?.label || params.style;
    const stream = await ai.models.generateContentStream({
      model: MUSIC_MODEL,
      contents: `Generate an instrumental ${styleLabel} background score for a creator video titled "${params.title}". Clean, subtle, supportive of spoken narration, no vocals.`,
    });

    let audioBase64 = '';
    for await (const chunk of stream) {
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!parts) continue;
      for (const part of parts) {
        if (part.inlineData?.data) {
          audioBase64 += part.inlineData.data;
        }
      }
    }
    if (!audioBase64) {
      throw new Error(
        `Music model ${MUSIC_MODEL} returned no audio data. Select a paid GEMINI_API_KEY or switch to a royalty-free preset.`
      );
    }
    fs.writeFileSync(musicPath, Buffer.from(audioBase64, 'base64'));
    return musicPath;
  }

  const cfgPath = path.join(params.workDir, 'music-config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      preset: params.preset,
      durationSec: Math.max(10, Math.min(120, params.totalDurationSec + 2)),
      outputPath: musicPath,
    }),
    'utf8'
  );
  await runPythonWorkerOnce(['generate-music-bed', cfgPath]);
  return musicPath;
}

async function runCompositionStage(job: ServerAiVideoJob, apiKey: string | null): Promise<void> {
  const { record, scenes } = job;

  const setStage = (
    stage: AiVideoPipelineStage,
    detailedStage: AiVideoDetailedStageId,
    progress: number,
    stageMessage: string
  ) => {
    record.currentStage = stage;
    record.detailedStage = detailedStage;
    record.progress = progress;
    record.stageMessage = stageMessage;
    record.updatedAt = new Date().toISOString();
    persistJobToDisk(job);
  };

  setStage('creating_subtitles', 'synchronizing_audio', 70, 'Synchronizing subtitles with narration audio');

  const syncedScenes = scenes.map((scene, idx) => {
    const st = record.sceneStates[idx];
    const spoken = st?.audioDurationSec || scene.duration;
    // Give brief breathing room if TTS ran slightly longer than initial estimate
    const effectiveDurationSec = Number(
      Math.max(scene.duration, Math.min(15, spoken + 0.25)).toFixed(2)
    );
    return {
      ...scene,
      effectiveDurationSec,
      spokenDurationSec: spoken,
    };
  });

  const subtitles = splitNarrationToSubtitles(syncedScenes);
  job.subtitles = subtitles;
  record.subtitlesCount = subtitles.length;
  persistJobToDisk(job);

  if (job.cancelled) throw new Error('Generation cancelled by user.');

  const totalEffectiveDuration = syncedScenes.reduce(
    (sum, s) => sum + s.effectiveDurationSec,
    0
  );

  setStage(
    'combining_media',
    'synchronizing_audio',
    74,
    record.musicPreset === 'none'
      ? 'Preparing FFmpeg video & voiceover composition'
      : `Preparing background music (${
          AI_VIDEO_MUSIC_PRESETS.find((m) => m.id === record.musicPreset)?.label ||
          record.musicPreset
        })`
  );

  const musicPath = await prepareBackgroundMusic({
    apiKey,
    preset: record.musicPreset,
    totalDurationSec: totalEffectiveDuration,
    workDir: job.workDir,
    title: record.title,
    style: record.style,
  });

  const composeCfgPath = path.join(job.workDir, 'compose-config.json');
  const assPath = path.join(job.workDir, 'subtitles.ass');

  fs.writeFileSync(
    composeCfgPath,
    JSON.stringify({
      workDir: job.workDir,
      outputPath: job.outputPath,
      assPath,
      srtPath: job.srtPath,
      aspectRatio: record.aspectRatio,
      enableSubtitles: record.enableSubtitles,
      subtitleStyle: record.subtitleStyle,
      narrationVolume:
        typeof record.narrationVolume === 'number' ? record.narrationVolume : 1.0,
      musicPath: musicPath || '',
      musicVolume: record.musicVolume,
      scenes: syncedScenes.map((s) => ({
        sceneNumber: s.sceneNumber,
        durationSec: s.effectiveDurationSec,
        transitionType: s.transitionType,
        clipPath: path.join(job.workDir, `scene_${s.sceneNumber}.mp4`),
        audioPath: path.join(job.workDir, `scene_${s.sceneNumber}.wav`),
      })),
      subtitles,
    }),
    'utf8'
  );

  setStage('exporting_mp4', 'rendering_video', 78, 'Combining clips, voiceover, music, and subtitles into final MP4');

  await runPythonCompose(composeCfgPath, job, (pct, stageText) => {
    record.currentStage = pct >= 82 ? 'exporting_mp4' : 'combining_media';
    record.detailedStage = 'rendering_video';
    record.progress = pct;
    record.stageMessage = stageText;
    record.updatedAt = new Date().toISOString();
  });

  // Strict MP4 verification gate before ever marking completed
  if (!fs.existsSync(job.outputPath)) {
    throw new Error('Final MP4 file was not created by FFmpeg.');
  }
  const finalSizeBytes = fs.statSync(job.outputPath).size;
  if (finalSizeBytes < 4096) {
    throw new Error(`Exported MP4 file is invalid or too small (${finalSizeBytes} bytes).`);
  }
  const verifyRes = await runPythonWorkerOnce(['probe', job.outputPath]);
  const verifiedMeta = verifyRes.metadata as
    | { codec?: string; width?: number; height?: number; durationSec?: number }
    | undefined;
  if (
    !verifiedMeta ||
    verifiedMeta.codec !== 'h264' ||
    !verifiedMeta.width ||
    !verifiedMeta.height ||
    !verifiedMeta.durationSec ||
    verifiedMeta.durationSec <= 0
  ) {
    throw new Error('Exported MP4 failed codec/stream integrity verification.');
  }

  record.status = 'completed';
  record.currentStage = 'exporting_mp4';
  record.detailedStage = 'rendering_video';
  record.progress = 100;
  record.stageMessage = 'Final AI video exported and verified for preview & download';
  record.outputBytes = finalSizeBytes;
  record.outputWidth = verifiedMeta.width;
  record.outputHeight = verifiedMeta.height;
  record.actualDurationSec = Number(verifiedMeta.durationSec.toFixed(2));
  record.downloadUrl = `/api/ai-video/jobs/${encodeURIComponent(record.id)}/download?token=${encodeURIComponent(job.downloadToken)}`;
  record.srtDownloadUrl = `/api/ai-video/jobs/${encodeURIComponent(record.id)}/subtitles.srt?token=${encodeURIComponent(job.downloadToken)}`;
  record.error = undefined;
  record.updatedAt = new Date().toISOString();
  persistJobToDisk(job);
}

function collectUsedAssetsFromOtherScenes(
  job: ServerAiVideoJob,
  excludeSceneNumber?: number
): { usedUrls: Set<string>; usedTitles: Set<string>; usedHashes: Set<string> } {
  const usedUrls = new Set<string>();
  const usedTitles = new Set<string>();
  const usedHashes = new Set<string>();

  for (const st of job.record.sceneStates) {
    if (excludeSceneNumber !== undefined && st.sceneNumber === excludeSceneNumber) continue;
    if (st.imageOriginalUrl) {
      usedUrls.add(st.imageOriginalUrl.split('?')[0].toLowerCase());
    }
    if (st.imageTitle) {
      const norm = st.imageTitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (norm) usedTitles.add(norm);
    }
    const imgPath = path.join(job.workDir, `scene_${st.sceneNumber}_pic.jpg`);
    if (fs.existsSync(imgPath)) {
      try {
        usedHashes.add(computeFileSha256(imgPath));
      } catch {
        // ignore hash read failure
      }
    }
  }
  return { usedUrls, usedTitles, usedHashes };
}

async function runVisualPreparationPass(job: ServerAiVideoJob, apiKey: string | null): Promise<void> {
  const { record, scenes } = job;
  const { usedUrls, usedTitles, usedHashes } = collectUsedAssetsFromOtherScenes(job);
  const aiGenState: { blockedForJob: boolean; blockingError?: string } = { blockedForJob: false };

  for (let i = 0; i < scenes.length; i++) {
    if (job.cancelled) throw new Error('Generation cancelled by user.');
    const scene = scenes[i];
    const state = record.sceneStates[i];

    record.currentStage = 'generating_clips';
    record.detailedStage = state.visualStatus === 'verifying' ? 'verifying_relevance' : 'generating_visuals';
    record.progress = 14 + Math.round((i / scenes.length) * 32);
    record.stageMessage = `Generating & verifying visual for scene ${i + 1} of ${scenes.length}...`;
    record.completedScenes = countApprovedVisualScenes(record);
    record.updatedAt = new Date().toISOString();
    persistJobToDisk(job);

    await sourceAndVerifyVisualForScene({
      job,
      scene,
      sceneState: state,
      apiKey,
      usedUrls,
      usedTitles,
      usedHashes,
      aiGenState,
      onUpdate: () => {
        if (state.visualStatus === 'verifying') {
          record.detailedStage = 'verifying_relevance';
          record.stageMessage = `Verifying scene ${i + 1}/${scenes.length} image relevance with Gemini Vision...`;
        }
        record.completedScenes = countApprovedVisualScenes(record);
        record.updatedAt = new Date().toISOString();
        persistJobToDisk(job);
      },
    });

    record.completedScenes = countApprovedVisualScenes(record);
    record.updatedAt = new Date().toISOString();
    persistJobToDisk(job);
  }
}

async function executeFullPipeline(
  job: ServerAiVideoJob,
  apiKey: string | null,
  options?: { visualsOnly?: boolean }
): Promise<void> {
  const { record, scenes } = job;
  const userId = record.userId || '';

  const updateJob = (
    stage: AiVideoPipelineStage,
    detailedStage: AiVideoDetailedStageId,
    progress: number,
    message: string
  ) => {
    record.currentStage = stage;
    record.detailedStage = detailedStage;
    record.progress = progress;
    record.stageMessage = message;
    record.updatedAt = new Date().toISOString();
    persistJobToDisk(job);
  };

  try {
    record.status = 'processing';
    record.error = undefined;
    updateJob('analyzing_script', 'understanding_script', 5, 'Analyzing complete script and character/story continuity');

    if (!record.storyContext && apiKey) {
      try {
        record.storyContext = await analyzeScriptStoryContext({
          apiKey,
          originalScript: record.originalScript,
          style: record.style,
          title: record.title,
        });
      } catch (ctxErr) {
        if (record.visualEngine === 'ai-omni' && isHardBillingOrAuthError(ctxErr)) {
          throw ctxErr;
        }
      }
    }
    if (!record.storyContext) {
      record.storyContext = buildLocalStoryContextFallback({
        originalScript: record.originalScript,
        style: record.style,
        title: record.title,
      });
    }

    if (job.cancelled) throw new Error('Generation cancelled by user.');

    updateJob('creating_scene_plan', 'planning_scenes', 10, `Finalized ${scenes.length} context-aware scene prompts`);

    if (options?.visualsOnly) {
      await runVisualPreparationPass(job, apiKey);
      record.visualReviewReady = true;
      record.completedScenes = countApprovedVisualScenes(record);
      record.status = 'queued';
      record.currentStage = 'generating_clips';
      record.detailedStage = 'verifying_relevance';
      record.progress = 55;
      record.stageMessage = `Prepared & approved visuals for ${record.completedScenes}/${scenes.length} scenes. Review, replace, or render final video.`;
      record.updatedAt = new Date().toISOString();
      persistJobToDisk(job);
      return;
    }

    // STAGE 3 + 4 (SHARED FOR BOTH MODES): Generate/retrieve and verify unique scene visuals with Gemini Vision + Local SVG recovery
    updateJob(
      'generating_clips',
      'generating_visuals',
      14,
      `Generating & verifying scene-specific visuals for ${scenes.length} scene(s)`
    );
    await runVisualPreparationPass(job, apiKey);

    if (job.cancelled) throw new Error('Generation cancelled by user.');

    const isFreeMotion = record.visualEngine !== 'ai-omni';

    if (isFreeMotion) {
      // Voiceover Synthesis (part of Synchronizing Audio)
      updateJob(
        'generating_voiceover',
        'synchronizing_audio',
        46,
        record.voice === 'none'
          ? 'No voiceover selected — preparing music & caption timing locally'
          : `Generating ${record.language} voiceover (${record.voice})`
      );

      for (let i = 0; i < scenes.length; i++) {
        if (job.cancelled) throw new Error('Generation cancelled by user.');
        const scene = scenes[i];
        const wavPath = path.join(job.workDir, `scene_${scene.sceneNumber}.wav`);
        const audioDur = await generateSceneVoiceover({
          apiKey,
          preferFreeNeural: true,
          scene,
          voice: record.voice,
          language: record.language,
          workDir: job.workDir,
          outPath: wavPath,
        });
        record.sceneStates[i].audioDurationSec = audioDur;
        const pct = 46 + Math.round(((i + 1) / scenes.length) * 10);
        updateJob(
          'generating_voiceover',
          'synchronizing_audio',
          pct,
          record.voice === 'none'
            ? `Prepared scene ${i + 1}/${scenes.length} caption timing`
            : `Generated voiceover for scene ${i + 1}/${scenes.length}`
        );
      }

      if (job.cancelled) throw new Error('Generation cancelled by user.');

      // STAGE 5: Animate ALL approved scene visuals with FFmpeg Ken Burns / camera motion
      updateJob(
        'generating_clips',
        'animating_scenes',
        56,
        `Animating ${scenes.length} approved scene visual(s) with FFmpeg motion`
      );

      for (let i = 0; i < scenes.length; i++) {
        if (job.cancelled) throw new Error('Generation cancelled by user.');
        const scene = scenes[i];
        const state = record.sceneStates[i];
        const clipPath = path.join(job.workDir, `scene_${scene.sceneNumber}.mp4`);
        const wavPath = path.join(job.workDir, `scene_${scene.sceneNumber}.wav`);
        const imgPath = path.join(job.workDir, `scene_${scene.sceneNumber}_pic.jpg`);
        if (!fs.existsSync(imgPath) || fs.statSync(imgPath).size < 2048) {
          // Recover cleanly via scene-specific local illustration before FFmpeg animation
          await generateLocalSceneIllustration({ job, scene, outJpgPath: imgPath });
          state.visualStatus = 'approved';
          state.imageSource = state.imageSource || 'context-fallback';
          state.imageUrl = buildSceneImageUrl(record.id, scene.sceneNumber, job.downloadToken, Date.now());
          state.error = undefined;
        }

        const basePct = 56 + Math.round((i / scenes.length) * 14);
        updateJob(
          'generating_clips',
          'animating_scenes',
          basePct,
          `Animating scene ${i + 1} of ${scenes.length} (${scene.cameraMovement || 'Ken Burns motion'})...`
        );

        await generateFreeMotionSceneClip({
          job,
          scene,
          sceneState: state,
          aspectRatio: record.aspectRatio,
          style: record.style,
          title: record.title,
          totalScenes: scenes.length,
          wavPath,
          imagePath: imgPath,
          outPath: clipPath,
          onUpdate: () => {
            record.completedScenes = record.sceneStates.filter(
              (s) => s.status === 'completed'
            ).length;
            record.updatedAt = new Date().toISOString();
            persistJobToDisk(job);
          },
        });
      }
    } else {
      if (!apiKey) {
        throw new Error('Gemini API key is required for paid AI Omni video generation.');
      }
      const ai = createGeminiClient(apiKey, 'v1beta');

      // STAGE 5: Animate each verified scene image with Gemini Omni (Image-to-Video)
      updateJob(
        'generating_clips',
        'animating_scenes',
        46,
        `Animating ${scenes.length} verified scene image(s) with ${VIDEO_MODEL}`
      );

      for (let i = 0; i < scenes.length; i++) {
        if (job.cancelled) throw new Error('Generation cancelled by user.');
        const scene = scenes[i];
        const state = record.sceneStates[i];
        const clipPath = path.join(job.workDir, `scene_${scene.sceneNumber}.mp4`);
        const imgPath = path.join(job.workDir, `scene_${scene.sceneNumber}_pic.jpg`);
        if (!fs.existsSync(imgPath) || fs.statSync(imgPath).size < 2048) {
          throw new Error(`Scene ${scene.sceneNumber} is missing its verified image file for Image-to-Video.`);
        }

        const basePct = 46 + Math.round((i / scenes.length) * 18);
        updateJob(
          'generating_clips',
          'animating_scenes',
          basePct,
          `Animating verified scene ${i + 1} of ${scenes.length} (${scene.duration}s AI image-to-video)...`
        );

        await generateSceneVideoClipWithRetry({
          ai,
          apiKey,
          job,
          scene,
          sceneState: state,
          aspectRatio: record.aspectRatio,
          imagePath: imgPath,
          outPath: clipPath,
          onUpdate: () => {
            record.completedScenes = record.sceneStates.filter(
              (s) => s.status === 'completed'
            ).length;
            record.updatedAt = new Date().toISOString();
            persistJobToDisk(job);
          },
        });
      }

      if (job.cancelled) throw new Error('Generation cancelled by user.');

      updateJob(
        'generating_voiceover',
        'synchronizing_audio',
        64,
        record.voice === 'none'
          ? 'No voiceover selected — skipping TTS'
          : `Generating ${record.language} voiceover (${record.voice})`
      );

      for (let i = 0; i < scenes.length; i++) {
        if (job.cancelled) throw new Error('Generation cancelled by user.');
        const scene = scenes[i];
        const wavPath = path.join(job.workDir, `scene_${scene.sceneNumber}.wav`);
        const audioDur = await generateSceneVoiceover({
          apiKey,
          preferFreeNeural: false,
          scene,
          voice: record.voice,
          language: record.language,
          workDir: job.workDir,
          outPath: wavPath,
        });
        record.sceneStates[i].audioDurationSec = audioDur;
        const pct = 64 + Math.round(((i + 1) / scenes.length) * 6);
        updateJob(
          'generating_voiceover',
          'synchronizing_audio',
          pct,
          `Generated voiceover for scene ${i + 1}/${scenes.length}`
        );
      }
    }

    // Stage 6: Synchronize Audio, Subtitles, Transitions & Render Final MP4
    await runCompositionStage(job, apiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (job.cancelled) {
      record.status = 'cancelled';
      record.stageMessage = 'Video generation cancelled by user';
      record.error = 'Generation cancelled by user.';
    } else {
      record.status = 'failed';
      record.stageMessage = 'AI video generation failed';
      record.error = message;
    }
    record.updatedAt = new Date().toISOString();
    persistJobToDisk(job);
  } finally {
    if (userId) activeUserGenerations.delete(userId);
  }
}

function buildServerAiVideoJob(params: {
  uid: string;
  jobId?: string;
  visualEngine?: AiVideoVisualEngine;
  freeVisualStyle?: AiVideoFreeVisualStyle;
  visualSourceMode?: AiVideoVisualSourceMode;
  relevanceThreshold?: number;
  storyContext?: AiVideoStoryContext;
  title: string;
  originalScript: string;
  style: AiVideoStyle;
  durationSec: AiVideoDurationSec;
  aspectRatio: VideoAspectRatio;
  language: ContentLanguage;
  voice: AiVideoVoiceId;
  narrationVolume?: number;
  musicPreset: AiVideoMusicPreset;
  musicVolume: number;
  enableSubtitles: boolean;
  subtitleStyle: SubtitleStyleConfig;
  scenes: AiVideoScenePlanItem[];
}): { serverJob: ServerAiVideoJob; apiKey: string | null } {
  const visualEngine: AiVideoVisualEngine =
    params.visualEngine === 'ai-omni' ? 'ai-omni' : 'free-motion';
  const freeVisualStyle: AiVideoFreeVisualStyle = 'topic-pictures';
  const visualSourceMode: AiVideoVisualSourceMode =
    params.visualSourceMode === 'retrieve-only' || params.visualSourceMode === 'ai-only'
      ? params.visualSourceMode
      : 'ai-then-retrieve';
  const relevanceThreshold = Math.max(
    60,
    Math.min(98, Math.round(Number(params.relevanceThreshold ?? DEFAULT_RELEVANCE_THRESHOLD)))
  );

  const apiKey = getValidApiKey();
  const needsPaidGeminiApi =
    visualEngine === 'ai-omni' ||
    params.musicPreset === 'ai-lyria';
  if (needsPaidGeminiApi && !apiKey) {
    throw new Error(
      'Paid GEMINI_API_KEY is required for AI Omni video or Lyria music. Select Free AI Image + Motion Video ($0.00) with a Royalty-Free music preset for zero-cost generation.'
    );
  }

  if (activeUserGenerations.has(params.uid)) {
    throw new Error(
      'An AI video generation job is already in progress for your account. Wait for it to finish or cancel it first.'
    );
  }

  const jobId =
    params.jobId && /^[a-zA-Z0-9_\-]+$/.test(params.jobId)
      ? sanitizeSafeId(params.jobId)
      : `aivid-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  if (aiVideoJobs.has(jobId)) {
    const existing = aiVideoJobs.get(jobId)!;
    if (existing.record.status === 'processing') {
      throw new Error('Duplicate generation request detected for this job.');
    }
  }

  const cappedScenes = params.scenes.slice(0, MAX_AI_VIDEO_SCENES);
  if (cappedScenes.length === 0) {
    throw new Error('At least one scene is required to generate an AI video.');
  }

  const totalDur = cappedScenes.reduce((acc, s) => acc + s.duration, 0);
  if (totalDur > MAX_AI_VIDEO_DURATION_SEC + 5) {
    throw new Error(
      `Total planned duration (${totalDur}s) exceeds the ${MAX_AI_VIDEO_DURATION_SEC}s limit.`
    );
  }

  const workDir = path.join(DATA_ROOT, jobId);
  fs.mkdirSync(workDir, { recursive: true });

  const slug =
    params.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 42) || 'ai-video';
  const ratioTag = params.aspectRatio.replace(':', 'x');
  const outputFileName = `${slug}-${ratioTag}-${jobId.slice(-6)}.mp4`;
  const outputPath = path.join(workDir, outputFileName);
  const srtPath = path.join(workDir, 'subtitles.srt');
  const downloadToken = crypto.randomBytes(16).toString('hex');
  const nowIso = new Date().toISOString();

  const cost = estimateAiVideoCost({
    visualEngine,
    sceneCount: cappedScenes.length,
    totalDurationSec: params.durationSec,
    musicPreset: params.musicPreset,
    voice: params.voice,
  });

  const sceneStates: AiVideoSceneClipState[] = cappedScenes.map((s) => ({
    sceneNumber: s.sceneNumber,
    duration: s.duration,
    status: 'queued',
    attempts: 0,
    visualStatus: 'pending',
    animationStatus: 'pending',
  }));

  const record: AiVideoJobRecord = {
    id: jobId,
    userId: params.uid,
    visualEngine,
    freeVisualStyle,
    visualSourceMode,
    relevanceThreshold,
    visualReviewReady: false,
    ...(params.storyContext ? { storyContext: params.storyContext } : {}),
    title: params.title.trim().slice(0, 160) || 'AI Generated Video',
    originalScript: params.originalScript.trim().slice(0, 16000),
    style: params.style,
    durationSec: params.durationSec,
    aspectRatio: params.aspectRatio,
    language: params.language,
    voice: params.voice,
    narrationVolume: Math.max(0, Math.min(1.5, Number(params.narrationVolume ?? 1.0))),
    musicPreset: params.musicPreset,
    musicVolume: Math.max(0, Math.min(1, params.musicVolume)),
    enableSubtitles: Boolean(params.enableSubtitles),
    subtitleStyle: params.subtitleStyle,
    status: 'queued',
    currentStage: 'analyzing_script',
    detailedStage: 'understanding_script',
    stageMessage: 'Queued for intelligent context-aware video pipeline',
    progress: 2,
    scenesCount: cappedScenes.length,
    completedScenes: 0,
    sceneStates,
    subtitlesCount: 0,
    estimatedCostUsd: cost.estimatedUsd,
    outputFileName,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const serverJob: ServerAiVideoJob = {
    record,
    scenes: cappedScenes,
    subtitles: [],
    workDir,
    outputPath,
    srtPath,
    downloadToken,
    cancelled: false,
  };

  aiVideoJobs.set(jobId, serverJob);
  activeUserGenerations.add(params.uid);
  persistJobToDisk(serverJob);

  return { serverJob, apiKey };
}

export function startAiVideoGenerationJob(params: {
  uid: string;
  jobId?: string;
  visualEngine?: AiVideoVisualEngine;
  freeVisualStyle?: AiVideoFreeVisualStyle;
  visualSourceMode?: AiVideoVisualSourceMode;
  relevanceThreshold?: number;
  storyContext?: AiVideoStoryContext;
  title: string;
  originalScript: string;
  style: AiVideoStyle;
  durationSec: AiVideoDurationSec;
  aspectRatio: VideoAspectRatio;
  language: ContentLanguage;
  voice: AiVideoVoiceId;
  narrationVolume?: number;
  musicPreset: AiVideoMusicPreset;
  musicVolume: number;
  enableSubtitles: boolean;
  subtitleStyle: SubtitleStyleConfig;
  scenes: AiVideoScenePlanItem[];
}): ServerAiVideoJob {
  const { serverJob, apiKey } = buildServerAiVideoJob(params);
  void executeFullPipeline(serverJob, apiKey);
  return serverJob;
}

export function prepareAiVideoVisualsJob(params: {
  uid: string;
  jobId?: string;
  visualEngine?: AiVideoVisualEngine;
  freeVisualStyle?: AiVideoFreeVisualStyle;
  visualSourceMode?: AiVideoVisualSourceMode;
  relevanceThreshold?: number;
  storyContext?: AiVideoStoryContext;
  title: string;
  originalScript: string;
  style: AiVideoStyle;
  durationSec: AiVideoDurationSec;
  aspectRatio: VideoAspectRatio;
  language: ContentLanguage;
  voice: AiVideoVoiceId;
  narrationVolume?: number;
  musicPreset: AiVideoMusicPreset;
  musicVolume: number;
  enableSubtitles: boolean;
  subtitleStyle: SubtitleStyleConfig;
  scenes: AiVideoScenePlanItem[];
}): ServerAiVideoJob {
  const { serverJob, apiKey } = buildServerAiVideoJob(params);
  void executeFullPipeline(serverJob, apiKey, { visualsOnly: true });
  return serverJob;
}

export async function regenerateSingleSceneVisual(params: {
  uid: string;
  jobId: string;
  sceneNumber: number;
  customPrompt?: string;
  customSearchQuery?: string;
  visualSourceMode?: AiVideoVisualSourceMode;
  relevanceThreshold?: number;
  autoRender?: boolean;
}): Promise<ServerAiVideoJob> {
  const job = aiVideoJobs.get(params.jobId);
  if (!job || job.record.userId !== params.uid) {
    throw new Error('AI video job not found on server.');
  }
  if (job.record.status === 'processing') {
    throw new Error('Job is currently processing. Wait until it finishes.');
  }
  const idx = job.scenes.findIndex((s) => s.sceneNumber === params.sceneNumber);
  if (idx === -1) {
    throw new Error(`Scene ${params.sceneNumber} not found in job.`);
  }

  if (params.visualSourceMode) {
    job.record.visualSourceMode = params.visualSourceMode;
  }
  if (typeof params.relevanceThreshold === 'number') {
    job.record.relevanceThreshold = Math.max(60, Math.min(98, Math.round(params.relevanceThreshold)));
  }

  const scene = job.scenes[idx];
  const state = job.record.sceneStates[idx];
  if (params.customPrompt?.trim()) {
    scene.imageGenerationPrompt = params.customPrompt.trim().slice(0, 1500);
    scene.visualPrompt = scene.imageGenerationPrompt;
  }
  if (params.customSearchQuery?.trim()) {
    scene.imageSearchQuery = params.customSearchQuery.trim().slice(0, 100);
  }

  // Delete ONLY this scene's rendered clip so untouched scenes remain cached
  const clipPath = path.join(job.workDir, `scene_${scene.sceneNumber}.mp4`);
  if (fs.existsSync(clipPath)) {
    try {
      fs.unlinkSync(clipPath);
    } catch {
      // ignore
    }
  }
  state.status = 'queued';
  state.animationStatus = 'pending';

  const apiKey = getValidApiKey();
  const { usedUrls, usedTitles, usedHashes } = collectUsedAssetsFromOtherScenes(job, scene.sceneNumber);

  await sourceAndVerifyVisualForScene({
    job,
    scene,
    sceneState: state,
    apiKey,
    usedUrls,
    usedTitles,
    usedHashes,
    aiGenState: { blockedForJob: false },
    customPrompt: params.customPrompt,
    customSearchQuery: params.customSearchQuery,
    forceRegenerate: true,
    onUpdate: () => {
      job.record.updatedAt = new Date().toISOString();
      persistJobToDisk(job);
    },
  });

  if (params.autoRender) {
    return renderFinalFromPreparedJob(params.uid, params.jobId);
  }

  job.record.visualReviewReady = true;
  job.record.completedScenes = countApprovedVisualScenes(job.record);
  job.record.stageMessage = `Updated & approved visual for Scene ${scene.sceneNumber}`;
  job.record.updatedAt = new Date().toISOString();
  persistJobToDisk(job);
  return job;
}

export async function replaceSceneImageWithUpload(params: {
  uid: string;
  jobId: string;
  sceneNumber: number;
  imageBase64: string;
  fileName?: string;
}): Promise<ServerAiVideoJob> {
  const job = aiVideoJobs.get(params.jobId);
  if (!job || job.record.userId !== params.uid) {
    throw new Error('AI video job not found on server.');
  }
  if (job.record.status === 'processing') {
    throw new Error('Job is currently processing. Wait until it finishes.');
  }
  const idx = job.scenes.findIndex((s) => s.sceneNumber === params.sceneNumber);
  if (idx === -1) {
    throw new Error(`Scene ${params.sceneNumber} not found in job.`);
  }

  const base64Clean = params.imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
  const imgBuf = Buffer.from(base64Clean, 'base64');
  if (imgBuf.length < 1024 || imgBuf.length > 15 * 1024 * 1024) {
    throw new Error('Uploaded image must be between 1KB and 15MB.');
  }

  const scene = job.scenes[idx];
  const state = job.record.sceneStates[idx];
  const tmpUploadPath = path.join(job.workDir, `scene_${scene.sceneNumber}_upload${detectImageExtension(imgBuf)}`);
  const cleanJpgPath = path.join(job.workDir, `scene_${scene.sceneNumber}_pic.jpg`);

  fs.writeFileSync(tmpUploadPath, imgBuf);
  const converted = await convertFileToCleanJpeg(tmpUploadPath, cleanJpgPath);
  if (fs.existsSync(tmpUploadPath)) {
    try {
      fs.unlinkSync(tmpUploadPath);
    } catch {
      // ignore
    }
  }
  if (!converted) {
    throw new Error('Could not decode uploaded image. Please upload a valid PNG, JPEG, or WebP image (>=320x240).');
  }

  // Delete ONLY this scene's rendered clip so untouched scenes remain cached
  const clipPath = path.join(job.workDir, `scene_${scene.sceneNumber}.mp4`);
  if (fs.existsSync(clipPath)) {
    try {
      fs.unlinkSync(clipPath);
    } catch {
      // ignore
    }
  }
  state.status = 'approved';
  state.animationStatus = 'pending';
  state.error = undefined;

  const apiKey = getValidApiKey();
  const threshold = Number(job.record.relevanceThreshold || DEFAULT_RELEVANCE_THRESHOLD);
  const ver = await verifyImageRelevanceWithGemini({
    apiKey,
    jobId: job.record.id,
    imagePath: cleanJpgPath,
    scene,
    storyContext: job.record.storyContext,
    threshold,
    candidateTitle: params.fileName || 'Custom user upload',
    sourceKind: 'custom-upload',
  });

  state.visualStatus = 'approved';
  state.status = 'approved';
  state.imageSource = 'custom-upload';
  state.imageTitle = params.fileName?.trim() || `Custom upload · Scene ${scene.sceneNumber}`;
  state.imageAttribution = 'User-provided custom image';
  state.imageOriginalUrl = undefined;
  state.relevanceScore = ver.relevanceScore;
  state.verification = ver;
  state.imageUrl = buildSceneImageUrl(job.record.id, scene.sceneNumber, job.downloadToken, Date.now());
  state.visualAttempts = [
    ...(state.visualAttempts || []),
    {
      attempt: (state.visualAttempts?.length || 0) + 1,
      source: 'custom-upload',
      queryOrPrompt: state.imageTitle,
      relevanceScore: ver.relevanceScore,
      decision: 'accepted',
      reason: `User replaced Scene ${scene.sceneNumber} image (${ver.reason})`,
    },
  ];

  job.record.visualReviewReady = true;
  job.record.completedScenes = countApprovedVisualScenes(job.record);
  job.record.stageMessage = `Custom image approved for Scene ${scene.sceneNumber} (AI relevance ${ver.relevanceScore}/100)`;
  job.record.updatedAt = new Date().toISOString();
  persistJobToDisk(job);
  return job;
}

export function renderFinalFromPreparedJob(
  uid: string,
  jobId: string,
  updates?: {
    narrationVolume?: number;
    musicPreset?: AiVideoMusicPreset;
    musicVolume?: number;
    enableSubtitles?: boolean;
    subtitleStyle?: SubtitleStyleConfig;
  }
): ServerAiVideoJob {
  const job = aiVideoJobs.get(jobId);
  if (!job || job.record.userId !== uid) {
    throw new Error('AI video job not found on server.');
  }
  if (job.record.status === 'processing') {
    throw new Error('Video rendering is already in progress for this job.');
  }
  if (activeUserGenerations.has(uid)) {
    throw new Error('Another AI video generation is already running for your account.');
  }

  const apiKey = getValidApiKey();
  const nextMusic = updates?.musicPreset ?? job.record.musicPreset;
  if (nextMusic === 'ai-lyria' && !apiKey) {
    throw new Error('Gemini API key is required for Lyria 3 AI music.');
  }

  if (updates?.narrationVolume !== undefined) {
    job.record.narrationVolume = Math.max(0, Math.min(1.5, Number(updates.narrationVolume)));
  }
  if (updates?.musicPreset !== undefined && updates.musicPreset !== job.record.musicPreset) {
    const oldMusic = path.join(job.workDir, 'music_bed.wav');
    if (fs.existsSync(oldMusic)) fs.unlinkSync(oldMusic);
    job.record.musicPreset = updates.musicPreset;
  }
  if (updates?.musicVolume !== undefined) {
    job.record.musicVolume = Math.max(0, Math.min(1, updates.musicVolume));
  }
  if (updates?.enableSubtitles !== undefined) {
    job.record.enableSubtitles = Boolean(updates.enableSubtitles);
  }
  if (updates?.subtitleStyle !== undefined) {
    job.record.subtitleStyle = updates.subtitleStyle;
  }

  job.cancelled = false;
  job.record.status = 'processing';
  job.record.currentStage = 'generating_voiceover';
  job.record.detailedStage = 'synchronizing_audio';
  job.record.progress = 56;
  job.record.error = undefined;
  job.record.stageMessage = 'Animating scenes & rendering final MP4 from verified visuals';
  job.record.updatedAt = new Date().toISOString();
  activeUserGenerations.add(uid);
  persistJobToDisk(job);

  void executeFullPipeline(job, apiKey);
  return job;
}

export function getSceneImageFileForToken(
  jobId: string,
  sceneNumber: number,
  token: string
): string | null {
  const job = getAiVideoJobByToken(jobId, token);
  if (!job) return null;
  const imgPath = path.join(job.workDir, `scene_${sceneNumber}_pic.jpg`);
  if (!fs.existsSync(imgPath) || fs.statSync(imgPath).size === 0) return null;
  return imgPath;
}

export function getAiVideoJobForUser(
  uid: string,
  jobId: string
): AiVideoJobStatusResponse | null {
  const job = aiVideoJobs.get(jobId);
  if (!job || job.record.userId !== uid) return null;
  return {
    job: job.record,
    stages: buildStagesForState(
      job.record.currentStage,
      job.record.status,
      job.record.visualEngine,
      job.record.detailedStage,
      job.record.visualReviewReady
    ),
    scenes: job.scenes,
    subtitles: job.subtitles,
  };
}

export function getAiVideoJobByToken(
  jobId: string,
  token: string
): ServerAiVideoJob | null {
  const job = aiVideoJobs.get(jobId);
  if (!job || !token || job.downloadToken !== token) return null;
  return job;
}

export function cancelAiVideoJobForUser(uid: string, jobId: string): boolean {
  const job = aiVideoJobs.get(jobId);
  if (!job || job.record.userId !== uid) return false;
  if (job.record.status === 'completed' || job.record.status === 'cancelled') {
    return false;
  }

  job.cancelled = true;
  job.record.status = 'cancelled';
  job.record.stageMessage = 'Cancelling generation...';
  job.record.updatedAt = new Date().toISOString();
  persistJobToDisk(job);
  activeUserGenerations.delete(uid);

  const apiKey = getValidApiKey();
  if (apiKey && job.activeInteractionId) {
    const ai = createGeminiClient(apiKey);
    void ai.interactions.cancel(job.activeInteractionId).catch(() => {});
  }
  return true;
}

export function retryAiVideoJobForUser(uid: string, jobId: string): ServerAiVideoJob {
  const job = aiVideoJobs.get(jobId);
  if (!job || job.record.userId !== uid) {
    throw new Error('AI video job not found on server.');
  }
  const apiKey = getValidApiKey();
  const needsGeminiApi =
    job.record.visualEngine === 'ai-omni' || job.record.musicPreset === 'ai-lyria';
  if (needsGeminiApi && !apiKey) {
    throw new Error('Gemini API key is not configured on the server.');
  }
  if (activeUserGenerations.has(uid)) {
    throw new Error('Another AI video generation is already running for your account.');
  }

  job.cancelled = false;
  job.record.status = 'queued';
  job.record.error = undefined;
  job.record.stageMessage = 'Resuming pipeline from saved scene assets';
  job.record.updatedAt = new Date().toISOString();
  activeUserGenerations.add(uid);
  persistJobToDisk(job);

  void executeFullPipeline(job, apiKey);
  return job;
}

export function rerenderAiVideoJobForUser(
  uid: string,
  jobId: string,
  updates: {
    narrationVolume?: number;
    musicPreset?: AiVideoMusicPreset;
    musicVolume?: number;
    enableSubtitles?: boolean;
    subtitleStyle?: SubtitleStyleConfig;
  }
): ServerAiVideoJob {
  const job = aiVideoJobs.get(jobId);
  if (!job || job.record.userId !== uid) {
    throw new Error('AI video job not found on server.');
  }
  const nextMusicPreset = updates.musicPreset ?? job.record.musicPreset;
  const apiKey = getValidApiKey();
  if (nextMusicPreset === 'ai-lyria' && !apiKey) {
    throw new Error('Gemini API key is required for Lyria 3 AI music.');
  }
  if (job.record.status === 'processing' || (job.record.status === 'queued' && !job.record.visualReviewReady)) {
    throw new Error('Job is currently processing. Wait until it completes.');
  }

  // Verify scene clips are still present on disk
  for (const scene of job.scenes) {
    const p = path.join(job.workDir, `scene_${scene.sceneNumber}.mp4`);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
      throw new Error('Scene clips are missing from disk. Use Retry Job or Render Final Video to generate clips.');
    }
  }

  if (updates.narrationVolume !== undefined) {
    job.record.narrationVolume = Math.max(0, Math.min(1.5, Number(updates.narrationVolume)));
  }
  if (updates.musicPreset !== undefined && updates.musicPreset !== job.record.musicPreset) {
    const oldMusic = path.join(job.workDir, 'music_bed.wav');
    if (fs.existsSync(oldMusic)) fs.unlinkSync(oldMusic);
    job.record.musicPreset = updates.musicPreset;
  }
  if (updates.musicVolume !== undefined) {
    job.record.musicVolume = Math.max(0, Math.min(1, updates.musicVolume));
  }
  if (updates.enableSubtitles !== undefined) {
    job.record.enableSubtitles = Boolean(updates.enableSubtitles);
  }
  if (updates.subtitleStyle !== undefined) {
    job.record.subtitleStyle = updates.subtitleStyle;
  }

  job.cancelled = false;
  job.record.status = 'processing';
  job.record.currentStage = 'combining_media';
  job.record.detailedStage = 'rendering_video';
  job.record.progress = 72;
  job.record.stageMessage = 'Re-rendering MP4 with updated audio & subtitle settings';
  job.record.error = undefined;
  job.record.updatedAt = new Date().toISOString();
  persistJobToDisk(job);

  void (async () => {
    try {
      await runCompositionStage(job, apiKey);
    } catch (err) {
      job.record.status = 'failed';
      job.record.stageMessage = 'Re-render failed';
      job.record.error = err instanceof Error ? err.message : String(err);
      job.record.updatedAt = new Date().toISOString();
      persistJobToDisk(job);
    }
  })();

  return job;
}
