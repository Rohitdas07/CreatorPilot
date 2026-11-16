import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import type {
  SocialConnectionSummary,
  SocialMediaType,
  SocialPlatform,
  SocialPlatformRequirementInfo,
  SocialPostAnalytics,
  YouTubePrivacyStatus,
} from '../src/types/social.ts';
import {
  deleteStoredToken,
  getScheduledJob,
  getStoredToken,
  listScheduledJobs,
  listUserScheduledJobs,
  removeScheduledJob,
  saveStoredToken,
  toPublicConnectionSummary,
  upsertScheduledJob,
  type StoredTokenRecord,
} from './tokenVault.ts';

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  'instagram',
  'youtube',
  'linkedin',
  'facebook',
];

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const LINKEDIN_API_VERSION = '202409';

interface PendingOAuthState {
  state: string;
  uid: string;
  platform: SocialPlatform;
  redirectUri: string;
  createdAt: number;
}

const pendingOAuthStates = new Map<string, PendingOAuthState>();

function pruneExpiredOAuthStates() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, entry] of pendingOAuthStates.entries()) {
    if (entry.createdAt < cutoff) {
      pendingOAuthStates.delete(key);
    }
  }
}

let cachedFirebaseConfigMtimeMs = -1;
let cachedFirebaseApiKey: string | null = null;
function getFirebaseApiKey(): string | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const stat = fs.statSync(configPath);
    if (cachedFirebaseApiKey && stat.mtimeMs === cachedFirebaseConfigMtimeMs) {
      return cachedFirebaseApiKey;
    }
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      apiKey?: string;
    };
    if (parsed?.apiKey) {
      cachedFirebaseConfigMtimeMs = stat.mtimeMs;
      cachedFirebaseApiKey = parsed.apiKey;
      return cachedFirebaseApiKey;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function verifyFirebaseRequest(
  req: Request
): Promise<{ uid: string; email?: string } | null> {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  const apiKey = getFirebaseApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{ localId?: string; email?: string }>;
    };
    const user = data.users?.[0];
    if (!user?.localId) return null;
    return { uid: user.localId, email: user.email };
  } catch {
    return null;
  }
}

