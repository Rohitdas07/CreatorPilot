import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  CreatorProject,
  CreatorSettings,
  GeneratedContent,
  GenerationConfig,
  HistoryItem,
} from '../types/creator';
import type {
  AssistantConversation,
  AssistantMessage,
  AssistantPipelineStep,
  AssistantTask,
  AssistantTaskOutputs,
} from '../types/assistant';
import type {
  SocialConnectionSummary,
  SocialPlatform,
  SocialPost,
  SocialPostAnalytics,
} from '../types/social';
import {
  sanitizeConfigForFirestore,
  sanitizeResultForFirestore,
  VALID_DURATIONS,
  VALID_LANGUAGES,
  VALID_PLATFORMS,
  VALID_TONES,
} from '../utils/contentValidation';
import {
  DEFAULT_BRAND_KIT,
  type BrandKitConfig,
} from '../types/brandKit';
import type { VideoRenderJob } from '../types/videoEditor';
import type { ThumbnailAsset } from '../types/thumbnail';
import type {
  AiVideoDurationSec,
  AiVideoJobRecord,
  AiVideoMusicPreset,
  AiVideoPipelineStage,
  AiVideoSceneClipState,
  AiVideoStyle,
  AiVideoVoiceId,
} from '../types/aiVideo';

function toIsoString(ts: unknown): string {
  if (ts instanceof Timestamp) {
    return ts.toDate().toISOString();
  }
  if (
    ts &&
    typeof ts === 'object' &&
    'toDate' in ts &&
    typeof (ts as { toDate: () => Date }).toDate === 'function'
  ) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof ts === 'string' && ts.trim()) {
    return ts;
  }
  return new Date().toISOString();
}

