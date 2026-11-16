import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Copy,
  Download,
  Facebook,
  FolderKanban,
  Instagram,
  Linkedin,
  Search,
  Sparkles,
  Trash2,
  Youtube,
} from 'lucide-react';
import type { CreatorProject, Platform } from '../types/creator';

interface ProjectsViewProps {
  projects: CreatorProject[];
  isLoading?: boolean;
  onOpenProject: (project: CreatorProject) => void;
  onDuplicateProject: (project: CreatorProject) => void;
  onDownloadProject: (project: CreatorProject) => void;
  onDeleteProject: (id: string) => void;
  onCreateNew: () => void;
}

const FILTER_OPTIONS: Array<'All' | Platform> = [
  'All',
  'Instagram',
  'YouTube',
  'Facebook',
  'LinkedIn',
];

const PLATFORM_VISUALS: Record<
  Platform,
  {
    icon: typeof Instagram;
    bannerBg: string;
    iconColor: string;
  }
> = {
  Instagram: {
    icon: Instagram,
    bannerBg: 'from-violet-500/12 via-fuchsia-500/8 to-blue-500/10',
    iconColor: 'text-violet-600 dark:text-violet-300',
  },
  YouTube: {
    icon: Youtube,
    bannerBg: 'from-rose-500/12 via-violet-500/8 to-blue-500/10',
    iconColor: 'text-rose-600 dark:text-rose-300',
  },
  LinkedIn: {
    icon: Linkedin,
    bannerBg: 'from-blue-500/12 via-indigo-500/8 to-violet-500/10',
    iconColor: 'text-blue-600 dark:text-blue-300',
  },
  Facebook: {
    icon: Facebook,
    bannerBg: 'from-sky-500/12 via-blue-500/8 to-violet-500/10',
    iconColor: 'text-sky-600 dark:text-sky-300',
  },
};

export function ProjectsView({
  projects,
  isLoading = false,
  onOpenProject,
  onDuplicateProject,
  onDownloadProject,
  onDeleteProject,
  onCreateNew,
}: ProjectsViewProps) {
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'All' | Platform>('All');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((proj) => {
      const matchesPlatform =
        platformFilter === 'All' || proj.config.platform === platformFilter;
      const matchesQuery =
        !q ||
        proj.title.toLowerCase().includes(q) ||
        proj.config.sourceText.toLowerCase().includes(q) ||
        proj.config.tone.toLowerCase().includes(q);
      return matchesPlatform && matchesQuery;
    });
  }, [projects, query, platformFilter]);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
            My Projects
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Saved multi-platform campaigns ready to edit, duplicate, or export.
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateNew}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:from-violet-500 hover:to-blue-500 whitespace-nowrap shrink-0"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>New Project</span>
        </button>
      </div>

      {/* Search & Platform Filter Bar */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search saved projects..."
            className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-1">
          {FILTER_OPTIONS.map((opt) => {
            const active = platformFilter === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setPlatformFilter(opt)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 space-y-4"
            >
              <div className="h-16 w-full animate-pulse rounded-xl bg-[var(--bg-surface)]" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--bg-surface)]" />
              <div className="h-10 w-full animate-pulse rounded bg-[var(--bg-surface)]" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)] py-16 text-center px-6">
          <FolderKanban className="h-9 w-9 text-[var(--text-muted)]" />
          <p className="mt-3 text-base font-semibold text-[var(--text-primary)]">
            {projects.length === 0 ? 'No saved projects yet' : 'No matching projects'}
          </p>
          <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
            {projects.length === 0
              ? 'Generate multi-platform content in the Studio and click Save Project to build your library.'
              : 'Try adjusting your search query or platform filter.'}
          </p>
          {projects.length === 0 && (
            <button
              type="button"
              onClick={onCreateNew}
              className="mt-5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white"
            >
              Open Content Studio
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => {
            const updatedDate = new Date(project.updatedAt).toLocaleDateString(
              'en-US',
              {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              }
            );
            const createdDate = new Date(project.createdAt).toLocaleDateString(
              'en-US',
              {
                month: 'short',
                day: 'numeric',
              }
            );
            const visual =
              PLATFORM_VISUALS[project.config.platform] ||
              PLATFORM_VISUALS.Instagram;
            const PlatformIcon = visual.icon;

            return (
              <article
                key={project.id}
                className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] shadow-[var(--shadow-card)] transition-colors hover:border-[var(--border-strong)]"
              >
                <div>
                  {/* Platform Visual Header */}
                  <div
                    className={`flex items-center justify-between gap-2 border-b border-[var(--border-default)] bg-gradient-to-r ${visual.bannerBg} px-5 py-3.5`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)]">
                        <PlatformIcon className={`h-4 w-4 ${visual.iconColor}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                          {project.config.platform}
                        </p>
                        <p className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                          {project.config.language} · {project.config.duration}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                        project.result.engine === 'gemini'
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {project.result.engine === 'gemini' ? 'AI Generated' : 'Demo'}
                    </span>
                  </div>

                  <div className="p-5 pb-0">
                    <h2 className="font-display text-base font-semibold text-[var(--text-primary)] line-clamp-1">
                      {project.title}
                    </h2>
                    <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                      {project.config.tone} · Created {createdDate} · Updated {updatedDate}
                    </p>

                    <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                      {project.config.sourceText || project.result.instagramReel.hook}
                    </p>
                  </div>
                </div>

                <div className="m-5 mb-5 flex items-center justify-between gap-2 border-t border-[var(--border-default)] pt-4">
                  <button
                    type="button"
                    onClick={() => onOpenProject(project)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-violet-500/40 hover:bg-violet-600 hover:text-white whitespace-nowrap"
                  >
                    <span>Open</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onDuplicateProject(project)}
                      aria-label={`Duplicate ${project.title}`}
                      title="Duplicate project"
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-1.5 text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownloadProject(project)}
                      aria-label={`Download ${project.title}`}
                      title="Download content"
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-1.5 text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteProject(project.id)}
                      aria-label={`Delete ${project.title}`}
                      title="Delete project"
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-1.5 text-[var(--text-muted)] transition-colors hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
