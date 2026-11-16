import type { ReactNode } from 'react';
import { Monitor, Moon, Sun, Zap } from 'lucide-react';
import { StudioPipelineDiagram } from './StudioPipelineDiagram';
import { useTheme, type ThemeMode } from '../../context/ThemeContext';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

const THEME_OPTIONS: Array<{
  mode: ThemeMode;
  label: string;
  icon: typeof Sun;
}> = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
];

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  const { themeMode, setThemeMode } = useTheme();

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col lg:grid lg:grid-cols-2 transition-colors duration-200">
      {/* Left Column: Branding, Illustration & Tagline */}
      <div className="relative flex flex-col justify-between overflow-hidden border-b border-[var(--border-default)] bg-[var(--bg-sidebar)] p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-amber-500/8 dark:bg-amber-500/12 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-teal-500/8 dark:bg-teal-500/12 blur-3xl"
        />

        {/* Brand Header + Mobile Theme Switcher */}
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-md">
              <Zap className="h-5 w-5" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight text-[var(--text-primary)]">
              CreatorPilot AI
            </span>
          </div>

          <div
            role="group"
            aria-label="Theme mode"
            className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-1 lg:hidden"
          >
            {THEME_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = themeMode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setThemeMode(opt.mode)}
                  aria-label={`${opt.label} theme`}
                  aria-pressed={active}
                  className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                    active
                      ? 'bg-[var(--bg-card)] text-violet-600 dark:text-violet-300 shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Center Interactive Studio Pipeline & Tagline */}
        <div className="relative z-10 my-8 lg:my-0 space-y-6">
          <StudioPipelineDiagram />

          <div className="space-y-2.5 max-w-lg">
            <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl text-balance">
              Create Once. Publish Everywhere.
            </h1>
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
              Transform a single script, transcript, audio recording, or video into ready-to-publish Instagram Reels, YouTube Shorts, captions, hashtags, and platform-native posts.
            </p>
          </div>
        </div>

        {/* Subtle Footer Note */}
        <div className="relative z-10 hidden text-xs text-[var(--text-muted)] lg:block">
          CreatorPilot AI · Autonomous Multi-Platform Content Workspace
        </div>
      </div>

      {/* Right Column: Theme Toggle + Form Card */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-8 lg:px-12">
        {/* Desktop Theme Switcher */}
        <div className="hidden lg:flex absolute top-6 right-8 items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-1 shadow-xs">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = themeMode === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                onClick={() => setThemeMode(opt.mode)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  active
                    ? 'bg-gradient-to-r from-violet-600/15 to-blue-600/15 text-violet-700 dark:text-violet-200 border border-violet-500/30'
                    : 'text-[var(--text-muted)] border border-transparent hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-popover)] sm:p-8">
            <div className="mb-6">
              <h2 className="font-display text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                {title}
              </h2>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">{subtitle}</p>
            </div>

            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
