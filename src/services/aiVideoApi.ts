import { auth } from '../firebase.js';
import type { ContentLanguage } from '../types/creator';
import type { SubtitleStyleConfig, VideoAspectRatio } from '../types/videoEditor';
import type {
  AiVideoCostEstimate,
  AiVideoDurationSec,
  AiVideoFreeVisualStyle,
  AiVideoJobStatusResponse,
  AiVideoMusicPreset,
  AiVideoScenePlan,
  AiVideoScenePlanItem,
  AiVideoStoryContext,
  AiVideoStyle,
  AiVideoVisualEngine,
  AiVideoVisualSourceMode,
  AiVideoVoiceId,
} from '../types/aiVideo';
import { uploadRenderedVideoBlob, type StorageUploadResult } from './storageService';

async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to generate AI videos.');
  }
  return user.getIdToken();
}

async function requestAiVideoJson<T extends { error?: string }>(
  url: string,
  init: RequestInit,
  fallbackError: (status: number) => string,
  validate?: (payload: T) => boolean
): Promise<T> {
  const maxAttempts = 4;
  let lastStatus = 0;
  let sawWarmupHtml = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (networkErr) {
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw new Error(
        networkErr instanceof Error && networkErr.message
          ? `Network error contacting video server: ${networkErr.message}`
          : 'Network error contacting video server. Please try again.'
      );
    }

    lastStatus = res.status;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const rawText = await res.text().catch(() => '');
    const trimmed = rawText.trim();
    const looksLikeHtml =
      contentType.includes('text/html') ||
      trimmed.startsWith('<!') ||
      trimmed.toLowerCase().startsWith('<html');

    if (looksLikeHtml || res.status === 502 || res.status === 503 || res.status === 504) {
      sawWarmupHtml = sawWarmupHtml || looksLikeHtml;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw new Error(
        'The video backend server was restarting or warming up. Please wait a few seconds and try again.'
      );
    }

    let payload: T | null = null;
    if (trimmed) {
      try {
        payload = JSON.parse(trimmed) as T;
      } catch {
        payload = null;
      }
    }

    if (!res.ok || !payload || (validate && !validate(payload))) {
      throw new Error(payload?.error || fallbackError(res.status));
    }

    return payload;
  }

  if (sawWarmupHtml) {
    throw new Error(
      'The video backend server was warming up. Please wait a few seconds and try again.'
    );
  }
  throw new Error(fallbackError(lastStatus || 503));
}

export interface AiVideoConfigResponse {
  geminiConfigured: boolean;
  limits: {
    maxScenes: number;
    maxDurationSec: number;
  };
  durations: AiVideoDurationSec[];
}

export async function fetchAiVideoConfig(): Promise<AiVideoConfigResponse> {
  const token = await getAuthToken();
  return requestAiVideoJson<AiVideoConfigResponse & { error?: string }>(
    '/api/ai-video/config',
    { headers: { Authorization: `Bearer ${token}` } },
    (status) => `Failed to load AI Video configuration (HTTP ${status}).`
  );
}

export async function generateScriptFromIdeaApi(params: {
  idea: string;
  durationSec: AiVideoDurationSec;
  style: AiVideoStyle;
  language: ContentLanguage;
}): Promise<{ title: string; script: string }> {
  const token = await getAuthToken();
  const payload = await requestAiVideoJson<{
    title?: string;
    script?: string;
    error?: string;
  }>(
    '/api/ai-video/script-from-idea',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Could not generate script from idea (HTTP ${status}).`,
    (p) => Boolean(p.script)
  );

  return {
    title: payload.title || 'AI Video Script',
    script: payload.script!,
  };
}

export async function planAiVideoScenesApi(params: {
  script: string;
  style: AiVideoStyle;
  durationSec: AiVideoDurationSec;
  aspectRatio: VideoAspectRatio;
  language: ContentLanguage;
  title?: string;
  musicPreset: AiVideoMusicPreset;
  visualEngine?: AiVideoVisualEngine;
}): Promise<{
  plan: AiVideoScenePlan;
  costEstimate: AiVideoCostEstimate;
  planningMode?: 'gemini' | 'local-fallback';
  planningNote?: string;
}> {
  const token = await getAuthToken();
  const payload = await requestAiVideoJson<{
    plan?: AiVideoScenePlan;
    costEstimate?: AiVideoCostEstimate;
    planningMode?: 'gemini' | 'local-fallback';
    planningNote?: string;
    error?: string;
  }>(
    '/api/ai-video/plan',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Scene planning failed (HTTP ${status}).`,
    (p) => Boolean(p.plan && p.costEstimate)
  );

  return {
    plan: payload.plan!,
    costEstimate: payload.costEstimate!,
    ...(payload.planningMode ? { planningMode: payload.planningMode } : {}),
    ...(payload.planningNote ? { planningNote: payload.planningNote } : {}),
  };
}

