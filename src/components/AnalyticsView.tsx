import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  ExternalLink,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { generateAnalyticsInsights } from '../services/studioAiApi';
import type { AnalyticsInsightsResponse, AnalyticsSummaryInput } from '../types/analytics';
import type { AssistantTask } from '../types/assistant';
import type {
  CreatorProject,
  HistoryItem,
  Platform,
} from '../types/creator';
import type { SocialPlatform, SocialPost } from '../types/social';
import type { ThumbnailAsset } from '../types/thumbnail';
import type { VideoRenderJob } from '../types/videoEditor';

interface AnalyticsViewProps {
  history: HistoryItem[];
  projects: CreatorProject[];
  socialPosts: SocialPost[];
  assistantTasks: AssistantTask[];
  videoJobs: VideoRenderJob[];
  thumbnails: ThumbnailAsset[];
  onRefreshSocialAnalytics: (post: SocialPost) => Promise<void>;
  onOpenProject: (project: CreatorProject) => void;
  onNavigateToCreate: () => void;
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

type DateRangeKey = '7d' | '30d' | '90d' | 'all';
type PlatformFilter = 'All' | Platform;

const DATE_RANGES: Array<{ key: DateRangeKey; label: string; days: number | null }> = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'all', label: 'All Time', days: null },
];

const PLATFORM_FILTERS: PlatformFilter[] = [
  'All',
  'Instagram',
  'YouTube',
  'LinkedIn',
  'Facebook',
];

function mapSocialToPlatform(p: SocialPlatform): Platform {
  switch (p) {
    case 'instagram':
      return 'Instagram';
    case 'youtube':
      return 'YouTube';
    case 'linkedin':
      return 'LinkedIn';
    case 'facebook':
      return 'Facebook';
  }
}