export function getAppBaseUrl(req?: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  if (req) {
    const proto =
      (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
      req.protocol ||
      'http';
    const host =
      (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() ||
      req.get('host') ||
      'localhost:3000';
    return `${proto}://${host}`.replace(/\/+$/, '');
  }
  return 'http://localhost:3000';
}

function getPlatformCredentials(platform: SocialPlatform): {
  clientId: string;
  clientSecret: string;
  missingEnvVars: string[];
} {
  if (platform === 'instagram') {
    const clientId = (
      process.env.INSTAGRAM_CLIENT_ID ||
      process.env.META_APP_ID ||
      ''
    ).trim();
    const clientSecret = (
      process.env.INSTAGRAM_CLIENT_SECRET ||
      process.env.META_APP_SECRET ||
      ''
    ).trim();
    const missing: string[] = [];
    if (!clientId) missing.push('META_APP_ID (or INSTAGRAM_CLIENT_ID)');
    if (!clientSecret) missing.push('META_APP_SECRET (or INSTAGRAM_CLIENT_SECRET)');
    return { clientId, clientSecret, missingEnvVars: missing };
  }

  if (platform === 'facebook') {
    const clientId = (
      process.env.FACEBOOK_CLIENT_ID ||
      process.env.META_APP_ID ||
      ''
    ).trim();
    const clientSecret = (
      process.env.FACEBOOK_CLIENT_SECRET ||
      process.env.META_APP_SECRET ||
      ''
    ).trim();
    const missing: string[] = [];
    if (!clientId) missing.push('META_APP_ID (or FACEBOOK_CLIENT_ID)');
    if (!clientSecret) missing.push('META_APP_SECRET (or FACEBOOK_CLIENT_SECRET)');
    return { clientId, clientSecret, missingEnvVars: missing };
  }

  if (platform === 'youtube') {
    const clientId = (
      process.env.YOUTUBE_CLIENT_ID ||
      process.env.GOOGLE_CLIENT_ID ||
      ''
    ).trim();
    const clientSecret = (
      process.env.YOUTUBE_CLIENT_SECRET ||
      process.env.GOOGLE_CLIENT_SECRET ||
      ''
    ).trim();
    const missing: string[] = [];
    if (!clientId) missing.push('YOUTUBE_CLIENT_ID');
    if (!clientSecret) missing.push('YOUTUBE_CLIENT_SECRET');
    return { clientId, clientSecret, missingEnvVars: missing };
  }

  const clientId = (process.env.LINKEDIN_CLIENT_ID || '').trim();
  const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
  const missing: string[] = [];
  if (!clientId) missing.push('LINKEDIN_CLIENT_ID');
  if (!clientSecret) missing.push('LINKEDIN_CLIENT_SECRET');
  return { clientId, clientSecret, missingEnvVars: missing };
}

export function getPlatformRequirementInfo(
  platform: SocialPlatform,
  baseUrl: string
): SocialPlatformRequirementInfo {
  const { missingEnvVars } = getPlatformCredentials(platform);
  const redirectUri = `${baseUrl}/api/social/oauth/${platform}/callback`;

  switch (platform) {
    case 'instagram':
      return {
        platform: 'instagram',
        displayName: 'Instagram Professional',
        apiName: 'Instagram Graph API (via Meta)',
        oauthConfigured: missingEnvVars.length === 0,
        missingEnvVars,
        redirectUri,
        requiredScopes: [
          'instagram_basic',
          'instagram_content_publish',
          'instagram_manage_insights',
          'pages_show_list',
          'pages_read_engagement',
        ],
        portalUrl: 'https://developers.facebook.com/apps/',
        approvalNotes:
          'Requires an Instagram Business or Creator account linked to a Facebook Page, plus Meta App Review for instagram_content_publish and instagram_manage_insights in Live mode.',
        publishingRequirements: [
          'Must connect a Professional (Business/Creator) Instagram account linked to a Facebook Page.',
          'Requires a publicly reachable HTTPS image URL or video/Reel URL (text-only posts are not supported).',
          'Caption maximum 2,200 characters and up to 30 hashtags.',
        ],
        analyticsNotes:
          'Supports real impressions, reach, likes, comments, shares, and saves via /{ig-media-id}/insights.',
        supportsTextOnly: false,
        requiresPublicMediaUrl: true,
        maxCaptionLength: 2200,
      };

    case 'youtube':
      return {
        platform: 'youtube',
        displayName: 'YouTube',
        apiName: 'YouTube Data API v3',
        oauthConfigured: missingEnvVars.length === 0,
        missingEnvVars,
        redirectUri,
        requiredScopes: [
          'https://www.googleapis.com/auth/youtube.upload',
          'https://www.googleapis.com/auth/youtube.readonly',
        ],
        portalUrl: 'https://console.cloud.google.com/apis/credentials',
        approvalNotes:
          'Enable YouTube Data API v3 in Google Cloud Console and complete OAuth consent verification (unverified apps restrict uploaded videos to private).',
        publishingRequirements: [
          'Requires a video asset (public HTTPS video URL for Shorts/videos).',
          'YouTube Data API v3 does not support publishing text-only Community posts via third-party APIs.',
          'Video title max 100 characters; description max 5,000 characters.',
        ],
        analyticsNotes:
          'Supports real viewCount, likeCount, and commentCount via videos?part=statistics.',
        supportsTextOnly: false,
        requiresPublicMediaUrl: true,
        maxCaptionLength: 5000,
      };

    case 'linkedin':
      return {
        platform: 'linkedin',
        displayName: 'LinkedIn',
        apiName: 'LinkedIn Posts API (/rest/posts)',
        oauthConfigured: missingEnvVars.length === 0,
        missingEnvVars,
        redirectUri,
        requiredScopes: ['openid', 'profile', 'w_member_social'],
        portalUrl: 'https://www.linkedin.com/developers/apps',
        approvalNotes:
          'Add "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn" products in LinkedIn Developer Portal.',
        publishingRequirements: [
          'Supports text commentary posts natively (max 3,000 characters).',
          'Optional article link URL supported as an embedded link preview.',
        ],
        analyticsNotes:
          'Personal post analytics require approved LinkedIn Community Management API (r_member_postAnalytics); if unapproved, LinkedIn returns 403.',
        supportsTextOnly: true,
        requiresPublicMediaUrl: false,
        maxCaptionLength: 3000,
      };

    case 'facebook':
      return {
        platform: 'facebook',
        displayName: 'Facebook Pages',
        apiName: 'Meta Graph API v21.0 (Pages)',
        oauthConfigured: missingEnvVars.length === 0,
        missingEnvVars,
        redirectUri,
        requiredScopes: [
          'pages_show_list',
          'pages_read_engagement',
          'pages_manage_posts',
          'read_insights',
        ],
        portalUrl: 'https://developers.facebook.com/apps/',
        approvalNotes:
          'Requires Page Admin role on a Facebook Page and Meta App Review for pages_manage_posts and read_insights for non-tester users.',
        publishingRequirements: [
          'Publishes to a connected Facebook Page (personal timelines are not supported).',
          'Supports text-only posts, link posts, public photo URLs, and public video URLs.',
        ],
        analyticsNotes:
          'Supports real likes, comments, shares, and Page post impressions/engaged users via /{post-id}/insights.',
        supportsTextOnly: true,
        requiresPublicMediaUrl: false,
        maxCaptionLength: 6000,
      };
  }
}

export function getAllPlatformStatuses(uid: string, baseUrl: string): {
  requirements: SocialPlatformRequirementInfo[];
  connections: SocialConnectionSummary[];
} {
  const requirements = SOCIAL_PLATFORMS.map((p) =>
    getPlatformRequirementInfo(p, baseUrl)
  );
  const connections = SOCIAL_PLATFORMS.map((p) => {
    const reqInfo = requirements.find((r) => r.platform === p)!;
    const stored = getStoredToken(uid, p);
    return toPublicConnectionSummary(stored, p, reqInfo.oauthConfigured);
  });
  return { requirements, connections };
}

export function createOAuthAuthorizationUrl(
  uid: string,
  platform: SocialPlatform,
  baseUrl: string
): {
  ok: true;
  url: string;
  redirectUri: string;
} | {
  ok: false;
  statusCode: number;
  code: string;
  error: string;
  requirement: SocialPlatformRequirementInfo;
} {
  const requirement = getPlatformRequirementInfo(platform, baseUrl);
  const { clientId, clientSecret } = getPlatformCredentials(platform);

  if (!clientId || !clientSecret) {
    return {
      ok: false,
      statusCode: 503,
      code: 'OAUTH_NOT_CONFIGURED',
      error: `${requirement.displayName} OAuth credentials are not configured on the server. Missing: ${requirement.missingEnvVars.join(', ')}.`,
      requirement,
    };
  }

  pruneExpiredOAuthStates();
  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuthStates.set(state, {
    state,
    uid,
    platform,
    redirectUri: requirement.redirectUri,
    createdAt: Date.now(),
  });

  let url = '';
  if (platform === 'instagram' || platform === 'facebook') {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: requirement.redirectUri,
      state,
      response_type: 'code',
      scope: requirement.requiredScopes.join(','),
    });
    url = `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  } else if (platform === 'youtube') {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: requirement.redirectUri,
      state,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: requirement.requiredScopes.join(' '),
    });
    url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  } else {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: requirement.redirectUri,
      state,
      response_type: 'code',
      scope: requirement.requiredScopes.join(' '),
    });
    url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  return { ok: true, url, redirectUri: requirement.redirectUri };
}

function renderOAuthCallbackHtml(payload: {
  type: 'CREATORPILOT_OAUTH_RESULT';
  platform: SocialPlatform;
  ok: boolean;
  connection?: SocialConnectionSummary;
  error?: string;
}): string {
  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  const statusHeadline = payload.ok
    ? 'Account Connected'
    : 'Connection Failed';
  const statusDetail = payload.ok
    ? `${payload.platform} is connected. This window will close automatically.`
    : payload.error || 'OAuth authorization could not be completed.';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>CreatorPilot AI · OAuth</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #070B14; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
      .card { max-width: 440px; border: 1px solid #1e293b; background: #0d1322; border-radius: 12px; padding: 24px; text-align: center; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${statusHeadline}</h1>
      <p>${statusDetail.replace(/</g, '&lt;')}</p>
    </div>
    <script>
      (function () {
        var result = ${safeJson};
        if (window.opener) {
          window.opener.postMessage(result, '*');
          setTimeout(function () { window.close(); }, 350);
        }
      })();
    </script>
  </body>
</html>`;
}

export async function handleOAuthCallback(
  platform: SocialPlatform,
  query: Record<string, unknown>
): Promise<{ statusCode: number; html: string }> {
  const oauthError =
    typeof query.error_description === 'string'
      ? query.error_description
      : typeof query.error === 'string'
      ? query.error
      : '';

  if (oauthError) {
    return {
      statusCode: 400,
      html: renderOAuthCallbackHtml({
        type: 'CREATORPILOT_OAUTH_RESULT',
        platform,
        ok: false,
        error: `Provider returned OAuth error: ${oauthError}`,
      }),
    };
  }

  const code = typeof query.code === 'string' ? query.code.trim() : '';
  const state = typeof query.state === 'string' ? query.state.trim() : '';

  pruneExpiredOAuthStates();
  const pending = pendingOAuthStates.get(state);
  if (!code || !state || !pending || pending.platform !== platform) {
    return {
      statusCode: 400,
      html: renderOAuthCallbackHtml({
        type: 'CREATORPILOT_OAUTH_RESULT',
        platform,
        ok: false,
        error:
          'Invalid or expired OAuth state parameter. Please restart the connection from CreatorPilot Settings.',
      }),
    };
  }
  pendingOAuthStates.delete(state);

  const { clientId, clientSecret } = getPlatformCredentials(platform);
  if (!clientId || !clientSecret) {
    return {
      statusCode: 503,
      html: renderOAuthCallbackHtml({
        type: 'CREATORPILOT_OAUTH_RESULT',
        platform,
        ok: false,
        error: 'Server OAuth client credentials are missing.',
      }),
    };
  }

  try {
    const nowIso = new Date().toISOString();
    let record: StoredTokenRecord;

    if (platform === 'youtube') {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: pending.redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        error?: string;
        error_description?: string;
      };
      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(
          tokenJson.error_description ||
            tokenJson.error ||
            'Failed to exchange Google OAuth authorization code.'
        );
      }

      const chanRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        {
          headers: { Authorization: `Bearer ${tokenJson.access_token}` },
        }
      );
      const chanJson = (await chanRes.json()) as {
        items?: Array<{
          id?: string;
          snippet?: { title?: string; customUrl?: string };
        }>;
        error?: { message?: string };
      };
      if (!chanRes.ok) {
        throw new Error(
          chanJson.error?.message || 'Could not fetch YouTube channel profile.'
        );
      }
      const channel = chanJson.items?.[0];
      if (!channel?.id) {
        throw new Error(
          'No YouTube channel found on the authenticated Google account. Create a YouTube channel first.'
        );
      }

      const expiresAt = tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
        : undefined;

      record = {
        uid: pending.uid,
        platform: 'youtube',
        accessToken: tokenJson.access_token,
        ...(tokenJson.refresh_token
          ? { refreshToken: tokenJson.refresh_token }
          : {}),
        ...(expiresAt ? { expiresAt } : {}),
        scopes: (tokenJson.scope || '').split(/\s+/).filter(Boolean),
        accountName: channel.snippet?.title || 'YouTube Channel',
        ...(channel.snippet?.customUrl
          ? { accountHandle: channel.snippet.customUrl }
          : {}),
        externalAccountId: channel.id,
        status: 'connected',
        lastCheckedAt: nowIso,
        connectedAt: nowIso,
        updatedAt: nowIso,
      };
    } else if (platform === 'linkedin') {
      const tokenRes = await fetch(
        'https://www.linkedin.com/oauth/v2/accessToken',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: pending.redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        }
      );
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        error_description?: string;
        error?: string;
      };
      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(
          tokenJson.error_description ||
            tokenJson.error ||
            'Failed to exchange LinkedIn authorization code.'
        );
      }

      const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      const meJson = (await meRes.json()) as {
        sub?: string;
        name?: string;
        email?: string;
        message?: string;
      };
      if (!meRes.ok || !meJson.sub) {
        throw new Error(
          meJson.message || 'Could not retrieve LinkedIn member profile.'
        );
      }

      const expiresAt = tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
        : undefined;

      record = {
        uid: pending.uid,
        platform: 'linkedin',
        accessToken: tokenJson.access_token,
        ...(tokenJson.refresh_token
          ? { refreshToken: tokenJson.refresh_token }
          : {}),
        ...(expiresAt ? { expiresAt } : {}),
        scopes: (tokenJson.scope || '').split(/[,\s]+/).filter(Boolean),
        accountName: meJson.name || 'LinkedIn Member',
        ...(meJson.email ? { accountHandle: meJson.email } : {}),
        externalAccountId: `urn:li:person:${meJson.sub}`,
        status: 'connected',
        lastCheckedAt: nowIso,
        connectedAt: nowIso,
        updatedAt: nowIso,
      };
    } else {
      // Meta Graph OAuth (Facebook Pages & Instagram Professional)
      const tokenUrl = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
      tokenUrl.searchParams.set('client_id', clientId);
      tokenUrl.searchParams.set('client_secret', clientSecret);
      tokenUrl.searchParams.set('redirect_uri', pending.redirectUri);
      tokenUrl.searchParams.set('code', code);

      const tokenRes = await fetch(tokenUrl.toString());
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        expires_in?: number;
        error?: { message?: string };
      };
      if (!tokenRes.ok || !tokenJson.access_token) {
        throw new Error(
          tokenJson.error?.message ||
            'Failed to exchange Meta OAuth authorization code.'
        );
      }

      // Exchange for 60-day long-lived user access token
      const llUrl = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
      llUrl.searchParams.set('grant_type', 'fb_exchange_token');
      llUrl.searchParams.set('client_id', clientId);
      llUrl.searchParams.set('client_secret', clientSecret);
      llUrl.searchParams.set('fb_exchange_token', tokenJson.access_token);

      let longLivedToken = tokenJson.access_token;
      let expiresInSec = tokenJson.expires_in || 5184000;
      const llRes = await fetch(llUrl.toString());
      if (llRes.ok) {
        const llJson = (await llRes.json()) as {
          access_token?: string;
          expires_in?: number;
        };
        if (llJson.access_token) longLivedToken = llJson.access_token;
        if (llJson.expires_in) expiresInSec = llJson.expires_in;
      }

      const pagesUrl = `${GRAPH_API_BASE}/me/accounts?fields=id,name,category,access_token,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(
        longLivedToken
      )}`;
      const pagesRes = await fetch(pagesUrl);
      const pagesJson = (await pagesRes.json()) as {
        data?: Array<{
          id: string;
          name: string;
          category?: string;
          access_token?: string;
          instagram_business_account?: {
            id: string;
            username?: string;
            name?: string;
          };
        }>;
        error?: { message?: string };
      };

      if (!pagesRes.ok) {
        throw new Error(
          pagesJson.error?.message ||
            'Could not list Facebook Pages for this account.'
        );
      }

      const pages = pagesJson.data || [];
      const expiresAt = new Date(
        Date.now() + expiresInSec * 1000
      ).toISOString();

      if (platform === 'instagram') {
        const pageWithIg = pages.find((p) => p.instagram_business_account?.id);
        if (!pageWithIg?.instagram_business_account?.id) {
          throw new Error(
            'No Instagram Professional (Business/Creator) account linked to your Facebook Pages was found. Link your Instagram account to a Facebook Page in Meta Business Suite and retry.'
          );
        }
        const ig = pageWithIg.instagram_business_account;
        record = {
          uid: pending.uid,
          platform: 'instagram',
          accessToken: longLivedToken,
          ...(pageWithIg.access_token
            ? { pageAccessToken: pageWithIg.access_token }
            : {}),
          expiresAt,
          scopes: getPlatformRequirementInfo('instagram', '').requiredScopes,
          accountName: ig.name || ig.username || pageWithIg.name,
          ...(ig.username ? { accountHandle: `@${ig.username}` } : {}),
          externalAccountId: ig.id,
          status: 'connected',
          lastCheckedAt: nowIso,
          connectedAt: nowIso,
          updatedAt: nowIso,
        };
      } else {
        const page = pages[0];
        if (!page?.id || !page.access_token) {
          throw new Error(
            'No manageable Facebook Page was found on this account. Ensure you have Page admin access and granted pages_manage_posts.'
          );
        }
        record = {
          uid: pending.uid,
          platform: 'facebook',
          accessToken: longLivedToken,
          pageAccessToken: page.access_token,
          expiresAt,
          scopes: getPlatformRequirementInfo('facebook', '').requiredScopes,
          accountName: page.name,
          ...(page.category ? { accountHandle: page.category } : {}),
          externalAccountId: page.id,
          status: 'connected',
          lastCheckedAt: nowIso,
          connectedAt: nowIso,
          updatedAt: nowIso,
        };
      }
    }

    saveStoredToken(record);
    const summary = toPublicConnectionSummary(record, platform, true);
    return {
      statusCode: 200,
      html: renderOAuthCallbackHtml({
        type: 'CREATORPILOT_OAUTH_RESULT',
        platform,
        ok: true,
        connection: summary,
      }),
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'OAuth token exchange failed.';
    return {
      statusCode: 502,
      html: renderOAuthCallbackHtml({
        type: 'CREATORPILOT_OAUTH_RESULT',
        platform,
        ok: false,
        error: message,
      }),
    };
  }
}

