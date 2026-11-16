export type SocialPlatform = 'instagram' | 'youtube' | 'linkedin' | 'facebook';

export type SocialConnectionStatus =
  | 'connected'
  | 'expired'
  | 'needs_reauth'
  | 'disconnected'
  | 'not_configured';

export type SocialMediaType = 'none' | 'image' | 'video' | 'link';
export type YouTubePrivacyStatus = 'private' | 'unlisted' | 'public';
export type SocialApprovalStatus = 'pending_approval' | 'approved';
export type SocialPostStatus =
  | 'draft'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed';

export interface SocialPlatformRequirementInfo {
  platform: SocialPlatform;
  displayName: string;
  apiName: string;
  oauthConfigured: boolean;
  missingEnvVars: string[];
  redirectUri: string;
  requiredScopes: string[];
  portalUrl: string;
  approvalNotes: string;
  publishingRequirements: string[];
  analyticsNotes: string;
  supportsTextOnly: boolean;
  requiresPublicMediaUrl: boolean;
  maxCaptionLength: number;
}

export interface SocialConnectionSummary {
  id: SocialPlatform;
  userId?: string;
  platform: SocialPlatform;
  status: SocialConnectionStatus;
  accountName?: string;
  accountHandle?: string;
  externalAccountId?: string;
  scopes?: string[];
  tokenExpiresAt?: string;
  lastCheckedAt?: string;
  lastError?: string;
  connectedAt?: string;
  updatedAt: string;
}

export interface SocialPostAnalytics {
  supported: boolean;
  views?: number;
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  fetchedAt: string;
  note?: string;
}

export interface SocialPost {
  id: string;
  userId?: string;
  platform: SocialPlatform;
  title?: string;
  caption: string;
  hashtags?: string[];
  mediaUrl?: string;
  mediaType: SocialMediaType;
  youtubePrivacy?: YouTubePrivacyStatus;
  projectId?: string;
  approvalStatus: SocialApprovalStatus;
  approvedAt?: string;
  status: SocialPostStatus;
  scheduledFor?: string;
  publishedAt?: string;
  externalPostId?: string;
  externalPostUrl?: string;
  error?: string;
  errorCode?: string;
  analytics?: SocialPostAnalytics;
  createdAt: string;
  updatedAt: string;
}

export interface SocialScheduledJobStatus {
  postId: string;
  uid: string;
  platform: SocialPlatform;
  title?: string;
  caption: string;
  hashtags?: string[];
  mediaUrl?: string;
  mediaType: SocialMediaType;
  youtubePrivacy?: YouTubePrivacyStatus;
  approvalStatus: 'approved';
  scheduledFor: string;
  status: 'scheduled' | 'publishing' | 'published' | 'failed';
  publishedAt?: string;
  externalPostId?: string;
  externalPostUrl?: string;
  error?: string;
  errorCode?: string;
  updatedAt: string;
}

export interface SocialStatusResponse {
  requirements: SocialPlatformRequirementInfo[];
  connections: SocialConnectionSummary[];
  scheduledJobs: SocialScheduledJobStatus[];
}

