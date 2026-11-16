import { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Database,
  Download,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Sun,
  User,
} from 'lucide-react';
import { useTheme, type ThemeMode } from '../context/ThemeContext';
import type {
  ContentLanguage,
  CreatorSettings,
  NotificationPreferences,
  Platform,
  Tone,
  VideoDuration,
} from '../types/creator';
import type {
  SocialConnectionSummary,
  SocialPlatform,
  SocialPlatformRequirementInfo,
} from '../types/social';
import { SocialAccountsPanel } from './SocialAccountsPanel';

interface SettingsViewProps {
  settings: CreatorSettings;
  onSaveSettings: (updated: CreatorSettings) => void;
  notificationPrefs: NotificationPreferences;
  onChangeNotificationPrefs: (prefs: NotificationPreferences) => void;
  onExportAllProjects: () => void;
  onLoadDemoProjects: () => void;
  socialRequirements: SocialPlatformRequirementInfo[];
  socialConnections: SocialConnectionSummary[];
  isSocialLoading: boolean;
  busySocialPlatform: SocialPlatform | null;
  onRefreshSocialStatus: () => Promise<void>;
  onConnectSocialPlatform: (platform: SocialPlatform) => Promise<void>;
  onVerifySocialConnection: (platform: SocialPlatform) => Promise<void>;
  onDisconnectSocialPlatform: (platform: SocialPlatform) => Promise<void>;
  onCopyText: (text: string, label: string) => void;
}

const PLATFORMS: Platform[] = ['Instagram', 'YouTube', 'Facebook', 'LinkedIn'];
const LANGUAGES: ContentLanguage[] = [
  'English',
  'Hindi',
  'Bengali',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Japanese',
];
const TONES: Tone[] = [
  'Professional',
  'Funny',
  'Educational',
  'Inspirational',
  'Casual',
];
const DURATIONS: VideoDuration[] = ['15 sec', '30 sec', '60 sec'];

const APPEARANCE_CARDS: Array<{
  mode: ThemeMode;
  title: string;
  description: string;
  icon: typeof Sun;
  previewBg: string;
  previewCard: string;
  previewBar: string;
}> = [
  {
    mode: 'light',
    title: 'Light Mode',
    description: 'Bright daylight workspace with high-contrast slate ink',
    icon: Sun,
    previewBg: 'bg-slate-100 border-slate-200',
    previewCard: 'bg-white border-slate-200',
    previewBar: 'bg-violet-600',
  },
  {
    mode: 'dark',
    title: 'Dark Mode',
    description: 'Low-glare deep slate interface for extended studio focus',
    icon: Moon,
    previewBg: 'bg-[#070B14] border-slate-800',
    previewCard: 'bg-[#0D1322] border-slate-800',
    previewBar: 'bg-violet-500',
  },
  {
    mode: 'system',
    title: 'System Default',
    description: 'Automatically follows your operating system appearance',
    icon: Monitor,
    previewBg: 'bg-gradient-to-r from-slate-100 via-slate-200 to-[#070B14] border-slate-400/50',
    previewCard: 'bg-white/80 dark:bg-[#0D1322]/90 border-slate-400/40',
    previewBar: 'bg-gradient-to-r from-violet-600 to-blue-600',
  },
];

