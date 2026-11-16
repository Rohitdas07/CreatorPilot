import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContentLanguage } from '../src/types/creator.ts';
import type {
  SubtitleStyleConfig,
  UploadedVideoMetadata,
  VideoAspectRatio,
  VideoHighlightProposal,
  VideoSubtitleCue,
} from '../src/types/videoEditor.ts';
import { VALID_LANGUAGES } from '../src/utils/contentValidation.ts';
import { generateGeminiContentWithFallback } from './geminiModelHelper.ts';

const WORKSPACE_DIR = path.join(os.tmpdir(), 'creatorpilot-video-studio');
const WORKER_SCRIPT_PATH = path.resolve(process.cwd(), 'server', 'videoWorker.py');

fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

export interface StoredUploadedVideo extends UploadedVideoMetadata {
  uid: string;
  filePath: string;
  createdAt: string;
}

export interface ServerVideoRenderJob {
  jobId: string;
  uid: string;
  uploadId: string;
  clipTitle: string;
  startSec: number;
  endSec: number;
  aspectRatio: VideoAspectRatio;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  stageMessage: string;
  outputFileName: string;
  outputPath: string;
  outputBytes?: number;
  downloadToken: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const uploadedVideos = new Map<string, StoredUploadedVideo>();
const renderJobs = new Map<string, ServerVideoRenderJob>();
const jobQueue: string[] = [];
let activeWorkersCount = 0;
const MAX_CONCURRENT_WORKERS = 2;

function getValidApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  return key;
}

export function getVideoUploadDir(): string {
  return WORKSPACE_DIR;
}

export function getStoredVideo(
  uid: string,
  uploadId: string
): StoredUploadedVideo | null {
  const entry = uploadedVideos.get(uploadId);
  if (!entry || entry.uid !== uid) return null;
  if (!fs.existsSync(entry.filePath)) return null;
  return entry;
}

export function getRenderJobForUser(
  uid: string,
  jobId: string
): ServerVideoRenderJob | null {
  const job = renderJobs.get(jobId);
  if (!job || job.uid !== uid) return null;
  return job;
}

export function getRenderJobByDownloadToken(
  jobId: string,
  token: string
): ServerVideoRenderJob | null {
  const job = renderJobs.get(jobId);
  if (!job || !token || job.downloadToken !== token) return null;
  return job;
}

function runPythonWorkerOnce(args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [WORKER_SCRIPT_PATH, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to launch Python FFmpeg worker: ${err.message}`));
    });

    child.on('close', (code) => {
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

export async function registerUploadedVideo(params: {
  uid: string;
  fileName: string;
  mimeType: string;
  filePath: string;
  sizeBytes: number;
}): Promise<StoredUploadedVideo> {
  const uploadId = `vid-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const result = await runPythonWorkerOnce(['probe', params.filePath]);
  const meta = (result.metadata || {}) as {
    durationSec?: number;
    width?: number;
    height?: number;
    codec?: string;
    hasAudio?: boolean;
  };

  const entry: StoredUploadedVideo = {
    uploadId,
    uid: params.uid,
    fileName: params.fileName,
    mimeType: params.mimeType || 'video/mp4',
    filePath: params.filePath,
    sizeBytes: params.sizeBytes,
    durationSec: Number(meta.durationSec || 0),
    width: Number(meta.width || 1920),
    height: Number(meta.height || 1080),
    codec: String(meta.codec || 'unknown'),
    hasAudio: Boolean(meta.hasAudio),
    createdAt: new Date().toISOString(),
  };

  uploadedVideos.set(uploadId, entry);
  return entry;
}

const VIDEO_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Concise 2-sentence overview of the uploaded video narrative.',
    },
    clips: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          reason: {
            type: Type.STRING,
            description: 'Why this moment is a strong standalone highlight.',
          },
          hook: { type: Type.STRING },
          startSec: { type: Type.NUMBER },
          endSec: { type: Type.NUMBER },
          recommendedAspectRatio: { type: Type.STRING },
          transcriptExcerpt: { type: Type.STRING },
        },
        required: [
          'title',
          'reason',
          'hook',
          'startSec',
          'endSec',
          'recommendedAspectRatio',
          'transcriptExcerpt',
        ],
      },
    },
    subtitles: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          startSec: { type: Type.NUMBER },
          endSec: { type: Type.NUMBER },
          text: { type: Type.STRING },
        },
        required: ['startSec', 'endSec', 'text'],
      },
    },
  },
  required: ['summary', 'clips', 'subtitles'],
};

