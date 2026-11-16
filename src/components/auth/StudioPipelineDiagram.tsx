import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Aperture,
  BarChart3,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Layers,
  Mic,
  Send,
} from 'lucide-react';

type StudioOutputStageId = 'reels' | 'thumbnails' | 'distribution';
type StudioPaletteId = 'amber' | 'emerald' | 'crimson';

interface OutputStage {
  id: StudioOutputStageId;
  title: string;
  spec: string;
  detail: string;
  icon: typeof Film;
}

interface StudioPalette {
  id: StudioPaletteId;
  label: string;
  swatchClass: string;
  svgStart: string;
  svgEnd: string;
  glowTop: string;
  glowBottom: string;
  headerIcon: string;
  sourceBadgeBg: string;
  sourceSpecText: string;
  waveformGradient: string;
  trackPrimaryA: string;
  trackPrimaryB: string;
  trackPrimaryC: string;
  trackSecondaryA: string;
  trackSecondaryB: string;
  playhead: string;
  ringOuter: string;
  ringInner: string;
  lensGradient: string;
  activeCardBorder: string;
  activeIconGradient: string;
  activeSendIcon: string;
  indicatorGradient: string;
  switcherActive: string;
}

const PALETTE_STORAGE_KEY = 'creatorpilot_studio_diagram_palette';

