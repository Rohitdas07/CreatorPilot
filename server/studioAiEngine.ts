import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { AnalyticsInsightsResponse, AnalyticsSummaryInput } from '../src/types/analytics.ts';
import type {
  ContentQualityImprovement,
  ContentQualityScore,
  ContentReadabilityMetrics,
  GeneratedContent,
  QualityFixTarget,
} from '../src/types/creator.ts';
import type {
  ThumbnailAspectRatio,
  ThumbnailConcept,
  ThumbnailLayoutType,
  ThumbnailStylePreset,
} from '../src/types/thumbnail.ts';
import { generateGeminiContentWithFallback } from './geminiModelHelper.ts';

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'creatorpilot-ai-build',
      },
    },
  });
}

function clampScore(value: unknown, fallback = 75): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }
  }
  return fallback;
}

export function computeReadabilityMetrics(
  result: GeneratedContent
): ContentReadabilityMetrics {
  const reelScript = String(result.instagramReel?.script || '');
  const strippedSpoken = reelScript
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\b/g, ' ')
    .trim();
  const rawWords = (strippedSpoken || reelScript).split(/\s+/).filter(Boolean);
  const wordCount = rawWords.length;
  // ~145 words per minute average energetic creator speaking cadence
  const estimatedSpeakingSeconds =
    wordCount > 0 ? Math.max(3, Math.round((wordCount / 145) * 60)) : 0;

  const hookCharCount = String(result.instagramReel?.hook || '').trim().length;
  const hashtagCount =
    (Array.isArray(result.hashtags?.relevant) ? result.hashtags.relevant.length : 0) +
    (Array.isArray(result.hashtags?.trending) ? result.hashtags.trending.length : 0);
  const captionLineCount = String(result.instagramCaption?.caption || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;

  return {
    wordCount,
    estimatedSpeakingSeconds,
    hookCharCount,
    hashtagCount,
    captionLineCount,
  };
}

const QUALITY_SCORE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Concise 2-sentence editorial verdict on overall readiness and biggest lever.',
    },
    dimensions: {
      type: Type.OBJECT,
      properties: {
        hookStrength: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER, description: '0-100 score for 3-second scroll-stop power' },
            rationale: { type: Type.STRING, description: '1 concise sentence justifying the score' },
          },
          required: ['score', 'rationale'],
        },
        platformFit: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER, description: '0-100 score for pacing, length, and platform native formatting' },
            rationale: { type: Type.STRING, description: '1 concise sentence justifying the score' },
          },
          required: ['score', 'rationale'],
        },
        clarityAndStructure: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER, description: '0-100 score for scannability, rhythm, and takeaway clarity' },
            rationale: { type: Type.STRING, description: '1 concise sentence justifying the score' },
          },
          required: ['score', 'rationale'],
        },
        ctaEffectiveness: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER, description: '0-100 score for engagement friction and specificity of CTA' },
            rationale: { type: Type.STRING, description: '1 concise sentence justifying the score' },
          },
          required: ['score', 'rationale'],
        },
        brandVoiceAlignment: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER, description: '0-100 score for tone and brand voice consistency' },
            rationale: { type: Type.STRING, description: '1 concise sentence justifying the score' },
          },
          required: ['score', 'rationale'],
        },
      },
      required: [
        'hookStrength',
        'platformFit',
        'clarityAndStructure',
        'ctaEffectiveness',
        'brandVoiceAlignment',
      ],
    },
    strengths: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '2 to 4 concrete strengths already working in the bundle.',
    },
    improvements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          targetSection: {
            type: Type.STRING,
            description: 'Must be exactly one of: hook, reelScript, shortsScript, caption, cta',
          },
          issue: { type: Type.STRING, description: 'Specific weakness found in that section' },
          recommendation: { type: Type.STRING, description: 'Why and how to improve it' },
          suggestedFix: {
            type: Type.STRING,
            description: 'Ready-to-apply replacement text for that exact targetSection in the same language and voice.',
          },
        },
        required: ['targetSection', 'issue', 'recommendation', 'suggestedFix'],
      },
      description: '2 to 4 actionable improvements with drop-in replacement copy.',
    },
  },
  required: ['summary', 'dimensions', 'strengths', 'improvements'],
};

const VALID_FIX_TARGETS: QualityFixTarget[] = [
  'hook',
  'reelScript',
  'shortsScript',
  'caption',
  'cta',
];