function buildLanguagePrompt(language: ContentLanguage): string {
  if (language === 'Hindi') {
    return 'Write all clip titles, hooks, summaries, and synchronized subtitles in natural Hindi (Devanagari script हिन्दी).';
  }
  if (language === 'Bengali') {
    return 'Write all clip titles, hooks, summaries, and synchronized subtitles in fluent Bengali (বাংলা script).';
  }
  return `Write all clip titles, hooks, summaries, and synchronized subtitles in ${language}.`;
}

export async function analyzeUploadedVideoWithGemini(params: {
  video: StoredUploadedVideo;
  language: ContentLanguage;
  focusPrompt?: string;
}): Promise<{
  summary: string;
  clips: VideoHighlightProposal[];
  subtitles: VideoSubtitleCue[];
}> {
  const apiKey = getValidApiKey();
  if (!apiKey) {
    throw new Error(
      'Gemini API key is not configured on the server. Set GEMINI_API_KEY in Settings > Secrets.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'creatorpilot-ai-build',
      },
    },
  });

  const cleanLanguage: ContentLanguage = VALID_LANGUAGES.includes(params.language)
    ? params.language
    : 'English';
  const totalDur = Math.max(1, params.video.durationSec || 30);

  // Use extracted compact audio track for larger videos, or direct inline media if small
  let inlineMime = params.video.mimeType || 'video/mp4';
  let mediaBuffer: Buffer | null = null;
  let tempAudioPath: string | null = null;

  try {
    if (params.video.sizeBytes <= 12 * 1024 * 1024) {
      mediaBuffer = fs.readFileSync(params.video.filePath);
    } else if (params.video.hasAudio) {
      tempAudioPath = path.join(
        WORKSPACE_DIR,
        `audio-${params.video.uploadId}-${Date.now()}.mp3`
      );
      const audioRes = await runPythonWorkerOnce([
        'extract-audio',
        params.video.filePath,
        tempAudioPath,
      ]);
      if (audioRes.hasAudio && fs.existsSync(tempAudioPath)) {
        mediaBuffer = fs.readFileSync(tempAudioPath);
        inlineMime = 'audio/mpeg';
      }
    }

    const promptText = `You are a senior short-form video editor analyzing a real uploaded video.

Uploaded Video Telemetry:
- File Name: ${params.video.fileName}
- Exact Duration: ${totalDur.toFixed(2)} seconds
- Resolution: ${params.video.width}x${params.video.height}
- Has Audio Track: ${params.video.hasAudio ? 'Yes' : 'No'}
- Output Language: ${cleanLanguage}
${params.focusPrompt?.trim() ? `- Creator Focus Instructions: ${params.focusPrompt.trim()}` : ''}

Instructions:
1. ${buildLanguagePrompt(cleanLanguage)}
2. Extract 2 to 4 high-impact highlight clip proposals that fit strictly within [0, ${totalDur.toFixed(2)}] seconds (each clip at least 2 seconds long, endSec > startSec, endSec <= ${totalDur.toFixed(2)}).
3. Produce synchronized subtitle cues covering the spoken dialogue/narrative across [0, ${totalDur.toFixed(2)}] seconds so subtitles align accurately with the timeline.
4. Recommend aspect ratio ('9:16', '1:1', or '16:9') per highlight.`;

    const contents = mediaBuffer
      ? {
          parts: [
            {
              inlineData: {
                mimeType: inlineMime,
                data: mediaBuffer.toString('base64'),
              },
            },
            { text: promptText },
          ],
        }
      : promptText;

    const { response } = await generateGeminiContentWithFallback({
      ai,
      label: 'Video Editor highlight analysis',
      primaryTimeoutMs: 22000,
      fallbackTimeoutMs: 35000,
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: VIDEO_ANALYSIS_SCHEMA,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      summary?: string;
      clips?: Array<Record<string, unknown>>;
      subtitles?: Array<Record<string, unknown>>;
    };

    const clips: VideoHighlightProposal[] = (parsed.clips || [])
      .slice(0, 6)
      .map((c, idx) => {
        const rawStart = Math.max(0, Math.min(totalDur - 1, Number(c.startSec || 0)));
        const rawEnd = Math.min(
          totalDur,
          Math.max(rawStart + 1, Number(c.endSec || Math.min(totalDur, rawStart + 15)))
        );
        const ratio =
          c.recommendedAspectRatio === '1:1' || c.recommendedAspectRatio === '16:9'
            ? c.recommendedAspectRatio
            : '9:16';

        return {
          id: `clip-${idx + 1}-${crypto.randomBytes(2).toString('hex')}`,
          title: String(c.title || `Highlight ${idx + 1}`).slice(0, 120),
          reason: String(c.reason || 'High engagement moment').slice(0, 260),
          hook: String(c.hook || '').slice(0, 240),
          startSec: Number(rawStart.toFixed(2)),
          endSec: Number(rawEnd.toFixed(2)),
          recommendedAspectRatio: ratio,
          transcriptExcerpt: String(c.transcriptExcerpt || '').slice(0, 500),
        };
      });

    if (clips.length === 0) {
      clips.push({
        id: `clip-1-${crypto.randomBytes(2).toString('hex')}`,
        title: 'Primary Highlight Clip',
        reason: 'Opening segment of uploaded video',
        hook: 'Watch how this unfolds',
        startSec: 0,
        endSec: Number(Math.min(totalDur, 30).toFixed(2)),
        recommendedAspectRatio: '9:16',
        transcriptExcerpt: String(parsed.summary || ''),
      });
    }

    const subtitles: VideoSubtitleCue[] = (parsed.subtitles || [])
      .map((s, idx) => {
        const sStart = Math.max(0, Math.min(totalDur - 0.2, Number(s.startSec || 0)));
        const sEnd = Math.min(
          totalDur,
          Math.max(sStart + 0.4, Number(s.endSec || sStart + 2))
        );
        return {
          id: `sub-${idx + 1}`,
          startSec: Number(sStart.toFixed(2)),
          endSec: Number(sEnd.toFixed(2)),
          text: String(s.text || '').trim().slice(0, 240),
        };
      })
      .filter((s) => s.text.length > 0)
      .sort((a, b) => a.startSec - b.startSec);

    return {
      summary: String(parsed.summary || 'Video analyzed for short-form highlights.'),
      clips,
      subtitles,
    };
  } finally {
    if (tempAudioPath && fs.existsSync(tempAudioPath)) {
      fs.unlink(tempAudioPath, () => {});
    }
  }
}

