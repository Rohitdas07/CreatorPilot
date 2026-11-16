import type { Platform, Tone } from './creator';

export type EmojiDensity = 'minimal' | 'balanced' | 'expressive';
export type CaptionSpacing = 'compact' | 'airy';

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export interface BrandTypography {
  headingFont: string;
  bodyFont: string;
}

export interface BrandCaptionStyle {
  emojiDensity: EmojiDensity;
  lineSpacing: CaptionSpacing;
  includeHashtagsInCaption: boolean;
  signatureFooter: string;
}

export interface BrandTemplate {
  id: string;
  name: string;
  platform: Platform;
  tone: Tone;
  hookFormula: string;
  structureNotes: string;
  defaultCta: string;
}

export interface BrandKitConfig {
  userId?: string;
  brandName: string;
  brandHandle: string;
  tagline: string;
  logoUrl?: string;
  logoStoragePath?: string;
  colors: BrandColors;
  typography: BrandTypography;
  brandVoice: string;
  preferredCtas: string[];
  captionStyle: BrandCaptionStyle;
  templates: BrandTemplate[];
  updatedAt: string;
}

export interface BrandKitPromptContext {
  brandName?: string;
  brandHandle?: string;
  brandVoice?: string;
  preferredCtas?: string[];
  captionStyle?: BrandCaptionStyle;
  templateName?: string;
  hookFormula?: string;
  structureNotes?: string;
}

export const DEFAULT_BRAND_KIT: BrandKitConfig = {
  brandName: 'CreatorPilot Studio',
  brandHandle: '@creatorpilot',
  tagline: 'Clear systems and repeatable growth for modern creators',
  colors: {
    primary: '#7C3AED',
    secondary: '#2563EB',
    accent: '#0EA5E9',
    background: '#0F172A',
    text: '#F8FAFC',
  },
  typography: {
    headingFont: 'Plus Jakarta Sans',
    bodyFont: 'DM Sans',
  },
  brandVoice:
    'Clear, practical, creator-first, conversational without hype. Lead with concrete value in the first 3 seconds.',
  preferredCtas: [
    'Save this for your next upload and follow for weekly creator breakdowns.',
    'Drop a comment with the step you want a deep dive on next.',
  ],
  captionStyle: {
    emojiDensity: 'balanced',
    lineSpacing: 'airy',
    includeHashtagsInCaption: true,
    signatureFooter: '',
  },
  templates: [
    {
      id: 'tpl-reel-breakdown',
      name: '3-Step Tactical Reel',
      platform: 'Instagram',
      tone: 'Educational',
      hookFormula: 'Stop doing [common mistake] — try this 3-step workflow instead',
      structureNotes:
        '0-3s pattern interrupt hook -> 3-18s 3 crisp actionable steps -> 18-30s concrete result + save CTA.',
      defaultCta: 'Save this workflow before your next shoot.',
    },
    {
      id: 'tpl-linkedin-insight',
      name: 'Creator Playbook Post',
      platform: 'LinkedIn',
      tone: 'Professional',
      hookFormula: 'What most teams miss about [topic] after shipping 50+ pieces',
      structureNotes:
        'Bold opening thesis -> 3 short bulleted lessons -> real trade-off -> single open-ended question.',
      defaultCta: 'What workflow change saved your team the most hours this quarter?',
    },
  ],
  updatedAt: new Date(0).toISOString(),
};