const STUDIO_PALETTES: Record<StudioPaletteId, StudioPalette> = {
  amber: {
    id: 'amber',
    label: 'Cinema Amber',
    swatchClass: 'bg-amber-500',
    svgStart: '#d97706',
    svgEnd: '#0d9488',
    glowTop: 'bg-amber-500/12 dark:bg-amber-500/16',
    glowBottom: 'bg-teal-500/10 dark:bg-teal-500/16',
    headerIcon: 'text-amber-600 dark:text-amber-400',
    sourceBadgeBg: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    sourceSpecText: 'text-amber-700 dark:text-amber-300',
    waveformGradient: 'bg-gradient-to-t from-amber-600 to-teal-500',
    trackPrimaryA: 'bg-amber-500/40 dark:bg-amber-500/45',
    trackPrimaryB: 'bg-teal-500/35 dark:bg-teal-500/45',
    trackPrimaryC: 'bg-amber-500/25 dark:bg-amber-500/30',
    trackSecondaryA: 'bg-teal-500/45',
    trackSecondaryB: 'bg-amber-500/35',
    playhead: 'bg-amber-600 dark:bg-amber-300',
    ringOuter: 'border-amber-500/55 dark:border-amber-400/55',
    ringInner: 'border-teal-500/35 dark:border-teal-400/35',
    lensGradient: 'bg-gradient-to-br from-amber-600 to-teal-600',
    activeCardBorder: 'border-amber-500/55 bg-[var(--bg-surface)] shadow-xs',
    activeIconGradient: 'bg-gradient-to-br from-amber-600 to-teal-600 text-white',
    activeSendIcon: 'translate-x-0 text-amber-600 dark:text-amber-400',
    indicatorGradient: 'bg-gradient-to-r from-amber-600 to-teal-600',
    switcherActive: 'bg-[var(--bg-card)] text-amber-700 dark:text-amber-300 shadow-xs',
  },
  emerald: {
    id: 'emerald',
    label: 'Broadcast Teal',
    swatchClass: 'bg-emerald-500',
    svgStart: '#059669',
    svgEnd: '#0284c7',
    glowTop: 'bg-emerald-500/12 dark:bg-emerald-500/16',
    glowBottom: 'bg-sky-500/10 dark:bg-sky-500/16',
    headerIcon: 'text-emerald-600 dark:text-emerald-400',
    sourceBadgeBg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    sourceSpecText: 'text-emerald-700 dark:text-emerald-300',
    waveformGradient: 'bg-gradient-to-t from-emerald-600 to-sky-500',
    trackPrimaryA: 'bg-emerald-500/40 dark:bg-emerald-500/45',
    trackPrimaryB: 'bg-sky-500/35 dark:bg-sky-500/45',
    trackPrimaryC: 'bg-emerald-500/25 dark:bg-emerald-500/30',
    trackSecondaryA: 'bg-sky-500/45',
    trackSecondaryB: 'bg-emerald-500/35',
    playhead: 'bg-emerald-600 dark:bg-emerald-300',
    ringOuter: 'border-emerald-500/55 dark:border-emerald-400/55',
    ringInner: 'border-sky-500/35 dark:border-sky-400/35',
    lensGradient: 'bg-gradient-to-br from-emerald-600 to-sky-600',
    activeCardBorder: 'border-emerald-500/55 bg-[var(--bg-surface)] shadow-xs',
    activeIconGradient: 'bg-gradient-to-br from-emerald-600 to-sky-600 text-white',
    activeSendIcon: 'translate-x-0 text-emerald-600 dark:text-emerald-400',
    indicatorGradient: 'bg-gradient-to-r from-emerald-600 to-sky-600',
    switcherActive: 'bg-[var(--bg-card)] text-emerald-700 dark:text-emerald-300 shadow-xs',
  },
  crimson: {
    id: 'crimson',
    label: 'Editorial Film',
    swatchClass: 'bg-rose-500',
    svgStart: '#e11d48',
    svgEnd: '#d97706',
    glowTop: 'bg-rose-500/12 dark:bg-rose-500/16',
    glowBottom: 'bg-amber-500/10 dark:bg-amber-500/15',
    headerIcon: 'text-rose-600 dark:text-rose-400',
    sourceBadgeBg: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    sourceSpecText: 'text-rose-700 dark:text-rose-300',
    waveformGradient: 'bg-gradient-to-t from-rose-600 to-amber-500',
    trackPrimaryA: 'bg-rose-500/40 dark:bg-rose-500/45',
    trackPrimaryB: 'bg-amber-500/35 dark:bg-amber-500/45',
    trackPrimaryC: 'bg-rose-500/25 dark:bg-rose-500/30',
    trackSecondaryA: 'bg-amber-500/45',
    trackSecondaryB: 'bg-rose-500/35',
    playhead: 'bg-rose-600 dark:bg-rose-300',
    ringOuter: 'border-rose-500/55 dark:border-rose-400/55',
    ringInner: 'border-amber-500/35 dark:border-amber-400/35',
    lensGradient: 'bg-gradient-to-br from-rose-600 to-amber-600',
    activeCardBorder: 'border-rose-500/55 bg-[var(--bg-surface)] shadow-xs',
    activeIconGradient: 'bg-gradient-to-br from-rose-600 to-amber-600 text-white',
    activeSendIcon: 'translate-x-0 text-rose-600 dark:text-rose-400',
    indicatorGradient: 'bg-gradient-to-r from-rose-600 to-amber-600',
    switcherActive: 'bg-[var(--bg-card)] text-rose-700 dark:text-rose-300 shadow-xs',
  },
};

const PALETTE_ORDER: StudioPaletteId[] = ['amber', 'emerald', 'crimson'];

const OUTPUT_STAGES: OutputStage[] = [
  {
    id: 'reels',
    title: 'Reels & Shorts',
    spec: '9:16 · 30s',
    detail: 'Hook variants, paced voiceover script & burned-in captions',
    icon: Film,
  },
  {
    id: 'thumbnails',
    title: 'Thumbnail Canvas',
    spec: '16:9 · 1280×720',
    detail: 'AI art direction, frame extraction & Brand Kit overlays',
    icon: ImageIcon,
  },
  {
    id: 'distribution',
    title: 'Publish & Analytics',
    spec: '4 Channels',
    detail: 'Official OAuth scheduling, reach tracking & quality audit',
    icon: BarChart3,
  },
];

const WAVEFORM_BARS = [
  0.38, 0.72, 0.54, 0.92, 0.65, 0.84, 0.44, 0.96, 0.61, 0.78, 0.48, 0.86, 0.58,
  0.74, 0.42, 0.68,
];

