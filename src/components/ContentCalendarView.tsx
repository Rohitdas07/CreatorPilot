import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Facebook,
  GripVertical,
  Instagram,
  Linkedin,
  Plus,
  Send,
  Trash2,
  X,
  Youtube,
} from 'lucide-react';
import type { CreatorProject } from '../types/creator';
import type {
  SocialConnectionSummary,
  SocialMediaType,
  SocialPlatform,
  SocialPost,
  YouTubePrivacyStatus,
} from '../types/social';

interface ContentCalendarViewProps {
  posts: SocialPost[];
  projects: CreatorProject[];
  connections: SocialConnectionSummary[];
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
    scheduledFor?: string;
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
      scheduledFor?: string | null;
    }
  ) => Promise<void>;
  onApprovePost: (post: SocialPost) => Promise<void>;
  onSchedulePost: (post: SocialPost, scheduledFor: string) => Promise<void>;
  onCancelSchedule: (post: SocialPost) => Promise<void>;
  onPublishNow: (post: SocialPost) => Promise<void>;
  onDeletePost: (postId: string) => Promise<void>;
}

const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; short: string; icon: typeof Instagram; dot: string }
> = {
  instagram: {
    label: 'Instagram',
    short: 'IG',
    icon: Instagram,
    dot: 'bg-fuchsia-500',
  },
  youtube: {
    label: 'YouTube',
    short: 'YT',
    icon: Youtube,
    dot: 'bg-rose-500',
  },
  linkedin: {
    label: 'LinkedIn',
    short: 'IN',
    icon: Linkedin,
    dot: 'bg-sky-500',
  },
  facebook: {
    label: 'Facebook',
    short: 'FB',
    icon: Facebook,
    dot: 'bg-blue-600',
  },
};

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPostEffectiveDate(post: SocialPost): Date {
  const raw = post.scheduledFor || post.publishedAt || post.createdAt;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function combineDateAndTime(dateKey: string, timeStr: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = (timeStr || '10:00').split(':').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, hh || 10, mm || 0, 0, 0);
  return dt.toISOString();
}

function statusPillClasses(status: SocialPost['status']): string {
  switch (status) {
    case 'published':
      return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'scheduled':
      return 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300';
    case 'publishing':
      return 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300';
    case 'failed':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300';
    default:
      return 'border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)]';
  }
}