function processQueue(): void {
  while (activeWorkersCount < MAX_CONCURRENT_WORKERS && jobQueue.length > 0) {
    const nextJobId = jobQueue.shift();
    if (!nextJobId) break;
    const job = renderJobs.get(nextJobId);
    if (!job) continue;
    activeWorkersCount += 1;
    void executeWorkerJob(job).finally(() => {
      activeWorkersCount = Math.max(0, activeWorkersCount - 1);
      processQueue();
    });
  }
}

async function executeWorkerJob(job: ServerVideoRenderJob): Promise<void> {
  const video = getStoredVideo(job.uid, job.uploadId);
  if (!video) {
    job.status = 'failed';
    job.stageMessage = 'Source video is no longer available on server.';
    job.error = 'UPLOAD_NOT_FOUND';
    job.updatedAt = new Date().toISOString();
    return;
  }

  job.status = 'processing';
  job.progress = 3;
  job.stageMessage = 'Starting Python FFmpeg background worker';
  job.updatedAt = new Date().toISOString();

  const jobWorkDir = path.join(WORKSPACE_DIR, `job-${job.jobId}`);
  fs.mkdirSync(jobWorkDir, { recursive: true });
  const configPath = path.join(jobWorkDir, 'render-config.json');
  const assPath = path.join(jobWorkDir, 'subtitles.ass');

  const metaPayload = (job as ServerVideoRenderJob & {
    _renderPayload?: {
      subtitles: VideoSubtitleCue[];
      subtitleStyle: SubtitleStyleConfig;
    };
  })._renderPayload;

  fs.writeFileSync(
    configPath,
    JSON.stringify({
      inputPath: video.filePath,
      outputPath: job.outputPath,
      assPath,
      startSec: job.startSec,
      endSec: job.endSec,
      aspectRatio: job.aspectRatio,
      subtitles: metaPayload?.subtitles || [],
      subtitleStyle: metaPayload?.subtitleStyle || {},
    })
  );

  await new Promise<void>((resolve) => {
    const child = spawn('python3', [WORKER_SCRIPT_PATH, 'render', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrBuf = '';
    let buffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as {
            type?: string;
            progress?: number;
            stage?: string;
            bytes?: number;
            error?: string;
          };
          if (msg.type === 'progress') {
            job.progress = Number(msg.progress ?? job.progress);
            job.stageMessage = String(msg.stage || job.stageMessage);
            job.updatedAt = new Date().toISOString();
          } else if (msg.type === 'done') {
            job.status = 'completed';
            job.progress = 100;
            job.stageMessage = String(msg.stage || 'MP4 render completed');
            job.outputBytes = Number(msg.bytes || 0);
            job.updatedAt = new Date().toISOString();
          } else if (msg.type === 'error') {
            job.status = 'failed';
            job.error = String(msg.error || 'FFmpeg worker error');
            job.stageMessage = 'Render failed';
            job.updatedAt = new Date().toISOString();
          }
        } catch {
          // ignore non-json stdout lines
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      job.status = 'failed';
      job.error = `Worker spawn error: ${err.message}`;
      job.stageMessage = 'Failed to start FFmpeg worker';
      job.updatedAt = new Date().toISOString();
      resolve();
    });

    child.on('close', (code) => {
      if (job.status !== 'completed') {
        if (
          code === 0 &&
          fs.existsSync(job.outputPath) &&
          fs.statSync(job.outputPath).size > 0
        ) {
          job.status = 'completed';
          job.progress = 100;
          job.stageMessage = 'MP4 render verified and ready';
          job.outputBytes = fs.statSync(job.outputPath).size;
        } else {
          job.status = 'failed';
          job.error =
            job.error ||
            stderrBuf.trim().slice(-500) ||
            `Worker exited with status ${code}`;
          job.stageMessage = 'Render failed';
        }
        job.updatedAt = new Date().toISOString();
      }
      resolve();
    });
  });
}

