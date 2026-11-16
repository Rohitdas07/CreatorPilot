import type { ContentLanguage } from './creator';
import type { SubtitleStyleConfig, VideoAspectRatio, VideoSubtitleCue } from './videoEditor';

export type AiVideoStyle =
  | 'cinematic'
  | 'documentary'
  | 'modern-tech'
  | 'minimalist'
  | 'energetic-social'
  | 'storytelling';

export type AiVideoDurationSec = 15 | 30 | 60 | 90;

export type AiVideoVoiceId = 'none' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export type AiVideoMusicPreset =
  | 'none'
  | 'ambient-uplift'
  | 'tech-pulse'
  | 'cinematic-score'
  | 'lofi-chill'
  | 'ai-lyria';

export type AiVideoTransitionType = 'cut' | 'fade' | 'slideleft' | 'dissolve';

export type AiVideoVisualEngine = 'ai-omni' | 'free-motion';

export type AiVideoFreeVisualStyle = 'topic-pictures' | 'animated-motion';

export type AiVideoPipelineStage =
  | 'analyzing_script'
  | 'creating_scene_plan'
  | 'generating_clips'
  | 'generating_voiceover'
  | 'creating_subtitles'
  | 'combining_media'
  | 'exporting_mp4';

export type AiVideoDetailedStageId =
  | 'understanding_script'
  | 'planning_scenes'
  | 'generating_visuals'
  | 'verifying_relevance'
  | 'animating_scenes'
  | 'synchronizing_audio'
  | 'rendering_video';

export type AiVideoJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AiVideoVisualSourceMode =
  | 'ai-then-retrieve'
  | 'retrieve-only'
  | 'ai-only';

export type AiVideoVisualSourceKind =
  | 'ai-generated'
  | 'wikimedia'
  | 'wikipedia'
  | 'openverse'
  | 'nasa'
  | 'custom-upload'
  | 'context-fallback';

export type AiVideoScriptGenre =
  | 'educational'
  | 'historical'
  | 'documentary'
  | 'storytelling'
  | 'entertainment'
  | 'motivational'
  | 'informational'
  | 'fictional';

export interface AiVideoStoryCharacter {
  name: string;
  role: string;
  visualAppearance: string;
}

export interface AiVideoStoryLocation {
  name: string;
  visualDetails: string;
}

export interface AiVideoStoryContext {
  mainTopic: string;
  genre: AiVideoScriptGenre;
  summary: string;
  characters: AiVideoStoryCharacter[];
  locations: AiVideoStoryLocation[];
  keyObjects: string[];
  timelineOrEra: string;
  moodAndTone: string;
  visualConsistencyGuide: string;
}

export interface AiVideoScenePlanItem {
  sceneNumber: number;
  duration: number;
  narration: string;
  summary?: string;
  mainSubject?: string;
  secondarySubjects?: string[];
  action?: string;
  location?: string;
  timePeriod?: string;
  emotionalTone?: string;
  visualDescription: string;
  imageSearchQuery?: string;
  imageGenerationPrompt?: string;
  visualPrompt: string;
  cameraMovement: string;
  animationInstructions?: string;
  visualStyle: string;
  subtitle: string;
  transitionType: AiVideoTransitionType;
}

export interface AiVideoScenePlan {
  title: string;
  totalDuration: number;
  originalScript: string;
  storyContext?: AiVideoStoryContext;
  scenes: AiVideoScenePlanItem[];
}

export interface AiVideoImageVerificationResult {
  isRelevant: boolean;
  relevanceScore: number;
  subjectMatch: number;
  actionMatch: number;
  contextMatch: number;
  contradictions?: string;
  reason: string;
  decision: 'accept' | 'reject';
  refinedSearchQuery?: string;
  refinedImagePrompt?: string;
  modelUsed?: string;
  verifiedAt?: string;
}

export interface AiVideoSceneVisualAttempt {
  attempt: number;
  source: AiVideoVisualSourceKind;
  queryOrPrompt: string;
  candidateUrl?: string;
  title?: string;
  relevanceScore?: number;
  decision: 'accepted' | 'rejected' | 'error';
  reason: string;
}