async function ensureValidAccessToken(
  uid: string,
  platform: SocialPlatform
): Promise<
  | { ok: true; record: StoredTokenRecord; token: string }
  | { ok: false; statusCode: number; code: string; error: string }
> {
  const record = getStoredToken(uid, platform);
  if (!record) {
    return {
      ok: false,
      statusCode: 401,
      code: 'NOT_CONNECTED',
      error: `${platform} account is not connected. Connect your account in Settings first.`,
    };
  }

  const expiresMs = record.expiresAt ? new Date(record.expiresAt).getTime() : 0;
  const isExpiringOrExpired =
    Boolean(expiresMs) && expiresMs <= Date.now() + 5 * 60 * 1000;

  if (isExpiringOrExpired) {
    const { clientId, clientSecret } = getPlatformCredentials(platform);
    if (
      (platform === 'youtube' || platform === 'linkedin') &&
      record.refreshToken &&
      clientId &&
      clientSecret
    ) {
      const tokenEndpoint =
        platform === 'youtube'
          ? 'https://oauth2.googleapis.com/token'
          : 'https://www.linkedin.com/oauth/v2/accessToken';
      try {
        const refreshRes = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: record.refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });
        const refreshJson = (await refreshRes.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
          error_description?: string;
          error?: string;
        };
        if (!refreshRes.ok || !refreshJson.access_token) {
          throw new Error(
            refreshJson.error_description ||
              refreshJson.error ||
              'Token refresh rejected by provider.'
          );
        }

        const nowIso = new Date().toISOString();
        const updated: StoredTokenRecord = {
          ...record,
          accessToken: refreshJson.access_token,
          ...(refreshJson.refresh_token
            ? { refreshToken: refreshJson.refresh_token }
            : {}),
          ...(refreshJson.expires_in
            ? {
                expiresAt: new Date(
                  Date.now() + refreshJson.expires_in * 1000
                ).toISOString(),
              }
            : {}),
          status: 'connected',
          lastCheckedAt: nowIso,
          lastError: undefined,
          updatedAt: nowIso,
        };
        saveStoredToken(updated);
        return { ok: true, record: updated, token: updated.accessToken };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'OAuth token refresh failed.';
        const expiredRecord: StoredTokenRecord = {
          ...record,
          status: 'expired',
          lastError: msg,
          lastCheckedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        saveStoredToken(expiredRecord);
        return {
          ok: false,
          statusCode: 401,
          code: 'TOKEN_EXPIRED',
          error: `${platform} OAuth token expired and refresh failed (${msg}). Please reconnect your account.`,
        };
      }
    }

    const expiredRecord: StoredTokenRecord = {
      ...record,
      status: 'expired',
      lastError: 'Access token has expired. Please reconnect your account.',
      lastCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveStoredToken(expiredRecord);
    return {
      ok: false,
      statusCode: 401,
      code: 'TOKEN_EXPIRED',
      error: `${platform} access token has expired. Please reconnect your account in Settings.`,
    };
  }

  const effectiveToken =
    platform === 'facebook' && record.pageAccessToken
      ? record.pageAccessToken
      : record.accessToken;

  return { ok: true, record, token: effectiveToken };
}