export function enqueueVideoRenderJob(params: {
  uid: string;
  jobId?: string;
  video: StoredUploadedVideo;
  clipTitle: string;
  startSec: number;
  endSec: number;
  aspectRatio: VideoAspectRatio;
  subtitles: VideoSubtitleCue[];
  subtitleStyle: SubtitleStyleConfig;
}): ServerVideoRenderJob {
  const jobId =
    params.jobId && /^[a-zA-Z0-9_\-]+$/.test(params.jobId)
      ? params.jobId
      : `vjob-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  const slug =
    params.clipTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 48) || 'clip';

  const ratioTag = params.aspectRatio.replace(':', 'x');
  const outputFileName = `${slug}-${ratioTag}-${jobId.slice(-6)}.mp4`;
  const outputPath = path.join(WORKSPACE_DIR, outputFileName);
  const downloadToken = crypto.randomBytes(16).toString('hex');
  const nowIso = new Date().toISOString();

  const job: ServerVideoRenderJob & {
    _renderPayload?: {
      subtitles: VideoSubtitleCue[];
      subtitleStyle: SubtitleStyleConfig;
    };
  } = {
    jobId,
    uid: params.uid,
    uploadId: params.video.uploadId,
    clipTitle: params.clipTitle.slice(0, 160),
    startSec: Math.max(0, params.startSec),
    endSec: Math.max(params.startSec + 0.5, params.endSec),
    aspectRatio: params.aspectRatio,
    status: 'queued',
    progress: 0,
    stageMessage: 'Queued for background FFmpeg worker',
    outputFileName,
    outputPath,
    downloadToken,
    createdAt: nowIso,
    updatedAt: nowIso,
    _renderPayload: {
      subtitles: params.subtitles,
      subtitleStyle: params.subtitleStyle,
    },
  };

  renderJobs.set(jobId, job);
  jobQueue.push(jobId);
  processQueue();
  return job;
}
