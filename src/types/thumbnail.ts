export type ThumbnailAspectRatio = '16:9' | '9:16' | '1:1';

export type ThumbnailStylePreset =
  | 'bold-creator'
  | 'editorial-minimal'
  | 'tech-dark'
  | 'split-comparison'
  | 'stat-spotlight';

export type ThumbnailLayoutType =
  | 'split-left'
  | 'center-spotlight'
  | 'bottom-editorial'
  | 'stat-grid';

export interface ThumbnailPalette {
  background: string;
  surface: string;
  accent: string;
  text: string;
  mutedText: string;
}

export interface ThumbnailConcept {
  id: string;
  conceptTitle: string;
  headline: string;
  kicker: string;
  statCallout: string;
  layout: ThumbnailLayoutType;
  palette: ThumbnailPalette;
  ctrRationale: string;
  visualPromptNote: string;
}

export interface ThumbnailAsset {
  id: string;
  userId?: string;
  title: string;
  headline: string;
  kicker: string;
  statCallout?: string;
  aspectRatio: ThumbnailAspectRatio;
  stylePreset: ThumbnailStylePreset;
  layout: ThumbnailLayoutType;
  palette: ThumbnailPalette;
  storageUrl: string;
  storagePath: string;
  projectId?: string;
  ctrRationale?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ThumbnailStudioDraftSeed {
  title: string;
  topic: string;
  hook?: string;
  aspectRatio?: ThumbnailAspectRatio;
  projectId?: string;
}
