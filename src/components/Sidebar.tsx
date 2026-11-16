import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FolderKanban,
  History,
  Image as ImageIcon,
  LayoutDashboard,
  Palette,
  Scissors,
  Settings,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { NavSection } from '../types/creator';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  projectCount: number;
  historyCount: number;
  creatorName: string;
  brandHandle: string;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'create', label: 'Create Content', icon: Sparkles },
  { id: 'ai-video', label: 'AI Video Generator', icon: Clapperboard },
  { id: 'video-editor', label: 'Video Editor', icon: Scissors },
  { id: 'thumbnails', label: 'Thumbnail Studio', icon: ImageIcon },
  { id: 'calendar', label: 'Content Calendar', icon: CalendarDays },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'brand-kit', label: 'Brand Kit', icon: Palette },
  { id: 'projects', label: 'My Projects', icon: FolderKanban },
  { id: 'history', label: 'Content History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  mobileOpen,
  onCloseMobile,
  collapsed,
  onToggleCollapse,
  projectCount,
  historyCount,
  creatorName,
  brandHandle,
}: SidebarProps) {
  const handleSelect = (id: NavSection) => {
    onSelectSection(id);
    onCloseMobile();
  };

  const initials =
    creatorName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'CP';

  const renderNavContent = (isCollapsedDesktop: boolean) => (
    <div
      className={`flex h-full flex-col justify-between bg-[var(--bg-sidebar)] py-5 transition-all duration-200 ${
        isCollapsedDesktop ? 'px-2.5' : 'px-4'
      }`}
    >
      <div>
        {/* Brand Logo & Collapse Control */}
        <div
          className={`flex items-center pb-6 ${
            isCollapsedDesktop ? 'flex-col gap-3 px-0' : 'justify-between px-1.5'
          }`}
        >
          <button
            type="button"
            onClick={() => handleSelect('dashboard')}
            title="CreatorPilot AI Dashboard"
            className="flex items-center gap-3 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-sm">
              <Zap className="h-4.5 w-4.5" />
            </div>
            {!isCollapsedDesktop && (
              <div className="min-w-0">
                <span className="block font-display text-base font-bold tracking-tight text-[var(--text-primary)] whitespace-nowrap">
                  CreatorPilot AI
                </span>
              </div>
            )}
          </button>

          {/* Desktop Collapse/Expand Button */}
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={isCollapsedDesktop ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsedDesktop ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden lg:inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            {isCollapsedDesktop ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Mobile Drawer Close */}
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav aria-label="Main navigation" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const count =
              item.id === 'projects'
                ? projectCount
                : item.id === 'history'
                ? historyCount
                : null;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                title={isCollapsedDesktop ? item.label : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={`group relative flex w-full items-center rounded-xl text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                  isCollapsedDesktop
                    ? 'justify-center px-2 py-2.5'
                    : 'justify-between px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-gradient-to-r from-violet-600/15 to-blue-600/12 text-violet-700 dark:text-white border border-violet-500/30 shadow-xs'
                    : 'text-[var(--text-muted)] border border-transparent hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="flex items-center gap-3 whitespace-nowrap">
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      isActive
                        ? 'text-violet-600 dark:text-violet-400'
                        : 'text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'
                    }`}
                  />
                  {!isCollapsedDesktop && <span>{item.label}</span>}
                </span>

                {!isCollapsedDesktop && count !== null && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      isActive
                        ? 'text-violet-700 dark:text-violet-200 font-semibold'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Workspace Profile */}
      <div className="border-t border-[var(--border-default)] pt-4">
        <button
          type="button"
          onClick={() => handleSelect('profile')}
          title={isCollapsedDesktop ? `${creatorName} (${brandHandle})` : undefined}
          className={`flex w-full items-center rounded-xl py-2 text-left transition-colors hover:bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
            isCollapsedDesktop ? 'justify-center px-1' : 'gap-3 px-2'
          } ${
            activeSection === 'profile'
              ? 'bg-[var(--bg-surface)] border border-[var(--border-default)]'
              : 'border border-transparent'
          }`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600/15 to-blue-600/15 border border-violet-500/30 font-display text-xs font-bold text-violet-700 dark:text-violet-300">
            {initials}
          </div>
          {!isCollapsedDesktop && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                {creatorName}
              </p>
              <p className="truncate text-xs text-[var(--text-muted)]">
                {brandHandle}
              </p>
            </div>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden shrink-0 border-r border-[var(--border-default)] transition-[width] duration-200 lg:block ${
          collapsed ? 'w-[76px]' : 'w-64'
        }`}
      >
        <div className="sticky top-0 h-screen">{renderNavContent(collapsed)}</div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-50 w-72 max-w-[85vw] border-r border-[var(--border-default)] bg-[var(--bg-sidebar)] shadow-2xl">
            {renderNavContent(false)}
          </aside>
        </div>
      )}
    </>
  );
}
