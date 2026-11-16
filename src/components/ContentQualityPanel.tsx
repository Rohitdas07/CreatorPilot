import {
  AlertCircle,
  Check,
  CheckCircle2,
  Gauge,
  Loader2,
  RefreshCw,
  Wand2,
} from 'lucide-react';
import type {
  ContentQualityImprovement,
  ContentQualityScore,
  QualityFixTarget,
} from '../types/creator';

interface ContentQualityPanelProps {
  qualityScore?: ContentQualityScore;
  isScoring: boolean;
  scoreError: string | null;
  onRunScore: () => void;
  onApplyImprovement: (improvement: ContentQualityImprovement) => void;
  appliedFixIds: string[];
}

const TARGET_LABELS: Record<QualityFixTarget, string> = {
  hook: 'Reel Hook',
  reelScript: 'Instagram Reel Script',
  shortsScript: 'YouTube Shorts Script',
  caption: 'Instagram Caption',
  cta: 'Reel Call to Action',
};

function getScoreTone(score: number): {
  bar: string;
  text: string;
  badge: string;
} {
  if (score >= 82) {
    return {
      bar: 'bg-emerald-500',
      text: 'text-emerald-600 dark:text-emerald-400',
      badge: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }
  if (score >= 65) {
    return {
      bar: 'bg-violet-500',
      text: 'text-violet-600 dark:text-violet-400',
      badge: 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    };
  }
  return {
    bar: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    badge: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  };
}

export function ContentQualityPanel({
  qualityScore,
  isScoring,
  scoreError,
  onRunScore,
  onApplyImprovement,
  appliedFixIds,
}: ContentQualityPanelProps) {
  if (!qualityScore && !isScoring && !scoreError) {
    return null;
  }

  const scoreTone = qualityScore ? getScoreTone(qualityScore.overallScore) : null;

  const dimensionEntries = qualityScore
    ? [
        { key: 'hookStrength', label: 'Hook Strength', data: qualityScore.dimensions.hookStrength },
        { key: 'platformFit', label: 'Platform Fit & Pacing', data: qualityScore.dimensions.platformFit },
        {
          key: 'clarityAndStructure',
          label: 'Clarity & Structure',
          data: qualityScore.dimensions.clarityAndStructure,
        },
        {
          key: 'ctaEffectiveness',
          label: 'CTA Effectiveness',
          data: qualityScore.dimensions.ctaEffectiveness,
        },
        {
          key: 'brandVoiceAlignment',
          label: 'Brand Voice Alignment',
          data: qualityScore.dimensions.brandVoiceAlignment,
        },
      ]
    : [];

  return (
    <section
      aria-label="AI Content Quality Audit"
      className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)]"
    >
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-default)] pb-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400">
            <Gauge className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                AI Content Quality Score
              </h3>
              {qualityScore && scoreTone && (
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${scoreTone.badge}`}
                >
                  {qualityScore.gradeLabel}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Editorial audit across hook power, pacing, structure, CTA conversion &amp; brand voice
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRunScore}
          disabled={isScoring}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {isScoring ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-600 dark:text-violet-400" />
              <span>Scoring Bundle...</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              <span>{qualityScore ? 'Re-evaluate Score' : 'Run Quality Audit'}</span>
            </>
          )}
        </button>
      </div>

      {scoreError && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-xs text-rose-800 dark:text-rose-200"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span>{scoreError}</span>
        </div>
      )}

      {isScoring && !qualityScore && (
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="h-28 animate-pulse rounded-xl bg-[var(--bg-surface)]" />
          <div className="h-28 animate-pulse rounded-xl bg-[var(--bg-surface)] md:col-span-2" />
        </div>
      )}

      {qualityScore && scoreTone && (
        <div className="mt-5 space-y-6">
          {/* Top Overview Row: Score + Readability Strip */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="flex flex-col justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
              <div>
                <p className="text-xs font-medium text-[var(--text-muted)]">
                  Overall Readiness Score
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className={`font-mono text-4xl font-bold tracking-tight tabular-nums ${scoreTone.text}`}
                  >
                    {qualityScore.overallScore}
                  </span>
                  <span className="font-mono text-sm text-[var(--text-muted)] tabular-nums">
                    / 100
                  </span>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                {qualityScore.summary}
              </p>
              <p className="mt-3 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                Evaluated {new Date(qualityScore.evaluatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  Dimension Breakdown
                </p>
                <p className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                  {qualityScore.readability.wordCount} words · ~{qualityScore.readability.estimatedSpeakingSeconds}s read · {qualityScore.readability.hookCharCount}ch hook · {qualityScore.readability.hashtagCount} tags · {qualityScore.readability.captionLineCount} caption lines
                </p>
              </div>

              <div className="space-y-3">
                {dimensionEntries.map((dim) => {
                  const tone = getScoreTone(dim.data.score);
                  return (
                    <div key={dim.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-[var(--text-primary)]">
                          {dim.label}
                        </span>
                        <span className={`font-mono font-semibold tabular-nums ${tone.text}`}>
                          {dim.data.score}/100
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-default)]">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${tone.bar}`}
                          style={{ width: `${dim.data.score}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {dim.data.rationale}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Strengths + 1-Click Improvements */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                What&apos;s Working Well
              </p>
              <ul className="mt-3 space-y-2.5">
                {qualityScore.strengths.map((item, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-xs leading-relaxed text-[var(--text-secondary)]"
                  >
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3 xl:col-span-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  Actionable Refinements ({qualityScore.improvements.length})
                </p>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Apply directly to update your active draft
                </span>
              </div>

              {qualityScore.improvements.length === 0 ? (
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-xs text-[var(--text-muted)]">
                  No major weaknesses detected. Your draft is well-aligned for publishing.
                </div>
              ) : (
                <div className="space-y-3">
                  {qualityScore.improvements.map((imp) => {
                    const isApplied = appliedFixIds.includes(imp.id);
                    return (
                      <div
                        key={imp.id}
                        className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4"
                      >
                        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                          <div className="min-w-0">
                            <p className="text-[11px] font-mono font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                              {TARGET_LABELS[imp.targetSection]}
                            </p>
                            <p className="mt-0.5 text-xs font-semibold text-[var(--text-primary)]">
                              {imp.issue}
                            </p>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">
                              {imp.recommendation}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => onApplyImprovement(imp)}
                            disabled={isApplied}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                              isApplied
                                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-200 hover:bg-violet-500/20'
                            }`}
                          >
                            {isApplied ? (
                              <>
                                <Check className="h-3.5 w-3.5" />
                                <span>Applied</span>
                              </>
                            ) : (
                              <>
                                <Wand2 className="h-3.5 w-3.5" />
                                <span>Apply Fix</span>
                              </>
                            )}
                          </button>
                        </div>

                        <div className="mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                          <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                            Suggested Revision:
                          </span>
                          <p className="mt-1 whitespace-pre-line text-[var(--text-primary)]">
                            {imp.suggestedFix}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
