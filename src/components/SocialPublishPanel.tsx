import { useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Edit3,
  ExternalLink,
  Facebook,
  Instagram,
  Linkedin,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert,
  Trash2,
  X,
  Youtube,
} from 'lucide-react';
import type { CreatorProject } from '../types/creator';
import type {
  SocialConnectionSummary,
  SocialMediaType,
  SocialPlatform,
  SocialPlatformRequirementInfo,
  SocialPost,
  YouTubePrivacyStatus,
} from '../types/social';

interface SocialPublishPanelProps {
  requirements: SocialPlatformRequirementInfo[];
  connections: SocialConnectionSummary[];
  posts: SocialPost[];
  projects: CreatorProject[];
  busyPostId: string | null;
  onStagePost: (draft: {
    platform: SocialPlatform;
    title?: string;
    caption: string;
    hashtags?: string[];
    mediaType: SocialMediaType;
    mediaUrl?: string;
    youtubePrivacy?: YouTubePrivacyStatus;
    projectId?: string;
  }) => Promise<void>;
  onUpdatePost: (
    postId: string,
    updates: {
      title?: string | null;
      caption?: string;
      hashtags?: string[] | null;
      mediaUrl?: string | null;
      mediaType?: SocialMediaType;
      youtubePrivacy?: YouTubePrivacyStatus | null;
    }
  ) => Promise<void>;
  onApprovePost: (post: SocialPost) => Promise<void>;
  onSchedulePost: (post: SocialPost, scheduledFor: string) => Promise<void>;
  onCancelSchedule: (post: SocialPost) => Promise<void>;
  onPublishNow: (post: SocialPost) => Promise<void>;
  onRefreshAnalytics: (post: SocialPost) => Promise<void>;
  onDeletePost: (postId: string) => Promise<void>;
  onOpenAccountSettings: () => void;
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram Professional',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  facebook: 'Facebook Pages',
};

const PLATFORM_ICONS: Record<SocialPlatform, typeof Instagram> = {
  instagram: Instagram,
  youtube: Youtube,
  linkedin: Linkedin,
  facebook: Facebook,
};

function getClientPlatformValidationIssues(
  platform: SocialPlatform,
  title: string,
  caption: string,
  mediaType: SocialMediaType,
  mediaUrl: string
): string[] {
  const issues: string[] = [];
  if (!caption.trim()) {
    issues.push('Caption / post copy cannot be empty.');
  }
  if (mediaUrl.trim() && !/^https:\/\/.+/i.test(mediaUrl.trim())) {
    issues.push('Media / link URL must start with https:// and be publicly reachable.');
  }
  if (platform === 'instagram') {
    if (caption.trim().length > 2200) {
      issues.push('Instagram captions are capped at 2,200 characters.');
    }
    if ((mediaType !== 'image' && mediaType !== 'video') || !mediaUrl.trim()) {
      issues.push(
        'Instagram Graph API requires a public HTTPS image or video URL (text-only posts are not supported).'
      );
    }
  }
  if (platform === 'youtube') {
    if (!title.trim()) {
      issues.push('YouTube uploads require a video title (max 100 chars).');
    } else if (title.trim().length > 100) {
      issues.push('YouTube video title cannot exceed 100 characters.');
    }
    if (mediaType !== 'video' || !mediaUrl.trim()) {
      issues.push(
        'YouTube Data API v3 requires a public HTTPS video URL (text-only Community posts are not supported via API).'
      );
    }
  }
  if (platform === 'linkedin' && caption.trim().length > 3000) {
    issues.push('LinkedIn commentary must be 3,000 characters or fewer.');
  }
  return issues;
}

function defaultScheduleDateTimeLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function getPostStatusBadge(status: SocialPost['status']) {
  switch (status) {
    case 'published':
      return {
        label: 'Published',
        classes: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      };
    case 'scheduled':
      return {
        label: 'Scheduled',
        classes: 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300',
      };
    case 'publishing':
      return {
        label: 'Publishing...',
        classes: 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300',
      };
    case 'failed':
      return {
        label: 'Failed',
        classes: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      };
    default:
      return {
        label: 'Draft',
        classes: 'border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)]',
      };
  }
}