export function subscribeToProjects(
  userId: string,
  onData: (projects: CreatorProject[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/projects`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: CreatorProject[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.id || docSnap.id),
          userId: String(data.userId || userId),
          title: String(data.title || 'Untitled Project'),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
          config: data.config as GenerationConfig,
          result: data.result as GeneratedContent,
        };
      });
      items.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export function subscribeToGenerations(
  userId: string,
  onData: (items: HistoryItem[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/generations`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: HistoryItem[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.id || docSnap.id),
          userId: String(data.userId || userId),
          ...(data.projectId ? { projectId: String(data.projectId) } : {}),
          createdAt: toIsoString(data.createdAt),
          sourcePreview: String(data.sourcePreview || ''),
          config: data.config as GenerationConfig,
          result: data.result as GeneratedContent,
        };
      });
      items.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function saveProjectToFirestore(
  userId: string,
  project: CreatorProject,
  mode: 'create' | 'update' = 'create'
): Promise<void> {
  const path = `users/${userId}/projects/${project.id}`;
  const cleanTitle = (project.title || 'Untitled Project').trim().slice(0, 140);
  const cleanConfig = sanitizeConfigForFirestore(project.config);
  const cleanResult = sanitizeResultForFirestore(project.result);

  try {
    const ref = doc(db, 'users', userId, 'projects', project.id);
    if (mode === 'update') {
      await updateDoc(ref, {
        title: cleanTitle,
        config: cleanConfig,
        result: cleanResult,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: project.id,
        userId,
        title: cleanTitle,
        config: cleanConfig,
        result: cleanResult,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(
      error,
      mode === 'update' ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

export async function deleteProjectFromFirestore(
  userId: string,
  projectId: string
): Promise<void> {
  const path = `users/${userId}/projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'projects', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveGenerationToFirestore(
  userId: string,
  item: HistoryItem
): Promise<void> {
  const path = `users/${userId}/generations/${item.id}`;
  const cleanPreview =
    (item.sourcePreview || 'Generated multi-platform bundle')
      .trim()
      .slice(0, 300) || 'Generated multi-platform bundle';
  const cleanConfig = sanitizeConfigForFirestore(item.config);
  const cleanResult = sanitizeResultForFirestore(item.result);

  try {
    await setDoc(doc(db, 'users', userId, 'generations', item.id), {
      id: item.id,
      userId,
      ...(item.projectId ? { projectId: item.projectId.slice(0, 128) } : {}),
      sourcePreview: cleanPreview,
      config: cleanConfig,
      result: cleanResult,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteGenerationFromFirestore(
  userId: string,
  generationId: string
): Promise<void> {
  const path = `users/${userId}/generations/${generationId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'generations', generationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearGenerationsFromFirestore(
  userId: string,
  generationIds: string[]
): Promise<void> {
  if (generationIds.length === 0) return;
  const path = `users/${userId}/generations`;
  try {
    const batch = writeBatch(db);
    for (const id of generationIds) {
      batch.delete(doc(db, 'users', userId, 'generations', id));
    }
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function loadWorkspaceSettingsFromFirestore(
  userId: string
): Promise<CreatorSettings | null> {
  const path = `users/${userId}/settings/workspace`;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'settings', 'workspace'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      creatorName: String(data.creatorName || 'Creator'),
      brandHandle: String(data.brandHandle || ''),
      niche: String(data.niche || ''),
      brandVoice: String(data.brandVoice || ''),
      defaultPlatform: VALID_PLATFORMS.includes(data.defaultPlatform)
        ? data.defaultPlatform
        : 'Instagram',
      defaultLanguage: VALID_LANGUAGES.includes(data.defaultLanguage)
        ? data.defaultLanguage
        : 'English',
      defaultTone: VALID_TONES.includes(data.defaultTone)
        ? data.defaultTone
        : 'Educational',
      defaultDuration: VALID_DURATIONS.includes(data.defaultDuration)
        ? data.defaultDuration
        : '30 sec',
      exportFormat:
        data.exportFormat === 'txt' || data.exportFormat === 'json'
          ? data.exportFormat
          : 'markdown',
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveWorkspaceSettingsToFirestore(
  userId: string,
  settings: CreatorSettings
): Promise<void> {
  const path = `users/${userId}/settings/workspace`;
  const ref = doc(db, 'users', userId, 'settings', 'workspace');
  const payload = {
    userId,
    creatorName: (settings.creatorName || 'Creator').trim().slice(0, 100) || 'Creator',
    brandHandle: (settings.brandHandle || '').trim().slice(0, 60),
    niche: (settings.niche || '').trim().slice(0, 150),
    brandVoice: (settings.brandVoice || '').trim().slice(0, 400),
    defaultPlatform: VALID_PLATFORMS.includes(settings.defaultPlatform)
      ? settings.defaultPlatform
      : 'Instagram',
    defaultLanguage: VALID_LANGUAGES.includes(settings.defaultLanguage)
      ? settings.defaultLanguage
      : 'English',
    defaultTone: VALID_TONES.includes(settings.defaultTone)
      ? settings.defaultTone
      : 'Educational',
    defaultDuration: VALID_DURATIONS.includes(settings.defaultDuration)
      ? settings.defaultDuration
      : '30 sec',
    exportFormat:
      settings.exportFormat === 'txt' || settings.exportFormat === 'json'
        ? settings.exportFormat
        : 'markdown',
    updatedAt: serverTimestamp(),
  };

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      await updateDoc(ref, {
        creatorName: payload.creatorName,
        brandHandle: payload.brandHandle,
        niche: payload.niche,
        brandVoice: payload.brandVoice,
        defaultPlatform: payload.defaultPlatform,
        defaultLanguage: payload.defaultLanguage,
        defaultTone: payload.defaultTone,
        defaultDuration: payload.defaultDuration,
        exportFormat: payload.exportFormat,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function sanitizeSteps(steps: AssistantPipelineStep[]): AssistantPipelineStep[] {
  const safe = (steps || []).slice(0, 10).map((s, idx) => ({
    id: String(s.id || `step_${idx + 1}`).slice(0, 80),
    label: String(s.label || `Step ${idx + 1}`).slice(0, 200),
    detail: String(s.detail || '').slice(0, 500),
    status: s.status || 'pending',
    ...(s.updatedAt ? { updatedAt: String(s.updatedAt).slice(0, 60) } : {}),
  }));
  if (safe.length === 0) {
    return [
      {
        id: 'step_context',
        label: 'Initialize workflow',
        detail: 'Preparing backend execution',
        status: 'running',
      },
    ];
  }
  return safe;
}

export function subscribeToAssistantConversations(
  userId: string,
  onData: (conversations: AssistantConversation[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/assistantConversations`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: AssistantConversation[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.id || docSnap.id),
          userId: String(data.userId || userId),
          title: String(data.title || 'Creator Assistant Session'),
          ...(data.projectId ? { projectId: String(data.projectId) } : {}),
          ...(data.projectTitle ? { projectTitle: String(data.projectTitle) } : {}),
          ...(data.mediaName ? { mediaName: String(data.mediaName) } : {}),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      items.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export function subscribeToAssistantMessages(
  userId: string,
  conversationId: string,
  onData: (messages: AssistantMessage[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/assistantConversations/${conversationId}/messages`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: AssistantMessage[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.id || docSnap.id),
          userId: String(data.userId || userId),
          conversationId: String(data.conversationId || conversationId),
          role:
            data.role === 'user' || data.role === 'system'
              ? data.role
              : 'assistant',
          content: String(data.content || ''),
          ...(data.taskId ? { taskId: String(data.taskId) } : {}),
          createdAt: toIsoString(data.createdAt),
        };
      });
      items.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export function subscribeToAssistantTasks(
  userId: string,
  onData: (tasks: AssistantTask[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/assistantTasks`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: AssistantTask[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.id || docSnap.id),
          userId: String(data.userId || userId),
          conversationId: String(data.conversationId || ''),
          jobId: String(data.jobId || ''),
          instruction: String(data.instruction || ''),
          ...(data.projectId ? { projectId: String(data.projectId) } : {}),
          ...(data.projectTitle ? { projectTitle: String(data.projectTitle) } : {}),
          ...(data.mediaName ? { mediaName: String(data.mediaName) } : {}),
          language: VALID_LANGUAGES.includes(data.language)
            ? data.language
            : 'English',
          status:
            data.status === 'queued' ||
            data.status === 'running' ||
            data.status === 'completed' ||
            data.status === 'failed'
              ? data.status
              : 'running',
          confirmedByBackend: Boolean(data.confirmedByBackend),
          approvalStatus:
            data.approvalStatus === 'approved' ||
            data.approvalStatus === 'published'
              ? data.approvalStatus
              : 'pending_approval',
          ...(data.approvedAt ? { approvedAt: String(data.approvedAt) } : {}),
          ...(data.publishedAt ? { publishedAt: String(data.publishedAt) } : {}),
          ...(data.error ? { error: String(data.error) } : {}),
          steps: Array.isArray(data.steps)
            ? (data.steps as AssistantPipelineStep[])
            : [],
          ...(data.outputs
            ? { outputs: data.outputs as AssistantTaskOutputs }
            : {}),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      items.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function saveAssistantConversation(
  userId: string,
  conv: AssistantConversation,
  mode: 'create' | 'update' = 'create'
): Promise<void> {
  const path = `users/${userId}/assistantConversations/${conv.id}`;
  const cleanTitle =
    (conv.title || 'Assistant Session').trim().slice(0, 140) ||
    'Assistant Session';

  const optionalFields: Record<string, string> = {};
  if (conv.projectId?.trim()) {
    optionalFields.projectId = conv.projectId.trim().slice(0, 128);
  }
  if (conv.projectTitle?.trim()) {
    optionalFields.projectTitle = conv.projectTitle.trim().slice(0, 140);
  }
  if (conv.mediaName?.trim()) {
    optionalFields.mediaName = conv.mediaName.trim().slice(0, 200);
  }

  try {
    const ref = doc(db, 'users', userId, 'assistantConversations', conv.id);
    if (mode === 'update') {
      await updateDoc(ref, {
        title: cleanTitle,
        ...optionalFields,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: conv.id,
        userId,
        title: cleanTitle,
        ...optionalFields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(
      error,
      mode === 'update' ? OperationType.UPDATE : OperationType.CREATE,
      path
    );
  }
}

export async function addAssistantMessage(
  userId: string,
  conversationId: string,
  message: AssistantMessage
): Promise<void> {
  const path = `users/${userId}/assistantConversations/${conversationId}/messages/${message.id}`;
  const cleanContent = (message.content || '').trim().slice(0, 12000) || '...';
  try {
    const ref = doc(
      db,
      'users',
      userId,
      'assistantConversations',
      conversationId,
      'messages',
      message.id
    );
    await setDoc(ref, {
      id: message.id,
      userId,
      conversationId,
      role: message.role,
      content: cleanContent,
      ...(message.taskId?.trim()
        ? { taskId: message.taskId.trim().slice(0, 128) }
        : {}),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function createAssistantTask(
  userId: string,
  task: AssistantTask
): Promise<void> {
  const path = `users/${userId}/assistantTasks/${task.id}`;
  const cleanLanguage = VALID_LANGUAGES.includes(task.language)
    ? task.language
    : 'English';

  try {
    const ref = doc(db, 'users', userId, 'assistantTasks', task.id);
    await setDoc(ref, {
      id: task.id,
      userId,
      conversationId: task.conversationId.slice(0, 128),
      jobId: task.jobId.slice(0, 128),
      instruction: (task.instruction || 'Workflow task').trim().slice(0, 4000),
      ...(task.projectId?.trim()
        ? { projectId: task.projectId.trim().slice(0, 128) }
        : {}),
      ...(task.projectTitle?.trim()
        ? { projectTitle: task.projectTitle.trim().slice(0, 140) }
        : {}),
      ...(task.mediaName?.trim()
        ? { mediaName: task.mediaName.trim().slice(0, 200) }
        : {}),
      language: cleanLanguage,
      status: task.status === 'queued' ? 'queued' : 'running',
      confirmedByBackend: false,
      approvalStatus: 'pending_approval',
      steps: sanitizeSteps(task.steps),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAssistantTask(
  userId: string,
  taskId: string,
  updates: {
    status?: AssistantTask['status'];
    confirmedByBackend?: boolean;
    approvalStatus?: AssistantTask['approvalStatus'];
    approvedAt?: string;
    publishedAt?: string;
    error?: string;
    steps?: AssistantPipelineStep[];
    outputs?: AssistantTaskOutputs;
  }
): Promise<void> {
  const path = `users/${userId}/assistantTasks/${taskId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.confirmedByBackend !== undefined) {
    payload.confirmedByBackend = Boolean(updates.confirmedByBackend);
  }
  if (updates.approvalStatus !== undefined) {
    payload.approvalStatus = updates.approvalStatus;
  }
  if (updates.approvedAt) {
    payload.approvedAt = updates.approvedAt.slice(0, 60);
  }
  if (updates.publishedAt) {
    payload.publishedAt = updates.publishedAt.slice(0, 60);
  }
  if (updates.error !== undefined && updates.error.trim()) {
    payload.error = updates.error.trim().slice(0, 1000);
  }
  if (updates.steps !== undefined) {
    payload.steps = sanitizeSteps(updates.steps);
  }
  if (updates.outputs !== undefined) {
    payload.outputs = stripUndefinedDeep(updates.outputs);
  }

  try {
    await updateDoc(doc(db, 'users', userId, 'assistantTasks', taskId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

const VALID_SOCIAL_PLATFORMS: SocialPlatform[] = [
  'instagram',
  'youtube',
  'linkedin',
  'facebook',
];

export function subscribeToSocialConnections(
  userId: string,
  onData: (connections: SocialConnectionSummary[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/socialConnections`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SocialConnectionSummary[] = snapshot.docs
        .map((docSnap): SocialConnectionSummary | null => {
          const data = docSnap.data();
          const platform = VALID_SOCIAL_PLATFORMS.includes(data.platform)
            ? (data.platform as SocialPlatform)
            : (docSnap.id as SocialPlatform);
          if (!VALID_SOCIAL_PLATFORMS.includes(platform)) return null;

          return {
            id: platform,
            userId: String(data.userId || userId),
            platform,
            status: (data.status || 'disconnected') as SocialConnectionSummary['status'],
            ...(data.accountName ? { accountName: String(data.accountName) } : {}),
            ...(data.accountHandle ? { accountHandle: String(data.accountHandle) } : {}),
            ...(data.externalAccountId
              ? { externalAccountId: String(data.externalAccountId) }
              : {}),
            ...(Array.isArray(data.scopes)
              ? { scopes: data.scopes.map(String) }
              : {}),
            ...(data.tokenExpiresAt
              ? { tokenExpiresAt: String(data.tokenExpiresAt) }
              : {}),
            ...(data.lastCheckedAt
              ? { lastCheckedAt: String(data.lastCheckedAt) }
              : {}),
            ...(data.lastError ? { lastError: String(data.lastError) } : {}),
            ...(data.connectedAt ? { connectedAt: String(data.connectedAt) } : {}),
            updatedAt: toIsoString(data.updatedAt),
          };
        })
        .filter((x): x is SocialConnectionSummary => x !== null);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function syncSocialConnectionMetadata(
  userId: string,
  conn: SocialConnectionSummary
): Promise<void> {
  const path = `users/${userId}/socialConnections/${conn.platform}`;
  const cleanScopes = Array.isArray(conn.scopes)
    ? conn.scopes
        .map((s) => String(s).trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 20)
    : undefined;

  const payload: Record<string, unknown> = {
    id: conn.platform,
    userId,
    platform: conn.platform,
    status: conn.status,
    updatedAt: serverTimestamp(),
  };

  if (conn.accountName?.trim()) {
    payload.accountName = conn.accountName.trim().slice(0, 140);
  }
  if (conn.accountHandle?.trim()) {
    payload.accountHandle = conn.accountHandle.trim().slice(0, 120);
  }
  if (conn.externalAccountId?.trim()) {
    payload.externalAccountId = conn.externalAccountId.trim().slice(0, 140);
  }
  if (cleanScopes) {
    payload.scopes = cleanScopes;
  }
  if (conn.tokenExpiresAt?.trim()) {
    payload.tokenExpiresAt = conn.tokenExpiresAt.trim().slice(0, 60);
  }
  if (conn.lastCheckedAt?.trim()) {
    payload.lastCheckedAt = conn.lastCheckedAt.trim().slice(0, 60);
  }
  if (conn.lastError?.trim()) {
    payload.lastError = conn.lastError.trim().slice(0, 600);
  }
  if (conn.connectedAt?.trim()) {
    payload.connectedAt = conn.connectedAt.trim().slice(0, 60);
  }

  try {
    await setDoc(doc(db, 'users', userId, 'socialConnections', conn.platform), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeToSocialPosts(
  userId: string,
  onData: (posts: SocialPost[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/socialPosts`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SocialPost[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.id || docSnap.id),
          userId: String(data.userId || userId),
          platform: VALID_SOCIAL_PLATFORMS.includes(data.platform)
            ? (data.platform as SocialPlatform)
            : 'linkedin',
          ...(data.title ? { title: String(data.title) } : {}),
          caption: String(data.caption || ''),
          ...(Array.isArray(data.hashtags)
            ? { hashtags: data.hashtags.map(String) }
            : {}),
          ...(data.mediaUrl ? { mediaUrl: String(data.mediaUrl) } : {}),
          mediaType:
            data.mediaType === 'image' ||
            data.mediaType === 'video' ||
            data.mediaType === 'link'
              ? data.mediaType
              : 'none',
          ...(data.youtubePrivacy === 'private' ||
          data.youtubePrivacy === 'unlisted' ||
          data.youtubePrivacy === 'public'
            ? { youtubePrivacy: data.youtubePrivacy }
            : {}),
          ...(data.projectId ? { projectId: String(data.projectId) } : {}),
          approvalStatus:
            data.approvalStatus === 'approved' ? 'approved' : 'pending_approval',
          ...(data.approvedAt ? { approvedAt: String(data.approvedAt) } : {}),
          status:
            data.status === 'scheduled' ||
            data.status === 'publishing' ||
            data.status === 'published' ||
            data.status === 'failed'
              ? data.status
              : 'draft',
          ...(data.scheduledFor ? { scheduledFor: String(data.scheduledFor) } : {}),
          ...(data.publishedAt ? { publishedAt: String(data.publishedAt) } : {}),
          ...(data.externalPostId
            ? { externalPostId: String(data.externalPostId) }
            : {}),
          ...(data.externalPostUrl
            ? { externalPostUrl: String(data.externalPostUrl) }
            : {}),
          ...(data.error ? { error: String(data.error) } : {}),
          ...(data.errorCode ? { errorCode: String(data.errorCode) } : {}),
          ...(data.analytics
            ? { analytics: data.analytics as SocialPostAnalytics }
            : {}),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      items.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function createSocialPostDraft(
  userId: string,
  post: SocialPost
): Promise<void> {
  const path = `users/${userId}/socialPosts/${post.id}`;
  const cleanCaption = (post.caption || '').trim().slice(0, 6000) || 'Social post draft';
  const cleanHashtags = Array.isArray(post.hashtags)
    ? post.hashtags
        .map((t) => String(t).trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 30)
    : undefined;

  const payload: Record<string, unknown> = {
    id: post.id,
    userId,
    platform: post.platform,
    caption: cleanCaption,
    mediaType: post.mediaType || 'none',
    approvalStatus: 'pending_approval',
    status: 'draft',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (post.title?.trim()) {
    payload.title = post.title.trim().slice(0, 200);
  }
  if (cleanHashtags && cleanHashtags.length > 0) {
    payload.hashtags = cleanHashtags;
  }
  if (post.mediaUrl?.trim()) {
    payload.mediaUrl = post.mediaUrl.trim().slice(0, 1500);
  }
  if (post.youtubePrivacy && post.platform === 'youtube') {
    payload.youtubePrivacy = post.youtubePrivacy;
  }
  if (post.projectId?.trim()) {
    payload.projectId = post.projectId.trim().slice(0, 128);
  }
  if (post.scheduledFor?.trim()) {
    payload.scheduledFor = post.scheduledFor.trim().slice(0, 60);
  }

  try {
    await setDoc(doc(db, 'users', userId, 'socialPosts', post.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSocialPost(
  userId: string,
  postId: string,
  updates: {
    title?: string | null;
    caption?: string;
    hashtags?: string[] | null;
    mediaUrl?: string | null;
    mediaType?: SocialPost['mediaType'];
    youtubePrivacy?: SocialPost['youtubePrivacy'] | null;
    projectId?: string | null;
    approvalStatus?: SocialPost['approvalStatus'];
    approvedAt?: string | null;
    status?: SocialPost['status'];
    scheduledFor?: string | null;
    publishedAt?: string | null;
    externalPostId?: string | null;
    externalPostUrl?: string | null;
    error?: string | null;
    errorCode?: string | null;
    analytics?: SocialPostAnalytics | null;
  }
): Promise<void> {
  const path = `users/${userId}/socialPosts/${postId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (updates.title !== undefined) {
    payload.title = updates.title?.trim()
      ? updates.title.trim().slice(0, 200)
      : deleteField();
  }
  if (updates.caption !== undefined) {
    payload.caption = updates.caption.trim().slice(0, 6000) || 'Post';
  }
  if (updates.hashtags !== undefined) {
    if (updates.hashtags && updates.hashtags.length > 0) {
      payload.hashtags = updates.hashtags
        .map((t) => String(t).trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 30);
    } else {
      payload.hashtags = deleteField();
    }
  }
  if (updates.mediaUrl !== undefined) {
    payload.mediaUrl = updates.mediaUrl?.trim()
      ? updates.mediaUrl.trim().slice(0, 1500)
      : deleteField();
  }
  if (updates.mediaType !== undefined) {
    payload.mediaType = updates.mediaType;
  }
  if (updates.youtubePrivacy !== undefined) {
    payload.youtubePrivacy = updates.youtubePrivacy || deleteField();
  }
  if (updates.projectId !== undefined) {
    payload.projectId = updates.projectId?.trim()
      ? updates.projectId.trim().slice(0, 128)
      : deleteField();
  }
  if (updates.approvalStatus !== undefined) {
    payload.approvalStatus = updates.approvalStatus;
  }
  if (updates.approvedAt !== undefined) {
    payload.approvedAt = updates.approvedAt?.trim()
      ? updates.approvedAt.trim().slice(0, 60)
      : deleteField();
  }
  if (updates.status !== undefined) {
    payload.status = updates.status;
  }
  if (updates.scheduledFor !== undefined) {
    payload.scheduledFor = updates.scheduledFor?.trim()
      ? updates.scheduledFor.trim().slice(0, 60)
      : deleteField();
  }
  if (updates.publishedAt !== undefined) {
    payload.publishedAt = updates.publishedAt?.trim()
      ? updates.publishedAt.trim().slice(0, 60)
      : deleteField();
  }
  if (updates.externalPostId !== undefined) {
    payload.externalPostId = updates.externalPostId?.trim()
      ? updates.externalPostId.trim().slice(0, 200)
      : deleteField();
  }
  if (updates.externalPostUrl !== undefined) {
    payload.externalPostUrl = updates.externalPostUrl?.trim()
      ? updates.externalPostUrl.trim().slice(0, 600)
      : deleteField();
  }
  if (updates.error !== undefined) {
    payload.error = updates.error?.trim()
      ? updates.error.trim().slice(0, 1000)
      : deleteField();
  }
  if (updates.errorCode !== undefined) {
    payload.errorCode = updates.errorCode?.trim()
      ? updates.errorCode.trim().slice(0, 80)
      : deleteField();
  }
  if (updates.analytics !== undefined) {
    payload.analytics = updates.analytics
      ? stripUndefinedDeep(updates.analytics)
      : deleteField();
  }

  try {
    await updateDoc(doc(db, 'users', userId, 'socialPosts', postId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSocialPost(
  userId: string,
  postId: string
): Promise<void> {
  const path = `users/${userId}/socialPosts/${postId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'socialPosts', postId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function loadBrandKitFromFirestore(
  userId: string
): Promise<BrandKitConfig | null> {
  const path = `users/${userId}/brandKit/default`;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'brandKit', 'default'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      userId: String(data.userId || userId),
      brandName: String(data.brandName || DEFAULT_BRAND_KIT.brandName),
      brandHandle: String(data.brandHandle || ''),
      tagline: String(data.tagline || ''),
      ...(data.logoUrl ? { logoUrl: String(data.logoUrl) } : {}),
      ...(data.logoStoragePath
        ? { logoStoragePath: String(data.logoStoragePath) }
        : {}),
      colors: {
        primary: String(data.colors?.primary || DEFAULT_BRAND_KIT.colors.primary),
        secondary: String(
          data.colors?.secondary || DEFAULT_BRAND_KIT.colors.secondary
        ),
        accent: String(data.colors?.accent || DEFAULT_BRAND_KIT.colors.accent),
        background: String(
          data.colors?.background || DEFAULT_BRAND_KIT.colors.background
        ),
        text: String(data.colors?.text || DEFAULT_BRAND_KIT.colors.text),
      },
      typography: {
        headingFont: String(
          data.typography?.headingFont || DEFAULT_BRAND_KIT.typography.headingFont
        ),
        bodyFont: String(
          data.typography?.bodyFont || DEFAULT_BRAND_KIT.typography.bodyFont
        ),
      },
      brandVoice: String(data.brandVoice || ''),
      preferredCtas: Array.isArray(data.preferredCtas)
        ? data.preferredCtas.map(String).slice(0, 12)
        : [],
      captionStyle: {
        emojiDensity:
          data.captionStyle?.emojiDensity === 'minimal' ||
          data.captionStyle?.emojiDensity === 'expressive'
            ? data.captionStyle.emojiDensity
            : 'balanced',
        lineSpacing:
          data.captionStyle?.lineSpacing === 'compact' ? 'compact' : 'airy',
        includeHashtagsInCaption:
          typeof data.captionStyle?.includeHashtagsInCaption === 'boolean'
            ? data.captionStyle.includeHashtagsInCaption
            : true,
        signatureFooter: String(data.captionStyle?.signatureFooter || ''),
      },
      templates: Array.isArray(data.templates)
        ? (data.templates as BrandKitConfig['templates']).slice(0, 15)
        : [],
      updatedAt: toIsoString(data.updatedAt),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveBrandKitToFirestore(
  userId: string,
  kit: BrandKitConfig
): Promise<void> {
  const path = `users/${userId}/brandKit/default`;
  const ref = doc(db, 'users', userId, 'brandKit', 'default');

  const cleanCtas = (kit.preferredCtas || [])
    .map((c) => String(c).trim().slice(0, 280))
    .filter(Boolean)
    .slice(0, 12);

  const cleanTemplates = (kit.templates || []).slice(0, 15).map((t, idx) => ({
    id: String(t.id || `tpl-${idx + 1}`).slice(0, 80),
    name: String(t.name || 'Brand Template').trim().slice(0, 100) || 'Brand Template',
    platform: VALID_PLATFORMS.includes(t.platform) ? t.platform : 'Instagram',
    tone: VALID_TONES.includes(t.tone) ? t.tone : 'Educational',
    hookFormula: String(t.hookFormula || '').trim().slice(0, 300),
    structureNotes: String(t.structureNotes || '').trim().slice(0, 600),
    defaultCta: String(t.defaultCta || '').trim().slice(0, 280),
  }));

  const payload: Record<string, unknown> = {
    userId,
    brandName: (kit.brandName || 'Creator Brand').trim().slice(0, 120) || 'Creator Brand',
    brandHandle: (kit.brandHandle || '').trim().slice(0, 80),
    tagline: (kit.tagline || '').trim().slice(0, 240),
    colors: {
      primary: String(kit.colors?.primary || '#7C3AED').slice(0, 20),
      secondary: String(kit.colors?.secondary || '#2563EB').slice(0, 20),
      accent: String(kit.colors?.accent || '#0EA5E9').slice(0, 20),
      background: String(kit.colors?.background || '#0F172A').slice(0, 20),
      text: String(kit.colors?.text || '#F8FAFC').slice(0, 20),
    },
    typography: {
      headingFont: String(kit.typography?.headingFont || 'Plus Jakarta Sans').slice(0, 80),
      bodyFont: String(kit.typography?.bodyFont || 'DM Sans').slice(0, 80),
    },
    brandVoice: (kit.brandVoice || '').trim().slice(0, 600),
    preferredCtas: cleanCtas,
    captionStyle: {
      emojiDensity: kit.captionStyle?.emojiDensity || 'balanced',
      lineSpacing: kit.captionStyle?.lineSpacing || 'airy',
      includeHashtagsInCaption: Boolean(kit.captionStyle?.includeHashtagsInCaption),
      signatureFooter: String(kit.captionStyle?.signatureFooter || '').trim().slice(0, 240),
    },
    templates: cleanTemplates,
    updatedAt: serverTimestamp(),
  };

  if (kit.logoUrl?.trim()) {
    payload.logoUrl = kit.logoUrl.trim().slice(0, 1500);
  }
  if (kit.logoStoragePath?.trim()) {
    payload.logoStoragePath = kit.logoStoragePath.trim().slice(0, 300);
  }

  try {
    const existingSnap = await getDoc(ref);
    if (existingSnap.exists()) {
      const updatePayload: Record<string, unknown> = {
        brandName: payload.brandName,
        brandHandle: payload.brandHandle,
        tagline: payload.tagline,
        colors: payload.colors,
        typography: payload.typography,
        brandVoice: payload.brandVoice,
        preferredCtas: payload.preferredCtas,
        captionStyle: payload.captionStyle,
        templates: payload.templates,
        logoUrl: kit.logoUrl?.trim() ? kit.logoUrl.trim().slice(0, 1500) : deleteField(),
        logoStoragePath: kit.logoStoragePath?.trim()
          ? kit.logoStoragePath.trim().slice(0, 300)
          : deleteField(),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(ref, updatePayload);
    } else {
      await setDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeToVideoJobs(
  userId: string,
  onData: (jobs: VideoRenderJob[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/videoJobs`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: VideoRenderJob[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.id || docSnap.id),
          userId: String(data.userId || userId),
          ...(data.uploadId ? { uploadId: String(data.uploadId) } : {}),
          sourceFileName: String(data.sourceFileName || 'video.mp4'),
          sourceDurationSec: Number(data.sourceDurationSec || 0),
          sourceWidth: Number(data.sourceWidth || 1920),
          sourceHeight: Number(data.sourceHeight || 1080),
          clipTitle: String(data.clipTitle || 'Clip'),
          startSec: Number(data.startSec || 0),
          endSec: Number(data.endSec || 0),
          aspectRatio:
            data.aspectRatio === '1:1' || data.aspectRatio === '16:9'
              ? data.aspectRatio
              : '9:16',
          language: VALID_LANGUAGES.includes(data.language)
            ? data.language
            : 'English',
          subtitleStyle: data.subtitleStyle as VideoRenderJob['subtitleStyle'],
          subtitlesCount: Number(data.subtitlesCount || 0),
          status:
            data.status === 'queued' ||
            data.status === 'processing' ||
            data.status === 'completed' ||
            data.status === 'failed'
              ? data.status
              : 'queued',
          progress: Number(data.progress || 0),
          stageMessage: String(data.stageMessage || ''),
          ...(data.outputFileName
            ? { outputFileName: String(data.outputFileName) }
            : {}),
          ...(data.downloadUrl ? { downloadUrl: String(data.downloadUrl) } : {}),
          ...(data.storageUrl ? { storageUrl: String(data.storageUrl) } : {}),
          ...(data.storagePath ? { storagePath: String(data.storagePath) } : {}),
          ...(typeof data.outputBytes === 'number'
            ? { outputBytes: data.outputBytes }
            : {}),
          ...(data.error ? { error: String(data.error) } : {}),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      items.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function saveVideoJobToFirestore(
  userId: string,
  job: VideoRenderJob
): Promise<void> {
  const path = `users/${userId}/videoJobs/${job.id}`;
  const cleanLanguage = VALID_LANGUAGES.includes(job.language)
    ? job.language
    : 'English';

  const payload: Record<string, unknown> = {
    id: job.id,
    userId,
    ...(job.uploadId?.trim() ? { uploadId: job.uploadId.trim().slice(0, 128) } : {}),
    sourceFileName: (job.sourceFileName || 'video.mp4').slice(0, 240),
    sourceDurationSec: Number(job.sourceDurationSec || 0),
    sourceWidth: Number(job.sourceWidth || 1920),
    sourceHeight: Number(job.sourceHeight || 1080),
    clipTitle: (job.clipTitle || 'Clip').trim().slice(0, 160) || 'Clip',
    startSec: Number(job.startSec || 0),
    endSec: Number(job.endSec || 1),
    aspectRatio: job.aspectRatio,
    language: cleanLanguage,
    subtitleStyle: stripUndefinedDeep(job.subtitleStyle),
    subtitlesCount: Number(job.subtitlesCount || 0),
    status: job.status,
    progress: Number(job.progress || 0),
    stageMessage: (job.stageMessage || 'Queued').slice(0, 400),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', userId, 'videoJobs', job.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateVideoJobInFirestore(
  userId: string,
  jobId: string,
  updates: {
    status?: VideoRenderJob['status'];
    progress?: number;
    stageMessage?: string;
    outputFileName?: string;
    downloadUrl?: string;
    storageUrl?: string;
    storagePath?: string;
    outputBytes?: number;
    error?: string | null;
  }
): Promise<void> {
  const path = `users/${userId}/videoJobs/${jobId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.progress !== undefined) payload.progress = Number(updates.progress);
  if (updates.stageMessage !== undefined) {
    payload.stageMessage = String(updates.stageMessage).slice(0, 400);
  }
  if (updates.outputFileName !== undefined) {
    payload.outputFileName = String(updates.outputFileName).slice(0, 240);
  }
  if (updates.downloadUrl !== undefined) {
    payload.downloadUrl = String(updates.downloadUrl).slice(0, 1500);
  }
  if (updates.storageUrl !== undefined) {
    payload.storageUrl = String(updates.storageUrl).slice(0, 1500);
  }
  if (updates.storagePath !== undefined) {
    payload.storagePath = String(updates.storagePath).slice(0, 300);
  }
  if (updates.outputBytes !== undefined) {
    payload.outputBytes = Number(updates.outputBytes);
  }
  if (updates.error !== undefined) {
    payload.error = updates.error?.trim()
      ? updates.error.trim().slice(0, 1000)
      : deleteField();
  }

  try {
    await updateDoc(doc(db, 'users', userId, 'videoJobs', jobId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteVideoJobFromFirestore(
  userId: string,
  jobId: string
): Promise<void> {
  const path = `users/${userId}/videoJobs/${jobId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'videoJobs', jobId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToThumbnails(
  userId: string,
  onData: (items: ThumbnailAsset[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/thumbnails`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: ThumbnailAsset[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: String(data.id || docSnap.id),
          userId: String(data.userId || userId),
          title: String(data.title || 'Thumbnail Design'),
          headline: String(data.headline || ''),
          kicker: String(data.kicker || ''),
          ...(data.statCallout ? { statCallout: String(data.statCallout) } : {}),
          aspectRatio:
            data.aspectRatio === '9:16' || data.aspectRatio === '1:1'
              ? data.aspectRatio
              : '16:9',
          stylePreset:
            data.stylePreset === 'editorial-minimal' ||
            data.stylePreset === 'tech-dark' ||
            data.stylePreset === 'split-comparison' ||
            data.stylePreset === 'stat-spotlight'
              ? data.stylePreset
              : 'bold-creator',
          layout:
            data.layout === 'center-spotlight' ||
            data.layout === 'bottom-editorial' ||
            data.layout === 'stat-grid'
              ? data.layout
              : 'split-left',
          palette: {
            background: String(data.palette?.background || '#0F172A'),
            surface: String(data.palette?.surface || '#1E293B'),
            accent: String(data.palette?.accent || '#7C3AED'),
            text: String(data.palette?.text || '#F8FAFC'),
            mutedText: String(data.palette?.mutedText || '#CBD5E1'),
          },
          storageUrl: String(data.storageUrl || ''),
          storagePath: String(data.storagePath || ''),
          ...(data.projectId ? { projectId: String(data.projectId) } : {}),
          ...(data.ctrRationale ? { ctrRationale: String(data.ctrRationale) } : {}),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      items.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function saveThumbnailToFirestore(
  userId: string,
  asset: ThumbnailAsset
): Promise<void> {
  const path = `users/${userId}/thumbnails/${asset.id}`;
  const payload: Record<string, unknown> = {
    id: asset.id,
    userId,
    title: (asset.title || 'Thumbnail Design').trim().slice(0, 160) || 'Thumbnail Design',
    headline: (asset.headline || 'CREATOR PLAYBOOK').trim().slice(0, 120) || 'CREATOR PLAYBOOK',
    kicker: (asset.kicker || '').trim().slice(0, 80),
    aspectRatio: asset.aspectRatio,
    stylePreset: asset.stylePreset,
    layout: asset.layout,
    palette: {
      background: String(asset.palette.background || '#0F172A').slice(0, 20),
      surface: String(asset.palette.surface || '#1E293B').slice(0, 20),
      accent: String(asset.palette.accent || '#7C3AED').slice(0, 20),
      text: String(asset.palette.text || '#F8FAFC').slice(0, 20),
      mutedText: String(asset.palette.mutedText || '#CBD5E1').slice(0, 20),
    },
    storageUrl: asset.storageUrl.trim().slice(0, 1500),
    storagePath: asset.storagePath.trim().slice(0, 300),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (asset.statCallout?.trim()) {
    payload.statCallout = asset.statCallout.trim().slice(0, 60);
  }
  if (asset.projectId?.trim()) {
    payload.projectId = asset.projectId.trim().slice(0, 128);
  }
  if (asset.ctrRationale?.trim()) {
    payload.ctrRationale = asset.ctrRationale.trim().slice(0, 600);
  }

  try {
    await setDoc(doc(db, 'users', userId, 'thumbnails', asset.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteThumbnailFromFirestore(
  userId: string,
  thumbnailId: string
): Promise<void> {
  const path = `users/${userId}/thumbnails/${thumbnailId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'thumbnails', thumbnailId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToAiVideoJobs(
  userId: string,
  onData: (jobs: AiVideoJobRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/aiVideoJobs`;
  const q = query(collection(db, path), where('userId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: AiVideoJobRecord[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        const dur = Number(data.durationSec);
        const durationSec: AiVideoDurationSec =
          dur === 15 || dur === 30 || dur === 60 || dur === 90 ? dur : 30;
        const style: AiVideoStyle =
          data.style === 'documentary' ||
          data.style === 'modern-tech' ||
          data.style === 'minimalist' ||
          data.style === 'energetic-social' ||
          data.style === 'storytelling'
            ? data.style
            : 'cinematic';
        const voice: AiVideoVoiceId =
          data.voice === 'none' ||
          data.voice === 'Puck' ||
          data.voice === 'Charon' ||
          data.voice === 'Fenrir' ||
          data.voice === 'Zephyr'
            ? data.voice
            : 'Kore';
        const musicPreset: AiVideoMusicPreset =
          data.musicPreset === 'none' ||
          data.musicPreset === 'tech-pulse' ||
          data.musicPreset === 'cinematic-score' ||
          data.musicPreset === 'lofi-chill' ||
          data.musicPreset === 'ai-lyria'
            ? data.musicPreset
            : 'ambient-uplift';

        return {
          id: String(data.id || docSnap.id),
          userId: String(data.userId || userId),
          visualEngine:
            data.visualEngine === 'ai-omni' ? 'ai-omni' : 'free-motion',
          freeVisualStyle:
            data.freeVisualStyle === 'animated-motion'
              ? 'animated-motion'
              : 'topic-pictures',
          title: String(data.title || 'AI Generated Video'),
          originalScript: String(data.originalScript || ''),
          style,
          durationSec,
          aspectRatio:
            data.aspectRatio === '1:1' || data.aspectRatio === '16:9'
              ? data.aspectRatio
              : '9:16',
          language: VALID_LANGUAGES.includes(data.language)
            ? data.language
            : 'English',
          voice,
          narrationVolume:
            typeof data.narrationVolume === 'number' ? data.narrationVolume : 1.0,
          musicPreset,
          musicVolume:
            typeof data.musicVolume === 'number' ? data.musicVolume : 0.25,
          enableSubtitles: Boolean(data.enableSubtitles ?? true),
          subtitleStyle: data.subtitleStyle as AiVideoJobRecord['subtitleStyle'],
          status:
            data.status === 'processing' ||
            data.status === 'completed' ||
            data.status === 'failed' ||
            data.status === 'cancelled'
              ? data.status
              : 'queued',
          currentStage: (data.currentStage ||
            'analyzing_script') as AiVideoPipelineStage,
          stageMessage: String(data.stageMessage || ''),
          progress: Number(data.progress || 0),
          scenesCount: Number(data.scenesCount || 1),
          completedScenes: Number(data.completedScenes || 0),
          sceneStates: Array.isArray(data.sceneStates)
            ? (data.sceneStates as AiVideoSceneClipState[])
            : [],
          subtitlesCount: Number(data.subtitlesCount || 0),
          estimatedCostUsd: Number(data.estimatedCostUsd || 0),
          ...(data.outputFileName
            ? { outputFileName: String(data.outputFileName) }
            : {}),
          ...(typeof data.outputWidth === 'number'
            ? { outputWidth: data.outputWidth }
            : {}),
          ...(typeof data.outputHeight === 'number'
            ? { outputHeight: data.outputHeight }
            : {}),
          ...(typeof data.actualDurationSec === 'number'
            ? { actualDurationSec: data.actualDurationSec }
            : {}),
          ...(typeof data.outputBytes === 'number'
            ? { outputBytes: data.outputBytes }
            : {}),
          ...(data.downloadUrl ? { downloadUrl: String(data.downloadUrl) } : {}),
          ...(data.srtDownloadUrl
            ? { srtDownloadUrl: String(data.srtDownloadUrl) }
            : {}),
          ...(data.storageUrl ? { storageUrl: String(data.storageUrl) } : {}),
          ...(data.storagePath ? { storagePath: String(data.storagePath) } : {}),
          ...(data.error ? { error: String(data.error) } : {}),
          createdAt: toIsoString(data.createdAt),
          updatedAt: toIsoString(data.updatedAt),
        };
      });
      items.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

function sanitizeSceneStatesForFirestore(
  sceneStates: AiVideoSceneClipState[]
): Record<string, unknown>[] {
  return (sceneStates || []).slice(0, 12).map((s) =>
    stripUndefinedDeep({
      sceneNumber: Number(s.sceneNumber || 1),
      duration: Number(s.duration || 5),
      status: s.status || 'queued',
      attempts: Number(s.attempts || 0),
      ...(typeof s.clipDurationSec === 'number'
        ? { clipDurationSec: s.clipDurationSec }
        : {}),
      ...(typeof s.audioDurationSec === 'number'
        ? { audioDurationSec: s.audioDurationSec }
        : {}),
      ...(s.error ? { error: String(s.error).slice(0, 300) } : {}),
      ...(s.visualStatus ? { visualStatus: s.visualStatus } : {}),
      ...(s.imageUrl ? { imageUrl: String(s.imageUrl).slice(0, 500) } : {}),
      ...(s.imageSource ? { imageSource: s.imageSource } : {}),
      ...(s.imageTitle ? { imageTitle: String(s.imageTitle).slice(0, 180) } : {}),
      ...(s.imageAttribution
        ? { imageAttribution: String(s.imageAttribution).slice(0, 200) }
        : {}),
      ...(typeof s.relevanceScore === 'number'
        ? { relevanceScore: Math.round(s.relevanceScore) }
        : {}),
      ...(s.animationStatus ? { animationStatus: s.animationStatus } : {}),
      ...(s.animationStyle ? { animationStyle: String(s.animationStyle).slice(0, 60) } : {}),
      ...(s.verification
        ? {
            verification: {
              isRelevant: Boolean(s.verification.isRelevant),
              relevanceScore: Math.round(Number(s.verification.relevanceScore || 0)),
              subjectMatch: Math.round(Number(s.verification.subjectMatch || 0)),
              actionMatch: Math.round(Number(s.verification.actionMatch || 0)),
              contextMatch: Math.round(Number(s.verification.contextMatch || 0)),
              reason: String(s.verification.reason || '').slice(0, 240),
              decision: s.verification.decision === 'accept' ? 'accept' : 'reject',
              ...(s.verification.modelUsed
                ? { modelUsed: String(s.verification.modelUsed).slice(0, 60) }
                : {}),
            },
          }
        : {}),
    }) as Record<string, unknown>
  );
}

export async function saveAiVideoJobToFirestore(
  userId: string,
  job: AiVideoJobRecord
): Promise<void> {
  const path = `users/${userId}/aiVideoJobs/${job.id}`;
  const cleanLanguage = VALID_LANGUAGES.includes(job.language)
    ? job.language
    : 'English';

  const cleanSceneStates = sanitizeSceneStatesForFirestore(job.sceneStates || []);

  const payload: Record<string, unknown> = {
    id: job.id,
    userId,
    ...(job.visualEngine ? { visualEngine: job.visualEngine } : {}),
    ...(job.freeVisualStyle ? { freeVisualStyle: job.freeVisualStyle } : {}),
    title: (job.title || 'AI Generated Video').trim().slice(0, 160) || 'AI Generated Video',
    originalScript: (job.originalScript || '').trim().slice(0, 16000) || 'Script',
    style: job.style,
    durationSec: job.durationSec,
    aspectRatio: job.aspectRatio,
    language: cleanLanguage,
    voice: job.voice,
    narrationVolume: Math.max(0, Math.min(1.5, Number(job.narrationVolume ?? 1.0))),
    musicPreset: job.musicPreset,
    musicVolume: Math.max(0, Math.min(1, Number(job.musicVolume ?? 0.25))),
    enableSubtitles: Boolean(job.enableSubtitles),
    subtitleStyle: stripUndefinedDeep(job.subtitleStyle),
    status: job.status,
    currentStage: job.currentStage,
    stageMessage: (job.stageMessage || 'Queued').slice(0, 400),
    progress: Math.max(0, Math.min(100, Number(job.progress || 0))),
    scenesCount: Math.max(1, Math.min(12, Number(job.scenesCount || 1))),
    completedScenes: Math.max(0, Math.min(12, Number(job.completedScenes || 0))),
    sceneStates: cleanSceneStates,
    subtitlesCount: Math.max(0, Math.min(500, Number(job.subtitlesCount || 0))),
    estimatedCostUsd: Math.max(0, Math.min(500, Number(job.estimatedCostUsd || 0))),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', userId, 'aiVideoJobs', job.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateAiVideoJobInFirestore(
  userId: string,
  jobId: string,
  updates: Partial<{
    status: AiVideoJobRecord['status'];
    currentStage: AiVideoJobRecord['currentStage'];
    stageMessage: string;
    progress: number;
    completedScenes: number;
    sceneStates: AiVideoSceneClipState[];
    subtitlesCount: number;
    subtitleStyle: AiVideoJobRecord['subtitleStyle'];
    narrationVolume: number;
    musicPreset: AiVideoJobRecord['musicPreset'];
    musicVolume: number;
    enableSubtitles: boolean;
    outputFileName: string;
    outputWidth: number;
    outputHeight: number;
    actualDurationSec: number;
    outputBytes: number;
    downloadUrl: string;
    srtDownloadUrl: string;
    storageUrl: string;
    storagePath: string;
    error: string | null;
  }>
): Promise<void> {
  const path = `users/${userId}/aiVideoJobs/${jobId}`;
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.currentStage !== undefined) payload.currentStage = updates.currentStage;
  if (updates.stageMessage !== undefined) {
    payload.stageMessage = String(updates.stageMessage).slice(0, 400);
  }
  if (updates.progress !== undefined) {
    payload.progress = Math.max(0, Math.min(100, Number(updates.progress)));
  }
  if (updates.completedScenes !== undefined) {
    payload.completedScenes = Math.max(0, Math.min(12, Number(updates.completedScenes)));
  }
  if (updates.sceneStates !== undefined) {
    payload.sceneStates = sanitizeSceneStatesForFirestore(updates.sceneStates);
  }
  if (updates.subtitlesCount !== undefined) {
    payload.subtitlesCount = Math.max(0, Math.min(500, Number(updates.subtitlesCount)));
  }
  if (updates.subtitleStyle !== undefined) {
    payload.subtitleStyle = stripUndefinedDeep(updates.subtitleStyle);
  }
  if (updates.narrationVolume !== undefined) {
    payload.narrationVolume = Math.max(0, Math.min(1.5, Number(updates.narrationVolume)));
  }
  if (updates.musicPreset !== undefined) payload.musicPreset = updates.musicPreset;
  if (updates.musicVolume !== undefined) {
    payload.musicVolume = Math.max(0, Math.min(1, Number(updates.musicVolume)));
  }
  if (updates.enableSubtitles !== undefined) {
    payload.enableSubtitles = Boolean(updates.enableSubtitles);
  }
  if (updates.outputFileName !== undefined) {
    payload.outputFileName = String(updates.outputFileName).slice(0, 240);
  }
  if (updates.outputWidth !== undefined) payload.outputWidth = Number(updates.outputWidth);
  if (updates.outputHeight !== undefined) payload.outputHeight = Number(updates.outputHeight);
  if (updates.actualDurationSec !== undefined) {
    payload.actualDurationSec = Number(updates.actualDurationSec);
  }
  if (updates.outputBytes !== undefined) payload.outputBytes = Number(updates.outputBytes);
  if (updates.downloadUrl !== undefined) {
    payload.downloadUrl = String(updates.downloadUrl).slice(0, 1500);
  }
  if (updates.srtDownloadUrl !== undefined) {
    payload.srtDownloadUrl = String(updates.srtDownloadUrl).slice(0, 1500);
  }
  if (updates.storageUrl !== undefined) {
    payload.storageUrl = String(updates.storageUrl).slice(0, 1500);
  }
  if (updates.storagePath !== undefined) {
    payload.storagePath = String(updates.storagePath).slice(0, 300);
  }
  if (updates.error !== undefined) {
    payload.error = updates.error?.trim()
      ? updates.error.trim().slice(0, 1000)
      : deleteField();
  }

  try {
    await updateDoc(doc(db, 'users', userId, 'aiVideoJobs', jobId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteAiVideoJobFromFirestore(
  userId: string,
  jobId: string
): Promise<void> {
  const path = `users/${userId}/aiVideoJobs/${jobId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'aiVideoJobs', jobId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}


