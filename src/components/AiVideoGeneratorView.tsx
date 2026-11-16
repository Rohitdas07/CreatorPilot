import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Clock,
  CloudUpload,
  DollarSign,
  Download,
  Eye,
  FileText,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Mic,
  Music,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Subtitles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import type { ContentLanguage } from '../types/creator';
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitlePosition,
  type SubtitleStyleConfig,
  type VideoAspectRatio,
  type VideoSubtitleCue,
} from '../types/videoEditor';
import {
  AI_VIDEO_DETAILED_STAGES,
  AI_VIDEO_DURATIONS,
  AI_VIDEO_MUSIC_PRESETS,
  AI_VIDEO_STYLES,
  AI_VIDEO_VOICES,
  DEFAULT_RELEVANCE_THRESHOLD,
  MAX_AI_VIDEO_DURATION_SEC,
  MAX_AI_VIDEO_SCENES,
  type AiVideoCostEstimate,
  type AiVideoDurationSec,
  type AiVideoFreeVisualStyle,
  type AiVideoJobRecord,
  type AiVideoJobStatusResponse,
  type AiVideoMusicPreset,
  type AiVideoSceneClipState,
  type AiVideoScenePlan,
  type AiVideoScenePlanItem,
  type AiVideoStyle,
  type AiVideoTransitionType,
  type AiVideoVisualEngine,
  type AiVideoVisualSourceKind,
  type AiVideoVisualSourceMode,
  type AiVideoVoiceId,
} from '../types/aiVideo';
import {
  cancelAiVideoJobApi,
  estimateAiVideoCostApi,
  generateScriptFromIdeaApi,
  planAiVideoScenesApi,
  pollAiVideoJobApi,
  prepareAiVideoVisualsApi,
  previewAiVideoMusicApi,
  previewAiVideoVoiceApi,
  regenerateSceneVisualApi,
  renderFinalFromPreparedApi,
  replaceSceneImageApi,
  rerenderAiVideoJobApi,
  retryAiVideoJobApi,
  startAiVideoGenerationApi,
  uploadAiVideoToStorage,
} from '../services/aiVideoApi';
import {
  saveAiVideoJobToFirestore,
  updateAiVideoJobInFirestore,
} from '../services/firestoreService';

export interface AiVideoScriptSeed {
  title: string;
  script: string;
  language?: ContentLanguage;
  aspectRatio?: VideoAspectRatio;
  durationSec?: AiVideoDurationSec;
}

interface AiVideoGeneratorViewProps {
  userId: string;
  defaultLanguage: ContentLanguage;
  initialScriptSeed?: AiVideoScriptSeed | null;
  onConsumeScriptSeed?: () => void;
  aiVideoJobs: AiVideoJobRecord[];
  onDeleteAiVideoJob: (jobId: string) => Promise<void>;
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
  { id: '9:16', label: '9:16 Vertical', spec: '1080×1920 · Reels & Shorts' },
  { id: '16:9', label: '16:9 Widescreen', spec: '1920×1080 · YouTube' },
  { id: '1:1', label: '1:1 Square', spec: '1080×1080 · Instagram Feed' },
];

const TRANSITIONS: Array<{ id: AiVideoTransitionType; label: string }> = [
  { id: 'fade', label: 'Smooth Fade' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'slideleft', label: 'Slide Left' },
  { id: 'cut', label: 'Hard Cut' },
];

const SAMPLE_SCRIPTS: Array<{
  label: string;
  title: string;
  durationSec: AiVideoDurationSec;
  style: AiVideoStyle;
  script: string;
}> = [
  {
    label: 'AI Future (30s)',
    title: 'The Quiet Shift in How We Build Software',
    durationSec: 30,
    style: 'modern-tech',
    script:
      'Most people think artificial intelligence replaces creativity. In reality, it removes the blank-page friction between an idea and a finished product. Small teams can now prototype film scenes, studio audio, and global campaigns in an afternoon. The creators who win next will focus less on repetitive edits and more on taste, storytelling, and clear human perspective.',
  },
  {
    label: 'Morning Habit (15s)',
    title: 'The 10-Minute Focus Reset',
    durationSec: 15,
    style: 'cinematic',
    script:
      'Before checking a single notification tomorrow morning, spend ten minutes in silence with a notebook. Clear mental clutter first, choose one non-negotiable priority, and protect your deepest hour of focus.',
  },
  {
    label: 'Creator Strategy (30s)',
    title: 'Why Short-Form Retention Happens in Frame One',
    durationSec: 30,
    style: 'energetic-social',
    script:
      'Viewers decide within two seconds whether your video earns their attention. Skip slow throat-clearing intros and open directly with visual movement and a clear tension point. Pair crisp pacing with readable captions so your story lands even on mute, then finish with one memorable takeaway.',
  },
];

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatVisualSourceLabel(
  source?: AiVideoVisualSourceKind,
  hasImage?: boolean,
  visualStatus?: AiVideoSceneClipState['visualStatus']
): string {
  switch (source) {
    case 'ai-generated':
      return 'AI Generated';
    case 'wikimedia':
      return 'Wikimedia Commons';
    case 'wikipedia':
      return 'Wikipedia';
    case 'openverse':
      return 'Openverse CC';
    case 'nasa':
      return 'NASA Public Domain';
    case 'custom-upload':
      return 'Custom Upload';
    case 'context-fallback':
      return 'Local Illustration';
    default:
      if (
        hasImage ||
        visualStatus === 'approved' ||
        visualStatus === 'verified' ||
        visualStatus === 'fallback'
      ) {
        return 'Approved Visual';
      }
      return 'Pending Visual';
  }
}

function rebalanceDurations(
  scenes: AiVideoScenePlanItem[],
  targetTotal: number
): AiVideoScenePlanItem[] {
  if (scenes.length === 0) return scenes;
  const count = scenes.length;
  const base = Math.max(3, Math.min(10, Math.floor(targetTotal / count)));
  const updated = scenes.map((s) => ({ ...s, duration: base }));
  let diff = targetTotal - updated.reduce((acc, s) => acc + s.duration, 0);
  let idx = 0;
  let guard = 0;
  while (diff !== 0 && guard < 100) {
    guard += 1;
    const item = updated[idx % count];
    if (diff > 0 && item.duration < 10) {
      item.duration += 1;
      diff -= 1;
    } else if (diff < 0 && item.duration > 3) {
      item.duration -= 1;
      diff += 1;
    }
    idx += 1;
  }
  return updated;
}

