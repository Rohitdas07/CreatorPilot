import type {
  ContentLanguage,
  GeneratedContent,
  GenerationConfig,
  Platform,
  Tone,
  VideoDuration,
} from '../types/creator';

export interface SamplePrompt {
  id: string;
  label: string;
  platform: Platform;
  tone: Tone;
  duration: VideoDuration;
  text: string;
}

export const SAMPLE_PROMPTS: SamplePrompt[] = [
  {
    id: 'ai-workflow',
    label: 'AI Content Workflow',
    platform: 'Instagram',
    tone: 'Educational',
    duration: '30 sec',
    text: 'Most creators spend 4 hours editing a single video and only post it on one platform. Here is the 3-step repurposing system I use every week: record one 60-second core insight, split the first 3 seconds into an attention-grabbing hook, and adapt the takeaway for Reels, Shorts, and LinkedIn without starting from a blank page.',
  },
  {
    id: 'founder-morning',
    label: 'Founder Focus Routine',
    platform: 'LinkedIn',
    tone: 'Inspirational',
    duration: '60 sec',
    text: 'Before checking Slack or email, I block 90 minutes of deep work at 7:00 AM with my phone in another room. That single habit shipped more product features in the last quarter than all our late-night sprints combined. Protect your highest-energy hours for creation, not reaction.',
  },
  {
    id: 'camera-gear',
    label: 'Budget Studio Lighting',
    platform: 'YouTube',
    tone: 'Casual',
    duration: '15 sec',
    text: 'Stop buying expensive cameras when your lighting is flat. One softbox placed at a 45-degree angle beside a window instantly makes a smartphone video look like a studio shoot. Angle matters more than megapixels.',
  },
];

function extractTopic(sourceText: string): string {
  const cleaned = sourceText.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Smart Creator Repurposing';
  const firstSentence = cleaned.split(/[.!?]/)[0]?.trim() || cleaned;
  const words = firstSentence.split(' ').slice(0, 8).join(' ');
  return words.length > 56 ? `${words.slice(0, 53)}...` : words;
}

function cleanKeywordTags(sourceText: string): string[] {
  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'with', 'this', 'from', 'your', 'have', 'more',
    'when', 'what', 'here', 'into', 'about', 'only', 'make', 'most', 'than', 'every',
    'before', 'after', 'without', 'single', 'video', 'content', 'just', 'like',
  ]);
  const words = sourceText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w));
  const unique = Array.from(new Set(words)).slice(0, 5);
  return unique.map((w) => `#${w.charAt(0).toUpperCase()}${w.slice(1)}`);
}

const TONE_OPENERS: Record<Tone, string> = {
  Professional: 'Here is the practical framework top teams use to scale output:',
  Funny: 'Me staring at a blank caption box for 45 minutes before learning this:',
  Educational: 'Break this down in 3 clear steps so you can apply it today:',
  Inspirational: 'You do not need more hours in the day—you need a repeatable system:',
  Casual: 'Honestly, this tiny workflow tweak saved my entire week:',
};

const LANGUAGE_NOTE: Record<ContentLanguage, string> = {
  English: '',
  Hindi: ' (Demo — Hindi sample)',
  Bengali: ' (Demo — Bengali sample)',
  Spanish: ' (Demo — Spanish sample)',
  French: ' (Demo — French sample)',
  German: ' (Demo — German sample)',
  Portuguese: ' (Demo — Portuguese sample)',
  Japanese: ' (Demo — Japanese sample)',
};