export async function estimateAiVideoCostApi(params: {
  sceneCount: number;
  totalDurationSec: number;
  musicPreset: AiVideoMusicPreset;
  visualEngine?: AiVideoVisualEngine;
  voice?: AiVideoVoiceId;
}): Promise<AiVideoCostEstimate> {
  const token = await getAuthToken();
  const payload = await requestAiVideoJson<{
    costEstimate?: AiVideoCostEstimate;
    error?: string;
  }>(
    '/api/ai-video/estimate',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Cost estimation failed (HTTP ${status}).`,
    (p) => Boolean(p.costEstimate)
  );
  return payload.costEstimate!;
}

export async function previewAiVideoVoiceApi(params: {
  voice: AiVideoVoiceId;
  language: ContentLanguage;
  sampleText?: string;
  visualEngine?: AiVideoVisualEngine;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const token = await getAuthToken();
  const payload = await requestAiVideoJson<{
    audioBase64?: string;
    mimeType?: string;
    error?: string;
  }>(
    '/api/ai-video/voice-preview',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Voice preview failed (HTTP ${status}).`,
    (p) => Boolean(p.audioBase64)
  );

  return {
    audioBase64: payload.audioBase64!,
    mimeType: payload.mimeType || 'audio/wav',
  };
}

export async function previewAiVideoMusicApi(params: {
  preset: AiVideoMusicPreset;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const token = await getAuthToken();
  const payload = await requestAiVideoJson<{
    audioBase64?: string;
    mimeType?: string;
    error?: string;
  }>(
    '/api/ai-video/music-preview',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Music preview failed (HTTP ${status}).`,
    (p) => Boolean(p.audioBase64)
  );

  return {
    audioBase64: payload.audioBase64!,
    mimeType: payload.mimeType || 'audio/wav',
  };
}

export interface StartAiVideoPayload {
  jobId: string;
  confirmedByUser?: boolean;
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
}

export async function prepareAiVideoVisualsApi(
  params: StartAiVideoPayload
): Promise<AiVideoJobStatusResponse> {
  const token = await getAuthToken();
  return requestAiVideoJson<AiVideoJobStatusResponse & { error?: string }>(
    '/api/ai-video/prepare-visuals',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Failed to prepare scene visuals (HTTP ${status}).`,
    (p) => Boolean(p.job)
  );
}

export async function startAiVideoGenerationApi(
  params: StartAiVideoPayload & { confirmedByUser: boolean }
): Promise<AiVideoJobStatusResponse> {
  const token = await getAuthToken();
  return requestAiVideoJson<AiVideoJobStatusResponse & { error?: string }>(
    '/api/ai-video/generate',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Failed to start AI video generation (HTTP ${status}).`,
    (p) => Boolean(p.job)
  );
}

export async function regenerateSceneVisualApi(
  jobId: string,
  sceneNumber: number,
  params: {
    customPrompt?: string;
    customSearchQuery?: string;
    visualSourceMode?: AiVideoVisualSourceMode;
    relevanceThreshold?: number;
    autoRender?: boolean;
  }
): Promise<AiVideoJobStatusResponse> {
  const token = await getAuthToken();
  return requestAiVideoJson<AiVideoJobStatusResponse & { error?: string }>(
    `/api/ai-video/jobs/${encodeURIComponent(jobId)}/scenes/${sceneNumber}/regenerate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Failed to regenerate scene visual (HTTP ${status}).`,
    (p) => Boolean(p.job)
  );
}

export async function replaceSceneImageApi(
  jobId: string,
  sceneNumber: number,
  params: {
    imageBase64: string;
    fileName?: string;
  }
): Promise<AiVideoJobStatusResponse> {
  const token = await getAuthToken();
  return requestAiVideoJson<AiVideoJobStatusResponse & { error?: string }>(
    `/api/ai-video/jobs/${encodeURIComponent(jobId)}/scenes/${sceneNumber}/replace-image`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Failed to replace scene image (HTTP ${status}).`,
    (p) => Boolean(p.job)
  );
}

export async function renderFinalFromPreparedApi(
  jobId: string,
  params?: {
    narrationVolume?: number;
    musicPreset?: AiVideoMusicPreset;
    musicVolume?: number;
    enableSubtitles?: boolean;
    subtitleStyle?: SubtitleStyleConfig;
  }
): Promise<AiVideoJobStatusResponse> {
  const token = await getAuthToken();
  return requestAiVideoJson<AiVideoJobStatusResponse & { error?: string }>(
    `/api/ai-video/jobs/${encodeURIComponent(jobId)}/render-final`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params || {}),
    },
    (status) => `Failed to render final video (HTTP ${status}).`,
    (p) => Boolean(p.job)
  );
}