export function AiVideoGeneratorView({
  userId,
  defaultLanguage,
  initialScriptSeed,
  onConsumeScriptSeed,
  aiVideoJobs,
  onDeleteAiVideoJob,
  onCopyText,
  onNotify,
}: AiVideoGeneratorViewProps) {
  // Script & Idea state
  const [title, setTitle] = useState('Untitled AI Video');
  const [script, setScript] = useState('');
  const [showIdeaDrawer, setShowIdeaDrawer] = useState(false);
  const [ideaInput, setIdeaInput] = useState('');
  const [isGeneratingIdea, setIsGeneratingIdea] = useState(false);

  // Parameters state
  const [visualEngine, setVisualEngine] = useState<AiVideoVisualEngine>('free-motion');
  const freeVisualStyle: AiVideoFreeVisualStyle = 'topic-pictures';
  const [visualSourceMode, setVisualSourceMode] =
    useState<AiVideoVisualSourceMode>('ai-then-retrieve');
  const [relevanceThreshold, setRelevanceThreshold] = useState<number>(
    DEFAULT_RELEVANCE_THRESHOLD
  );
  const [style, setStyle] = useState<AiVideoStyle>('cinematic');
  const [durationSec, setDurationSec] = useState<AiVideoDurationSec>(30);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('9:16');
  const [language, setLanguage] = useState<ContentLanguage>(defaultLanguage);

  // Voice, Music & Subtitles state
  const [voice, setVoice] = useState<AiVideoVoiceId>('Kore');
  const [narrationVolume, setNarrationVolume] = useState<number>(1.0);
  const [musicPreset, setMusicPreset] = useState<AiVideoMusicPreset>('ambient-uplift');
  const [musicVolume, setMusicVolume] = useState<number>(0.22);
  const [enableSubtitles, setEnableSubtitles] = useState<boolean>(true);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleConfig>(
    DEFAULT_SUBTITLE_STYLE
  );

  // Audio preview playback
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const [previewingKind, setPreviewingKind] = useState<'voice' | 'music' | null>(null);
  const [playingKind, setPlayingKind] = useState<'voice' | 'music' | null>(null);

  // Scene plan & Cost estimate
  const [isPlanning, setIsPlanning] = useState(false);
  const [scenePlan, setScenePlan] = useState<AiVideoScenePlan | null>(null);
  const [editableScenes, setEditableScenes] = useState<AiVideoScenePlanItem[]>([]);
  const [costEstimate, setCostEstimate] = useState<AiVideoCostEstimate | null>(null);
  const [planningNote, setPlanningNote] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [expandedSceneDetails, setExpandedSceneDetails] = useState<Record<number, boolean>>({});

  // Active generation tracking, visual review & video preview resilience
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const [liveJobResponse, setLiveJobResponse] = useState<AiVideoJobStatusResponse | null>(
    null
  );
  const [isStartingJob, setIsStartingJob] = useState(false);
  const [isPreparingVisuals, setIsPreparingVisuals] = useState(false);
  const [isRenderingFinal, setIsRenderingFinal] = useState(false);
  const [regeneratingSceneNum, setRegeneratingSceneNum] = useState<number | null>(null);
  const [uploadingSceneNum, setUploadingSceneNum] = useState<number | null>(null);
  const [expandedSceneRegenNum, setExpandedSceneRegenNum] = useState<number | null>(null);
  const [expandedAttemptsSceneNum, setExpandedAttemptsSceneNum] = useState<number | null>(null);
  const [regenPromptDraft, setRegenPromptDraft] = useState('');
  const [regenQueryDraft, setRegenQueryDraft] = useState('');
  const [isRerendering, setIsRerendering] = useState(false);
  const [storageUploadPct, setStorageUploadPct] = useState<number | null>(null);
  const [storageUploadError, setStorageUploadError] = useState<string | null>(null);
  const [videoSourceMode, setVideoSourceMode] = useState<'local' | 'storage'>('local');
  const [videoPlaybackError, setVideoPlaybackError] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(
    null
  );
  const autoUploadedJobsRef = useRef<Set<string>>(new Set());
  const reviewNotifiedJobsRef = useRef<Set<string>>(new Set());
  const hasAutoSelectedRef = useRef<boolean>(false);

  // Consume script seed sent from Content Studio
  useEffect(() => {
    if (!initialScriptSeed) return;
    setTitle(initialScriptSeed.title || 'Creator Studio Video');
    setScript(initialScriptSeed.script || '');
    if (initialScriptSeed.language) setLanguage(initialScriptSeed.language);
    if (initialScriptSeed.aspectRatio) setAspectRatio(initialScriptSeed.aspectRatio);
    if (initialScriptSeed.durationSec) setDurationSec(initialScriptSeed.durationSec);
    setScenePlan(null);
    setEditableScenes([]);
    setCostEstimate(null);
    onConsumeScriptSeed?.();
  }, [initialScriptSeed, onConsumeScriptSeed]);

  // Stop audio preview on unmount
  const stopAudioPreview = useCallback(() => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      if (audioPlayerRef.current.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioPlayerRef.current.src);
      }
      audioPlayerRef.current = null;
    }
    setPlayingKind(null);
  }, []);

  useEffect(() => {
    return () => {
      stopAudioPreview();
    };
  }, [stopAudioPreview]);

  // Word & pace helper metrics
  const scriptStats = useMemo(() => {
    const trimmed = script.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const estSpeakSec = Math.round(words / 2.3);
    return { words, chars: trimmed.length, estSpeakSec };
  }, [script]);

  const plannedTotalSec = useMemo(
    () => editableScenes.reduce((acc, s) => acc + Math.max(1, Number(s.duration) || 0), 0),
    [editableScenes]
  );

  // Recalculate cost estimate if engine / scene count / durations / music / voice changes
  useEffect(() => {
    if (editableScenes.length === 0) return;
    let cancelled = false;
    estimateAiVideoCostApi({
      visualEngine,
      sceneCount: editableScenes.length,
      totalDurationSec: plannedTotalSec,
      musicPreset,
      voice,
    })
      .then((est) => {
        if (!cancelled) setCostEstimate(est);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visualEngine, editableScenes.length, plannedTotalSec, musicPreset, voice]);

  // Auto-select latest job on initial load / page refresh so completed or in-progress preview restores
  useEffect(() => {
    if (hasAutoSelectedRef.current || activeJobId || aiVideoJobs.length === 0) return;
    hasAutoSelectedRef.current = true;
    const preferred =
      aiVideoJobs.find((j) => j.status === 'queued' || j.status === 'processing') ||
      aiVideoJobs.find((j) => j.status === 'completed') ||
      aiVideoJobs[0];
    if (!preferred) return;
    setActiveJobId(preferred.id);
    setVideoSourceMode(preferred.downloadUrl ? 'local' : 'storage');
    void pollAiVideoJobApi(preferred.id)
      .then((fresh) => {
        setLiveJobResponse(fresh);
        if (fresh.scenes.length > 0 && editableScenes.length === 0) {
          setEditableScenes(fresh.scenes);
        }
      })
      .catch(() => {
        // Server local files may not exist after restart; Firestore storageUrl remains usable
      });
  }, [aiVideoJobs, activeJobId, editableScenes.length]);

  // Resolve active job combining live server status and Firestore record
  const activeFirestoreJob = useMemo(
    () => aiVideoJobs.find((j) => j.id === activeJobId) || null,
    [aiVideoJobs, activeJobId]
  );

  const displayedJob: AiVideoJobRecord | null = useMemo(() => {
    if (liveJobResponse && liveJobResponse.job.id === activeJobId) {
      return {
        ...liveJobResponse.job,
        ...(activeFirestoreJob?.storageUrl
          ? { storageUrl: activeFirestoreJob.storageUrl }
          : {}),
        ...(activeFirestoreJob?.storagePath
          ? { storagePath: activeFirestoreJob.storagePath }
          : {}),
      };
    }
    return activeFirestoreJob;
  }, [liveJobResponse, activeJobId, activeFirestoreJob]);

  // Reset preview error/fallback state whenever a newly completed or switched job loads
  useEffect(() => {
    setVideoPlaybackError(null);
    setVideoDimensions(null);
    setVideoSourceMode(displayedJob?.downloadUrl ? 'local' : 'storage');
  }, [displayedJob?.id, displayedJob?.updatedAt, displayedJob?.downloadUrl]);

  const isAnyJobActive = useMemo(() => {
    if (displayedJob) {
      if (displayedJob.status === 'processing') return true;
      if (displayedJob.status === 'queued' && !displayedJob.visualReviewReady) return true;
    }
    return aiVideoJobs.some((j) => {
      if (j.id === displayedJob?.id && displayedJob.visualReviewReady && displayedJob.status === 'queued') {
        return false;
      }
      if (j.status === 'processing') return true;
      if (j.status === 'queued' && j.progress < 50) return true;
      return false;
    });
  }, [displayedJob, aiVideoJobs]);

  const handleUploadFinishedVideoToStorage = useCallback(
    async (job: AiVideoJobRecord) => {
      if (!job.downloadUrl || !job.outputFileName) return;
      if (job.storageUrl) return;
      setStorageUploadPct(1);
      setStorageUploadError(null);
      try {
        const uploaded = await uploadAiVideoToStorage(
          userId,
          job.id,
          job.outputFileName,
          job.downloadUrl,
          (pct) => setStorageUploadPct(pct)
        );
        await updateAiVideoJobInFirestore(userId, job.id, {
          storageUrl: uploaded.downloadUrl,
          storagePath: uploaded.storagePath,
        });
        setStorageUploadPct(null);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Could not upload MP4 to Firebase Storage.';
        setStorageUploadPct(null);
        setStorageUploadError(msg);
      }
    },
    [userId]
  );

  // Poll active job status from backend & sync key progress/completion to Firestore
  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    let lastSyncedBucket = -1;

    const pollOnce = async () => {
      try {
        const res = await pollAiVideoJobApi(activeJobId);
        if (cancelled) return;
        setLiveJobResponse(res);

        const job = res.job;
        const progressBucket = Math.floor(job.progress / 10);
        const isReviewReady = job.status === 'queued' && Boolean(job.visualReviewReady);
        const isTerminal =
          job.status === 'completed' ||
          job.status === 'failed' ||
          job.status === 'cancelled';

        if (isTerminal || isReviewReady || progressBucket > lastSyncedBucket) {
          lastSyncedBucket = progressBucket;
          void updateAiVideoJobInFirestore(userId, job.id, {
            status: job.status,
            currentStage: job.currentStage,
            stageMessage: job.stageMessage,
            progress: job.progress,
            completedScenes: job.completedScenes,
            sceneStates: job.sceneStates,
            subtitlesCount: job.subtitlesCount,
            ...(job.outputFileName ? { outputFileName: job.outputFileName } : {}),
            ...(typeof job.outputWidth === 'number'
              ? { outputWidth: job.outputWidth }
              : {}),
            ...(typeof job.outputHeight === 'number'
              ? { outputHeight: job.outputHeight }
              : {}),
            ...(typeof job.actualDurationSec === 'number'
              ? { actualDurationSec: job.actualDurationSec }
              : {}),
            ...(typeof job.outputBytes === 'number'
              ? { outputBytes: job.outputBytes }
              : {}),
            ...(job.downloadUrl ? { downloadUrl: job.downloadUrl } : {}),
            ...(job.srtDownloadUrl ? { srtDownloadUrl: job.srtDownloadUrl } : {}),
            error: job.error ? job.error : null,
          }).catch(() => {});
        }

        if (isReviewReady) {
          if (!reviewNotifiedJobsRef.current.has(job.id)) {
            reviewNotifiedJobsRef.current.add(job.id);
            onNotify(
              'Scene visuals verified',
              `All ${job.scenesCount} scene visuals are ready for review. Swap/regenerate any scene or click Render Final Video.`,
              'success'
            );
          }
          window.clearInterval(timerId);
        } else if (job.status === 'completed') {
          if (!autoUploadedJobsRef.current.has(job.id)) {
            autoUploadedJobsRef.current.add(job.id);
            onNotify(
              'AI video ready',
              `"${job.title}" rendered (${job.actualDurationSec?.toFixed(1) || job.durationSec}s MP4).`,
              'success'
            );
            void handleUploadFinishedVideoToStorage(job);
          }
          window.clearInterval(timerId);
        } else if (job.status === 'failed') {
          onNotify(
            'AI video generation failed',
            job.error || job.stageMessage,
            'error'
          );
          window.clearInterval(timerId);
        } else if (job.status === 'cancelled') {
          onNotify('AI video cancelled', 'Generation stopped by user.', 'info');
          window.clearInterval(timerId);
        }
      } catch {
        // Keep polling transiently unless terminal; user may also check Firestore
      }
    };

    void pollOnce();
    const timerId = window.setInterval(() => {
      void pollOnce();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [activeJobId, pollNonce, userId, onNotify, handleUploadFinishedVideoToStorage]);

  const handleGenerateScriptFromIdea = async () => {
    if (!ideaInput.trim()) {
      onNotify('Idea required', 'Enter a short topic or video idea first.', 'error');
      return;
    }
    setIsGeneratingIdea(true);
    try {
      const result = await generateScriptFromIdeaApi({
        idea: ideaInput.trim(),
        durationSec,
        style,
        language,
      });
      setTitle(result.title);
      setScript(result.script);
      setScenePlan(null);
      setEditableScenes([]);
      setCostEstimate(null);
      setShowIdeaDrawer(false);
      onNotify(
        'Script drafted',
        `Created ${durationSec}s ${language} script. Review or edit before planning scenes.`,
        'success'
      );
    } catch (err) {
      onNotify(
        'Script generation failed',
        err instanceof Error ? err.message : 'Gemini request failed.',
        'error'
      );
    } finally {
      setIsGeneratingIdea(false);
    }
  };

  const playBase64Audio = async (
    audioBase64: string,
    mimeType: string,
    kind: 'voice' | 'music'
  ) => {
    stopAudioPreview();
    const binary = window.atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioPlayerRef.current = audio;
    setPlayingKind(kind);

    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (audioPlayerRef.current === audio) {
        audioPlayerRef.current = null;
      }
      setPlayingKind(null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      setPlayingKind(null);
      onNotify('Audio playback failed', 'Your browser could not decode the audio preview.', 'error');
    };
    await audio.play();
  };

  const handlePreviewVoice = async () => {
    if (voice === 'none') {
      onNotify(
        'No voiceover selected',
        'Select an AI voice (such as Kore or Puck) to preview narration.',
        'info'
      );
      return;
    }
    if (playingKind === 'voice') {
      stopAudioPreview();
      return;
    }
    setPreviewingKind('voice');
    try {
      const sampleSentence = script
        .trim()
        .split(/(?<=[.!?।])\s+/)[0]
        ?.slice(0, 180);
      const audio = await previewAiVideoVoiceApi({
        voice,
        language,
        sampleText: sampleSentence || undefined,
        visualEngine,
      });
      await playBase64Audio(audio.audioBase64, audio.mimeType, 'voice');
    } catch (err) {
      onNotify(
        'Voice preview failed',
        err instanceof Error ? err.message : 'TTS preview error.',
        'error'
      );
    } finally {
      setPreviewingKind(null);
    }
  };

  const handlePreviewMusic = async () => {
    if (musicPreset === 'none') return;
    if (playingKind === 'music') {
      stopAudioPreview();
      return;
    }
    setPreviewingKind('music');
    try {
      const audio = await previewAiVideoMusicApi({ preset: musicPreset });
      await playBase64Audio(audio.audioBase64, audio.mimeType, 'music');
    } catch (err) {
      onNotify(
        'Music preview failed',
        err instanceof Error ? err.message : 'Could not load music preview.',
        'error'
      );
    } finally {
      setPreviewingKind(null);
    }
  };

  const handlePlanScenes = async () => {
    if (!script.trim()) {
      onNotify('Script required', 'Paste or generate a script before planning scenes.', 'error');
      return;
    }
    setIsPlanning(true);
    setPlanningNote(null);
    try {
      const res = await planAiVideoScenesApi({
        script: script.trim(),
        style,
        durationSec,
        aspectRatio,
        language,
        title: title.trim() || undefined,
        musicPreset,
        visualEngine,
      });
      setScenePlan(res.plan);
      setEditableScenes(res.plan.scenes);
      setCostEstimate(res.costEstimate);
      setPlanningNote(res.planningNote || null);
      if (!title.trim() || title === 'Untitled AI Video') {
        setTitle(res.plan.title);
      }
      onNotify(
        res.planningMode === 'local-fallback'
          ? 'Scene storyboard ready (Local Splitter)'
          : 'Scene storyboard ready',
        res.planningNote ||
          `Planned ${res.plan.scenes.length} scenes totaling ${res.plan.totalDuration}s. Review & confirm to generate video.`,
        res.planningMode === 'local-fallback' ? 'info' : 'success'
      );
    } catch (err) {
      onNotify(
        'Scene planning failed',
        err instanceof Error ? err.message : 'Could not create scene plan.',
        'error'
      );
    } finally {
      setIsPlanning(false);
    }
  };

  const handleUpdateScene = (
    idx: number,
    patch: Partial<AiVideoScenePlanItem>
  ) => {
    setEditableScenes((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, ...patch } : item))
    );
  };

  const handleAddScene = () => {
    if (editableScenes.length >= MAX_AI_VIDEO_SCENES) {
      onNotify(
        'Scene limit reached',
        `Maximum ${MAX_AI_VIDEO_SCENES} scenes per video.`,
        'info'
      );
      return;
    }
    const nextNum = editableScenes.length + 1;
    setEditableScenes((prev) => [
      ...prev,
      {
        sceneNumber: nextNum,
        duration: 5,
        narration: '',
        visualDescription: 'Closing visual frame',
        imageSearchQuery: title.trim() || 'cinematic motion visual',
        visualPrompt: `Cinematic ${style} shot in crisp lighting matching earlier scenes, smooth gentle motion`,
        cameraMovement: 'Slow push in',
        visualStyle: style,
        subtitle: '',
        transitionType: 'fade',
      },
    ]);
  };

  const handleRemoveScene = (idx: number) => {
    if (editableScenes.length <= 1) return;
    setEditableScenes((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, sceneNumber: i + 1 }))
    );
  };

  const handleAutoBalanceDurations = () => {
    setEditableScenes((prev) => rebalanceDurations(prev, durationSec));
  };

  const buildValidatedScenesForStart = () =>
    editableScenes.map((s, i) => ({
      ...s,
      sceneNumber: i + 1,
      duration: Math.max(3, Math.min(10, Math.round(Number(s.duration) || 5))),
    }));

  const handlePrepareVisuals = async () => {
    if (isPreparingVisuals || isStartingJob || isAnyJobActive) {
      onNotify(
        'Generation in progress',
        'Wait for the active AI video job to finish or cancel it before preparing visuals.',
        'info'
      );
      return;
    }
    if (editableScenes.length === 0) {
      onNotify('Scene plan required', 'Plan scenes before preparing visuals.', 'error');
      return;
    }
    if (plannedTotalSec > MAX_AI_VIDEO_DURATION_SEC) {
      onNotify(
        'Duration cap exceeded',
        `Total planned duration (${plannedTotalSec}s) exceeds ${MAX_AI_VIDEO_DURATION_SEC}s limit.`,
        'error'
      );
      return;
    }

    setIsPreparingVisuals(true);
    setStorageUploadError(null);
    const jobId = `aivid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const cleanScenes = buildValidatedScenesForStart();
    reviewNotifiedJobsRef.current.delete(jobId);

    const initialRecord: AiVideoJobRecord = {
      id: jobId,
      userId,
      visualEngine,
      ...(visualEngine === 'free-motion' ? { freeVisualStyle } : {}),
      title: (title.trim() || scenePlan?.title || 'AI Generated Video').slice(0, 160),
      originalScript: script.trim(),
      style,
      durationSec,
      aspectRatio,
      language,
      voice,
      narrationVolume,
      musicPreset,
      musicVolume,
      enableSubtitles,
      subtitleStyle,
      status: 'queued',
      currentStage: 'analyzing_script',
      stageMessage: 'Sourcing & verifying scene visuals for review...',
      progress: 5,
      scenesCount: cleanScenes.length,
      completedScenes: 0,
      sceneStates: cleanScenes.map((s) => ({
        sceneNumber: s.sceneNumber,
        duration: s.duration,
        status: 'queued',
        attempts: 0,
        visualStatus: 'pending',
      })),
      subtitlesCount: cleanScenes.filter((s) => (s.subtitle || s.narration).trim()).length,
      estimatedCostUsd: costEstimate?.estimatedUsd ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveAiVideoJobToFirestore(userId, initialRecord);
      const started = await prepareAiVideoVisualsApi({
        jobId,
        visualEngine,
        freeVisualStyle: visualEngine === 'free-motion' ? freeVisualStyle : undefined,
        visualSourceMode,
        relevanceThreshold,
        storyContext: scenePlan?.storyContext,
        title: initialRecord.title,
        originalScript: initialRecord.originalScript,
        style,
        durationSec,
        aspectRatio,
        language,
        voice,
        narrationVolume,
        musicPreset,
        musicVolume,
        enableSubtitles,
        subtitleStyle,
        scenes: cleanScenes,
      });

      setActiveJobId(started.job.id);
      setPollNonce((n) => n + 1);
      setLiveJobResponse(started);
      setVideoPlaybackError(null);
      onNotify(
        'Preparing & verifying visuals',
        `Sourcing and scoring images for ${cleanScenes.length} scenes (threshold ${relevanceThreshold}/100)...`,
        'info'
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not prepare scene visuals.';
      onNotify('Visual preparation failed', message, 'error');
      void updateAiVideoJobInFirestore(userId, jobId, {
        status: 'failed',
        stageMessage: 'Failed to prepare scene visuals',
        error: message,
      }).catch(() => {});
    } finally {
      setIsPreparingVisuals(false);
    }
  };

  const handleConfirmAndGenerate = async () => {
    if (isStartingJob || isPreparingVisuals || isAnyJobActive) {
      onNotify(
        'Generation in progress',
        'Wait for the active AI video job to finish or cancel it before starting another.',
        'info'
      );
      return;
    }
    if (editableScenes.length === 0) {
      onNotify('Scene plan required', 'Plan scenes before generating.', 'error');
      return;
    }
    if (plannedTotalSec > MAX_AI_VIDEO_DURATION_SEC) {
      onNotify(
        'Duration cap exceeded',
        `Total planned duration (${plannedTotalSec}s) exceeds ${MAX_AI_VIDEO_DURATION_SEC}s limit.`,
        'error'
      );
      return;
    }

    setIsStartingJob(true);
    setStorageUploadError(null);
    const jobId = `aivid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const cleanScenes = buildValidatedScenesForStart();

    const initialRecord: AiVideoJobRecord = {
      id: jobId,
      userId,
      visualEngine,
      ...(visualEngine === 'free-motion' ? { freeVisualStyle } : {}),
      title: (title.trim() || scenePlan?.title || 'AI Generated Video').slice(0, 160),
      originalScript: script.trim(),
      style,
      durationSec,
      aspectRatio,
      language,
      voice,
      narrationVolume,
      musicPreset,
      musicVolume,
      enableSubtitles,
      subtitleStyle,
      status: 'queued',
      currentStage: 'analyzing_script',
      stageMessage:
        visualEngine === 'free-motion'
          ? 'Queued context-aware video pipeline...'
          : 'Queued AI video pipeline...',
      progress: 5,
      scenesCount: cleanScenes.length,
      completedScenes: 0,
      sceneStates: cleanScenes.map((s) => ({
        sceneNumber: s.sceneNumber,
        duration: s.duration,
        status: 'queued',
        attempts: 0,
      })),
      subtitlesCount: cleanScenes.filter((s) => (s.subtitle || s.narration).trim()).length,
      estimatedCostUsd: costEstimate?.estimatedUsd ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveAiVideoJobToFirestore(userId, initialRecord);
      const started = await startAiVideoGenerationApi({
        jobId,
        visualEngine,
        freeVisualStyle: visualEngine === 'free-motion' ? freeVisualStyle : undefined,
        visualSourceMode,
        relevanceThreshold,
        storyContext: scenePlan?.storyContext,
        confirmedByUser: true,
        title: initialRecord.title,
        originalScript: initialRecord.originalScript,
        style,
        durationSec,
        aspectRatio,
        language,
        voice,
        narrationVolume,
        musicPreset,
        musicVolume,
        enableSubtitles,
        subtitleStyle,
        scenes: cleanScenes,
      });

      setShowConfirmModal(false);
      setActiveJobId(started.job.id);
      setPollNonce((n) => n + 1);
      setLiveJobResponse(started);
      setVideoPlaybackError(null);
      onNotify(
        visualEngine === 'free-motion'
          ? 'Context-aware video pipeline started'
          : 'AI video pipeline started',
        visualEngine === 'free-motion'
          ? `Generating, verifying & animating ${cleanScenes.length} scenes...`
          : `Generating ${cleanScenes.length} AI clips & voiceover...`,
        'info'
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not start AI video job.';
      onNotify('Could not start generation', message, 'error');
      void updateAiVideoJobInFirestore(userId, jobId, {
        status: 'failed',
        stageMessage: 'Failed to start generation',
        error: message,
      }).catch(() => {});
    } finally {
      setIsStartingJob(false);
    }
  };

  const handleRegenerateSceneVisual = async (sceneNumber: number) => {
    if (!displayedJob) return;
    setRegeneratingSceneNum(sceneNumber);
    try {
      const updated = await regenerateSceneVisualApi(displayedJob.id, sceneNumber, {
        customPrompt: regenPromptDraft.trim() || undefined,
        customSearchQuery: regenQueryDraft.trim() || undefined,
        visualSourceMode,
        relevanceThreshold,
        autoRender: false,
      });
      setLiveJobResponse(updated);
      setExpandedSceneRegenNum(null);
      await updateAiVideoJobInFirestore(userId, updated.job.id, {
        sceneStates: updated.job.sceneStates,
        stageMessage: updated.job.stageMessage,
      }).catch(() => {});
      const updatedState = updated.job.sceneStates.find(
        (s) => s.sceneNumber === sceneNumber
      );
      onNotify(
        `Scene ${sceneNumber} visual updated`,
        `Source: ${formatVisualSourceLabel(
          updatedState?.imageSource,
          Boolean(updatedState?.imageUrl),
          updatedState?.visualStatus
        )} · Relevance: ${updatedState?.relevanceScore ?? '—'}/100`,
        'success'
      );
    } catch (err) {
      onNotify(
        `Could not regenerate Scene ${sceneNumber}`,
        err instanceof Error ? err.message : 'Visual regeneration failed.',
        'error'
      );
    } finally {
      setRegeneratingSceneNum(null);
    }
  };

  const handleReplaceSceneImage = async (sceneNumber: number, file: File) => {
    if (!displayedJob) return;
    if (file.size > 15 * 1024 * 1024) {
      onNotify('Image too large', 'Please upload an image under 15MB.', 'error');
      return;
    }
    setUploadingSceneNum(sceneNumber);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });
      const updated = await replaceSceneImageApi(displayedJob.id, sceneNumber, {
        imageBase64: dataUrl,
        fileName: file.name,
      });
      setLiveJobResponse(updated);
      await updateAiVideoJobInFirestore(userId, updated.job.id, {
        sceneStates: updated.job.sceneStates,
        stageMessage: updated.job.stageMessage,
      }).catch(() => {});
      const updatedState = updated.job.sceneStates.find(
        (s) => s.sceneNumber === sceneNumber
      );
      onNotify(
        `Scene ${sceneNumber} image replaced`,
        `Applied "${file.name}" · AI relevance ${updatedState?.relevanceScore ?? '—'}/100`,
        'success'
      );
    } catch (err) {
      onNotify(
        `Upload failed for Scene ${sceneNumber}`,
        err instanceof Error ? err.message : 'Could not apply uploaded image.',
        'error'
      );
    } finally {
      setUploadingSceneNum(null);
    }
  };

  const handleRenderFinalFromPrepared = async () => {
    if (!displayedJob) return;
    setIsRenderingFinal(true);
    setStorageUploadError(null);
    setVideoPlaybackError(null);
    autoUploadedJobsRef.current.delete(displayedJob.id);
    try {
      const started = await renderFinalFromPreparedApi(displayedJob.id, {
        narrationVolume,
        musicPreset,
        musicVolume,
        enableSubtitles,
        subtitleStyle,
      });
      setActiveJobId(started.job.id);
      setLiveJobResponse(started);
      setPollNonce((n) => n + 1);
      await updateAiVideoJobInFirestore(userId, started.job.id, {
        status: started.job.status,
        currentStage: started.job.currentStage,
        stageMessage: started.job.stageMessage,
        progress: started.job.progress,
        narrationVolume,
        musicPreset,
        musicVolume,
        enableSubtitles,
        subtitleStyle,
      }).catch(() => {});
      onNotify(
        'Rendering final video',
        'Animating verified scenes, synchronizing voiceover, and exporting MP4...',
        'info'
      );
    } catch (err) {
      onNotify(
        'Render failed',
        err instanceof Error ? err.message : 'Could not render final MP4 from prepared visuals.',
        'error'
      );
    } finally {
      setIsRenderingFinal(false);
    }
  };

  const handleCancelJob = async () => {
    if (!displayedJob) return;
    try {
      await cancelAiVideoJobApi(displayedJob.id);
      onNotify('Cancelling job', 'Stopping active video generation tasks...', 'info');
    } catch (err) {
      onNotify(
        'Cancel failed',
        err instanceof Error ? err.message : 'Could not cancel job.',
        'error'
      );
    }
  };

  const handleRetryJob = async () => {
    if (!displayedJob) return;
    try {
      const restarted = await retryAiVideoJobApi(displayedJob.id);
      setActiveJobId(restarted.job.id);
      setLiveJobResponse(restarted);
      onNotify(
        'Retrying AI video job',
        'Reusing completed clips/audio and retrying remaining steps.',
        'info'
      );
    } catch (err) {
      onNotify(
        'Retry unavailable',
        err instanceof Error ? err.message : 'Could not retry job on server.',
        'error'
      );
    }
  };

  const handleRerenderMusicAndSubtitles = async () => {
    if (!displayedJob) return;
    setIsRerendering(true);
    setStorageUploadError(null);
    setVideoPlaybackError(null);
    autoUploadedJobsRef.current.delete(displayedJob.id);
    try {
      const updated = await rerenderAiVideoJobApi(displayedJob.id, {
        narrationVolume,
        musicPreset,
        musicVolume,
        enableSubtitles,
        subtitleStyle,
      });
      setActiveJobId(updated.job.id);
      setLiveJobResponse(updated);
      await updateAiVideoJobInFirestore(userId, displayedJob.id, {
        narrationVolume,
        musicPreset,
        musicVolume,
        enableSubtitles,
        subtitleStyle,
        status: 'processing',
        progress: 76,
        stageMessage: 'Re-compositing existing scene clips with updated audio & subtitles...',
      });
      onNotify(
        'Re-rendering final MP4',
        'Reusing your generated scene clips & voiceover with updated audio/subtitles.',
        'info'
      );
    } catch (err) {
      onNotify(
        'Re-render failed',
        err instanceof Error
          ? err.message
          : 'Could not re-render job. Original clips may have expired after server restart.',
        'error'
      );
    } finally {
      setIsRerendering(false);
    }
  };

  const handleInspectHistoryJob = async (job: AiVideoJobRecord) => {
    setActiveJobId(job.id);
    setLiveJobResponse(null);
    setStorageUploadError(null);
    setVideoPlaybackError(null);
    setVideoDimensions(null);
    setVideoSourceMode(job.downloadUrl ? 'local' : 'storage');
    try {
      const fresh = await pollAiVideoJobApi(job.id);
      setLiveJobResponse(fresh);
      if (fresh.scenes.length > 0) {
        setEditableScenes(fresh.scenes);
      }
    } catch {
      // Server in-memory/temp files might not have an older job; Firestore fields + storageUrl still work
    }
  };

  const localVideoUrl =
    displayedJob?.status === 'completed' ? displayedJob.downloadUrl || null : null;
  const cloudVideoUrl =
    displayedJob?.status === 'completed' ? displayedJob.storageUrl || null : null;

  const activeVideoSrc =
    displayedJob?.status === 'completed'
      ? videoSourceMode === 'storage'
        ? cloudVideoUrl || localVideoUrl
        : localVideoUrl || cloudVideoUrl
      : null;

  const activeDownloadHref =
    displayedJob?.status === 'completed'
      ? videoSourceMode === 'storage' && cloudVideoUrl
        ? cloudVideoUrl
        : localVideoUrl
        ? `${localVideoUrl}${localVideoUrl.includes('?') ? '&' : '?'}download=1`
        : cloudVideoUrl || null
      : null;

  const stagesList = useMemo(() => {
    if (liveJobResponse && liveJobResponse.job.id === displayedJob?.id) {
      return liveJobResponse.stages;
    }

    const stageOrder = AI_VIDEO_DETAILED_STAGES;
    const legacyToDetailedIndex: Record<string, number> = {
      analyzing_script: 0,
      creating_scene_plan: 1,
      generating_clips: displayedJob?.visualReviewReady ? 3 : 2,
      generating_voiceover: 5,
      creating_subtitles: 5,
      combining_media: 5,
      exporting_mp4: 6,
    };
    const currIdx =
      legacyToDetailedIndex[displayedJob?.currentStage || 'analyzing_script'] ?? 0;

    return stageOrder.map((st, idx) => {
      if (displayedJob?.status === 'completed') {
        return { ...st, status: 'completed' as const };
      }
      if (displayedJob?.visualReviewReady && displayedJob.status === 'queued') {
        return {
          ...st,
          status: idx <= 3 ? ('completed' as const) : ('pending' as const),
        };
      }
      if (displayedJob?.status === 'failed') {
        return {
          ...st,
          status:
            idx < currIdx
              ? ('completed' as const)
              : idx === currIdx
              ? ('failed' as const)
              : ('pending' as const),
        };
      }
      if (displayedJob?.status === 'cancelled') {
        return {
          ...st,
          status:
            idx < currIdx
              ? ('completed' as const)
              : idx === currIdx
              ? ('cancelled' as const)
              : ('pending' as const),
        };
      }
      return {
        ...st,
        status:
          idx < currIdx
            ? ('completed' as const)
            : idx === currIdx
            ? ('active' as const)
            : ('pending' as const),
      };
    });
  }, [liveJobResponse, displayedJob]);

  const subtitleCues: VideoSubtitleCue[] = useMemo(() => {
    if (liveJobResponse && liveJobResponse.job.id === displayedJob?.id) {
      return liveJobResponse.subtitles;
    }
    return [];
  }, [liveJobResponse, displayedJob?.id]);

  return (
    <div className="space-y-6 pb-10">
      {/* Studio Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-sm">
              <Clapperboard className="h-4.5 w-4.5" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                AI Video Generator
              </h1>
              <p className="text-sm text-[var(--text-muted)]">
                Turn any script into a multi-scene AI video with voiceover narration, subtitles, and mixed music.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 font-mono tabular-nums">
            <Film className="h-3.5 w-3.5 text-violet-500" />
            Max {MAX_AI_VIDEO_SCENES} scenes · {MAX_AI_VIDEO_DURATION_SEC}s
          </span>
        </div>
      </div>

      {/* Main Two-Column Studio Workspace */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* LEFT COLUMN: Script, Settings & Scene Plan Storyboard */}
        <div className="space-y-5 xl:col-span-7">
          {/* Card 1: Script Input & Idea Generator */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
              <div>
                <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                  1. Script &amp; Concept
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  No video upload required. Paste your script verbatim or draft one from an idea.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowIdeaDrawer((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/35 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300 transition-colors hover:bg-violet-500/20 whitespace-nowrap shrink-0"
              >
                <Wand2 className="h-3.5 w-3.5" />
                <span>{showIdeaDrawer ? 'Hide Idea Writer' : 'Generate from Idea'}</span>
              </button>
            </div>

            {showIdeaDrawer && (
              <div className="mb-4 rounded-xl border border-violet-500/30 bg-[var(--bg-surface)] p-3.5 space-y-2.5">
                <label className="block text-xs font-medium text-[var(--text-primary)]">
                  Describe your video idea or topic
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={ideaInput}
                    onChange={(e) => setIdeaInput(e.target.value)}
                    placeholder="e.g., 3 AI tools helping solo founders ship 5x faster"
                    className="flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleGenerateScriptFromIdea()}
                    disabled={isGeneratingIdea || !ideaInput.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:from-violet-500 hover:to-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {isGeneratingIdea ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>Write {durationSec}s Script</span>
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Project Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={140}
                  placeholder="Enter video title"
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">
                    Voiceover Script (preserved verbatim in scene narration)
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {SAMPLE_SCRIPTS.map((sample) => (
                      <button
                        key={sample.label}
                        type="button"
                        onClick={() => {
                          setTitle(sample.title);
                          setScript(sample.script);
                          setDurationSec(sample.durationSec);
                          setStyle(sample.style);
                          setScenePlan(null);
                          setEditableScenes([]);
                        }}
                        className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:border-violet-500/40 hover:text-[var(--text-primary)]"
                      >
                        {sample.label}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  rows={5}
                  value={script}
                  onChange={(e) => {
                    setScript(e.target.value);
                  }}
                  placeholder="Paste your narration script here... The AI planner will map your exact script into timed visual scenes without silently rewriting your words."
                  className="w-full resize-y rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none"
                />

                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                  <span className="font-mono tabular-nums">
                    {scriptStats.words} words · ~{scriptStats.estSpeakSec}s spoken pace
                  </span>
                  {script.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setScript('');
                        setScenePlan(null);
                        setEditableScenes([]);
                        setCostEstimate(null);
                      }}
                      className="text-xs font-medium text-[var(--text-muted)] hover:text-rose-500"
                    >
                      Clear script
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Video Format, Style, Voice, Music & Subtitles */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-xs space-y-5">
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                2. Video Engine, Style, Audio &amp; Captions
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Choose Free AI Image + Motion Video ($0.00 total cost) or Paid AI Omni Video, plus free voiceover, music &amp; subtitles.
              </p>
            </div>

            {/* Video Generation Mode Selector */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Video Generation Mode
              </label>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setVisualEngine('free-motion')}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    visualEngine === 'free-motion'
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                      <Film className="h-3.5 w-3.5 text-emerald-500" />
                      Free AI Image + Motion Video
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      $0.00 · 100% Free
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                    Generates free AI scene images (FLUX / SD3.5 / AI Horde) or retrieves open-license visuals, verifies every image with Gemini Vision, and renders HD animated MP4 with free Edge Neural voiceover &amp; music at $0.00 cost.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setVisualEngine('ai-omni')}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    visualEngine === 'ai-omni'
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                      <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                      AI Omni Video (Paid Key)
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-violet-600 dark:text-violet-400">
                      6-Stage · Omni + Veo
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                    Generates scene images (gemini-3.1-flash-lite-image), verifies accuracy with Gemini Vision, and animates frames via gemini-omni-1.2-flash (~$0.045/sec, paid billing API key required).
                  </p>
                </button>
              </div>

              <div className="mt-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-center">
                  <div className="sm:col-span-7">
                    <span className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                      <Layers className="h-3 w-3 text-violet-500" />
                      Scene Image Sourcing Mode
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          {
                            id: 'ai-then-retrieve',
                            label: 'AI + Retrieval',
                          },
                          {
                            id: 'ai-only',
                            label: 'AI Image Only',
                          },
                          {
                            id: 'retrieve-only',
                            label: 'Web/Wiki Only',
                          },
                        ] as const
                      ).map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setVisualSourceMode(mode.id)}
                          className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors ${
                            visualSourceMode === mode.id
                              ? 'border-violet-500 bg-violet-500/10 text-[var(--text-primary)]'
                              : 'border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="sm:col-span-5">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="inline-flex items-center gap-1 font-medium text-[var(--text-secondary)]">
                        <ShieldCheck className="h-3 w-3 text-emerald-500" />
                        Vision Relevance Gate
                      </span>
                      <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        ≥ {relevanceThreshold}/100
                      </span>
                    </div>
                    <input
                      type="range"
                      min={60}
                      max={98}
                      step={1}
                      value={relevanceThreshold}
                      onChange={(e) => setRelevanceThreshold(Number(e.target.value))}
                      className="h-1.5 w-full accent-emerald-600"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Duration, Aspect Ratio, Language */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  Target Duration
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {AI_VIDEO_DURATIONS.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setDurationSec(sec)}
                      className={`rounded-xl border py-2 font-mono text-xs font-semibold tabular-nums transition-colors ${
                        durationSec === sec
                          ? 'border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                          : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  Aspect Ratio
                </label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as VideoAspectRatio)}
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  {ASPECT_RATIOS.map((ar) => (
                    <option key={ar.id} value={ar.id}>
                      {ar.label} ({ar.spec})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as ContentLanguage)}
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Visual Style Grid */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
                Visual Style
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {AI_VIDEO_STYLES.map((item) => {
                  const selected = style === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStyle(item.id)}
                      className={`rounded-xl border p-2.5 text-left transition-colors ${
                        selected
                          ? 'border-violet-500 bg-violet-500/10'
                          : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <p className="text-xs font-semibold text-[var(--text-primary)]">
                        {item.label}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--text-muted)]">
                        {item.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Voiceover & Background Music */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Voiceover */}
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                    <Mic className="h-3.5 w-3.5 text-violet-500" />
                    Voiceover (Free Unlimited / Offline)
                  </span>
                  {voice !== 'none' && (
                    <button
                      type="button"
                      onClick={() => void handlePreviewVoice()}
                      disabled={previewingKind === 'voice'}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-violet-500/50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {previewingKind === 'voice' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : playingKind === 'voice' ? (
                        <Square className="h-3 w-3 text-rose-500" />
                      ) : (
                        <Volume2 className="h-3 w-3 text-violet-500" />
                      )}
                      <span>{playingKind === 'voice' ? 'Stop' : 'Preview Voice'}</span>
                    </button>
                  )}
                </div>

                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as AiVideoVoiceId)}
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  {AI_VIDEO_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} — {v.tone}
                    </option>
                  ))}
                </select>

                {voice !== 'none' && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                      Voice level
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={narrationVolume}
                      onChange={(e) => setNarrationVolume(Number(e.target.value))}
                      className="h-1.5 flex-1 accent-violet-600"
                    />
                    <span className="w-10 text-right font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">
                      {Math.round(narrationVolume * 100)}%
                    </span>
                  </div>
                )}

                <p className="text-[11px] leading-snug text-[var(--text-muted)]">
                  {AI_VIDEO_VOICES.find((v) => v.id === voice)?.styleDirection} ({language}).{' '}
                  {voice === 'none'
                    ? 'Unlimited local renders with music & burned subtitles.'
                    : visualEngine === 'free-motion'
                    ? 'Free Unlimited Neural Voiceover — zero TTS quota limits or API cost.'
                    : 'Uses Gemini TTS with automatic Free Neural TTS fallback.'}
                </p>
              </div>

              {/* Background Music */}
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                    <Music className="h-3.5 w-3.5 text-blue-500" />
                    Background Music
                  </span>
                  {musicPreset !== 'none' && (
                    <button
                      type="button"
                      onClick={() => void handlePreviewMusic()}
                      disabled={previewingKind === 'music'}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-blue-500/50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {previewingKind === 'music' ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : playingKind === 'music' ? (
                        <Square className="h-3 w-3 text-rose-500" />
                      ) : (
                        <Play className="h-3 w-3 text-blue-500" />
                      )}
                      <span>{playingKind === 'music' ? 'Stop' : 'Preview Music'}</span>
                    </button>
                  )}
                </div>

                <select
                  value={musicPreset}
                  onChange={(e) => setMusicPreset(e.target.value as AiVideoMusicPreset)}
                  className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                >
                  {AI_VIDEO_MUSIC_PRESETS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>

                {musicPreset !== 'none' && (
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                      Duck level
                    </span>
                    <input
                      type="range"
                      min={0.05}
                      max={0.6}
                      step={0.01}
                      value={musicVolume}
                      onChange={(e) => setMusicVolume(Number(e.target.value))}
                      className="h-1.5 flex-1 accent-violet-600"
                    />
                    <span className="w-9 text-right font-mono text-[11px] text-[var(--text-secondary)] tabular-nums">
                      {Math.round(musicVolume * 100)}%
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Subtitles Config */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                  <input
                    type="checkbox"
                    checked={enableSubtitles}
                    onChange={(e) => setEnableSubtitles(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--border-strong)] accent-violet-600"
                  />
                  <Subtitles className="h-3.5 w-3.5 text-violet-500" />
                  <span>Burn Synchronized Subtitles into MP4</span>
                </label>

                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={subtitleStyle.uppercase}
                    disabled={!enableSubtitles}
                    onChange={(e) =>
                      setSubtitleStyle((s) => ({ ...s, uppercase: e.target.checked }))
                    }
                    className="h-3.5 w-3.5 rounded accent-violet-600"
                  />
                  <span>UPPERCASE</span>
                </label>
              </div>

              {enableSubtitles && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                      Position
                    </label>
                    <select
                      value={subtitleStyle.position}
                      onChange={(e) =>
                        setSubtitleStyle((s) => ({
                          ...s,
                          position: e.target.value as SubtitlePosition,
                        }))
                      }
                      className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                    >
                      <option value="bottom">Bottom</option>
                      <option value="middle">Middle</option>
                      <option value="top">Top</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                      Font Size
                    </label>
                    <input
                      type="number"
                      min={24}
                      max={72}
                      value={subtitleStyle.fontSize}
                      onChange={(e) =>
                        setSubtitleStyle((s) => ({
                          ...s,
                          fontSize: Math.max(24, Math.min(72, Number(e.target.value) || 44)),
                        }))
                      }
                      className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-primary)]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                      Text Color
                    </label>
                    <input
                      type="color"
                      value={subtitleStyle.primaryColor}
                      onChange={(e) =>
                        setSubtitleStyle((s) => ({ ...s, primaryColor: e.target.value }))
                      }
                      className="h-8 w-full cursor-pointer rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] p-0.5"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                      Outline Color
                    </label>
                    <input
                      type="color"
                      value={subtitleStyle.outlineColor}
                      onChange={(e) =>
                        setSubtitleStyle((s) => ({ ...s, outlineColor: e.target.value }))
                      }
                      className="h-8 w-full cursor-pointer rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] p-0.5"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Step 1 Primary Action */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-xs text-[var(--text-muted)]">
                Step 1 builds a JSON storyboard and calculates your exact video estimate before spending video credits.
              </p>
              <button
                type="button"
                onClick={() => void handlePlanScenes()}
                disabled={isPlanning || !script.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-violet-500 hover:to-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {isPlanning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>{editableScenes.length > 0 ? 'Re-Plan Scenes with AI' : 'Plan Scenes with AI'}</span>
              </button>
            </div>
          </section>

          {/* Card 3: Editable AI Scene Storyboard */}
          {editableScenes.length > 0 && (
            <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-3">
                <div>
                  <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                    3. Scene Plan Preview ({editableScenes.length}/{MAX_AI_VIDEO_SCENES} scenes)
                  </h2>
                  <p className="text-xs text-[var(--text-muted)]">
                    Review and customize prompts, transitions, and durations before generating video clips.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold tabular-nums ${
                      plannedTotalSec === durationSec
                        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : plannedTotalSec > MAX_AI_VIDEO_DURATION_SEC
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    <Clock className="h-3 w-3" />
                    {plannedTotalSec}s / {durationSec}s
                  </span>

                  {plannedTotalSec !== durationSec && (
                    <button
                      type="button"
                      onClick={handleAutoBalanceDurations}
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      Match {durationSec}s
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleAddScene}
                    disabled={editableScenes.length >= MAX_AI_VIDEO_SCENES}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] hover:border-violet-500/40 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add Scene</span>
                  </button>
                </div>
              </div>

              {planningNote && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
                  {planningNote}
                </div>
              )}

              {/* Stage 1: Story Understanding & Visual Continuity Context */}
              {scenePlan?.storyContext && (
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                      <SlidersHorizontal className="h-3.5 w-3.5 text-violet-500" />
                      Stage 1 Script Context &amp; Continuity
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-muted)]">
                      {scenePlan.storyContext.genre} · {scenePlan.storyContext.timelineOrEra} · {scenePlan.storyContext.moodAndTone}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    <span className="font-medium text-[var(--text-primary)]">
                      {scenePlan.storyContext.mainTopic}:
                    </span>{' '}
                    {scenePlan.storyContext.visualConsistencyGuide || scenePlan.storyContext.summary}
                  </p>
                  {(scenePlan.storyContext.characters.length > 0 ||
                    scenePlan.storyContext.locations.length > 0) && (
                    <div className="grid grid-cols-1 gap-2 border-t border-[var(--border-default)] pt-2 sm:grid-cols-2 text-[11px]">
                      {scenePlan.storyContext.characters.length > 0 && (
                        <div>
                          <p className="font-semibold text-[var(--text-secondary)]">
                            Consistent Subjects
                          </p>
                          <ul className="mt-0.5 space-y-0.5 text-[var(--text-muted)]">
                            {scenePlan.storyContext.characters.slice(0, 3).map((ch, i) => (
                              <li key={i} className="truncate">
                                <span className="font-medium text-[var(--text-primary)]">
                                  {ch.name}
                                </span>{' '}
                                — {ch.visualAppearance}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {scenePlan.storyContext.locations.length > 0 && (
                        <div>
                          <p className="font-semibold text-[var(--text-secondary)]">
                            Environments
                          </p>
                          <ul className="mt-0.5 space-y-0.5 text-[var(--text-muted)]">
                            {scenePlan.storyContext.locations.slice(0, 3).map((loc, i) => (
                              <li key={i} className="truncate">
                                <span className="font-medium text-[var(--text-primary)]">
                                  {loc.name}
                                </span>{' '}
                                — {loc.visualDetails}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {editableScenes.map((scene, idx) => {
                  const isDetailsOpen = Boolean(expandedSceneDetails[scene.sceneNumber]);
                  return (
                    <div
                      key={`scene-${scene.sceneNumber}-${idx}`}
                      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-violet-600/15 px-1.5 font-mono text-xs font-bold text-violet-700 dark:text-violet-300">
                            S{scene.sceneNumber}
                          </span>
                          <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
                            {scene.mainSubject || scene.cameraMovement || 'Scene Visual'}
                          </span>
                          {scene.location && (
                            <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                              · {scene.location}
                            </span>
                          )}
                          {scene.emotionalTone && (
                            <span className="truncate font-mono text-[11px] text-[var(--text-muted)]">
                              · {scene.emotionalTone}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSceneDetails((prev) => ({
                                ...prev,
                                [scene.sceneNumber]: !prev[scene.sceneNumber],
                              }))
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          >
                            {isDetailsOpen ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                            <span>Visual Specs</span>
                          </button>

                          <label className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                            <span>Sec:</span>
                            <input
                              type="number"
                              min={3}
                              max={10}
                              value={scene.duration}
                              onChange={(e) =>
                                handleUpdateScene(idx, {
                                  duration: Math.max(3, Math.min(10, Number(e.target.value) || 3)),
                                })
                              }
                              className="w-14 rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 font-mono text-xs text-[var(--text-primary)]"
                            />
                          </label>

                          <select
                            value={scene.transitionType}
                            onChange={(e) =>
                              handleUpdateScene(idx, {
                                transitionType: e.target.value as AiVideoTransitionType,
                              })
                            }
                            className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
                          >
                            {TRANSITIONS.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>

                          {editableScenes.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveScene(idx)}
                              aria-label={`Remove scene ${scene.sceneNumber}`}
                              className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">
                            Voiceover Narration (Verbatim)
                          </label>
                          <textarea
                            rows={2}
                            value={scene.narration}
                            onChange={(e) =>
                              handleUpdateScene(idx, { narration: e.target.value })
                            }
                            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">
                            AI Visual / Image Prompt ({aspectRatio})
                          </label>
                          <textarea
                            rows={2}
                            value={scene.imageGenerationPrompt || scene.visualPrompt}
                            onChange={(e) =>
                              handleUpdateScene(idx, {
                                imageGenerationPrompt: e.target.value,
                                visualPrompt: e.target.value,
                              })
                            }
                            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">
                            Subtitle Line
                          </label>
                          <input
                            type="text"
                            value={scene.subtitle}
                            onChange={(e) =>
                              handleUpdateScene(idx, { subtitle: e.target.value })
                            }
                            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">
                            Camera &amp; Animation Direction
                          </label>
                          <input
                            type="text"
                            value={scene.animationInstructions || scene.cameraMovement}
                            onChange={(e) =>
                              handleUpdateScene(idx, {
                                animationInstructions: e.target.value,
                                cameraMovement: e.target.value,
                              })
                            }
                            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      {visualSourceMode !== 'ai-only' && (
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">
                            Scene-Specific Image Search Query
                          </label>
                          <input
                            type="text"
                            value={scene.imageSearchQuery || ''}
                            onChange={(e) =>
                              handleUpdateScene(idx, { imageSearchQuery: e.target.value })
                            }
                            placeholder="e.g., Apollo 11 astronaut lunar surface"
                            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      )}

                      {isDetailsOpen && (
                        <div className="grid grid-cols-1 gap-2 border-t border-[var(--border-default)] pt-2.5 sm:grid-cols-3">
                          <div>
                            <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                              Main Subject
                            </label>
                            <input
                              type="text"
                              value={scene.mainSubject || ''}
                              onChange={(e) =>
                                handleUpdateScene(idx, { mainSubject: e.target.value })
                              }
                              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)]"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                              Action
                            </label>
                            <input
                              type="text"
                              value={scene.action || ''}
                              onChange={(e) =>
                                handleUpdateScene(idx, { action: e.target.value })
                              }
                              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)]"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                              Location / Era
                            </label>
                            <input
                              type="text"
                              value={scene.location || ''}
                              onChange={(e) =>
                                handleUpdateScene(idx, { location: e.target.value })
                              }
                              className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-primary)]"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Cost Estimate & Dual-Flow Generate / Preview Visuals CTA */}
              <div
                className={`flex flex-col gap-3 rounded-xl border p-4 lg:flex-row lg:items-center lg:justify-between ${
                  visualEngine === 'free-motion' && musicPreset !== 'ai-lyria'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-violet-500/30 bg-violet-500/5'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                    <DollarSign
                      className={`h-3.5 w-3.5 ${
                        visualEngine === 'free-motion' && musicPreset !== 'ai-lyria'
                          ? 'text-emerald-500'
                          : 'text-violet-500'
                      }`}
                    />
                    <span>
                      {visualEngine === 'free-motion' && musicPreset !== 'ai-lyria'
                        ? 'Estimated Cost: '
                        : 'Estimated AI Cost: '}
                      <span
                        className={`font-mono tabular-nums ${
                          visualEngine === 'free-motion' && musicPreset !== 'ai-lyria'
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-violet-700 dark:text-violet-300'
                        }`}
                      >
                        {visualEngine === 'free-motion' && musicPreset !== 'ai-lyria'
                          ? '$0.00 USD (Context-Aware Motion)'
                          : `~$${(costEstimate?.estimatedUsd ?? 0).toFixed(2)} USD`}
                      </span>
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {visualEngine === 'free-motion'
                      ? `${editableScenes.length} verified visuals (≥${relevanceThreshold}/100) + scene-derived camera motion + ${
                          voice === 'none' ? 'captions only' : 'free-tier TTS narration'
                        }`
                      : `${editableScenes.length} verified scene images + ${
                          costEstimate?.videoModel || 'gemini-omni-1.2-flash'
                        } image-to-video + TTS narration`}
                    {musicPreset === 'ai-lyria'
                      ? ' + Lyria 3 music (paid)'
                      : ' + local synthesized music'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handlePrepareVisuals()}
                    disabled={
                      isPreparingVisuals ||
                      isStartingJob ||
                      isAnyJobActive ||
                      plannedTotalSec > MAX_AI_VIDEO_DURATION_SEC
                    }
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {isPreparingVisuals ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                    <span>Preview &amp; Verify Visuals</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    disabled={isAnyJobActive || isPreparingVisuals || plannedTotalSec > MAX_AI_VIDEO_DURATION_SEC}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-violet-500 hover:to-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Clapperboard className="h-4 w-4" />
                    <span>{isAnyJobActive ? 'Generation Running...' : 'Generate Video'}</span>
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* RIGHT COLUMN: Live Pipeline Tracker, Final MP4 Preview & History */}
        <div className="space-y-5 xl:col-span-5">
          {/* Active Job Progress & Per-Scene Status */}
          {displayedJob && (
            <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-xs space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                    Generation Pipeline
                  </p>
                  <h3 className="truncate font-display text-base font-bold text-[var(--text-primary)]">
                    {displayedJob.title}
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {displayedJob.stageMessage}
                  </p>
                </div>

                <span
                  className={`shrink-0 rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold tabular-nums ${
                    displayedJob.status === 'completed'
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : displayedJob.status === 'failed'
                      ? 'border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-300'
                      : displayedJob.status === 'cancelled'
                      ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                  }`}
                >
                  {displayedJob.progress}%
                </span>
              </div>

              {/* Overall Progress Bar */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
                <div
                  className={`h-full transition-all duration-300 ${
                    displayedJob.status === 'failed'
                      ? 'bg-rose-500'
                      : displayedJob.status === 'cancelled'
                      ? 'bg-amber-500'
                      : displayedJob.status === 'completed'
                      ? 'bg-emerald-500'
                      : 'bg-gradient-to-r from-violet-600 to-blue-600'
                  }`}
                  style={{ width: `${Math.max(3, displayedJob.progress)}%` }}
                />
              </div>

              {/* 7 Pipeline Stages */}
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {stagesList.map((st) => (
                  <div
                    key={st.id}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                      st.status === 'active'
                        ? 'border-violet-500/40 bg-violet-500/10 font-medium text-[var(--text-primary)]'
                        : st.status === 'completed'
                        ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'
                        : st.status === 'failed'
                        ? 'border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-300'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)]'
                    }`}
                  >
                    {st.status === 'active' ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-500" />
                    ) : st.status === 'completed' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : st.status === 'failed' ? (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                    ) : (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-current opacity-35" />
                    )}
                    <span className="truncate">{st.label}</span>
                  </div>
                ))}
              </div>

              {/* Per-Scene Visual Review, Gemini Vision Scores & Regeneration Controls */}
              {displayedJob.sceneStates.length > 0 && (() => {
                const effectiveThreshold =
                  displayedJob.relevanceThreshold ?? DEFAULT_RELEVANCE_THRESHOLD;
                const usableVisualsCount = displayedJob.sceneStates.filter((sc) => {
                  const scScore = sc.relevanceScore ?? sc.verification?.relevanceScore;
                  return (
                    sc.status === 'approved' ||
                    sc.status === 'completed' ||
                    sc.visualStatus === 'approved' ||
                    sc.visualStatus === 'verified' ||
                    sc.visualStatus === 'fallback' ||
                    (Boolean(sc.imageUrl) &&
                      (typeof scScore !== 'number' || scScore >= effectiveThreshold))
                  );
                }).length;
                const animatedScenesCount = displayedJob.sceneStates.filter(
                  (sc) => sc.status === 'completed'
                ).length;

                return (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Scene Visuals, Relevance &amp; Animation ({usableVisualsCount}/
                      {displayedJob.scenesCount} visuals · {animatedScenesCount}/
                      {displayedJob.scenesCount} animated)
                    </p>
                    {displayedJob.visualReviewReady && displayedJob.status === 'queued' && (
                      <button
                        type="button"
                        onClick={() => void handleRenderFinalFromPrepared()}
                        disabled={isRenderingFinal}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:from-violet-500 hover:to-blue-500 disabled:opacity-50"
                      >
                        {isRenderingFinal ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Clapperboard className="h-3.5 w-3.5" />
                        )}
                        <span>Render Final Video</span>
                      </button>
                    )}
                  </div>

                  <div className="max-h-[540px] space-y-2.5 overflow-y-auto pr-1">
                    {displayedJob.sceneStates.map((sc) => {
                      const planScene =
                        liveJobResponse?.scenes.find(
                          (s) => s.sceneNumber === sc.sceneNumber
                        ) ||
                        editableScenes.find((s) => s.sceneNumber === sc.sceneNumber);
                      const score =
                        sc.relevanceScore ?? sc.verification?.relevanceScore;
                      const isRegenOpen = expandedSceneRegenNum === sc.sceneNumber;
                      const isAttemptsOpen =
                        expandedAttemptsSceneNum === sc.sceneNumber;
                      const isSceneBusy =
                        regeneratingSceneNum === sc.sceneNumber ||
                        uploadingSceneNum === sc.sceneNumber;
                      const canEditScene =
                        displayedJob.status !== 'processing' &&
                        Boolean(liveJobResponse && liveJobResponse.job.id === displayedJob.id);
                      const isScoreHigh =
                        typeof score === 'number' && score >= effectiveThreshold;
                      const isVisualApproved =
                        sc.status === 'approved' ||
                        sc.status === 'completed' ||
                        sc.visualStatus === 'approved' ||
                        sc.visualStatus === 'verified' ||
                        sc.visualStatus === 'fallback' ||
                        (Boolean(sc.imageUrl) &&
                          (typeof score !== 'number' || isScoreHigh));
                      const displaySceneStatus =
                        sc.status === 'completed'
                          ? 'completed'
                          : sc.status === 'failed'
                          ? 'failed'
                          : sc.status === 'cancelled'
                          ? 'cancelled'
                          : sc.visualStatus === 'verifying'
                          ? 'verifying'
                          : sc.visualStatus === 'sourcing'
                          ? 'sourcing'
                          : sc.status === 'generating' ||
                            sc.status === 'retrying' ||
                            sc.animationStatus === 'animating'
                          ? 'animating'
                          : isVisualApproved
                          ? 'approved'
                          : 'queued';

                      return (
                        <div
                          key={`clip-state-${sc.sceneNumber}`}
                          className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 space-y-2.5"
                        >
                          <div className="flex gap-3">
                            {/* Scene Image Thumbnail */}
                            <div className="h-20 w-24 shrink-0 overflow-hidden rounded-lg border border-[var(--border-default)] bg-slate-950/60 flex items-center justify-center">
                              {sc.imageUrl ? (
                                <img
                                  src={sc.imageUrl}
                                  alt={sc.imageTitle || `Scene ${sc.sceneNumber}`}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-5 w-5 text-[var(--text-muted)] opacity-50" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-xs font-bold text-[var(--text-primary)]">
                                    Scene {sc.sceneNumber}
                                  </span>
                                  <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                                    {sc.duration}s
                                    {typeof sc.audioDurationSec === 'number'
                                      ? ` · TTS ${sc.audioDurationSec.toFixed(1)}s`
                                      : ''}
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 font-mono text-[11px]">
                                  {typeof score === 'number' && (
                                    <span
                                      className={`font-semibold tabular-nums ${
                                        isScoreHigh
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : 'text-amber-600 dark:text-amber-400'
                                      }`}
                                    >
                                      {score}/100
                                    </span>
                                  )}
                                  <span
                                    className={
                                      displaySceneStatus === 'completed' ||
                                      displaySceneStatus === 'approved'
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : displaySceneStatus === 'failed'
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : displaySceneStatus === 'cancelled'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : displaySceneStatus === 'animating' ||
                                          displaySceneStatus === 'verifying' ||
                                          displaySceneStatus === 'sourcing'
                                        ? 'text-violet-600 dark:text-violet-400'
                                        : 'text-[var(--text-muted)]'
                                    }
                                  >
                                    {displaySceneStatus}
                                  </span>
                                </div>
                              </div>

                              <p className="truncate text-[11px] text-[var(--text-secondary)]">
                                {formatVisualSourceLabel(
                                  sc.imageSource,
                                  Boolean(sc.imageUrl),
                                  sc.visualStatus
                                )}
                                {sc.imageTitle ? ` · ${sc.imageTitle}` : ''}
                                {sc.animationStyle ? ` · Motion: ${sc.animationStyle}` : ''}
                              </p>

                              {sc.imageAttribution && (
                                <p className="truncate text-[10px] text-[var(--text-muted)]">
                                  {sc.imageAttribution}
                                </p>
                              )}

                              {sc.verification && (
                                <div className="space-y-0.5 text-[11px] text-[var(--text-muted)]">
                                  <p className="font-mono text-[10px] tabular-nums">
                                    Subject {sc.verification.subjectMatch}% · Action{' '}
                                    {sc.verification.actionMatch}% · Context{' '}
                                    {sc.verification.contextMatch}%
                                    {sc.verification.modelUsed
                                      ? ` · ${sc.verification.modelUsed}`
                                      : ''}
                                  </p>
                                  <p className="line-clamp-2 text-[11px] text-[var(--text-secondary)]">
                                    {sc.verification.reason}
                                  </p>
                                  {sc.verification.contradictions && (
                                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                      Note: {sc.verification.contradictions}
                                    </p>
                                  )}
                                </div>
                              )}

                              {sc.error && (
                                <p className="line-clamp-2 text-[11px] text-red-600 dark:text-red-400">
                                  {sc.error}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Per-scene interactive controls */}
                          {(canEditScene || (sc.visualAttempts && sc.visualAttempts.length > 0)) && (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {canEditScene && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isRegenOpen) {
                                          setExpandedSceneRegenNum(null);
                                        } else {
                                          setRegenPromptDraft(
                                            planScene?.imageGenerationPrompt ||
                                              planScene?.visualPrompt ||
                                              ''
                                          );
                                          setRegenQueryDraft(
                                            planScene?.imageSearchQuery || ''
                                          );
                                          setExpandedSceneRegenNum(sc.sceneNumber);
                                        }
                                      }}
                                      disabled={isSceneBusy}
                                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-violet-500/40 disabled:opacity-50"
                                    >
                                      {regeneratingSceneNum === sc.sceneNumber ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <RefreshCw className="h-3 w-3 text-violet-500" />
                                      )}
                                      <span>Regenerate Visual</span>
                                    </button>

                                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2 py-1 text-[11px] font-medium text-[var(--text-primary)] hover:border-emerald-500/40">
                                      {uploadingSceneNum === sc.sceneNumber ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Upload className="h-3 w-3 text-emerald-500" />
                                      )}
                                      <span>Upload Image</span>
                                      <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        disabled={isSceneBusy}
                                        onChange={(e) => {
                                          const f = e.target.files?.[0];
                                          e.target.value = '';
                                          if (f) {
                                            void handleReplaceSceneImage(
                                              sc.sceneNumber,
                                              f
                                            );
                                          }
                                        }}
                                        className="hidden"
                                      />
                                    </label>
                                  </>
                                )}
                              </div>

                              {sc.visualAttempts && sc.visualAttempts.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedAttemptsSceneNum(
                                      isAttemptsOpen ? null : sc.sceneNumber
                                    )
                                  }
                                  className="text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                >
                                  {isAttemptsOpen
                                    ? 'Hide attempts'
                                    : `${sc.visualAttempts.length} attempt${
                                        sc.visualAttempts.length > 1 ? 's' : ''
                                      }`}
                                </button>
                              )}
                            </div>
                          )}

                          {isRegenOpen && canEditScene && (
                            <div className="space-y-2 rounded-lg border border-violet-500/25 bg-[var(--bg-card)] p-2.5">
                              <div>
                                <label className="mb-1 block text-[10px] font-medium text-[var(--text-muted)]">
                                  Custom AI Image Prompt
                                </label>
                                <textarea
                                  rows={2}
                                  value={regenPromptDraft}
                                  onChange={(e) => setRegenPromptDraft(e.target.value)}
                                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-medium text-[var(--text-muted)]">
                                  Custom Image Search Query
                                </label>
                                <input
                                  type="text"
                                  value={regenQueryDraft}
                                  onChange={(e) => setRegenQueryDraft(e.target.value)}
                                  className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-2 py-1 text-[11px] text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                                />
                              </div>
                              <div className="flex justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setExpandedSceneRegenNum(null)}
                                  className="rounded-lg border border-[var(--border-default)] px-2.5 py-1 text-[11px] text-[var(--text-muted)]"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={regeneratingSceneNum === sc.sceneNumber}
                                  onClick={() =>
                                    void handleRegenerateSceneVisual(sc.sceneNumber)
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                                >
                                  {regeneratingSceneNum === sc.sceneNumber && (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  )}
                                  <span>Run Verification &amp; Update</span>
                                </button>
                              </div>
                            </div>
                          )}

                          {isAttemptsOpen && sc.visualAttempts && (
                            <div className="space-y-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-2 text-[10px]">
                              {sc.visualAttempts.map((att, aIdx) => (
                                <div
                                  key={aIdx}
                                  className="flex items-start justify-between gap-2 border-b border-[var(--border-default)] pb-1 last:border-b-0 last:pb-0"
                                >
                                  <div className="min-w-0">
                                    <span className="font-mono font-semibold text-[var(--text-primary)]">
                                      #{att.attempt} {formatVisualSourceLabel(att.source)}
                                    </span>{' '}
                                    <span className="text-[var(--text-muted)]">
                                      ({att.queryOrPrompt})
                                    </span>
                                    <p className="text-[var(--text-secondary)]">
                                      {att.reason}
                                    </p>
                                  </div>
                                  <span
                                    className={`shrink-0 font-mono font-semibold ${
                                      att.decision === 'accepted'
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : att.decision === 'rejected'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : 'text-rose-500'
                                    }`}
                                  >
                                    {typeof att.relevanceScore === 'number'
                                      ? `${att.relevanceScore}/100`
                                      : att.decision}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })()}

              {/* Error & Action Controls */}
              {displayedJob.error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                  <p className="leading-relaxed">{displayedJob.error}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {(displayedJob.status === 'processing' ||
                  (displayedJob.status === 'queued' && !displayedJob.visualReviewReady)) && (
                  <button
                    type="button"
                    onClick={() => void handleCancelJob()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-500/20"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Cancel Generation</span>
                  </button>
                )}

                {displayedJob.visualReviewReady && displayedJob.status === 'queued' && (
                  <button
                    type="button"
                    onClick={() => void handleRenderFinalFromPrepared()}
                    disabled={isRenderingFinal}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-50"
                  >
                    {isRenderingFinal ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Clapperboard className="h-3.5 w-3.5" />
                    )}
                    <span>Render Final Video Now</span>
                  </button>
                )}

                {(displayedJob.status === 'failed' ||
                  displayedJob.status === 'cancelled') && (
                  <button
                    type="button"
                    onClick={() => void handleRetryJob()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Retry Failed / Remaining</span>
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Final Video Preview & MP4 Export Card */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Final Video Preview
              </h2>
              <div className="flex items-center gap-2">
                {localVideoUrl && cloudVideoUrl && localVideoUrl !== cloudVideoUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setVideoPlaybackError(null);
                      setVideoSourceMode((m) => (m === 'local' ? 'storage' : 'local'));
                    }}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Source: {videoSourceMode === 'storage' ? 'Cloud Storage' : 'Local Server'}
                  </button>
                )}
                {(videoDimensions?.width || displayedJob?.outputWidth) &&
                  (videoDimensions?.height || displayedJob?.outputHeight) && (
                    <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
                      {videoDimensions?.width || displayedJob?.outputWidth}×
                      {videoDimensions?.height || displayedJob?.outputHeight}
                    </span>
                  )}
              </div>
            </div>

            {activeVideoSrc && displayedJob ? (
              <div className="space-y-4">
                <div className="flex justify-center rounded-xl border border-[var(--border-default)] bg-slate-950 p-3">
                  <video
                    key={activeVideoSrc}
                    src={activeVideoSrc}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      setVideoPlaybackError(null);
                      const v = e.currentTarget;
                      if (v.videoWidth && v.videoHeight) {
                        setVideoDimensions({ width: v.videoWidth, height: v.videoHeight });
                      }
                    }}
                    onError={(e) => {
                      if (
                        videoSourceMode === 'local' &&
                        cloudVideoUrl &&
                        cloudVideoUrl !== activeVideoSrc
                      ) {
                        setVideoSourceMode('storage');
                        return;
                      }
                      const mediaErr = e.currentTarget.error;
                      const detail = mediaErr?.message || `MediaError code ${mediaErr?.code ?? 'unknown'}`;
                      setVideoPlaybackError(
                        `Video stream could not be loaded in preview (${detail}). Ensure the MP4 exists on the server or in Firebase Storage, or use Download MP4 below.`
                      );
                    }}
                    className={`rounded-lg bg-black shadow-lg ${
                      displayedJob.aspectRatio === '9:16'
                        ? 'aspect-[9/16] max-h-[460px]'
                        : displayedJob.aspectRatio === '1:1'
                        ? 'aspect-square max-h-[380px]'
                        : 'aspect-video w-full'
                    }`}
                  />
                </div>

                {videoPlaybackError && (
                  <div className="flex flex-col gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                      <p className="leading-relaxed">{videoPlaybackError}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setVideoPlaybackError(null);
                        setVideoSourceMode(
                          videoSourceMode === 'local' && cloudVideoUrl
                            ? 'storage'
                            : localVideoUrl
                            ? 'local'
                            : 'storage'
                        );
                      }}
                      className="shrink-0 rounded-lg border border-rose-500/40 bg-[var(--bg-card)] px-2.5 py-1 font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                    >
                      Retry Preview
                    </button>
                  </div>
                )}

                {/* Metadata Grid */}
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 text-center">
                  <div>
                    <p className="text-[11px] text-[var(--text-muted)]">Duration</p>
                    <p className="font-mono text-xs font-semibold text-[var(--text-primary)] tabular-nums">
                      {(displayedJob.actualDurationSec ?? displayedJob.durationSec).toFixed(1)}s
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[var(--text-muted)]">File Size</p>
                    <p className="font-mono text-xs font-semibold text-[var(--text-primary)] tabular-nums">
                      {formatBytes(displayedJob.outputBytes)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[var(--text-muted)]">Subtitles</p>
                    <p className="font-mono text-xs font-semibold text-[var(--text-primary)] tabular-nums">
                      {displayedJob.subtitlesCount} cues
                    </p>
                  </div>
                </div>

                {/* Cloud Storage Persistence Status */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs">
                  {displayedJob.storageUrl ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Saved to Firebase Storage</span>
                    </span>
                  ) : storageUploadPct !== null ? (
                    <span className="inline-flex items-center gap-1.5 text-violet-600 dark:text-violet-400 font-mono tabular-nums">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Uploading MP4 to Storage ({storageUploadPct}%)...</span>
                    </span>
                  ) : (
                    <>
                      <span className="text-[var(--text-muted)]">
                        {storageUploadError
                          ? `Storage sync note: ${storageUploadError}`
                          : 'MP4 available on server'}
                      </span>
                      {displayedJob.downloadUrl && (
                        <button
                          type="button"
                          onClick={() => void handleUploadFinishedVideoToStorage(displayedJob)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-violet-600 dark:text-violet-400 hover:underline"
                        >
                          <CloudUpload className="h-3.5 w-3.5" />
                          <span>Save to Cloud</span>
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Export & Re-render Actions */}
                <div className="flex flex-wrap gap-2">
                  {activeDownloadHref && (
                    <a
                      href={activeDownloadHref}
                      download={displayedJob.outputFileName || 'ai-video.mp4'}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:from-violet-500 hover:to-blue-500 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download MP4</span>
                    </a>
                  )}

                  {displayedJob.srtDownloadUrl && (
                    <a
                      href={displayedJob.srtDownloadUrl}
                      download="subtitles.srt"
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-xs font-medium text-[var(--text-primary)] hover:border-violet-500/40 whitespace-nowrap"
                    >
                      <FileText className="h-3.5 w-3.5 text-violet-500" />
                      <span>Download SRT</span>
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleRerenderMusicAndSubtitles()}
                    disabled={isRerendering || isAnyJobActive}
                    title="Re-compose existing AI clips and voiceover with current music/subtitle settings"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-2.5 text-xs font-medium text-[var(--text-primary)] hover:border-violet-500/40 disabled:opacity-50 whitespace-nowrap"
                  >
                    {isRerendering ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                    )}
                    <span>Re-render Audio/Subtitles</span>
                  </button>
                </div>

                {subtitleCues.length > 0 && (
                  <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        Generated Subtitles ({subtitleCues.length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onCopyText(
                            subtitleCues
                              .map((c) => `[${c.startSec.toFixed(1)}s-${c.endSec.toFixed(1)}s] ${c.text}`)
                              .join('\n'),
                            'Subtitles timeline'
                          )
                        }
                        className="text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:underline"
                      >
                        Copy Transcript
                      </button>
                    </div>
                    <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-[var(--text-secondary)]">
                      {subtitleCues.map((cue) => (
                        <div key={cue.id} className="flex gap-2">
                          <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                            {cue.startSec.toFixed(1)}s
                          </span>
                          <span>{cue.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] px-6 py-12 text-center">
                <Clapperboard className="h-8 w-8 text-violet-500/70" />
                <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">
                  Your AI-generated MP4 appears here
                </p>
                <p className="mt-1 max-w-xs text-xs text-[var(--text-muted)]">
                  Plan your scenes on the left, review the estimated cost, and click Generate Video to synthesize real AI clips, voiceover, and subtitles.
                </p>
              </div>
            )}
          </section>

          {/* Generated AI Videos History */}
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-[var(--text-primary)]">
                Generated AI Videos ({aiVideoJobs.length})
              </h2>
            </div>

            {aiVideoJobs.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                No AI-generated videos yet. Completed and in-progress jobs are tracked automatically.
              </p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {aiVideoJobs.map((job) => {
                  const isSelected = job.id === activeJobId;
                  const dlUrl = job.storageUrl || (job.downloadUrl ? `${job.downloadUrl}&download=1` : null);
                  return (
                    <div
                      key={job.id}
                      className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
                        isSelected
                          ? 'border-violet-500/45 bg-violet-500/5'
                          : 'border-[var(--border-default)] bg-[var(--bg-surface)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => void handleInspectHistoryJob(job)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                          {job.title}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                          {job.visualEngine === 'free-motion' ? 'Free Motion' : 'AI Video'} · {job.aspectRatio} · {job.durationSec}s · {job.scenesCount} scenes ·{' '}
                          <span
                            className={
                              job.status === 'completed'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : job.status === 'failed'
                                ? 'text-rose-500'
                                : 'text-violet-500'
                            }
                          >
                            {job.status}
                          </span>
                        </p>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        {job.status === 'completed' && dlUrl && (
                          <a
                            href={dlUrl}
                            download={job.outputFileName || 'ai-video.mp4'}
                            aria-label={`Download ${job.title}`}
                            className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-violet-500"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => void onDeleteAiVideoJob(job.id)}
                          aria-label={`Delete ${job.title}`}
                          className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Explicit Cost & Limits Confirmation Modal */}
      {showConfirmModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm AI Video Generation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
                    {visualEngine === 'free-motion'
                      ? 'Confirm Free AI Video Generation ($0.00)'
                      : 'Confirm AI Omni Video Generation'}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {visualEngine === 'free-motion'
                      ? `Pipeline will generate free AI / open-license scene images, verify each with Gemini Vision (≥${relevanceThreshold}/100), and render all ${editableScenes.length} animated HD scenes at $0.00 cost.`
                      : `Pipeline will generate & Vision-verify unique scene images, then animate all ${editableScenes.length} clips via Gemini Omni image-to-video.`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Video Engine</span>
                <span className="font-mono font-medium text-[var(--text-primary)]">
                  {costEstimate?.videoModel ||
                    (visualEngine === 'free-motion'
                      ? 'ffmpeg-motion-local'
                      : 'gemini-omni-1.2-flash')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">
                  Voiceover ({voice === 'none' ? 'Offline' : `${voice}, ${language}`})
                </span>
                <span className="font-mono font-medium text-[var(--text-primary)]">
                  {voice === 'none'
                    ? 'None (100% Offline · $0.00)'
                    : costEstimate?.ttsModel ||
                      (visualEngine === 'free-motion'
                        ? 'edge-neural-tts (Free Unlimited)'
                        : 'gemini-3.8-flash-lite-tts')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Scenes &amp; Duration</span>
                <span className="font-mono font-medium text-[var(--text-primary)] tabular-nums">
                  {editableScenes.length} clips · {plannedTotalSec}s ({aspectRatio})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Music Track</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {AI_VIDEO_MUSIC_PRESETS.find((m) => m.id === musicPreset)?.label || musicPreset}
                </span>
              </div>
              <div className="border-t border-[var(--border-default)] pt-2 flex justify-between text-sm font-semibold">
                <span className="text-[var(--text-primary)]">Estimated Total Cost</span>
                <span
                  className={`font-mono tabular-nums ${
                    (costEstimate?.estimatedUsd ?? 0) === 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-violet-600 dark:text-violet-300'
                  }`}
                >
                  {(costEstimate?.estimatedUsd ?? 0) === 0
                    ? '$0.00 USD (Free)'
                    : `~$${(costEstimate?.estimatedUsd ?? 0).toFixed(2)} USD`}
                </span>
              </div>
            </div>

            {costEstimate?.notes && costEstimate.notes.length > 0 && (
              <ul className="space-y-1 text-[11px] text-[var(--text-muted)]">
                {costEstimate.notes.map((note, idx) => (
                  <li key={idx}>• {note}</li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isStartingJob}
                className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmAndGenerate()}
                disabled={isStartingJob}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:from-violet-500 hover:to-blue-500 disabled:opacity-50"
              >
                {isStartingJob ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Clapperboard className="h-3.5 w-3.5" />
                )}
                <span>Confirm &amp; Start Generation</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
