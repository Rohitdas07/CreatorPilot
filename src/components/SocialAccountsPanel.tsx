import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Facebook,
  Instagram,
  KeyRound,
  Linkedin,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unlink,
  Youtube,
} from 'lucide-react';
import type {
  SocialConnectionSummary,
  SocialPlatform,
  SocialPlatformRequirementInfo,
} from '../types/social';

interface SocialAccountsPanelProps {
  requirements: SocialPlatformRequirementInfo[];
  connections: SocialConnectionSummary[];
  isLoading: boolean;
  busyPlatform: SocialPlatform | null;
  onRefreshStatus: () => Promise<void>;
  onConnect: (platform: SocialPlatform) => Promise<void>;
  onVerify: (platform: SocialPlatform) => Promise<void>;
  onDisconnect: (platform: SocialPlatform) => Promise<void>;
  onCopyText: (text: string, label: string) => void;
}

const PLATFORM_META: Record<
  SocialPlatform,
  {
    icon: typeof Instagram;
    accentClass: string;
  }
> = {
  instagram: {
    icon: Instagram,
    accentClass: 'bg-violet-500/15 text-violet-400',
  },
  youtube: {
    icon: Youtube,
    accentClass: 'bg-rose-500/15 text-rose-400',
  },
  linkedin: {
    icon: Linkedin,
    accentClass: 'bg-blue-500/15 text-blue-400',
  },
  facebook: {
    icon: Facebook,
    accentClass: 'bg-sky-500/15 text-sky-400',
  },
};

function getStatusBadge(status: SocialConnectionSummary['status']) {
  switch (status) {
    case 'connected':
      return {
        label: 'Connected',
        classes: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      };
    case 'expired':
      return {
        label: 'Token Expired',
        classes: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
      };
    case 'needs_reauth':
      return {
        label: 'Needs Re-auth',
        classes: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      };
    case 'not_configured':
      return {
        label: 'Setup Required',
        classes: 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200',
      };
    default:
      return {
        label: 'Not Connected',
        classes: 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
      };
  }
}

