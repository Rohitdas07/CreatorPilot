import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Download,
  History,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { HistoryItem, Platform } from '../types/creator';

interface HistoryViewProps {
  history: HistoryItem[];
  isLoading?: boolean;
  onRestoreItem: (item: HistoryItem) => void;
  onDownloadItem: (item: HistoryItem) => void;
  onDeleteItem: (id: string) => void;
  onClearHistory: () => void;
  onCreateNew: () => void;
}

const PLATFORM_FILTERS: Array<'All' | Platform> = [
  'All',
  'Instagram',
  'YouTube',
  'Facebook',
  'LinkedIn',
];

export function HistoryView({
  history,
  isLoading = false,
  onRestoreItem,
  onDownloadItem,
  onDeleteItem,
  onClearHistory,
  onCreateNew,
}: HistoryViewProps) {
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'All' | Platform>('All');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return history.filter((item) => {
      const matchesPlatform =
        platformFilter === 'All' || item.config.platform === platformFilter;
      const matchesQuery =
        !q ||
        item.sourcePreview.toLowerCase().includes(q) ||
        item.result.instagramReel.title.toLowerCase().includes(q) ||
        item.config.tone.toLowerCase().includes(q);
      return matchesPlatform && matchesQuery;
    });
  }, [history, query, platformFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
            Content History
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Chronological log of every content bundle generated in CreatorPilot AI.
          </p>
        </div>

        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-300 whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear History</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search generation history..."
            className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-1">
          {PLATFORM_FILTERS.map((opt) => {
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

      {/* History List */}
      {isLoading ? (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] divide-y divide-[var(--border-default)]">
          {[1, 2, 3].map((idx) => (
            <div key={idx} className="p-5 space-y-2.5">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-[var(--bg-surface)]" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--bg-surface)]" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-card)] py-16 text-center px-6">
          <History className="h-9 w-9 text-[var(--text-muted)]" />
          <p className="mt-3 text-base font-semibold text-[var(--text-primary)]">
            {history.length === 0 ? 'No generation history yet' : 'No matching entries'}
          </p>
          <p className="mt-1 max-w-sm text-xs text-[var(--text-muted)]">
            Every time you click Generate Content, your multi-platform package is automatically recorded here.
          </p>
          {history.length === 0 && (
            <button
              type="button"
              onClick={onCreateNew}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Generate First Bundle</span>
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] shadow-[var(--shadow-card)]">
          <div className="divide-y divide-[var(--border-default)]">
            {filtered.map((item) => {
              const timestamp = new Date(item.createdAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              });

              return (
                <div
                  key={item.id}
                  className="flex flex-col justify-between gap-4 p-5 transition-colors hover:bg-[var(--bg-surface)]/65 lg:flex-row lg:items-center"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          item.result.engine === 'gemini'
                            ? 'border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {item.result.engine === 'gemini' ? 'AI Generated' : 'Demo'}
                      </span>
                      <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                        {timestamp}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.config.platform}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.config.tone}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{item.config.duration}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.config.language}</span>
                    </div>

                    <h2 className="truncate font-display text-sm font-semibold text-[var(--text-primary)]">
                      {item.result.instagramReel.title}
                    </h2>
                    <p className="line-clamp-1 text-xs text-[var(--text-muted)]">
                      {item.sourcePreview}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onRestoreItem(item)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-violet-500/40 hover:bg-violet-600 hover:text-white whitespace-nowrap"
                    >
                      <span>Load in Studio</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownloadItem(item)}
                      aria-label="Download history entry"
                      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      aria-label="Delete history entry"
                      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 text-[var(--text-muted)] transition-colors hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
