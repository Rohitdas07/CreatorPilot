import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import {
  AiVideoGeneratorView,
  type AiVideoScriptSeed,
} from './components/AiVideoGeneratorView';
import { AnalyticsView } from './components/AnalyticsView';
import { BrandKitView } from './components/BrandKitView';
import { ContentCalendarView } from './components/ContentCalendarView';
import { ContentStudioView } from './components/ContentStudioView';
import { DashboardView } from './components/DashboardView';
import { HistoryView } from './components/HistoryView';
import { ProfileView } from './components/ProfileView';
import { ProjectsView } from './components/ProjectsView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { ThumbnailStudioView } from './components/ThumbnailStudioView';
import { ToastContainer } from './components/Toast';
import { TopBar } from './components/TopBar';
import { VideoEditorView } from './components/VideoEditorView';
import { ForgotPasswordPage } from './components/auth/ForgotPasswordPage';
import { LoginPage } from './components/auth/LoginPage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { SignupPage } from './components/auth/SignupPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import {
  addAssistantMessage,
  clearGenerationsFromFirestore,
  createAssistantTask,
  createSocialPostDraft,
  deleteAiVideoJobFromFirestore,
  deleteGenerationFromFirestore,
  deleteProjectFromFirestore,
  deleteSocialPost,
  deleteThumbnailFromFirestore,
  deleteVideoJobFromFirestore,
  loadBrandKitFromFirestore,
  loadWorkspaceSettingsFromFirestore,
  saveAssistantConversation,
  saveBrandKitToFirestore,
  saveGenerationToFirestore,
  saveProjectToFirestore,
  saveWorkspaceSettingsToFirestore,
  subscribeToAiVideoJobs,
  subscribeToAssistantConversations,
  subscribeToAssistantMessages,
  subscribeToAssistantTasks,
  subscribeToGenerations,
  subscribeToProjects,
  subscribeToSocialConnections,
  subscribeToSocialPosts,
  subscribeToThumbnails,
  subscribeToVideoJobs,
  syncSocialConnectionMetadata,
  updateAssistantTask,
  updateSocialPost,
} from './services/firestoreService';
import {
  cancelScheduledSocialPost,
  disconnectSocialAccount,
  fetchSocialPostAnalytics,
  fetchSocialStatus,
  getSocialOAuthUrl,
  publishSocialPost,
  scheduleSocialPost,
  verifySocialConnection,
} from './services/socialApi';
import type {
  AssistantConversation,
  AssistantMessage,
  AssistantPipelineStep,
  AssistantTask,
  AssistantTaskOutputs,
} from './types/assistant';
import {
  DEFAULT_BRAND_KIT,
  type BrandKitConfig,
  type BrandKitPromptContext,
  type BrandTemplate,
} from './types/brandKit';
import type {
  ContentLanguage,
  CreatorProject,
  CreatorSettings,
  GeneratedContent,
  HistoryItem,
  NavSection,
  NotificationPreferences,
  Platform,
  ToastMessage,
  Tone,
  UploadedMediaInfo,
  VideoDuration,
  WorkspaceNotification,
} from './types/creator';
import type {
  SocialConnectionSummary,
  SocialMediaType,
  SocialPlatform,
  SocialPlatformRequirementInfo,
  SocialPost,
  YouTubePrivacyStatus,
} from './types/social';
import type {
  ThumbnailAsset,
  ThumbnailStudioDraftSeed,
} from './types/thumbnail';
import type { AiVideoDurationSec, AiVideoJobRecord } from './types/aiVideo';
import type { VideoRenderJob } from './types/videoEditor';
import { validateAndNormalizeGeneratedPayload } from './utils/contentValidation';
import {
  formatContentForDownload,
  type SamplePrompt,
} from './utils/sampleGenerator';
import {
  computeRealStats,
  createStarterDemoProjects,
  DEFAULT_SETTINGS,
} from './utils/storage';

function triggerBlobDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

const SECTION_ROUTES: Record<NavSection, string> = {
  dashboard: '/dashboard',
  create: '/create',
  'ai-video': '/ai-video',
  'video-editor': '/video-editor',
  thumbnails: '/thumbnails',
  calendar: '/calendar',
  analytics: '/analytics',
  'brand-kit': '/brand-kit',
  projects: '/projects',
  history: '/history',
  settings: '/settings',
  profile: '/profile',
};

function pathToSection(pathname: string): NavSection {
  if (pathname.startsWith('/create')) return 'create';
  if (pathname.startsWith('/ai-video')) return 'ai-video';
  if (pathname.startsWith('/video-editor')) return 'video-editor';
  if (pathname.startsWith('/thumbnails')) return 'thumbnails';
  if (pathname.startsWith('/calendar')) return 'calendar';
  if (pathname.startsWith('/analytics')) return 'analytics';
  if (pathname.startsWith('/brand-kit')) return 'brand-kit';
  if (pathname.startsWith('/projects')) return 'projects';
  if (pathname.startsWith('/history')) return 'history';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/profile')) return 'profile';
  return 'dashboard';
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  inAppToasts: true,
  assistantAlerts: true,
  socialPublishAlerts: true,
};

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem('creatorpilot_sidebar_collapsed') === 'true';
  } catch {
    return false;
  }
}