export async function scoreContentWithGemini(
  apiKey: string,
  input: {
    result: GeneratedContent;
    platform?: string;
    tone?: string;
    duration?: string;
    niche?: string;
    brandVoice?: string;
  }
): Promise<ContentQualityScore> {
  const ai = createGeminiClient(apiKey);
  const readability = computeReadabilityMetrics(input.result);

  const prompt = `Evaluate this multi-platform creator content bundle strictly as a senior social media creative director.

Target Configuration:
- Primary Platform: ${input.platform || 'Instagram'}
- Tone: ${input.tone || 'Educational'}
- Target Duration: ${input.duration || '30 sec'}
- Niche: ${input.niche || 'Digital Creators'}
- Brand Voice: ${input.brandVoice || 'Clear, authentic, practical'}
- Measured Readability: ${readability.wordCount} spoken words (~${readability.estimatedSpeakingSeconds}s), hook length ${readability.hookCharCount} chars, ${readability.hashtagCount} hashtags, ${readability.captionLineCount} caption lines.

Generated Content Bundle:
- Reel Title: ${input.result.instagramReel?.title || ''}
- Reel Hook: ${input.result.instagramReel?.hook || ''}
- Reel Script:
${input.result.instagramReel?.script || ''}
- Reel CTA: ${input.result.instagramReel?.cta || ''}

- Shorts Title: ${input.result.youtubeShorts?.title || ''}
- Shorts Script:
${input.result.youtubeShorts?.script || ''}

- Instagram Caption:
${input.result.instagramCaption?.caption || ''}

- LinkedIn Post:
${input.result.platformPosts?.linkedin || ''}

Instructions:
- Score honestly from 0 to 100 across the 5 dimensions. Do not inflate scores if hooks are generic, scripts are over/under-paced for ${input.duration || '30 sec'}, or CTAs are vague.
- Provide 2 to 4 concrete strengths and 2 to 4 targeted improvements.
- Every improvement MUST set targetSection to one of: hook, reelScript, shortsScript, caption, cta.
- Every suggestedFix MUST be complete, drop-in replacement copy for that exact field in the same language as the bundle.`;

  const { response, modelUsed } = await generateGeminiContentWithFallback({
    ai,
    label: 'Content quality evaluation',
    primaryTimeoutMs: 18000,
    fallbackTimeoutMs: 30000,
    contents: prompt,
    config: {
      systemInstruction:
        'You are an exacting social media creative director auditing multi-platform creator scripts and captions. Return strictly valid JSON matching the schema.',
      responseMimeType: 'application/json',
      responseSchema: QUALITY_SCORE_SCHEMA,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.MEDIUM,
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned an empty quality evaluation.');
  }

  const parsed = JSON.parse(rawText) as {
    summary?: string;
    dimensions?: Record<string, { score?: number; rationale?: string }>;
    strengths?: string[];
    improvements?: Array<{
      targetSection?: string;
      issue?: string;
      recommendation?: string;
      suggestedFix?: string;
    }>;
  };

  const dims = parsed.dimensions || {};
  const hookStrength = {
    score: clampScore(dims.hookStrength?.score, 76),
    rationale: String(dims.hookStrength?.rationale || 'Evaluated opening scroll-stop specificity.').slice(0, 260),
  };
  const platformFit = {
    score: clampScore(dims.platformFit?.score, 78),
    rationale: String(dims.platformFit?.rationale || 'Evaluated pacing and native platform formatting.').slice(0, 260),
  };
  const clarityAndStructure = {
    score: clampScore(dims.clarityAndStructure?.score, 80),
    rationale: String(dims.clarityAndStructure?.rationale || 'Evaluated readability and takeaway flow.').slice(0, 260),
  };
  const ctaEffectiveness = {
    score: clampScore(dims.ctaEffectiveness?.score, 74),
    rationale: String(dims.ctaEffectiveness?.rationale || 'Evaluated conversion clarity and prompt friction.').slice(0, 260),
  };
  const brandVoiceAlignment = {
    score: clampScore(dims.brandVoiceAlignment?.score, 80),
    rationale: String(dims.brandVoiceAlignment?.rationale || 'Evaluated alignment with target tone and brand voice.').slice(0, 260),
  };

  const overallScore = Math.round(
    (hookStrength.score +
      platformFit.score +
      clarityAndStructure.score +
      ctaEffectiveness.score +
      brandVoiceAlignment.score) /
      5
  );

  const gradeLabel: ContentQualityScore['gradeLabel'] =
    overallScore >= 82
      ? 'Publication Ready'
      : overallScore >= 65
      ? 'Strong Draft'
      : 'Needs Refinement';

  const strengths = Array.isArray(parsed.strengths)
    ? parsed.strengths
        .map((s) => String(s || '').trim().slice(0, 260))
        .filter(Boolean)
        .slice(0, 5)
    : ['Clear core narrative with multi-platform coverage.'];

  const improvements: ContentQualityImprovement[] = Array.isArray(parsed.improvements)
    ? parsed.improvements
        .map((item, idx): ContentQualityImprovement | null => {
          const rawTarget = String(item?.targetSection || '').trim() as QualityFixTarget;
          const targetSection: QualityFixTarget = VALID_FIX_TARGETS.includes(rawTarget)
            ? rawTarget
            : 'hook';
          const issue = String(item?.issue || '').trim().slice(0, 260);
          const recommendation = String(item?.recommendation || '').trim().slice(0, 320);
          const suggestedFix = String(item?.suggestedFix || '').trim().slice(0, 3000);
          if (!issue || !suggestedFix) return null;
          return {
            id: `imp-${idx + 1}`,
            targetSection,
            issue,
            recommendation: recommendation || 'Apply the sharper revision below.',
            suggestedFix,
          };
        })
        .filter((x): x is ContentQualityImprovement => x !== null)
        .slice(0, 5)
    : [];

  return {
    overallScore,
    gradeLabel,
    summary: String(parsed.summary || 'Bundle evaluated across hook, platform fit, clarity, CTA, and voice.').slice(0, 500),
    dimensions: {
      hookStrength,
      platformFit,
      clarityAndStructure,
      ctaEffectiveness,
      brandVoiceAlignment,
    },
    strengths,
    improvements,
    readability,
    evaluatedAt: new Date().toISOString(),
    model: modelUsed,
  };
}

const THUMBNAIL_CONCEPTS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    concepts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          conceptTitle: {
            type: Type.STRING,
            description: 'Short name for this visual direction (3-5 words)',
          },
          headline: {
            type: Type.STRING,
            description: 'Ultra-punchy 2-6 word thumbnail headline for instant mobile legibility',
          },
          kicker: {
            type: Type.STRING,
            description: '1-3 word uppercase eyebrow label above headline',
          },
          statCallout: {
            type: Type.STRING,
            description: 'Compact proof pill or number like 3X CTR, 60 SEC, STEP 1, or empty string',
          },
          layout: {
            type: Type.STRING,
            description: 'One of: split-left, center-spotlight, bottom-editorial, stat-grid',
          },
          palette: {
            type: Type.OBJECT,
            properties: {
              background: { type: Type.STRING, description: 'Hex color #RRGGBB' },
              surface: { type: Type.STRING, description: 'Hex color #RRGGBB' },
              accent: { type: Type.STRING, description: 'Hex color #RRGGBB' },
              text: { type: Type.STRING, description: 'High-contrast hex color #RRGGBB' },
              mutedText: { type: Type.STRING, description: 'Secondary hex color #RRGGBB' },
            },
            required: ['background', 'surface', 'accent', 'text', 'mutedText'],
          },
          ctrRationale: {
            type: Type.STRING,
            description: '1-2 sentences explaining why this hook + contrast stops viewers from scrolling',
          },
          visualPromptNote: {
            type: Type.STRING,
            description: 'Art direction note for background photo or video frame selection',
          },
        },
        required: [
          'conceptTitle',
          'headline',
          'kicker',
          'statCallout',
          'layout',
          'palette',
          'ctrRationale',
          'visualPromptNote',
        ],
      },
    },
  },
  required: ['concepts'],
};

