import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  Info,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import type { UserProfile } from '../types/auth';
import type { NavSection, WorkspaceNotification } from '../types/creator';

interface TopBarProps {
  activeSection: NavSection;
  onOpenMobileMenu: () => void;
  onQuickCreate: () => void;
  user: UserProfile;
  onSelectSection: (section: NavSection) => void;
  onLogout: () => void;
  notifications: WorkspaceNotification[];
  onMarkAllRead: () => void;
  onClearNotifications: () => void;
}

const SECTION_LABELS: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  create: 'Create Content',
  'ai-video': 'AI Video Generator',
  'video-editor': 'Smart Video Editor',
  thumbnails: 'AI Thumbnail Studio',
  calendar: 'Content Calendar',
  analytics: 'Creator Analytics',
  'brand-kit': 'Brand Kit',
  projects: 'My Projects',
  history: 'Content History',
  settings: 'Settings',
  profile: 'My Profile',
};

export function TopBar({
  activeSection,
  onOpenMobileMenu,
  onQuickCreate,
  user,
  onSelectSection,
  onLogout,
  notifications,
  onMarkAllRead,
  onClearNotifications,
}: TopBarProps) {
  const { resolvedTheme, themeMode, toggleTheme } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const initials =
    user.fullName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'CP';

  const nextThemeLabel =
    resolvedTheme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[var(--border-default)] bg-[var(--bg-header)] px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8 transition-colors duration-200">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-sm min-w-0"
        >
          <span className="hidden text-[var(--text-muted)] sm:inline whitespace-nowrap">
            CreatorPilot AI
          </span>
          <span
            className="hidden text-[var(--text-muted)]/60 sm:inline"
            aria-hidden="true"
          >
            /
          </span>
          <span className="truncate font-display text-base font-semibold text-[var(--text-primary)]">
            {SECTION_LABELS[activeSection]}
          </span>
        </nav>
      </div>

      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* Theme Quick Toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={nextThemeLabel}
          title={`${nextThemeLabel}${
            themeMode === 'system' ? ' (currently System Default)' : ''
          }`}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="h-4 w-4 text-amber-400" />
          ) : (
            <Moon className="h-4 w-4 text-violet-600" />
          )}
          <span className="hidden md:inline whitespace-nowrap">
            {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
          </span>
        </button>

        {/* Real Workspace Notifications Popover */}
        <div ref={notifRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setNotifOpen((prev) => !prev);
              setDropdownOpen(false);
            }}
            aria-label="Workspace notifications"
            aria-expanded={notifOpen}
            aria-haspopup="dialog"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 font-mono text-[10px] font-bold text-white tabular-nums">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div
              role="dialog"
              aria-label="Recent workspace notifications"
              className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-2 shadow-[var(--shadow-popover)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-default)] px-3 py-2">
                <div>
                  <h2 className="font-display text-xs font-semibold text-[var(--text-primary)]">
                    Notifications
                  </h2>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {notifications.length === 0
                      ? 'No recent workspace alerts'
                      : `${unreadCount} unread of ${notifications.length}`}
                  </p>
                </div>

                {notifications.length > 0 && (
                  <div className="flex items-center gap-1">
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={onMarkAllRead}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:bg-[var(--bg-surface)]"
                      >
                        <CheckCheck className="h-3 w-3" />
                        <span>Mark read</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onClearNotifications}
                      aria-label="Clear notifications"
                      className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto py-1">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Bell className="mx-auto h-6 w-6 text-[var(--text-muted)]/60" />
                    <p className="mt-2 text-xs font-medium text-[var(--text-secondary)]">
                      You&apos;re all caught up
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                      AI generation, assistant jobs, and publishing alerts appear here.
                    </p>
                  </div>
                ) : (
                  notifications.map((item) => {
                    const Icon =
                      item.variant === 'success'
                        ? CheckCircle2
                        : item.variant === 'error'
                        ? AlertCircle
                        : Info;
                    const iconColor =
                      item.variant === 'success'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : item.variant === 'error'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-sky-600 dark:text-sky-400';

                    return (
                      <div
                        key={item.id}
                        className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
                          item.read
                            ? 'opacity-80 hover:bg-[var(--bg-surface)]'
                            : 'bg-violet-500/5 hover:bg-[var(--bg-surface)]'
                        }`}
                      >
                        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconColor}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-[var(--text-primary)]">
                            {item.title}
                          </p>
                          {item.description && (
                            <p className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">
                              {item.description}
                            </p>
                          )}
                          <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                            {new Date(item.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quick Create CTA */}
        {activeSection !== 'create' && (
          <button
            type="button"
            onClick={onQuickCreate}
            className="hidden sm:inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:from-violet-500 hover:to-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Create Content</span>
          </button>
        )}

        {/* User Profile Dropdown */}
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setDropdownOpen((v) => !v);
              setNotifOpen(false);
            }}
            aria-expanded={dropdownOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] py-1.5 pl-1.5 pr-2.5 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <div className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 font-display text-[11px] font-semibold text-white">
              {initials}
            </div>
            <span className="hidden max-w-[130px] truncate text-xs font-medium text-[var(--text-primary)] md:inline">
              {user.fullName}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform duration-150 ${
                dropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {dropdownOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-60 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 shadow-[var(--shadow-popover)]"
            >
              <div className="border-b border-[var(--border-default)] px-3 py-2.5">
                <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                  {user.fullName}
                </p>
                <p className="truncate text-[11px] text-[var(--text-muted)]">
                  {user.email}
                </p>
              </div>

              <div className="py-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDropdownOpen(false);
                    onSelectSection('profile');
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                >
                  <UserIcon className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                  <span>My Profile</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDropdownOpen(false);
                    onSelectSection('settings');
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
                >
                  <Settings className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Account &amp; Appearance</span>
                </button>
              </div>

              <div className="border-t border-[var(--border-default)] pt-1">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDropdownOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-300 transition-colors hover:bg-rose-500/10"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