export function SocialAccountsPanel({
  requirements,
  connections,
  isLoading,
  busyPlatform,
  onRefreshStatus,
  onConnect,
  onVerify,
  onDisconnect,
  onCopyText,
}: SocialAccountsPanelProps) {
  const [expandedSetup, setExpandedSetup] = useState<
    Record<SocialPlatform, boolean>
  >({
    instagram: false,
    youtube: false,
    linkedin: false,
    facebook: false,
  });

  const toggleSetup = (platform: SocialPlatform) => {
    setExpandedSetup((prev) => ({ ...prev, [platform]: !prev[platform] }));
  };

  return (
    <section className="space-y-5 rounded-xl surface-card p-6">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--border-default)] pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Official Social Media Integrations
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Connect Instagram Professional, YouTube, LinkedIn, and Facebook Pages via official OAuth 2.0. Access &amp; refresh tokens remain encrypted on the server vault and are never sent to the browser or Firestore.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void onRefreshStatus()}
          disabled={isLoading}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
          />
          <span>Refresh Status</span>
        </button>
      </div>

      {requirements.length === 0 ? (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-xs text-[var(--text-muted)]">
          {isLoading
            ? 'Checking server OAuth configuration and connected social accounts...'
            : 'Unable to load social integration status from backend. Click Refresh Status to retry.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {requirements.map((req) => {
            const conn = connections.find((c) => c.platform === req.platform) || {
              id: req.platform,
              platform: req.platform,
              status: req.oauthConfigured ? 'disconnected' : 'not_configured',
              updatedAt: '',
            };
            const meta = PLATFORM_META[req.platform];
            const Icon = meta.icon;
            const badge = getStatusBadge(conn.status);
            const isBusy = busyPlatform === req.platform;
            const isConnected =
              conn.status === 'connected' ||
              conn.status === 'expired' ||
              conn.status === 'needs_reauth';
            const showDetails =
              expandedSetup[req.platform] || !req.oauthConfigured;

            return (
              <div
                key={req.platform}
                className="flex flex-col justify-between space-y-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.accentClass}`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {req.displayName}
                        </h3>
                        <p className="truncate text-[11px] text-[var(--text-muted)]">
                          {req.apiName}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`shrink-0 rounded-md border px-2.5 py-0.5 text-[11px] font-semibold ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  {isConnected && (
                    <div className="space-y-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-[var(--text-primary)]">
                          {conn.accountName || req.displayName}
                        </span>
                        {conn.accountHandle && (
                          <span className="truncate font-mono text-[11px] text-violet-700 dark:text-violet-300">
                            {conn.accountHandle}
                          </span>
                        )}
                      </div>
                      {conn.externalAccountId && (
                        <p className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                          ID: {conn.externalAccountId}
                        </p>
                      )}
                      {conn.tokenExpiresAt && (
                        <p className="text-[11px] text-[var(--text-muted)]">
                          Token expires:{' '}
                          <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                            {new Date(conn.tokenExpiresAt).toLocaleString()}
                          </span>
                        </p>
                      )}
                      {conn.lastCheckedAt && (
                        <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                          Last verified:{' '}
                          {new Date(conn.lastCheckedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}

                  {conn.lastError && (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-800 dark:text-rose-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                      <span className="leading-relaxed">{conn.lastError}</span>
                    </div>
                  )}

                  {!req.oauthConfigured && (
                    <div className="space-y-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-950 dark:text-amber-100">
                        <KeyRound className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        <span>Manual OAuth Setup Required</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-amber-900/90 dark:text-amber-200/90">
                        Missing server environment variables:{' '}
                        <span className="font-mono font-semibold text-[var(--text-primary)]">
                          {req.missingEnvVars.join(', ')}
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="space-y-3 border-t border-[var(--border-default)] pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {(!isConnected ||
                      conn.status === 'expired' ||
                      conn.status === 'needs_reauth') && (
                      <button
                        type="button"
                        onClick={() => void onConnect(req.platform)}
                        disabled={isBusy || !req.oauthConfigured}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-all hover:from-violet-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {conn.status === 'expired' ||
                          conn.status === 'needs_reauth'
                            ? 'Reconnect OAuth'
                            : 'Connect via OAuth'}
                        </span>
                      </button>
                    )}

                    {isConnected && (
                      <>
                        <button
                          type="button"
                          onClick={() => void onVerify(req.platform)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] disabled:opacity-50"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          <span>Verify Token</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void onDisconnect(req.platform)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-500/20 disabled:opacity-50 dark:text-rose-200"
                        >
                          <Unlink className="h-3.5 w-3.5" />
                          <span>Disconnect</span>
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleSetup(req.platform)}
                      className="ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <span>Requirements &amp; Setup</span>
                      {showDetails ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  </div>

                  {showDetails && (
                    <div className="space-y-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-3.5 text-[11px] text-[var(--text-secondary)]">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[var(--text-primary)]">
                            OAuth Callback URL
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                onCopyText(
                                  req.redirectUri,
                                  `${req.displayName} Redirect URI`
                                )
                              }
                              className="inline-flex items-center gap-1 text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
                            >
                              <Copy className="h-3 w-3" />
                              <span>Copy</span>
                            </button>
                            <a
                              href={req.portalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              <span>Developer Portal</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                        <p className="mt-1 break-all rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
                          {req.redirectUri}
                        </p>
                      </div>

                      <div>
                        <p className="font-semibold text-[var(--text-primary)]">
                          Required Scopes
                        </p>
                        <p className="mt-0.5 break-words font-mono text-[10px] text-[var(--text-muted)]">
                          {req.requiredScopes.join(', ')}
                        </p>
                      </div>

                      <div>
                        <p className="font-semibold text-[var(--text-primary)]">
                          Platform Approval &amp; Setup Notes
                        </p>
                        <p className="mt-0.5 leading-relaxed text-[var(--text-muted)]">
                          {req.approvalNotes}
                        </p>
                      </div>

                      <div>
                        <p className="font-semibold text-[var(--text-primary)]">
                          Publishing Rules
                        </p>
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[var(--text-muted)]">
                          {req.publishingRequirements.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </div>

                      <p className="text-[var(--text-muted)]">
                        <span className="font-semibold text-[var(--text-primary)]">
                          Analytics:
                        </span>{' '}
                        {req.analyticsNotes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