export async function verifyConnectionToken(
  uid: string,
  platform: SocialPlatform,
  baseUrl: string
): Promise<{
  ok: boolean;
  connection: SocialConnectionSummary;
  error?: string;
  code?: string;
}> {
  const reqInfo = getPlatformRequirementInfo(platform, baseUrl);
  const tokenCheck = await ensureValidAccessToken(uid, platform);
  if (!tokenCheck.ok) {
    const stored = getStoredToken(uid, platform);
    return {
      ok: false,
      connection: toPublicConnectionSummary(
        stored,
        platform,
        reqInfo.oauthConfigured
      ),
      error: tokenCheck.error,
      code: tokenCheck.code,
    };
  }

  const { record, token } = tokenCheck;
  const nowIso = new Date().toISOString();
  try {
    if (platform === 'youtube') {
      const res = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`YouTube API returned status ${res.status}`);
    } else if (platform === 'linkedin') {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`LinkedIn API returned status ${res.status}`);
    } else {
      const res = await fetch(
        `${GRAPH_API_BASE}/${encodeURIComponent(
          record.externalAccountId
        )}?fields=id,name&access_token=${encodeURIComponent(token)}`
      );
      if (!res.ok) throw new Error(`Meta Graph API returned status ${res.status}`);
    }

    const updated: StoredTokenRecord = {
      ...record,
      status: 'connected',
      lastCheckedAt: nowIso,
      lastError: undefined,
      updatedAt: nowIso,
    };
    saveStoredToken(updated);
    return {
      ok: true,
      connection: toPublicConnectionSummary(
        updated,
        platform,
        reqInfo.oauthConfigured
      ),
    };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Token verification failed.';
    const updated: StoredTokenRecord = {
      ...record,
      status: 'needs_reauth',
      lastCheckedAt: nowIso,
      lastError: msg,
      updatedAt: nowIso,
    };
    saveStoredToken(updated);
    return {
      ok: false,
      connection: toPublicConnectionSummary(
        updated,
        platform,
        reqInfo.oauthConfigured
      ),
      error: msg,
      code: 'TOKEN_VERIFICATION_FAILED',
    };
  }
}

