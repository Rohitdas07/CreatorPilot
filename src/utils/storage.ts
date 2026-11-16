import type {
  CreatorProject,
  CreatorSettings,
  CreatorStats,
  HistoryItem,
} from '../types/creator';
import { generateDemoContent } from './sampleGenerator';

export const DEFAULT_SETTINGS: CreatorSettings = {
  creatorName: 'Alex Rivera',
  brandHandle: '@alexcreates',
  niche: 'Tech, Productivity & Creator Systems',
  brandVoice: 'Clear, practical, creator-first, conversational without hype',
  defaultPlatform: 'Instagram',
  defaultLanguage: 'English',
  defaultTone: 'Educational',
  defaultDuration: '30 sec',
  exportFormat: 'markdown',
};

export const DEFAULT_STATS: CreatorStats = {
  totalGenerated: 0,
  reelsCreated: 0,
  shortsCreated: 0,
  captionsGenerated: 0,
};

export function createStarterDemoProjects(userId?: string): CreatorProject[] {
  const cfg1 = {
    sourceText:
      'Stop filming 10 takes for one short video. Outline 3 bullet points—Hook, Core Shift, Next Step—and batch record 4 Reels in 35 minutes.',
    platform: 'Instagram' as const,
    language: 'English' as const,
    tone: 'Educational' as const,
    duration: '30 sec' as const,
    niche: 'Creator Productivity & Video Workflows',
    brandVoice: 'Clear, practical, creator-first',
  };
  const cfg2 = {
    sourceText:
      'Why clean audio doubles viewer retention faster than upgrading your camera lens. Use a directional mic 6 inches off-axis and cut room echo.',
    platform: 'YouTube' as const,
    language: 'English' as const,
    tone: 'Professional' as const,
    duration: '60 sec' as const,
    niche: 'Creator Gear & Audio Engineering',
    brandVoice: 'Authoritative, concise, actionable',
  };
  const cfg3 = {
    sourceText:
      'Behind the scenes of launching our weekly creator newsletter to 12,000 subscribers using one Sunday morning writing block.',
    platform: 'LinkedIn' as const,
    language: 'English' as const,
    tone: 'Inspirational' as const,
    duration: '30 sec' as const,
    niche: 'Creator Economy & Writing Systems',
    brandVoice: 'Warm, transparent, story-driven',
  };

  return [
    {
      id: `proj-demo-1-${Date.now()}`,
      ...(userId ? { userId } : {}),
      title: 'Batch Filming 3-Beat Framework (Demo)',
      createdAt: '2026-11-12T10:20:00.000Z',
      updatedAt: '2026-11-12T10:20:00.000Z',
      config: cfg1,
      result: generateDemoContent(cfg1),
    },
    {
      id: `proj-demo-2-${Date.now() + 1}`,
      ...(userId ? { userId } : {}),
      title: 'Audio Retention Studio Breakdown (Demo)',
      createdAt: '2026-11-10T15:45:00.000Z',
      updatedAt: '2026-11-10T15:45:00.000Z',
      config: cfg2,
      result: generateDemoContent(cfg2),
    },
    {
      id: `proj-demo-3-${Date.now() + 2}`,
      ...(userId ? { userId } : {}),
      title: 'Sunday Newsletter Launch Story (Demo)',
      createdAt: '2026-11-08T09:15:00.000Z',
      updatedAt: '2026-11-08T09:15:00.000Z',
      config: cfg3,
      result: generateDemoContent(cfg3),
    },
  ];
}

export function computeRealStats(history: HistoryItem[]): CreatorStats {
  const aiItems = history.filter((item) => item.result.engine === 'gemini');
  const count = aiItems.length;
  return {
    totalGenerated: count,
    reelsCreated: count,
    shortsCreated: count,
    captionsGenerated: count,
  };
}
