import type { ContentAnalysis, ContentLanguage } from './creator';

export type AssistantMessageRole = 'user' | 'assistant' | 'system';

export interface AssistantMessage {
  id: string;
  userId?: string;
  conversationId: string;
  role: AssistantMessageRole;
  content: string;
  taskId?: string;
  createdAt: string;
}

export interface AssistantConversation {
  id: string;
  userId?: string;
  title: string;
  projectId?: string;
  projectTitle?: string;
  mediaName?: string;
  createdAt: string;
  updatedAt: string;
}

export type AssistantStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AssistantPipelineStep {
  id: string;
  label: string;
  detail: string;
  status: AssistantStepStatus;
  updatedAt?: string;
}

export interface ClipProposal {
  id: string;
  platform: 'Instagram Reel' | 'YouTube Short';
  title: string;
  startTime: string;
  endTime: string;
  duration: string;
  hook: string;
  script: string;
  visualCue: string;
  caption: string;
  hashtags: string[];
  cta: string;
}

export interface SubtitleCue {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
}

export interface VideoProcessingJob {
  id: string;
  clipId: string;
  clipTitle: string;
  platform: 'Instagram Reel' | 'YouTube Short';
  aspectRatio: string;
  startTime: string;
  endTime: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  subtitleTrackIncluded: boolean;
  outputSpec: string;
}

export interface AssistantTaskOutputs {
  analysis: ContentAnalysis;
  clips: ClipProposal[];
  hashtags: {
    relevant: string[];
    trending: string[];
  };
  subtitlesSrt: string;
  subtitleCues: SubtitleCue[];
  videoJobs: VideoProcessingJob[];
}

export type AssistantTaskStatus = 'queued' | 'running' | 'completed' | 'failed';
export type AssistantApprovalStatus = 'pending_approval' | 'approved' | 'published';

export interface AssistantTask {
  id: string;
  userId?: string;
  conversationId: string;
  jobId: string;
  instruction: string;
  projectId?: string;
  projectTitle?: string;
  mediaName?: string;
  language: ContentLanguage;
  status: AssistantTaskStatus;
  confirmedByBackend: boolean;
  approvalStatus: AssistantApprovalStatus;
  approvedAt?: string;
  publishedAt?: string;
  error?: string;
  steps: AssistantPipelineStep[];
  outputs?: AssistantTaskOutputs;
  createdAt: string;
  updatedAt: string;
}