export function disconnectPlatformAccount(
  uid: string,
  platform: SocialPlatform,
  baseUrl: string
): SocialConnectionSummary {
  deleteStoredToken(uid, platform);
  const reqInfo = getPlatformRequirementInfo(platform, baseUrl);
  return toPublicConnectionSummary(null, platform, reqInfo.oauthConfigured);
}

export function validatePublishPayload(params: {
  platform: SocialPlatform;
  title?: string;
  caption: string;
  mediaType: SocialMediaType;
  mediaUrl?: string;
}): { ok: true } | { ok: false; code: string; error: string } {
  const caption = (params.caption || '').trim();
  if (!caption) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      error: 'Post caption or text content cannot be empty.',
    };
  }

  const mediaUrl = (params.mediaUrl || '').trim();
  if (mediaUrl && !/^https:\/\/.+/i.test(mediaUrl)) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      error:
        'Media or link URL must be a publicly reachable HTTPS URL (https://...).',
    };
  }

  if (params.platform === 'instagram') {
    if (caption.length > 2200) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Instagram captions must be 2,200 characters or fewer.',
      };
    }
    if (
      (params.mediaType !== 'image' && params.mediaType !== 'video') ||
      !mediaUrl
    ) {
      return {
        ok: false,
        code: 'PLATFORM_REQUIREMENT_MISSING',
        error:
          'Instagram Graph API requires a public HTTPS image URL or video/Reel URL. Text-only posts are not supported on Instagram.',
      };
    }
  }

  if (params.platform === 'youtube') {
    if (params.mediaType !== 'video' || !mediaUrl) {
      return {
        ok: false,
        code: 'PLATFORM_REQUIREMENT_MISSING',
        error:
          'YouTube Data API v3 requires a public HTTPS video URL to upload. Text-only Community posts are not supported via official API.',
      };
    }
    if (!(params.title || '').trim()) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'YouTube uploads require a video title (max 100 characters).',
      };
    }
  }

  if (params.platform === 'linkedin' && caption.length > 3000) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      error: 'LinkedIn posts must be 3,000 characters or fewer.',
    };
  }

  return { ok: true };
}

export async function publishToOfficialPlatform(params: {
  uid: string;
  platform: SocialPlatform;
  title?: string;
  caption: string;
  hashtags?: string[];
  mediaType: SocialMediaType;
  mediaUrl?: string;
  youtubePrivacy?: YouTubePrivacyStatus;
  approvalStatus: string;
}): Promise<
  | {
      ok: true;
      externalPostId: string;
      externalPostUrl?: string;
      publishedAt: string;
    }
  | {
      ok: false;
      statusCode: number;
      code: string;
      error: string;
    }
