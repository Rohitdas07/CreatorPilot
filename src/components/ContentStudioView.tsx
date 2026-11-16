import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileAudio,
  FileText,
  FileVideo,
  FolderCheck,
  Loader2,
  Palette,
  Sparkles,
  Trash2,
  Type as TypeIcon,
  Upload,
  X,
} from 'lucide-react';
import type { BrandKitConfig } from '../types/brandKit';
import type {
  ContentLanguage,
  GeneratedContent,
  InputMode,
  Platform,
  Tone,
  UploadedMediaInfo,
  VideoDuration,
} from '../types/creator';
import { SAMPLE_PROMPTS } from '../utils/sampleGenerator';
import {
  GeneratedResultsGrid,
  type StageSocialPostInput,
} from './GeneratedResultsGrid';

interface ContentStudioViewProps {
  sourceText: string;
  onChangeSourceText: (text: string) => void;
  platform: Platform;
  onChangePlatform: (platform: Platform) => void;
  language: ContentLanguage;
  onChangeLanguage: (language: ContentLanguage) => void;
  tone: Tone;
  onChangeTone: (tone: Tone) => void;
  duration: VideoDuration;
  onChangeDuration: (duration: VideoDuration) => void;
  niche: string;
  onChangeNiche: (niche: string) => void;
  brandVoice: string;
  onChangeBrandVoice: (voice: string) => void;
  mediaInfo: UploadedMediaInfo | null;
  onChangeMediaInfo: (info: UploadedMediaInfo | null) => void;
  generatedResult: GeneratedContent | null;
  onUpdateResult: (updated: GeneratedContent) => void;
  isGenerating: boolean;
  aiError: string | null;
  onDismissAiError: () => void;
  activeProject: { id: string; title: string } | null;
  onDetachActiveProject: () => void;
  onGenerate: () => void;
  onCopyText: (text: string, label: string) => void;
  onSaveProject: (title: string, mode: 'new' | 'update') => void;
  onDownload: () => void;
  onClearAll: () => void;
  onStageSocialPost?: (draft: StageSocialPostInput) => Promise<void>;
  brandKit?: BrandKitConfig;
  applyBrandKit?: boolean;
  onToggleApplyBrandKit?: (apply: boolean) => void;
  activeBrandTemplateId?: string;
  onSelectBrandTemplate?: (templateId: string) => void;
  onOpenBrandKit?: () => void;
  onCreateThumbnail?: () => void;
  onCreateAiVideo?: () => void;
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

const PLATFORMS: Platform[] = ['Instagram', 'YouTube', 'Facebook', 'LinkedIn'];
const LANGUAGES: ContentLanguage[] = [
  'English',
  'Hindi',
  'Bengali',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Japanese',
];
const TONES: Tone[] = [
  'Professional',
  'Funny',
  'Educational',
  'Inspirational',
  'Casual',
];
const DURATIONS: VideoDuration[] = ['15 sec', '30 sec', '60 sec'];

const INPUT_TABS: Array<{ id: InputMode; label: string; icon: typeof TypeIcon }> = [
  { id: 'paste', label: 'Paste Content or Script', icon: TypeIcon },
  { id: 'video', label: 'Upload Video', icon: FileVideo },
  { id: 'audio', label: 'Upload Audio', icon: FileAudio },
  { id: 'text', label: 'Upload Text File', icon: FileText },
];

const MAX_INLINE_MEDIA_BYTES = 14 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ContentStudioView({
  sourceText,
  onChangeSourceText,
  platform,
  onChangePlatform,
  language,
  onChangeLanguage,
  tone,
  onChangeTone,
  duration,
  onChangeDuration,
  niche,
  onChangeNiche,
  brandVoice,
  onChangeBrandVoice,
  mediaInfo,
  onChangeMediaInfo,
  generatedResult,
  onUpdateResult,
  isGenerating,
  aiError,
  onDismissAiError,
  activeProject,
  onDetachActiveProject,
  onGenerate,
  onCopyText,
  onSaveProject,
  onDownload,
  onClearAll,
  onStageSocialPost,
  brandKit,
  applyBrandKit = true,
  onToggleApplyBrandKit,
  activeBrandTemplateId = '',
  onSelectBrandTemplate,
  onOpenBrandKit,
  onCreateThumbnail,
  onCreateAiVideo,
  onNotify,
}: ContentStudioViewProps) {
  const [inputMode, setInputMode] = useState<InputMode>('paste');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!mediaInfo && previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [mediaInfo, previewUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const acceptForMode =
    inputMode === 'video'
      ? 'video/*'
      : inputMode === 'audio'
      ? 'audio/*'
      : '.txt,.md,.srt,.vtt,.csv';

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    if (
      inputMode === 'text' ||
      file.type.startsWith('text/') ||
      /\.(txt|md|srt|vtt|csv)$/i.test(file.name)
    ) {
      setUploadProgress(25);
      try {
        const text = await file.text();
        setUploadProgress(100);
        onChangeSourceText(text);
        onChangeMediaInfo({
          name: file.name,
          size: file.size,
          type: file.type || 'text/plain',
          kind: 'text',
        });
        onNotify(
          'Text file imported',
          `Loaded ${file.name} into the script editor.`,
          'success'
        );
      } catch {
        onNotify(
          'Could not read file',
          'Please try another UTF-8 text or subtitle file.',
          'error'
        );
      } finally {
        window.setTimeout(() => setUploadProgress(null), 500);
      }
      return;
    }

    const kind =
      file.type.startsWith('video/') || inputMode === 'video' ? 'video' : 'audio';

    if (file.size > MAX_INLINE_MEDIA_BYTES) {
      onNotify(
        'Media file exceeds 14 MB inline limit',
        'Please attach a smaller audio/video clip (under 14 MB) or paste the transcript text directly.',
        'error'
      );
      return;
    }

    setUploadProgress(5);
    let base64Data: string | undefined;
    try {
      base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onprogress = (evt) => {
          if (evt.lengthComputable && evt.total > 0) {
            setUploadProgress(Math.min(95, Math.round((evt.loaded / evt.total) * 100)));
          }
        };
        reader.onload = () => {
          setUploadProgress(100);
          const res = String(reader.result || '');
          const idx = res.indexOf(',');
          resolve(idx >= 0 ? res.slice(idx + 1) : res);
        };
        reader.onerror = () => reject(new Error('File read error'));
        reader.readAsDataURL(file);
      });
    } catch {
      setUploadProgress(null);
      onNotify(
        'Could not read media file',
        'Please try another audio or video file.',
        'error'
      );
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    onChangeMediaInfo({
      name: file.name,
      size: file.size,
      type: file.type || (kind === 'video' ? 'video/mp4' : 'audio/mpeg'),
      kind,
      base64Data,
    });

    onNotify(
      `${kind === 'video' ? 'Video' : 'Audio'} attached`,
      `${file.name} (${formatBytes(file.size)}) is ready for Gemini AI analysis.`,
      'success'
    );
    window.setTimeout(() => setUploadProgress(null), 600);
  };

