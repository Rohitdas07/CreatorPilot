import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  Film,
  Loader2,
  Play,
  Plus,
  Scissors,
  Sparkles,
  Subtitles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ContentLanguage } from '../types/creator';
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitlePosition,
  type SubtitleStyleConfig,
  type UploadedVideoMetadata,
  type VideoAspectRatio,
  type VideoHighlightProposal,
  type VideoRenderJob,
  type VideoSubtitleCue,
} from '../types/videoEditor';
import {
  analyzeVideoHighlights,
  fetchRenderedVideoBlob,
  pollVideoRenderJob,
  startVideoRenderJob,
  uploadVideoFile,
} from '../services/videoApi';
import { uploadRenderedVideoBlob } from '../services/storageService';
import {
  saveVideoJobToFirestore,
  updateVideoJobInFirestore,
} from '../services/firestoreService';

interface VideoEditorViewProps {
  userId: string;
  defaultLanguage: ContentLanguage;
  videoJobs: VideoRenderJob[];
  onDeleteVideoJob: (jobId: string) => Promise<void>;
  onCopyText: (text: string, label: string) => void;
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

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

const ASPECT_RATIOS: Array<{
  id: VideoAspectRatio;
  label: string;
  spec: string;
}> = [
  { id: '9:16', label: '9:16 Vertical', spec: '1080×1920 · Reels / Shorts' },
  { id: '1:1', label: '1:1 Square', spec: '1080×1080 · Feed' },
  { id: '16:9', label: '16:9 Widescreen', spec: '1920×1080 · YouTube' },
];

const FONT_CHOICES = ['DejaVu Sans', 'Liberation Sans', 'Noto Sans'];

function formatSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export function VideoEditorView({
  userId,
  defaultLanguage,
  videoJobs,
  onDeleteVideoJob,
  onCopyText,
  onNotify,
}: VideoEditorViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadedVideo, setUploadedVideo] =
    useState<UploadedVideoMetadata | null>(null);