export async function pollAiVideoJobApi(jobId: string): Promise<AiVideoJobStatusResponse> {
  const token = await getAuthToken();
  return requestAiVideoJson<AiVideoJobStatusResponse & { error?: string }>(
    `/api/ai-video/jobs/${encodeURIComponent(jobId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
    (status) => `Could not query AI video job status (HTTP ${status}).`,
    (p) => Boolean(p.job)
  );
}

export async function cancelAiVideoJobApi(jobId: string): Promise<{ cancelled: boolean }> {
  const token = await getAuthToken();
  const payload = await requestAiVideoJson<{
    cancelled?: boolean;
    error?: string;
  }>(
    `/api/ai-video/jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
    (status) => `Failed to cancel job (HTTP ${status}).`
  );
  return { cancelled: Boolean(payload.cancelled) };
}

export async function retryAiVideoJobApi(jobId: string): Promise<AiVideoJobStatusResponse> {
  const token = await getAuthToken();
  return requestAiVideoJson<AiVideoJobStatusResponse & { error?: string }>(
    `/api/ai-video/jobs/${encodeURIComponent(jobId)}/retry`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    },
    (status) => `Failed to retry AI video job (HTTP ${status}).`,
    (p) => Boolean(p.job)
  );
}

export async function rerenderAiVideoJobApi(
  jobId: string,
  params: {
    narrationVolume?: number;
    musicPreset?: AiVideoMusicPreset;
    musicVolume?: number;
    enableSubtitles?: boolean;
    subtitleStyle?: SubtitleStyleConfig;
  }
): Promise<AiVideoJobStatusResponse> {
  const token = await getAuthToken();
  return requestAiVideoJson<AiVideoJobStatusResponse & { error?: string }>(
    `/api/ai-video/jobs/${encodeURIComponent(jobId)}/render`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    },
    (status) => `Failed to re-render AI video (HTTP ${status}).`,
    (p) => Boolean(p.job)
  );
}

export async function fetchAiVideoMp4Blob(downloadUrl: string): Promise<Blob> {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Could not fetch generated MP4 file (HTTP ${res.status}).`);
  }
  return res.blob();
}

export async function uploadAiVideoToStorage(
  userId: string,
  jobId: string,
  fileName: string,
  downloadUrl: string,
  onProgress?: (pct: number) => void
): Promise<StorageUploadResult> {
  const blob = await fetchAiVideoMp4Blob(downloadUrl);
  return uploadRenderedVideoBlob(userId, jobId, fileName, blob, onProgress);
}
