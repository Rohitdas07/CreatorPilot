import { useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Clapperboard,
  Copy,
  Download,
  Edit3,
  FileSearch,
  Gauge,
  Hash,
  Image as ImageIcon,
  Instagram,
  LayoutGrid,
  Linkedin,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Youtube,
  Zap,
} from 'lucide-react';
import { scoreGeneratedContent } from '../services/studioAiApi';
import type {
  ContentQualityImprovement,
  GeneratedContent,
  Platform,
  Tone,
  VideoDuration,
} from '../types/creator';
import type {
  SocialMediaType,
  SocialPlatform,
  YouTubePrivacyStatus,
} from '../types/social';
import { ContentQualityPanel } from './ContentQualityPanel';

export interface StageSocialPostInput {
  platform: SocialPlatform;
  title?: string;
  caption: string;
  hashtags?: string[];
  mediaType: SocialMediaType;
  mediaUrl?: string;
  youtubePrivacy?: YouTubePrivacyStatus;
  projectId?: string;
}

interface GeneratedResultsGridProps {
  result: GeneratedContent;
  onUpdateResult: (updated: GeneratedContent) => void;
  onCopyText: (text: string, label: string) => void;
  onRegenerate: () => void;
  onSaveProject: (title: string, mode: 'new' | 'update') => void;
  onDownload: () => void;
  onClearAll: () => void;
  onStageSocialPost?: (draft: StageSocialPostInput) => Promise<void>;
  onCreateThumbnail?: () => void;
  onCreateAiVideo?: () => void;
  onNotify?: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
  platform?: Platform;
  tone?: Tone;
  duration?: VideoDuration;
  niche?: string;
  brandVoice?: string;
  isGenerating: boolean;
  defaultProjectTitle: string;
  activeProject?: { id: string; title: string } | null;
}

type CardKey = 'reel' | 'shorts' | 'caption' | 'hashtags' | 'posts';
type ResultTab =
  | 'all'
  | 'reels'
  | 'shorts'
  | 'captions'
  | 'hashtags'
  | 'linkedin'
  | 'facebook';

const RESULT_TABS: Array<{ id: ResultTab; label: string; icon: typeof LayoutGrid }> = [
  { id: 'all', label: 'All Outputs', icon: LayoutGrid },
  { id: 'reels', label: 'Instagram Reels', icon: Instagram },
  { id: 'shorts', label: 'YouTube Shorts', icon: Youtube },
  { id: 'captions', label: 'Captions', icon: MessageSquare },
  { id: 'hashtags', label: 'Hashtags', icon: Hash },
  { id: 'linkedin', label: 'LinkedIn Posts', icon: Linkedin },
  { id: 'facebook', label: 'Facebook Posts', icon: Share2 },
];

