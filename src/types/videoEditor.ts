import type { ContentLanguage } from './creator';

export type VideoAspectRatio = '9:16' | '1:1' | '16:9';

export type SubtitlePosition = 'bottom' | 'middle' | 'top';

export interface SubtitleStyleConfig {
  fontFamily: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  backgroundColor: string;
  position: SubtitlePosition;
  uppercase: boolean;
}

export interface VideoSubtitleCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface VideoHighlightProposal {
  id: string;
  title: string;
  reason: string;
  hook: string;
  startSec: number;
  endSec: number;
  recommendedAspectRatio: VideoAspectRatio;
  transcriptExcerpt: string;
}

export interface UploadedVideoMetadata {
  uploadId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  codec: string;
  hasAudio: boolean;
}

export interface VideoRenderJob {
  id: string;
  userId?: string;
  uploadId?: string;
  sourceFileName: string;
  sourceDurationSec: number;
  sourceWidth: number;
  sourceHeight: number;
  clipTitle: string;
  startSec: number;
  endSec: number;
  aspectRatio: VideoAspectRatio;
  language: ContentLanguage;
  subtitleStyle: SubtitleStyleConfig;
  subtitlesCount: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  stageMessage: string;
  outputFileName?: string;
  downloadUrl?: string;
  storageUrl?: string;
  storagePath?: string;
  outputBytes?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleConfig = {
  fontFamily: 'DejaVu Sans',
  fontSize: 44,
  primaryColor: '#FFFFFF',
  outlineColor: '#0F172A',
  backgroundColor: '#0F172A',
  position: 'bottom',
  uppercase: false,
};