export interface AiVideoSceneClipState {
  sceneNumber: number;
  duration: number;
  status: 'queued' | 'approved' | 'generating' | 'retrying' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  clipDurationSec?: number;
  audioDurationSec?: number;
  interactionId?: string;
  error?: string;
  visualStatus?: 'pending' | 'sourcing' | 'verifying' | 'approved' | 'verified' | 'fallback' | 'failed';
  imageUrl?: string;
  imageSource?: AiVideoVisualSourceKind;
  imageTitle?: string;
  imageAttribution?: string;
  imageOriginalUrl?: string;
  imagePromptUsed?: string;
  searchQueryUsed?: string;
  relevanceScore?: number;
  verification?: AiVideoImageVerificationResult;
  animationStatus?: 'pending' | 'animating' | 'completed' | 'failed';
  animationStyle?: string;
  visualAttempts?: AiVideoSceneVisualAttempt[];
}

export interface AiVideoCostEstimate {
  visualEngine: AiVideoVisualEngine;
  sceneCount: number;
  totalDurationSec: number;
  videoModel: string;
  ttsModel: string;
  musicModel: string | null;
  estimatedUsd: number;
  breakdown: {
    scenePlanningUsd: number;
    videoGenerationUsd: number;
    voiceoverUsd: number;
    musicUsd: number;
  };
  limits: {
    maxScenes: number;
    maxDurationSec: number;
    clipDurationRangeSec: [number, number];
  };
  notes: string[];
}

export interface AiVideoStageStep {
  id: AiVideoPipelineStage | AiVideoDetailedStageId;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
  detail?: string;
}

