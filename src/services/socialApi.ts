import { auth } from '../firebase.js';
import type {
  SocialConnectionSummary,
  SocialMediaType,
  SocialPlatform,
  SocialPlatformRequirementInfo,
  SocialPostAnalytics,
  SocialStatusResponse,
  YouTubePrivacyStatus,
} from '../types/social';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('You must be signed in to manage social integrations.');
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

export async function fetchSocialStatus(): Promise<SocialStatusResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/social/status', { headers });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      (typeof data.error === 'string' && data.error) ||
        `Failed to load social status (${res.status}).`
    );
  }
  return {
    requirements: (data.requirements as SocialPlatformRequirementInfo[]) || [],
    connections: (data.connections as SocialConnectionSummary[]) || [],
    scheduledJobs:
      (data.scheduledJobs as SocialStatusResponse['scheduledJobs']) || [],
  };
}

export async function getSocialOAuthUrl(platform: SocialPlatform): Promise<{
  url: string;
  redirectUri: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `/api/social/oauth/${encodeURIComponent(platform)}/url`,
    { headers }
  );
  const data = await parseJsonSafe(res);
  if (!res.ok || typeof data.url !== 'string') {
    const err = new Error(
      (typeof data.error === 'string' && data.error) ||
        `Could not start OAuth connection for ${platform}.`
    ) as Error & {
      code?: string;
      requirement?: SocialPlatformRequirementInfo;
    };
    if (typeof data.code === 'string') err.code = data.code;
    if (data.requirement) {
      err.requirement = data.requirement as SocialPlatformRequirementInfo;
    }
    throw err;
  }
  return {
    url: data.url,
    redirectUri: String(data.redirectUri || ''),
  };
}

export async function verifySocialConnection(platform: SocialPlatform): Promise<{
  ok: boolean;
  connection: SocialConnectionSummary;
  error?: string;
  code?: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `/api/social/connections/${encodeURIComponent(platform)}/verify`,
    {
      method: 'POST',
      headers,
    }
  );
  const data = await parseJsonSafe(res);
  return {
    ok: Boolean(data.ok),
    connection: data.connection as SocialConnectionSummary,
    ...(typeof data.error === 'string' ? { error: data.error } : {}),
    ...(typeof data.code === 'string' ? { code: data.code } : {}),
  };
}

export async function disconnectSocialAccount(
  platform: SocialPlatform
): Promise<SocialConnectionSummary> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `/api/social/connections/${encodeURIComponent(platform)}`,
    {
      method: 'DELETE',
      headers,
    }
  );
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      (typeof data.error === 'string' && data.error) ||
        `Could not disconnect ${platform}.`
    );
  }
  return data.connection as SocialConnectionSummary;
}

export async function publishSocialPost(params: {
  postId: string;
  platform: SocialPlatform;
  title?: string;
  caption: string;
  hashtags?: string[];
  mediaType: SocialMediaType;
  mediaUrl?: string;
  youtubePrivacy?: YouTubePrivacyStatus;
  approvalStatus: string;
}): Promise<{
  published: true;
  externalPostId: string;
  externalPostUrl?: string;
  publishedAt: string;
}> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/social/posts/publish', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || !data.published) {
    const err = new Error(
      (typeof data.error === 'string' && data.error) ||
        `Publishing failed with status ${res.status}.`
    ) as Error & { code?: string };
    if (typeof data.code === 'string') err.code = data.code;
    throw err;
  }
  return {
    published: true,
    externalPostId: String(data.externalPostId || ''),
    ...(typeof data.externalPostUrl === 'string'
      ? { externalPostUrl: data.externalPostUrl }
      : {}),
    publishedAt: String(data.publishedAt || new Date().toISOString()),
  };
}

export async function scheduleSocialPost(params: {
  postId: string;
  platform: SocialPlatform;
  title?: string;
  caption: string;
  hashtags?: string[];
  mediaType: SocialMediaType;
  mediaUrl?: string;
  youtubePrivacy?: YouTubePrivacyStatus;
  approvalStatus: string;
  scheduledFor: string;
}): Promise<{ scheduled: true; scheduledFor: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/social/posts/schedule', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || !data.scheduled) {
    const err = new Error(
      (typeof data.error === 'string' && data.error) ||
        `Scheduling failed with status ${res.status}.`
    ) as Error & { code?: string };
    if (typeof data.code === 'string') err.code = data.code;
    throw err;
  }
  return {
    scheduled: true,
    scheduledFor: String(data.scheduledFor || params.scheduledFor),
  };
}

export async function cancelScheduledSocialPost(
  postId: string
): Promise<boolean> {
  const headers = await getAuthHeaders();
  const res = await fetch(
    `/api/social/posts/${encodeURIComponent(postId)}/schedule`,
    {
      method: 'DELETE',
      headers,
    }
  );
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error(
      (typeof data.error === 'string' && data.error) ||
        'Could not cancel scheduled post.'
    );
  }
  return Boolean(data.cancelled);
}

export async function fetchSocialPostAnalytics(
  platform: SocialPlatform,
  externalPostId: string
): Promise<SocialPostAnalytics> {
  const headers = await getAuthHeaders();
  const res = await fetch('/api/social/posts/analytics', {
    method: 'POST',
    headers,
    body: JSON.stringify({ platform, externalPostId }),
  });
  const data = await parseJsonSafe(res);
  if (!res.ok || !data.analytics) {
    throw new Error(
      (typeof data.error === 'string' && data.error) ||
        `Could not fetch ${platform} analytics.`
    );
  }
  return data.analytics as SocialPostAnalytics;
}
