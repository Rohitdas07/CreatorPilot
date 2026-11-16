import type {
  ContentAnalysis,
  ContentLanguage,
  GeneratedContent,
  GenerationConfig,
  Platform,
  Tone,
  VideoDuration,
} from '../types/creator';

export const VALID_PLATFORMS: Platform[] = [
  'Instagram',
  'YouTube',
  'Facebook',
  'LinkedIn',
];

export const VALID_LANGUAGES: ContentLanguage[] = [
  'English',
  'Hindi',
  'Bengali',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Japanese',
];

export const VALID_TONES: Tone[] = [
  'Professional',
  'Funny',
  'Educational',
  'Inspirational',
  'Casual',
];

export const VALID_DURATIONS: VideoDuration[] = ['15 sec', '30 sec', '60 sec'];

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function clampString(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function normalizeHashtagList(input: unknown, maxItems = 15): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of input) {
    if (typeof item !== 'string') continue;
    const raw = item.trim().replace(/\s+/g, '');
    if (!raw) continue;
    const tag = (raw.startsWith('#') ? raw : `#${raw}`).slice(0, 80);
    if (tag.length <= 1) continue;
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(tag);
    }
    if (normalized.length >= maxItems) break;
  }

  return normalized;
}

export type ValidatedAiPayload = Omit<
  GeneratedContent,
  'engine' | 'model' | 'generatedAt'
>;

export function validateAndNormalizeGeneratedPayload(
  raw: unknown
): { ok: true; data: ValidatedAiPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'AI response root must be a JSON object.' };
  }

  const obj = raw as Record<string, unknown>;

  // 1. Validate analysis
  const rawAnalysis = obj.analysis as Record<string, unknown> | undefined;
  if (!rawAnalysis || typeof rawAnalysis !== 'object') {
    return { ok: false, error: 'Missing content analysis section in AI response.' };
  }
  if (
    !isNonEmptyString(rawAnalysis.summary) ||
    !isNonEmptyString(rawAnalysis.coreTopic) ||
    !isNonEmptyString(rawAnalysis.targetAudience)
  ) {
    return {
      ok: false,
      error: 'Content analysis must include summary, coreTopic, and targetAudience.',
    };
  }
  const keyTakeaways = Array.isArray(rawAnalysis.keyTakeaways)
    ? rawAnalysis.keyTakeaways
        .filter((t): t is string => isNonEmptyString(t))
        .map((t) => clampString(t, 500))
        .slice(0, 8)
    : [];
  if (keyTakeaways.length === 0) {
    return {
      ok: false,
      error: 'Content analysis must include at least one key takeaway.',
    };
  }

  const analysis: ContentAnalysis = {
    summary: clampString(rawAnalysis.summary, 3500),
    coreTopic: clampString(rawAnalysis.coreTopic, 280),
    targetAudience: clampString(rawAnalysis.targetAudience, 380),
    keyTakeaways,
    ...(isNonEmptyString(rawAnalysis.detectedLanguage)
      ? { detectedLanguage: clampString(rawAnalysis.detectedLanguage, 50) }
      : {}),
  };

  // 2. Validate multiple hooks
  const rawHooks = Array.isArray(obj.hooks)
    ? obj.hooks
        .filter((h): h is string => isNonEmptyString(h))
        .map((h) => clampString(h, 550))
        .slice(0, 8)
    : [];
  if (rawHooks.length < 2) {
    return {
      ok: false,
      error: 'AI response must provide multiple engaging hooks.',
    };
  }

  // 3. Validate Instagram Reel
  const rawReel = obj.instagramReel as Record<string, unknown> | undefined;
  if (
    !rawReel ||
    !isNonEmptyString(rawReel.title) ||
    !isNonEmptyString(rawReel.hook) ||
    !isNonEmptyString(rawReel.script) ||
    !isNonEmptyString(rawReel.cta)
  ) {
    return {
      ok: false,
      error: 'Instagram Reel output is incomplete (title, hook, script, cta required).',
    };
  }

  // 4. Validate YouTube Shorts
  const rawShorts = obj.youtubeShorts as Record<string, unknown> | undefined;
  if (
    !rawShorts ||
    !isNonEmptyString(rawShorts.title) ||
    !isNonEmptyString(rawShorts.script) ||
    !isNonEmptyString(rawShorts.description) ||
    !isNonEmptyString(rawShorts.cta)
  ) {
    return {
      ok: false,
      error: 'YouTube Shorts output is incomplete (title, script, description, cta required).',
    };
  }

  // 5. Validate Instagram Caption
  const rawCaption = obj.instagramCaption as Record<string, unknown> | undefined;
  if (!rawCaption || !isNonEmptyString(rawCaption.caption)) {
    return {
      ok: false,
      error: 'Instagram Caption output is missing.',
    };
  }

  // 6. Validate Hashtags
  const rawHashtags = obj.hashtags as Record<string, unknown> | undefined;
  if (!rawHashtags) {
    return { ok: false, error: 'Hashtags output is missing.' };
  }
  const relevantTags = normalizeHashtagList(rawHashtags.relevant, 15);
  const trendingTags = normalizeHashtagList(rawHashtags.trending, 15);
  if (relevantTags.length === 0 && trendingTags.length === 0) {
    return {
      ok: false,
      error: 'AI response must include relevant or trending hashtags.',
    };
  }

  // 7. Validate Platform Posts
  const rawPosts = obj.platformPosts as Record<string, unknown> | undefined;
  if (
    !rawPosts ||
    !isNonEmptyString(rawPosts.instagram) ||
    !isNonEmptyString(rawPosts.youtubeCommunity) ||
    !isNonEmptyString(rawPosts.linkedin) ||
    !isNonEmptyString(rawPosts.facebook)
  ) {
    return {
      ok: false,
      error:
        'Platform-specific posts are incomplete (instagram, youtubeCommunity, linkedin, facebook required).',
    };
  }

  return {
    ok: true,
    data: {
      analysis,
      hooks: rawHooks,
      instagramReel: {
        title: clampString(rawReel.title, 280),
        hook: clampString(rawReel.hook, 900),
        script: clampString(rawReel.script, 11000),
        cta: clampString(rawReel.cta, 900),
      },
      youtubeShorts: {
        title: clampString(rawShorts.title, 280),
        script: clampString(rawShorts.script, 11000),
        description: clampString(rawShorts.description, 5500),
        cta: clampString(rawShorts.cta, 900),
      },
      instagramCaption: {
        caption: clampString(rawCaption.caption, 5500),
      },
      hashtags: {
        relevant: relevantTags,
        trending: trendingTags,
      },
      platformPosts: {
        instagram: clampString(rawPosts.instagram, 5500),
        youtubeCommunity: clampString(rawPosts.youtubeCommunity, 5500),
        linkedin: clampString(rawPosts.linkedin, 5500),
        facebook: clampString(rawPosts.facebook, 5500),
      },
    },
  };
}

