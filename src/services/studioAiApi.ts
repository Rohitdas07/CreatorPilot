import { auth } from '../firebase.js';
import type { AnalyticsInsightsResponse, AnalyticsSummaryInput } from '../types/analytics';
import type { ContentQualityScore, GeneratedContent } from '../types/creator';
import type {
  ThumbnailAspectRatio,
  ThumbnailConcept,
  ThumbnailStylePreset,
} from '../types/thumbnail';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to use CreatorPilot AI tools.');
  }
  const idToken = await currentUser.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function scoreGeneratedContent(params: {
  result: GeneratedContent;
  platform?: string;
  tone?: string;
  duration?: string;
  niche?: string;
  brandVoice?: string;
}): Promise<ContentQualityScore> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/content/score', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || !data.score) {
    throw new Error(
      (typeof data.error === 'string' && data.error) ||
        `Content scoring failed with status ${res.status}.`
    );
  }
  return data.score as ContentQualityScore;
}

export async function generateThumbnailConcepts(params: {
  topic: string;
  title?: string;
  hook?: string;
  aspectRatio: ThumbnailAspectRatio;
  stylePreset: ThumbnailStylePreset;
  brandKit?: {
    brandName?: string;
    colors?: { primary?: string; secondary?: string; accent?: string };
  } | null;
}): Promise<ThumbnailConcept[]> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/thumbnails/concepts', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || !Array.isArray(data.concepts)) {
    throw new Error(
      (typeof data.error === 'string' && data.error) ||
        `Thumbnail concept generation failed with status ${res.status}.`
    );
  }
  return data.concepts as ThumbnailConcept[];
}

export async function generateAnalyticsInsights(
  summary: AnalyticsSummaryInput
): Promise<AnalyticsInsightsResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/analytics/insights', {
    method: 'POST',
    headers,
    body: JSON.stringify({ summary }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || !data.insights) {
    throw new Error(
      (typeof data.error === 'string' && data.error) ||
        `Analytics insights generation failed with status ${res.status}.`
    );
  }
  return data.insights as AnalyticsInsightsResponse;
}
