import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  generateGeminiContentWithFallback,
  PRIMARY_GEMINI_TEXT_MODEL,
} from './server/geminiModelHelper.ts';
import {
  VALID_DURATIONS,
  VALID_LANGUAGES,
  VALID_PLATFORMS,
  VALID_TONES,
  validateAndNormalizeGeneratedPayload,
} from './src/utils/contentValidation.ts';
import {
  getAssistantJob,
  handleOrchestrateRequest,
  type OrchestrateRequestBody,
} from './server/assistantEngine.ts';
import {
  cancelUserScheduledJob,
  createOAuthAuthorizationUrl,
  disconnectPlatformAccount,
  fetchOfficialPostAnalytics,
  getAllPlatformStatuses,
  getAppBaseUrl,
  getUserScheduledStatuses,
  handleOAuthCallback,
  publishToOfficialPlatform,
  scheduleSocialPostJob,
  SOCIAL_PLATFORMS,
  startSocialScheduler,
  verifyConnectionToken,
  verifyFirebaseRequest,
} from './server/socialEngine.ts';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { BrandKitPromptContext } from './src/types/brandKit.ts';
import type { ContentLanguage } from './src/types/creator.ts';
import type {
  SocialMediaType,
  SocialPlatform,
  YouTubePrivacyStatus,
} from './src/types/social.ts';
import type {
  SubtitleStyleConfig,
  VideoAspectRatio,
  VideoSubtitleCue,
} from './src/types/videoEditor.ts';
import {
  analyzeUploadedVideoWithGemini,
  enqueueVideoRenderJob,
  getRenderJobByDownloadToken,
  getRenderJobForUser,
  getStoredVideo,
  getVideoUploadDir,
  registerUploadedVideo,
} from './server/videoEngine.ts';
import {
  generateAnalyticsInsightsWithGemini,
  generateThumbnailConceptsWithGemini,
  scoreContentWithGemini,
} from './server/studioAiEngine.ts';
import type { AnalyticsSummaryInput } from './src/types/analytics.ts';
import type { GeneratedContent } from './src/types/creator.ts';
import type {
  ThumbnailAspectRatio,
  ThumbnailStylePreset,
} from './src/types/thumbnail.ts';
import {
  AI_VIDEO_DURATIONS,
  AI_VIDEO_MUSIC_PRESETS,
  AI_VIDEO_STYLES,
  AI_VIDEO_VOICES,
  DEFAULT_RELEVANCE_THRESHOLD,
  MAX_AI_VIDEO_DURATION_SEC,
  MAX_AI_VIDEO_SCENES,
  type AiVideoDurationSec,
  type AiVideoFreeVisualStyle,
  type AiVideoMusicPreset,
  type AiVideoScenePlanItem,
  type AiVideoStoryContext,
  type AiVideoStyle,
  type AiVideoVisualEngine,
  type AiVideoVisualSourceMode,
  type AiVideoVoiceId,
} from './src/types/aiVideo.ts';
import {
  cancelAiVideoJobForUser,
  estimateAiVideoCost,
  generateMusicPreviewAudio,
  generateScriptFromIdea,
  generateVoicePreviewAudio,
  getAiVideoJobByToken,
  getAiVideoJobForUser,
  getSceneImageFileForToken,
  planScenesFromScript,
  prepareAiVideoVisualsJob,
  regenerateSingleSceneVisual,
  renderFinalFromPreparedJob,
  replaceSceneImageWithUpload,
  rerenderAiVideoJobForUser,
  retryAiVideoJobForUser,
  startAiVideoGenerationJob,
} from './server/aiVideoEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = PRIMARY_GEMINI_TEXT_MODEL;

interface GenerateRequestBody {
  sourceText?: string;
  platform?: string;
  language?: string;
  tone?: string;
  duration?: string;
  niche?: string;
  brandVoice?: string;
  brandKit?: BrandKitPromptContext | null;
  media?: {
    mimeType: string;
    data: string;
    name?: string;
    kind?: string;
  } | null;
}

function getValidApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return key;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    analysis: {
      type: Type.OBJECT,
      properties: {
        coreTopic: {
          type: Type.STRING,
          description: 'Concise 4-10 word core theme extracted from the source content or transcript',
        },
        summary: {
          type: Type.STRING,
          description: '2-3 sentence analytical summary of the core message, insights, and narrative arc',
        },
        targetAudience: {
          type: Type.STRING,
          description: 'Specific creator audience segment who will resonate most with this content',
        },
        keyTakeaways: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '3 to 5 crisp, actionable takeaways extracted from the input text, transcript, or media',
        },
        detectedLanguage: {
          type: Type.STRING,
          description: 'Detected language of the source input',
        },
      },
      required: [
        'coreTopic',
        'summary',
        'targetAudience',
        'keyTakeaways',
        'detectedLanguage',
      ],
    },
    hooks: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '5 distinct, scroll-stopping opening hooks (curiosity, contrarian, outcome, relatable pain point, fast insight)',
    },
    instagramReel: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Catchy Instagram Reel title' },
        hook: { type: Type.STRING, description: 'Primary 3-second scroll-stopping hook' },
        script: { type: Type.STRING, description: 'Timestamped short video script strictly paced for the target duration with visual & spoken cues' },
        cta: { type: Type.STRING, description: 'Clear save/comment/share call to action' },
      },
      required: ['title', 'hook', 'script', 'cta'],
    },
    youtubeShorts: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Compelling YouTube Shorts title under 70 chars' },
        script: { type: Type.STRING, description: 'Paced YouTube Shorts script with [VISUAL] and [VOICEOVER] cues' },
        description: { type: Type.STRING, description: 'SEO-ready YouTube Shorts description with key value summary' },
        cta: { type: Type.STRING, description: 'Subscriber/comment call to action' },
      },
      required: ['title', 'script', 'description', 'cta'],
    },
    instagramCaption: {
      type: Type.OBJECT,
      properties: {
        caption: { type: Type.STRING, description: 'Engaging Instagram caption with clean spacing, natural emojis, and discussion prompt' },
      },
      required: ['caption'],
    },
    hashtags: {
      type: Type.OBJECT,
      properties: {
        relevant: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '6-8 topic- and niche-relevant hashtags starting with #',
        },
        trending: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: '5-6 high-reach platform & creator-trend hashtags starting with #',
        },
      },
      required: ['relevant', 'trending'],
    },
    platformPosts: {
      type: Type.OBJECT,
      properties: {
        instagram: { type: Type.STRING, description: 'Instagram carousel or single feed post copy' },
        youtubeCommunity: { type: Type.STRING, description: 'YouTube Community tab post or engaging poll' },
        linkedin: { type: Type.STRING, description: 'Thoughtful LinkedIn post formatted with strong hook line and clean spacing' },
        facebook: { type: Type.STRING, description: 'Conversational, shareable Facebook post' },
      },
      required: ['instagram', 'youtubeCommunity', 'linkedin', 'facebook'],
    },
  },
  required: [
    'analysis',
    'hooks',
    'instagramReel',
    'youtubeShorts',
    'instagramCaption',
    'hashtags',
    'platformPosts',
  ],
};

