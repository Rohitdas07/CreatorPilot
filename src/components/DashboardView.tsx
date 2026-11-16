import { useMemo } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  Clapperboard,
  FileText,
  Film,
  FolderKanban,
  Layers,
  LogOut,
  Mail,
  Phone,
  Send,
  Settings,
  Sparkles,
  User as UserIcon,
  Video,
} from 'lucide-react';
import type { UserProfile } from '../types/auth';
import type {
  CreatorProject,
  CreatorStats,
  HistoryItem,
  NavSection,
  UploadedMediaInfo,
} from '../types/creator';
import type {
  AssistantConversation,
  AssistantMessage,
  AssistantTask,
  AssistantTaskOutputs,
} from '../types/assistant';
import type {
  SocialConnectionSummary,
  SocialMediaType,
  SocialPlatform,
  SocialPlatformRequirementInfo,
  SocialPost,
  YouTubePrivacyStatus,
} from '../types/social';
import { SAMPLE_PROMPTS, type SamplePrompt } from '../utils/sampleGenerator';
import { AssistantPanel } from './AssistantPanel';
import { SocialPublishPanel } from './SocialPublishPanel';

interface DashboardViewProps {
  user: UserProfile;
  stats: CreatorStats;
  projects: CreatorProject[];
  history: HistoryItem[];
  isLoadingData?: boolean;
  studioMediaInfo: UploadedMediaInfo | null;
  studioSourceText: string;
  assistantConversations: AssistantConversation[];
  activeConversationId: string | null;
  assistantMessages: AssistantMessage[];
  assistantTasks: AssistantTask[];
  activeTaskId: string | null;
  isAssistantSubmitting: boolean;
  onSelectAssistantConversation: (conversationId: string) => void;
  onNewAssistantConversation: () => void;
  onSelectAssistantTask: (taskId: string) => void;
  onSendAssistantInstruction: (params: {
    message: string;
    selectedProject: CreatorProject | null;
    media: (UploadedMediaInfo & { extractedText?: string }) | null;
  }) => Promise<void>;
  onSaveAssistantTaskOutputs: (
    taskId: string,
    outputs: AssistantTaskOutputs
  ) => Promise<void>;
  onApproveAssistantTask: (task: AssistantTask) => Promise<void>;
  onPublishAssistantTask: (task: AssistantTask) => Promise<void>;
  onCopyText: (text: string, label: string) => void;
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
  onNavigate: (section: NavSection) => void;
  onUseSamplePrompt: (sample: SamplePrompt) => void;
  onOpenProject: (project: CreatorProject) => void;
  onLogout: () => void;
  socialRequirements: SocialPlatformRequirementInfo[];
  socialConnections: SocialConnectionSummary[];
  socialPosts: SocialPost[];
  busySocialPostId: string | null;
  onStageSocialPost: (draft: {
    platform: SocialPlatform;
    title?: string;
    caption: string;
    hashtags?: string[];
    mediaType: SocialMediaType;
    mediaUrl?: string;
    youtubePrivacy?: YouTubePrivacyStatus;
    projectId?: string;
  }) => Promise<void>;
  onUpdateSocialPost: (
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
  onApproveSocialPost: (post: SocialPost) => Promise<void>;
  onScheduleSocialPost: (post: SocialPost, scheduledFor: string) => Promise<void>;
  onCancelSocialSchedule: (post: SocialPost) => Promise<void>;
  onPublishSocialPostNow: (post: SocialPost) => Promise<void>;
  onRefreshSocialAnalytics: (post: SocialPost) => Promise<void>;
  onDeleteSocialPost: (postId: string) => Promise<void>;
}

export function DashboardView({
  user,
  stats,
  projects,
  history,
  isLoadingData = false,
  studioMediaInfo,
  studioSourceText,
  assistantConversations,
  activeConversationId,
  assistantMessages,
  assistantTasks,
  activeTaskId,
  isAssistantSubmitting,
  onSelectAssistantConversation,
  onNewAssistantConversation,
  onSelectAssistantTask,
  onSendAssistantInstruction,
  onSaveAssistantTaskOutputs,
  onApproveAssistantTask,
  onPublishAssistantTask,
  onCopyText,
  onNotify,
  onNavigate,
  onUseSamplePrompt,
  onOpenProject,
  onLogout,
  socialRequirements,
  socialConnections,
  socialPosts,
  busySocialPostId,
  onStageSocialPost,
  onUpdateSocialPost,
  onApproveSocialPost,
  onScheduleSocialPost,
  onCancelSocialSchedule,
  onPublishSocialPostNow,
  onRefreshSocialAnalytics,
  onDeleteSocialPost,
}: DashboardViewProps) {
  const statCards = [
    {
      label: 'Total Content Generated',
      value: stats.totalGenerated,
      detail: 'Multi-platform AI bundles',
      icon: Layers,
      accent: 'text-violet-600 dark:text-violet-400 bg-violet-500/10',
    },
    {
      label: 'Reels Created',
      value: stats.reelsCreated,
      detail: 'Instagram vertical scripts',
      icon: Film,
      accent: 'text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/10',
    },
    {
      label: 'Shorts Created',
      value: stats.shortsCreated,
      detail: 'YouTube Shorts packages',
      icon: Clapperboard,
      accent: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
    },
    {
      label: 'Captions Generated',
      value: stats.captionsGenerated,
      detail: 'Hooks & social copy',
      icon: FileText,
      accent: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
    },
  ];

  const recentProjects = projects.slice(0, 4);
  const connectedCount = socialConnections.filter(
    (c) => c.status === 'connected'
  ).length;
  const formattedPhone = user.phoneNumber
    ? `${user.countryCode} ${user.phoneNumber}`
    : 'Not provided';

  const recentActivity = useMemo(() => {
    const events: Array<{
      id: string;
      kind: 'generation' | 'assistant' | 'social';
      title: string;
      meta: string;
      timestamp: string;
    }> = [];

    for (const h of history.slice(0, 4)) {
      events.push({
        id: `act-gen-${h.id}`,
        kind: 'generation',
        title: h.result.instagramReel.title || 'Generated Content Bundle',
        meta: `${h.config.platform} · ${h.config.language} · ${
          h.result.engine === 'gemini' ? 'Gemini AI' : 'Demo'
        }`,
        timestamp: h.createdAt,
      });
    }

    for (const t of assistantTasks.slice(0, 4)) {
      events.push({
        id: `act-task-${t.id}`,
        kind: 'assistant',
        title: t.instruction.slice(0, 72),
        meta: `Assistant · ${t.language} · ${t.approvalStatus.replace('_', ' ')}`,
        timestamp: t.updatedAt || t.createdAt,
      });
    }

    for (const p of socialPosts.slice(0, 4)) {
      events.push({
        id: `act-post-${p.id}`,
        kind: 'social',
        title: p.title || p.caption.slice(0, 64),
        meta: `Social (${p.platform}) · ${p.status}`,
        timestamp: p.updatedAt || p.createdAt,
      });
    }

    return events
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 6);
  }, [history, assistantTasks, socialPosts]);

