import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Palette,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Upload,
} from 'lucide-react';
import type {
  BrandKitConfig,
  BrandTemplate,
  CaptionSpacing,
  EmojiDensity,
} from '../types/brandKit';
import type { Platform, Tone } from '../types/creator';
import {
  deleteFirebaseStorageAsset,
  uploadBrandLogo,
} from '../services/storageService';

interface BrandKitViewProps {
  userId: string;
  brandKit: BrandKitConfig;
  isSaving: boolean;
  onSaveBrandKit: (updated: BrandKitConfig) => Promise<void>;
  onApplyTemplateToStudio: (template: BrandTemplate) => void;
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

const FONT_OPTIONS = [
  'Plus Jakarta Sans',
  'DM Sans',
  'Manrope',
  'Outfit',
  'Bricolage Grotesque',
  'Playfair Display',
  'Oswald',
  'Lora',
];

const PLATFORMS: Platform[] = ['Instagram', 'YouTube', 'Facebook', 'LinkedIn'];
const TONES: Tone[] = [
  'Educational',
  'Professional',
  'Casual',
  'Inspirational',
  'Funny',
];

export function BrandKitView({
  userId,
  brandKit,
  isSaving,
  onSaveBrandKit,
  onApplyTemplateToStudio,
  onNotify,
}: BrandKitViewProps) {
  const [draft, setDraft] = useState<BrandKitConfig>(brandKit);
  const [newCta, setNewCta] = useState('');
  const [logoUploadProgress, setLogoUploadProgress] = useState<number | null>(
    null
  );
  const [newTemplate, setNewTemplate] = useState<{
    name: string;
    platform: Platform;
    tone: Tone;
    hookFormula: string;
    structureNotes: string;
    defaultCta: string;
  }>({
    name: '',
    platform: 'Instagram',
    tone: 'Educational',
    hookFormula: '',
    structureNotes: '',
    defaultCta: '',
  });
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(brandKit);
  }, [brandKit]);

  const handleLogoFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setLogoUploadProgress(5);
    try {
      const uploaded = await uploadBrandLogo(userId, file, (pct) => {
        setLogoUploadProgress(pct);
      });
      const next: BrandKitConfig = {
        ...draft,
        logoUrl: uploaded.downloadUrl,
        logoStoragePath: uploaded.storagePath,
      };
      setDraft(next);
      await onSaveBrandKit(next);
      onNotify(
        'Brand logo uploaded',
        'Logo saved to Firebase Storage and linked to your Brand Kit.',
        'success'
      );
    } catch (err) {
      onNotify(
        'Logo upload failed',
        err instanceof Error
          ? err.message
          : 'Check Firebase Storage rules (storage.rules) in Firebase Console.',
        'error'
      );
    } finally {
      setLogoUploadProgress(null);
    }
  };

  const handleRemoveLogo = async () => {
    const oldPath = draft.logoStoragePath;
    const next: BrandKitConfig = {
      ...draft,
      logoUrl: undefined,
      logoStoragePath: undefined,
    };
    setDraft(next);
    if (oldPath) {
      await deleteFirebaseStorageAsset(oldPath).catch(() => {});
    }
    await onSaveBrandKit(next);
    onNotify('Brand logo removed', undefined, 'info');
  };

  const handleAddCta = () => {
    const clean = newCta.trim();
    if (!clean) return;
    if (draft.preferredCtas.length >= 12) {
      onNotify('CTA limit reached', 'Maximum 12 preferred CTAs allowed.', 'error');
      return;
    }
    setDraft((prev) => ({
      ...prev,
      preferredCtas: [...prev.preferredCtas, clean],
    }));
    setNewCta('');
  };

  const handleRemoveCta = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      preferredCtas: prev.preferredCtas.filter((_, i) => i !== idx),
    }));
  };

  const handleAddTemplate = () => {
    if (!newTemplate.name.trim()) {
      onNotify('Template name required', 'Give your brand template a clear name.', 'error');
      return;
    }
    if (draft.templates.length >= 15) {
      onNotify('Template limit reached', 'Maximum 15 templates allowed.', 'error');
      return;
    }
    const created: BrandTemplate = {
      id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newTemplate.name.trim(),
      platform: newTemplate.platform,
      tone: newTemplate.tone,
      hookFormula: newTemplate.hookFormula.trim(),
      structureNotes: newTemplate.structureNotes.trim(),
      defaultCta: newTemplate.defaultCta.trim(),
    };
    setDraft((prev) => ({
      ...prev,
      templates: [created, ...prev.templates],
    }));
    setNewTemplate({
      name: '',
      platform: 'Instagram',
      tone: 'Educational',
      hookFormula: '',
      structureNotes: '',
      defaultCta: '',
    });
    onNotify('Template added', 'Click Save Brand Kit to persist changes to Firestore.', 'info');
  };

  const handleDeleteTemplate = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      templates: prev.templates.filter((t) => t.id !== id),
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveBrandKit(draft);
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Header Banner */}
      <section className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
            AI Brand Kit
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Configure your logo, palette, typography, brand voice, CTAs, and reusable templates. Active preferences automatically shape Content Studio AI outputs.
          </p>
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-violet-500 hover:to-blue-500 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          <span>{isSaving ? 'Saving...' : 'Save Brand Kit'}</span>
        </button>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left Column: Identity, Logo, Colors, Typography */}
        <div className="space-y-6 xl:col-span-6">
          {/* Identity & Logo Upload */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5">
            <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] pb-3">
              <ImagePlus className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Brand Identity &amp; Logo
              </h2>
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
                {draft.logoUrl ? (
                  <img
                    src={draft.logoUrl}
                    alt={`${draft.brandName} logo`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain p-1.5"
                  />
                ) : (
                  <span
                    className="font-display text-xl font-bold"
                    style={{ color: draft.colors.primary }}
                  >
                    {(draft.brandName || 'CP').slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>

              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      void handleLogoFileSelected(file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={logoUploadProgress !== null}
                    className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:border-violet-500/50"
                  >
                    <Upload className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                    <span>
                      {logoUploadProgress !== null
                        ? `Uploading ${logoUploadProgress}%`
                        : draft.logoUrl
                        ? 'Replace Logo'
                        : 'Upload Logo'}
                    </span>
                  </button>
                  {draft.logoUrl && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveLogo()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  PNG, JPG, WebP, or SVG up to 5 MB · Stored in Firebase Storage
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Brand Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={draft.brandName}
                  onChange={(e) =>
                    setDraft({ ...draft, brandName: e.target.value })
                  }
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Brand Handle
                </label>
                <input
                  type="text"
                  maxLength={80}
                  value={draft.brandHandle}
                  onChange={(e) =>
                    setDraft({ ...draft, brandHandle: e.target.value })
                  }
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)]">
                Tagline
              </label>
              <input
                type="text"
                maxLength={240}
                value={draft.tagline}
                onChange={(e) => setDraft({ ...draft, tagline: e.target.value })}
                placeholder="One-sentence positioning statement"
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              />
            </div>
          </section>

          {/* Colors & Typography */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5">
            <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] pb-3">
              <Palette className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Brand Palette &amp; Typography
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                [
                  { key: 'primary', label: 'Primary' },
                  { key: 'secondary', label: 'Secondary' },
                  { key: 'accent', label: 'Accent' },
                  { key: 'background', label: 'Canvas' },
                  { key: 'text', label: 'Ink' },
                ] as const
              ).map((item) => (
                <div
                  key={item.key}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5"
                >
                  <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                    {item.label}
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="color"
                      value={draft.colors[item.key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          colors: { ...draft.colors, [item.key]: e.target.value },
                        })
                      }
                      aria-label={`${item.label} color`}
                      className="h-7 w-7 cursor-pointer rounded border border-[var(--border-default)] bg-transparent p-0"
                    />
                    <span className="font-mono text-[11px] uppercase text-[var(--text-primary)]">
                      {draft.colors[item.key]}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                  <TypeIcon className="h-3.5 w-3.5" />
                  <span>Heading Font</span>
                </label>
                <select
                  value={draft.typography.headingFont}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      typography: {
                        ...draft.typography,
                        headingFont: e.target.value,
                      },
                    })
                  }
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                  <TypeIcon className="h-3.5 w-3.5" />
                  <span>Body Font</span>
                </label>
                <select
                  value={draft.typography.bodyFont}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      typography: {
                        ...draft.typography,
                        bodyFont: e.target.value,
                      },
                    })
                  }
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Live Brand Kit Card Specimen */}
            <div
              className="rounded-xl border border-[var(--border-default)] p-5 transition-colors"
              style={{
                backgroundColor: draft.colors.background,
                color: draft.colors.text,
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {draft.logoUrl && (
                    <img
                      src={draft.logoUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-7 w-7 rounded object-contain bg-white/10 p-0.5"
                    />
                  )}
                  <span
                    className="text-xs font-semibold opacity-80"
                    style={{ fontFamily: draft.typography.bodyFont }}
                  >
                    {draft.brandHandle || '@brand'}
                  </span>
                </div>
                <span
                  className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-white"
                  style={{ backgroundColor: draft.colors.primary }}
                >
                  Primary Accent
                </span>
              </div>
              <p
                className="mt-3 text-lg font-bold tracking-tight"
                style={{ fontFamily: draft.typography.headingFont }}
              >
                {draft.brandName} · Visual &amp; Editorial Preview
              </p>
              <p
                className="mt-1 text-xs opacity-85"
                style={{ fontFamily: draft.typography.bodyFont }}
              >
                {draft.tagline ||
                  'Your typography and color palette apply to studio visuals and generated campaign assets.'}
              </p>
            </div>
          </section>
        </div>

        {/* Right Column: Brand Voice, CTAs, Caption Style, Templates */}
        <div className="space-y-6 xl:col-span-6">
          {/* Voice, CTAs & Caption Rules */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5">
            <div className="flex items-center gap-2.5 border-b border-[var(--border-default)] pb-3">
              <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Brand Voice, CTAs &amp; Caption Rules
              </h2>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)]">
                Brand Voice Prompt (auto-applied in Content Studio)
              </label>
              <textarea
                rows={3}
                maxLength={600}
                value={draft.brandVoice}
                onChange={(e) =>
                  setDraft({ ...draft, brandVoice: e.target.value })
                }
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              />
            </div>

            {/* Preferred CTAs */}
            <div className="space-y-2.5">
              <label className="block text-xs font-medium text-[var(--text-muted)]">
                Preferred CTAs ({draft.preferredCtas.length}/12)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={280}
                  value={newCta}
                  onChange={(e) => setNewCta(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCta();
                    }
                  }}
                  placeholder="Add a preferred CTA (e.g., Save this for your next upload)"
                  className="flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddCta}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-violet-500/50 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add</span>
                </button>
              </div>

              <div className="space-y-2">
                {draft.preferredCtas.map((cta, idx) => (
                  <div
                    key={`${cta}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs text-[var(--text-primary)]"
                  >
                    <span className="truncate">{cta}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCta(idx)}
                      aria-label="Remove CTA"
                      className="text-[var(--text-muted)] hover:text-rose-500 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Caption Style */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-[var(--border-default)] pt-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Emoji Density
                </label>
                <select
                  value={draft.captionStyle.emojiDensity}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      captionStyle: {
                        ...draft.captionStyle,
                        emojiDensity: e.target.value as EmojiDensity,
                      },
                    })
                  }
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  <option value="minimal">Minimal (clean editorial)</option>
                  <option value="balanced">Balanced (subtle emphasis)</option>
                  <option value="expressive">Expressive (high energy)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Caption Spacing
                </label>
                <select
                  value={draft.captionStyle.lineSpacing}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      captionStyle: {
                        ...draft.captionStyle,
                        lineSpacing: e.target.value as CaptionSpacing,
                      },
                    })
                  }
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  <option value="airy">Airy (short scannable breaks)</option>
                  <option value="compact">Compact (dense paragraphs)</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Signature Footer (optional sign-off appended to captions)
                </label>
                <input
                  type="text"
                  maxLength={240}
                  value={draft.captionStyle.signatureFooter}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      captionStyle: {
                        ...draft.captionStyle,
                        signatureFooter: e.target.value,
                      },
                    })
                  }
                  placeholder="e.g., New creator systems every Tuesday · @creatorpilot"
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                />
              </div>

              <label className="sm:col-span-2 flex items-center gap-2.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.captionStyle.includeHashtagsInCaption}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      captionStyle: {
                        ...draft.captionStyle,
                        includeHashtagsInCaption: e.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4 rounded border-[var(--border-default)] text-violet-600 focus:ring-violet-500"
                />
                <span>Include brand-relevant hashtags inside generated captions</span>
              </label>
            </div>
          </section>

          {/* Brand Templates */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-default)] pb-3">
              <div className="flex items-center gap-2.5">
                <LayoutTemplate className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  Brand Content Templates
                </h2>
              </div>
              <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
                {draft.templates.length}/15
              </span>
            </div>

            <div className="space-y-3">
              {draft.templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        {tpl.name}
                      </h3>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {tpl.platform} · {tpl.tone}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onApplyTemplateToStudio(tpl)}
                        className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-500 whitespace-nowrap"
                      >
                        <Check className="h-3 w-3" />
                        <span>Use in Studio</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        aria-label="Delete template"
                        className="rounded-lg border border-[var(--border-default)] p-1.5 text-[var(--text-muted)] hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {tpl.hookFormula && (
                    <p className="text-xs text-[var(--text-secondary)]">
                      Hook: {tpl.hookFormula}
                    </p>
                  )}
                  {tpl.structureNotes && (
                    <p className="text-xs text-[var(--text-muted)]">
                      {tpl.structureNotes}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Add New Brand Template */}
            <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-4 space-y-3">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                Create New Brand Template
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  type="text"
                  maxLength={100}
                  value={newTemplate.name}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, name: e.target.value })
                  }
                  placeholder="Template name"
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                />
                <select
                  value={newTemplate.platform}
                  onChange={(e) =>
                    setNewTemplate({
                      ...newTemplate,
                      platform: e.target.value as Platform,
                    })
                  }
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select
                  value={newTemplate.tone}
                  onChange={(e) =>
                    setNewTemplate({
                      ...newTemplate,
                      tone: e.target.value as Tone,
                    })
                  }
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                maxLength={300}
                value={newTemplate.hookFormula}
                onChange={(e) =>
                  setNewTemplate({ ...newTemplate, hookFormula: e.target.value })
                }
                placeholder="Hook formula (optional)"
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              />
              <textarea
                rows={2}
                maxLength={600}
                value={newTemplate.structureNotes}
                onChange={(e) =>
                  setNewTemplate({
                    ...newTemplate,
                    structureNotes: e.target.value,
                  })
                }
                placeholder="Structure notes (pacing, sections, visual flow)"
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  maxLength={280}
                  value={newTemplate.defaultCta}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, defaultCta: e.target.value })
                  }
                  placeholder="Default CTA"
                  className="flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddTemplate}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:border-violet-500/50 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Template</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}