function buildLanguageGuidance(language: string): string {
  switch (language) {
    case 'Hindi':
      return 'Write ALL generated copy (analysis summary, hooks, scripts, titles, descriptions, captions, and all platform posts) in natural, creator-authentic Hindi using Devanagari script (हिन्दी). Keep hashtags clean and discoverable (mix of Hindi/transliterated & high-reach English tags starting with #).';
    case 'Bengali':
      return 'Write ALL generated copy (analysis summary, hooks, scripts, titles, descriptions, captions, and all platform posts) in fluent, natural Bengali using Bengali script (বাংলা) tailored for Bengali-speaking creators and audiences. Keep hashtags clean and discoverable (mix of Bengali/transliterated & high-reach English tags starting with #).';
    case 'English':
      return 'Write ALL generated copy in crisp, idiomatic English.';
    default:
      return `Write ALL generated copy natively in ${language} so it sounds authentic to creators in that language.`;
  }
}

function mapGeminiError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key')
  ) {
    return {
      status: 400,
      code: 'API_KEY_INVALID',
      message:
        'Your Gemini API key is invalid. Please verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }

  if (lower.includes('permission_denied') || lower.includes('403')) {
    return {
      status: 403,
      code: 'PERMISSION_DENIED',
      message:
        'Gemini API permission denied. Please check your API key permissions in Settings > Secrets.',
    };
  }

  if (
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('429') ||
    lower.includes('rate limit')
  ) {
    return {
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      message:
        'Gemini API quota or rate limit exceeded. Please wait a moment and try again, or check your billing quota in Settings > Secrets.',
    };
  }

  if (lower.includes('not_found') || lower.includes('404')) {
    const hasSpecificModel = /model ['"]?[\w.\-]+['"]?/i.test(rawMessage);
    return {
      status: 502,
      code: 'MODEL_NOT_FOUND',
      message: hasSpecificModel
        ? rawMessage
        : `The configured AI model (${GEMINI_MODEL}) is currently unavailable or not found.`,
    };
  }

  if (lower.includes('safety') || lower.includes('blocked')) {
    return {
      status: 422,
      code: 'CONTENT_BLOCKED',
      message:
        'The AI model declined to generate content for this input due to safety filters. Please adjust your prompt and try again.',
    };
  }

  return {
    status: 502,
    code: 'AI_GENERATION_FAILED',
    message: `Gemini AI generation failed: ${rawMessage}`,
  };
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  app.use(express.json({ limit: '22mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(getValidApiKey()),
      model: GEMINI_MODEL,
    });
  });

  app.post('/api/generate', async (req, res) => {
    const body = (req.body || {}) as GenerateRequestBody;
    const sourceText =
      typeof body.sourceText === 'string' ? body.sourceText.trim() : '';
    const platform = VALID_PLATFORMS.includes(body.platform as never)
      ? (body.platform as string)
      : 'Instagram';
    const language = VALID_LANGUAGES.includes(body.language as never)
      ? (body.language as string)
      : 'English';
    const tone = VALID_TONES.includes(body.tone as never)
      ? (body.tone as string)
      : 'Educational';
    const duration = VALID_DURATIONS.includes(body.duration as never)
      ? (body.duration as string)
      : '30 sec';
    const niche =
      typeof body.niche === 'string' && body.niche.trim()
        ? body.niche.trim().slice(0, 150)
        : 'Digital Creators & Content Strategy';
    const brandVoice =
      typeof body.brandVoice === 'string' && body.brandVoice.trim()
        ? body.brandVoice.trim().slice(0, 400)
        : 'Clear, practical, authentic, and engaging without clickbait hype';
    const media = body.media || null;

    if (!sourceText && !media?.data) {
      res.status(400).json({
        error: 'Please provide a script, transcript, content idea, or media file.',
        code: 'INPUT_REQUIRED',
      });
      return;
    }

    if (sourceText.length > 44000) {
      res.status(400).json({
        error: 'Source text is too long (maximum 44,000 characters). Please shorten or split your transcript.',
        code: 'INPUT_TOO_LARGE',
      });
      return;
    }

    const apiKey = getValidApiKey();
    if (!apiKey) {
      res.status(503).json({
        error:
          'Gemini API key is not configured on the server. Please configure GEMINI_API_KEY in Settings > Secrets to generate real AI content.',
        code: 'API_KEY_MISSING',
      });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'creatorpilot-ai-build',
        },
      },
    });

    const languageGuidance = buildLanguageGuidance(language);
    const brandKit = body.brandKit || null;
    const brandKitInstructions = brandKit
      ? `\nBrand Kit Alignment (apply automatically across outputs):
- Brand Name & Handle: ${brandKit.brandName || 'Creator'}${
          brandKit.brandHandle ? ` (${brandKit.brandHandle})` : ''
        }
- Brand Voice Guidance: ${brandKit.brandVoice || brandVoice}
${
  brandKit.preferredCtas && brandKit.preferredCtas.length > 0
    ? `- Preferred CTAs to weave into Reels, Shorts & captions:\n  * ${brandKit.preferredCtas
        .slice(0, 4)
        .join('\n  * ')}`
    : ''
}
${
  brandKit.captionStyle
    ? `- Caption Formatting Preferences: Emoji density = ${brandKit.captionStyle.emojiDensity}, Line spacing = ${brandKit.captionStyle.lineSpacing}, Include hashtags in caption = ${
        brandKit.captionStyle.includeHashtagsInCaption ? 'yes' : 'no'
      }${
        brandKit.captionStyle.signatureFooter?.trim()
          ? `, End caption with signature footer: "${brandKit.captionStyle.signatureFooter.trim()}"`
          : ''
      }`
    : ''
}
${
  brandKit.templateName
    ? `- Active Brand Template "${brandKit.templateName}":${
        brandKit.hookFormula ? ` Hook formula: ${brandKit.hookFormula}.` : ''
      }${
        brandKit.structureNotes
          ? ` Structure blueprint: ${brandKit.structureNotes}`
          : ''
      }`
    : ''
}`
      : '';

    const systemInstruction = `You are CreatorPilot AI, an autonomous senior content strategist, scriptwriter, and social media editor.

Your job is to:
1. Deeply analyze the creator's input text, transcript, or attached audio/video media.
2. Extract the core topic, analytical summary, target audience, and 3-5 concrete key takeaways.
3. Generate 5 distinct, scroll-stopping opening hooks using varied angles (curiosity gap, contrarian insight, direct outcome, relatable pain point, fast proof/story).
4. Produce ready-to-publish, platform-native deliverables:
   - Instagram Reel (title, primary 3s hook, timestamped script strictly paced for ${duration} with visual/action cues, and clear CTA)
   - YouTube Shorts (compelling title under 70 characters, paced script with [VISUAL] & [VOICEOVER] cues, SEO-friendly YouTube description, and subscribe/comment CTA)
   - Instagram Caption (well-spaced, engaging caption with fitting emojis and a conversation prompt)
   - Hashtags (6-8 relevant niche/topic hashtags + 5-6 high-reach trending hashtags, every tag starting with #)
   - Platform-Specific Posts:
     * Instagram carousel/feed post copy
     * YouTube Community tab post or interactive poll
     * LinkedIn post (strong first line, scannable short paragraphs, thoughtful discussion prompt)
     * Facebook post (warm, conversational, shareable)

Language requirement:
${languageGuidance}

Creator Profile & Voice Constraints:
- Primary Platform Focus: ${platform}
- Content Tone: ${tone}
- Creator Niche: ${niche}
- Customizable Brand Voice: ${brandVoice}
- Target Video Duration: ${duration}${brandKitInstructions}

Strict Quality Rules:
- Stay faithful to the facts and ideas in the user's input; do not invent unrelated claims.
- Adapt structure, rhythm, and length natively for each platform rather than duplicating the same paragraph across posts.
- Return strictly valid JSON matching the provided responseSchema.`;

    const textPrompt = sourceText
      ? `Analyze the following creator content / transcript and generate the complete multi-platform content bundle:

"""
${sourceText}
"""

Configuration:
- Primary Platform Focus: ${platform}
- Output Language: ${language}
- Tone: ${tone}
- Creator Niche: ${niche}
- Brand Voice: ${brandVoice}
- Short Video Duration: ${duration}`
      : `Analyze the attached ${media?.kind || 'media'} file (${media?.name || 'upload'}), transcribe/extract its core narrative and key takeaways, and transform it into the complete multi-platform creator content bundle.

Configuration:
- Primary Platform Focus: ${platform}
- Output Language: ${language}
- Tone: ${tone}
- Creator Niche: ${niche}
- Brand Voice: ${brandVoice}
- Short Video Duration: ${duration}`;

    const contents = media?.data
      ? {
          parts: [
            {
              inlineData: {
                mimeType: media.mimeType,
                data: media.data,
              },
            },
            { text: textPrompt },
          ],
        }
      : textPrompt;

    try {
      let lastValidationError = 'Empty response from AI model.';
      const maxAttempts = 2;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const promptForAttempt =
          attempt === 1
            ? contents
            : typeof contents === 'string'
            ? `${contents}\n\nIMPORTANT: Ensure EVERY required field in the JSON schema is populated and non-empty (including analysis, 5 hooks, scripts, captions, hashtags, and all 4 platformPosts).`
            : {
                parts: [
                  ...contents.parts,
                  {
                    text: 'IMPORTANT: Ensure EVERY required field in the JSON schema is populated and non-empty (including analysis, 5 hooks, scripts, captions, hashtags, and all 4 platformPosts).',
                  },
                ],
              };

        const { response, modelUsed } = await generateGeminiContentWithFallback({
          ai,
          label: 'Content Studio bundle generation',
          primaryTimeoutMs: 22000,
          fallbackTimeoutMs: 35000,
          contents: promptForAttempt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.MEDIUM,
            },
          },
        });

        const rawJson = (response.text ?? '').trim();
        if (!rawJson) {
          lastValidationError = 'Gemini returned an empty response.';
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawJson);
        } catch {
          lastValidationError = 'Gemini returned malformed JSON.';
          continue;
        }

        const validation = validateAndNormalizeGeneratedPayload(parsed);
        if (!validation.ok) {
          lastValidationError = validation.error;
          continue;
        }

        res.json({
          engine: 'gemini',
          model: modelUsed,
          generatedAt: new Date().toISOString(),
          data: validation.data,
        });
        return;
      }

      res.status(502).json({
        error: `AI response validation failed: ${lastValidationError}`,
        code: 'INVALID_AI_RESPONSE',
      });
    } catch (error) {
      const mapped = mapGeminiError(error);
      console.error('Gemini API error:', mapped.code, error);
      res.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code,
      });
    }
  });

  app.post('/api/assistant/orchestrate', async (req, res) => {
    const result = await handleOrchestrateRequest(
      (req.body || {}) as OrchestrateRequestBody
    );
    res.status(result.statusCode).json(result.payload);
  });

  app.get('/api/assistant/jobs/:jobId', (req, res) => {
    const job = getAssistantJob(req.params.jobId);
    if (!job) {
      res.status(404).json({
        error: 'Assistant job not found or expired on server.',
        code: 'JOB_NOT_FOUND',
      });
      return;
    }
    res.json(job);
  });

  app.post('/api/assistant/publish', (req, res) => {
    const body = (req.body || {}) as {
      taskId?: string;
      approvalStatus?: string;
      confirmedByUser?: boolean;
      title?: string;
      clipsCount?: number;
    };

    if (body.approvalStatus !== 'approved' || body.confirmedByUser !== true) {
      res.status(403).json({
        error:
          'User approval and explicit publish confirmation are required before publishing any generated bundle.',
        code: 'APPROVAL_REQUIRED',
      });
      return;
    }

    if (!body.taskId || typeof body.taskId !== 'string') {
      res.status(400).json({
        error: 'Valid taskId is required to publish an approved bundle.',
        code: 'TASK_ID_REQUIRED',
      });
      return;
    }

    const publishedAt = new Date().toISOString();
    res.json({
      published: true,
      taskId: body.taskId,
      publishedAt,
      message: `Approved bundle "${(body.title || 'Assistant Campaign').slice(0, 100)}" confirmed for publishing (${body.clipsCount ?? 0} clips).`,
    });
  });

  // Social Media Official API Routes (Auth-verified via Firebase ID token; tokens never leave server)
  const isValidSocialPlatformParam = (p: string): p is SocialPlatform =>
    SOCIAL_PLATFORMS.includes(p as SocialPlatform);

  app.get('/api/social/status', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({
        error: 'Authentication required. Sign in to view social account connections.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const baseUrl = getAppBaseUrl(req);
    const { requirements, connections } = getAllPlatformStatuses(
      authUser.uid,
      baseUrl
    );
    const scheduledJobs = getUserScheduledStatuses(authUser.uid);
    res.json({ requirements, connections, scheduledJobs });
  });

  app.get('/api/social/oauth/:platform/url', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({
        error: 'Authentication required to initiate OAuth connection.',
        code: 'UNAUTHORIZED',
      });
      return;
    }

    const platform = req.params.platform;
    if (!isValidSocialPlatformParam(platform)) {
      res.status(400).json({ error: 'Unsupported social platform.', code: 'INVALID_PLATFORM' });
      return;
    }

    const baseUrl = getAppBaseUrl(req);
    const result = createOAuthAuthorizationUrl(authUser.uid, platform, baseUrl);
    if (!result.ok) {
      res.status(result.statusCode).json({
        error: result.error,
        code: result.code,
        requirement: result.requirement,
      });
      return;
    }

    res.json({ url: result.url, redirectUri: result.redirectUri });
  });

  app.get(
    ['/api/social/oauth/:platform/callback', '/api/social/oauth/:platform/callback/'],
    async (req, res) => {
      const platform = req.params.platform;
      if (!isValidSocialPlatformParam(platform)) {
        res.status(400).send('Unsupported social platform.');
        return;
      }

      const result = await handleOAuthCallback(
        platform,
        req.query as Record<string, unknown>
      );
      res.status(result.statusCode).type('html').send(result.html);
    }
  );

  app.post('/api/social/connections/:platform/verify', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const platform = req.params.platform;
    if (!isValidSocialPlatformParam(platform)) {
      res.status(400).json({ error: 'Unsupported social platform.', code: 'INVALID_PLATFORM' });
      return;
    }

    const result = await verifyConnectionToken(
      authUser.uid,
      platform,
      getAppBaseUrl(req)
    );
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.delete('/api/social/connections/:platform', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const platform = req.params.platform;
    if (!isValidSocialPlatformParam(platform)) {
      res.status(400).json({ error: 'Unsupported social platform.', code: 'INVALID_PLATFORM' });
      return;
    }

    const connection = disconnectPlatformAccount(
      authUser.uid,
      platform,
      getAppBaseUrl(req)
    );
    res.json({ ok: true, connection });
  });

  app.post('/api/social/posts/publish', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      postId?: string;
      platform?: string;
      title?: string;
      caption?: string;
      hashtags?: string[];
      mediaType?: SocialMediaType;
      mediaUrl?: string;
      youtubePrivacy?: YouTubePrivacyStatus;
      approvalStatus?: string;
    };

    if (!body.platform || !isValidSocialPlatformParam(body.platform)) {
      res.status(400).json({ error: 'Valid platform is required.', code: 'INVALID_PLATFORM' });
      return;
    }

    const result = await publishToOfficialPlatform({
      uid: authUser.uid,
      platform: body.platform,
      title: body.title,
      caption: String(body.caption || ''),
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
      mediaType: body.mediaType || 'none',
      mediaUrl: body.mediaUrl,
      youtubePrivacy: body.youtubePrivacy,
      approvalStatus: String(body.approvalStatus || ''),
    });

    if (!result.ok) {
      res.status(result.statusCode).json({
        error: result.error,
        code: result.code,
      });
      return;
    }

    res.json({
      published: true,
      externalPostId: result.externalPostId,
      externalPostUrl: result.externalPostUrl,
      publishedAt: result.publishedAt,
    });
  });

  app.post('/api/social/posts/schedule', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      postId?: string;
      platform?: string;
      title?: string;
      caption?: string;
      hashtags?: string[];
      mediaType?: SocialMediaType;
      mediaUrl?: string;
      youtubePrivacy?: YouTubePrivacyStatus;
      approvalStatus?: string;
      scheduledFor?: string;
    };

    if (!body.postId || !body.platform || !isValidSocialPlatformParam(body.platform)) {
      res.status(400).json({
        error: 'Valid postId and platform are required to schedule.',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    const result = scheduleSocialPostJob({
      uid: authUser.uid,
      postId: body.postId,
      platform: body.platform,
      title: body.title,
      caption: String(body.caption || ''),
      hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
      mediaType: body.mediaType || 'none',
      mediaUrl: body.mediaUrl,
      youtubePrivacy: body.youtubePrivacy,
      approvalStatus: String(body.approvalStatus || ''),
      scheduledFor: String(body.scheduledFor || ''),
    });

    if (!result.ok) {
      res.status(result.statusCode).json({
        error: result.error,
        code: result.code,
      });
      return;
    }

    res.json({ scheduled: true, scheduledFor: result.scheduledFor });
  });

  app.delete('/api/social/posts/:postId/schedule', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const cancelled = cancelUserScheduledJob(authUser.uid, req.params.postId);
    res.json({ cancelled });
  });

  app.post('/api/social/posts/analytics', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      platform?: string;
      externalPostId?: string;
    };

    if (
      !body.platform ||
      !isValidSocialPlatformParam(body.platform) ||
      !body.externalPostId?.trim()
    ) {
      res.status(400).json({
        error: 'Valid platform and externalPostId are required.',
        code: 'INVALID_REQUEST',
      });
      return;
    }

    const result = await fetchOfficialPostAnalytics({
      uid: authUser.uid,
      platform: body.platform,
      externalPostId: body.externalPostId.trim(),
    });

    if (!result.ok) {
      res.status(result.statusCode).json({
        error: result.error,
        code: result.code,
      });
      return;
    }

    res.json({ analytics: result.analytics });
  });

  // AI Smart Video Editor Routes (Real FFmpeg + Python Worker + Gemini Highlight Analysis)
  const MAX_VIDEO_UPLOAD_BYTES = 250 * 1024 * 1024;

  app.post('/api/video/upload', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required to upload video.', code: 'UNAUTHORIZED' });
      return;
    }

    const rawNameHeader = req.headers['x-file-name'];
    const rawMimeHeader = req.headers['x-file-type'];
    const originalName =
      typeof rawNameHeader === 'string' && rawNameHeader.trim()
        ? decodeURIComponent(rawNameHeader).replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 180)
        : `upload-${Date.now()}.mp4`;
    const mimeType =
      typeof rawMimeHeader === 'string' && rawMimeHeader.startsWith('video/')
        ? rawMimeHeader
        : 'video/mp4';

    const ext = path.extname(originalName) || '.mp4';
    const tempFilePath = path.join(
      getVideoUploadDir(),
      `src-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`
    );

    const writeStream = fs.createWriteStream(tempFilePath);
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_VIDEO_UPLOAD_BYTES) {
        aborted = true;
        writeStream.destroy();
        fs.unlink(tempFilePath, () => {});
        if (!res.headersSent) {
          res.status(413).json({
            error: 'Video exceeds the 250 MB upload limit.',
            code: 'FILE_TOO_LARGE',
          });
        }
        return;
      }
      writeStream.write(chunk);
    });

    req.on('end', async () => {
      if (aborted) return;
      writeStream.end(async () => {
        if (totalBytes === 0) {
          fs.unlink(tempFilePath, () => {});
          res.status(400).json({ error: 'Empty video file uploaded.', code: 'EMPTY_FILE' });
          return;
        }
        try {
          const metadata = await registerUploadedVideo({
            uid: authUser.uid,
            fileName: originalName,
            mimeType,
            filePath: tempFilePath,
            sizeBytes: totalBytes,
          });
          res.json({ video: metadata });
        } catch (err) {
          fs.unlink(tempFilePath, () => {});
          res.status(422).json({
            error:
              err instanceof Error
                ? err.message
                : 'FFprobe could not inspect the uploaded video file.',
            code: 'PROBE_FAILED',
          });
        }
      });
    });

    req.on('error', () => {
      aborted = true;
      writeStream.destroy();
      fs.unlink(tempFilePath, () => {});
      if (!res.headersSent) {
        res.status(500).json({ error: 'Video upload stream failed.', code: 'UPLOAD_FAILED' });
      }
    });
  });

  app.post('/api/video/analyze', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      uploadId?: string;
      language?: string;
      focusPrompt?: string;
    };

    if (!body.uploadId) {
      res.status(400).json({ error: 'uploadId is required.', code: 'MISSING_UPLOAD_ID' });
      return;
    }

    const video = getStoredVideo(authUser.uid, body.uploadId);
    if (!video) {
      res.status(404).json({
        error: 'Uploaded video not found on server. Please re-upload your video file.',
        code: 'VIDEO_NOT_FOUND',
      });
      return;
    }

    try {
      const language = VALID_LANGUAGES.includes(body.language as never)
        ? (body.language as ContentLanguage)
        : 'English';
      const analysis = await analyzeUploadedVideoWithGemini({
        video,
        language,
        focusPrompt: body.focusPrompt,
      });
      res.json(analysis);
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/video/render', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      jobId?: string;
      uploadId?: string;
      clipTitle?: string;
      startSec?: number;
      endSec?: number;
      aspectRatio?: VideoAspectRatio;
      subtitles?: VideoSubtitleCue[];
      subtitleStyle?: SubtitleStyleConfig;
    };

    if (!body.uploadId) {
      res.status(400).json({ error: 'uploadId is required.', code: 'MISSING_UPLOAD_ID' });
      return;
    }

    const video = getStoredVideo(authUser.uid, body.uploadId);
    if (!video) {
      res.status(404).json({
        error: 'Source video expired from temporary worker storage. Please re-upload.',
        code: 'VIDEO_NOT_FOUND',
      });
      return;
    }

    const startSec = Number(body.startSec ?? 0);
    const endSec = Number(body.endSec ?? Math.min(video.durationSec || 15, startSec + 15));
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
      res.status(400).json({
        error: 'Clip end time must be greater than start time.',
        code: 'INVALID_TRIM_RANGE',
      });
      return;
    }

    const aspectRatio: VideoAspectRatio =
      body.aspectRatio === '1:1' || body.aspectRatio === '16:9' ? body.aspectRatio : '9:16';

    const job = enqueueVideoRenderJob({
      uid: authUser.uid,
      jobId: body.jobId,
      video,
      clipTitle: (body.clipTitle || 'Creator Clip').trim() || 'Creator Clip',
      startSec,
      endSec,
      aspectRatio,
      subtitles: Array.isArray(body.subtitles) ? body.subtitles : [],
      subtitleStyle: body.subtitleStyle || {
        fontFamily: 'DejaVu Sans',
        fontSize: 44,
        primaryColor: '#FFFFFF',
        outlineColor: '#0F172A',
        backgroundColor: '#0F172A',
        position: 'bottom',
        uppercase: false,
      },
    });

    res.json({
      job: {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        stageMessage: job.stageMessage,
        outputFileName: job.outputFileName,
        downloadUrl: `/api/video/jobs/${encodeURIComponent(job.jobId)}/download?token=${encodeURIComponent(
          job.downloadToken
        )}`,
      },
    });
  });

  app.get('/api/video/jobs/:jobId', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const job = getRenderJobForUser(authUser.uid, req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Video render job not found.', code: 'JOB_NOT_FOUND' });
      return;
    }

    res.json({
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      stageMessage: job.stageMessage,
      outputFileName: job.outputFileName,
      outputBytes: job.outputBytes,
      error: job.error,
      downloadUrl:
        job.status === 'completed'
          ? `/api/video/jobs/${encodeURIComponent(job.jobId)}/download?token=${encodeURIComponent(
              job.downloadToken
            )}`
          : undefined,
      updatedAt: job.updatedAt,
    });
  });

  app.get('/api/video/jobs/:jobId/download', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const job = getRenderJobByDownloadToken(req.params.jobId, token);
    if (!job || job.status !== 'completed' || !fs.existsSync(job.outputPath)) {
      res.status(404).json({ error: 'Rendered MP4 file not found.', code: 'MP4_NOT_FOUND' });
      return;
    }

    const stat = fs.statSync(job.outputPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (req.query.download === '1') {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${job.outputFileName}"`
      );
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(job.outputPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(job.outputPath).pipe(res);
    }
  });

  app.post('/api/content/score', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const apiKey = getValidApiKey();
    if (!apiKey) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server.',
        code: 'API_KEY_MISSING',
      });
      return;
    }

    const body = (req.body || {}) as {
      result?: GeneratedContent;
      platform?: string;
      tone?: string;
      duration?: string;
      niche?: string;
      brandVoice?: string;
    };

    if (!body.result || !body.result.instagramReel || !body.result.youtubeShorts) {
      res.status(400).json({
        error: 'Generated content bundle is required for quality scoring.',
        code: 'INVALID_CONTENT_BUNDLE',
      });
      return;
    }

    try {
      const score = await scoreContentWithGemini(apiKey, {
        result: body.result,
        platform: body.platform,
        tone: body.tone,
        duration: body.duration,
        niche: body.niche,
        brandVoice: body.brandVoice,
      });
      res.json({ score });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/thumbnails/concepts', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const apiKey = getValidApiKey();
    if (!apiKey) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server.',
        code: 'API_KEY_MISSING',
      });
      return;
    }

    const body = (req.body || {}) as {
      topic?: string;
      title?: string;
      hook?: string;
      aspectRatio?: ThumbnailAspectRatio;
      stylePreset?: ThumbnailStylePreset;
      brandKit?: {
        brandName?: string;
        colors?: { primary?: string; secondary?: string; accent?: string };
      } | null;
    };

    const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!topic && !title) {
      res.status(400).json({
        error: 'Please provide a video topic or title to generate thumbnail concepts.',
        code: 'TOPIC_REQUIRED',
      });
      return;
    }

    const aspectRatio: ThumbnailAspectRatio =
      body.aspectRatio === '9:16' || body.aspectRatio === '1:1' ? body.aspectRatio : '16:9';
    const validPresets: ThumbnailStylePreset[] = [
      'bold-creator',
      'editorial-minimal',
      'tech-dark',
      'split-comparison',
      'stat-spotlight',
    ];
    const stylePreset: ThumbnailStylePreset = validPresets.includes(
      body.stylePreset as ThumbnailStylePreset
    )
      ? (body.stylePreset as ThumbnailStylePreset)
      : 'bold-creator';

    try {
      const concepts = await generateThumbnailConceptsWithGemini(apiKey, {
        topic: topic || title,
        title: title || undefined,
        hook: typeof body.hook === 'string' ? body.hook.trim().slice(0, 240) : undefined,
        aspectRatio,
        stylePreset,
        brandKit: body.brandKit || null,
      });
      res.json({ concepts });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/analytics/insights', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const apiKey = getValidApiKey();
    if (!apiKey) {
      res.status(503).json({
        error: 'Gemini API key is not configured on the server.',
        code: 'API_KEY_MISSING',
      });
      return;
    }

    const body = (req.body || {}) as { summary?: AnalyticsSummaryInput };
    if (!body.summary || typeof body.summary.totalGenerations !== 'number') {
      res.status(400).json({
        error: 'Analytics workspace summary is required.',
        code: 'SUMMARY_REQUIRED',
      });
      return;
    }

    try {
      const insights = await generateAnalyticsInsightsWithGemini(apiKey, body.summary);
      res.json({ insights });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  // =========================================================================
  // Automatic AI Script-to-Video Generation Routes
  // =========================================================================

  app.get('/api/ai-video/config', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }
    res.json({
      geminiConfigured: Boolean(getValidApiKey()),
      limits: {
        maxScenes: MAX_AI_VIDEO_SCENES,
        maxDurationSec: MAX_AI_VIDEO_DURATION_SEC,
      },
      durations: AI_VIDEO_DURATIONS,
      styles: AI_VIDEO_STYLES,
      voices: AI_VIDEO_VOICES,
      musicPresets: AI_VIDEO_MUSIC_PRESETS,
    });
  });

  app.post('/api/ai-video/script-from-idea', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      idea?: string;
      durationSec?: number;
      style?: AiVideoStyle;
      language?: string;
    };

    if (!body.idea?.trim()) {
      res.status(400).json({ error: 'Please enter a topic or video idea.', code: 'IDEA_REQUIRED' });
      return;
    }

    const durNum = Number(body.durationSec);
    const durationSec: AiVideoDurationSec =
      durNum === 15 || durNum === 30 || durNum === 60 || durNum === 90 ? durNum : 30;
    const style: AiVideoStyle = AI_VIDEO_STYLES.some((s) => s.id === body.style)
      ? (body.style as AiVideoStyle)
      : 'cinematic';
    const language: ContentLanguage = VALID_LANGUAGES.includes(body.language as never)
      ? (body.language as ContentLanguage)
      : 'English';

    try {
      const generated = await generateScriptFromIdea({
        idea: body.idea,
        durationSec,
        style,
        language,
      });
      res.json(generated);
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/ai-video/plan', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      script?: string;
      style?: AiVideoStyle;
      durationSec?: number;
      aspectRatio?: VideoAspectRatio;
      language?: string;
      title?: string;
      musicPreset?: AiVideoMusicPreset;
      visualEngine?: AiVideoVisualEngine;
    };

    const script = typeof body.script === 'string' ? body.script.trim() : '';
    if (!script) {
      res.status(400).json({ error: 'Script is required to build a scene plan.', code: 'SCRIPT_REQUIRED' });
      return;
    }
    if (script.length > 16000) {
      res.status(400).json({
        error: 'Script exceeds 16,000 characters. Please shorten it for video generation.',
        code: 'SCRIPT_TOO_LONG',
      });
      return;
    }

    const durNum = Number(body.durationSec);
    const durationSec: AiVideoDurationSec =
      durNum === 15 || durNum === 30 || durNum === 60 || durNum === 90 ? durNum : 30;
    const style: AiVideoStyle = AI_VIDEO_STYLES.some((s) => s.id === body.style)
      ? (body.style as AiVideoStyle)
      : 'cinematic';
    const aspectRatio: VideoAspectRatio =
      body.aspectRatio === '16:9' || body.aspectRatio === '1:1' ? body.aspectRatio : '9:16';
    const language: ContentLanguage = VALID_LANGUAGES.includes(body.language as never)
      ? (body.language as ContentLanguage)
      : 'English';
    const musicPreset: AiVideoMusicPreset = AI_VIDEO_MUSIC_PRESETS.some(
      (m) => m.id === body.musicPreset
    )
      ? (body.musicPreset as AiVideoMusicPreset)
      : 'ambient-uplift';
    const visualEngine: AiVideoVisualEngine =
      body.visualEngine === 'ai-omni' ? 'ai-omni' : 'free-motion';

    try {
      const planned = await planScenesFromScript({
        script,
        style,
        durationSec,
        aspectRatio,
        language,
        title: body.title,
        visualEngine,
        musicPreset,
      });
      res.json({
        plan: planned.plan,
        costEstimate: planned.costEstimate,
        planningMode: planned.planningMode,
        planningNote: planned.planningNote,
      });
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/ai-video/estimate', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      visualEngine?: AiVideoVisualEngine;
      sceneCount?: number;
      totalDurationSec?: number;
      musicPreset?: AiVideoMusicPreset;
      voice?: AiVideoVoiceId;
    };
    const musicPreset: AiVideoMusicPreset = AI_VIDEO_MUSIC_PRESETS.some(
      (m) => m.id === body.musicPreset
    )
      ? (body.musicPreset as AiVideoMusicPreset)
      : 'ambient-uplift';
    const visualEngine: AiVideoVisualEngine =
      body.visualEngine === 'ai-omni' ? 'ai-omni' : 'free-motion';
    const voice: AiVideoVoiceId | undefined = AI_VIDEO_VOICES.some((v) => v.id === body.voice)
      ? (body.voice as AiVideoVoiceId)
      : undefined;
    const costEstimate = estimateAiVideoCost({
      visualEngine,
      sceneCount: Number(body.sceneCount || 5),
      totalDurationSec: Number(body.totalDurationSec || 30),
      musicPreset,
      voice,
    });
    res.json({ costEstimate });
  });

  app.post('/api/ai-video/voice-preview', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      voice?: AiVideoVoiceId;
      language?: string;
      sampleText?: string;
      visualEngine?: AiVideoVisualEngine;
    };

    const voice: AiVideoVoiceId = AI_VIDEO_VOICES.some((v) => v.id === body.voice)
      ? (body.voice as AiVideoVoiceId)
      : 'Kore';
    if (voice === 'none') {
      res.status(400).json({
        error: 'Select an AI voice (Kore, Puck, Charon, Fenrir, or Zephyr) to preview speech.',
        code: 'VOICE_NONE',
      });
      return;
    }
    const language: ContentLanguage = VALID_LANGUAGES.includes(body.language as never)
      ? (body.language as ContentLanguage)
      : 'English';
    const visualEngine: AiVideoVisualEngine =
      body.visualEngine === 'ai-omni' ? 'ai-omni' : 'free-motion';

    try {
      const audio = await generateVoicePreviewAudio({
        voice,
        language,
        sampleText: body.sampleText,
        visualEngine,
      });
      res.json(audio);
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/ai-video/music-preview', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as { preset?: AiVideoMusicPreset };
    const preset: AiVideoMusicPreset = AI_VIDEO_MUSIC_PRESETS.some(
      (m) => m.id === body.preset
    )
      ? (body.preset as AiVideoMusicPreset)
      : 'ambient-uplift';

    try {
      const audio = await generateMusicPreviewAudio({ preset });
      res.json(audio);
    } catch (err) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  const parseAiVideoJobPayload = (reqBody: unknown) => {
    const body = (reqBody || {}) as {
      jobId?: string;
      visualEngine?: AiVideoVisualEngine;
      freeVisualStyle?: AiVideoFreeVisualStyle;
      visualSourceMode?: AiVideoVisualSourceMode;
      relevanceThreshold?: number;
      storyContext?: AiVideoStoryContext;
      confirmedByUser?: boolean;
      title?: string;
      originalScript?: string;
      style?: AiVideoStyle;
      durationSec?: number;
      aspectRatio?: VideoAspectRatio;
      language?: string;
      voice?: AiVideoVoiceId;
      narrationVolume?: number;
      musicPreset?: AiVideoMusicPreset;
      musicVolume?: number;
      enableSubtitles?: boolean;
      subtitleStyle?: SubtitleStyleConfig;
      scenes?: AiVideoScenePlanItem[];
    };

    const durNum = Number(body.durationSec);
    const durationSec: AiVideoDurationSec =
      durNum === 15 || durNum === 30 || durNum === 60 || durNum === 90 ? durNum : 30;
    const style: AiVideoStyle = AI_VIDEO_STYLES.some((s) => s.id === body.style)
      ? (body.style as AiVideoStyle)
      : 'cinematic';
    const aspectRatio: VideoAspectRatio =
      body.aspectRatio === '16:9' || body.aspectRatio === '1:1' ? body.aspectRatio : '9:16';
    const language: ContentLanguage = VALID_LANGUAGES.includes(body.language as never)
      ? (body.language as ContentLanguage)
      : 'English';
    const voice: AiVideoVoiceId = AI_VIDEO_VOICES.some((v) => v.id === body.voice)
      ? (body.voice as AiVideoVoiceId)
      : 'Kore';
    const narrationVolume =
      typeof body.narrationVolume === 'number' && Number.isFinite(body.narrationVolume)
        ? Math.max(0, Math.min(1.5, body.narrationVolume))
        : 1.0;
    const musicPreset: AiVideoMusicPreset = AI_VIDEO_MUSIC_PRESETS.some(
      (m) => m.id === body.musicPreset
    )
      ? (body.musicPreset as AiVideoMusicPreset)
      : 'ambient-uplift';
    const visualEngine: AiVideoVisualEngine =
      body.visualEngine === 'ai-omni' ? 'ai-omni' : 'free-motion';
    const freeVisualStyle: AiVideoFreeVisualStyle = 'topic-pictures';
    const visualSourceMode: AiVideoVisualSourceMode =
      body.visualSourceMode === 'retrieve-only' || body.visualSourceMode === 'ai-only'
        ? body.visualSourceMode
        : 'ai-then-retrieve';
    const relevanceThreshold =
      typeof body.relevanceThreshold === 'number' && Number.isFinite(body.relevanceThreshold)
        ? Math.max(60, Math.min(98, Math.round(body.relevanceThreshold)))
        : DEFAULT_RELEVANCE_THRESHOLD;

    return {
      body,
      durationSec,
      style,
      aspectRatio,
      language,
      voice,
      narrationVolume,
      musicPreset,
      visualEngine,
      freeVisualStyle,
      visualSourceMode,
      relevanceThreshold,
    };
  };

  app.post('/api/ai-video/prepare-visuals', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const parsed = parseAiVideoJobPayload(req.body);
    const { body } = parsed;
    if (!body.originalScript?.trim() || !Array.isArray(body.scenes) || body.scenes.length === 0) {
      res.status(400).json({
        error: 'Original script and planned scenes are required to prepare scene visuals.',
        code: 'PLAN_REQUIRED',
      });
      return;
    }

    try {
      const serverJob = prepareAiVideoVisualsJob({
        uid: authUser.uid,
        jobId: body.jobId,
        visualEngine: parsed.visualEngine,
        freeVisualStyle: parsed.freeVisualStyle,
        visualSourceMode: parsed.visualSourceMode,
        relevanceThreshold: parsed.relevanceThreshold,
        storyContext: body.storyContext,
        title: body.title || 'AI Generated Video',
        originalScript: body.originalScript,
        style: parsed.style,
        durationSec: parsed.durationSec,
        aspectRatio: parsed.aspectRatio,
        language: parsed.language,
        voice: parsed.voice,
        narrationVolume: parsed.narrationVolume,
        musicPreset: parsed.musicPreset,
        musicVolume: typeof body.musicVolume === 'number' ? body.musicVolume : 0.22,
        enableSubtitles: body.enableSubtitles !== false,
        subtitleStyle: body.subtitleStyle || {
          fontFamily: 'DejaVu Sans',
          fontSize: 44,
          primaryColor: '#FFFFFF',
          outlineColor: '#0F172A',
          backgroundColor: '#0F172A',
          position: 'bottom',
          uppercase: false,
        },
        scenes: body.scenes,
      });

      const status = getAiVideoJobForUser(authUser.uid, serverJob.record.id);
      res.status(202).json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not prepare scene visuals.';
      const statusCode = message.includes('already in progress') || message.includes('Duplicate')
        ? 409
        : 400;
      res.status(statusCode).json({ error: message, code: 'PREPARE_FAILED' });
    }
  });

  app.post('/api/ai-video/generate', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const parsed = parseAiVideoJobPayload(req.body);
    const { body } = parsed;

    if (body.confirmedByUser !== true) {
      res.status(403).json({
        error: 'Explicit user confirmation of estimated cost and limits is required before starting AI video generation.',
        code: 'CONFIRMATION_REQUIRED',
      });
      return;
    }

    if (!body.originalScript?.trim() || !Array.isArray(body.scenes) || body.scenes.length === 0) {
      res.status(400).json({
        error: 'Original script and planned scenes are required to start video generation.',
        code: 'PLAN_REQUIRED',
      });
      return;
    }

    try {
      const serverJob = startAiVideoGenerationJob({
        uid: authUser.uid,
        jobId: body.jobId,
        visualEngine: parsed.visualEngine,
        freeVisualStyle: parsed.freeVisualStyle,
        visualSourceMode: parsed.visualSourceMode,
        relevanceThreshold: parsed.relevanceThreshold,
        storyContext: body.storyContext,
        title: body.title || 'AI Generated Video',
        originalScript: body.originalScript,
        style: parsed.style,
        durationSec: parsed.durationSec,
        aspectRatio: parsed.aspectRatio,
        language: parsed.language,
        voice: parsed.voice,
        narrationVolume: parsed.narrationVolume,
        musicPreset: parsed.musicPreset,
        musicVolume: typeof body.musicVolume === 'number' ? body.musicVolume : 0.22,
        enableSubtitles: body.enableSubtitles !== false,
        subtitleStyle: body.subtitleStyle || {
          fontFamily: 'DejaVu Sans',
          fontSize: 44,
          primaryColor: '#FFFFFF',
          outlineColor: '#0F172A',
          backgroundColor: '#0F172A',
          position: 'bottom',
          uppercase: false,
        },
        scenes: body.scenes,
      });

      const status = getAiVideoJobForUser(authUser.uid, serverJob.record.id);
      res.status(202).json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start AI video job.';
      const statusCode = message.includes('already in progress') || message.includes('Duplicate')
        ? 409
        : 400;
      res.status(statusCode).json({ error: message, code: 'START_FAILED' });
    }
  });

  app.get('/api/ai-video/jobs/:jobId', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const status = getAiVideoJobForUser(authUser.uid, req.params.jobId);
    if (!status) {
      res.status(404).json({ error: 'AI video job not found on server.', code: 'JOB_NOT_FOUND' });
      return;
    }
    res.json(status);
  });

  app.post('/api/ai-video/jobs/:jobId/cancel', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const cancelled = cancelAiVideoJobForUser(authUser.uid, req.params.jobId);
    res.json({ cancelled });
  });

  app.post('/api/ai-video/jobs/:jobId/retry', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    try {
      const serverJob = retryAiVideoJobForUser(authUser.uid, req.params.jobId);
      const status = getAiVideoJobForUser(authUser.uid, serverJob.record.id);
      res.status(202).json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not retry job.';
      res.status(400).json({ error: message, code: 'RETRY_FAILED' });
    }
  });

  app.post('/api/ai-video/jobs/:jobId/render', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      narrationVolume?: number;
      musicPreset?: AiVideoMusicPreset;
      musicVolume?: number;
      enableSubtitles?: boolean;
      subtitleStyle?: SubtitleStyleConfig;
    };

    try {
      const serverJob = rerenderAiVideoJobForUser(authUser.uid, req.params.jobId, body);
      const status = getAiVideoJobForUser(authUser.uid, serverJob.record.id);
      res.status(202).json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not re-render video.';
      res.status(400).json({ error: message, code: 'RERENDER_FAILED' });
    }
  });

  app.post('/api/ai-video/jobs/:jobId/render-final', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      narrationVolume?: number;
      musicPreset?: AiVideoMusicPreset;
      musicVolume?: number;
      enableSubtitles?: boolean;
      subtitleStyle?: SubtitleStyleConfig;
    };

    try {
      const serverJob = renderFinalFromPreparedJob(authUser.uid, req.params.jobId, body);
      const status = getAiVideoJobForUser(authUser.uid, serverJob.record.id);
      res.status(202).json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not render final video.';
      res.status(400).json({ error: message, code: 'RENDER_FINAL_FAILED' });
    }
  });

  app.post('/api/ai-video/jobs/:jobId/scenes/:sceneNumber/regenerate', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const sceneNumber = Number(req.params.sceneNumber);
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
      res.status(400).json({ error: 'Invalid scene number.', code: 'INVALID_SCENE' });
      return;
    }

    const body = (req.body || {}) as {
      customPrompt?: string;
      customSearchQuery?: string;
      visualSourceMode?: AiVideoVisualSourceMode;
      relevanceThreshold?: number;
      autoRender?: boolean;
    };

    try {
      const serverJob = await regenerateSingleSceneVisual({
        uid: authUser.uid,
        jobId: req.params.jobId,
        sceneNumber,
        customPrompt: body.customPrompt,
        customSearchQuery: body.customSearchQuery,
        visualSourceMode: body.visualSourceMode,
        relevanceThreshold: body.relevanceThreshold,
        autoRender: body.autoRender,
      });
      const status = getAiVideoJobForUser(authUser.uid, serverJob.record.id);
      res.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not regenerate scene visual.';
      res.status(400).json({ error: message, code: 'SCENE_REGENERATE_FAILED' });
    }
  });

  app.post('/api/ai-video/jobs/:jobId/scenes/:sceneNumber/replace-image', async (req, res) => {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }

    const sceneNumber = Number(req.params.sceneNumber);
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
      res.status(400).json({ error: 'Invalid scene number.', code: 'INVALID_SCENE' });
      return;
    }

    const body = (req.body || {}) as {
      imageBase64?: string;
      fileName?: string;
    };
    if (!body.imageBase64?.trim()) {
      res.status(400).json({ error: 'Uploaded image data is required.', code: 'IMAGE_REQUIRED' });
      return;
    }

    try {
      const serverJob = await replaceSceneImageWithUpload({
        uid: authUser.uid,
        jobId: req.params.jobId,
        sceneNumber,
        imageBase64: body.imageBase64,
        fileName: body.fileName,
      });
      const status = getAiVideoJobForUser(authUser.uid, serverJob.record.id);
      res.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not replace scene image.';
      res.status(400).json({ error: message, code: 'IMAGE_REPLACE_FAILED' });
    }
  });

  app.get('/api/ai-video/jobs/:jobId/scenes/:sceneNumber/image', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const sceneNumber = Number(req.params.sceneNumber);
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) {
      res.status(400).json({ error: 'Invalid scene number.', code: 'INVALID_SCENE' });
      return;
    }
    const imgPath = getSceneImageFileForToken(req.params.jobId, sceneNumber, token);
    if (!imgPath) {
      res.status(404).json({ error: 'Scene image not found.', code: 'SCENE_IMAGE_NOT_FOUND' });
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    fs.createReadStream(imgPath).pipe(res);
  });

  const handleVideoStreamOrHead = (req: express.Request, res: express.Response) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const job = getAiVideoJobByToken(req.params.jobId, token);
    if (!job || job.record.status !== 'completed' || !fs.existsSync(job.outputPath)) {
      res.status(404).json({ error: 'Rendered AI MP4 file not found.', code: 'MP4_NOT_FOUND' });
      return;
    }

    const stat = fs.statSync(job.outputPath);
    const fileSize = stat.size;
    if (fileSize <= 0) {
      res.status(404).json({ error: 'Rendered MP4 file is empty.', code: 'MP4_EMPTY' });
      return;
    }

    const safeFileName = (job.record.outputFileName || 'ai-video.mp4').replace(/["\r\n\\/]/g, '_');
    const commonHeaders: Record<string, string | number> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      'Cache-Control': 'private, max-age=3600',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    };
    if (req.query.download === '1') {
      commonHeaders['Content-Disposition'] = `attachment; filename="${safeFileName}"`;
    }

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, {
          ...commonHeaders,
          'Content-Range': `bytes */${fileSize}`,
        });
        res.end();
        return;
      }

      let start: number;
      let end: number;
      if (!match[1] && match[2]) {
        // Suffix byte range: bytes=-N
        const suffixLen = parseInt(match[2], 10);
        if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
          res.writeHead(416, {
            ...commonHeaders,
            'Content-Range': `bytes */${fileSize}`,
          });
          res.end();
          return;
        }
        start = Math.max(0, fileSize - suffixLen);
        end = fileSize - 1;
      } else {
        start = parseInt(match[1], 10);
        end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || start > end) {
        res.writeHead(416, {
          ...commonHeaders,
          'Content-Range': `bytes */${fileSize}`,
        });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        ...commonHeaders,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunkSize,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(job.outputPath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      ...commonHeaders,
      'Content-Length': fileSize,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(job.outputPath).pipe(res);
  };

  app.head('/api/ai-video/jobs/:jobId/download', handleVideoStreamOrHead);
  app.get('/api/ai-video/jobs/:jobId/download', handleVideoStreamOrHead);

  app.get('/api/ai-video/jobs/:jobId/subtitles.srt', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const job = getAiVideoJobByToken(req.params.jobId, token);
    if (!job || !fs.existsSync(job.srtPath)) {
      res.status(404).json({ error: 'Subtitle SRT file not found.', code: 'SRT_NOT_FOUND' });
      return;
    }

    const safeSrtName = (job.record.outputFileName || 'subtitles')
      .replace(/\.mp4$/i, '')
      .replace(/["\r\n\\/]/g, '_');
    res.setHeader('Content-Type', 'application/x-subrip; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeSrtName}.srt"`
    );
    fs.createReadStream(job.srtPath).pipe(res);
  });

  startSocialScheduler();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        port: PORT,
        hmr: isHmrDisabled ? false : { server: httpServer },
        ws: isHmrDisabled ? false : undefined,
        watch: isHmrDisabled ? null : {},
      },
      appType: 'spa',
    });

    if (isHmrDisabled) {
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(`const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== "undefined") {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (typeof document === "undefined" || linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (typeof document === "undefined") return;
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== "." && url[0] !== "/")) return url;
  const pathname = url.replace(/[?#].*$/, "");
  const parsed = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (parsed.search ? "&" + parsed.search.slice(1) : "") + (parsed.hash || "");
}
export class ErrorOverlay {
  constructor() {}
  close() {}
}
`);
      });
    }

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`CreatorPilot AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