  const [language, setLanguage] = useState<ContentLanguage>(defaultLanguage);
  const [focusPrompt, setFocusPrompt] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);

  const [clips, setClips] = useState<VideoHighlightProposal[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [clipTitle, setClipTitle] = useState('Highlight Clip');
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(15);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('9:16');

  const [subtitles, setSubtitles] = useState<VideoSubtitleCue[]>([]);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleConfig>(
    DEFAULT_SUBTITLE_STYLE
  );

  const [activeRenderJobId, setActiveRenderJobId] = useState<string | null>(
    null
  );
  const [activeDownloadUrl, setActiveDownloadUrl] = useState<string | null>(null);
  const [storageUploadPct, setStorageUploadPct] = useState<number | null>(null);
  const [uploadingJobId, setUploadingJobId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  const activeJob = useMemo(
    () => videoJobs.find((j) => j.id === activeRenderJobId) || null,
    [videoJobs, activeRenderJobId]
  );

  const handleFilePicked = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      onNotify('Invalid file type', 'Please select an MP4, MOV, or WebM video file.', 'error');
      return;
    }

    if (localPreviewUrl) {
      URL.revokeObjectURL(localPreviewUrl);
    }
    const objUrl = URL.createObjectURL(file);
    setLocalPreviewUrl(objUrl);
    setUploadProgress(2);

    try {
      const meta = await uploadVideoFile(file, (pct) => setUploadProgress(pct));
      setUploadedVideo(meta);
      setClips([]);
      setSubtitles([]);
      setAnalysisSummary(null);
      setStartSec(0);
      setEndSec(Number(Math.min(meta.durationSec || 15, 30).toFixed(2)));
      setClipTitle(meta.fileName.replace(/\.[^.]+$/, '').slice(0, 80) || 'Clip 1');
      onNotify(
        'Video inspected with FFprobe',
        `${meta.width}×${meta.height} · ${formatSec(meta.durationSec)} (${meta.codec})`,
        'success'
      );
    } catch (err) {
      onNotify(
        'Video upload failed',
        err instanceof Error ? err.message : 'Could not inspect video.',
        'error'
      );
    } finally {
      setUploadProgress(null);
    }
  };

  const handleAnalyzeHighlights = async () => {
    if (!uploadedVideo) {
      onNotify('Upload a video first', 'Select a video file to analyze.', 'error');
      return;
    }

    setIsAnalyzing(true);
    try {
      const res = await analyzeVideoHighlights({
        uploadId: uploadedVideo.uploadId,
        language,
        focusPrompt,
      });
      setAnalysisSummary(res.summary);
      setClips(res.clips);
      setSubtitles(res.subtitles);
      if (res.clips[0]) {
        selectProposal(res.clips[0]);
      }
      onNotify(
        'Highlights & subtitles ready',
        `Generated ${res.clips.length} clip proposals and ${res.subtitles.length} subtitle cues.`,
        'success'
      );
    } catch (err) {
      onNotify(
        'AI video analysis failed',
        err instanceof Error ? err.message : 'Gemini could not analyze the video.',
        'error'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const selectProposal = (clip: VideoHighlightProposal) => {
    setSelectedClipId(clip.id);
    setClipTitle(clip.title);
    setStartSec(clip.startSec);
    setEndSec(clip.endSec);
    setAspectRatio(clip.recommendedAspectRatio);
    if (videoPreviewRef.current) {
      videoPreviewRef.current.currentTime = clip.startSec;
    }
  };

  const handlePreviewTrimSegment = () => {
    if (!videoPreviewRef.current) return;
    videoPreviewRef.current.currentTime = startSec;
    void videoPreviewRef.current.play();
  };

  const handleAddSubtitleCue = () => {
    const newStart = startSec;
    const newEnd = Math.min(endSec, startSec + 3);
    setSubtitles((prev) => [
      ...prev,
      {
        id: `sub-${Date.now()}`,
        startSec: Number(newStart.toFixed(2)),
        endSec: Number(newEnd.toFixed(2)),
        text: 'New subtitle line',
      },
    ]);
  };

  const handleStartRender = async () => {
    if (!uploadedVideo) {
      onNotify('No video uploaded', 'Upload a source video first.', 'error');
      return;
    }
    if (endSec <= startSec) {
      onNotify('Invalid trim range', 'End time must be greater than start time.', 'error');
      return;
    }

    const jobId = `vjob-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowIso = new Date().toISOString();

    const initialJob: VideoRenderJob = {
      id: jobId,
      userId,
      uploadId: uploadedVideo.uploadId,
      sourceFileName: uploadedVideo.fileName,
      sourceDurationSec: uploadedVideo.durationSec,
      sourceWidth: uploadedVideo.width,
      sourceHeight: uploadedVideo.height,
      clipTitle: clipTitle.trim() || 'Edited Clip',
      startSec,
      endSec,
      aspectRatio,
      language,
      subtitleStyle,
      subtitlesCount: subtitles.length,
      status: 'queued',
      progress: 0,
      stageMessage: 'Queuing FFmpeg worker job',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    try {
      await saveVideoJobToFirestore(userId, initialJob);
      const started = await startVideoRenderJob({
        jobId,
        uploadId: uploadedVideo.uploadId,
        clipTitle: initialJob.clipTitle,
        startSec,
        endSec,
        aspectRatio,
        subtitles,
        subtitleStyle,
      });

      setActiveRenderJobId(started.jobId);
      setActiveDownloadUrl(null);
      onNotify(
        'FFmpeg worker started',
        `Rendering ${aspectRatio} MP4 clip in the background.`,
        'info'
      );

      // Poll Python FFmpeg worker until terminal state & sync progress to Firestore
      const poll = async () => {
        try {
          const status = await pollVideoRenderJob(started.jobId);
          await updateVideoJobInFirestore(userId, started.jobId, {
            status: status.status,
            progress: status.progress,
            stageMessage: status.stageMessage,
            ...(status.outputFileName ? { outputFileName: status.outputFileName } : {}),
            ...(status.downloadUrl ? { downloadUrl: status.downloadUrl } : {}),
            ...(typeof status.outputBytes === 'number'
              ? { outputBytes: status.outputBytes }
              : {}),
            ...(status.error ? { error: status.error } : {}),
          });

          if (status.status === 'completed') {
            if (status.downloadUrl) {
              setActiveDownloadUrl(status.downloadUrl);
            }
            onNotify(
              'MP4 render completed',
              `${status.outputFileName || 'Clip'} is ready to download or upload to Firebase Storage.`,
              'success'
            );
            return;
          }

          if (status.status === 'failed') {
            onNotify(
              'Video render failed',
              status.error || 'FFmpeg worker reported an error.',
              'error'
            );
            return;
          }

          window.setTimeout(() => void poll(), 1200);
        } catch (err) {
          onNotify(
            'Render status check failed',
            err instanceof Error ? err.message : 'Lost connection to worker.',
            'error'
          );
        }
      };

      window.setTimeout(() => void poll(), 900);
    } catch (err) {
      onNotify(
        'Could not queue render',
        err instanceof Error ? err.message : 'Server rejected video job.',
        'error'
      );
    }
  };

  const handleSaveJobToStorage = async (job: VideoRenderJob) => {
    if (!job.downloadUrl) {
      onNotify(
        'Local MP4 unavailable',
        'Render a fresh clip in this session before uploading to Firebase Storage.',
        'error'
      );
      return;
    }

    setUploadingJobId(job.id);
    setStorageUploadPct(5);
    try {
      const mp4Blob = await fetchRenderedVideoBlob(job.downloadUrl);
      const uploaded = await uploadRenderedVideoBlob(
        userId,
        job.id,
        job.outputFileName || `${job.clipTitle}.mp4`,
        mp4Blob,
        (pct) => setStorageUploadPct(pct)
      );
      await updateVideoJobInFirestore(userId, job.id, {
        storageUrl: uploaded.downloadUrl,
        storagePath: uploaded.storagePath,
      });
      onNotify(
        'Saved MP4 to Firebase Storage',
        'Your rendered video now has a persistent HTTPS URL for publishing.',
        'success'
      );
    } catch (err) {
      onNotify(
        'Firebase Storage upload failed',
        err instanceof Error
          ? err.message
          : 'Check storage.rules and Firebase Storage setup.',
        'error'
      );
    } finally {
      setUploadingJobId(null);
      setStorageUploadPct(null);
    }
  };

  const activeCueText = useMemo(() => {
    return (
      subtitles.find((c) => c.startSec >= startSec && c.startSec <= endSec)
        ?.text || 'Synchronized subtitle preview'
    );
  }, [subtitles, startSec, endSec]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
            AI Smart Video Editor
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Extract highlights with Gemini AI, trim clips, convert to 9:16 / 1:1 / 16:9, style synchronized subtitles, and render real MP4 files via FFmpeg.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              void handleFilePicked(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadProgress !== null}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:from-violet-500 hover:to-blue-500 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>
              {uploadProgress !== null
                ? `Uploading ${uploadProgress}%`
                : uploadedVideo
                ? 'Replace Source Video'
                : 'Upload Video (up to 250 MB)'}
            </span>
          </button>
        </div>
      </section>

      {uploadProgress !== null && (
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-[var(--text-primary)]">
            <span>Streaming video to background FFmpeg worker...</span>
            <span className="font-mono tabular-nums">{uploadProgress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
            <div
              className="h-full bg-gradient-to-r from-violet-600 to-blue-600 transition-all"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Main Editor Workspace */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Video Player, AI Highlights, Timeline Trimming */}
        <div className="space-y-6 xl:col-span-7">
          {/* Source Preview + AI Analyze Bar */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Source Preview &amp; Timeline
              </h2>
              {uploadedVideo && (
                <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
                  {uploadedVideo.width}×{uploadedVideo.height} ·{' '}
                  {formatSec(uploadedVideo.durationSec)} · {uploadedVideo.codec}
                </span>
              )}
            </div>

            {localPreviewUrl ? (
              <div className="relative overflow-hidden rounded-xl border border-[var(--border-default)] bg-black">
                <video
                  ref={videoPreviewRef}
                  src={localPreviewUrl}
                  controls
                  className="max-h-[340px] w-full object-contain"
                />
                {/* Live Subtitle Preview Overlay */}
                <div
                  className={`pointer-events-none absolute inset-x-6 flex justify-center ${
                    subtitleStyle.position === 'top'
                      ? 'top-4'
                      : subtitleStyle.position === 'middle'
                      ? 'top-1/2 -translate-y-1/2'
                      : 'bottom-12'
                  }`}
                >
                  <span
                    className="rounded px-2.5 py-1 text-center font-semibold shadow-sm"
                    style={{
                      color: subtitleStyle.primaryColor,
                      backgroundColor: `${subtitleStyle.backgroundColor}cc`,
                      fontSize: `${Math.max(12, Math.round(subtitleStyle.fontSize * 0.36))}px`,
                      textTransform: subtitleStyle.uppercase ? 'uppercase' : 'none',
                    }}
                  >
                    {activeCueText}
                  </span>
                </div>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] py-14 text-center px-4 hover:border-violet-500/60"
              >
                <Film className="h-9 w-9 text-violet-600 dark:text-violet-400" />
                <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                  Upload a video to extract AI highlights and edit
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Supports MP4, MOV, WebM up to 250 MB · Processed with real FFmpeg
                </p>
              </div>
            )}

            {/* Gemini Highlight Extraction Controls */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 pt-1">
              <div className="sm:col-span-3">
                <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                  Subtitle Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as ContentLanguage)}
                  className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-6">
                <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                  Highlight Focus (optional)
                </label>
                <input
                  type="text"
                  value={focusPrompt}
                  onChange={(e) => setFocusPrompt(e.target.value)}
                  placeholder="e.g., Find top 3 actionable creator tips"
                  className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                />
              </div>
              <div className="sm:col-span-3 flex items-end">
                <button
                  type="button"
                  disabled={!uploadedVideo || isAnalyzing}
                  onClick={() => void handleAnalyzeHighlights()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>{isAnalyzing ? 'Analyzing...' : 'AI Highlights'}</span>
                </button>
              </div>
            </div>

            {analysisSummary && (
              <p className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                {analysisSummary}
              </p>
            )}
          </section>

          {/* Clip Proposals List */}
          {clips.length > 0 && (
            <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-3">
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                AI Clip Proposals ({clips.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {clips.map((clip) => {
                  const selected = selectedClipId === clip.id;
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      onClick={() => selectProposal(clip)}
                      className={`rounded-xl border p-3.5 text-left transition-colors ${
                        selected
                          ? 'border-violet-500 bg-violet-500/10'
                          : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                          {clip.title}
                        </span>
                        <span className="font-mono text-[11px] text-violet-600 dark:text-violet-300 tabular-nums shrink-0">
                          {formatSec(clip.startSec)}–{formatSec(clip.endSec)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-muted)]">
                        {clip.reason}
                      </p>
                      <p className="mt-1.5 font-mono text-[10px] text-[var(--text-secondary)]">
                        Recommended: {clip.recommendedAspectRatio}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Trim Controls & Aspect Ratio */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-5">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-default)] pb-3">
              <div className="flex items-center gap-2">
                <Scissors className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  Trim &amp; Output Format
                </h2>
              </div>
              {localPreviewUrl && (
                <button
                  type="button"
                  onClick={handlePreviewTrimSegment}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)]"
                >
                  <Play className="h-3 w-3" />
                  <span>Seek to Start</span>
                </button>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)]">
                Clip Title
              </label>
              <input
                type="text"
                maxLength={160}
                value={clipTitle}
                onChange={(e) => setClipTitle(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)]"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-[var(--text-muted)]">
                    Start Time (sec)
                  </span>
                  <span className="font-mono text-[var(--text-primary)] tabular-nums">
                    {formatSec(startSec)}
                  </span>
                </div>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  max={Math.max(0, (uploadedVideo?.durationSec || 600) - 0.5)}
                  value={startSec}
                  onChange={(e) => setStartSec(Math.max(0, Number(e.target.value)))}
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 font-mono text-sm text-[var(--text-primary)]"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-[var(--text-muted)]">
                    End Time (sec)
                  </span>
                  <span className="font-mono text-[var(--text-primary)] tabular-nums">
                    {formatSec(endSec)} (len {Math.max(0, endSec - startSec).toFixed(1)}s)
                  </span>
                </div>
                <input
                  type="number"
                  min={0.5}
                  step="0.5"
                  max={uploadedVideo?.durationSec || 600}
                  value={endSec}
                  onChange={(e) =>
                    setEndSec(Math.max(startSec + 0.5, Number(e.target.value)))
                  }
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 font-mono text-sm text-[var(--text-primary)]"
                />
              </div>
            </div>

            {/* Aspect Ratio Selector */}
            <div>
              <span className="block text-xs font-medium text-[var(--text-muted)] mb-2">
                Target Aspect Ratio
              </span>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {ASPECT_RATIOS.map((ratio) => {
                  const active = aspectRatio === ratio.id;
                  return (
                    <button
                      key={ratio.id}
                      type="button"
                      onClick={() => setAspectRatio(ratio.id)}
                      className={`rounded-xl border p-3 text-left transition-colors ${
                        active
                          ? 'border-violet-500 bg-violet-500/12 text-[var(--text-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <p className="text-xs font-semibold">{ratio.label}</p>
                      <p className="mt-0.5 font-mono text-[10px] opacity-80">
                        {ratio.spec}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              disabled={
                !uploadedVideo ||
                activeJob?.status === 'queued' ||
                activeJob?.status === 'processing'
              }
              onClick={() => void handleStartRender()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-md hover:from-violet-500 hover:to-blue-500 disabled:opacity-50"
            >
              {activeJob?.status === 'queued' || activeJob?.status === 'processing' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Film className="h-4 w-4" />
              )}
              <span>
                {activeJob?.status === 'processing'
                  ? `Rendering ${aspectRatio} MP4 (${activeJob.progress}%)`
                  : `Render ${aspectRatio} MP4 Clip with FFmpeg`}
              </span>
            </button>

            {/* Active Render Progress & Output Preview */}
            {activeJob && (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {activeJob.stageMessage}
                  </span>
                  <span className="font-mono tabular-nums text-[var(--text-muted)]">
                    {activeJob.progress}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-card)]">
                  <div
                    className={`h-full transition-all ${
                      activeJob.status === 'failed'
                        ? 'bg-rose-500'
                        : activeJob.status === 'completed'
                        ? 'bg-emerald-500'
                        : 'bg-gradient-to-r from-violet-600 to-blue-600'
                    }`}
                    style={{ width: `${activeJob.progress}%` }}
                  />
                </div>
                {activeJob.error && (
                  <p className="flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-300">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{activeJob.error}</span>
                  </p>
                )}
                {activeJob.status === 'completed' && activeDownloadUrl && (
                  <div className="space-y-3 pt-1">
                    <video
                      src={activeDownloadUrl}
                      controls
                      className="max-h-72 w-full rounded-lg bg-black"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`${activeDownloadUrl}&download=1`}
                        download={activeJob.outputFileName || 'clip.mp4'}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Download MP4</span>
                      </a>
                      <button
                        type="button"
                        disabled={uploadingJobId === activeJob.id}
                        onClick={() => void handleSaveJobToStorage(activeJob)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)]"
                      >
                        <CloudUpload className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                        <span>
                          {uploadingJobId === activeJob.id && storageUploadPct !== null
                            ? `Uploading ${storageUploadPct}%`
                            : 'Save MP4 to Firebase Storage'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Subtitle Styling, Subtitle Editor & Render History */}
        <div className="space-y-6 xl:col-span-5">
          {/* Subtitle Styling */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-4">
            <div className="flex items-center gap-2 border-b border-[var(--border-default)] pb-3">
              <Subtitles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Subtitle Styling &amp; Timing
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                  Font Family
                </label>
                <select
                  value={subtitleStyle.fontFamily}
                  onChange={(e) =>
                    setSubtitleStyle({ ...subtitleStyle, fontFamily: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                >
                  {FONT_CHOICES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                  Font Size ({subtitleStyle.fontSize}px)
                </label>
                <input
                  type="range"
                  min={26}
                  max={72}
                  value={subtitleStyle.fontSize}
                  onChange={(e) =>
                    setSubtitleStyle({
                      ...subtitleStyle,
                      fontSize: Number(e.target.value),
                    })
                  }
                  className="mt-2.5 w-full accent-violet-600"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--text-muted)]">
                  Position
                </label>
                <select
                  value={subtitleStyle.position}
                  onChange={(e) =>
                    setSubtitleStyle({
                      ...subtitleStyle,
                      position: e.target.value as SubtitlePosition,
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)]"
                >
                  <option value="bottom">Bottom Safe Zone</option>
                  <option value="middle">Center Dynamic</option>
                  <option value="top">Top Overlay</option>
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-[var(--text-primary)] pb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subtitleStyle.uppercase}
                    onChange={(e) =>
                      setSubtitleStyle({
                        ...subtitleStyle,
                        uppercase: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded text-violet-600"
                  />
                  <span>Uppercase Captions</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { key: 'primaryColor', label: 'Text' },
                  { key: 'outlineColor', label: 'Outline' },
                  { key: 'backgroundColor', label: 'Backplate' },
                ] as const
              ).map((c) => (
                <div
                  key={c.key}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 flex items-center gap-2"
                >
                  <input
                    type="color"
                    value={subtitleStyle[c.key]}
                    onChange={(e) =>
                      setSubtitleStyle({ ...subtitleStyle, [c.key]: e.target.value })
                    }
                    className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    {c.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Editable Subtitle Cues */}
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                Subtitle Cues ({subtitles.length})
              </span>
              <button
                type="button"
                onClick={handleAddSubtitleCue}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)]"
              >
                <Plus className="h-3 w-3" />
                <span>Add Cue</span>
              </button>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {subtitles.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--border-default)] py-6 text-center text-xs text-[var(--text-muted)]">
                  Click &ldquo;AI Highlights&rdquo; to generate synchronized subtitles or add cues manually.
                </p>
              ) : (
                subtitles.map((cue, idx) => (
                  <div
                    key={cue.id}
                    className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.2"
                        min={0}
                        value={cue.startSec}
                        onChange={(e) => {
                          const next = [...subtitles];
                          next[idx] = { ...cue, startSec: Number(e.target.value) };
                          setSubtitles(next);
                        }}
                        className="w-20 rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]"
                      />
                      <span className="text-[11px] text-[var(--text-muted)]">to</span>
                      <input
                        type="number"
                        step="0.2"
                        min={0.2}
                        value={cue.endSec}
                        onChange={(e) => {
                          const next = [...subtitles];
                          next[idx] = { ...cue, endSec: Number(e.target.value) };
                          setSubtitles(next);
                        }}
                        className="w-20 rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)]"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setSubtitles(subtitles.filter((s) => s.id !== cue.id))
                        }
                        aria-label="Delete subtitle cue"
                        className="ml-auto text-[var(--text-muted)] hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={cue.text}
                      onChange={(e) => {
                        const next = [...subtitles];
                        next[idx] = { ...cue, text: e.target.value };
                        setSubtitles(next);
                      }}
                      className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                    />
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Firestore Video Render Jobs History */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-[var(--shadow-card)] space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-3">
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Rendered Video Jobs ({videoJobs.length})
              </h2>
            </div>

            {videoJobs.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--text-muted)]">
                Completed FFmpeg MP4 renders and Firebase Storage links appear here.
              </p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {videoJobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                          {job.clipTitle}
                        </p>
                        <p className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                          {job.aspectRatio} · {formatSec(job.startSec)}–
                          {formatSec(job.endSec)} · {job.status} ({job.progress}%)
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onDeleteVideoJob(job.id)}
                        aria-label="Delete job record"
                        className="text-[var(--text-muted)] hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {job.status === 'completed' && job.downloadUrl && (
                        <a
                          href={`${job.downloadUrl}&download=1`}
                          download={job.outputFileName || 'clip.mp4'}
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)]"
                        >
                          <Download className="h-3 w-3" />
                          <span>MP4</span>
                        </a>
                      )}

                      {job.status === 'completed' && !job.storageUrl && job.downloadUrl && (
                        <button
                          type="button"
                          disabled={uploadingJobId === job.id}
                          onClick={() => void handleSaveJobToStorage(job)}
                          className="inline-flex items-center gap-1 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300"
                        >
                          <CloudUpload className="h-3 w-3" />
                          <span>
                            {uploadingJobId === job.id
                              ? `${storageUploadPct ?? 0}%`
                              : 'Save to Storage'}
                          </span>
                        </button>
                      )}

                      {job.storageUrl && (
                        <>
                          <a
                            href={job.storageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Stored URL</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              onCopyText(job.storageUrl || '', 'Firebase Storage MP4 URL')
                            }
                            className="rounded-lg border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
                          >
                            Copy URL
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