  return (
    <div className="space-y-7">
      {/* Welcome Hero Banner */}
      <section className="relative overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-gradient-to-br from-violet-600/12 to-blue-600/12 blur-3xl"
        />

        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              CreatorPilot AI Workspace
            </p>
            <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl text-balance">
              Welcome back, {user.fullName.split(' ')[0]}
            </h1>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              Create once. Publish everywhere. Turn a script, transcript, audio clip, or video into ready-to-publish Reels, Shorts, captions, hashtags, and social posts.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('create')}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-violet-600/20 transition-all duration-150 hover:from-violet-500 hover:to-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-4 w-4" />
              <span>Create Content</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('projects')}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap shrink-0"
            >
              <span>Browse Projects</span>
              <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
            </button>
          </div>
        </div>

        {/* Quick Actions & Logged-in User Strip */}
        <div className="relative mt-6 flex flex-col justify-between gap-4 border-t border-[var(--border-default)] pt-5 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
              <UserIcon className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
              <span>{user.fullName}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <span>{user.email}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
              <Phone className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              <span>{formattedPhone}</span>
            </span>
            <span className="text-[var(--text-muted)]">
              · {connectedCount}/4 social accounts connected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] whitespace-nowrap"
            >
              History
            </button>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] whitespace-nowrap"
            >
              <Settings className="h-3.5 w-3.5" />
              <span>Accounts &amp; Theme</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] whitespace-nowrap"
            >
              My Profile
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-200 transition-colors hover:bg-rose-500/20 whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </section>

      {/* Four Real-Data Statistics Cards */}
      <section aria-label="Creator output summary">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.label}
                className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)] transition-colors duration-150 hover:border-[var(--border-strong)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-[var(--text-muted)]">
                    {card.label}
                  </span>
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${card.accent}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                {isLoadingData ? (
                  <div className="mt-3 h-8 w-16 animate-pulse rounded bg-[var(--bg-surface)]" />
                ) : (
                  <p className="mt-3 font-mono text-3xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums">
                    {card.value}
                  </p>
                )}
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  {card.detail}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Autonomous AI Creator Assistant */}
      <AssistantPanel
        projects={projects}
        studioMediaInfo={studioMediaInfo}
        studioSourceText={studioSourceText}
        conversations={assistantConversations}
        activeConversationId={activeConversationId}
        messages={assistantMessages}
        tasks={assistantTasks}
        activeTaskId={activeTaskId}
        isSubmitting={isAssistantSubmitting}
        onSelectConversation={onSelectAssistantConversation}
        onNewConversation={onNewAssistantConversation}
        onSelectTask={onSelectAssistantTask}
        onSendInstruction={onSendAssistantInstruction}
        onSaveTaskOutputs={onSaveAssistantTaskOutputs}
        onApproveTask={onApproveAssistantTask}
        onPublishTask={onPublishAssistantTask}
        onCopyText={onCopyText}
        onNotify={onNotify}
      />

      {/* Social Media Official Publishing, Scheduling & Analytics */}
      <SocialPublishPanel
        requirements={socialRequirements}
        connections={socialConnections}
        posts={socialPosts}
        projects={projects}
        busyPostId={busySocialPostId}
        onStagePost={onStageSocialPost}
        onUpdatePost={onUpdateSocialPost}
        onApprovePost={onApproveSocialPost}
        onSchedulePost={onScheduleSocialPost}
        onCancelSchedule={onCancelSocialSchedule}
        onPublishNow={onPublishSocialPostNow}
        onRefreshAnalytics={onRefreshSocialAnalytics}
        onDeletePost={onDeleteSocialPost}
        onOpenAccountSettings={() => onNavigate('settings')}
      />

      {/* Recent Projects, Recent Activity & Quick-Start Templates */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Recent Saved Projects */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] xl:col-span-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
                Recent Projects
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Reopen saved multi-platform campaigns
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('projects')}
              className="text-xs font-semibold text-violet-600 dark:text-violet-400 transition-colors hover:underline whitespace-nowrap"
            >
              View all
            </button>
          </div>

          {isLoadingData ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-xl bg-[var(--bg-surface)]"
                />
              ))}
            </div>
          ) : recentProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] py-10 text-center px-4">
              <Video className="h-8 w-8 text-[var(--text-muted)]" />
              <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">
                No saved projects yet
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Generate your first content bundle in Studio and save it here.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('create')}
                className="mt-4 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white"
              >
                Create First Project
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-default)]">
              {recentProjects.map((project) => {
                const formattedDate = new Date(
                  project.updatedAt
                ).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                });

                return (
                  <div
                    key={project.id}
                    className="flex items-center justify-between gap-3 py-3.5 first:pt-1 last:pb-1"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {project.title}
                      </h3>
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                        {project.config.platform} · {project.config.tone} ·{' '}
                        {formattedDate}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenProject(project)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-violet-500/40 whitespace-nowrap shrink-0"
                    >
                      <span>Open</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent Real Activity Feed */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] xl:col-span-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
                Recent Activity
              </h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Latest generations, assistant jobs &amp; social queue updates
              </p>
            </div>
            <Activity className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
          </div>

          {recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] py-10 text-center px-4">
              <FolderKanban className="h-8 w-8 text-[var(--text-muted)]" />
              <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">
                No workspace activity yet
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Activity appears automatically as you generate content or run workflows.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-default)]">
              {recentActivity.map((item) => {
                const Icon =
                  item.kind === 'assistant'
                    ? Bot
                    : item.kind === 'social'
                    ? Send
                    : Sparkles;
                return (
                  <li
                    key={item.id}
                    className="flex items-start gap-3 py-3 first:pt-1 last:pb-1"
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-violet-600 dark:text-violet-400">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                        {item.meta}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                      {new Date(item.timestamp).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Quick-Start Ideas */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] xl:col-span-3">
          <div className="mb-4">
            <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
              Quick-Start Ideas
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Launch Studio prefilled with a creator scenario
            </p>
          </div>

          <div className="space-y-3">
            {SAMPLE_PROMPTS.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => onUseSamplePrompt(sample)}
                className="group flex w-full items-start justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 text-left transition-all duration-150 hover:border-violet-500/45 hover:bg-[var(--bg-hover)]"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">
                    {sample.label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    {sample.platform} · {sample.tone} · {sample.duration}
                  </p>
                </div>
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-violet-600 dark:group-hover:text-violet-400" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