function readSavedPalette(): StudioPaletteId {
  if (typeof window === 'undefined') return 'amber';
  try {
    const saved = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    if (saved === 'amber' || saved === 'emerald' || saved === 'crimson') {
      return saved;
    }
  } catch {
    // Ignore storage read errors
  }
  return 'amber';
}

export function StudioPipelineDiagram() {
  const prefersReducedMotion = useReducedMotion();
  const [activeStage, setActiveStage] = useState<StudioOutputStageId>('reels');
  const [paletteId, setPaletteId] = useState<StudioPaletteId>(readSavedPalette);
  const [isPaused, setIsPaused] = useState(false);

  const palette = STUDIO_PALETTES[paletteId];
  const gradientId = `cp-flow-grad-${palette.id}`;

  const handleSelectPalette = (nextId: StudioPaletteId) => {
    setPaletteId(nextId);
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, nextId);
    } catch {
      // Ignore storage write errors
    }
  };

  useEffect(() => {
    if (prefersReducedMotion || isPaused) return;
    const order: StudioOutputStageId[] = ['reels', 'thumbnails', 'distribution'];
    const timer = window.setInterval(() => {
      setActiveStage((prev) => {
        const idx = order.indexOf(prev);
        return order[(idx + 1) % order.length];
      });
    }, 3400);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion, isPaused]);

  const currentStage =
    OUTPUT_STAGES.find((s) => s.id === activeStage) ?? OUTPUT_STAGES[0];

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="relative overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] shadow-[var(--shadow-popover)] transition-colors duration-200"
    >
      {/* Subtle architectural studio grid background (adapts to light & dark theme) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-65 dark:opacity-35"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--border-subtle) 1px, transparent 1px), linear-gradient(to bottom, var(--border-subtle) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Cinema viewfinder framing brackets */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2.5 left-2.5 h-3 w-3 border-t border-l border-[var(--border-strong)]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2.5 right-2.5 h-3 w-3 border-t border-r border-[var(--border-strong)]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2.5 left-2.5 h-3 w-3 border-b border-l border-[var(--border-strong)]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2.5 right-2.5 h-3 w-3 border-b border-r border-[var(--border-strong)]"
      />

      {/* Ambient studio radial glow */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-16 left-1/2 h-56 w-80 -translate-x-1/2 rounded-full blur-3xl transition-colors duration-300 ${palette.glowTop}`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -bottom-16 right-8 h-48 w-64 rounded-full blur-3xl transition-colors duration-300 ${palette.glowBottom}`}
      />

      <div className="relative z-10 p-4 sm:p-6">
        {/* Studio Frame Header + Palette Switcher */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--border-default)] pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Clapperboard
              className={`h-4 w-4 shrink-0 transition-colors ${palette.headerIcon}`}
            />
            <span className="truncate font-display text-xs font-semibold tracking-tight text-[var(--text-primary)] sm:text-sm">
              Autonomous Video &amp; Content Pipeline
            </span>
          </div>

          <div
            role="group"
            aria-label="Diagram color theme"
            className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5 shrink-0"
          >
            {PALETTE_ORDER.map((id) => {
              const option = STUDIO_PALETTES[id];
              const selected = id === paletteId;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectPalette(id)}
                  aria-label={`${option.label} theme`}
                  aria-pressed={selected}
                  title={option.label}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] ${
                    selected
                      ? palette.switcherActive
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${option.swatchClass}`}
                  />
                  <span className="hidden sm:inline">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main 3-Zone Studio Schematic */}
        <div className="relative grid grid-cols-1 items-center gap-4 md:grid-cols-[1.05fr_auto_1.15fr] md:gap-2">
          {/* SVG Signal Flow Connectors (Desktop) */}
          <svg
            aria-hidden="true"
            viewBox="0 0 600 260"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 hidden h-full w-full md:block"
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={palette.svgStart} stopOpacity="0.9" />
                <stop offset="100%" stopColor={palette.svgEnd} stopOpacity="0.95" />
              </linearGradient>
            </defs>

            {/* Left source -> Center Lens */}
            <path
              d="M 195 130 C 245 130, 245 130, 290 130"
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth="1.5"
            />
            {!prefersReducedMotion && (
              <motion.path
                d="M 195 130 C 245 130, 245 130, 290 130"
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="24 44"
                animate={{ strokeDashoffset: [68, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
              />
            )}

            {/* Center Lens -> Top Output (Reels & Shorts) */}
            <path
              d="M 325 130 C 370 130, 365 44, 410 44"
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={activeStage === 'reels' ? '2' : '1.25'}
              opacity={activeStage === 'reels' ? 0.95 : 0.45}
            />
            {!prefersReducedMotion && activeStage === 'reels' && (
              <motion.path
                d="M 325 130 C 370 130, 365 44, 410 44"
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="28 52"
                animate={{ strokeDashoffset: [80, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              />
            )}

            {/* Center Lens -> Middle Output (Thumbnail Canvas) */}
            <path
              d="M 325 130 C 365 130, 375 130, 410 130"
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={activeStage === 'thumbnails' ? '2' : '1.25'}
              opacity={activeStage === 'thumbnails' ? 0.95 : 0.45}
            />
            {!prefersReducedMotion && activeStage === 'thumbnails' && (
              <motion.path
                d="M 325 130 C 365 130, 375 130, 410 130"
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="24 48"
                animate={{ strokeDashoffset: [72, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              />
            )}

            {/* Center Lens -> Bottom Output (Publish & Analytics) */}
            <path
              d="M 325 130 C 370 130, 365 216, 410 216"
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={activeStage === 'distribution' ? '2' : '1.25'}
              opacity={activeStage === 'distribution' ? 0.95 : 0.45}
            />
            {!prefersReducedMotion && activeStage === 'distribution' && (
              <motion.path
                d="M 325 130 C 370 130, 365 216, 410 216"
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="28 52"
                animate={{ strokeDashoffset: [80, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              />
            )}
          </svg>

          {/* Zone 1: Master Source & NLE Timeline */}
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${palette.sourceBadgeBg}`}
                >
                  <Mic className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                    Master Source
                  </p>
                  <p className="font-mono text-[10px] text-[var(--text-muted)]">
                    Video · Audio · Script
                  </p>
                </div>
              </div>
              <span
                className={`font-mono text-[10px] tabular-nums ${palette.sourceSpecText}`}
              >
                4K / SRT
              </span>
            </div>

            {/* Animated Studio Audio Waveform */}
            <div
              aria-hidden="true"
              className="mt-3 flex h-11 items-center justify-between gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-2"
            >
              {WAVEFORM_BARS.map((heightRatio, idx) => (
                <motion.span
                  key={idx}
                  className={`w-1 rounded-full ${palette.waveformGradient}`}
                  style={{
                    height: `${Math.round(heightRatio * 100)}%`,
                    transformOrigin: 'center',
                  }}
                  animate={
                    prefersReducedMotion
                      ? undefined
                      : {
                          scaleY: [1, 0.45 + (idx % 3) * 0.25, 1],
                        }
                  }
                  transition={
                    prefersReducedMotion
                      ? undefined
                      : {
                          duration: 1.6 + (idx % 4) * 0.22,
                          repeat: Infinity,
                          ease: 'easeInOut',
                          delay: idx * 0.06,
                        }
                  }
                />
              ))}
            </div>

            {/* Mini NLE Timeline Tracks + Animated Playhead */}
            <div className="relative mt-2.5 space-y-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-2">
              <div className="flex items-center gap-1">
                <div className={`h-2.5 w-1/3 rounded-xs ${palette.trackPrimaryA}`} />
                <div className={`h-2.5 w-1/2 rounded-xs ${palette.trackPrimaryB}`} />
                <div className={`h-2.5 flex-1 rounded-xs ${palette.trackPrimaryC}`} />
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`h-1.5 w-1/4 rounded-xs ${palette.trackSecondaryA}`} />
                <div className={`h-1.5 w-2/5 rounded-xs ${palette.trackSecondaryB}`} />
                <div className={`h-1.5 flex-1 rounded-xs ${palette.trackSecondaryA}`} />
              </div>

              {!prefersReducedMotion && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-1 left-2 right-2 overflow-hidden"
                >
                  <motion.div
                    className="h-full w-full"
                    animate={{ x: ['0%', '96%', '0%'] }}
                    transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <div
                      className={`h-full w-0.5 rounded-full shadow-xs ${palette.playhead}`}
                    />
                  </motion.div>
                </div>
              )}
            </div>
          </motion.div>

          {/* Zone 2: Central AI Video Studio Engine Lens */}
          <div className="relative z-10 flex flex-col items-center justify-center py-1 md:px-2">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <motion.div
                aria-hidden="true"
                className={`absolute inset-0 rounded-full border border-dashed transition-colors ${palette.ringOuter}`}
                animate={prefersReducedMotion ? undefined : { rotate: 360 }}
                transition={
                  prefersReducedMotion
                    ? undefined
                    : { duration: 18, repeat: Infinity, ease: 'linear' }
                }
              />
              <motion.div
                aria-hidden="true"
                className={`absolute inset-1.5 rounded-full border transition-colors ${palette.ringInner}`}
                animate={prefersReducedMotion ? undefined : { rotate: -360 }}
                transition={
                  prefersReducedMotion
                    ? undefined
                    : { duration: 12, repeat: Infinity, ease: 'linear' }
                }
              />
              <div
                className={`relative flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-md transition-colors ${palette.lensGradient}`}
              >
                <Aperture className="h-5 w-5" />
              </div>
            </div>
            <span className="mt-1.5 font-mono text-[10px] font-semibold text-[var(--text-muted)] whitespace-nowrap">
              Studio Engine
            </span>
          </div>

          {/* Zone 3: Multi-Platform Output Deliverables */}
          <div className="relative z-10 space-y-2.5">
            {OUTPUT_STAGES.map((stage, idx) => {
              const Icon = stage.icon;
              const isActive = activeStage === stage.id;
              return (
                <motion.button
                  key={stage.id}
                  type="button"
                  onClick={() => {
                    setActiveStage(stage.id);
                    setIsPaused(true);
                  }}
                  initial={prefersReducedMotion ? false : { opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    duration: 0.35,
                    delay: idx * 0.08,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className={`flex w-full items-center justify-between gap-2.5 rounded-xl border p-2.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] ${
                    isActive
                      ? palette.activeCardBorder
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)]/55 hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
                        isActive
                          ? palette.activeIconGradient
                          : 'bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border-default)]'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                        {stage.title}
                      </p>
                      <p className="truncate text-[11px] text-[var(--text-muted)]">
                        {stage.spec}
                      </p>
                    </div>
                  </div>
                  <Send
                    className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
                      isActive
                        ? palette.activeSendIcon
                        : '-translate-x-0.5 text-[var(--text-muted)]/50'
                    }`}
                  />
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Interactive Stage Inspector Footer */}
        <div className="mt-5 flex flex-col justify-between gap-2 border-t border-[var(--border-default)] pt-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 min-w-0 text-xs text-[var(--text-secondary)]">
            <Layers
              className={`h-3.5 w-3.5 shrink-0 transition-colors ${palette.headerIcon}`}
            />
            <span className="truncate">{currentStage.detail}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
              1 Input · 4 Outputs
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {OUTPUT_STAGES.map((stage) => {
                const selected = stage.id === activeStage;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    onClick={() => {
                      setActiveStage(stage.id);
                      setIsPaused(true);
                    }}
                    aria-label={`Highlight ${stage.title}`}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      selected
                        ? `w-6 ${palette.indicatorGradient}`
                        : 'w-2 bg-[var(--border-strong)] hover:bg-[var(--text-muted)]'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