> {
  if (params.approvalStatus !== 'approved') {
    return {
      ok: false,
      statusCode: 403,
      code: 'APPROVAL_REQUIRED',
      error:
        'User approval is strictly required before publishing to any social platform.',
    };
  }

  const validation = validatePublishPayload(params);
  if (!validation.ok) {
    return {
      ok: false,
      statusCode: 400,
      code: validation.code,
      error: validation.error,
    };
  }

  const tokenCheck = await ensureValidAccessToken(params.uid, params.platform);
  if (!tokenCheck.ok) {
    return {
      ok: false,
      statusCode: tokenCheck.statusCode,
      code: tokenCheck.code,
      error: tokenCheck.error,
    };
  }

  const { record, token } = tokenCheck;
  const tagSuffix =
    Array.isArray(params.hashtags) && params.hashtags.length > 0
      ? `\n\n${params.hashtags.join(' ')}`
      : '';
  const fullText = `${params.caption.trim()}${tagSuffix}`.trim();
  const mediaUrl = (params.mediaUrl || '').trim();

  try {
    if (params.platform === 'facebook') {
      const pageId = record.externalAccountId;
      let endpoint = `${GRAPH_API_BASE}/${encodeURIComponent(pageId)}/feed`;
      const bodyParams = new URLSearchParams({ access_token: token });

      if (params.mediaType === 'image' && mediaUrl) {
        endpoint = `${GRAPH_API_BASE}/${encodeURIComponent(pageId)}/photos`;
        bodyParams.set('url', mediaUrl);
        bodyParams.set('caption', fullText);
      } else if (params.mediaType === 'video' && mediaUrl) {
        endpoint = `${GRAPH_API_BASE}/${encodeURIComponent(pageId)}/videos`;
        bodyParams.set('file_url', mediaUrl);
        bodyParams.set('description', fullText);
        if (params.title) bodyParams.set('title', params.title.slice(0, 120));
      } else {
        bodyParams.set('message', fullText);
        if (params.mediaType === 'link' && mediaUrl) {
          bodyParams.set('link', mediaUrl);
        }
      }

      const res = await fetch(endpoint, { method: 'POST', body: bodyParams });
      const json = (await res.json()) as {
        id?: string;
        post_id?: string;
        error?: { message?: string; code?: number };
      };
      if (!res.ok || (!json.id && !json.post_id)) {
        return {
          ok: false,
          statusCode: res.status === 401 || res.status === 403 ? res.status : 502,
          code:
            res.status === 403
              ? 'PERMISSION_DENIED'
              : 'FACEBOOK_PUBLISH_FAILED',
          error:
            json.error?.message ||
            `Facebook Graph API returned status ${res.status}.`,
        };
      }
      const postId = json.post_id || json.id!;
      return {
        ok: true,
        externalPostId: postId,
        externalPostUrl: `https://www.facebook.com/${postId.replace('_', '/posts/')}`,
        publishedAt: new Date().toISOString(),
      };
    }

    if (params.platform === 'instagram') {
      const igUserId = record.externalAccountId;
      const createParams = new URLSearchParams({
        access_token: token,
        caption: fullText.slice(0, 2200),
      });
      if (params.mediaType === 'video') {
        createParams.set('media_type', 'REELS');
        createParams.set('video_url', mediaUrl);
      } else {
        createParams.set('image_url', mediaUrl);
      }

      const containerRes = await fetch(
        `${GRAPH_API_BASE}/${encodeURIComponent(igUserId)}/media`,
        { method: 'POST', body: createParams }
      );
      const containerJson = (await containerRes.json()) as {
        id?: string;
        error?: { message?: string };
      };
      if (!containerRes.ok || !containerJson.id) {
        return {
          ok: false,
          statusCode:
            containerRes.status === 401 || containerRes.status === 403
              ? containerRes.status
              : 502,
          code: 'INSTAGRAM_CONTAINER_FAILED',
          error:
            containerJson.error?.message ||
            `Instagram container creation failed with status ${containerRes.status}.`,
        };
      }

      // Poll container readiness for video/image processing (max ~15s)
      for (let i = 0; i < 6; i++) {
        const statusRes = await fetch(
          `${GRAPH_API_BASE}/${encodeURIComponent(
            containerJson.id
          )}?fields=status_code&access_token=${encodeURIComponent(token)}`
        );
        if (statusRes.ok) {
          const statusJson = (await statusRes.json()) as {
            status_code?: string;
          };
          if (statusJson.status_code === 'FINISHED') break;
          if (statusJson.status_code === 'ERROR') {
            return {
              ok: false,
              statusCode: 502,
              code: 'INSTAGRAM_MEDIA_ERROR',
              error:
                'Instagram reported a media processing error for the provided media URL.',
            };
          }
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      const publishRes = await fetch(
        `${GRAPH_API_BASE}/${encodeURIComponent(igUserId)}/media_publish`,
        {
          method: 'POST',
          body: new URLSearchParams({
            creation_id: containerJson.id,
            access_token: token,
          }),
        }
      );
      const publishJson = (await publishRes.json()) as {
        id?: string;
        error?: { message?: string };
      };
      if (!publishRes.ok || !publishJson.id) {
        return {
          ok: false,
          statusCode: 502,
          code: 'INSTAGRAM_PUBLISH_FAILED',
          error:
            publishJson.error?.message ||
            `Instagram media_publish failed with status ${publishRes.status}.`,
        };
      }

      let permalink: string | undefined;
      const metaRes = await fetch(
        `${GRAPH_API_BASE}/${encodeURIComponent(
          publishJson.id
        )}?fields=permalink&access_token=${encodeURIComponent(token)}`
      );
      if (metaRes.ok) {
        const metaJson = (await metaRes.json()) as { permalink?: string };
        permalink = metaJson.permalink;
      }

      return {
        ok: true,
        externalPostId: publishJson.id,
        ...(permalink ? { externalPostUrl: permalink } : {}),
        publishedAt: new Date().toISOString(),
      };
    }

    if (params.platform === 'linkedin') {
      const body: Record<string, unknown> = {
        author: record.externalAccountId,
        commentary: fullText.slice(0, 3000),
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      };

      if (params.mediaType === 'link' && mediaUrl) {
        body.content = {
          article: {
            source: mediaUrl,
            title: (params.title || 'CreatorPilot AI Post').slice(0, 200),
          },
        };
      }

      const res = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Linkedin-Version': LINKEDIN_API_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(body),
      });

      const restliId = res.headers.get('x-restli-id') || '';
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        return {
          ok: false,
          statusCode: res.status === 401 || res.status === 403 ? res.status : 502,
          code:
            res.status === 403
              ? 'PERMISSION_DENIED'
              : 'LINKEDIN_PUBLISH_FAILED',
          error:
            errJson.message ||
            `LinkedIn Posts API returned status ${res.status}.`,
        };
      }

      const externalPostId = restliId || `urn:li:share:${Date.now()}`;
      return {
        ok: true,
        externalPostId,
        externalPostUrl: `https://www.linkedin.com/feed/update/${encodeURIComponent(
          externalPostId
        )}`,
        publishedAt: new Date().toISOString(),
      };
    }

    // YouTube Data API v3 multipart video upload from verified HTTPS video URL
    const videoRes = await fetch(mediaUrl);
    if (!videoRes.ok) {
      return {
        ok: false,
        statusCode: 400,
        code: 'MEDIA_FETCH_FAILED',
        error: `Could not download video from URL (${videoRes.status}). Provide a direct HTTPS video file URL.`,
      };
    }
    const contentLength = Number(videoRes.headers.get('content-length') || 0);
    if (contentLength > 90 * 1024 * 1024) {
      return {
        ok: false,
        statusCode: 400,
        code: 'VIDEO_TOO_LARGE',
        error: 'Video file exceeds 90 MB server upload limit.',
      };
    }
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const contentType = videoRes.headers.get('content-type') || 'video/mp4';

    const metadata = {
      snippet: {
        title: (params.title || 'CreatorPilot AI Video').slice(0, 100),
        description: fullText.slice(0, 5000),
        tags: (params.hashtags || [])
          .map((t) => t.replace(/^#/, ''))
          .filter(Boolean)
          .slice(0, 15),
      },
      status: {
        privacyStatus: params.youtubePrivacy || 'private',
      },
    };

    const boundary = `cp_yt_${crypto.randomBytes(8).toString('hex')}`;
    const part1 = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        metadata
      )}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
    );
    const partEnd = Buffer.from(`\r\n--${boundary}--`);
    const multipartBody = Buffer.concat([part1, videoBuffer, partEnd]);

    const ytRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );
    const ytJson = (await ytRes.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!ytRes.ok || !ytJson.id) {
      return {
        ok: false,
        statusCode:
          ytRes.status === 401 || ytRes.status === 403 ? ytRes.status : 502,
        code: 'YOUTUBE_PUBLISH_FAILED',
        error:
          ytJson.error?.message ||
          `YouTube upload failed with status ${ytRes.status}.`,
      };
    }

    return {
      ok: true,
      externalPostId: ytJson.id,
      externalPostUrl: `https://www.youtube.com/watch?v=${ytJson.id}`,
      publishedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: 502,
      code: 'PLATFORM_API_ERROR',
      error:
        err instanceof Error
          ? err.message
          : `Failed communicating with ${params.platform} API.`,
    };
  }
}