function readNotificationPrefs(uid?: string): NotificationPreferences {
  if (!uid) return DEFAULT_NOTIFICATION_PREFS;
  try {
    const raw = window.localStorage.getItem(`creatorpilot_notif_prefs:${uid}`);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      inAppToasts:
        typeof parsed.inAppToasts === 'boolean'
          ? parsed.inAppToasts
          : DEFAULT_NOTIFICATION_PREFS.inAppToasts,
      assistantAlerts:
        typeof parsed.assistantAlerts === 'boolean'
          ? parsed.assistantAlerts
          : DEFAULT_NOTIFICATION_PREFS.assistantAlerts,
      socialPublishAlerts:
        typeof parsed.socialPublishAlerts === 'boolean'
          ? parsed.socialPublishAlerts
          : DEFAULT_NOTIFICATION_PREFS.socialPublishAlerts,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

interface WorkspaceShellProps {
  notify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
  notifications: WorkspaceNotification[];
  onMarkAllRead: () => void;
  onClearNotifications: () => void;
  onSetToastEnabled: (enabled: boolean) => void;
}

function WorkspaceShell({
  notify: rawNotify,
  notifications,
  onMarkAllRead,
  onClearNotifications,
  onSetToastEnabled,
}: WorkspaceShellProps) {
  const { user, logout, updateUserProfile } = useAuth();
  const { syncUserTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const activeSection = pathToSection(location.pathname);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    readSidebarCollapsed
  );
  const [notificationPrefs, setNotificationPrefs] =
    useState<NotificationPreferences>(() => readNotificationPrefs(user?.uid));

  const [projects, setProjects] = useState<CreatorProject[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [settings, setSettings] = useState<CreatorSettings>(() => ({
    ...DEFAULT_SETTINGS,
    creatorName: user?.fullName || DEFAULT_SETTINGS.creatorName,
    brandHandle: user?.brandHandle || DEFAULT_SETTINGS.brandHandle,
    niche: user?.niche || DEFAULT_SETTINGS.niche,
    brandVoice: user?.brandVoice || DEFAULT_SETTINGS.brandVoice,
  }));

  const [sourceText, setSourceText] = useState('');
  const [platform, setPlatform] = useState<Platform>(settings.defaultPlatform);
  const [language, setLanguage] = useState<ContentLanguage>(
    settings.defaultLanguage
  );
  const [tone, setTone] = useState<Tone>(settings.defaultTone);
  const [duration, setDuration] = useState<VideoDuration>(settings.defaultDuration);
  const [niche, setNiche] = useState<string>(settings.niche);
  const [brandVoice, setBrandVoice] = useState<string>(settings.brandVoice);
  const [mediaInfo, setMediaInfo] = useState<UploadedMediaInfo | null>(null);
  const [generatedResult, setGeneratedResult] =
    useState<GeneratedContent | null>(null);
  const [activeProject, setActiveProject] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Autonomous AI Creator Assistant state
  const [assistantConversations, setAssistantConversations] = useState<
    AssistantConversation[]
  >([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [assistantMessages, setAssistantMessages] = useState<
    AssistantMessage[]
  >([]);
  const [assistantTasks, setAssistantTasks] = useState<AssistantTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isAssistantSubmitting, setIsAssistantSubmitting] = useState(false);
  const activePollTimersRef = useRef<Record<string, number>>({});

  // Official Social Media Integrations state
  const [socialRequirements, setSocialRequirements] = useState<
    SocialPlatformRequirementInfo[]
  >([]);
  const [socialConnections, setSocialConnections] = useState<
    SocialConnectionSummary[]
  >([]);
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [isSocialLoading, setIsSocialLoading] = useState(false);
  const [busySocialPlatform, setBusySocialPlatform] =
    useState<SocialPlatform | null>(null);
  const [busySocialPostId, setBusySocialPostId] = useState<string | null>(null);
  const socialPostsRef = useRef<SocialPost[]>([]);
  socialPostsRef.current = socialPosts;

  // AI Brand Kit & Smart Video Editor state
  const [brandKit, setBrandKit] = useState<BrandKitConfig>(DEFAULT_BRAND_KIT);
  const [isSavingBrandKit, setIsSavingBrandKit] = useState(false);
  const [applyBrandKit, setApplyBrandKit] = useState(true);
  const activeBrandTemplateIdState = useState('');
  const activeBrandTemplateId = activeBrandTemplateIdState[0];
  const setActiveBrandTemplateId = activeBrandTemplateIdState[1];
  const [videoJobs, setVideoJobs] = useState<VideoRenderJob[]>([]);
  const [aiVideoJobs, setAiVideoJobs] = useState<AiVideoJobRecord[]>([]);
  const [aiVideoScriptSeed, setAiVideoScriptSeed] =
    useState<AiVideoScriptSeed | null>(null);
  const [thumbnails, setThumbnails] = useState<ThumbnailAsset[]>([]);
  const [thumbnailSeed, setThumbnailSeed] =
    useState<ThumbnailStudioDraftSeed | null>(null);

  const stats = useMemo(() => computeRealStats(history), [history]);

  const handleSelectSection = useCallback(
    (section: NavSection) => {
      navigate(SECTION_ROUTES[section]);
    },
    [navigate]
  );

  const handleToggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          'creatorpilot_sidebar_collapsed',
          String(next)
        );
      } catch {
        // Ignore storage error
      }
      return next;
    });
  }, []);

  const handleChangeNotificationPrefs = useCallback(
    (nextPrefs: NotificationPreferences) => {
      setNotificationPrefs(nextPrefs);
      onSetToastEnabled(nextPrefs.inAppToasts);
      if (user?.uid) {
        try {
          window.localStorage.setItem(
            `creatorpilot_notif_prefs:${user.uid}`,
            JSON.stringify(nextPrefs)
          );
        } catch {
          // Ignore storage error
        }
      }
    },
    [user?.uid, onSetToastEnabled]
  );

  // Sync theme & notification preferences whenever authenticated user changes
  useEffect(() => {
    syncUserTheme(user?.uid ?? null);
    const loadedPrefs = readNotificationPrefs(user?.uid);
    setNotificationPrefs(loadedPrefs);
    onSetToastEnabled(loadedPrefs.inAppToasts);
  }, [user?.uid, syncUserTheme, onSetToastEnabled]);

  const notify = useCallback(
    (
      title: string,
      description?: string,
      variant: 'success' | 'info' | 'error' = 'success'
    ) => {
      const lowerTitle = title.toLowerCase();
      if (
        variant !== 'error' &&
        !notificationPrefs.assistantAlerts &&
        lowerTitle.includes('assistant')
      ) {
        return;
      }
      if (
        variant !== 'error' &&
        !notificationPrefs.socialPublishAlerts &&
        (lowerTitle.includes('social') ||
          lowerTitle.includes('published via official') ||
          lowerTitle.includes('post scheduled') ||
          lowerTitle.includes('post approved') ||
          lowerTitle.includes('analytics'))
      ) {
        return;
      }
      rawNotify(title, description, variant);
    },
    [
      rawNotify,
      notificationPrefs.assistantAlerts,
      notificationPrefs.socialPublishAlerts,
    ]
  );

  // Subscribe to authenticated user's Firestore projects, generations, and settings
  useEffect(() => {
    if (!user?.uid) return;
    setProjectsLoaded(false);
    setHistoryLoaded(false);

    const unsubProjects = subscribeToProjects(
      user.uid,
      (items) => {
        setProjects(items);
        setProjectsLoaded(true);
      },
      (err) => {
        setProjectsLoaded(true);
        notify('Firestore read error', err.message, 'error');
      }
    );

    const unsubHistory = subscribeToGenerations(
      user.uid,
      (items) => {
        setHistory(items);
        setHistoryLoaded(true);
      },
      (err) => {
        setHistoryLoaded(true);
        notify('Firestore read error', err.message, 'error');
      }
    );

    let cancelled = false;
    loadWorkspaceSettingsFromFirestore(user.uid)
      .then((loaded) => {
        if (cancelled) return;
        if (loaded) {
          setSettings(loaded);
          setPlatform(loaded.defaultPlatform);
          setLanguage(loaded.defaultLanguage);
          setTone(loaded.defaultTone);
          setDuration(loaded.defaultDuration);
          setNiche(loaded.niche || user.niche || DEFAULT_SETTINGS.niche);
          setBrandVoice(
            loaded.brandVoice || user.brandVoice || DEFAULT_SETTINGS.brandVoice
          );
        } else {
          const initial: CreatorSettings = {
            ...DEFAULT_SETTINGS,
            creatorName: user.fullName || DEFAULT_SETTINGS.creatorName,
            brandHandle: user.brandHandle || DEFAULT_SETTINGS.brandHandle,
            niche: user.niche || DEFAULT_SETTINGS.niche,
            brandVoice: user.brandVoice || DEFAULT_SETTINGS.brandVoice,
          };
          setSettings(initial);
          setNiche(initial.niche);
          setBrandVoice(initial.brandVoice);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          notify(
            'Could not load preferences',
            err instanceof Error ? err.message : 'Firestore error',
            'error'
          );
        }
      });

    const unsubAssistantConvs = subscribeToAssistantConversations(
      user.uid,
      (convs) => {
        setAssistantConversations(convs);
        setActiveConversationId((prev) => {
          if (prev && convs.some((c) => c.id === prev)) return prev;
          return convs[0]?.id ?? null;
        });
      },
      (err) => {
        notify('Assistant history read error', err.message, 'error');
      }
    );

    const unsubAssistantTasks = subscribeToAssistantTasks(
      user.uid,
      (tasks) => setAssistantTasks(tasks),
      (err) => {
        notify('Assistant tasks read error', err.message, 'error');
      }
    );

    const unsubSocialConns = subscribeToSocialConnections(
      user.uid,
      (conns) => {
        setSocialConnections((prev) => (prev.length > 0 ? prev : conns));
      },
      (err) => {
        notify('Social connections read error', err.message, 'error');
      }
    );

    const unsubSocialPosts = subscribeToSocialPosts(
      user.uid,
      (posts) => setSocialPosts(posts),
      (err) => {
        notify('Social queue read error', err.message, 'error');
      }
    );

    const unsubVideoJobs = subscribeToVideoJobs(
      user.uid,
      (jobs) => setVideoJobs(jobs),
      (err) => {
        notify('Video jobs read error', err.message, 'error');
      }
    );

    const unsubAiVideoJobs = subscribeToAiVideoJobs(
      user.uid,
      (jobs) => setAiVideoJobs(jobs),
      (err) => {
        notify('AI video jobs read error', err.message, 'error');
      }
    );

    const unsubThumbnails = subscribeToThumbnails(
      user.uid,
      (items) => setThumbnails(items),
      (err) => {
        notify('Thumbnails read error', err.message, 'error');
      }
    );

    loadBrandKitFromFirestore(user.uid)
      .then((loadedKit) => {
        if (cancelled) return;
        if (loadedKit) {
          setBrandKit(loadedKit);
        } else {
          setBrandKit({
            ...DEFAULT_BRAND_KIT,
            userId: user.uid,
            brandName: user.fullName || DEFAULT_BRAND_KIT.brandName,
            brandHandle: user.brandHandle || DEFAULT_BRAND_KIT.brandHandle,
            brandVoice: user.brandVoice || DEFAULT_BRAND_KIT.brandVoice,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          notify(
            'Could not load Brand Kit',
            err instanceof Error ? err.message : 'Firestore error',
            'error'
          );
        }
      });

    return () => {
      cancelled = true;
      unsubProjects();
      unsubHistory();
      unsubAssistantConvs();
      unsubAssistantTasks();
      unsubSocialConns();
      unsubSocialPosts();
      unsubVideoJobs();
      unsubAiVideoJobs();
      unsubThumbnails();
    };
  }, [user?.uid, user?.fullName, user?.brandHandle, user?.niche, user?.brandVoice, notify]);

  // Subscribe to messages for active assistant conversation
  useEffect(() => {
    if (!user?.uid || !activeConversationId) {
      setAssistantMessages([]);
      return;
    }

    const unsubMessages = subscribeToAssistantMessages(
      user.uid,
      activeConversationId,
      (msgs) => setAssistantMessages(msgs),
      (err) => {
        notify('Conversation read error', err.message, 'error');
      }
    );

    return () => unsubMessages();
  }, [user?.uid, activeConversationId, notify]);

  // Clear active polling intervals on unmount
  useEffect(() => {
    const timers = activePollTimersRef.current;
    return () => {
      Object.values(timers).forEach((id) => window.clearInterval(id));
    };
  }, []);

  const handleCopyText = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        notify('Copied to clipboard', `${label} is ready to paste.`, 'success');
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        notify('Copied to clipboard', `${label} is ready to paste.`, 'success');
      }
    },
    [notify]
  );

  const handleGenerate = useCallback(async () => {
    if (!user?.uid) return;

    if (!sourceText.trim() && !mediaInfo?.base64Data) {
      const msg =
        'Paste a script, transcript, content idea, or attach a media file first.';
      setAiError(msg);
      notify('Input required', msg, 'error');
      return;
    }

    setIsGenerating(true);
    setAiError(null);

    const config = {
      sourceText: sourceText.trim(),
      platform,
      language,
      tone,
      duration,
      niche: niche.trim(),
      brandVoice: brandVoice.trim(),
      ...(mediaInfo?.name ? { mediaName: mediaInfo.name } : {}),
    };

    const activeTemplate = activeBrandTemplateId
      ? brandKit.templates.find((t) => t.id === activeBrandTemplateId)
      : undefined;

    const brandKitContext: BrandKitPromptContext | null = applyBrandKit
      ? {
          brandName: brandKit.brandName,
          brandHandle: brandKit.brandHandle,
          brandVoice: brandKit.brandVoice,
          preferredCtas: brandKit.preferredCtas,
          captionStyle: brandKit.captionStyle,
          ...(activeTemplate
            ? {
                templateName: activeTemplate.name,
                hookFormula: activeTemplate.hookFormula,
                structureNotes: activeTemplate.structureNotes,
              }
            : {}),
        }
      : null;

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: config.sourceText,
          platform: config.platform,
          language: config.language,
          tone: config.tone,
          duration: config.duration,
          niche: config.niche,
          brandVoice: config.brandVoice,
          brandKit: brandKitContext,
          media: mediaInfo?.base64Data
            ? {
                mimeType: mediaInfo.type,
                data: mediaInfo.base64Data,
                name: mediaInfo.name,
                kind: mediaInfo.kind,
              }
            : null,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          (payload && typeof payload.error === 'string' && payload.error) ||
          `AI server returned error status ${response.status}.`;
        setAiError(message);
        notify('AI Generation Failed', message, 'error');
        return;
      }

      if (!payload || payload.engine !== 'gemini' || !payload.data) {
        const message =
          'AI service returned an unexpected response format. No content was generated.';
        setAiError(message);
        notify('AI Generation Failed', message, 'error');
        return;
      }

      const validated = validateAndNormalizeGeneratedPayload(payload.data);
      if (!validated.ok) {
        const message = `Generated JSON validation failed: ${validated.error}`;
        setAiError(message);
        notify('AI Validation Failed', message, 'error');
        return;
      }

      const finalResult: GeneratedContent = {
        ...validated.data,
        engine: 'gemini',
        model: typeof payload.model === 'string' ? payload.model : 'gemini-4-hydrogen',
        generatedAt:
          typeof payload.generatedAt === 'string'
            ? payload.generatedAt
            : new Date().toISOString(),
      };

      setGeneratedResult(finalResult);

      // Persist generation to Firestore under authenticated user
      const generationId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const entry: HistoryItem = {
        id: generationId,
        userId: user.uid,
        ...(activeProject ? { projectId: activeProject.id } : {}),
        createdAt: new Date().toISOString(),
        sourcePreview:
          (config.sourceText ||
            `Uploaded ${mediaInfo?.kind || 'media'}: ${mediaInfo?.name || 'file'}`)
            .slice(0, 280),
        config,
        result: finalResult,
      };

      try {
        await saveGenerationToFirestore(user.uid, entry);
        if (activeProject) {
          await saveProjectToFirestore(
            user.uid,
            {
              id: activeProject.id,
              userId: user.uid,
              title: activeProject.title,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              config,
              result: finalResult,
            },
            'update'
          );
        }
        notify(
          'AI content generated & saved',
          activeProject
            ? `Updated "${activeProject.title}" and saved to Firestore.`
            : 'Saved structured Gemini output to your Firestore history.',
          'success'
        );
      } catch (fsErr) {
        notify(
          'Generated, but Firestore save failed',
          fsErr instanceof Error ? fsErr.message : 'Could not save to Firestore.',
          'error'
        );
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? `Network or server error: ${err.message}`
          : 'Unable to reach the AI generation server.';
      setAiError(message);
      notify('AI Generation Failed', message, 'error');
    } finally {
      setIsGenerating(false);
    }
  }, [
    user?.uid,
    sourceText,
    mediaInfo,
    platform,
    language,
    tone,
    duration,
    niche,
    brandVoice,
    applyBrandKit,
    activeBrandTemplateId,
    brandKit,
    activeProject,
    notify,
  ]);

  const handleSaveBrandKit = useCallback(
    async (updated: BrandKitConfig) => {
      if (!user?.uid) return;
      setIsSavingBrandKit(true);
      try {
        await saveBrandKitToFirestore(user.uid, updated);
        setBrandKit({ ...updated, userId: user.uid, updatedAt: new Date().toISOString() });
        if (updated.brandVoice.trim()) {
          setBrandVoice(updated.brandVoice);
        }
        notify(
          'Brand Kit saved',
          'Brand colors, voice, CTAs, and templates synced to Firestore.',
          'success'
        );
      } catch (err) {
        notify(
          'Could not save Brand Kit',
          err instanceof Error ? err.message : 'Firestore write failed.',
          'error'
        );
      } finally {
        setIsSavingBrandKit(false);
      }
    },
    [user?.uid, notify]
  );

  const handleSelectBrandTemplate = useCallback(
    (templateId: string) => {
      setActiveBrandTemplateId(templateId);
      if (!templateId) return;
      const tpl = brandKit.templates.find((t) => t.id === templateId);
      if (!tpl) return;
      setPlatform(tpl.platform);
      setTone(tpl.tone);
      setApplyBrandKit(true);
      notify(
        'Brand template selected',
        `Studio set to ${tpl.platform} (${tpl.tone}) with "${tpl.name}".`,
        'info'
      );
    },
    [brandKit.templates, notify]
  );

  const handleApplyTemplateToStudio = useCallback(
    (template: BrandTemplate) => {
      setActiveBrandTemplateId(template.id);
      setPlatform(template.platform);
      setTone(template.tone);
      setApplyBrandKit(true);
      if (brandKit.brandVoice.trim()) {
        setBrandVoice(brandKit.brandVoice);
      }
      navigate('/create');
      notify(
        'Brand template loaded',
        `"${template.name}" is active in Content Studio.`,
        'success'
      );
    },
    [brandKit.brandVoice, navigate, notify]
  );

  const handleDeleteVideoJob = useCallback(
    async (jobId: string) => {
      if (!user?.uid) return;
      try {
        await deleteVideoJobFromFirestore(user.uid, jobId);
        notify('Render job deleted', 'Removed video render entry.', 'info');
      } catch (err) {
        notify(
          'Delete failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      }
    },
    [user?.uid, notify]
  );

  const handleDeleteAiVideoJob = useCallback(
    async (jobId: string) => {
      if (!user?.uid) return;
      try {
        await deleteAiVideoJobFromFirestore(user.uid, jobId);
        notify('AI video deleted', 'Removed AI video job from history.', 'info');
      } catch (err) {
        notify(
          'Delete failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      }
    },
    [user?.uid, notify]
  );

  const handleDeleteThumbnail = useCallback(
    async (asset: ThumbnailAsset) => {
      if (!user?.uid) return;
      try {
        await deleteThumbnailFromFirestore(user.uid, asset.id);
        notify('Thumbnail deleted', `Removed "${asset.title}" from library.`, 'info');
      } catch (err) {
        notify(
          'Delete failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      }
    },
    [user?.uid, notify]
  );

  const handleUpdateGeneratedResult = useCallback(
    (updated: GeneratedContent) => {
      setGeneratedResult(updated);
      if (
        user?.uid &&
        activeProject?.id &&
        updated.qualityScore &&
        updated.qualityScore !== generatedResult?.qualityScore
      ) {
        const existing = projects.find((p) => p.id === activeProject.id);
        if (existing) {
          void saveProjectToFirestore(
            user.uid,
            {
              ...existing,
              updatedAt: new Date().toISOString(),
              result: updated,
            },
            'update'
          ).catch(() => {});
        }
      }
    },
    [user?.uid, activeProject?.id, generatedResult?.qualityScore, projects]
  );

  const handleCreateThumbnailFromStudio = useCallback(() => {
    if (!generatedResult) return;
    setThumbnailSeed({
      title:
        activeProject?.title ||
        generatedResult.instagramReel.title ||
        generatedResult.youtubeShorts.title ||
        'Creator Thumbnail',
      topic:
        generatedResult.analysis?.coreTopic ||
        sourceText.trim().slice(0, 140) ||
        generatedResult.instagramReel.title,
      hook: generatedResult.instagramReel.hook,
      aspectRatio:
        platform === 'Instagram' || platform === 'YouTube' ? '9:16' : '16:9',
      ...(activeProject?.id ? { projectId: activeProject.id } : {}),
    });
    navigate('/thumbnails');
  }, [generatedResult, activeProject, sourceText, platform, navigate]);

  const handleCreateAiVideoFromStudio = useCallback(() => {
    if (!generatedResult) return;
    const rawScript =
      generatedResult.instagramReel.script ||
      generatedResult.youtubeShorts.script ||
      sourceText.trim();
    const parsedDur = parseInt(duration, 10);
    const dur: AiVideoDurationSec =
      parsedDur === 15 || parsedDur === 30 || parsedDur === 60 || parsedDur === 90
        ? parsedDur
        : 30;
    setAiVideoScriptSeed({
      title:
        activeProject?.title ||
        generatedResult.instagramReel.title ||
        generatedResult.youtubeShorts.title ||
        'AI Creator Video',
      script: rawScript,
      language,
      aspectRatio: platform === 'YouTube' ? '9:16' : '9:16',
      durationSec: dur,
    });
    navigate('/ai-video');
  }, [generatedResult, activeProject, sourceText, duration, language, platform, navigate]);

  const handleSaveProject = useCallback(
    async (title: string, mode: 'new' | 'update') => {
      if (!generatedResult || !user?.uid) return;
      const now = new Date().toISOString();
      const isUpdatingExisting = mode === 'update' && Boolean(activeProject?.id);
      const projectId = isUpdatingExisting
        ? activeProject!.id
        : `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const projectData: CreatorProject = {
        id: projectId,
        userId: user.uid,
        title: title.trim() || 'Untitled Creator Project',
        createdAt: now,
        updatedAt: now,
        config: {
          sourceText: sourceText.trim(),
          platform,
          language,
          tone,
          duration,
          niche: niche.trim(),
          brandVoice: brandVoice.trim(),
          ...(mediaInfo?.name ? { mediaName: mediaInfo.name } : {}),
        },
        result: generatedResult,
      };

      try {
        await saveProjectToFirestore(
          user.uid,
          projectData,
          isUpdatingExisting ? 'update' : 'create'
        );
        setActiveProject({ id: projectId, title: projectData.title });
        notify(
          isUpdatingExisting ? 'Project updated in Firestore' : 'Project saved to Firestore',
          `"${projectData.title}" is synced under your account.`,
          'success'
        );
      } catch (err) {
        notify(
          'Could not save project',
          err instanceof Error ? err.message : 'Firestore write failed.',
          'error'
        );
      }
    },
    [
      generatedResult,
      user?.uid,
      activeProject,
      sourceText,
      platform,
      language,
      tone,
      duration,
      niche,
      brandVoice,
      mediaInfo?.name,
      notify,
    ]
  );

  const handleDownloadCurrent = useCallback(() => {
    if (!generatedResult) return;
    const title =
      generatedResult.instagramReel.title || `${platform} CreatorPilot Bundle`;
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'creatorpilot-content';

    const { content, extension, mimeType } = formatContentForDownload(
      title,
      { sourceText, platform, language, tone, duration, niche, brandVoice },
      generatedResult,
      settings.exportFormat
    );

    triggerBlobDownload(`${slug}.${extension}`, content, mimeType);
    notify('Download started', `Exported as ${slug}.${extension}.`, 'success');
  }, [
    generatedResult,
    sourceText,
    platform,
    language,
    tone,
    duration,
    niche,
    brandVoice,
    settings.exportFormat,
    notify,
  ]);

  const handleClearAll = useCallback(() => {
    setSourceText('');
    setMediaInfo(null);
    setGeneratedResult(null);
    setActiveProject(null);
    setAiError(null);
    notify('Studio cleared', 'Ready for your next content idea.', 'info');
  }, [notify]);

  const handleUseSamplePrompt = useCallback(
    (sample: SamplePrompt) => {
      setSourceText(sample.text);
      setPlatform(sample.platform);
      setTone(sample.tone);
      setDuration(sample.duration);
      setMediaInfo(null);
      setGeneratedResult(null);
      setActiveProject(null);
      setAiError(null);
      navigate('/create');
      notify(
        'Template loaded',
        `Loaded "${sample.label}" into Content Studio. Click Generate Content to run Gemini AI.`,
        'info'
      );
    },
    [navigate, notify]
  );

  const handleOpenProject = useCallback(
    (project: CreatorProject) => {
      setSourceText(project.config.sourceText);
      setPlatform(project.config.platform);
      setLanguage(project.config.language);
      setTone(project.config.tone);
      setDuration(project.config.duration);
      setNiche(project.config.niche ?? settings.niche);
      setBrandVoice(project.config.brandVoice ?? settings.brandVoice);
      setMediaInfo(null);
      setGeneratedResult(project.result);
      setActiveProject({ id: project.id, title: project.title });
      setAiError(null);
      navigate('/create');
      notify('Project loaded', `Opened "${project.title}" in Studio.`, 'info');
    },
    [navigate, notify, settings.niche, settings.brandVoice]
  );

  const handleDuplicateProject = useCallback(
    async (project: CreatorProject) => {
      if (!user?.uid) return;
      const now = new Date().toISOString();
      const copy: CreatorProject = {
        ...project,
        id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId: user.uid,
        title: `${project.title} (Copy)`.slice(0, 140),
        createdAt: now,
        updatedAt: now,
      };
      try {
        await saveProjectToFirestore(user.uid, copy, 'create');
        notify('Project duplicated', `Created "${copy.title}".`, 'success');
      } catch (err) {
        notify(
          'Duplicate failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      }
    },
    [user?.uid, notify]
  );

  const handleDownloadProject = useCallback(
    (project: CreatorProject) => {
      const slug =
        project.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 40) || 'creatorpilot-project';
      const { content, extension, mimeType } = formatContentForDownload(
        project.title,
        project.config,
        project.result,
        settings.exportFormat
      );
      triggerBlobDownload(`${slug}.${extension}`, content, mimeType);
      notify('Project exported', `Downloaded ${slug}.${extension}.`, 'success');
    },
    [settings.exportFormat, notify]
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      if (!user?.uid) return;
      try {
        await deleteProjectFromFirestore(user.uid, id);
        if (activeProject?.id === id) {
          setActiveProject(null);
        }
        notify('Project deleted', 'Removed project from Firestore.', 'info');
      } catch (err) {
        notify(
          'Delete failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      }
    },
    [user?.uid, activeProject?.id, notify]
  );

  const handleRestoreHistory = useCallback(
    (item: HistoryItem) => {
      setSourceText(item.config.sourceText);
      setPlatform(item.config.platform);
      setLanguage(item.config.language);
      setTone(item.config.tone);
      setDuration(item.config.duration);
      setNiche(item.config.niche ?? settings.niche);
      setBrandVoice(item.config.brandVoice ?? settings.brandVoice);
      setMediaInfo(null);
      setGeneratedResult(item.result);
      setActiveProject(null);
      setAiError(null);
      navigate('/create');
      notify('History restored', 'Loaded historical generation into Studio.', 'info');
    },
    [navigate, notify, settings.niche, settings.brandVoice]
  );

  const handleDownloadHistory = useCallback(
    (item: HistoryItem) => {
      const title = item.result.instagramReel.title || 'History Bundle';
      const slug =
        title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 40) || 'history-bundle';
      const { content, extension, mimeType } = formatContentForDownload(
        title,
        item.config,
        item.result,
        settings.exportFormat
      );
      triggerBlobDownload(`${slug}.${extension}`, content, mimeType);
      notify('Exported bundle', `Downloaded ${slug}.${extension}.`, 'success');
    },
    [settings.exportFormat, notify]
  );

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      if (!user?.uid) return;
      try {
        await deleteGenerationFromFirestore(user.uid, id);
        notify('Entry removed', 'Deleted item from Content History.', 'info');
      } catch (err) {
        notify(
          'Delete failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      }
    },
    [user?.uid, notify]
  );

  const handleClearHistory = useCallback(async () => {
    if (!user?.uid || history.length === 0) return;
    try {
      await clearGenerationsFromFirestore(
        user.uid,
        history.map((h) => h.id)
      );
      notify('History cleared', 'All generation history entries cleared.', 'info');
    } catch (err) {
      notify(
        'Clear failed',
        err instanceof Error ? err.message : 'Firestore error.',
        'error'
      );
    }
  }, [user?.uid, history, notify]);

  const handleSaveSettings = useCallback(
    async (updated: CreatorSettings) => {
      if (!user?.uid) return;
      try {
        await saveWorkspaceSettingsToFirestore(user.uid, updated);
        await updateUserProfile({
          fullName: updated.creatorName,
          brandHandle: updated.brandHandle,
          niche: updated.niche,
          brandVoice: updated.brandVoice,
        });
        setSettings(updated);
        setPlatform(updated.defaultPlatform);
        setLanguage(updated.defaultLanguage);
        setTone(updated.defaultTone);
        setDuration(updated.defaultDuration);
        setNiche(updated.niche);
        setBrandVoice(updated.brandVoice);
        notify(
          'Preferences saved',
          'Default studio settings and brand voice synced to Firestore.',
          'success'
        );
      } catch (err) {
        notify(
          'Save failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      }
    },
    [user?.uid, updateUserProfile, notify]
  );

  const handleExportAllProjects = useCallback(() => {
    triggerBlobDownload(
      'creatorpilot-projects-backup.json',
      JSON.stringify(projects, null, 2),
      'application/json'
    );
    notify(
      'Backup exported',
      `Exported ${projects.length} saved projects as JSON.`,
      'success'
    );
  }, [projects, notify]);

  const handleLoadDemoProjects = useCallback(async () => {
    if (!user?.uid) return;
    const demos = createStarterDemoProjects(user.uid);
    try {
      for (const proj of demos) {
        await saveProjectToFirestore(user.uid, proj, 'create');
      }
      notify(
        'Demo projects added',
        'Added 3 clearly labeled starter demo projects to My Projects.',
        'info'
      );
    } catch (err) {
      notify(
        'Could not add demo projects',
        err instanceof Error ? err.message : 'Firestore error.',
        'error'
      );
    }
  }, [user?.uid, notify]);

  const handleLogout = useCallback(async () => {
    await logout();
    notify('Signed out', 'You have been logged out of CreatorPilot AI.', 'info');
    navigate('/login', { replace: true, state: null });
  }, [logout, notify, navigate]);

  const stopJobPolling = useCallback((jobId: string) => {
    const timer = activePollTimersRef.current[jobId];
    if (timer !== undefined) {
      window.clearInterval(timer);
      delete activePollTimersRef.current[jobId];
    }
  }, []);

  const startJobPolling = useCallback(
    (
      userId: string,
      conversationId: string,
      taskId: string,
      jobId: string
    ) => {
      stopJobPolling(jobId);
      let lastSignature = '';
      let isChecking = false;

      const pollOnce = async () => {
        if (isChecking) return;
        isChecking = true;
        try {
          const res = await fetch(`/api/assistant/jobs/${encodeURIComponent(jobId)}`);
          const jobPayload = await res.json().catch(() => null);

          if (!res.ok || !jobPayload) {
            if (res.status === 404) {
              stopJobPolling(jobId);
              const errMsg = 'Backend job no longer exists on server.';
              await updateAssistantTask(userId, taskId, {
                status: 'failed',
                confirmedByBackend: false,
                error: errMsg,
              });
            }
            return;
          }

          const signature = `${jobPayload.status}:${jobPayload.updatedAt}:${JSON.stringify(
            jobPayload.steps || []
          )}`;

          if (jobPayload.status === 'completed' && jobPayload.confirmedByBackend === true) {
            stopJobPolling(jobId);
            await updateAssistantTask(userId, taskId, {
              status: 'completed',
              confirmedByBackend: true,
              steps: jobPayload.steps as AssistantPipelineStep[],
              outputs: jobPayload.outputs as AssistantTaskOutputs,
            });
            await addAssistantMessage(userId, conversationId, {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              userId,
              conversationId,
              role: 'system',
              content:
                String(jobPayload.completionMessage || '') ||
                `Backend confirmed job ${jobId} completed. Review, edit, and approve before publishing.`,
              taskId,
              createdAt: new Date().toISOString(),
            });
            notify(
              'Assistant workflow completed',
              'Backend confirmed all clips, captions, hashtags, subtitles, and video jobs are ready for your approval.',
              'success'
            );
            return;
          }

          if (jobPayload.status === 'failed') {
            stopJobPolling(jobId);
            const errText = String(
              jobPayload.error || 'Backend pipeline execution failed.'
            );
            await updateAssistantTask(userId, taskId, {
              status: 'failed',
              confirmedByBackend: false,
              error: errText,
              steps: jobPayload.steps as AssistantPipelineStep[],
            });
            await addAssistantMessage(userId, conversationId, {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              userId,
              conversationId,
              role: 'assistant',
              content:
                String(jobPayload.completionMessage || '') ||
                `Workflow failed: ${errText}`,
              taskId,
              createdAt: new Date().toISOString(),
            });
            notify('Assistant workflow failed', errText, 'error');
            return;
          }

          if (signature !== lastSignature) {
            lastSignature = signature;
            await updateAssistantTask(userId, taskId, {
              status: 'running',
              confirmedByBackend: false,
              steps: jobPayload.steps as AssistantPipelineStep[],
              ...(jobPayload.outputs
                ? { outputs: jobPayload.outputs as AssistantTaskOutputs }
                : {}),
            });
          }
        } catch (err) {
          console.error('Polling error for assistant job:', jobId, err);
        } finally {
          isChecking = false;
        }
      };

      const intervalId = window.setInterval(() => {
        void pollOnce();
      }, 1300);
      activePollTimersRef.current[jobId] = intervalId;
      void pollOnce();
    },
    [stopJobPolling, notify]
  );

  // Resume polling for any in-flight assistant tasks loaded from Firestore
  useEffect(() => {
    if (!user?.uid) return;
    for (const task of assistantTasks) {
      if (
        (task.status === 'running' || task.status === 'queued') &&
        task.jobId &&
        activePollTimersRef.current[task.jobId] === undefined
      ) {
        startJobPolling(user.uid, task.conversationId, task.id, task.jobId);
      }
    }
  }, [user?.uid, assistantTasks, startJobPolling]);

  const handleNewAssistantConversation = useCallback(() => {
    setActiveConversationId(null);
    setAssistantMessages([]);
    setActiveTaskId(null);
  }, []);

  const handleSendAssistantInstruction = useCallback(
    async ({
      message,
      selectedProject,
      media,
    }: {
      message: string;
      selectedProject: CreatorProject | null;
      media: (UploadedMediaInfo & { extractedText?: string }) | null;
    }) => {
      if (!user?.uid) return;
      setIsAssistantSubmitting(true);

      let convId = activeConversationId;
      const nowIso = new Date().toISOString();

      try {
        if (!convId) {
          convId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const newConv: AssistantConversation = {
            id: convId,
            userId: user.uid,
            title: message.slice(0, 80) || 'Assistant Session',
            ...(selectedProject
              ? {
                  projectId: selectedProject.id,
                  projectTitle: selectedProject.title,
                }
              : {}),
            ...(media?.name ? { mediaName: media.name } : {}),
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          await saveAssistantConversation(user.uid, newConv, 'create');
          setActiveConversationId(convId);
        } else {
          const existingConv = assistantConversations.find(
            (c) => c.id === convId
          );
          if (existingConv) {
            await saveAssistantConversation(
              user.uid,
              {
                ...existingConv,
                ...(selectedProject
                  ? {
                      projectId: selectedProject.id,
                      projectTitle: selectedProject.title,
                    }
                  : {}),
                ...(media?.name ? { mediaName: media.name } : {}),
              },
              'update'
            );
          }
        }

        const userMsgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await addAssistantMessage(user.uid, convId, {
          id: userMsgId,
          userId: user.uid,
          conversationId: convId,
          role: 'user',
          content: message,
          createdAt: nowIso,
        });

        const combinedStudioText = [
          media?.extractedText ? `Attached file text:\n${media.extractedText}` : '',
          sourceText.trim() ? sourceText.trim() : '',
        ]
          .filter(Boolean)
          .join('\n\n');

        const response = await fetch('/api/assistant/orchestrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            conversationHistory: assistantMessages.slice(-6).map((m) => ({
              role: m.role,
              content: m.content,
            })),
            selectedProject: selectedProject
              ? {
                  id: selectedProject.id,
                  title: selectedProject.title,
                  sourceText: selectedProject.config.sourceText,
                  platform: selectedProject.config.platform,
                  language: selectedProject.config.language,
                  tone: selectedProject.config.tone,
                }
              : null,
            media: media
              ? {
                  name: media.name,
                  mimeType: media.type,
                  size: media.size,
                  kind: media.kind,
                  ...(media.base64Data ? { base64Data: media.base64Data } : {}),
                }
              : null,
            studioSourceText: combinedStudioText,
            defaults: {
              language,
              tone,
              niche,
              brandVoice,
            },
          }),
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload) {
          const errText =
            (payload && typeof payload.error === 'string' && payload.error) ||
            `Assistant server returned status ${response.status}.`;
          await addAssistantMessage(user.uid, convId, {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: user.uid,
            conversationId: convId,
            role: 'assistant',
            content: `Could not start workflow: ${errText}`,
            createdAt: new Date().toISOString(),
          });
          notify('Assistant Error', errText, 'error');
          return;
        }

        if (payload.mode === 'reply') {
          await addAssistantMessage(user.uid, convId, {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: user.uid,
            conversationId: convId,
            role: 'assistant',
            content: String(payload.assistantMessage || ''),
            createdAt: new Date().toISOString(),
          });
          return;
        }

        if (payload.mode === 'job_started' && payload.jobId) {
          const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const taskRecord: AssistantTask = {
            id: taskId,
            userId: user.uid,
            conversationId: convId,
            jobId: String(payload.jobId),
            instruction: message,
            ...(selectedProject
              ? {
                  projectId: selectedProject.id,
                  projectTitle: selectedProject.title,
                }
              : {}),
            ...(media?.name ? { mediaName: media.name } : {}),
            language: (payload.language as ContentLanguage) || language,
            status: 'running',
            confirmedByBackend: false,
            approvalStatus: 'pending_approval',
            steps: Array.isArray(payload.steps)
              ? (payload.steps as AssistantPipelineStep[])
              : [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await createAssistantTask(user.uid, taskRecord);
          setActiveTaskId(taskId);

          await addAssistantMessage(user.uid, convId, {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: user.uid,
            conversationId: convId,
            role: 'assistant',
            content: String(payload.assistantMessage || ''),
            taskId,
            createdAt: new Date().toISOString(),
          });

          startJobPolling(user.uid, convId, taskId, String(payload.jobId));
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to communicate with Assistant backend.';
        notify('Assistant Error', msg, 'error');
      } finally {
        setIsAssistantSubmitting(false);
      }
    },
    [
      user?.uid,
      activeConversationId,
      assistantConversations,
      assistantMessages,
      sourceText,
      language,
      tone,
      niche,
      brandVoice,
      startJobPolling,
      notify,
    ]
  );

  const handleSaveAssistantTaskOutputs = useCallback(
    async (taskId: string, outputs: AssistantTaskOutputs) => {
      if (!user?.uid) return;
      try {
        await updateAssistantTask(user.uid, taskId, { outputs });
        notify(
          'Assistant outputs updated',
          'Your edits have been saved to Firestore.',
          'success'
        );
      } catch (err) {
        notify(
          'Could not save edits',
          err instanceof Error ? err.message : 'Firestore update failed.',
          'error'
        );
      }
    },
    [user?.uid, notify]
  );

  const handleApproveAssistantTask = useCallback(
    async (task: AssistantTask) => {
      if (!user?.uid) return;
      if (task.status !== 'completed' || !task.confirmedByBackend) {
        notify(
          'Approval blocked',
          'Wait until the backend confirms task completion before approving.',
          'error'
        );
        return;
      }

      const approvedAt = new Date().toISOString();
      try {
        await updateAssistantTask(user.uid, task.id, {
          status: 'completed',
          approvalStatus: 'approved',
          approvedAt,
        });
        await addAssistantMessage(user.uid, task.conversationId, {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          userId: user.uid,
          conversationId: task.conversationId,
          role: 'system',
          content: `User approved outputs for job ${task.jobId}. Bundle is unlocked for publishing.`,
          taskId: task.id,
          createdAt: approvedAt,
        });
        notify(
          'Outputs approved',
          'You can now publish this approved bundle to your Projects.',
          'success'
        );
      } catch (err) {
        notify(
          'Approval failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      }
    },
    [user?.uid, notify]
  );

  const handlePublishAssistantTask = useCallback(
    async (task: AssistantTask) => {
      if (!user?.uid) return;
      if (task.approvalStatus !== 'approved' || !task.outputs) {
        notify(
          'Approval required',
          'You must approve the completed outputs before publishing.',
          'error'
        );
        return;
      }

      try {
        const res = await fetch('/api/assistant/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: task.id,
            approvalStatus: task.approvalStatus,
            confirmedByUser: true,
            title: task.outputs.analysis.coreTopic,
            clipsCount: task.outputs.clips.length,
          }),
        });

        const payload = await res.json().catch(() => null);
        if (!res.ok || !payload?.published) {
          const msg =
            (payload && typeof payload.error === 'string' && payload.error) ||
            'Backend rejected publish request.';
          notify('Publish blocked', msg, 'error');
          return;
        }

        const primaryReel =
          task.outputs.clips.find((c) => c.platform === 'Instagram Reel') ||
          task.outputs.clips[0];
        const primaryShort =
          task.outputs.clips.find((c) => c.platform === 'YouTube Short') ||
          task.outputs.clips[0];

        const nowIso = new Date().toISOString();
        const projectId = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const projectTitle =
          `${task.outputs.analysis.coreTopic || 'Assistant Campaign'}`.slice(
            0,
            135
          ) || 'Assistant Campaign';

        const projectResult: GeneratedContent = {
          analysis: {
            coreTopic: task.outputs.analysis.coreTopic || projectTitle,
            summary: task.outputs.analysis.summary || task.instruction,
            targetAudience:
              task.outputs.analysis.targetAudience || 'Digital Creators',
            keyTakeaways:
              task.outputs.analysis.keyTakeaways.length > 0
                ? task.outputs.analysis.keyTakeaways
                : [task.instruction.slice(0, 200)],
            detectedLanguage: task.language,
          },
          hooks: task.outputs.clips
            .map((c) => c.hook)
            .filter(Boolean)
            .slice(0, 10),
          instagramReel: {
            title: primaryReel?.title || projectTitle,
            hook: primaryReel?.hook || task.instruction.slice(0, 150),
            script:
              task.outputs.clips
                .filter((c) => c.platform === 'Instagram Reel')
                .map(
                  (c, idx) =>
                    `[Reel ${idx + 1}: ${c.startTime}-${c.endTime}] ${c.title}\n${c.script}`
                )
                .join('\n\n') ||
              primaryReel?.script ||
              task.instruction,
            cta: primaryReel?.cta || 'Save and follow for more.',
          },
          youtubeShorts: {
            title: primaryShort?.title || projectTitle,
            script:
              task.outputs.clips
                .filter((c) => c.platform === 'YouTube Short')
                .map(
                  (c, idx) =>
                    `[Short ${idx + 1}: ${c.startTime}-${c.endTime}] ${c.title}\n${c.script}`
                )
                .join('\n\n') ||
              primaryShort?.script ||
              task.instruction,
            description:
              primaryShort?.caption ||
              task.outputs.analysis.summary ||
              task.instruction,
            cta: primaryShort?.cta || 'Subscribe for more insights.',
          },
          instagramCaption: {
            caption:
              primaryReel?.caption ||
              task.outputs.analysis.summary ||
              task.instruction,
          },
          hashtags: {
            relevant: task.outputs.hashtags.relevant,
            trending: task.outputs.hashtags.trending,
          },
          platformPosts: {
            instagram:
              primaryReel?.caption || task.outputs.analysis.summary,
            youtubeCommunity:
              primaryShort?.caption || task.outputs.analysis.summary,
            linkedin: `${task.outputs.analysis.coreTopic}\n\n${task.outputs.analysis.summary}`,
            facebook: `${task.outputs.analysis.coreTopic}\n\n${primaryReel?.caption || task.outputs.analysis.summary}`,
          },
          engine: 'gemini',
          model: 'gemini-4-hydrogen',
          generatedAt: nowIso,
        };

        await saveProjectToFirestore(
          user.uid,
          {
            id: projectId,
            userId: user.uid,
            title: projectTitle,
            createdAt: nowIso,
            updatedAt: nowIso,
            config: {
              sourceText: task.instruction,
              platform: 'Instagram',
              language: task.language,
              tone,
              duration,
              niche,
              brandVoice,
              ...(task.mediaName ? { mediaName: task.mediaName } : {}),
            },
            result: projectResult,
          },
          'create'
        );

        await updateAssistantTask(user.uid, task.id, {
          approvalStatus: 'published',
          publishedAt: String(payload.publishedAt || nowIso),
        });

        await addAssistantMessage(user.uid, task.conversationId, {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          userId: user.uid,
          conversationId: task.conversationId,
          role: 'system',
          content: `Published approved bundle to Project "${projectTitle}" (${task.outputs.clips.length} clips & SRT subtitles saved in Firestore).`,
          taskId: task.id,
          createdAt: nowIso,
        });

        notify(
          'Published to Projects',
          `Saved approved bundle "${projectTitle}" to your Firestore projects.`,
          'success'
        );
      } catch (err) {
        notify(
          'Publish failed',
          err instanceof Error ? err.message : 'Could not publish bundle.',
          'error'
        );
      }
    },
    [user?.uid, tone, duration, niche, brandVoice, notify]
  );

  // Social Media Integration handlers & lifecycle
  const refreshSocialStatus = useCallback(async () => {
    if (!user?.uid) return;
    setIsSocialLoading(true);
    try {
      const status = await fetchSocialStatus();
      setSocialRequirements(status.requirements);
      setSocialConnections(status.connections);

      // Mirror non-secret connection metadata into Firestore
      for (const conn of status.connections) {
        await syncSocialConnectionMetadata(user.uid, conn).catch(() => {});
      }

      // Reconcile backend-executed scheduled jobs with Firestore socialPosts
      const currentPosts = socialPostsRef.current;
      for (const job of status.scheduledJobs) {
        const post = currentPosts.find((p) => p.id === job.postId);
        if (!post) continue;
        if (post.status !== job.status) {
          if (job.status === 'published') {
            await updateSocialPost(user.uid, post.id, {
              status: 'published',
              publishedAt: job.publishedAt || new Date().toISOString(),
              externalPostId: job.externalPostId || null,
              externalPostUrl: job.externalPostUrl || null,
              error: null,
              errorCode: null,
            }).catch(() => {});
          } else if (job.status === 'failed') {
            await updateSocialPost(user.uid, post.id, {
              status: 'failed',
              error: job.error || 'Scheduled publish failed.',
              errorCode: job.errorCode || 'SCHEDULED_PUBLISH_FAILED',
            }).catch(() => {});
          } else if (job.status === 'publishing') {
            await updateSocialPost(user.uid, post.id, {
              status: 'publishing',
            }).catch(() => {});
          }
        }
      }
    } catch (err) {
      notify(
        'Social status check failed',
        err instanceof Error ? err.message : 'Could not reach social backend.',
        'error'
      );
    } finally {
      setIsSocialLoading(false);
    }
  }, [user?.uid, notify]);

  useEffect(() => {
    if (!user?.uid) return;
    void refreshSocialStatus();
  }, [user?.uid, refreshSocialStatus]);

  // Poll backend scheduler while any post is scheduled or publishing
  const hasActiveScheduledSocialPosts = useMemo(
    () =>
      socialPosts.some(
        (p) => p.status === 'scheduled' || p.status === 'publishing'
      ),
    [socialPosts]
  );

  useEffect(() => {
    if (!user?.uid || !hasActiveScheduledSocialPosts) return;
    const timer = window.setInterval(() => {
      void refreshSocialStatus();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [user?.uid, hasActiveScheduledSocialPosts, refreshSocialStatus]);

  // Listen for OAuth popup postMessage completion
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      const isTrusted =
        origin === window.location.origin ||
        origin.endsWith('.run.app') ||
        origin.startsWith('http://localhost') ||
        origin.startsWith('https://localhost');
      if (!isTrusted) return;
      if (event.data?.type !== 'CREATORPILOT_OAUTH_RESULT') return;

      if (event.data.ok) {
        notify(
          'Social account connected',
          `${String(event.data.platform)} connected via official OAuth.`,
          'success'
        );
        void refreshSocialStatus();
      } else {
        notify(
          'OAuth connection failed',
          String(event.data.error || 'Authorization was rejected or failed.'),
          'error'
        );
      }
      setBusySocialPlatform(null);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [notify, refreshSocialStatus]);

  const handleConnectSocialPlatform = useCallback(
    async (targetPlatform: SocialPlatform) => {
      if (!user?.uid) return;
      setBusySocialPlatform(targetPlatform);
      try {
        const { url } = await getSocialOAuthUrl(targetPlatform);
        const popup = window.open(
          url,
          'oauth_popup',
          'width=600,height=700,resizable=yes,scrollbars=yes'
        );
        if (!popup) {
          notify(
            'Popup blocked',
            'Please allow popups for CreatorPilot AI so the official OAuth window can open.',
            'error'
          );
          setBusySocialPlatform(null);
        }
      } catch (err) {
        notify(
          'OAuth setup required',
          err instanceof Error
            ? err.message
            : 'Could not initialize OAuth flow.',
          'error'
        );
        setBusySocialPlatform(null);
      }
    },
    [user?.uid, notify]
  );

  const handleVerifySocialConnection = useCallback(
    async (targetPlatform: SocialPlatform) => {
      if (!user?.uid) return;
      setBusySocialPlatform(targetPlatform);
      try {
        const res = await verifySocialConnection(targetPlatform);
        if (res.connection) {
          setSocialConnections((prev) =>
            prev.map((c) => (c.platform === targetPlatform ? res.connection : c))
          );
          await syncSocialConnectionMetadata(user.uid, res.connection).catch(
            () => {}
          );
        }
        if (res.ok) {
          notify(
            'Token verified',
            `${targetPlatform} connection and token are active.`,
            'success'
          );
        } else {
          notify(
            'Token requires attention',
            res.error || 'Please reconnect your account.',
            'error'
          );
        }
      } catch (err) {
        notify(
          'Verification failed',
          err instanceof Error ? err.message : 'Token check failed.',
          'error'
        );
      } finally {
        setBusySocialPlatform(null);
      }
    },
    [user?.uid, notify]
  );

  const handleDisconnectSocialPlatform = useCallback(
    async (targetPlatform: SocialPlatform) => {
      if (!user?.uid) return;
      setBusySocialPlatform(targetPlatform);
      try {
        const conn = await disconnectSocialAccount(targetPlatform);
        setSocialConnections((prev) =>
          prev.map((c) => (c.platform === targetPlatform ? conn : c))
        );
        await syncSocialConnectionMetadata(user.uid, conn).catch(() => {});
        notify(
          'Account disconnected',
          `Removed encrypted OAuth tokens for ${targetPlatform}.`,
          'info'
        );
      } catch (err) {
        notify(
          'Disconnect failed',
          err instanceof Error ? err.message : 'Could not disconnect account.',
          'error'
        );
      } finally {
        setBusySocialPlatform(null);
      }
    },
    [user?.uid, notify]
  );

  const handleStageSocialPost = useCallback(
    async (draft: {
      platform: SocialPlatform;
      title?: string;
      caption: string;
      hashtags?: string[];
      mediaType: SocialMediaType;
      mediaUrl?: string;
      youtubePrivacy?: YouTubePrivacyStatus;
      projectId?: string;
      scheduledFor?: string;
    }) => {
      if (!user?.uid) return;
      const nowIso = new Date().toISOString();
      const postId = `post-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const newPost: SocialPost = {
        id: postId,
        userId: user.uid,
        platform: draft.platform,
        ...(draft.title ? { title: draft.title } : {}),
        caption: draft.caption,
        ...(draft.hashtags ? { hashtags: draft.hashtags } : {}),
        mediaType: draft.mediaType,
        ...(draft.mediaUrl ? { mediaUrl: draft.mediaUrl } : {}),
        ...(draft.youtubePrivacy ? { youtubePrivacy: draft.youtubePrivacy } : {}),
        ...(draft.projectId ? { projectId: draft.projectId } : {}),
        ...(draft.scheduledFor ? { scheduledFor: draft.scheduledFor } : {}),
        approvalStatus: 'pending_approval',
        status: 'draft',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      try {
        await createSocialPostDraft(user.uid, newPost);
        notify(
          'Post staged in Publishing Queue',
          `Draft saved for ${draft.platform}. Approve & publish or schedule it.`,
          'success'
        );
      } catch (err) {
        notify(
          'Could not stage post',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      }
    },
    [user?.uid, notify]
  );

  const handleUpdateSocialPost = useCallback(
    async (
      postId: string,
      updates: {
        title?: string | null;
        caption?: string;
        hashtags?: string[] | null;
        mediaUrl?: string | null;
        mediaType?: SocialMediaType;
        youtubePrivacy?: YouTubePrivacyStatus | null;
        scheduledFor?: string | null;
      }
    ) => {
      if (!user?.uid) return;
      setBusySocialPostId(postId);
      const isContentEdit =
        updates.title !== undefined ||
        updates.caption !== undefined ||
        updates.hashtags !== undefined ||
        updates.mediaUrl !== undefined ||
        updates.mediaType !== undefined ||
        updates.youtubePrivacy !== undefined;

      try {
        await updateSocialPost(user.uid, postId, {
          ...updates,
          ...(isContentEdit
            ? {
                approvalStatus: 'pending_approval',
                approvedAt: null,
              }
            : {}),
          status: 'draft',
          error: null,
          errorCode: null,
        });
        notify(
          isContentEdit ? 'Draft updated' : 'Schedule date updated',
          isContentEdit
            ? 'Post edits saved. Please approve before scheduling or publishing.'
            : 'Moved post date on your Content Calendar.',
          'success'
        );
      } catch (err) {
        notify(
          'Update failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      } finally {
        setBusySocialPostId(null);
      }
    },
    [user?.uid, notify]
  );

  const handleApproveSocialPost = useCallback(
    async (post: SocialPost) => {
      if (!user?.uid) return;
      setBusySocialPostId(post.id);
      try {
        await updateSocialPost(user.uid, post.id, {
          approvalStatus: 'approved',
          approvedAt: new Date().toISOString(),
        });
        notify(
          'Post approved',
          'You can now schedule or publish this post via official API.',
          'success'
        );
      } catch (err) {
        notify(
          'Approval failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      } finally {
        setBusySocialPostId(null);
      }
    },
    [user?.uid, notify]
  );

  const handleScheduleSocialPost = useCallback(
    async (post: SocialPost, scheduledFor: string) => {
      if (!user?.uid) return;
      if (post.approvalStatus !== 'approved') {
        notify(
          'Approval required',
          'Approve the post before scheduling.',
          'error'
        );
        return;
      }
      setBusySocialPostId(post.id);
      try {
        const res = await scheduleSocialPost({
          postId: post.id,
          platform: post.platform,
          title: post.title,
          caption: post.caption,
          hashtags: post.hashtags,
          mediaType: post.mediaType,
          mediaUrl: post.mediaUrl,
          youtubePrivacy: post.youtubePrivacy,
          approvalStatus: post.approvalStatus,
          scheduledFor,
        });
        await updateSocialPost(user.uid, post.id, {
          status: 'scheduled',
          scheduledFor: res.scheduledFor,
          error: null,
          errorCode: null,
        });
        notify(
          'Post scheduled',
          `Scheduled for ${new Date(res.scheduledFor).toLocaleString()}.`,
          'success'
        );
      } catch (err) {
        const errWithCode = err as Error & { code?: string };
        await updateSocialPost(user.uid, post.id, {
          error: errWithCode.message || 'Scheduling failed.',
          errorCode: errWithCode.code || 'SCHEDULE_FAILED',
        }).catch(() => {});
        notify(
          'Scheduling blocked',
          errWithCode.message || 'Could not schedule post.',
          'error'
        );
      } finally {
        setBusySocialPostId(null);
      }
    },
    [user?.uid, notify]
  );

  const handleCancelSocialSchedule = useCallback(
    async (post: SocialPost) => {
      if (!user?.uid) return;
      setBusySocialPostId(post.id);
      try {
        await cancelScheduledSocialPost(post.id);
        await updateSocialPost(user.uid, post.id, {
          status: 'draft',
          scheduledFor: null,
        });
        notify('Schedule cancelled', 'Post returned to draft state.', 'info');
      } catch (err) {
        notify(
          'Cancel failed',
          err instanceof Error ? err.message : 'Could not cancel schedule.',
          'error'
        );
      } finally {
        setBusySocialPostId(null);
      }
    },
    [user?.uid, notify]
  );

  const handlePublishSocialPostNow = useCallback(
    async (post: SocialPost) => {
      if (!user?.uid) return;
      if (post.approvalStatus !== 'approved') {
        notify(
          'Approval required',
          'You must approve the post before publishing.',
          'error'
        );
        return;
      }
      setBusySocialPostId(post.id);
      try {
        await updateSocialPost(user.uid, post.id, {
          status: 'publishing',
          error: null,
          errorCode: null,
        });
        const res = await publishSocialPost({
          postId: post.id,
          platform: post.platform,
          title: post.title,
          caption: post.caption,
          hashtags: post.hashtags,
          mediaType: post.mediaType,
          mediaUrl: post.mediaUrl,
          youtubePrivacy: post.youtubePrivacy,
          approvalStatus: post.approvalStatus,
        });
        await updateSocialPost(user.uid, post.id, {
          status: 'published',
          publishedAt: res.publishedAt,
          externalPostId: res.externalPostId,
          externalPostUrl: res.externalPostUrl || null,
          error: null,
          errorCode: null,
        });
        notify(
          'Published via official API',
          `Confirmed post ID ${res.externalPostId}.`,
          'success'
        );
      } catch (err) {
        const errWithCode = err as Error & { code?: string };
        await updateSocialPost(user.uid, post.id, {
          status: 'failed',
          error: errWithCode.message || 'Official platform publish failed.',
          errorCode: errWithCode.code || 'PUBLISH_FAILED',
        }).catch(() => {});
        notify(
          'Publishing failed',
          errWithCode.message || 'Could not publish post.',
          'error'
        );
      } finally {
        setBusySocialPostId(null);
      }
    },
    [user?.uid, notify]
  );

  const handleRefreshSocialAnalytics = useCallback(
    async (post: SocialPost) => {
      if (!user?.uid || !post.externalPostId) return;
      setBusySocialPostId(post.id);
      try {
        const analytics = await fetchSocialPostAnalytics(
          post.platform,
          post.externalPostId
        );
        await updateSocialPost(user.uid, post.id, { analytics });
        notify(
          analytics.supported ? 'Analytics refreshed' : 'Analytics notice',
          analytics.note || 'Fetched live engagement metrics from official API.',
          analytics.supported ? 'success' : 'info'
        );
      } catch (err) {
        notify(
          'Analytics fetch failed',
          err instanceof Error ? err.message : 'Could not load post metrics.',
          'error'
        );
      } finally {
        setBusySocialPostId(null);
      }
    },
    [user?.uid, notify]
  );

  const handleDeleteSocialPost = useCallback(
    async (postId: string) => {
      if (!user?.uid) return;
      setBusySocialPostId(postId);
      try {
        await cancelScheduledSocialPost(postId).catch(() => false);
        await deleteSocialPost(user.uid, postId);
        notify('Post removed', 'Deleted post from queue.', 'info');
      } catch (err) {
        notify(
          'Delete failed',
          err instanceof Error ? err.message : 'Firestore error.',
          'error'
        );
      } finally {
        setBusySocialPostId(null);
      }
    },
    [user?.uid, notify]
  );

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-[var(--bg-app)] text-[var(--text-primary)]">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebarCollapse}
        projectCount={projects.length}
        historyCount={history.length}
        creatorName={user.fullName}
        brandHandle={user.brandHandle || user.email}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          activeSection={activeSection}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onQuickCreate={() => handleSelectSection('create')}
          user={user}
          onSelectSection={handleSelectSection}
          onLogout={handleLogout}
          notifications={notifications}
          onMarkAllRead={onMarkAllRead}
          onClearNotifications={onClearNotifications}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Routes>
            <Route
              path="/dashboard"
              element={
                <DashboardView
                  user={user}
                  stats={stats}
                  projects={projects}
                  history={history}
                  isLoadingData={!projectsLoaded || !historyLoaded}
                  studioMediaInfo={mediaInfo}
                  studioSourceText={sourceText}
                  assistantConversations={assistantConversations}
                  activeConversationId={activeConversationId}
                  assistantMessages={assistantMessages}
                  assistantTasks={assistantTasks}
                  activeTaskId={activeTaskId}
                  isAssistantSubmitting={isAssistantSubmitting}
                  onSelectAssistantConversation={(id) => {
                    setActiveConversationId(id);
                    setActiveTaskId(null);
                  }}
                  onNewAssistantConversation={handleNewAssistantConversation}
                  onSelectAssistantTask={(taskId) => setActiveTaskId(taskId)}
                  onSendAssistantInstruction={handleSendAssistantInstruction}
                  onSaveAssistantTaskOutputs={handleSaveAssistantTaskOutputs}
                  onApproveAssistantTask={handleApproveAssistantTask}
                  onPublishAssistantTask={handlePublishAssistantTask}
                  onCopyText={handleCopyText}
                  onNotify={notify}
                  onNavigate={handleSelectSection}
                  onUseSamplePrompt={handleUseSamplePrompt}
                  onOpenProject={handleOpenProject}
                  onLogout={handleLogout}
                  socialRequirements={socialRequirements}
                  socialConnections={socialConnections}
                  socialPosts={socialPosts}
                  busySocialPostId={busySocialPostId}
                  onStageSocialPost={handleStageSocialPost}
                  onUpdateSocialPost={handleUpdateSocialPost}
                  onApproveSocialPost={handleApproveSocialPost}
                  onScheduleSocialPost={handleScheduleSocialPost}
                  onCancelSocialSchedule={handleCancelSocialSchedule}
                  onPublishSocialPostNow={handlePublishSocialPostNow}
                  onRefreshSocialAnalytics={handleRefreshSocialAnalytics}
                  onDeleteSocialPost={handleDeleteSocialPost}
                />
              }
            />
            <Route
              path="/create"
              element={
                <ContentStudioView
                  sourceText={sourceText}
                  onChangeSourceText={setSourceText}
                  platform={platform}
                  onChangePlatform={setPlatform}
                  language={language}
                  onChangeLanguage={setLanguage}
                  tone={tone}
                  onChangeTone={setTone}
                  duration={duration}
                  onChangeDuration={setDuration}
                  niche={niche}
                  onChangeNiche={setNiche}
                  brandVoice={brandVoice}
                  onChangeBrandVoice={setBrandVoice}
                  mediaInfo={mediaInfo}
                  onChangeMediaInfo={setMediaInfo}
                  generatedResult={generatedResult}
                  onUpdateResult={handleUpdateGeneratedResult}
                  isGenerating={isGenerating}
                  aiError={aiError}
                  onDismissAiError={() => setAiError(null)}
                  activeProject={activeProject}
                  onDetachActiveProject={() => setActiveProject(null)}
                  onGenerate={handleGenerate}
                  onCopyText={handleCopyText}
                  onSaveProject={handleSaveProject}
                  onDownload={handleDownloadCurrent}
                  onClearAll={handleClearAll}
                  onStageSocialPost={handleStageSocialPost}
                  brandKit={brandKit}
                  applyBrandKit={applyBrandKit}
                  onToggleApplyBrandKit={setApplyBrandKit}
                  activeBrandTemplateId={activeBrandTemplateId}
                  onSelectBrandTemplate={handleSelectBrandTemplate}
                  onOpenBrandKit={() => handleSelectSection('brand-kit')}
                  onCreateThumbnail={handleCreateThumbnailFromStudio}
                  onCreateAiVideo={handleCreateAiVideoFromStudio}
                  onNotify={notify}
                />
              }
            />
            <Route
              path="/ai-video"
              element={
                <AiVideoGeneratorView
                  userId={user.uid}
                  defaultLanguage={language}
                  initialScriptSeed={aiVideoScriptSeed}
                  onConsumeScriptSeed={() => setAiVideoScriptSeed(null)}
                  aiVideoJobs={aiVideoJobs}
                  onDeleteAiVideoJob={handleDeleteAiVideoJob}
                  onCopyText={handleCopyText}
                  onNotify={notify}
                />
              }
            />
            <Route
              path="/video-editor"
              element={
                <VideoEditorView
                  userId={user.uid}
                  defaultLanguage={language}
                  videoJobs={videoJobs}
                  onDeleteVideoJob={handleDeleteVideoJob}
                  onCopyText={handleCopyText}
                  onNotify={notify}
                />
              }
            />
            <Route
              path="/thumbnails"
              element={
                <ThumbnailStudioView
                  userId={user.uid}
                  projects={projects}
                  brandKit={brandKit}
                  thumbnails={thumbnails}
                  draftSeed={thumbnailSeed}
                  onConsumeDraftSeed={() => setThumbnailSeed(null)}
                  onDeleteThumbnail={handleDeleteThumbnail}
                  onStageSocialPost={handleStageSocialPost}
                  onNotify={notify}
                />
              }
            />
            <Route
              path="/analytics"
              element={
                <AnalyticsView
                  history={history}
                  projects={projects}
                  socialPosts={socialPosts}
                  assistantTasks={assistantTasks}
                  videoJobs={videoJobs}
                  thumbnails={thumbnails}
                  onRefreshSocialAnalytics={handleRefreshSocialAnalytics}
                  onOpenProject={handleOpenProject}
                  onNavigateToCreate={() => handleSelectSection('create')}
                  onNotify={notify}
                />
              }
            />
            <Route
              path="/calendar"
              element={
                <ContentCalendarView
                  posts={socialPosts}
                  projects={projects}
                  connections={socialConnections}
                  busyPostId={busySocialPostId}
                  onStagePost={handleStageSocialPost}
                  onUpdatePost={handleUpdateSocialPost}
                  onApprovePost={handleApproveSocialPost}
                  onSchedulePost={handleScheduleSocialPost}
                  onCancelSchedule={handleCancelSocialSchedule}
                  onPublishNow={handlePublishSocialPostNow}
                  onDeletePost={handleDeleteSocialPost}
                />
              }
            />
            <Route
              path="/brand-kit"
              element={
                <BrandKitView
                  userId={user.uid}
                  brandKit={brandKit}
                  isSaving={isSavingBrandKit}
                  onSaveBrandKit={handleSaveBrandKit}
                  onApplyTemplateToStudio={handleApplyTemplateToStudio}
                  onNotify={notify}
                />
              }
            />
            <Route
              path="/projects"
              element={
                <ProjectsView
                  projects={projects}
                  isLoading={!projectsLoaded}
                  onOpenProject={handleOpenProject}
                  onDuplicateProject={handleDuplicateProject}
                  onDownloadProject={handleDownloadProject}
                  onDeleteProject={handleDeleteProject}
                  onCreateNew={() => handleSelectSection('create')}
                />
              }
            />
            <Route
              path="/history"
              element={
                <HistoryView
                  history={history}
                  isLoading={!historyLoaded}
                  onRestoreItem={handleRestoreHistory}
                  onDownloadItem={handleDownloadHistory}
                  onDeleteItem={handleDeleteHistory}
                  onClearHistory={handleClearHistory}
                  onCreateNew={() => handleSelectSection('create')}
                />
              }
            />
            <Route
              path="/settings"
              element={
                <SettingsView
                  settings={settings}
                  onSaveSettings={handleSaveSettings}
                  notificationPrefs={notificationPrefs}
                  onChangeNotificationPrefs={handleChangeNotificationPrefs}
                  onExportAllProjects={handleExportAllProjects}
                  onLoadDemoProjects={handleLoadDemoProjects}
                  socialRequirements={socialRequirements}
                  socialConnections={socialConnections}
                  isSocialLoading={isSocialLoading}
                  busySocialPlatform={busySocialPlatform}
                  onRefreshSocialStatus={refreshSocialStatus}
                  onConnectSocialPlatform={handleConnectSocialPlatform}
                  onVerifySocialConnection={handleVerifySocialConnection}
                  onDisconnectSocialPlatform={handleDisconnectSocialPlatform}
                  onCopyText={handleCopyText}
                />
              }
            />
            <Route
              path="/profile"
              element={<ProfileView onNotify={notify} />}
            />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function PublicOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user, authReady } = useAuth();
  if (!authReady) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-app)] text-[var(--text-secondary)]">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-md">
          <span className="font-display text-sm font-bold">CP</span>
        </div>
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          Loading CreatorPilot AI...
        </p>
      </div>
    );
  }
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  const { authReady, user } = useAuth();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    resetScroll();
    const rafId = window.requestAnimationFrame(resetScroll);
    return () => window.cancelAnimationFrame(rafId);
  }, [pathname, authReady, user?.uid]);

  return null;
}

function AppRoutes() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [toastEnabled, setToastEnabled] = useState(true);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const notify = useCallback(
    (
      title: string,
      description?: string,
      variant: 'success' | 'info' | 'error' = 'success'
    ) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nowIso = new Date().toISOString();

      setNotifications((prev) => [
        { id, title, description, variant, createdAt: nowIso, read: false },
        ...prev.slice(0, 24),
      ]);

      if (toastEnabled || variant === 'error') {
        setToasts((prev) => [...prev.slice(-3), { id, title, description, variant }]);
        window.setTimeout(() => {
          dismissToast(id);
        }, 3400);
      }
    },
    [dismissToast, toastEnabled]
  );

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage onNotify={notify} />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/signup"
          element={
            <PublicOnlyRoute>
              <SignupPage onNotify={notify} />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicOnlyRoute>
              <ForgotPasswordPage onNotify={notify} />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <WorkspaceShell
                notify={notify}
                notifications={notifications}
                onMarkAllRead={markAllNotificationsRead}
                onClearNotifications={clearNotifications}
                onSetToastEnabled={setToastEnabled}
              />
            </ProtectedRoute>
          }
        />
      </Routes>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error?.message || 'Unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CreatorPilot UI error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-app)] p-6 text-center text-[var(--text-primary)]">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-6 shadow-lg">
            <h1 className="font-display text-lg font-bold">
              Something interrupted the workspace view
            </h1>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {this.state.message}
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, message: '' });
                  window.location.assign('/dashboard');
                }}
                className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500"
              >
                Reload Workspace
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  );
}