export function generateDemoContent(config: GenerationConfig): GeneratedContent {
  const { sourceText, platform, language, tone, duration, mediaInfo } = config;
  const effectiveSource =
    sourceText.trim() ||
    (mediaInfo
      ? `Key takeaways from uploaded ${mediaInfo.kind} file "${mediaInfo.name}" adapted for ${platform}.`
      : 'Turn one core idea into multi-platform video scripts, captions, and high-converting posts.');

  const topic = extractTopic(effectiveSource);
  const opener = TONE_OPENERS[tone];
  const langSuffix = LANGUAGE_NOTE[language];
  const keywords = cleanKeywordTags(effectiveSource);
  const paceCue =
    duration === '15 sec'
      ? 'Fast-cut 15s pacing (3 quick beats)'
      : duration === '30 sec'
      ? 'Tight 30s story arc (Hook -> Value -> CTA)'
      : 'Deep-dive 60s breakdown (Hook -> 3 Steps -> Proof -> CTA)';

  const snippet =
    effectiveSource.length > 180
      ? `${effectiveSource.slice(0, 177).trim()}...`
      : effectiveSource;

  const primaryHook =
    tone === 'Funny'
      ? `"Wait—you are still doing this the slow way?" (${duration} visual pattern interrupt)`
      : `"Stop scrolling if you want to master ${topic.toLowerCase()} in ${duration}."`;

  return {
    engine: 'demo',
    analysis: {
      coreTopic: topic,
      summary: `Starter demo breakdown for "${topic}". Generate with Gemini AI in Content Studio for full transcript analysis and native ${language} copy.`,
      targetAudience: `Creators in ${config.niche || 'digital content & productivity'}`,
      keyTakeaways: [
        'Lead with a sharp 3-second hook before explaining the context.',
        `Structure the core insight tightly for a ${duration} short-form window.`,
        'Repurpose the same core thesis natively for Reels, Shorts, LinkedIn, and Facebook.',
      ],
      detectedLanguage: language,
    },
    hooks: [
      primaryHook,
      `Nobody talks about this 1 shift in ${topic.toLowerCase()}.`,
      `I tested ${topic.toLowerCase()} for 30 days—here is what actually worked.`,
      `Stop wasting hours on guesswork: use this ${duration} framework instead.`,
    ],
    instagramReel: {
      title: `${topic}${langSuffix}`,
      hook: primaryHook,
      script: `[0:00 - 0:03 | HOOK]\nDirect to camera, bold kinetic text on screen.\n"${opener}"\n\n[0:03 - ${duration === '15 sec' ? '0:11' : duration === '30 sec' ? '0:23' : '0:48'} | CORE VALUE]\n${paceCue}\nShow screen recording or B-roll while delivering:\n"${snippet}"\n\n[${duration === '15 sec' ? '0:11 - 0:15' : duration === '30 sec' ? '0:23 - 0:30' : '0:48 - 0:60'} | PAYOFF]\nWrap with one crisp takeaway your viewer can save and test immediately.`,
      cta: 'Save this Reel for your next shoot and comment "PILOT" for the full checklist.',
    },
    youtubeShorts: {
      title: `${topic} (${duration} Breakdown)`,
      script: `[FRAME 1 - TEXT OVERLAY: "Why ${topic} works"]\nVoiceover (${tone} tone): ${opener}\n\n[MAIN BEAT - B-ROLL + CAPTIONS]\n${snippet}\n\n[LOOPING OUTRO]\nEnd cleanly on the opening premise so the Short replays seamlessly.`,
      description: `A ${duration} ${tone.toLowerCase()} breakdown of: ${topic}.\n\nKey takeaway:\n${snippet}\n\nSubscribe for weekly creator systems and multi-platform workflows.`,
      cta: 'Hit Subscribe and drop your favorite workflow tip in the comments!',
    },
    instagramCaption: {
      caption: `${opener} 🚀\n\n${snippet}\n\n✨ Quick checklist to try today:\n1️⃣ Lead with a sharp 3-second hook\n2️⃣ Keep one clear idea per clip (${duration})\n3️⃣ Repurpose the core takeaway across platforms\n\nSave this post so you have it before your next upload! 💡👇`,
    },
    hashtags: {
      relevant: [
        ...keywords,
        '#ContentCreator',
        '#CreatorEconomy',
        '#SocialMediaStrategy',
        `#${platform}Growth`,
      ].slice(0, 8),
      trending: [
        '#CreatorWorkflow',
        '#ReelsTips',
        '#YouTubeShorts',
        '#BuildInPublic',
        '#DigitalStorytelling',
        '#VideoMarketing',
      ],
    },
    platformPosts: {
      instagram: `Carousel / Single Post Idea (${tone}):\nSlide 1: "${topic}"\nSlide 2: The common mistake creators make\nSlide 3: ${snippet}\nSlide 4: Save & share with a creator friend.`,
      youtubeCommunity: `Quick poll + update for the channel 👀\n\nI just broke down "${topic}" into a ${duration} format.\n\nWhat do you want me to cover next?\nA) Scriptwriting hooks\nB) Lighting & audio setup\nC) Multi-platform repurposing`,
      linkedin: `Most creators burn out not from a lack of ideas, but from starting from zero on every channel.\n\n${opener}\n\n${snippet}\n\nWhen you treat one strong perspective as a reusable asset—adapting the hook for short-form video and the nuance for written posts—consistency becomes automatic.\n\nHow are you structuring your weekly content workflow?`,
      facebook: `Tried a cleaner way to approach ${topic.toLowerCase()} this week and the difference was huge! 🙌\n\n${snippet}\n\nIf you make videos or write posts regularly, drop a comment with the platform you focus on most right now.`,
    },
  };
}