const VALID_LAYOUTS: ThumbnailLayoutType[] = [
  'split-left',
  'center-spotlight',
  'bottom-editorial',
  'stat-grid',
];

export async function generateThumbnailConceptsWithGemini(
  apiKey: string,
  input: {
    topic: string;
    title?: string;
    hook?: string;
    aspectRatio: ThumbnailAspectRatio;
    stylePreset: ThumbnailStylePreset;
    brandKit?: {
      brandName?: string;
      colors?: { primary?: string; secondary?: string; accent?: string };
    } | null;
  }
): Promise<ThumbnailConcept[]> {
  const ai = createGeminiClient(apiKey);

  const brandHint = input.brandKit?.brandName
    ? `\nBrand Kit Reference:
- Brand: ${input.brandKit.brandName}
- Primary: ${input.brandKit.colors?.primary || '#7C3AED'}, Secondary: ${input.brandKit.colors?.secondary || '#2563EB'}, Accent: ${input.brandKit.colors?.accent || '#10B981'}
(Use these in at least one concept while keeping high mobile contrast.)`
    : '';

  const prompt = `Design 3 distinct, high-CTR thumbnail art-direction concepts for this creator piece:
- Topic / Idea: ${input.topic}
${input.title ? `- Working Title: ${input.title}` : ''}
${input.hook ? `- Opening Hook: ${input.hook}` : ''}
- Aspect Ratio: ${input.aspectRatio}
- Visual Style Preset: ${input.stylePreset}${brandHint}

Rules:
- Generate exactly 3 meaningfully different concepts (e.g., curiosity gap, bold proof/stat, clean editorial focal point).
- Headlines MUST be 2-6 punchy words so they remain readable at tiny mobile feed sizes.
- Ensure strong WCAG luminance contrast between palette.text and palette.background.
- Vary layout across: split-left, center-spotlight, bottom-editorial, stat-grid.`;

  const { response } = await generateGeminiContentWithFallback({
    ai,
    label: 'Thumbnail concept generation',
    primaryTimeoutMs: 18000,
    fallbackTimeoutMs: 30000,
    contents: prompt,
    config: {
      systemInstruction:
        'You are a YouTube & Instagram Reels thumbnail strategist and art director optimizing click-through rate and mobile readability. Return strictly valid JSON.',
      responseMimeType: 'application/json',
      responseSchema: THUMBNAIL_CONCEPTS_SCHEMA,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned empty thumbnail concepts.');
  }

  const parsed = JSON.parse(rawText) as {
    concepts?: Array<Partial<ThumbnailConcept>>;
  };

  const list = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  if (list.length === 0) {
    throw new Error('No thumbnail concepts were returned by Gemini.');
  }

  return list.slice(0, 3).map((item, idx): ThumbnailConcept => {
    const rawLayout = String(item.layout || '').trim() as ThumbnailLayoutType;
    const layout: ThumbnailLayoutType = VALID_LAYOUTS.includes(rawLayout)
      ? rawLayout
      : VALID_LAYOUTS[idx % VALID_LAYOUTS.length];

    return {
      id: `concept-${Date.now()}-${idx + 1}`,
      conceptTitle: String(item.conceptTitle || `Concept ${idx + 1}`).slice(0, 80),
      headline: String(item.headline || input.title || 'STOP SCROLLING NOW').slice(0, 90),
      kicker: String(item.kicker || 'CREATOR PLAYBOOK').slice(0, 40),
      statCallout: String(item.statCallout || '').slice(0, 24),
      layout,
      palette: {
        background: normalizeHexColor(item.palette?.background, '#0B1020'),
        surface: normalizeHexColor(item.palette?.surface, '#161F38'),
        accent: normalizeHexColor(item.palette?.accent, '#7C3AED'),
        text: normalizeHexColor(item.palette?.text, '#F8FAFC'),
        mutedText: normalizeHexColor(item.palette?.mutedText, '#CBD5E1'),
      },
      ctrRationale: String(
        item.ctrRationale || 'High-contrast headline paired with focused focal hierarchy.'
      ).slice(0, 320),
      visualPromptNote: String(
        item.visualPromptNote || 'Use a clean subject cutout or high-contrast studio shot.'
      ).slice(0, 260),
    };
  });
}

const ANALYTICS_INSIGHTS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headlineSummary: {
      type: Type.STRING,
      description: 'Crisp 2-sentence executive summary grounded strictly in the provided workspace numbers.',
    },
    topStrength: {
      type: Type.STRING,
      description: 'Strongest observed signal from the creator metrics and output cadence.',
    },
    biggestOpportunity: {
      type: Type.STRING,
      description: 'Biggest bottleneck or untapped distribution/quality lever observed in the metrics.',
    },
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          priority: {
            type: Type.STRING,
            description: 'Must be one of: high, medium, low',
          },
          title: { type: Type.STRING, description: 'Short recommendation title' },
          action: { type: Type.STRING, description: 'Concrete next step inside the creator workflow' },
          expectedImpact: { type: Type.STRING, description: 'Expected measurable outcome' },
        },
        required: ['priority', 'title', 'action', 'expectedImpact'],
      },
    },
  },
  required: ['headlineSummary', 'topStrength', 'biggestOpportunity', 'recommendations'],
};

