export type NavSection =
  | 'dashboard'
  | 'create'
  | 'ai-video'
  | 'video-editor'
  | 'thumbnails'
  | 'calendar'
  | 'analytics'
  | 'brand-kit'
  | 'projects'
  | 'history'
  | 'settings'
  | 'profile';

export type Platform = 'Instagram' | 'YouTube' | 'Facebook' | 'LinkedIn';

export type Tone =
  | 'Professional'
  | 'Funny'
  | 'Educational'
  | 'Inspirational'
  | 'Casual';

export type VideoDuration = '15 sec' | '30 sec' | '60 sec';

export type InputMode = 'paste' | 'video' | 'audio' | 'text';

export type ContentLanguage =
  | 'English'
  | 'Hindi'
  | 'Bengali'
  | 'Spanish'
  | 'French'
  | 'German'
  | 'Portuguese'
  | 'Japanese';

export interface UploadedMediaInfo {
  name: string;
  size: number;
  type: string;
  kind: 'video' | 'audio' | 'text';
  durationLabel?: string;
  base64Data?: string;
}

export interface GenerationConfig {
  sourceText: string;
  platform: Platform;
  language: ContentLanguage;
  tone: Tone;
  duration: VideoDuration;
  niche?: string;
  brandVoice?: string;
  mediaName?: string;
  mediaInfo?: UploadedMediaInfo | null;
}

export interface ContentAnalysis {
  summary: string;
  coreTopic: string;
  targetAudience: string;
  keyTakeaways: string[];
  detectedLanguage?: string;
}

export interface InstagramReelResult {
  title: string;
  hook: string;
  script: string;
  cta: string;
}

export interface YouTubeShortsResult {
  title: string;
  script: string;
  description: string;
  cta: string;
}

export interface InstagramCaptionResult {
  caption: string;
}

export interface HashtagResult {
  relevant: string[];
  trending: string[];
}

export interface PlatformPostsResult {
  instagram: string;
  youtubeCommunity: string;
  linkedin: string;
  facebook: string;
}

export interface QualityDimensionScore {
  score: number;
  rationale: string;
}

export type QualityFixTarget =
  | 'hook'
  | 'reelScript'
  | 'shortsScript'
  | 'caption'
  | 'cta';

export interface ContentQualityImprovement {
  id: string;
  targetSection: QualityFixTarget;
  issue: string;
  recommendation: string;
  suggestedFix: string;
}

export interface ContentReadabilityMetrics {
  wordCount: number;
  estimatedSpeakingSeconds: number;
  hookCharCount: number;
  hashtagCount: number;
  captionLineCount: number;
}

export interface ContentQualityScore {
  overallScore: number;
  gradeLabel: 'Publication Ready' | 'Strong Draft' | 'Needs Refinement';
  summary: string;
  dimensions: {
    hookStrength: QualityDimensionScore;
    platformFit: QualityDimensionScore;
    clarityAndStructure: QualityDimensionScore;
    ctaEffectiveness: QualityDimensionScore;
    brandVoiceAlignment: QualityDimensionScore;
  };
  strengths: string[];
  improvements: ContentQualityImprovement[];
  readability: ContentReadabilityMetrics;
  evaluatedAt: string;
  model: string;
}

export interface GeneratedContent {
  analysis?: ContentAnalysis;
  hooks?: string[];
  instagramReel: InstagramReelResult;
  youtubeShorts: YouTubeShortsResult;
  instagramCaption: InstagramCaptionResult;
  hashtags: HashtagResult;
  platformPosts: PlatformPostsResult;
  qualityScore?: ContentQualityScore;
  engine: 'gemini' | 'demo' | 'template';
  model?: string;
  generatedAt?: string;
}

export interface CreatorProject {
  id: string;
  userId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  config: GenerationConfig;
  result: GeneratedContent;
}

export interface HistoryItem {
  id: string;
  userId?: string;
  projectId?: string;
  createdAt: string;
  sourcePreview: string;
  config: GenerationConfig;
  result: GeneratedContent;
}

export interface CreatorStats {
  totalGenerated: number;
  reelsCreated: number;
  shortsCreated: number;
  captionsGenerated: number;
}

export interface CreatorSettings {
  creatorName: string;
  brandHandle: string;
  niche: string;
  brandVoice: string;
  defaultPlatform: Platform;
  defaultLanguage: ContentLanguage;
  defaultTone: Tone;
  defaultDuration: VideoDuration;
  exportFormat: 'markdown' | 'txt' | 'json';
}

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  variant: 'success' | 'info' | 'error';
}

export interface WorkspaceNotification {
  id: string;
  title: string;
  description?: string;
  variant: 'success' | 'info' | 'error';
  createdAt: string;
  read: boolean;
}

export interface NotificationPreferences {
  inAppToasts: boolean;
  assistantAlerts: boolean;
  socialPublishAlerts: boolean;
}