export function formatContentForDownload(
  title: string,
  config: GenerationConfig,
  result: GeneratedContent,
  format: 'markdown' | 'txt' | 'json'
): { content: string; extension: string; mimeType: string } {
  if (format === 'json') {
    return {
      content: JSON.stringify({ title, config, result }, null, 2),
      extension: 'json',
      mimeType: 'application/json',
    };
  }

  const divider = format === 'markdown' ? '---' : '========================================';
  const h1 = format === 'markdown' ? `# ${title}` : title.toUpperCase();
  const h2 = (label: string) => (format === 'markdown' ? `## ${label}` : `\n[ ${label.toUpperCase()} ]`);
  const sourceLabel =
    result.engine === 'gemini'
      ? `AI Generated (${result.model || 'Gemini'})`
      : 'Demo Content';

  const lines = [
    h1,
    `Source: ${sourceLabel} | Platform Focus: ${config.platform} | Tone: ${config.tone} | Duration: ${config.duration} | Language: ${config.language}`,
    config.niche ? `Niche: ${config.niche}` : '',
    config.brandVoice ? `Brand Voice: ${config.brandVoice}` : '',
    divider,
  ].filter(Boolean);

  if (result.analysis) {
    lines.push(
      h2('Content & Transcript Analysis'),
      `Core Topic: ${result.analysis.coreTopic}`,
      `Summary: ${result.analysis.summary}`,
      `Target Audience: ${result.analysis.targetAudience}`,
      `Key Takeaways:\n${result.analysis.keyTakeaways.map((t) => `- ${t}`).join('\n')}`,
      divider
    );
  }

  if (result.hooks && result.hooks.length > 0) {
    lines.push(
      h2('Engaging Hooks'),
      result.hooks.map((h, i) => `${i + 1}. ${h}`).join('\n'),
      divider
    );
  }

  lines.push(
    h2('1. Instagram Reel'),
    `Title: ${result.instagramReel.title}`,
    `Hook: ${result.instagramReel.hook}`,
    `Script:\n${result.instagramReel.script}`,
    `Call to Action: ${result.instagramReel.cta}`,
    divider,
    h2('2. YouTube Shorts'),
    `Title: ${result.youtubeShorts.title}`,
    `Script:\n${result.youtubeShorts.script}`,
    `Description:\n${result.youtubeShorts.description}`,
    `Call to Action: ${result.youtubeShorts.cta}`,
    divider,
    h2('3. Instagram Caption'),
    result.instagramCaption.caption,
    divider,
    h2('4. Hashtags'),
    `Relevant: ${result.hashtags.relevant.join(' ')}`,
    `Trending: ${result.hashtags.trending.join(' ')}`,
    divider,
    h2('5. Platform-Specific Posts'),
    `Instagram Post:\n${result.platformPosts.instagram}\n`,
    `YouTube Community Post:\n${result.platformPosts.youtubeCommunity}\n`,
    `LinkedIn Post:\n${result.platformPosts.linkedin}\n`,
    `Facebook Post:\n${result.platformPosts.facebook}`
  );

  return {
    content: lines.join('\n\n'),
    extension: format === 'markdown' ? 'md' : 'txt',
    mimeType: format === 'markdown' ? 'text/markdown' : 'text/plain',
  };
}