export interface AiVideoJobRecord {
  id: string;
  userId?: string;
  visualEngine?: AiVideoVisualEngine;
  freeVisualStyle?: AiVideoFreeVisualStyle;
  visualSourceMode?: AiVideoVisualSourceMode;
  relevanceThreshold?: number;
  visualReviewReady?: boolean;
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
  status: AiVideoJobStatus;
  currentStage: AiVideoPipelineStage;
  detailedStage?: AiVideoDetailedStageId;
  stageMessage: string;
  progress: number;
  scenesCount: number;
  completedScenes: number;
  sceneStates: AiVideoSceneClipState[];
  subtitlesCount: number;
  estimatedCostUsd: number;
  outputFileName?: string;
  outputWidth?: number;
  outputHeight?: number;
  actualDurationSec?: number;
  outputBytes?: number;
  downloadUrl?: string;
  srtDownloadUrl?: string;
  storageUrl?: string;
  storagePath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiVideoJobStatusResponse {
  job: AiVideoJobRecord;
  stages: AiVideoStageStep[];
  scenes: AiVideoScenePlanItem[];
  subtitles: VideoSubtitleCue[];
}

export const MAX_AI_VIDEO_SCENES = 12;
export const MAX_AI_VIDEO_DURATION_SEC = 90;

export const AI_VIDEO_DURATIONS: AiVideoDurationSec[] = [15, 30, 60, 90];

export const AI_VIDEO_STYLES: Array<{
  id: AiVideoStyle;
  label: string;
  description: string;
}> = [
  {
    id: 'cinematic',
    label: 'Cinematic Film',
    description: 'Rich lighting, shallow depth of field, smooth dolly & drone motion',
  },
  {
    id: 'modern-tech',
    label: 'Modern Tech',
    description: 'Clean sleek studio lighting, crisp architectural visuals, high contrast',
  },
  {
    id: 'documentary',
    label: 'Documentary',
    description: 'Authentic observational framing, natural light, grounded realism',
  },
  {
    id: 'minimalist',
    label: 'Editorial Minimal',
    description: 'Calm balanced compositions, soft natural tones, clean negative space',
  },
  {
    id: 'energetic-social',
    label: 'High-Energy Social',
    description: 'Dynamic punchy angles, vibrant color palette, fast visual hooks',
  },
  {
    id: 'storytelling',
    label: 'Visual Storytelling',
    description: 'Warm expressive atmosphere, golden hour lighting, narrative pacing',
  },
];

export const AI_VIDEO_VOICES: Array<{
  id: AiVideoVoiceId;
  label: string;
  tone: string;
  styleDirection: string;
}> = [
  {
    id: 'Kore',
    label: 'Kore',
    tone: 'Clear & Authoritative',
    styleDirection: 'Clear, engaging, confident studio narrator',
  },
  {
    id: 'Puck',
    label: 'Puck',
    tone: 'Upbeat & Conversational',
    styleDirection: 'Energetic, bright, dynamic social creator',
  },
  {
    id: 'Charon',
    label: 'Charon',
    tone: 'Deep & Cinematic',
    styleDirection: 'Grounded, resonant documentary storyteller',
  },
  {
    id: 'Fenrir',
    label: 'Fenrir',
    tone: 'Warm & Expressive',
    styleDirection: 'Passionate, expressive modern explainer',
  },
  {
    id: 'Zephyr',
    label: 'Zephyr',
    tone: 'Calm & Refined',
    styleDirection: 'Smooth, articulate minimalist narrator',
  },
  {
    id: 'none',
    label: 'No Voiceover (100% Offline)',
    tone: 'Music & Subtitles Only',
    styleDirection: 'Silent voice track with local background music and synchronized captions',
  },
];

export const AI_VIDEO_MUSIC_PRESETS: Array<{
  id: AiVideoMusicPreset;
  label: string;
  description: string;
  usesPaidAi: boolean;
}> = [
  {
    id: 'ambient-uplift',
    label: 'Ambient Uplift (Royalty-Free)',
    description: 'Warm evolving pad chords suited for creator explainers',
    usesPaidAi: false,
  },
  {
    id: 'tech-pulse',
    label: 'Tech Pulse (Royalty-Free)',
    description: 'Clean rhythmic synth pulse for AI, SaaS & product videos',
    usesPaidAi: false,
  },
  {
    id: 'cinematic-score',
    label: 'Cinematic Horizon (Royalty-Free)',
    description: 'Wide atmospheric sustain for storytelling & documentary pacing',
    usesPaidAi: false,
  },
  {
    id: 'lofi-chill',
    label: 'Lo-Fi Studio (Royalty-Free)',
    description: 'Mellow warm keys & subtle texture for educational content',
    usesPaidAi: false,
  },
  {
    id: 'ai-lyria',
    label: 'AI Custom Score (Lyria 3)',
    description: 'Custom instrumental track generated dynamically via Google Lyria 3',
    usesPaidAi: true,
  },
  {
    id: 'none',
    label: 'No Background Music',
    description: 'Voiceover narration only',
    usesPaidAi: false,
  },
];

export const DEFAULT_RELEVANCE_THRESHOLD = 80;

export const AI_VIDEO_PIPELINE_STAGES: Array<{
  id: AiVideoPipelineStage;
  label: string;
}> = [
  { id: 'analyzing_script', label: 'Analyzing script' },
  { id: 'creating_scene_plan', label: 'Creating scene plan' },
  { id: 'generating_clips', label: 'Generating AI video clips' },
  { id: 'generating_voiceover', label: 'Generating voiceover' },
  { id: 'creating_subtitles', label: 'Creating subtitles' },
  { id: 'combining_media', label: 'Combining video and audio' },
  { id: 'exporting_mp4', label: 'Exporting final MP4' },
];

export const AI_VIDEO_DETAILED_STAGES: Array<{
  id: AiVideoDetailedStageId;
  label: string;
}> = [
  { id: 'understanding_script', label: 'Understanding script' },
  { id: 'planning_scenes', label: 'Planning scenes' },
  { id: 'generating_visuals', label: 'Generating visuals' },
  { id: 'verifying_relevance', label: 'Verifying image relevance' },
  { id: 'animating_scenes', label: 'Animating scenes' },
  { id: 'synchronizing_audio', label: 'Synchronizing audio' },
  { id: 'rendering_video', label: 'Rendering final video' },
];

export const LANGUAGE_TO_BCP47: Record<ContentLanguage, string> = {
  English: 'en-US',
  Hindi: 'hi-IN',
  Bengali: 'bn-IN',
  Spanish: 'es-ES',
  French: 'fr-FR',
  German: 'de-DE',
  Portuguese: 'pt-BR',
  Japanese: 'ja-JP',
};