export function GeneratedResultsGrid({
  result,
  onUpdateResult,
  onCopyText,
  onRegenerate,
  onSaveProject,
  onDownload,
  onClearAll,
  onStageSocialPost,
  onCreateThumbnail,
  onCreateAiVideo,
  onNotify,
  platform,
  tone,
  duration,
  niche,
  brandVoice,
  isGenerating,
  defaultProjectTitle,
  activeProject,
}: GeneratedResultsGridProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>('all');
  const [editingCards, setEditingCards] = useState<Record<CardKey, boolean>>({
    reel: false,
    shorts: false,
    caption: false,
    hashtags: false,
    posts: false,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [projectTitle, setProjectTitle] = useState(defaultProjectTitle);
  const [isScoring, setIsScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [appliedFixIds, setAppliedFixIds] = useState<string[]>([]);

  const isAiGenerated = result.engine === 'gemini';

  const handleRunQualityScore = async () => {
    setIsScoring(true);
    setScoreError(null);
    setAppliedFixIds([]);
    try {
      const qualityScore = await scoreGeneratedContent({
        result,
        platform,
        tone,
        duration,
        niche,
        brandVoice,
      });
      onUpdateResult({
        ...result,
        qualityScore,
      });
      onNotify?.(
        `Quality Audit: ${qualityScore.overallScore}/100`,
        `${qualityScore.gradeLabel} · ${qualityScore.improvements.length} refinements suggested.`,
        'success'
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not evaluate content quality.';
      setScoreError(msg);
      onNotify?.('Quality evaluation failed', msg, 'error');
    } finally {
      setIsScoring(false);
    }
  };

  const handleApplyImprovement = (imp: ContentQualityImprovement) => {
    let updated: GeneratedContent = result;
    if (imp.targetSection === 'hook') {
      updated = {
        ...result,
        instagramReel: { ...result.instagramReel, hook: imp.suggestedFix },
      };
    } else if (imp.targetSection === 'reelScript') {
      updated = {
        ...result,
        instagramReel: { ...result.instagramReel, script: imp.suggestedFix },
      };
    } else if (imp.targetSection === 'shortsScript') {
      updated = {
        ...result,
        youtubeShorts: { ...result.youtubeShorts, script: imp.suggestedFix },
      };
    } else if (imp.targetSection === 'caption') {
      updated = {
        ...result,
        instagramCaption: { caption: imp.suggestedFix },
      };
    } else if (imp.targetSection === 'cta') {
      updated = {
        ...result,
        instagramReel: { ...result.instagramReel, cta: imp.suggestedFix },
      };
    }
    onUpdateResult(updated);
    setAppliedFixIds((prev) => (prev.includes(imp.id) ? prev : [...prev, imp.id]));
    onNotify?.(
      'Improvement applied',
      'Updated the active draft with the AI revision.',
      'success'
    );
  };

  const triggerCopy = (id: string, text: string, label: string) => {
    onCopyText(text, label);
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 1800);
  };

  const toggleEdit = (card: CardKey) => {
    setEditingCards((prev) => ({ ...prev, [card]: !prev[card] }));
  };

  const handleConfirmSave = (mode: 'new' | 'update') => {
    const cleanTitle =
      projectTitle.trim() || defaultProjectTitle || 'Untitled Creator Project';
    onSaveProject(cleanTitle, mode);
    setShowSaveInput(false);
  };

  const copyButtonLabel = (id: string, defaultLabel = 'Copy') =>
    copiedId === id ? 'Copied' : defaultLabel;

  const showAnalysisAndHooks = activeTab === 'all';
  const showReel = activeTab === 'all' || activeTab === 'reels';
  const showShorts = activeTab === 'all' || activeTab === 'shorts';
  const showCaption = activeTab === 'all' || activeTab === 'captions';
  const showHashtags = activeTab === 'all' || activeTab === 'hashtags';
  const showAllPlatformPosts = activeTab === 'all';
  const showSingleLinkedIn = activeTab === 'linkedin';
  const showSingleFacebook = activeTab === 'facebook';

  return (
    <section aria-label="Generated Content Results" className="space-y-6">
      {/* Results Toolbar */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)] lg:flex-row lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-xl font-bold text-[var(--text-primary)]">
              Generated Multi-Platform Content
            </h2>
            {isAiGenerated ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                <Sparkles className="h-3 w-3" />
                <span>AI Generated · Gemini</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                <span>Demo Content</span>
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Analysis, multi-hook variations &amp; 5 platform-ready outputs · Click Edit on any card to customize copy before saving or exporting
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRunQualityScore()}
            disabled={isScoring || isGenerating}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isScoring ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Gauge className="h-3.5 w-3.5" />
            )}
            <span>
              {result.qualityScore
                ? `Score: ${result.qualityScore.overallScore}/100`
                : 'Analyze Quality'}
            </span>
          </button>

          {onCreateThumbnail && (
            <button
              type="button"
              onClick={onCreateThumbnail}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-violet-500/40 whitespace-nowrap shrink-0"
            >
              <ImageIcon className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
              <span>Create Thumbnail</span>
            </button>
          )}

          {onCreateAiVideo && (
            <button
              type="button"
              onClick={onCreateAiVideo}
              className="inline-flex items-center gap-2 rounded-xl border border-blue-500/35 bg-blue-500/10 px-3.5 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 transition-colors hover:bg-blue-500/20 whitespace-nowrap shrink-0"
            >
              <Clapperboard className="h-3.5 w-3.5" />
              <span>Generate AI Video</span>
            </button>
          )}

          <button
            type="button"
            onClick={onRegenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            <span>Regenerate</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setProjectTitle(defaultProjectTitle);
              setShowSaveInput((v) => !v);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-500/35 bg-violet-500/10 px-3.5 py-2 text-xs font-semibold text-violet-700 dark:text-violet-200 transition-colors hover:bg-violet-500/20 whitespace-nowrap shrink-0"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            <span>{activeProject ? 'Save to Project' : 'Save Project'}</span>
          </button>

          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-500/35 bg-blue-500/10 px-3.5 py-2 text-xs font-semibold text-blue-700 dark:text-blue-200 transition-colors hover:bg-blue-500/20 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download Content</span>
          </button>

          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-muted)] transition-colors hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-300 whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clear All</span>
          </button>
        </div>
      </div>

      {/* Inline Save Project Bar */}
      {showSaveInput && (
        <div className="flex flex-col gap-3 rounded-2xl border border-violet-500/35 bg-[var(--bg-card)] p-4 shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
          <label
            htmlFor="save-project-title"
            className="text-xs font-medium text-[var(--text-secondary)] whitespace-nowrap"
          >
            Project Name
          </label>
          <input
            id="save-project-title"
            type="text"
            maxLength={140}
            value={projectTitle}
            onChange={(e) => setProjectTitle(e.target.value)}
            placeholder="e.g., AI Workflow Launch Campaign"
            className="flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            {activeProject && (
              <button
                type="button"
                onClick={() => handleConfirmSave('update')}
                className="rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 whitespace-nowrap"
              >
                Update Project
              </button>
            )}
            <button
              type="button"
              onClick={() => handleConfirmSave('new')}
              className={
                activeProject
                  ? 'rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-700 dark:text-violet-200 hover:bg-violet-500/20 whitespace-nowrap'
                  : 'rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 whitespace-nowrap'
              }
            >
              {activeProject ? 'Save as New' : 'Confirm Save'}
            </button>
            <button
              type="button"
              onClick={() => setShowSaveInput(false)}
              className="rounded-xl border border-[var(--border-default)] px-3 py-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* AI Content Quality Audit Panel */}
      <ContentQualityPanel
        qualityScore={result.qualityScore}
        isScoring={isScoring}
        scoreError={scoreError}
        onRunScore={() => void handleRunQualityScore()}
        onApplyImprovement={handleApplyImprovement}
        appliedFixIds={appliedFixIds}
      />

      {/* Clean Output Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Generated result sections"
        className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 shadow-[var(--shadow-card)]"
      >
        {RESULT_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                active
                  ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-xs'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Analysis & Multiple Hooks Panel */}
      {showAnalysisAndHooks &&
        (result.analysis || (result.hooks && result.hooks.length > 0)) && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {/* Content & Transcript Analysis */}
            {result.analysis && (
              <article className="flex flex-col justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--border-strong)]">
                <div>
                  <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <FileSearch className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                          Content &amp; Transcript Analysis
                        </h3>
                        <p className="text-xs text-[var(--text-muted)]">
                          Core topic, audience &amp; key takeaways
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        triggerCopy(
                          'analysis',
                          `Topic: ${result.analysis?.coreTopic}\nAudience: ${result.analysis?.targetAudience}\n\nSummary:\n${result.analysis?.summary}\n\nKey Takeaways:\n${result.analysis?.keyTakeaways
                            .map((t) => `• ${t}`)
                            .join('\n')}`,
                          'Content Analysis'
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap"
                    >
                      {copiedId === 'analysis' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      )}
                      <span>{copyButtonLabel('analysis')}</span>
                    </button>
                  </div>

                  <div className="mt-4 space-y-3.5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                        <p className="text-[11px] font-medium text-[var(--text-muted)]">
                          Core Topic
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[var(--text-primary)]">
                          {result.analysis.coreTopic}
                        </p>
                      </div>
                      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                        <p className="text-[11px] font-medium text-[var(--text-muted)]">
                          Target Audience
                        </p>
                        <p className="mt-1 text-xs font-semibold text-[var(--text-primary)]">
                          {result.analysis.targetAudience}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[var(--text-muted)]">
                        Summary
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                        {result.analysis.summary}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-[var(--text-muted)]">
                        Key Takeaways
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {result.analysis.keyTakeaways.map((item, idx) => (
                          <li
                            key={idx}
                            className="flex items-start gap-2 text-xs leading-relaxed text-[var(--text-secondary)]"
                          >
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </article>
            )}

            {/* Multiple Engaging Hooks */}
            {result.hooks && result.hooks.length > 0 && (
              <article className="flex flex-col justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--border-strong)]">
                <div>
                  <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                        <Zap className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                          Engaging Hook Variations
                        </h3>
                        <p className="text-xs text-[var(--text-muted)]">
                          {result.hooks.length} scroll-stopping openers · Apply any hook to your Reel
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        triggerCopy(
                          'all-hooks',
                          result.hooks!.map((h, i) => `${i + 1}. ${h}`).join('\n'),
                          'All Hooks'
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap"
                    >
                      {copiedId === 'all-hooks' ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                      )}
                      <span>{copyButtonLabel('all-hooks', 'Copy All')}</span>
                    </button>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {result.hooks.map((hookText, idx) => {
                      const isActiveHook = result.instagramReel.hook === hookText;
                      const hookCopyKey = `hook-item-${idx}`;
                      return (
                        <div
                          key={idx}
                          className={`flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors ${
                            isActiveHook
                              ? 'border-violet-500/45 bg-violet-500/10'
                              : 'border-[var(--border-default)] bg-[var(--bg-surface)]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-mono text-[10px] font-semibold text-[var(--text-muted)]">
                              HOOK #{idx + 1}
                            </span>
                            <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-primary)]">
                              {hookText}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateResult({
                                  ...result,
                                  instagramReel: {
                                    ...result.instagramReel,
                                    hook: hookText,
                                  },
                                })
                              }
                              className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                                isActiveHook
                                  ? 'border-violet-500/50 bg-violet-600 text-white'
                                  : 'border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              {isActiveHook ? 'Active' : 'Use'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                triggerCopy(hookCopyKey, hookText, `Hook #${idx + 1}`)
                              }
                              aria-label={`Copy hook ${idx + 1}`}
                              className="rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            >
                              {copiedId === hookCopyKey ? (
                                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </article>
            )}
          </div>
        )}

      {/* Results Cards Grid */}
      <div
        className={`grid grid-cols-1 gap-6 ${
          activeTab === 'all' ? 'xl:grid-cols-2' : ''
        }`}
      >
        {/* Card 1: Instagram Reel */}
        {showReel && (
          <article className="flex flex-col justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--border-strong)]">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                    <Instagram className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                      Instagram Reel
                    </h3>
                    <p className="text-xs text-[var(--text-muted)]">
                      Title · Hook · Script · CTA
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleEdit('reel')}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      editingCards.reel
                        ? 'border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {editingCards.reel ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Edit3 className="h-3.5 w-3.5" />
                    )}
                    <span>{editingCards.reel ? 'Done' : 'Edit'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerCopy(
                        'reel',
                        `Title: ${result.instagramReel.title}\n\nHook: ${result.instagramReel.hook}\n\nScript:\n${result.instagramReel.script}\n\nCTA: ${result.instagramReel.cta}`,
                        'Instagram Reel'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap"
                  >
                    {copiedId === 'reel' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    )}
                    <span>{copyButtonLabel('reel')}</span>
                  </button>
                  {onStageSocialPost && (
                    <button
                      type="button"
                      onClick={() =>
                        void onStageSocialPost({
                          platform: 'instagram',
                          title: result.instagramReel.title,
                          caption: `${result.instagramCaption.caption}\n\n${result.instagramReel.cta}`.trim(),
                          hashtags: [
                            ...result.hashtags.relevant,
                            ...result.hashtags.trending,
                          ].slice(0, 30),
                          mediaType: 'video',
                          ...(activeProject?.id ? { projectId: activeProject.id } : {}),
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-500/35 bg-violet-500/10 px-2.5 py-1.5 text-xs font-medium text-violet-700 dark:text-violet-200 transition-colors hover:bg-violet-500/20 whitespace-nowrap"
                    >
                      <Send className="h-3 w-3" />
                      <span>Queue</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    Reel Title
                  </p>
                  {editingCards.reel ? (
                    <input
                      type="text"
                      value={result.instagramReel.title}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          instagramReel: {
                            ...result.instagramReel,
                            title: e.target.value,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                      {result.instagramReel.title}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    Hook (First 3 Seconds)
                  </p>
                  {editingCards.reel ? (
                    <textarea
                      rows={2}
                      value={result.instagramReel.hook}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          instagramReel: {
                            ...result.instagramReel,
                            hook: e.target.value,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 text-sm font-medium leading-relaxed text-violet-700 dark:text-violet-200">
                      {result.instagramReel.hook}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    Short Video Script
                  </p>
                  {editingCards.reel ? (
                    <textarea
                      rows={6}
                      value={result.instagramReel.script}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          instagramReel: {
                            ...result.instagramReel,
                            script: e.target.value,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">
                      {result.instagramReel.script}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    Call to Action
                  </p>
                  {editingCards.reel ? (
                    <input
                      type="text"
                      value={result.instagramReel.cta}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          instagramReel: {
                            ...result.instagramReel,
                            cta: e.target.value,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 text-sm font-medium text-blue-700 dark:text-blue-300">
                      {result.instagramReel.cta}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </article>
        )}

        {/* Card 2: YouTube Shorts */}
        {showShorts && (
          <article className="flex flex-col justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--border-strong)]">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
                    <Youtube className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                      YouTube Shorts
                    </h3>
                    <p className="text-xs text-[var(--text-muted)]">
                      Title · Script · Description · CTA
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleEdit('shorts')}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      editingCards.shorts
                        ? 'border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {editingCards.shorts ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Edit3 className="h-3.5 w-3.5" />
                    )}
                    <span>{editingCards.shorts ? 'Done' : 'Edit'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerCopy(
                        'shorts',
                        `Title: ${result.youtubeShorts.title}\n\nScript:\n${result.youtubeShorts.script}\n\nDescription:\n${result.youtubeShorts.description}\n\nCTA: ${result.youtubeShorts.cta}`,
                        'YouTube Shorts'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap"
                  >
                    {copiedId === 'shorts' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    )}
                    <span>{copyButtonLabel('shorts')}</span>
                  </button>
                  {onStageSocialPost && (
                    <button
                      type="button"
                      onClick={() =>
                        void onStageSocialPost({
                          platform: 'youtube',
                          title: result.youtubeShorts.title.slice(0, 100),
                          caption: `${result.youtubeShorts.description}\n\n${result.youtubeShorts.cta}`.trim(),
                          hashtags: result.hashtags.relevant.slice(0, 15),
                          mediaType: 'video',
                          youtubePrivacy: 'private',
                          ...(activeProject?.id ? { projectId: activeProject.id } : {}),
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-blue-500/35 bg-blue-500/10 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-200 transition-colors hover:bg-blue-500/20 whitespace-nowrap"
                    >
                      <Send className="h-3 w-3" />
                      <span>Queue</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    Video Title
                  </p>
                  {editingCards.shorts ? (
                    <input
                      type="text"
                      value={result.youtubeShorts.title}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          youtubeShorts: {
                            ...result.youtubeShorts,
                            title: e.target.value,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                      {result.youtubeShorts.title}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    Shorts Script
                  </p>
                  {editingCards.shorts ? (
                    <textarea
                      rows={5}
                      value={result.youtubeShorts.script}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          youtubeShorts: {
                            ...result.youtubeShorts,
                            script: e.target.value,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">
                      {result.youtubeShorts.script}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    YouTube Description
                  </p>
                  {editingCards.shorts ? (
                    <textarea
                      rows={3}
                      value={result.youtubeShorts.description}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          youtubeShorts: {
                            ...result.youtubeShorts,
                            description: e.target.value,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">
                      {result.youtubeShorts.description}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    Call to Action
                  </p>
                  {editingCards.shorts ? (
                    <input
                      type="text"
                      value={result.youtubeShorts.cta}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          youtubeShorts: {
                            ...result.youtubeShorts,
                            cta: e.target.value,
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 text-sm font-medium text-blue-700 dark:text-blue-300">
                      {result.youtubeShorts.cta}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </article>
        )}

        {/* Card 3: Instagram Caption */}
        {showCaption && (
          <article className="flex flex-col justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--border-strong)]">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                      Instagram Caption
                    </h3>
                    <p className="text-xs text-[var(--text-muted)]">
                      Formatted copy with emojis
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleEdit('caption')}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      editingCards.caption
                        ? 'border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {editingCards.caption ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Edit3 className="h-3.5 w-3.5" />
                    )}
                    <span>{editingCards.caption ? 'Done' : 'Edit'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerCopy(
                        'caption',
                        result.instagramCaption.caption,
                        'Instagram Caption'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap"
                  >
                    {copiedId === 'caption' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    )}
                    <span>{copyButtonLabel('caption')}</span>
                  </button>
                </div>
              </div>

              <div className="mt-4">
                {editingCards.caption ? (
                  <textarea
                    rows={8}
                    value={result.instagramCaption.caption}
                    onChange={(e) =>
                      onUpdateResult({
                        ...result,
                        instagramCaption: { caption: e.target.value },
                      })
                    }
                    className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                  />
                ) : (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-primary)]">
                    {result.instagramCaption.caption}
                  </p>
                )}
              </div>
            </div>
          </article>
        )}

        {/* Card 4: Hashtag Generator */}
        {showHashtags && (
          <article className="flex flex-col justify-between rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--border-strong)]">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400">
                    <Hash className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                      Hashtag Generator
                    </h3>
                    <p className="text-xs text-[var(--text-muted)]">
                      Relevant &amp; trending suggestions
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleEdit('hashtags')}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      editingCards.hashtags
                        ? 'border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {editingCards.hashtags ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Edit3 className="h-3.5 w-3.5" />
                    )}
                    <span>{editingCards.hashtags ? 'Done' : 'Edit'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerCopy(
                        'hashtags-all',
                        [...result.hashtags.relevant, ...result.hashtags.trending].join(
                          ' '
                        ),
                        'All Hashtags'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap"
                  >
                    {copiedId === 'hashtags-all' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    )}
                    <span>{copyButtonLabel('hashtags-all', 'Copy All')}</span>
                  </button>
                </div>
              </div>

              {editingCards.hashtags ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)]">
                      Relevant Hashtags (space-separated)
                    </label>
                    <textarea
                      rows={3}
                      value={result.hashtags.relevant.join(' ')}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          hashtags: {
                            ...result.hashtags,
                            relevant: e.target.value
                              .split(/\s+/)
                              .filter(Boolean)
                              .map((t) => (t.startsWith('#') ? t : `#${t}`)),
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)]">
                      Trending Hashtags (space-separated)
                    </label>
                    <textarea
                      rows={3}
                      value={result.hashtags.trending.join(' ')}
                      onChange={(e) =>
                        onUpdateResult({
                          ...result,
                          hashtags: {
                            ...result.hashtags,
                            trending: e.target.value
                              .split(/\s+/)
                              .filter(Boolean)
                              .map((t) => (t.startsWith('#') ? t : `#${t}`)),
                          },
                        })
                      }
                      className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-5">
                  <div>
                    <p className="text-xs font-medium text-[var(--text-muted)]">
                      Relevant Hashtags (click any tag to copy)
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.hashtags.relevant.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => triggerCopy(`tag-${tag}`, tag, `Hashtag ${tag}`)}
                          className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-primary)] transition-colors hover:border-violet-500/50"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-[var(--text-muted)]">
                      Trending Suggestions
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.hashtags.trending.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() =>
                            triggerCopy(`trend-${tag}`, tag, `Hashtag ${tag}`)
                          }
                          className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 font-mono text-xs text-blue-700 dark:text-blue-200 transition-colors hover:border-blue-400/60 hover:bg-blue-500/20"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </article>
        )}

        {/* Card 5: Platform-Specific Posts (or dedicated LinkedIn / Facebook Tab view) */}
        {(showAllPlatformPosts || showSingleLinkedIn || showSingleFacebook) && (
          <article
            className={`rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] transition-colors hover:border-[var(--border-strong)] ${
              showAllPlatformPosts ? 'xl:col-span-2' : ''
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-blue-500/20 text-violet-600 dark:text-violet-300">
                  {showSingleLinkedIn ? (
                    <Linkedin className="h-4 w-4" />
                  ) : showSingleFacebook ? (
                    <Share2 className="h-4 w-4" />
                  ) : (
                    <Share2 className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                    {showSingleLinkedIn
                      ? 'LinkedIn Post'
                      : showSingleFacebook
                      ? 'Facebook Post'
                      : 'Platform-Specific Posts'}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {showSingleLinkedIn
                      ? 'Professional insight copy ready for LinkedIn publishing'
                      : showSingleFacebook
                      ? 'Community-oriented copy ready for Facebook Pages'
                      : 'Tailored copy for Instagram, YouTube Community, LinkedIn, and Facebook'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleEdit('posts')}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    editingCards.posts
                      ? 'border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {editingCards.posts ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Edit3 className="h-3.5 w-3.5" />
                  )}
                  <span>{editingCards.posts ? 'Done' : showAllPlatformPosts ? 'Edit All' : 'Edit'}</span>
                </button>
                {showAllPlatformPosts && (
                  <button
                    type="button"
                    onClick={() =>
                      triggerCopy(
                        'all-posts',
                        `INSTAGRAM POST:\n${result.platformPosts.instagram}\n\nYOUTUBE COMMUNITY:\n${result.platformPosts.youtubeCommunity}\n\nLINKEDIN POST:\n${result.platformPosts.linkedin}\n\nFACEBOOK POST:\n${result.platformPosts.facebook}`,
                        'All Platform Posts'
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap"
                  >
                    {copiedId === 'all-posts' ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    )}
                    <span>{copyButtonLabel('all-posts', 'Copy All')}</span>
                  </button>
                )}
              </div>
            </div>

            <div
              className={`mt-5 grid grid-cols-1 gap-5 ${
                showAllPlatformPosts ? 'md:grid-cols-2' : ''
              }`}
            >
              {(
                [
                  {
                    key: 'instagram' as const,
                    label: 'Instagram Post',
                    icon: Instagram,
                    value: result.platformPosts.instagram,
                  },
                  {
                    key: 'youtubeCommunity' as const,
                    label: 'YouTube Community Post',
                    icon: Youtube,
                    value: result.platformPosts.youtubeCommunity,
                  },
                  {
                    key: 'linkedin' as const,
                    label: 'LinkedIn Post',
                    icon: Linkedin,
                    value: result.platformPosts.linkedin,
                  },
                  {
                    key: 'facebook' as const,
                    label: 'Facebook Post',
                    icon: Share2,
                    value: result.platformPosts.facebook,
                  },
                ] as const
              )
                .filter((item) => {
                  if (showSingleLinkedIn) return item.key === 'linkedin';
                  if (showSingleFacebook) return item.key === 'facebook';
                  return true;
                })
                .map((platformPost) => {
                  const Icon = platformPost.icon;
                  const copyKey = `post-${platformPost.key}`;
                  return (
                    <div
                      key={platformPost.key}
                      className={`flex flex-col justify-between ${
                        showAllPlatformPosts
                          ? 'border-b border-[var(--border-default)] pb-4 md:border-b-0 md:border-r md:pr-5 md:last:border-r-0 md:[&:nth-child(2)]:border-r-0'
                          : ''
                      }`}
                    >
                      <div>
                        <div className="mb-2.5 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                            <Icon className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                            {platformPost.label}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                triggerCopy(
                                  copyKey,
                                  platformPost.value,
                                  platformPost.label
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap"
                            >
                              {copiedId === copyKey ? (
                                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <Copy className="h-3 w-3 text-[var(--text-muted)]" />
                              )}
                              <span>{copyButtonLabel(copyKey)}</span>
                            </button>
                            {onStageSocialPost &&
                              platformPost.key !== 'youtubeCommunity' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void onStageSocialPost({
                                      platform:
                                        platformPost.key === 'instagram'
                                          ? 'instagram'
                                          : platformPost.key === 'linkedin'
                                          ? 'linkedin'
                                          : 'facebook',
                                      title:
                                        result.analysis?.coreTopic ||
                                        platformPost.label,
                                      caption: platformPost.value,
                                      hashtags: result.hashtags.relevant.slice(0, 10),
                                      mediaType:
                                        platformPost.key === 'instagram'
                                          ? 'image'
                                          : 'none',
                                      ...(activeProject?.id
                                        ? { projectId: activeProject.id }
                                        : {}),
                                    })
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-violet-500/35 bg-violet-500/10 px-2 py-1 text-xs font-medium text-violet-700 dark:text-violet-200 transition-colors hover:bg-violet-500/20 whitespace-nowrap"
                                >
                                  <Send className="h-3 w-3" />
                                  <span>Queue</span>
                                </button>
                              )}
                          </div>
                        </div>

                        {editingCards.posts ? (
                          <textarea
                            rows={showAllPlatformPosts ? 5 : 7}
                            value={platformPost.value}
                            onChange={(e) =>
                              onUpdateResult({
                                ...result,
                                platformPosts: {
                                  ...result.platformPosts,
                                  [platformPost.key]: e.target.value,
                                },
                              })
                            }
                            className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                          />
                        ) : (
                          <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-secondary)]">
                            {platformPost.value}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </article>
        )}
      </div>
    </section>
  );
}