export function SettingsView({
  settings,
  onSaveSettings,
  notificationPrefs,
  onChangeNotificationPrefs,
  onExportAllProjects,
  onLoadDemoProjects,
  socialRequirements,
  socialConnections,
  isSocialLoading,
  busySocialPlatform,
  onRefreshSocialStatus,
  onConnectSocialPlatform,
  onVerifySocialConnection,
  onDisconnectSocialPlatform,
  onCopyText,
}: SettingsViewProps) {
  const { themeMode, resolvedTheme, setThemeMode } = useTheme();
  const [draft, setDraft] = useState<CreatorSettings>(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(draft);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)]">
        <h1 className="font-display text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
          Workspace Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Manage appearance, creator defaults, brand voice, connected social accounts, notifications, and workspace backups.
        </p>
      </div>

      {/* Section 1: Appearance */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
              <Palette className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Appearance
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Switch instantly between Light Mode, Dark Mode, or System Default
              </p>
            </div>
          </div>

          <span className="font-mono text-xs text-[var(--text-muted)]">
            Active: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
            {themeMode === 'system' ? ' (System)' : ''}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {APPEARANCE_CARDS.map((card) => {
            const Icon = card.icon;
            const active = themeMode === card.mode;
            return (
              <button
                key={card.mode}
                type="button"
                onClick={() => setThemeMode(card.mode)}
                aria-pressed={active}
                className={`group flex flex-col rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  active
                    ? 'border-violet-500 bg-violet-500/8 ring-1 ring-violet-500/30'
                    : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                }`}
              >
                {/* Miniature UI Preview */}
                <div
                  className={`mb-3 h-16 w-full rounded-lg border p-2 ${card.previewBg}`}
                >
                  <div
                    className={`h-full w-full rounded-md border p-2 flex flex-col justify-between ${card.previewCard}`}
                  >
                    <div className={`h-1.5 w-10 rounded-full ${card.previewBar}`} />
                    <div className="space-y-1">
                      <div className="h-1.5 w-3/4 rounded-full bg-slate-400/35" />
                      <div className="h-1.5 w-1/2 rounded-full bg-slate-400/25" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    <Icon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                    <span>{card.title}</span>
                  </span>
                  {active && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                  {card.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 2: General */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5">
          <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] pb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
              <User className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                General
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Your creator identity displayed across the workspace
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="settings-name"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Creator Name
              </label>
              <input
                id="settings-name"
                type="text"
                maxLength={100}
                value={draft.creatorName}
                onChange={(e) =>
                  setDraft({ ...draft, creatorName: e.target.value })
                }
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="settings-handle"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Brand Handle
              </label>
              <input
                id="settings-handle"
                type="text"
                maxLength={60}
                value={draft.brandHandle}
                onChange={(e) =>
                  setDraft({ ...draft, brandHandle: e.target.value })
                }
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </div>
          </div>
        </section>

        {/* Section 3: Brand Voice */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5">
          <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] pb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Brand Voice
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Applied as your default creator niche and AI writing style
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="settings-niche"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Content Niche
              </label>
              <input
                id="settings-niche"
                type="text"
                maxLength={150}
                value={draft.niche}
                onChange={(e) => setDraft({ ...draft, niche: e.target.value })}
                placeholder="e.g., AI Tools, Tech Tutorials, Creator Productivity"
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="settings-brand-voice"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Default Brand Voice
              </label>
              <textarea
                id="settings-brand-voice"
                rows={2}
                maxLength={400}
                value={draft.brandVoice}
                onChange={(e) =>
                  setDraft({ ...draft, brandVoice: e.target.value })
                }
                placeholder="e.g., Clear, practical, creator-first, conversational without hype"
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </div>
          </div>
        </section>

        {/* Section 4: Creator Preferences */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5">
          <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] pb-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Creator Preferences
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Applied automatically when starting a new session in Content Studio
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="settings-platform"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Default Platform
              </label>
              <select
                id="settings-platform"
                value={draft.defaultPlatform}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultPlatform: e.target.value as Platform,
                  })
                }
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-language"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Default Language
              </label>
              <select
                id="settings-language"
                value={draft.defaultLanguage}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultLanguage: e.target.value as ContentLanguage,
                  })
                }
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-tone"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Default Tone
              </label>
              <select
                id="settings-tone"
                value={draft.defaultTone}
                onChange={(e) =>
                  setDraft({ ...draft, defaultTone: e.target.value as Tone })
                }
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              >
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="settings-duration"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Default Video Duration
              </label>
              <select
                id="settings-duration"
                value={draft.defaultDuration}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultDuration: e.target.value as VideoDuration,
                  })
                }
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <span className="block text-xs font-medium text-[var(--text-muted)]">
                Download Export Format
              </span>
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(
                  [
                    { id: 'markdown', label: 'Markdown (.md)' },
                    { id: 'txt', label: 'Plain Text (.txt)' },
                    { id: 'json', label: 'Structured JSON (.json)' },
                  ] as const
                ).map((fmt) => {
                  const active = draft.exportFormat === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, exportFormat: fmt.id })}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                        active
                          ? 'border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-white'
                          : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex justify-end border-t border-[var(--border-default)] pt-4">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:from-violet-500 hover:to-blue-500"
            >
              <Save className="h-3.5 w-3.5" />
              <span>Save Preferences</span>
            </button>
          </div>
        </section>
      </form>

      {/* Section 5: Social Accounts */}
      <SocialAccountsPanel
        requirements={socialRequirements}
        connections={socialConnections}
        isLoading={isSocialLoading}
        busyPlatform={busySocialPlatform}
        onRefreshStatus={onRefreshSocialStatus}
        onConnect={onConnectSocialPlatform}
        onVerify={onVerifySocialConnection}
        onDisconnect={onDisconnectSocialPlatform}
        onCopyText={onCopyText}
      />

      {/* Section 6: Notifications */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] pb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Bell className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Notifications
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Control in-app alert banners and TopBar workspace notification logging
            </p>
          </div>
        </div>

        <div className="divide-y divide-[var(--border-default)]">
          {(
            [
              {
                key: 'inAppToasts' as const,
                title: 'Toast alerts for Studio & Copy actions',
                desc: 'Show brief toast popups when content is generated, saved, or copied.',
              },
              {
                key: 'assistantAlerts' as const,
                title: 'Autonomous Assistant completion alerts',
                desc: 'Notify when backend verification confirms clips and SRT subtitles are ready.',
              },
              {
                key: 'socialPublishAlerts' as const,
                title: 'Social publishing & token alerts',
                desc: 'Alert when posts are scheduled, published, or require OAuth attention.',
              },
            ] as const
          ).map((item) => {
            const enabled = notificationPrefs[item.key];
            return (
              <div
                key={item.key}
                className="flex items-center justify-between gap-4 py-3.5 first:pt-1 last:pb-1"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {item.desc}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={item.title}
                  onClick={() =>
                    onChangeNotificationPrefs({
                      ...notificationPrefs,
                      [item.key]: !enabled,
                    })
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                    enabled
                      ? 'border-violet-600 bg-violet-600'
                      : 'border-[var(--border-strong)] bg-[var(--bg-surface)]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                      enabled ? 'translate-x-5.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 7: Data & Export */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-4">
        <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] pb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Data &amp; Export
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Back up all saved Firestore projects as JSON or add clearly labeled starter demo projects.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onExportAllProjects}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)]"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export All Projects (.json)</span>
          </button>

          <button
            type="button"
            onClick={onLoadDemoProjects}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-amber-500/40 hover:text-amber-700 dark:hover:text-amber-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Add Demo Starter Projects</span>
          </button>
        </div>
      </section>
    </div>
  );
}