  const defaultProjectTitle = activeProject?.title
    ? activeProject.title
    : sourceText.trim()
    ? sourceText.trim().split(/[.!?\n]/)[0].slice(0, 48)
    : mediaInfo?.name || `${platform} ${tone} Campaign`;

  return (
    <div className="space-y-8">
      {/* Studio Input Card */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)] sm:p-7">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-default)] pb-5 sm:flex-row sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
                Content Creation Studio
              </h1>
              {activeProject && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-700 dark:text-violet-200">
                  <FolderCheck className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                  <span className="max-w-[200px] truncate">{activeProject.title}</span>
                  <button
                    type="button"
                    onClick={onDetachActiveProject}
                    aria-label="Detach active project"
                    className="ml-0.5 rounded p-0.5 text-violet-600 dark:text-violet-300 hover:bg-violet-500/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Add a script, transcript, or media file and tailor your multi-platform output.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {SAMPLE_PROMPTS.map((sample) => (
              <button
                key={sample.id}
                type="button"
                onClick={() => {
                  onChangeSourceText(sample.text);
                  onChangePlatform(sample.platform);
                  onChangeTone(sample.tone);
                  onChangeDuration(sample.duration);
                  setInputMode('paste');
                  onDismissAiError();
                  onNotify(
                    'Sample prompt loaded',
                    `Loaded "${sample.label}" into editor. Click Generate Content to run Gemini AI.`,
                    'info'
                  );
                }}
                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-violet-500/40 hover:text-[var(--text-primary)] whitespace-nowrap"
              >
                Sample: {sample.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input Mode Tabs */}
        <div className="mt-5">
          <div
            role="tablist"
            aria-label="Content input options"
            className="grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1.5 sm:grid-cols-4"
          >
            {INPUT_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = inputMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setInputMode(tab.id)}
                  className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                    active
                      ? 'bg-[var(--bg-card)] text-violet-700 dark:text-white border border-violet-500/35 shadow-xs'
                      : 'text-[var(--text-muted)] border border-transparent hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* File Upload Dropzone when Video/Audio/Text mode selected */}
        {inputMode !== 'paste' && (
          <div className="mt-4 space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptForMode}
              className="hidden"
              onChange={(e) => {
                void handleFileSelected(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                void handleFileSelected(e.dataTransfer.files?.[0]);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                isDraggingOver
                  ? 'border-violet-500 bg-violet-500/10'
                  : 'border-[var(--border-strong)] bg-[var(--bg-surface)]/70 hover:border-violet-500/60 hover:bg-[var(--bg-surface)]'
              }`}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600/15 to-blue-600/15 border border-violet-500/25 text-violet-600 dark:text-violet-400">
                <Upload className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                {inputMode === 'video'
                  ? 'Upload Video File (.mp4, .mov, .webm · max 14 MB)'
                  : inputMode === 'audio'
                  ? 'Upload Audio File (.mp3, .wav, .m4a · max 14 MB)'
                  : 'Upload Text or Subtitle File (.txt, .md, .srt, .vtt)'}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Click to browse or drag and drop your file here for multimodal Gemini analysis
              </p>
            </div>

            {uploadProgress !== null && (
              <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--text-secondary)]">
                    Preparing file for studio...
                  </span>
                  <span className="font-mono font-semibold text-violet-600 dark:text-violet-300 tabular-nums">
                    {uploadProgress}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-default)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-600 to-blue-600 transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Attached Media Summary + Live Preview */}
        {mediaInfo && (
          <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-card)] border border-[var(--border-default)]">
                  {mediaInfo.kind === 'video' ? (
                    <FileVideo className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  ) : mediaInfo.kind === 'audio' ? (
                    <FileAudio className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                      {mediaInfo.name}
                    </p>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Ready
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                    {formatBytes(mediaInfo.size)} · {mediaInfo.type} · {mediaInfo.kind}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (previewUrl) {
                    URL.revokeObjectURL(previewUrl);
                    setPreviewUrl(null);
                  }
                  onChangeMediaInfo(null);
                }}
                aria-label="Remove attached file"
                className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {previewUrl && mediaInfo.kind === 'video' && (
              <video
                controls
                src={previewUrl}
                className="max-h-56 w-full rounded-lg border border-[var(--border-default)] bg-black"
              />
            )}

            {previewUrl && mediaInfo.kind === 'audio' && (
              <audio controls src={previewUrl} className="w-full" />
            )}
          </div>
        )}

        {/* Main Script / Idea Textarea */}
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <label
              htmlFor="creator-source-textarea"
              className="text-xs font-semibold text-[var(--text-secondary)]"
            >
              Content Script, Transcript, or Idea
            </label>
            <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
              {sourceText.length} chars
            </span>
          </div>
          <textarea
            id="creator-source-textarea"
            rows={6}
            value={sourceText}
            onChange={(e) => onChangeSourceText(e.target.value)}
            placeholder="Paste your video transcript, content idea, or script here..."
            className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-4 py-3.5 text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
        </div>

        {/* Customization Options */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Target Platform */}
          <div>
            <label
              htmlFor="select-platform"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Target Platform
            </label>
            <select
              id="select-platform"
              value={platform}
              onChange={(e) => onChangePlatform(e.target.value as Platform)}
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Content Language */}
          <div>
            <label
              htmlFor="select-language"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Content Language
            </label>
            <select
              id="select-language"
              value={language}
              onChange={(e) => onChangeLanguage(e.target.value as ContentLanguage)}
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </div>

          {/* Tone */}
          <div>
            <label
              htmlFor="select-tone"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Tone
            </label>
            <select
              id="select-tone"
              value={tone}
              onChange={(e) => onChangeTone(e.target.value as Tone)}
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Video Duration */}
          <div>
            <span className="block text-xs font-medium text-[var(--text-muted)]">
              Video Duration
            </span>
            <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1">
              {DURATIONS.map((d) => {
                const active = duration === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onChangeDuration(d)}
                    className={`rounded-lg py-1.5 font-mono text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-xs'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Creator Niche & Customizable Brand Voice */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="input-creator-niche"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Creator Niche
            </label>
            <input
              id="input-creator-niche"
              type="text"
              maxLength={150}
              value={niche}
              onChange={(e) => onChangeNiche(e.target.value)}
              placeholder="e.g., AI Tools, Personal Finance, Fitness Coaching"
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="input-brand-voice"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Customizable Brand Voice
            </label>
            <input
              id="input-brand-voice"
              type="text"
              maxLength={400}
              value={brandVoice}
              onChange={(e) => onChangeBrandVoice(e.target.value)}
              placeholder="e.g., Direct, witty, story-driven, zero fluff"
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </div>
        </div>

        {/* Brand Kit Alignment Strip */}
        {brandKit && (
          <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)]">
                  {brandKit.logoUrl ? (
                    <img
                      src={brandKit.logoUrl}
                      alt={brandKit.brandName}
                      className="h-6 w-6 rounded object-contain"
                    />
                  ) : (
                    <Palette className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                      Brand Kit: {brandKit.brandName}
                    </span>
                    <div className="flex items-center gap-1" aria-hidden="true">
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-white/20"
                        style={{ backgroundColor: brandKit.colors.primary }}
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-white/20"
                        style={{ backgroundColor: brandKit.colors.secondary }}
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-white/20"
                        style={{ backgroundColor: brandKit.colors.accent }}
                      />
                    </div>
                  </div>
                  <p className="truncate text-[11px] text-[var(--text-muted)]">
                    {brandKit.preferredCtas.length} preferred CTAs ·{' '}
                    {brandKit.captionStyle.emojiDensity} emojis ·{' '}
                    {brandKit.captionStyle.lineSpacing} spacing
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {brandKit.templates.length > 0 && onSelectBrandTemplate && (
                  <select
                    aria-label="Apply Brand Kit template"
                    value={activeBrandTemplateId}
                    onChange={(e) => onSelectBrandTemplate(e.target.value)}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  >
                    <option value="">No brand template</option>
                    {brandKit.templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        Template: {tpl.name} ({tpl.platform})
                      </option>
                    ))}
                  </select>
                )}

                {onToggleApplyBrandKit && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={applyBrandKit}
                      onChange={(e) => onToggleApplyBrandKit(e.target.checked)}
                      className="rounded border-[var(--border-default)] text-violet-600 focus:ring-violet-500"
                    />
                    <span>Apply automatically</span>
                  </label>
                )}

                {onOpenBrandKit && (
                  <button
                    type="button"
                    onClick={onOpenBrandKit}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-violet-500/40 hover:text-[var(--text-primary)] whitespace-nowrap"
                  >
                    Configure Kit
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Explicit AI Error Banner */}
        {aiError && (
          <div
            role="alert"
            className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3.5 text-xs text-rose-800 dark:text-rose-200"
          >
            <div className="flex items-start gap-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <div>
                <p className="font-semibold text-rose-900 dark:text-rose-100">
                  AI Generation Error
                </p>
                <p className="mt-0.5 leading-relaxed">{aiError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismissAiError}
              aria-label="Dismiss AI error"
              className="rounded-md p-1 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Action Row */}
        <div className="mt-6 flex flex-col items-stretch justify-between gap-3 border-t border-[var(--border-default)] pt-5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onClearAll}
            disabled={isGenerating && !sourceText && !generatedResult}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] whitespace-nowrap"
          >
            <Trash2 className="h-4 w-4 text-[var(--text-muted)]" />
            <span>Clear All Content</span>
          </button>

          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-violet-600/20 transition-all duration-150 hover:from-violet-500 hover:to-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Analyzing &amp; Generating with Gemini...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>Generate Content</span>
              </>
            )}
          </button>
        </div>
      </section>

      {/* Loading Animation Skeleton */}
      {isGenerating && (
        <section
          aria-label="Generating content"
          className="grid grid-cols-1 gap-6 xl:grid-cols-2"
        >
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 animate-pulse rounded-lg bg-[var(--bg-surface)]" />
                  <div className="space-y-1.5">
                    <div className="h-4 w-32 animate-pulse rounded bg-[var(--bg-surface)]" />
                    <div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-surface)] opacity-70" />
                  </div>
                </div>
                <div className="h-7 w-16 animate-pulse rounded-lg bg-[var(--bg-surface)]" />
              </div>
              <div className="mt-4 space-y-3">
                <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-surface)]" />
                <div className="h-4 w-full animate-pulse rounded bg-[var(--bg-surface)] opacity-80" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-[var(--bg-surface)] opacity-70" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--bg-surface)] opacity-60" />
              </div>
            </div>
          ))}
        </section>
      )}

      {/* AI Generated Results */}
      {!isGenerating && generatedResult && (
        <GeneratedResultsGrid
          result={generatedResult}
          onUpdateResult={onUpdateResult}
          onCopyText={onCopyText}
          onRegenerate={onGenerate}
          onSaveProject={onSaveProject}
          onDownload={onDownload}
          onClearAll={onClearAll}
          onStageSocialPost={onStageSocialPost}
          onCreateThumbnail={onCreateThumbnail}
          onCreateAiVideo={onCreateAiVideo}
          onNotify={onNotify}
          platform={platform}
          tone={tone}
          duration={duration}
          niche={niche}
          brandVoice={brandVoice}
          isGenerating={isGenerating}
          defaultProjectTitle={defaultProjectTitle}
          activeProject={activeProject}
        />
      )}
    </div>
  );
}
