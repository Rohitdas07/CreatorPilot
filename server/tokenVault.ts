import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  SocialConnectionSummary,
  SocialMediaType,
  SocialPlatform,
  SocialPostAnalytics,
  YouTubePrivacyStatus,
} from '../src/types/social.ts';

const DATA_DIR = path.resolve(process.cwd(), '.data');
const KEY_FILE = path.join(DATA_DIR, '.vault-key');
const TOKENS_FILE = path.join(DATA_DIR, 'social-tokens.enc.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'social-schedules.enc.json');

export interface StoredTokenRecord {
  uid: string;
  platform: SocialPlatform;
  accessToken: string;
  refreshToken?: string;
  pageAccessToken?: string;
  tokenType?: string;
  expiresAt?: string;
  scopes: string[];
  accountName: string;
  accountHandle?: string;
  externalAccountId: string;
  status: 'connected' | 'expired' | 'needs_reauth';
  lastCheckedAt?: string;
  lastError?: string;
  connectedAt: string;
  updatedAt: string;
}

export interface StoredScheduledJob {
  postId: string;
  uid: string;
  platform: SocialPlatform;
  title?: string;
  caption: string;
  hashtags?: string[];
  mediaUrl?: string;
  mediaType: SocialMediaType;
  youtubePrivacy?: YouTubePrivacyStatus;
  approvalStatus: 'approved';
  scheduledFor: string;
  status: 'scheduled' | 'publishing' | 'published' | 'failed';
  publishedAt?: string;
  externalPostId?: string;
  externalPostUrl?: string;
  error?: string;
  errorCode?: string;
  analytics?: SocialPostAnalytics;
  updatedAt: string;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

let cachedVaultKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedVaultKey) return cachedVaultKey;
  ensureDataDir();

  const envSecret = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY?.trim();
  if (envSecret && envSecret.length >= 16) {
    cachedVaultKey = crypto.scryptSync(envSecret, 'creatorpilot-social-vault-v1', 32);
    return cachedVaultKey;
  }

  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (raw.length === 64) {
      cachedVaultKey = Buffer.from(raw, 'hex');
      return cachedVaultKey;
    }
  }

  const newKey = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, newKey.toString('hex'), { mode: 0o600 });
  cachedVaultKey = newKey;
  return cachedVaultKey;
}

function encryptJson(data: unknown): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

function decryptJson<T>(rawContent: string, fallback: T): T {
  try {
    const parsed = JSON.parse(rawContent) as {
      v?: number;
      iv?: string;
      tag?: string;
      data?: string;
    };
    if (!parsed?.iv || !parsed?.tag || !parsed?.data) return fallback;
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(parsed.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    return fallback;
  }
}

function readEncryptedMap<T>(filePath: string): Record<string, T> {
  ensureDataDir();
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return decryptJson<Record<string, T>>(raw, {});
  } catch {
    return {};
  }
}

function writeEncryptedMap<T>(filePath: string, map: Record<string, T>): void {
  ensureDataDir();
  const payload = encryptJson(map);
  fs.writeFileSync(filePath, payload, { mode: 0o600 });
}

function tokenKey(uid: string, platform: SocialPlatform): string {
  return `${uid}:${platform}`;
}

export function getStoredToken(
  uid: string,
  platform: SocialPlatform
): StoredTokenRecord | null {
  const map = readEncryptedMap<StoredTokenRecord>(TOKENS_FILE);
  return map[tokenKey(uid, platform)] || null;
}

export function saveStoredToken(record: StoredTokenRecord): void {
  const map = readEncryptedMap<StoredTokenRecord>(TOKENS_FILE);
  map[tokenKey(record.uid, record.platform)] = record;
  writeEncryptedMap(TOKENS_FILE, map);
}

export function deleteStoredToken(uid: string, platform: SocialPlatform): void {
  const map = readEncryptedMap<StoredTokenRecord>(TOKENS_FILE);
  delete map[tokenKey(uid, platform)];
  writeEncryptedMap(TOKENS_FILE, map);
}

export function toPublicConnectionSummary(
  record: StoredTokenRecord | null,
  platform: SocialPlatform,
  oauthConfigured: boolean
): SocialConnectionSummary {
  const nowIso = new Date().toISOString();
  if (!record) {
    return {
      id: platform,
      platform,
      status: oauthConfigured ? 'disconnected' : 'not_configured',
      updatedAt: nowIso,
    };
  }

  let effectiveStatus: SocialConnectionSummary['status'] = record.status;
  if (
    record.expiresAt &&
    new Date(record.expiresAt).getTime() <= Date.now() &&
    !record.refreshToken
  ) {
    effectiveStatus = 'expired';
  }

  return {
    id: platform,
    userId: record.uid,
    platform,
    status: effectiveStatus,
    accountName: record.accountName,
    ...(record.accountHandle ? { accountHandle: record.accountHandle } : {}),
    externalAccountId: record.externalAccountId,
    scopes: record.scopes,
    ...(record.expiresAt ? { tokenExpiresAt: record.expiresAt } : {}),
    ...(record.lastCheckedAt ? { lastCheckedAt: record.lastCheckedAt } : {}),
    ...(record.lastError ? { lastError: record.lastError } : {}),
    connectedAt: record.connectedAt,
    updatedAt: record.updatedAt,
  };
}

function scheduleKey(uid: string, postId: string): string {
  return `${uid}:${postId}`;
}

export function listScheduledJobs(): StoredScheduledJob[] {
  const map = readEncryptedMap<StoredScheduledJob>(SCHEDULES_FILE);
  return Object.values(map);
}

export function listUserScheduledJobs(uid: string): StoredScheduledJob[] {
  return listScheduledJobs().filter((j) => j.uid === uid);
}

export function getScheduledJob(
  uid: string,
  postId: string
): StoredScheduledJob | null {
  const map = readEncryptedMap<StoredScheduledJob>(SCHEDULES_FILE);
  return map[scheduleKey(uid, postId)] || null;
}

export function upsertScheduledJob(job: StoredScheduledJob): void {
  const map = readEncryptedMap<StoredScheduledJob>(SCHEDULES_FILE);
  map[scheduleKey(job.uid, job.postId)] = job;
  writeEncryptedMap(SCHEDULES_FILE, map);
}

export function removeScheduledJob(uid: string, postId: string): void {
  const map = readEncryptedMap<StoredScheduledJob>(SCHEDULES_FILE);
  delete map[scheduleKey(uid, postId)];
  writeEncryptedMap(SCHEDULES_FILE, map);
}