export function ContentCalendarView({
  posts,
  projects,
  connections,
  busyPostId,
  onStagePost,
  onUpdatePost,
  onApprovePost,
  onSchedulePost,
  onCancelSchedule,
  onPublishNow,
  onDeletePost,
}: ContentCalendarViewProps) {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [platformFilter, setPlatformFilter] = useState<'all' | SocialPlatform>('all');
  const [dragPostId, setDragPostId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  // Create/Edit modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<SocialPost | null>(null);
  const [formPlatform, setFormPlatform] = useState<SocialPlatform>('linkedin');
  const [formTitle, setFormTitle] = useState('');
  const [formCaption, setFormCaption] = useState('');
  const [formHashtags, setFormHashtags] = useState('');
  const [formMediaType, setFormMediaType] = useState<SocialMediaType>('none');
  const [formMediaUrl, setFormMediaUrl] = useState('');
  const [formYoutubePrivacy, setFormYoutubePrivacy] =
    useState<YouTubePrivacyStatus>('private');
  const [formProjectId, setFormProjectId] = useState('');
  const [formDateKey, setFormDateKey] = useState(() => toDateKey(new Date()));
  const [formTimeStr, setFormTimeStr] = useState('10:00');
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);

  const filteredPosts = useMemo(() => {
    if (platformFilter === 'all') return posts;
    return posts.filter((p) => p.platform === platformFilter);
  }, [posts, platformFilter]);

  const postsByDay = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const post of filteredPosts) {
      const key = toDateKey(getPostEffectiveDate(post));
      const existing = map.get(key) || [];
      existing.push(post);
      map.set(key, existing);
    }
    return map;
  }, [filteredPosts]);

  // Upcoming 24h & failed alerts
  const upcomingNotifications = useMemo(() => {
    const now = Date.now();
    const horizon = now + 24 * 60 * 60 * 1000;
    const dueSoon = posts.filter((p) => {
      if (p.status !== 'scheduled' || !p.scheduledFor) return false;
      const ms = new Date(p.scheduledFor).getTime();
      return ms >= now - 60000 && ms <= horizon;
    });
    const failed = posts.filter((p) => p.status === 'failed');
    return { dueSoon, failed };
  }, [posts]);

  const calendarDays = useMemo(() => {
    const base = new Date(cursorDate);
    if (viewMode === 'week') {
      const start = new Date(base);
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
      });
    }

    const firstOfMonth = new Date(base.getFullYear(), base.getMonth(), 1);
    const startGrid = new Date(firstOfMonth);
    startGrid.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(startGrid);
      d.setDate(startGrid.getDate() + i);
      return d;
    });
  }, [cursorDate, viewMode]);

  const handleNavigateRange = (direction: -1 | 1) => {
    const next = new Date(cursorDate);
    if (viewMode === 'week') {
      next.setDate(next.getDate() + direction * 7);
    } else {
      next.setMonth(next.getMonth() + direction);
    }
    setCursorDate(next);
  };

  const openCreateForDay = (dayKey: string) => {
    setSelectedPost(null);
    setFormPlatform('linkedin');
    setFormTitle('');
    setFormCaption('');
    setFormHashtags('');
    setFormMediaType('none');
    setFormMediaUrl('');
    setFormYoutubePrivacy('private');
    setFormProjectId('');
    setFormDateKey(dayKey);
    setFormTimeStr('10:00');
    setShowCreateModal(true);
  };

  const openEditPost = (post: SocialPost) => {
    const dt = getPostEffectiveDate(post);
    const pad = (n: number) => String(n).padStart(2, '0');
    setSelectedPost(post);
    setFormPlatform(post.platform);
    setFormTitle(post.title || '');
    setFormCaption(post.caption);
    setFormHashtags((post.hashtags || []).join(' '));
    setFormMediaType(post.mediaType);
    setFormMediaUrl(post.mediaUrl || '');
    setFormYoutubePrivacy(post.youtubePrivacy || 'private');
    setFormProjectId(post.projectId || '');
    setFormDateKey(toDateKey(dt));
    setFormTimeStr(`${pad(dt.getHours())}:${pad(dt.getMinutes())}`);
    setShowCreateModal(true);
  };

  const handlePrefillProject = (projectId: string) => {
    setFormProjectId(projectId);
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return;
    setFormTitle(proj.title.slice(0, 100));
    const caption =
      formPlatform === 'linkedin'
        ? proj.result.platformPosts.linkedin
        : formPlatform === 'facebook'
        ? proj.result.platformPosts.facebook
        : formPlatform === 'youtube'
        ? proj.result.youtubeShorts.description
        : proj.result.instagramCaption.caption;
    setFormCaption(caption);
    setFormHashtags(
      [...proj.result.hashtags.relevant, ...proj.result.hashtags.trending]
        .slice(0, 8)
        .join(' ')
    );
  };

  const handleDropOnDay = async (targetDayKey: string) => {
    setDragOverDay(null);
    if (!dragPostId) return;
    const post = posts.find((p) => p.id === dragPostId);
    setDragPostId(null);
    if (!post || post.status === 'published' || post.status === 'publishing') return;

    const currentDt = getPostEffectiveDate(post);
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(currentDt.getHours())}:${pad(currentDt.getMinutes())}`;
    const newIso = combineDateAndTime(targetDayKey, timeStr);

    if (post.status === 'scheduled' && post.approvalStatus === 'approved') {
      await onSchedulePost(post, newIso);
    } else {
      await onUpdatePost(post.id, { scheduledFor: newIso });
    }
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCaption.trim()) return;
    setIsSubmittingModal(true);
    try {
      const tags = formHashtags
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith('#') ? t : `#${t}`));
      const targetIso = combineDateAndTime(formDateKey, formTimeStr);

      if (selectedPost) {
        await onUpdatePost(selectedPost.id, {
          title: formTitle.trim() || null,
          caption: formCaption.trim(),
          hashtags: tags.length > 0 ? tags : null,
          mediaType: formMediaType,
          mediaUrl: formMediaUrl.trim() || null,
          youtubePrivacy:
            formPlatform === 'youtube' ? formYoutubePrivacy : null,
          scheduledFor: targetIso,
        });
      } else {
        await onStagePost({
          platform: formPlatform,
          title: formTitle.trim() || undefined,
          caption: formCaption.trim(),
          hashtags: tags.length > 0 ? tags : undefined,
          mediaType: formMediaType,
          mediaUrl: formMediaUrl.trim() || undefined,
          youtubePrivacy:
            formPlatform === 'youtube' ? formYoutubePrivacy : undefined,
          projectId: formProjectId || undefined,
          scheduledFor: targetIso,
        });
      }
      setShowCreateModal(false);
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const headerTitle =
    viewMode === 'month'
      ? cursorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : `Week of ${calendarDays[0].toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}`;
  const todayKey = toDateKey(new Date());

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <section className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
            Visual Content Calendar
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Plan, drag-and-drop reschedule, approve, and trigger real scheduled social publishing across connected platforms.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="flex items-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1">
            {(['month', 'week'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setViewMode(m)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                  viewMode === m
                    ? 'bg-violet-600 text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => openCreateForDay(todayKey)}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:from-violet-500 hover:to-blue-500 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Schedule Post</span>
          </button>
        </div>
      </section>

      {/* Upcoming Publishing & Failed Notifications Strip */}
      {(upcomingNotifications.dueSoon.length > 0 ||
        upcomingNotifications.failed.length > 0) && (
        <section className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <Bell className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-300 shrink-0" />
            <div className="text-xs text-[var(--text-primary)]">
              {upcomingNotifications.dueSoon.length > 0 && (
                <p className="font-semibold">
                  {upcomingNotifications.dueSoon.length} post
                  {upcomingNotifications.dueSoon.length > 1 ? 's' : ''} scheduled within the next 24 hours
                </p>
              )}
              {upcomingNotifications.failed.length > 0 && (
                <p className="text-rose-700 dark:text-rose-300 font-medium">
                  {upcomingNotifications.failed.length} post
                  {upcomingNotifications.failed.length > 1 ? 's' : ''} failed to publish — click to inspect error details
                </p>
              )}
            </div>
          </div>
          <span className="font-mono text-[11px] text-[var(--text-muted)]">
            Drag drafts or scheduled cards onto any date to reschedule
          </span>
        </section>
      )}

      {/* Calendar Toolbar */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4 sm:p-6 shadow-[var(--shadow-card)] space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleNavigateRange(-1)}
              aria-label="Previous range"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="min-w-[170px] text-center font-display text-base font-semibold text-[var(--text-primary)]">
              {headerTitle}
            </h2>
            <button
              type="button"
              onClick={() => handleNavigateRange(1)}
              aria-label="Next range"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCursorDate(new Date())}
              className="ml-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Today
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'instagram', 'youtube', 'linkedin', 'facebook'] as const).map(
              (plat) => (
                <button
                  key={plat}
                  type="button"
                  onClick={() => setPlatformFilter(plat)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                    platformFilter === plat
                      ? 'bg-violet-600/15 text-violet-700 dark:text-violet-300 border border-violet-500/40'
                      : 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {plat === 'all' ? 'All Platforms' : PLATFORM_META[plat].label}
                </button>
              )
            )}
          </div>
        </div>

        {/* Day-of-week headings */}
        <div className="grid grid-cols-7 gap-2 text-center text-[11px] font-semibold text-[var(--text-muted)]">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {calendarDays.map((day) => {
            const key = toDateKey(day);
            const isCurrentMonth = day.getMonth() === cursorDate.getMonth();
            const isToday = key === todayKey;
            const dayPosts = postsByDay.get(key) || [];
            const isDragTarget = dragOverDay === key;

            return (
              <div
                key={key}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverDay(key);
                }}
                onDragLeave={() => {
                  if (dragOverDay === key) setDragOverDay(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleDropOnDay(key);
                }}
                className={`flex flex-col rounded-xl border p-2 transition-colors ${
                  viewMode === 'week' ? 'min-h-[260px]' : 'min-h-[124px]'
                } ${
                  isDragTarget
                    ? 'border-violet-500 bg-violet-500/10'
                    : isToday
                    ? 'border-violet-500/50 bg-violet-500/5'
                    : 'border-[var(--border-default)] bg-[var(--bg-surface)]'
                } ${!isCurrentMonth && viewMode === 'month' ? 'opacity-55' : ''}`}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      isToday
                        ? 'font-bold text-violet-600 dark:text-violet-400'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <button
                    type="button"
                    onClick={() => openCreateForDay(key)}
                    aria-label={`Add post on ${key}`}
                    className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                <div className="space-y-1.5 flex-1">
                  {dayPosts.map((post) => {
                    const meta = PLATFORM_META[post.platform];
                    const Icon = meta.icon;
                    const draggable =
                      post.status === 'draft' ||
                      post.status === 'scheduled' ||
                      post.status === 'failed';
                    const timeStr = getPostEffectiveDate(post).toLocaleTimeString(
                      [],
                      { hour: '2-digit', minute: '2-digit' }
                    );

                    return (
                      <div
                        key={post.id}
                        draggable={draggable}
                        onDragStart={() => setDragPostId(post.id)}
                        onDragEnd={() => {
                          setDragPostId(null);
                          setDragOverDay(null);
                        }}
                        onClick={() => openEditPost(post)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openEditPost(post);
                          }
                        }}
                        className="group cursor-pointer rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-2 text-left transition-colors hover:border-violet-500/50"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-primary)]">
                            <span
                              className={`h-2 w-2 rounded-full ${meta.dot}`}
                              aria-hidden="true"
                            />
                            <Icon className="h-3 w-3" />
                            <span>{meta.short}</span>
                          </span>
                          <span className="flex items-center gap-1 font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                            {draggable && (
                              <GripVertical className="h-2.5 w-2.5 opacity-0 group-hover:opacity-70" />
                            )}
                            {timeStr}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[11px] font-medium text-[var(--text-primary)]">
                          {post.title || post.caption}
                        </p>
                        <p
                          className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold capitalize ${statusPillClasses(
                            post.status
                          )}`}
                        >
                          {post.status}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Create / Edit / Schedule Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  {selectedPost ? 'Manage Scheduled Post' : 'Create Post Draft'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-4">
              {!selectedPost && projects.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)]">
                    Import from Saved Project (optional)
                  </label>
                  <select
                    value={formProjectId}
                    onChange={(e) => handlePrefillProject(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  >
                    <option value="">-- Select a project --</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)]">
                    Platform
                  </label>
                  <select
                    value={formPlatform}
                    disabled={Boolean(selectedPost)}
                    onChange={(e) =>
                      setFormPlatform(e.target.value as SocialPlatform)
                    }
                    className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] disabled:opacity-60"
                  >
                    {(['instagram', 'youtube', 'linkedin', 'facebook'] as const).map(
                      (p) => (
                        <option key={p} value={p}>
                          {PLATFORM_META[p].label}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)]">
                    Date
                  </label>
                  <input
                    type="date"
                    value={formDateKey}
                    onChange={(e) => setFormDateKey(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)]">
                    Time
                  </label>
                  <input
                    type="time"
                    value={formTimeStr}
                    onChange={(e) => setFormTimeStr(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Title (required for YouTube)
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Caption / Post Copy
                </label>
                <textarea
                  rows={4}
                  required
                  maxLength={6000}
                  value={formCaption}
                  onChange={(e) => setFormCaption(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)]"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)]">
                    Media Type
                  </label>
                  <select
                    value={formMediaType}
                    onChange={(e) =>
                      setFormMediaType(e.target.value as SocialMediaType)
                    }
                    className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  >
                    <option value="none">Text Only</option>
                    <option value="image">Public HTTPS Image</option>
                    <option value="video">Public HTTPS Video (MP4)</option>
                    <option value="link">Link Preview</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)]">
                    Public HTTPS Media URL
                  </label>
                  <input
                    type="url"
                    value={formMediaUrl}
                    onChange={(e) => setFormMediaUrl(e.target.value)}
                    placeholder="https://..."
                    className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Hashtags
                </label>
                <input
                  type="text"
                  value={formHashtags}
                  onChange={(e) => setFormHashtags(e.target.value)}
                  placeholder="#CreatorEconomy #ReelsTips"
                  className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                />
              </div>

              {selectedPost && selectedPost.error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{selectedPost.error}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedPost && (
                    <>
                      {selectedPost.approvalStatus !== 'approved' && (
                        <button
                          type="button"
                          disabled={busyPostId === selectedPost.id}
                          onClick={async () => {
                            await onApprovePost(selectedPost);
                            setShowCreateModal(false);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Approve</span>
                        </button>
                      )}

                      {selectedPost.approvalStatus === 'approved' &&
                        selectedPost.status !== 'published' && (
                          <button
                            type="button"
                            disabled={busyPostId === selectedPost.id}
                            onClick={async () => {
                              const iso = combineDateAndTime(formDateKey, formTimeStr);
                              await onSchedulePost(selectedPost, iso);
                              setShowCreateModal(false);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300"
                          >
                            <Clock className="h-3.5 w-3.5" />
                            <span>Activate Schedule</span>
                          </button>
                        )}

                      {selectedPost.status === 'scheduled' && (
                        <button
                          type="button"
                          disabled={busyPostId === selectedPost.id}
                          onClick={async () => {
                            await onCancelSchedule(selectedPost);
                            setShowCreateModal(false);
                          }}
                          className="rounded-xl border border-[var(--border-default)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)]"
                        >
                          Unschedule
                        </button>
                      )}

                      {selectedPost.approvalStatus === 'approved' &&
                        selectedPost.status !== 'published' &&
                        connections.some(
                          (c) =>
                            c.platform === selectedPost.platform &&
                            c.status === 'connected'
                        ) && (
                          <button
                            type="button"
                            disabled={busyPostId === selectedPost.id}
                            onClick={async () => {
                              await onPublishNow(selectedPost);
                              setShowCreateModal(false);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                          >
                            <Send className="h-3.5 w-3.5" />
                            <span>Publish Now</span>
                          </button>
                        )}

                      <button
                        type="button"
                        disabled={busyPostId === selectedPost.id}
                        onClick={async () => {
                          await onDeletePost(selectedPost.id);
                          setShowCreateModal(false);
                        }}
                        className="inline-flex items-center gap-1 rounded-xl border border-rose-500/30 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete</span>
                      </button>
                    </>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingModal}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white"
                >
                  <span>
                    {isSubmittingModal
                      ? 'Saving...'
                      : selectedPost
                      ? 'Save Changes'
                      : 'Create Draft'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