function isWithinDays(iso: string | undefined, days: number | null): boolean {
  if (days === null) return true;
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return ts >= cutoff;
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function AnalyticsView({
  history,
  projects,
  socialPosts,
  assistantTasks,
  videoJobs,
  thumbnails,
  onRefreshSocialAnalytics,
  onOpenProject,
  onNavigateToCreate,
  onNotify,
}: AnalyticsViewProps) {
  const [dateRange, setDateRange] = useState<DateRangeKey>('30d');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('All');
  const [isRefreshingMetrics, setIsRefreshingMetrics] = useState(false);
  const [hoveredBucketIdx, setHoveredBucketIdx] = useState<number | null>(null);

  const [insights, setInsights] = useState<AnalyticsInsightsResponse | null>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

  const activeDays = useMemo(
    () => DATE_RANGES.find((d) => d.key === dateRange)?.days ?? null,
    [dateRange]
  );

  const filteredHistory = useMemo(
    () =>
      history.filter(
        (item) =>
          isWithinDays(item.createdAt, activeDays) &&
          (platformFilter === 'All' || item.config.platform === platformFilter)
      ),
    [history, activeDays, platformFilter]
  );

  const filteredProjects = useMemo(
    () =>
      projects.filter(
        (proj) =>
          isWithinDays(proj.updatedAt || proj.createdAt, activeDays) &&
          (platformFilter === 'All' || proj.config.platform === platformFilter)
      ),
    [projects, activeDays, platformFilter]
  );

  const filteredPosts = useMemo(
    () =>
      socialPosts.filter(
        (post) =>
          isWithinDays(post.publishedAt || post.scheduledFor || post.createdAt, activeDays) &&
          (platformFilter === 'All' || mapSocialToPlatform(post.platform) === platformFilter)
      ),
    [socialPosts, activeDays, platformFilter]
  );

  const filteredThumbnails = useMemo(
    () => thumbnails.filter((t) => isWithinDays(t.createdAt, activeDays)),
    [thumbnails, activeDays]
  );

  const filteredVideoJobs = useMemo(
    () =>
      videoJobs.filter(
        (v) => v.status === 'completed' && isWithinDays(v.createdAt, activeDays)
      ),
    [videoJobs, activeDays]
  );

  const publishedPosts = useMemo(
    () => filteredPosts.filter((p) => p.status === 'published'),
    [filteredPosts]
  );
  const scheduledPosts = useMemo(
    () => filteredPosts.filter((p) => p.status === 'scheduled'),
    [filteredPosts]
  );

  const kpis = useMemo(() => {
    const scoredItems = [
      ...filteredProjects
        .map((p) => p.result.qualityScore?.overallScore)
        .filter((s): s is number => typeof s === 'number'),
      ...filteredHistory
        .map((h) => h.result.qualityScore?.overallScore)
        .filter((s): s is number => typeof s === 'number'),
    ];
    const avgQualityScore =
      scoredItems.length > 0
        ? Math.round(scoredItems.reduce((acc, s) => acc + s, 0) / scoredItems.length)
        : null;

    let totalViewsAndReach = 0;
    let totalInteractions = 0;
    for (const post of publishedPosts) {
      const a = post.analytics;
      if (!a) continue;
      const views = Math.max(a.views || 0, a.reach || 0);
      totalViewsAndReach += views;
      totalInteractions += (a.likes || 0) + (a.comments || 0) + (a.shares || 0);
    }

    const engagementRate =
      totalViewsAndReach > 0
        ? ((totalInteractions / totalViewsAndReach) * 100).toFixed(1)
        : null;

    return {
      totalGenerations: filteredHistory.length,
      totalProjects: filteredProjects.length,
      avgQualityScore,
      scoredCount: scoredItems.length,
      publishedCount: publishedPosts.length,
      scheduledCount: scheduledPosts.length,
      totalViewsAndReach,
      totalInteractions,
      engagementRate,
      completedVideos: filteredVideoJobs.length,
      savedThumbnails: filteredThumbnails.length,
      completedAssistantTasks: assistantTasks.filter(
        (t) => t.status === 'completed' && isWithinDays(t.createdAt, activeDays)
      ).length,
    };
  }, [
    filteredHistory,
    filteredProjects,
    publishedPosts,
    scheduledPosts,
    filteredVideoJobs,
    filteredThumbnails,
    assistantTasks,
    activeDays,
  ]);

  // Platform Breakdown
  const platformBreakdown = useMemo(() => {
    const allPlatforms: Platform[] = ['Instagram', 'YouTube', 'LinkedIn', 'Facebook'];
    return allPlatforms.map((plat) => {
      const gens = filteredHistory.filter((h) => h.config.platform === plat).length;
      const postsForPlat = publishedPosts.filter(
        (p) => mapSocialToPlatform(p.platform) === plat
      );
      let views = 0;
      let interactions = 0;
      for (const p of postsForPlat) {
        if (!p.analytics) continue;
        views += Math.max(p.analytics.views || 0, p.analytics.reach || 0);
        interactions +=
          (p.analytics.likes || 0) +
          (p.analytics.comments || 0) +
          (p.analytics.shares || 0);
      }
      return {
        platform: plat,
        generations: gens,
        publishedPosts: postsForPlat.length,
        views,
        interactions,
      };
    });
  }, [filteredHistory, publishedPosts]);

  // Tone & Language Breakdown
  const toneCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of filteredHistory) {
      map.set(h.config.tone, (map.get(h.config.tone) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([tone, count]) => ({ tone, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredHistory]);

  const languageCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of filteredHistory) {
      map.set(h.config.language, (map.get(h.config.language) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredHistory]);

  // Interactive SVG Timeline Buckets (8 clean intervals)
  const timelineBuckets = useMemo(() => {
    const bucketCount = 8;
    const now = Date.now();
    const windowDays = activeDays ?? 120;
    const spanMs = windowDays * 24 * 60 * 60 * 1000;
    const startMs = now - spanMs;
    const stepMs = spanMs / bucketCount;

    const buckets = Array.from({ length: bucketCount }, (_, i) => {
      const bStart = startMs + i * stepMs;
      const bEnd = bStart + stepMs;
      const label = new Date(bEnd).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      return {
        label,
        startMs: bStart,
        endMs: bEnd,
        generations: 0,
        published: 0,
        visuals: 0,
      };
    });

    const placeIntoBucket = (iso: string | undefined, field: 'generations' | 'published' | 'visuals') => {
      if (!iso) return;
      const ts = Date.parse(iso);
      if (!Number.isFinite(ts) || ts < startMs || ts > now + 86400000) return;
      const idx = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor((ts - startMs) / stepMs))
      );
      buckets[idx][field] += 1;
    };

    for (const item of filteredHistory) placeIntoBucket(item.createdAt, 'generations');
    for (const post of publishedPosts) placeIntoBucket(post.publishedAt || post.createdAt, 'published');
    for (const thumb of filteredThumbnails) placeIntoBucket(thumb.createdAt, 'visuals');
    for (const job of filteredVideoJobs) placeIntoBucket(job.createdAt, 'visuals');

    const maxVal = Math.max(
      1,
      ...buckets.map((b) => Math.max(b.generations, b.published, b.visuals))
    );

    return { buckets, maxVal };
  }, [filteredHistory, publishedPosts, filteredThumbnails, filteredVideoJobs, activeDays]);

  const handleRefreshAllMetrics = async () => {
    const eligible = socialPosts.filter(
      (p) => p.status === 'published' && Boolean(p.externalPostId)
    );
    if (eligible.length === 0) {
      onNotify(
        'No live published posts to sync',
        'Publish a post via an official connected social account to fetch live platform metrics.',
        'info'
      );
      return;
    }

    setIsRefreshingMetrics(true);
    let refreshed = 0;
    try {
      for (const post of eligible) {
        await onRefreshSocialAnalytics(post);
        refreshed += 1;
      }
      onNotify(
        'Social metrics synced',
        `Updated live metrics for ${refreshed} published post${refreshed === 1 ? '' : 's'}.`,
        'success'
      );
    } finally {
      setIsRefreshingMetrics(false);
    }
  };

  const handleGenerateInsights = async () => {
    setIsGeneratingInsights(true);
    try {
      const summary: AnalyticsSummaryInput = {
        dateRangeLabel:
          DATE_RANGES.find((d) => d.key === dateRange)?.label || '30D',
        platformFilter,
        totalGenerations: kpis.totalGenerations,
        totalProjects: kpis.totalProjects,
        totalThumbnails: kpis.savedThumbnails,
        totalVideoJobs: kpis.completedVideos,
        avgQualityScore: kpis.avgQualityScore,
        scoredCount: kpis.scoredCount,
        publishedPostsCount: kpis.publishedCount,
        scheduledPostsCount: kpis.scheduledCount,
        totalReachAndViews: kpis.totalViewsAndReach,
        totalInteractions: kpis.totalInteractions,
        platformBreakdown,
        topTones: toneCounts.slice(0, 5),
        topLanguages: languageCounts.slice(0, 5),
      };
      const res = await generateAnalyticsInsights(summary);
      setInsights(res);
      onNotify(
        'AI Strategy Insights ready',
        'Generated prioritized recommendations from your workspace telemetry.',
        'success'
      );
    } catch (err) {
      onNotify(
        'Could not generate insights',
        err instanceof Error ? err.message : 'Gemini request failed.',
        'error'
      );
    } finally {
      setIsGeneratingInsights(false);
    }
  };

  const maxPlatGens = Math.max(1, ...platformBreakdown.map((p) => p.generations));

  // SVG Chart Geometry
  const chartW = 680;
  const chartH = 220;
  const padL = 32;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const buildPolylinePoints = (field: 'generations' | 'published' | 'visuals') => {
    const { buckets, maxVal } = timelineBuckets;
    return buckets
      .map((b, i) => {
        const x = padL + (i / Math.max(1, buckets.length - 1)) * plotW;
        const y = padT + plotH - (b[field] / maxVal) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  return (
    <div className="space-y-8">
      {/* Header & Filter Controls */}
      <section className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)] lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
            Creator Analytics
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Real production output, quality scores, and verified social distribution metrics across your workspace.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div
            role="group"
            aria-label="Date range"
            className="inline-flex rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1"
          >
            {DATE_RANGES.map((dr) => (
              <button
                key={dr.key}
                type="button"
                onClick={() => setDateRange(dr.key)}
                className={`rounded-lg px-2.5 py-1.5 font-mono text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  dateRange === dr.key
                    ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {dr.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter analytics by platform"
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as PlatformFilter)}
            className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
          >
            {PLATFORM_FILTERS.map((pf) => (
              <option key={pf} value={pf}>
                {pf === 'All' ? 'All Platforms' : pf}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void handleRefreshAllMetrics()}
            disabled={isRefreshingMetrics}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-violet-500/40 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshingMetrics ? 'animate-spin' : ''}`}
            />
            <span>Refresh Social Metrics</span>
          </button>
        </div>
      </section>

      {/* 4 KPI Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)]">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            AI Content Generated
          </p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-3xl font-bold text-[var(--text-primary)] tabular-nums">
              {kpis.totalGenerations}
            </span>
            <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
              {kpis.totalProjects} projects
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
            {kpis.avgQualityScore !== null
              ? `Avg Quality: ${kpis.avgQualityScore}/100 (${kpis.scoredCount} scored)`
              : 'Run Analyze Quality in Studio to score drafts'}
          </p>
        </article>

        <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)]">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            Social Distribution
          </p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-3xl font-bold text-[var(--text-primary)] tabular-nums">
              {kpis.publishedCount}
            </span>
            <span className="font-mono text-xs text-violet-600 dark:text-violet-400 tabular-nums">
              {kpis.scheduledCount} scheduled
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
            {kpis.completedVideos} rendered clips · {kpis.savedThumbnails} thumbnails
          </p>
        </article>

        <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)]">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            Verified Views &amp; Reach
          </p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-3xl font-bold text-[var(--text-primary)] tabular-nums">
              {formatCompactNumber(kpis.totalViewsAndReach)}
            </span>
            <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
              {kpis.publishedCount} live posts
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-[var(--text-muted)]">
            Synced directly from official platform APIs
          </p>
        </article>

        <article className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)]">
          <p className="text-xs font-medium text-[var(--text-muted)]">
            Total Interactions
          </p>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-3xl font-bold text-[var(--text-primary)] tabular-nums">
              {formatCompactNumber(kpis.totalInteractions)}
            </span>
            <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400 tabular-nums">
              {kpis.engagementRate !== null ? `${kpis.engagementRate}% ER` : '—'}
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
            Likes + comments + shares across connected channels
          </p>
        </article>
      </section>

      {/* Interactive SVG Activity Chart & Content Mix */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Production &amp; Publishing Cadence
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Output velocity across AI generations, published social posts, and visual/video exports
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                Generations
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Published
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                Videos &amp; Thumbnails
              </span>
            </div>
          </div>

          <div className="relative mt-4">
            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              className="h-56 w-full overflow-visible"
              role="img"
              aria-label="Creator output timeline chart"
            >
              {/* Horizontal Grid Lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                const y = padT + plotH * (1 - ratio);
                const val = Math.round(timelineBuckets.maxVal * ratio);
                return (
                  <g key={idx}>
                    <line
                      x1={padL}
                      y1={y}
                      x2={chartW - padR}
                      y2={y}
                      stroke="currentColor"
                      className="text-[var(--border-default)]"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={padL - 8}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-[var(--text-muted)] font-mono text-[10px]"
                    >
                      {val}
                    </text>
                  </g>
                );
              })}

              {/* Lines */}
              <polyline
                fill="none"
                stroke="#8b5cf6"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={buildPolylinePoints('generations')}
              />
              <polyline
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={buildPolylinePoints('published')}
              />
              <polyline
                fill="none"
                stroke="#0ea5e9"
                strokeWidth="2"
                strokeDasharray="5 4"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={buildPolylinePoints('visuals')}
              />

              {/* Interactive Bucket Nodes & X Labels */}
              {timelineBuckets.buckets.map((bucket, idx) => {
                const x =
                  padL +
                  (idx / Math.max(1, timelineBuckets.buckets.length - 1)) * plotW;
                const yGen =
                  padT + plotH - (bucket.generations / timelineBuckets.maxVal) * plotH;
                const yPub =
                  padT + plotH - (bucket.published / timelineBuckets.maxVal) * plotH;
                const yVis =
                  padT + plotH - (bucket.visuals / timelineBuckets.maxVal) * plotH;
                const isHovered = hoveredBucketIdx === idx;

                return (
                  <g key={idx}>
                    {isHovered && (
                      <line
                        x1={x}
                        y1={padT}
                        x2={x}
                        y2={padT + plotH}
                        stroke="currentColor"
                        className="text-[var(--border-strong)]"
                      />
                    )}
                    <circle cx={x} cy={yGen} r={isHovered ? 5 : 3.5} fill="#8b5cf6" />
                    <circle cx={x} cy={yPub} r={isHovered ? 5 : 3.5} fill="#10b981" />
                    <circle cx={x} cy={yVis} r={isHovered ? 4.5 : 3} fill="#0ea5e9" />
                    <text
                      x={x}
                      y={chartH - 6}
                      textAnchor="middle"
                      className="fill-[var(--text-muted)] font-mono text-[10px]"
                    >
                      {bucket.label}
                    </text>
                    <rect
                      x={x - plotW / (timelineBuckets.buckets.length * 2)}
                      y={padT}
                      width={plotW / timelineBuckets.buckets.length}
                      height={plotH + 10}
                      fill="transparent"
                      onMouseEnter={() => setHoveredBucketIdx(idx)}
                      onMouseLeave={() => setHoveredBucketIdx(null)}
                    />
                  </g>
                );
              })}
            </svg>

            {hoveredBucketIdx !== null && timelineBuckets.buckets[hoveredBucketIdx] && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs">
                <span className="font-mono font-semibold text-[var(--text-primary)]">
                  Window ending {timelineBuckets.buckets[hoveredBucketIdx].label}
                </span>
                <span className="font-mono text-[var(--text-secondary)] tabular-nums">
                  {timelineBuckets.buckets[hoveredBucketIdx].generations} generations ·{' '}
                  {timelineBuckets.buckets[hoveredBucketIdx].published} published ·{' '}
                  {timelineBuckets.buckets[hoveredBucketIdx].visuals} visual/video assets
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Tone & Language Content Mix */}
        <section className="space-y-5 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)]">
          <div className="border-b border-[var(--border-default)] pb-4">
            <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Content Voice &amp; Language Mix
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Distribution across your Studio runs
            </p>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="py-8 text-center">
              <BarChart3 className="mx-auto h-7 w-7 text-[var(--text-muted)]/60" />
              <p className="mt-2 text-xs font-medium text-[var(--text-primary)]">
                No Studio generations in this filter window
              </p>
              <button
                type="button"
                onClick={onNavigateToCreate}
                className="mt-3 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
              >
                Create Content
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-[var(--text-secondary)]">
                  Tones Used
                </p>
                <div className="mt-2.5 space-y-2">
                  {toneCounts.map((item) => {
                    const pct = Math.round((item.count / filteredHistory.length) * 100);
                    return (
                      <div key={item.tone} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-primary)]">{item.tone}</span>
                          <span className="font-mono text-[var(--text-muted)] tabular-nums">
                            {item.count} ({pct}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
                          <div
                            className="h-full rounded-full bg-violet-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-[var(--border-default)] pt-4">
                <p className="text-xs font-semibold text-[var(--text-secondary)]">
                  Languages
                </p>
                <div className="mt-2 space-y-1.5">
                  {languageCounts.map((item) => (
                    <div
                      key={item.language}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-[var(--text-primary)]">{item.language}</span>
                      <span className="font-mono text-[var(--text-muted)] tabular-nums">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Platform Breakdown & AI Strategy Insights */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)]">
          <div className="border-b border-[var(--border-default)] pb-4">
            <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Platform Output &amp; Reach Breakdown
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Studio volume compared against live social publishing performance
            </p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-[var(--text-muted)]">
                  <th className="pb-2.5 font-medium">Platform</th>
                  <th className="pb-2.5 text-right font-medium">Generated</th>
                  <th className="pb-2.5 text-right font-medium">Published</th>
                  <th className="pb-2.5 text-right font-medium">Views</th>
                  <th className="pb-2.5 text-right font-medium">Interactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {platformBreakdown.map((row) => (
                  <tr key={row.platform}>
                    <td className="py-3 pr-3 font-medium text-[var(--text-primary)]">
                      <div>{row.platform}</div>
                      <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-[var(--bg-surface)]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-600 to-blue-600"
                          style={{
                            width: `${Math.round((row.generations / maxPlatGens) * 100)}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-[var(--text-primary)]">
                      {row.generations}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {row.publishedPosts}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-[var(--text-secondary)]">
                      {formatCompactNumber(row.views)}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatCompactNumber(row.interactions)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* AI Performance Strategist */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  AI Growth Strategist
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Gemini analysis grounded strictly in your workspace metrics
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleGenerateInsights()}
              disabled={isGeneratingInsights}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-all hover:from-violet-500 hover:to-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {isGeneratingInsights ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Generate AI Insights</span>
                </>
              )}
            </button>
          </div>

          {!insights ? (
            <div className="py-10 text-center">
              <Sparkles className="mx-auto h-7 w-7 text-violet-500/70" />
              <p className="mt-2.5 text-sm font-medium text-[var(--text-primary)]">
                Turn your metrics into an action plan
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Click Generate AI Insights to evaluate your quality scores, platform balance, and publishing cadence.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                {insights.headlineSummary}
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    Top Strength
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {insights.topStrength}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    Biggest Opportunity
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {insights.biggestOpportunity}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                {insights.recommendations.map((rec, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {rec.title}
                      </span>
                      <span
                        className={`font-mono text-[10px] font-semibold uppercase ${
                          rec.priority === 'high'
                            ? 'text-rose-600 dark:text-rose-400'
                            : rec.priority === 'medium'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-sky-600 dark:text-sky-400'
                        }`}
                      >
                        {rec.priority} priority
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {rec.action}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      Impact: {rec.expectedImpact}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Content Quality & Published Posts Ledger */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Projects &amp; Published Content Ledger
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Quality audit scores for saved projects and live engagement metrics for published social posts
            </p>
          </div>
        </div>

        {filteredProjects.length === 0 && publishedPosts.length === 0 ? (
          <div className="py-10 text-center">
            <Gauge className="mx-auto h-7 w-7 text-[var(--text-muted)]/60" />
            <p className="mt-2 text-xs font-medium text-[var(--text-primary)]">
              No projects or published social posts found for this filter
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-[var(--text-muted)]">
                  <th className="pb-2.5 pr-4 font-medium">Item</th>
                  <th className="pb-2.5 pr-4 font-medium">Type</th>
                  <th className="pb-2.5 pr-4 font-medium">Platform</th>
                  <th className="pb-2.5 pr-4 text-right font-medium">Quality / Reach</th>
                  <th className="pb-2.5 pr-4 text-right font-medium">Updated</th>
                  <th className="pb-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {publishedPosts.slice(0, 10).map((post) => {
                  const views = Math.max(
                    post.analytics?.views || 0,
                    post.analytics?.reach || 0
                  );
                  const interactions =
                    (post.analytics?.likes || 0) +
                    (post.analytics?.comments || 0) +
                    (post.analytics?.shares || 0);
                  return (
                    <tr key={`post-${post.id}`}>
                      <td className="py-3 pr-4 font-medium text-[var(--text-primary)] max-w-[260px] truncate">
                        {post.title || post.caption.slice(0, 60)}
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-muted)]">Published Post</td>
                      <td className="py-3 pr-4 text-[var(--text-secondary)]">
                        {mapSocialToPlatform(post.platform)}
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-[var(--text-primary)]">
                        {formatCompactNumber(views)} views · {formatCompactNumber(interactions)} eng
                      </td>
                      <td className="py-3 pr-4 text-right font-mono tabular-nums text-[var(--text-muted)]">
                        {new Date(post.publishedAt || post.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          {post.externalPostId && (
                            <button
                              type="button"
                              onClick={() => void onRefreshSocialAnalytics(post)}
                              className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-violet-500/40 whitespace-nowrap"
                            >
                              <RefreshCw className="h-3 w-3" />
                              <span>Sync</span>
                            </button>
                          )}
                          {post.externalPostUrl && (
                            <a
                              href={post.externalPostUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="View published post"
                              className="inline-flex items-center text-violet-600 dark:text-violet-400 hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredProjects.slice(0, 12).map((proj) => (
                  <tr key={`proj-${proj.id}`}>
                    <td className="py-3 pr-4 font-medium text-[var(--text-primary)] max-w-[260px] truncate">
                      {proj.title}
                    </td>
                    <td className="py-3 pr-4 text-[var(--text-muted)]">Saved Project</td>
                    <td className="py-3 pr-4 text-[var(--text-secondary)]">
                      {proj.config.platform}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums">
                      {proj.result.qualityScore ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {proj.result.qualityScore.overallScore}/100
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">Not scored</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono tabular-nums text-[var(--text-muted)]">
                      {new Date(proj.updatedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenProject(proj)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-violet-500/40 whitespace-nowrap"
                      >
                        <span>Open</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