export function SocialPublishPanel({
  requirements,
  connections,
  posts,
  projects,
  busyPostId,
  onStagePost,
  onUpdatePost,
  onApprovePost,
  onSchedulePost,
  onCancelSchedule,
  onPublishNow,
  onRefreshAnalytics,
  onDeletePost,
  onOpenAccountSettings,
}: SocialPublishPanelProps) {
  const [showComposer, setShowComposer] = useState(false);
  const [composePlatform, setComposePlatform] =
    useState<SocialPlatform>('linkedin');
  const [composeTitle, setComposeTitle] = useState('');
  const [composeCaption, setComposeCaption] = useState('');
  const [composeHashtags, setComposeHashtags] = useState('');
  const [composeMediaType, setComposeMediaType] =
    useState<SocialMediaType>('none');
  const [composeMediaUrl, setComposeMediaUrl] = useState('');
  const [composeYoutubePrivacy, setComposeYoutubePrivacy] =
    useState<YouTubePrivacyStatus>('private');
  const [composeProjectId, setComposeProjectId] = useState('');
  const [isStaging, setIsStaging] = useState(false);

  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string;
    caption: string;
    hashtags: string;
    mediaType: SocialMediaType;
    mediaUrl: string;
    youtubePrivacy: YouTubePrivacyStatus;
  } | null>(null);

  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>(
    {}
  );
  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);

  const composeIssues = getClientPlatformValidationIssues(
    composePlatform,
    composeTitle,
    composeCaption,
    composeMediaType,
    composeMediaUrl
  );
  const composeConn = connections.find((c) => c.platform === composePlatform);
  const composeReq = requirements.find((r) => r.platform === composePlatform);

  const handleStageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeCaption.trim()) return;
    setIsStaging(true);
    try {
      const parsedTags = composeHashtags
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith('#') ? t : `#${t}`))
        .slice(0, 30);

      await onStagePost({
        platform: composePlatform,
        ...(composeTitle.trim() ? { title: composeTitle.trim() } : {}),
        caption: composeCaption.trim(),
        ...(parsedTags.length > 0 ? { hashtags: parsedTags } : {}),
        mediaType: composeMediaType,
        ...(composeMediaUrl.trim() ? { mediaUrl: composeMediaUrl.trim() } : {}),
        ...(composePlatform === 'youtube'
          ? { youtubePrivacy: composeYoutubePrivacy }
          : {}),
        ...(composeProjectId ? { projectId: composeProjectId } : {}),
      });
      setComposeTitle('');
      setComposeCaption('');
      setComposeHashtags('');
      setComposeMediaUrl('');
      setShowComposer(false);
    } finally {
      setIsStaging(false);
    }
  };

  const startEditing = (post: SocialPost) => {
    setEditingPostId(post.id);
    setEditDraft({
      title: post.title || '',
      caption: post.caption,
      hashtags: (post.hashtags || []).join(' '),
      mediaType: post.mediaType,
      mediaUrl: post.mediaUrl || '',
      youtubePrivacy: post.youtubePrivacy || 'private',
    });
  };

  const saveEditing = async (post: SocialPost) => {
    if (!editDraft) return;
    const parsedTags = editDraft.hashtags
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .slice(0, 30);

    await onUpdatePost(post.id, {
      title: editDraft.title.trim() || null,
      caption: editDraft.caption.trim(),
      hashtags: parsedTags.length > 0 ? parsedTags : null,
      mediaType: editDraft.mediaType,
      mediaUrl: editDraft.mediaUrl.trim() || null,
      youtubePrivacy:
        post.platform === 'youtube' ? editDraft.youtubePrivacy : null,
    });
    setEditingPostId(null);
    setEditDraft(null);
  };

  return (
    <section
      aria-label="Social Media Publishing & Analytics"
      className="space-y-6 rounded-xl surface-card p-6"
    >
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-default)] pb-4 lg:flex-row lg:items-center">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
            Social Publishing, Scheduling &amp; Live Analytics
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Official API dispatch only — user approval is strictly enforced before any post can be scheduled or published.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowComposer((v) => !v)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{showComposer ? 'Close Composer' : 'Stage Social Post'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenAccountSettings}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Manage OAuth Accounts</span>
          </button>
        </div>
      </div>

      {/* Live Connection Status Bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(['instagram', 'youtube', 'linkedin', 'facebook'] as SocialPlatform[]).map(
          (platform) => {
            const Icon = PLATFORM_ICONS[platform];
            const conn = connections.find((c) => c.platform === platform);
            const req = requirements.find((r) => r.platform === platform);
            const status = conn?.status || (req?.oauthConfigured ? 'disconnected' : 'not_configured');
            const isReady = status === 'connected';
            return (
              <button
                key={platform}
                type="button"
                onClick={onOpenAccountSettings}
                className="flex items-center justify-between gap-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--border-strong)]"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                      {PLATFORM_LABELS[platform]}
                    </p>
                    <p className="truncate text-[11px] text-[var(--text-muted)]">
                      {conn?.accountName ||
                        (status === 'not_configured'
                          ? 'Missing OAuth env keys'
                          : 'Click to connect')}
                    </p>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${
                    isReady
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : status === 'expired' || status === 'needs_reauth'
                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                      : 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
                  }`}
                >
                  {isReady
                    ? 'Ready'
                    : status === 'not_configured'
                    ? 'Setup'
                    : status === 'expired'
                    ? 'Expired'
                    : 'Connect'}
                </span>
              </button>
            );
          }
        )}
      </div>

      {/* Stage Post Composer */}
      {showComposer && (
        <form
          onSubmit={handleStageSubmit}
          className="space-y-4 rounded-xl border border-violet-500/35 bg-[var(--bg-surface)] p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-[var(--text-primary)]">
              Stage Post Draft (Requires Approval Before Publish)
            </h3>
            {composeConn?.status !== 'connected' && (
              <span className="text-[11px] text-amber-700 dark:text-amber-300">
                {composeReq && !composeReq.oauthConfigured
                  ? `Missing server OAuth vars: ${composeReq.missingEnvVars.join(', ')}`
                  : 'Account not connected yet — you can stage a draft and connect in Settings before publishing.'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                Target Platform
              </label>
              <select
                value={composePlatform}
                onChange={(e) => {
                  const next = e.target.value as SocialPlatform;
                  setComposePlatform(next);
                  if (next === 'youtube') setComposeMediaType('video');
                  else if (next === 'instagram' && composeMediaType === 'none') {
                    setComposeMediaType('image');
                  }
                }}
                className="mt-1.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              >
                <option value="instagram">Instagram Professional</option>
                <option value="youtube">YouTube</option>
                <option value="linkedin">LinkedIn</option>
                <option value="facebook">Facebook Pages</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                Media Asset Type
              </label>
              <select
                value={composeMediaType}
                onChange={(e) =>
                  setComposeMediaType(e.target.value as SocialMediaType)
                }
                className="mt-1.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              >
                <option value="none">Text Only</option>
                <option value="image">Image (HTTPS URL)</option>
                <option value="video">Video / Reel / Short (HTTPS URL)</option>
                <option value="link">Link Preview (HTTPS URL)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                Linked Project (Optional)
              </label>
              <select
                value={composeProjectId}
                onChange={(e) => setComposeProjectId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              >
                <option value="">Standalone Post</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                Title {composePlatform === 'youtube' ? '(Required for YouTube)' : '(Optional)'}
              </label>
              <input
                type="text"
                maxLength={200}
                value={composeTitle}
                onChange={(e) => setComposeTitle(e.target.value)}
                placeholder={
                  composePlatform === 'youtube'
                    ? 'Compelling YouTube title (max 100 chars)'
                    : 'Article or campaign title'
                }
                className="mt-1.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none"
              />
            </div>

            {composePlatform === 'youtube' && (
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)]">
                  YouTube Visibility
                </label>
                <select
                  value={composeYoutubePrivacy}
                  onChange={(e) =>
                    setComposeYoutubePrivacy(e.target.value as YouTubePrivacyStatus)
                  }
                  className="mt-1.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  <option value="private">Private (Required for unverified Google OAuth apps)</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </div>
            )}
          </div>

          {composeMediaType !== 'none' && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)]">
                Public HTTPS Media / Link URL
              </label>
              <input
                type="url"
                maxLength={1500}
                value={composeMediaUrl}
                onChange={(e) => setComposeMediaUrl(e.target.value)}
                placeholder="https://cdn.yourdomain.com/media/clip.mp4"
                className="mt-1.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--text-secondary)]">
                Caption / Post Body
              </label>
              <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                {composeCaption.length} / {composeReq?.maxCaptionLength || 6000}
              </span>
            </div>
            <textarea
              rows={4}
              maxLength={6000}
              value={composeCaption}
              onChange={(e) => setComposeCaption(e.target.value)}
              placeholder="Write or paste your post copy..."
              className="mt-1.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Hashtags (space or comma separated)
            </label>
            <input
              type="text"
              value={composeHashtags}
              onChange={(e) => setComposeHashtags(e.target.value)}
              placeholder="#CreatorEconomy #VideoMarketing #AIWorkflow"
              className="mt-1.5 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none"
            />
          </div>

          {composeIssues.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-[11px] text-amber-900 dark:text-amber-200">
              <p className="font-semibold text-amber-950 dark:text-amber-100">
                Platform Publishing Requirements:
              </p>
              <ul className="list-disc space-y-0.5 pl-4">
                {composeIssues.map((issue, idx) => (
                  <li key={idx}>{issue}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowComposer(false)}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isStaging || !composeCaption.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-50"
            >
              {isStaging ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span>Save Draft to Queue</span>
            </button>
          </div>
        </form>
      )}

      {/* Publishing Queue */}
      {posts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-default)] py-8 text-center">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            No social posts staged in your publishing queue
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Click &quot;Stage Social Post&quot; above or click &quot;Stage for Publish&quot; on any generated post in Content Studio.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => {
            const Icon = PLATFORM_ICONS[post.platform];
            const statusBadge = getPostStatusBadge(post.status);
            const conn = connections.find((c) => c.platform === post.platform);
            const req = requirements.find((r) => r.platform === post.platform);
            const isEditing = editingPostId === post.id && editDraft !== null;
            const isBusy = busyPostId === post.id;
            const issues = getClientPlatformValidationIssues(
              post.platform,
              post.title || '',
              post.caption,
              post.mediaType,
              post.mediaUrl || ''
            );
            const scheduleValue =
              scheduleInputs[post.id] ||
              (post.scheduledFor
                ? new Date(post.scheduledFor).toISOString().slice(0, 16)
                : defaultScheduleDateTimeLocal());
            const isApproved = post.approvalStatus === 'approved';
            const canPublishOrSchedule =
              isApproved &&
              issues.length === 0 &&
              conn?.status === 'connected';

            return (
              <article
                key={post.id}
                className="space-y-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5"
              >
                {/* Top row: Platform + Badges */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] text-violet-600 dark:text-violet-400">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                          {post.title || PLATFORM_LABELS[post.platform]}
                        </h3>
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${statusBadge.classes}`}
                        >
                          {statusBadge.label}
                        </span>
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                            isApproved
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                          }`}
                        >
                          {isApproved ? 'User Approved' : 'Pending Approval'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        {PLATFORM_LABELS[post.platform]} · Media: {post.mediaType}
                        {conn?.accountName ? ` · Account: ${conn.accountName}` : ''}
                        {post.scheduledFor && post.status === 'scheduled'
                          ? ` · Scheduled for ${new Date(
                              post.scheduledFor
                            ).toLocaleString()}`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {(post.status === 'draft' || post.status === 'failed') &&
                      !isEditing && (
                        <button
                          type="button"
                          onClick={() => startEditing(post)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>Edit</span>
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={() => void onDeletePost(post.id)}
                      disabled={isBusy}
                      aria-label="Delete queued post"
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 text-[var(--text-muted)] hover:border-rose-500/40 hover:text-rose-600 disabled:opacity-40 dark:hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Content / Edit form */}
                {isEditing ? (
                  <div className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                          Title
                        </label>
                        <input
                          type="text"
                          value={editDraft.title}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, title: e.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                          Media Type
                        </label>
                        <select
                          value={editDraft.mediaType}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              mediaType: e.target.value as SocialMediaType,
                            })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                        >
                          <option value="none">Text Only</option>
                          <option value="image">Image URL</option>
                          <option value="video">Video URL</option>
                          <option value="link">Link Preview URL</option>
                        </select>
                      </div>
                    </div>

                    {editDraft.mediaType !== 'none' && (
                      <div>
                        <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                          Public HTTPS Media / Link URL
                        </label>
                        <input
                          type="url"
                          value={editDraft.mediaUrl}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              mediaUrl: e.target.value,
                            })
                          }
                          placeholder="https://..."
                          className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                        Caption / Post Body
                      </label>
                      <textarea
                        rows={4}
                        value={editDraft.caption}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, caption: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                        Hashtags
                      </label>
                      <input
                        type="text"
                        value={editDraft.hashtags}
                        onChange={(e) =>
                          setEditDraft({ ...editDraft, hashtags: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-1.5 font-mono text-xs text-[var(--text-primary)]"
                      />
                    </div>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPostId(null);
                          setEditDraft(null);
                        }}
                        className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveEditing(post)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Save Changes</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="whitespace-pre-line text-xs leading-relaxed text-[var(--text-secondary)]">
                      {post.caption}
                    </p>
                    {post.hashtags && post.hashtags.length > 0 && (
                      <p className="font-mono text-[11px] text-blue-700 dark:text-blue-300">
                        {post.hashtags.join(' ')}
                      </p>
                    )}
                    {post.mediaUrl && (
                      <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                        Media URL: {post.mediaUrl}
                      </p>
                    )}
                  </div>
                )}

                {/* Diagnostic warnings for unfinished requirements or connection state */}
                {post.status !== 'published' && (
                  <>
                    {(!conn || conn.status !== 'connected') && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                          <span>
                            {req && !req.oauthConfigured
                              ? `Manual OAuth setup required on server (${req.missingEnvVars.join(
                                  ', '
                                )}) before publishing to ${PLATFORM_LABELS[post.platform]}.`
                              : conn?.status === 'expired' ||
                                conn?.status === 'needs_reauth'
                              ? `${PLATFORM_LABELS[post.platform]} token expired or needs re-auth.`
                              : `${PLATFORM_LABELS[post.platform]} account is not connected yet.`}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={onOpenAccountSettings}
                          className="rounded border border-amber-500/40 px-2.5 py-1 text-[11px] font-semibold text-amber-950 hover:bg-amber-500/20 dark:text-amber-100"
                        >
                          Open Account Setup
                        </button>
                      </div>
                    )}

                    {issues.length > 0 && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[11px] text-amber-900 dark:text-amber-200">
                        <p className="font-semibold text-amber-950 dark:text-amber-100">
                          Platform Requirements Needed:
                        </p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {issues.map((issue, idx) => (
                            <li key={idx}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}

                {/* Real Error Reporting */}
                {post.error && (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <div>
                      <p className="font-semibold text-rose-900 dark:text-rose-100">
                        Publishing Error {post.errorCode ? `(${post.errorCode})` : ''}
                      </p>
                      <p className="mt-0.5 leading-relaxed">{post.error}</p>
                    </div>
                  </div>
                )}

                {/* Workflow Controls */}
                {post.status !== 'published' && (
                  <div className="flex flex-col gap-3 border-t border-[var(--border-default)] pt-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      {!isApproved && (
                        <button
                          type="button"
                          onClick={() => void onApprovePost(post)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-200"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span>Approve for Publishing</span>
                        </button>
                      )}

                      {post.status === 'scheduled' && (
                        <button
                          type="button"
                          onClick={() => void onCancelSchedule(post)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-rose-500/40 hover:text-rose-700 dark:hover:text-rose-200"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Cancel Schedule</span>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {post.status !== 'scheduled' &&
                        post.status !== 'publishing' && (
                          <>
                            <div className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1">
                              <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                              <input
                                type="datetime-local"
                                value={scheduleValue}
                                onChange={(e) =>
                                  setScheduleInputs((prev) => ({
                                    ...prev,
                                    [post.id]: e.target.value,
                                  }))
                                }
                                className="bg-transparent text-[11px] tabular-nums text-[var(--text-primary)] focus:outline-none"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                void onSchedulePost(
                                  post,
                                  new Date(scheduleValue).toISOString()
                                )
                              }
                              disabled={isBusy || !canPublishOrSchedule}
                              title={
                                !isApproved
                                  ? 'Approve post first'
                                  : !canPublishOrSchedule
                                  ? 'Connect account and satisfy platform requirements'
                                  : 'Schedule official API post'
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/12 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-200"
                            >
                              <Calendar className="h-3.5 w-3.5" />
                              <span>Schedule Post</span>
                            </button>
                          </>
                        )}

                      {confirmPublishId === post.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmPublishId(null);
                              void onPublishNow(post);
                            }}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:from-emerald-500 hover:to-teal-500"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            <span>Confirm Official Publish</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmPublishId(null)}
                            className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmPublishId(post.id)}
                          disabled={
                            isBusy ||
                            post.status === 'publishing' ||
                            !canPublishOrSchedule
                          }
                          title={
                            !isApproved
                              ? 'User approval required before publishing'
                              : !canPublishOrSchedule
                              ? 'Connect account and satisfy platform requirements'
                              : 'Publish immediately via official API'
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          <span>Publish Now</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Published Confirmation + Real Analytics */}
                {post.status === 'published' && (
                  <div className="space-y-3 border-t border-[var(--border-default)] pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="tabular-nums text-[var(--text-secondary)]">
                        Published{' '}
                        {post.publishedAt
                          ? new Date(post.publishedAt).toLocaleString()
                          : ''}
                        {post.externalPostId && (
                          <span className="ml-2 font-mono text-[11px] text-[var(--text-muted)]">
                            ID: {post.externalPostId}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {post.externalPostUrl && (
                          <a
                            href={post.externalPostUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-xs font-medium text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                          >
                            <span>View Live Post</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => void onRefreshAnalytics(post)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/12 px-3 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-500/20 disabled:opacity-50 dark:text-violet-200"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          <span>Fetch Real Analytics</span>
                        </button>
                      </div>
                    </div>

                    {post.analytics && (
                      <div className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-3.5">
                        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                            <BarChart3 className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                            <span>Official API Metrics</span>
                          </span>
                          <span className="tabular-nums">
                            Updated{' '}
                            {new Date(post.analytics.fetchedAt).toLocaleString()}
                          </span>
                        </div>

                        {post.analytics.supported ? (
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                            {post.analytics.views !== undefined && (
                              <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5">
                                <p className="text-[10px] text-[var(--text-muted)]">Views</p>
                                <p className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                                  {post.analytics.views}
                                </p>
                              </div>
                            )}
                            {post.analytics.impressions !== undefined && (
                              <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5">
                                <p className="text-[10px] text-[var(--text-muted)]">
                                  Impressions
                                </p>
                                <p className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                                  {post.analytics.impressions}
                                </p>
                              </div>
                            )}
                            {post.analytics.reach !== undefined && (
                              <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5">
                                <p className="text-[10px] text-[var(--text-muted)]">Reach</p>
                                <p className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                                  {post.analytics.reach}
                                </p>
                              </div>
                            )}
                            {post.analytics.likes !== undefined && (
                              <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5">
                                <p className="text-[10px] text-[var(--text-muted)]">Likes</p>
                                <p className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                                  {post.analytics.likes}
                                </p>
                              </div>
                            )}
                            {post.analytics.comments !== undefined && (
                              <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5">
                                <p className="text-[10px] text-[var(--text-muted)]">
                                  Comments
                                </p>
                                <p className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                                  {post.analytics.comments}
                                </p>
                              </div>
                            )}
                            {post.analytics.shares !== undefined && (
                              <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5">
                                <p className="text-[10px] text-[var(--text-muted)]">Shares</p>
                                <p className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                                  {post.analytics.shares}
                                </p>
                              </div>
                            )}
                            {post.analytics.saves !== undefined && (
                              <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5">
                                <p className="text-[10px] text-[var(--text-muted)]">Saves</p>
                                <p className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                                  {post.analytics.saves}
                                </p>
                              </div>
                            )}
                          </div>
                        ) : null}

                        {post.analytics.note && (
                          <p className="text-[11px] text-amber-800 dark:text-amber-200/90">
                            {post.analytics.note}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