export async function fetchOfficialPostAnalytics(params: {
  uid: string;
  platform: SocialPlatform;
  externalPostId: string;
}): Promise<
  | { ok: true; analytics: SocialPostAnalytics }
  | { ok: false; statusCode: number; code: string; error: string }
> {
  const tokenCheck = await ensureValidAccessToken(params.uid, params.platform);
  if (!tokenCheck.ok) {
    return {
      ok: false,
      statusCode: tokenCheck.statusCode,
      code: tokenCheck.code,
      error: tokenCheck.error,
    };
  }

  const { token } = tokenCheck;
  const fetchedAt = new Date().toISOString();

  try {
    if (params.platform === 'youtube') {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(
          params.externalPostId
        )}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = (await res.json()) as {
        items?: Array<{
          statistics?: {
            viewCount?: string;
            likeCount?: string;
            commentCount?: string;
          };
        }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          statusCode: 502,
          code: 'YOUTUBE_ANALYTICS_ERROR',
          error:
            json.error?.message || `YouTube API returned status ${res.status}.`,
        };
      }
      const stats = json.items?.[0]?.statistics;
      return {
        ok: true,
        analytics: {
          supported: true,
          views: Number(stats?.viewCount || 0),
          likes: Number(stats?.likeCount || 0),
          comments: Number(stats?.commentCount || 0),
          fetchedAt,
        },
      };
    }

    if (params.platform === 'instagram') {
      const insightsRes = await fetch(
        `${GRAPH_API_BASE}/${encodeURIComponent(
          params.externalPostId
        )}/insights?metric=impressions,reach,likes,comments,shares,saved&access_token=${encodeURIComponent(
          token
        )}`
      );
      if (insightsRes.ok) {
        const insJson = (await insightsRes.json()) as {
          data?: Array<{
            name: string;
            values?: Array<{ value?: number }>;
          }>;
        };
        const metrics: Record<string, number> = {};
        for (const item of insJson.data || []) {
          metrics[item.name] = Number(item.values?.[0]?.value || 0);
        }
        return {
          ok: true,
          analytics: {
            supported: true,
            impressions: metrics.impressions ?? 0,
            reach: metrics.reach ?? 0,
            likes: metrics.likes ?? 0,
            comments: metrics.comments ?? 0,
            shares: metrics.shares ?? 0,
            saves: metrics.saved ?? 0,
            fetchedAt,
          },
        };
      }

      // Fallback to basic public media engagement fields
      const mediaRes = await fetch(
        `${GRAPH_API_BASE}/${encodeURIComponent(
          params.externalPostId
        )}?fields=like_count,comments_count&access_token=${encodeURIComponent(
          token
        )}`
      );
      const mediaJson = (await mediaRes.json()) as {
        like_count?: number;
        comments_count?: number;
        error?: { message?: string };
      };
      if (!mediaRes.ok) {
        return {
          ok: false,
          statusCode: 502,
          code: 'INSTAGRAM_ANALYTICS_ERROR',
          error:
            mediaJson.error?.message ||
            'Could not read Instagram insights for this media ID.',
        };
      }
      return {
        ok: true,
        analytics: {
          supported: true,
          likes: Number(mediaJson.like_count || 0),
          comments: Number(mediaJson.comments_count || 0),
          fetchedAt,
          note: 'Basic media engagement retrieved (full insights require instagram_manage_insights approval).',
        },
      };
    }

    if (params.platform === 'facebook') {
      const res = await fetch(
        `${GRAPH_API_BASE}/${encodeURIComponent(
          params.externalPostId
        )}?fields=shares,likes.summary(true),comments.summary(true),insights.metric(post_impressions,post_engaged_users)&access_token=${encodeURIComponent(
          token
        )}`
      );
      const json = (await res.json()) as {
        shares?: { count?: number };
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
        insights?: {
          data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
        };
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          statusCode: 502,
          code: 'FACEBOOK_ANALYTICS_ERROR',
          error:
            json.error?.message ||
            `Facebook Graph API returned status ${res.status}.`,
        };
      }
      const impressionsMetric = json.insights?.data?.find(
        (m) => m.name === 'post_impressions'
      );
      const reachMetric = json.insights?.data?.find(
        (m) => m.name === 'post_engaged_users'
      );
      return {
        ok: true,
        analytics: {
          supported: true,
          impressions: Number(impressionsMetric?.values?.[0]?.value || 0),
          reach: Number(reachMetric?.values?.[0]?.value || 0),
          likes: Number(json.likes?.summary?.total_count || 0),
          comments: Number(json.comments?.summary?.total_count || 0),
          shares: Number(json.shares?.count || 0),
          fetchedAt,
        },
      };
    }

    // LinkedIn post analytics (requires Community Management API approval)
    const liRes = await fetch(
      `https://api.linkedin.com/rest/memberCreatorPostAnalytics?q=entity&entity=(share:${encodeURIComponent(
        params.externalPostId
      )})&queryType=IMPRESSION`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Linkedin-Version': LINKEDIN_API_VERSION,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      }
    );
    if (!liRes.ok) {
      return {
        ok: true,
        analytics: {
          supported: false,
          fetchedAt,
          note: `LinkedIn post analytics require approved Community Management API (r_member_postAnalytics) permission (API returned ${liRes.status}).`,
        },
      };
    }
    const liJson = (await liRes.json()) as {
      elements?: Array<{ count?: number }>;
    };
    return {
      ok: true,
      analytics: {
        supported: true,
        impressions: Number(liJson.elements?.[0]?.count || 0),
        fetchedAt,
      },
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: 502,
      code: 'ANALYTICS_FETCH_FAILED',
      error:
        err instanceof Error ? err.message : 'Failed to fetch post analytics.',
    };
  }
}