export async function generateAnalyticsInsightsWithGemini(
  apiKey: string,
  summary: AnalyticsSummaryInput
): Promise<AnalyticsInsightsResponse> {
  const ai = createGeminiClient(apiKey);

  const prompt = `Analyze this creator workspace's real performance and production telemetry:

Filter Window: ${summary.dateRangeLabel} · Platform Filter: ${summary.platformFilter}
Workspace Totals:
- AI Content Generations: ${summary.totalGenerations}
- Saved Projects: ${summary.totalProjects}
- Saved Thumbnails: ${summary.totalThumbnails}
- Rendered Video Clips: ${summary.totalVideoJobs}
- Average Content Quality Score: ${
    summary.avgQualityScore !== null ? `${summary.avgQualityScore}/100 (across ${summary.scoredCount} scored items)` : 'Not yet scored'
  }
- Published Social Posts: ${summary.publishedPostsCount}
- Scheduled Social Posts: ${summary.scheduledPostsCount}
- Total Verified Views & Reach: ${summary.totalReachAndViews}
- Total Interactions (Likes + Comments + Shares): ${summary.totalInteractions}

Platform Breakdown:
${
  summary.platformBreakdown.length > 0
    ? summary.platformBreakdown
        .map(
          (p) =>
            `- ${p.platform}: ${p.generations} generations, ${p.publishedPosts} published posts, ${p.views} views, ${p.interactions} interactions`
        )
        .join('\n')
    : '- No platform records in selected window.'
}

Tone Distribution: ${summary.topTones.map((t) => `${t.tone} (${t.count})`).join(', ') || 'None'}
Language Distribution: ${summary.topLanguages.map((l) => `${l.language} (${l.count})`).join(', ') || 'None'}

Rules:
- Ground EVERY observation strictly in the numbers above; never invent external follower counts or unmeasured KPIs.
- If published posts or views are 0, explicitly focus recommendations on moving drafts through Quality Scoring, Thumbnail packaging, and Social Publishing Queue.
- Return 3 to 4 prioritized recommendations.`;

  const { response, modelUsed } = await generateGeminiContentWithFallback({
    ai,
    label: 'Analytics insights generation',
    primaryTimeoutMs: 18000,
    fallbackTimeoutMs: 30000,
    contents: prompt,
    config: {
      systemInstruction:
        'You are a pragmatic creator growth strategist analyzing real workspace production and social distribution metrics. Return strictly valid JSON.',
      responseMimeType: 'application/json',
      responseSchema: ANALYTICS_INSIGHTS_SCHEMA,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.MEDIUM,
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Gemini returned empty analytics insights.');
  }

  const parsed = JSON.parse(rawText) as Partial<AnalyticsInsightsResponse>;
  const recommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
        .map((rec) => {
          const pri =
            rec?.priority === 'high' || rec?.priority === 'medium' || rec?.priority === 'low'
              ? rec.priority
              : 'medium';
          return {
            priority: pri as 'high' | 'medium' | 'low',
            title: String(rec?.title || 'Optimize Workflow').slice(0, 120),
            action: String(rec?.action || '').slice(0, 320),
            expectedImpact: String(rec?.expectedImpact || '').slice(0, 240),
          };
        })
        .filter((r) => Boolean(r.action))
        .slice(0, 4)
    : [];

  return {
    headlineSummary: String(
      parsed.headlineSummary ||
        'Analyzed your current content production cadence and distribution footprint.'
    ).slice(0, 500),
    topStrength: String(
      parsed.topStrength || 'Consistent multi-platform content ideation in Content Studio.'
    ).slice(0, 320),
    biggestOpportunity: String(
      parsed.biggestOpportunity || 'Connect and publish more drafts consistently with quality checks.'
    ).slice(0, 320),
    recommendations,
    generatedAt: new Date().toISOString(),
    model: modelUsed,
  };
}
