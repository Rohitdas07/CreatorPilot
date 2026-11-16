import { auth } from '../firebase.js';
import type { ContentLanguage } from '../types/creator';
import type {
  SubtitleStyleConfig,
  UploadedVideoMetadata,
  VideoAspectRatio,
  VideoHighlightProposal,
  VideoSubtitleCue,
} from '../types/videoEditor';

async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to process videos.');
  }
  return user.getIdToken();
}

export async function uploadVideoFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<UploadedVideoMetadata> {
  const token = await getAuthToken();

  return new Promise<UploadedVideoMetadata>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/video/upload', true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-file-type', file.type || 'video/mp4');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0 && onProgress) {
        onProgress(Math.min(98, Math.round((evt.loaded / evt.total) * 100)));
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}') as {
          video?: UploadedVideoMetadata;
          error?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300 && parsed.video) {
          onProgress?.(100);
          resolve(parsed.video);
        } else {
          reject(new Error(parsed.error || `Upload failed (HTTP ${xhr.status}).`));
        }
      } catch {
        reject(new Error(`Upload failed (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading video file.'));
    };

    xhr.send(file);
  });
}

export async function analyzeVideoHighlights(params: {
  uploadId: string;
  language: ContentLanguage;
  focusPrompt?: string;
}): Promise<{
  summary: string;
  clips: VideoHighlightProposal[];
  subtitles: VideoSubtitleCue[];
}> {
  const token = await getAuthToken();
  const res = await fetch('/api/video/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  const payload = (await res.json().catch(() => null)) as {
    summary?: string;
    clips?: VideoHighlightProposal[];
    subtitles?: VideoSubtitleCue[];
    error?: string;
  } | null;

  if (!res.ok || !payload?.clips) {
    throw new Error(payload?.error || `Video analysis failed (HTTP ${res.status}).`);
  }

  return {
    summary: payload.summary || '',
    clips: payload.clips,
    subtitles: payload.subtitles || [],
  };
}

export async function startVideoRenderJob(params: {
  jobId: string;
  uploadId: string;
  clipTitle: string;
  startSec: number;
  endSec: number;
  aspectRatio: VideoAspectRatio;
  subtitles: VideoSubtitleCue[];
  subtitleStyle: SubtitleStyleConfig;
}): Promise<{
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  stageMessage: string;
  outputFileName: string;
  downloadUrl: string;
}> {
  const token = await getAuthToken();
  const res = await fetch('/api/video/render', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  const payload = (await res.json().catch(() => null)) as {
    job?: {
      jobId: string;
      status: 'queued' | 'processing' | 'completed' | 'failed';
      progress: number;
      stageMessage: string;
      outputFileName: string;
      downloadUrl: string;
    };
    error?: string;
  } | null;

  if (!res.ok || !payload?.job) {
    throw new Error(payload?.error || `Failed to start FFmpeg render (HTTP ${res.status}).`);
  }

  return payload.job;
}

export async function pollVideoRenderJob(jobId: string): Promise<{
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  stageMessage: string;
  outputFileName?: string;
  outputBytes?: number;
  error?: string;
  downloadUrl?: string;
}> {
  const token = await getAuthToken();
  const res = await fetch(`/api/video/jobs/${encodeURIComponent(jobId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = (await res.json().catch(() => null)) as {
    jobId?: string;
    status?: 'queued' | 'processing' | 'completed' | 'failed';
    progress?: number;
    stageMessage?: string;
    outputFileName?: string;
    outputBytes?: number;
    error?: string;
    downloadUrl?: string;
  } | null;

  if (!res.ok || !payload?.jobId) {
    throw new Error((payload as { error?: string } | null)?.error || 'Could not query video job status.');
  }

  return {
    jobId: payload.jobId,
    status: payload.status || 'processing',
    progress: Number(payload.progress ?? 0),
    stageMessage: payload.stageMessage || '',
    outputFileName: payload.outputFileName,
    outputBytes: payload.outputBytes,
    error: payload.error,
    downloadUrl: payload.downloadUrl,
  };
}

export async function fetchRenderedVideoBlob(downloadUrl: string): Promise<Blob> {
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Could not fetch rendered MP4 file (HTTP ${res.status}).`);
  }
  return res.blob();
}