export function scheduleSocialPostJob(params: {
  uid: string;
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
}):
  | { ok: true; scheduledFor: string }
  | { ok: false; statusCode: number; code: string; error: string } {
  if (params.approvalStatus !== 'approved') {
    return {
      ok: false,
      statusCode: 403,
      code: 'APPROVAL_REQUIRED',
      error: 'You must approve this post before scheduling it.',
    };
  }

  const targetTime = new Date(params.scheduledFor).getTime();
  if (Number.isNaN(targetTime) || targetTime < Date.now() - 60000) {
    return {
      ok: false,
      statusCode: 400,
      code: 'INVALID_SCHEDULE_TIME',
      error: 'Please choose a valid future date and time for scheduling.',
    };
  }

  const validation = validatePublishPayload(params);
  if (!validation.ok) {
    return {
      ok: false,
      statusCode: 400,
      code: validation.code,
      error: validation.error,
    };
  }

  const stored = getStoredToken(params.uid, params.platform);
  if (!stored) {
    return {
      ok: false,
      statusCode: 401,
      code: 'NOT_CONNECTED',
      error: `Connect your ${params.platform} account in Settings before scheduling.`,
    };
  }

  upsertScheduledJob({
    postId: params.postId,
    uid: params.uid,
    platform: params.platform,
    ...(params.title ? { title: params.title } : {}),
    caption: params.caption,
    ...(params.hashtags ? { hashtags: params.hashtags } : {}),
    mediaType: params.mediaType,
    ...(params.mediaUrl ? { mediaUrl: params.mediaUrl } : {}),
    ...(params.youtubePrivacy ? { youtubePrivacy: params.youtubePrivacy } : {}),
    approvalStatus: 'approved',
    scheduledFor: new Date(targetTime).toISOString(),
    status: 'scheduled',
    updatedAt: new Date().toISOString(),
  });

  return { ok: true, scheduledFor: new Date(targetTime).toISOString() };
}

export function getUserScheduledStatuses(uid: string) {
  return listUserScheduledJobs(uid);
}

export function cancelUserScheduledJob(uid: string, postId: string) {
  const existing = getScheduledJob(uid, postId);
  if (existing && existing.status === 'scheduled') {
    removeScheduledJob(uid, postId);
    return true;
  }
  return false;
}

let schedulerRunning = false;
export function startSocialScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  setInterval(async () => {
    const now = Date.now();
    const dueJobs = listScheduledJobs().filter(
      (j) =>
        j.status === 'scheduled' &&
        j.approvalStatus === 'approved' &&
        new Date(j.scheduledFor).getTime() <= now
    );

    for (const job of dueJobs) {
      upsertScheduledJob({
        ...job,
        status: 'publishing',
        updatedAt: new Date().toISOString(),
      });

      const result = await publishToOfficialPlatform({
        uid: job.uid,
        platform: job.platform,
        title: job.title,
        caption: job.caption,
        hashtags: job.hashtags,
        mediaType: job.mediaType,
        mediaUrl: job.mediaUrl,
        youtubePrivacy: job.youtubePrivacy,
        approvalStatus: job.approvalStatus,
      });

      if (result.ok) {
        upsertScheduledJob({
          ...job,
          status: 'published',
          publishedAt: result.publishedAt,
          externalPostId: result.externalPostId,
          ...(result.externalPostUrl
            ? { externalPostUrl: result.externalPostUrl }
            : {}),
          error: undefined,
          errorCode: undefined,
          updatedAt: new Date().toISOString(),
        });
      } else {
        upsertScheduledJob({
          ...job,
          status: 'failed',
          error: result.error,
          errorCode: result.code,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }, 15000);
}