export function sanitizeConfigForFirestore(
  config: GenerationConfig
): Record<string, string> {
  const platform = VALID_PLATFORMS.includes(config.platform)
    ? config.platform
    : 'Instagram';
  const language = VALID_LANGUAGES.includes(config.language)
    ? config.language
    : 'English';
  const tone = VALID_TONES.includes(config.tone) ? config.tone : 'Educational';
  const duration = VALID_DURATIONS.includes(config.duration)
    ? config.duration
    : '30 sec';

  const clean: Record<string, string> = {
    sourceText: clampString(config.sourceText || '', 44000),
    platform,
    language,
    tone,
    duration,
  };

  if (config.niche && config.niche.trim()) {
    clean.niche = clampString(config.niche, 150);
  }
  if (config.brandVoice && config.brandVoice.trim()) {
    clean.brandVoice = clampString(config.brandVoice, 400);
  }
  const mediaName = config.mediaName || config.mediaInfo?.name;
  if (mediaName && mediaName.trim()) {
    clean.mediaName = clampString(mediaName, 200);
  }

  return clean;
}

export function sanitizeResultForFirestore(
  result: GeneratedContent
): Record<string, unknown> {
  const engine =
    result.engine === 'gemini' || result.engine === 'demo'
      ? result.engine
      : 'template';

  const clean: Record<string, unknown> = {
    instagramReel: {
      title: clampString(result.instagramReel.title, 280),
      hook: clampString(result.instagramReel.hook, 900),
      script: clampString(result.instagramReel.script, 11000),
      cta: clampString(result.instagramReel.cta, 900),
    },
    youtubeShorts: {
      title: clampString(result.youtubeShorts.title, 280),
      script: clampString(result.youtubeShorts.script, 11000),
      description: clampString(result.youtubeShorts.description, 5500),
      cta: clampString(result.youtubeShorts.cta, 900),
    },
    instagramCaption: {
      caption: clampString(result.instagramCaption.caption, 5500),
    },
    hashtags: {
      relevant: normalizeHashtagList(result.hashtags.relevant, 20),
      trending: normalizeHashtagList(result.hashtags.trending, 20),
    },
    platformPosts: {
      instagram: clampString(result.platformPosts.instagram, 5500),
      youtubeCommunity: clampString(result.platformPosts.youtubeCommunity, 5500),
      linkedin: clampString(result.platformPosts.linkedin, 5500),
      facebook: clampString(result.platformPosts.facebook, 5500),
    },
    engine,
  };

  if (result.analysis) {
    const takeaways = (result.analysis.keyTakeaways || [])
      .filter((t) => typeof t === 'string' && t.trim().length > 0)
      .map((t) => clampString(t, 500))
      .slice(0, 8);
    if (
      result.analysis.summary.trim() &&
      result.analysis.coreTopic.trim() &&
      result.analysis.targetAudience.trim() &&
      takeaways.length > 0
    ) {
      clean.analysis = {
        summary: clampString(result.analysis.summary, 3500),
        coreTopic: clampString(result.analysis.coreTopic, 280),
        targetAudience: clampString(result.analysis.targetAudience, 380),
        keyTakeaways: takeaways,
        ...(result.analysis.detectedLanguage?.trim()
          ? {
              detectedLanguage: clampString(
                result.analysis.detectedLanguage,
                50
              ),
            }
          : {}),
      };
    }
  }

  if (Array.isArray(result.hooks) && result.hooks.length > 0) {
    const cleanHooks = result.hooks
      .filter((h) => typeof h === 'string' && h.trim().length > 0)
      .map((h) => clampString(h, 550))
      .slice(0, 8);
    if (cleanHooks.length > 0) {
      clean.hooks = cleanHooks;
    }
  }

  if (result.qualityScore && typeof result.qualityScore === 'object') {
    const qs = result.qualityScore;
    const clampScore = (n: unknown) => {
      const num = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
      return Math.max(0, Math.min(100, num));
    };
    const sanitizeDim = (d: { score?: unknown; rationale?: unknown } | undefined) => ({
      score: clampScore(d?.score),
      rationale: clampString(d?.rationale ?? '', 400) || 'Evaluated by Gemini.',
    });

    const validTargets = new Set([
      'hook',
      'reelScript',
      'shortsScript',
      'caption',
      'cta',
    ]);

    const cleanImprovements = Array.isArray(qs.improvements)
      ? qs.improvements.slice(0, 6).map((imp, idx) => ({
          id: clampString(imp?.id || `imp-${idx + 1}`, 80) || `imp-${idx + 1}`,
          targetSection: validTargets.has(String(imp?.targetSection))
            ? imp.targetSection
            : 'hook',
          issue: clampString(imp?.issue ?? '', 300) || 'Opportunity to tighten copy',
          recommendation: clampString(imp?.recommendation ?? '', 400) || 'Refine phrasing',
          suggestedFix: clampString(imp?.suggestedFix ?? '', 2500) || '',
        }))
      : [];

    const cleanStrengths = Array.isArray(qs.strengths)
      ? qs.strengths
          .filter((s) => typeof s === 'string' && s.trim().length > 0)
          .map((s) => clampString(s, 350))
          .slice(0, 6)
      : [];

    const gradeLabel =
      qs.gradeLabel === 'Publication Ready' ||
      qs.gradeLabel === 'Strong Draft' ||
      qs.gradeLabel === 'Needs Refinement'
        ? qs.gradeLabel
        : 'Strong Draft';

    clean.qualityScore = {
      overallScore: clampScore(qs.overallScore),
      gradeLabel,
      summary: clampString(qs.summary ?? '', 800) || 'Quality evaluation complete.',
      dimensions: {
        hookStrength: sanitizeDim(qs.dimensions?.hookStrength),
        platformFit: sanitizeDim(qs.dimensions?.platformFit),
        clarityAndStructure: sanitizeDim(qs.dimensions?.clarityAndStructure),
        ctaEffectiveness: sanitizeDim(qs.dimensions?.ctaEffectiveness),
        brandVoiceAlignment: sanitizeDim(qs.dimensions?.brandVoiceAlignment),
      },
      strengths: cleanStrengths,
      improvements: cleanImprovements,
      readability: {
        wordCount: Math.max(0, Math.round(Number(qs.readability?.wordCount || 0))),
        estimatedSpeakingSeconds: Math.max(
          0,
          Math.round(Number(qs.readability?.estimatedSpeakingSeconds || 0))
        ),
        hookCharCount: Math.max(
          0,
          Math.round(Number(qs.readability?.hookCharCount || 0))
        ),
        hashtagCount: Math.max(
          0,
          Math.round(Number(qs.readability?.hashtagCount || 0))
        ),
        captionLineCount: Math.max(
          0,
          Math.round(Number(qs.readability?.captionLineCount || 0))
        ),
      },
      evaluatedAt:
        clampString(qs.evaluatedAt ?? new Date().toISOString(), 60) ||
        new Date().toISOString(),
      model: clampString(qs.model ?? 'gemini-4-hydrogen', 80) || 'gemini-4-hydrogen',
    };
  }

  if (result.model?.trim()) {
    clean.model = clampString(result.model, 80);
  }
  if (result.generatedAt?.trim()) {
    clean.generatedAt = clampString(result.generatedAt, 60);
  }

  return clean;
}
