import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit3,
  Film,
  FolderOpen,
  History,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Send,
  ShieldCheck,
  Sparkles,
  Subtitles,
  Upload,
  User as UserIcon,
  Video,
  X,
} from 'lucide-react';
import type {
  AssistantConversation,
  AssistantMessage,
  AssistantTask,
  AssistantTaskOutputs,
  ClipProposal,
} from '../types/assistant';
import type { CreatorProject, UploadedMediaInfo } from '../types/creator';

const MAX_INLINE_MEDIA_BYTES = 14 * 1024 * 1024; // 14 MB inline base64 cap

const EXAMPLE_INSTRUCTIONS = [
  'I uploaded a 10-minute educational video. Create three Instagram Reels and two YouTube Shorts in Hindi. Generate captions, hashtags and subtitles.',
  'Turn my selected project into two Instagram Reels and two YouTube Shorts in Bengali with hooks, captions, hashtags, and SRT subtitles.',
  'Analyze the attached media and generate 2 Instagram Reels and 1 YouTube Short in English with full captions, hashtags, and subtitles.',
];

interface AssistantMediaAttachment extends UploadedMediaInfo {
  extractedText?: string;
}

interface AssistantPanelProps {
  projects: CreatorProject[];
  studioMediaInfo: UploadedMediaInfo | null;
  studioSourceText: string;
  conversations: AssistantConversation[];
  activeConversationId: string | null;
  messages: AssistantMessage[];
  tasks: AssistantTask[];
  activeTaskId: string | null;
  isSubmitting: boolean;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onSelectTask: (taskId: string) => void;
  onSendInstruction: (params: {
    message: string;
    selectedProject: CreatorProject | null;
    media: AssistantMediaAttachment | null;
  }) => Promise<void>;
  onSaveTaskOutputs: (
    taskId: string,
    outputs: AssistantTaskOutputs
  ) => Promise<void>;
  onApproveTask: (task: AssistantTask) => Promise<void>;
  onPublishTask: (task: AssistantTask) => Promise<void>;
  onCopyText: (text: string, label: string) => void;
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

type OutputTab = 'clips' | 'subtitles' | 'videoJobs' | 'analysis';

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = res.indexOf(',');
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
    };
    reader.onerror = () => reject(new Error('Failed to read media file.'));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Failed to read text file.'));
    reader.readAsText(file);
  });
}

export function AssistantPanel({
  projects,
  studioMediaInfo,
  studioSourceText,
  conversations,
  activeConversationId,
  messages,
  tasks,
  activeTaskId,
  isSubmitting,
  onSelectConversation,
  onNewConversation,
  onSelectTask,
  onSendInstruction,
  onSaveTaskOutputs,
  onApproveTask,
  onPublishTask,
  onCopyText,
  onNotify,
}: AssistantPanelProps) {
  const [inputText, setInputText] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [attachedMedia, setAttachedMedia] =
    useState<AssistantMediaAttachment | null>(null);
  const [activeTab, setActiveTab] = useState<OutputTab>('clips');
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [clipDraft, setClipDraft] = useState<ClipProposal | null>(null);
  const [hashtagsDraft, setHashtagsDraft] = useState('');
  const [srtDraft, setSrtDraft] = useState('');
  const [isEditingSrt, setIsEditingSrt] = useState(false);
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const effectiveMedia: AssistantMediaAttachment | null =
    attachedMedia || studioMediaInfo;

  const selectedTask = useMemo(() => {
    if (activeTaskId) {
      const found = tasks.find((t) => t.id === activeTaskId);
      if (found) return found;
    }
    if (activeConversationId) {
      const convTask = tasks.find(
        (t) => t.conversationId === activeConversationId
      );
      if (convTask) return convTask;
    }
    return tasks[0] || null;
  }, [tasks, activeTaskId, activeConversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    setEditingClipId(null);
    setClipDraft(null);
    setIsEditingSrt(false);
    setConfirmingPublish(false);
    if (selectedTask?.outputs?.subtitlesSrt) {
      setSrtDraft(selectedTask.outputs.subtitlesSrt);
    } else {
      setSrtDraft('');
    }
  }, [selectedTask?.id, selectedTask?.outputs?.subtitlesSrt]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isText =
      file.type.startsWith('text/') ||
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.srt');
    const isAudio = file.type.startsWith('audio/');
    const kind: 'video' | 'audio' | 'text' = isText
      ? 'text'
      : isAudio
      ? 'audio'
      : 'video';

    try {
      if (kind === 'text') {
        const text = await readFileAsText(file);
        setAttachedMedia({
          name: file.name,
          size: file.size,
          type: file.type || 'text/plain',
          kind: 'text',
          extractedText: text.slice(0, 20000),
        });
        onNotify(
          'Transcript attached',
          `Attached "${file.name}" to Assistant context.`,
          'info'
        );
        return;
      }

      if (file.size <= MAX_INLINE_MEDIA_BYTES) {
        const base64Data = await readFileAsBase64(file);
        setAttachedMedia({
          name: file.name,
          size: file.size,
          type:
            file.type ||
            (kind === 'audio' ? 'audio/mpeg' : 'video/mp4'),
          kind,
          base64Data,
        });
        onNotify(
          'Media attached for Gemini',
          `"${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) is ready for multimodal analysis.`,
          'success'
        );
      } else {
        setAttachedMedia({
          name: file.name,
          size: file.size,
          type:
            file.type ||
            (kind === 'audio' ? 'audio/mpeg' : 'video/mp4'),
          kind,
        });
        onNotify(
          'Media metadata attached',
          `"${file.name}" exceeds the 14 MB inline upload limit. Attached file metadata—add any transcript notes in your instruction for best clip accuracy.`,
          'info'
        );
      }
    } catch (err) {
      onNotify(
        'File read failed',
        err instanceof Error ? err.message : 'Could not read selected file.',
        'error'
      );
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || isSubmitting) return;
    setInputText('');
    await onSendInstruction({
      message: trimmed,
      selectedProject,
      media: effectiveMedia,
    });
  };

  const handleStartEditClip = (clip: ClipProposal) => {
    setEditingClipId(clip.id);
    setClipDraft({ ...clip });
    setHashtagsDraft(clip.hashtags.join(' '));
  };

  const handleSaveClipEdit = async () => {
    if (!selectedTask || !selectedTask.outputs || !clipDraft) return;
    setIsSavingEdits(true);
    try {
      const normalizedTags = hashtagsDraft
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.startsWith('#') ? t : `#${t}`));

      const updatedClip: ClipProposal = {
        ...clipDraft,
        hashtags: normalizedTags,
      };
      const updatedClips = selectedTask.outputs.clips.map((c) =>
        c.id === updatedClip.id ? updatedClip : c
      );
      await onSaveTaskOutputs(selectedTask.id, {
        ...selectedTask.outputs,
        clips: updatedClips,
      });
      setEditingClipId(null);
      setClipDraft(null);
    } finally {
      setIsSavingEdits(false);
    }
  };

  const handleSaveSrtEdit = async () => {
    if (!selectedTask || !selectedTask.outputs) return;
    setIsSavingEdits(true);
    try {
      await onSaveTaskOutputs(selectedTask.id, {
        ...selectedTask.outputs,
        subtitlesSrt: srtDraft,
      });
      setIsEditingSrt(false);
    } finally {
      setIsSavingEdits(false);
    }
  };

  const handleDownloadSrt = (srtContent: string, title: string) => {
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40) || 'creatorpilot-subtitles';
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify('Subtitles exported', `Downloaded ${slug}.srt.`, 'success');
  };

  const handleApproveClick = async () => {
    if (!selectedTask || isApproving) return;
    setIsApproving(true);
    try {
      await onApproveTask(selectedTask);
    } finally {
      setIsApproving(false);
    }
  };

  const handleConfirmPublishClick = async () => {
    if (!selectedTask || isPublishing) return;
    setIsPublishing(true);
    try {
      await onPublishTask(selectedTask);
      setConfirmingPublish(false);
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <section
      aria-label="Autonomous AI Creator Assistant"
      className="rounded-xl surface-card p-5 sm:p-6"
    >
      {/* Header & Context Strip */}
      <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-default)] pb-5 lg:flex-row lg:items-center">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/30 bg-gradient-to-br from-violet-600/15 to-blue-600/15 text-violet-600 dark:text-violet-300">
              <Bot className="h-4 w-4" />
            </div>
            <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
              Autonomous AI Creator Assistant
            </h2>
            <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
              Approval Required
            </span>
          </div>
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">
            Issue natural-language instructions to coordinate content analysis, clip proposals, captions, hashtags, SRT subtitles, and vertical video-processing jobs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Conversation Selector */}
          {conversations.length > 0 && (
            <select
              aria-label="Select assistant conversation"
              value={activeConversationId || ''}
              onChange={(e) => onSelectConversation(e.target.value)}
              className="max-w-[200px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
            >
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={onNewConversation}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            <span>New Session</span>
          </button>
        </div>
      </div>

      {/* Project & Media Context Bar */}
      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
            <span className="font-medium text-[var(--text-secondary)]">Project:</span>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="max-w-[220px] rounded-md border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
            >
              <option value="">
                {studioSourceText.trim()
                  ? 'Current Content Studio Context'
                  : 'New Standalone Instruction'}
              </option>
              {projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.title} ({proj.config.language})
                </option>
              ))}
            </select>
          </label>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,.txt,.srt"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-violet-500/40 hover:text-[var(--text-primary)]"
          >
            <Upload className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>Attach Video / Audio / Script</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {effectiveMedia ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">
              <Paperclip className="h-3 w-3" />
              <span className="max-w-[180px] truncate">{effectiveMedia.name}</span>
              <span className="tabular-nums text-emerald-600 dark:text-emerald-400/80">
                ({(effectiveMedia.size / (1024 * 1024)).toFixed(1)} MB)
              </span>
              {attachedMedia && (
                <button
                  type="button"
                  aria-label="Remove attached media"
                  onClick={() => setAttachedMedia(null)}
                  className="ml-1 rounded p-0.5 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">
              No media attached (works with instructions, project scripts, or uploaded video/audio)
            </span>
          )}
        </div>
      </div>

      {/* Main Conversational Interface + Live Pipeline & Task History */}
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Chat Thread & Prompt Composer */}
        <div className="flex flex-col rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] xl:col-span-7">
          {/* Example Prompts */}
          <div className="border-b border-[var(--border-default)] px-4 py-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Try an instruction
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_INSTRUCTIONS.map((example, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setInputText(example)}
                  className="line-clamp-1 max-w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:border-violet-500/40 hover:text-[var(--text-primary)]"
                >
                  <Sparkles className="mr-1.5 inline h-3 w-3 text-violet-600 dark:text-violet-400" />
                  {example}
                </button>
              ))}
            </div>
          </div>

          {/* Messages List */}
          <div className="max-h-[340px] min-h-[220px] flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[180px] flex-col items-center justify-center px-4 text-center">
                <Bot className="h-8 w-8 text-[var(--text-muted)]" />
                <p className="mt-2.5 text-sm font-medium text-[var(--text-primary)]">
                  Ready for multi-step creator orchestration
                </p>
                <p className="mt-1 max-w-md text-xs text-[var(--text-muted)]">
                  Tell the assistant what clips, languages, captions, hashtags, or subtitles to produce. Backend jobs are verified step-by-step and require your approval before publishing.
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === 'user';
                const isSystem = msg.role === 'system';
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-2.5 ${
                      isUser ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {!isUser && (
                      <div
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                          isSystem
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                        }`}
                      >
                        {isSystem ? (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        ) : (
                          <Bot className="h-3.5 w-3.5" />
                        )}
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-xs leading-relaxed ${
                        isUser
                          ? 'border border-violet-500/30 bg-violet-500/10 text-[var(--text-primary)]'
                          : isSystem
                          ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100'
                          : 'border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-primary)]'
                      }`}
                    >
                      {msg.content}
                    </div>
                    {isUser && (
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-secondary)]">
                        <UserIcon className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Instruction Composer */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-[var(--border-default)] p-3"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <textarea
                rows={2}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder='e.g. "I uploaded a 10-minute educational video. Create three Instagram Reels and two YouTube Shorts in Hindi. Generate captions, hashtags and subtitles."'
                className="w-full resize-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-violet-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSubmitting || !inputText.trim()}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white transition-all hover:from-violet-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Coordinating...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Run Assistant</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Live Backend Processing Status & Task History */}
        <div className="flex flex-col gap-4 xl:col-span-5">
          {/* Active Task Pipeline Progress */}
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-default)] pb-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Backend Job Execution Status
                </h3>
                {selectedTask ? (
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                    {selectedTask.jobId} · {selectedTask.language}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    No workflow started yet
                  </p>
                )}
              </div>

              {selectedTask && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
                    selectedTask.status === 'completed' &&
                    selectedTask.confirmedByBackend
                      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : selectedTask.status === 'failed'
                      ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {selectedTask.status === 'completed' &&
                  selectedTask.confirmedByBackend ? (
                    <>
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Backend Confirmed</span>
                    </>
                  ) : selectedTask.status === 'failed' ? (
                    <>
                      <AlertCircle className="h-3 w-3" />
                      <span>Failed</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Processing</span>
                    </>
                  )}
                </span>
              )}
            </div>

            {!selectedTask ? (
              <p className="py-6 text-center text-xs text-[var(--text-muted)]">
                Submit an instruction on the left to watch real-time backend pipeline verification.
              </p>
            ) : (
              <div className="mt-3 space-y-2.5">
                {selectedTask.steps.map((step) => (
                  <div
                    key={step.id}
                    className="flex items-start gap-2.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2"
                  >
                    <div className="mt-0.5 shrink-0">
                      {step.status === 'completed' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      ) : step.status === 'running' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-violet-600 dark:text-violet-400" />
                      ) : step.status === 'failed' ? (
                        <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                      ) : (
                        <Clock className="h-4 w-4 text-[var(--text-muted)]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--text-primary)]">
                        {step.label}
                      </p>
                      <p className="mt-0.5 break-words text-[11px] text-[var(--text-muted)]">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                ))}

                {selectedTask.status === 'failed' && selectedTask.error && (
                  <div className="rounded-md border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-800 dark:text-rose-200">
                    Backend error: {selectedTask.error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Task History List */}
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                <History className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                <span className="tabular-nums">Assistant Task History ({tasks.length})</span>
              </h3>
            </div>

            {tasks.length === 0 ? (
              <p className="py-3 text-xs text-[var(--text-muted)]">
                Completed and running assistant workflows are saved here in Firestore.
              </p>
            ) : (
              <div className="max-h-[180px] space-y-2 overflow-y-auto pr-1">
                {tasks.map((task) => {
                  const isSelected = selectedTask?.id === task.id;
                  const clipCount = task.outputs?.clips?.length ?? 0;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onSelectTask(task.id)}
                      className={`w-full rounded-md border p-2.5 text-left transition-colors ${
                        isSelected
                          ? 'border-violet-500/50 bg-violet-500/10'
                          : 'border-[var(--border-default)] bg-[var(--bg-card)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                          {task.instruction}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            task.approvalStatus === 'published'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : task.approvalStatus === 'approved'
                              ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                              : task.status === 'failed'
                              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                              : 'bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {task.approvalStatus === 'published'
                            ? 'Published'
                            : task.approvalStatus === 'approved'
                            ? 'Approved'
                            : task.status === 'completed'
                            ? 'Needs Approval'
                            : task.status}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        {task.language}
                        {clipCount > 0 ? ` · ${clipCount} clips` : ''}
                        {task.projectTitle ? ` · ${task.projectTitle}` : ''}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Completed, Backend-Confirmed Results + Inline Editor + Approval Gate */}
      {selectedTask &&
        selectedTask.status === 'completed' &&
        selectedTask.confirmedByBackend &&
        selectedTask.outputs && (
          <div className="mt-6 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 sm:p-5">
            {/* Approval & Publish Gate Bar */}
            <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-default)] pb-4 lg:flex-row lg:items-center">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-semibold text-[var(--text-primary)]">
                    Verified Assistant Outputs
                  </h3>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                      selectedTask.approvalStatus === 'published'
                        ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : selectedTask.approvalStatus === 'approved'
                        ? 'border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                        : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    {selectedTask.approvalStatus === 'published'
                      ? 'Published to Project'
                      : selectedTask.approvalStatus === 'approved'
                      ? 'Approved by You'
                      : 'Pending User Approval'}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Review and edit any clip scripts, captions, hashtags, or subtitles below. Publishing stays locked until you explicitly approve.
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                {selectedTask.approvalStatus === 'pending_approval' && (
                  <button
                    type="button"
                    disabled={isApproving}
                    onClick={handleApproveClick}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/12 px-3.5 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-500/20 disabled:opacity-50 dark:text-blue-200"
                  >
                    {isApproving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    <span>Approve Outputs</span>
                  </button>
                )}

                {selectedTask.approvalStatus !== 'published' && (
                  <>
                    {!confirmingPublish ? (
                      <button
                        type="button"
                        disabled={selectedTask.approvalStatus !== 'approved'}
                        onClick={() => setConfirmingPublish(true)}
                        title={
                          selectedTask.approvalStatus !== 'approved'
                            ? 'Approve outputs first before publishing'
                            : 'Publish approved bundle to Firestore Project'
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-all hover:from-violet-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Publish Approved Bundle</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5">
                        <span className="text-xs text-emerald-800 dark:text-emerald-200">
                          Confirm publish to project?
                        </span>
                        <button
                          type="button"
                          disabled={isPublishing}
                          onClick={handleConfirmPublishClick}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          {isPublishing ? 'Publishing...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingPublish(false)}
                          className="rounded border border-[var(--border-default)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Output Tabs */}
            <div className="mt-4 flex flex-wrap gap-2 border-b border-[var(--border-default)] pb-3">
              <button
                type="button"
                onClick={() => setActiveTab('clips')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'clips'
                    ? 'border border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                    : 'border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Film className="h-3.5 w-3.5" />
                <span className="tabular-nums">Clip Proposals ({selectedTask.outputs.clips.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('subtitles')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'subtitles'
                    ? 'border border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                    : 'border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Subtitles className="h-3.5 w-3.5" />
                <span className="tabular-nums">
                  Subtitles SRT ({selectedTask.outputs.subtitleCues.length} cues)
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('videoJobs')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'videoJobs'
                    ? 'border border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                    : 'border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Video className="h-3.5 w-3.5" />
                <span className="tabular-nums">
                  Video Jobs ({selectedTask.outputs.videoJobs.length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('analysis')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'analysis'
                    ? 'border border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                    : 'border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Analysis &amp; Hashtags</span>
              </button>
            </div>

            {/* Tab 1: Clip Proposals (Editable) */}
            {activeTab === 'clips' && (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {selectedTask.outputs.clips.map((clip) => {
                  const isEditing = editingClipId === clip.id && clipDraft;
                  return (
                    <div
                      key={clip.id}
                      className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                clip.platform === 'Instagram Reel'
                                  ? 'border border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300'
                                  : 'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                              }`}
                            >
                              {clip.platform}
                            </span>
                            <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                              {clip.startTime} – {clip.endTime} ({clip.duration})
                            </span>
                          </div>
                          {!isEditing && (
                            <h4 className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
                              {clip.title}
                            </h4>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {!isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStartEditClip(clip)}
                                className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-violet-500/40 hover:text-[var(--text-primary)]"
                              >
                                <Edit3 className="h-3 w-3" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onCopyText(
                                    `${clip.title}\n\nHook: ${clip.hook}\n\nScript:\n${clip.script}\n\nCaption:\n${clip.caption}\n\n${clip.hashtags.join(' ')}`,
                                    clip.title
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                              >
                                <Copy className="h-3 w-3" />
                                <span>Copy</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={isSavingEdits}
                                onClick={handleSaveClipEdit}
                                className="rounded bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                              >
                                {isSavingEdits ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingClipId(null);
                                  setClipDraft(null);
                                }}
                                className="rounded border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {isEditing && clipDraft ? (
                        <div className="space-y-2.5 text-xs">
                          <div>
                            <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                              Title
                            </label>
                            <input
                              type="text"
                              value={clipDraft.title}
                              onChange={(e) =>
                                setClipDraft({
                                  ...clipDraft,
                                  title: e.target.value,
                                })
                              }
                              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                              Hook
                            </label>
                            <input
                              type="text"
                              value={clipDraft.hook}
                              onChange={(e) =>
                                setClipDraft({
                                  ...clipDraft,
                                  hook: e.target.value,
                                })
                              }
                              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                              Script
                            </label>
                            <textarea
                              rows={3}
                              value={clipDraft.script}
                              onChange={(e) =>
                                setClipDraft({
                                  ...clipDraft,
                                  script: e.target.value,
                                })
                              }
                              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                              Caption
                            </label>
                            <textarea
                              rows={2}
                              value={clipDraft.caption}
                              onChange={(e) =>
                                setClipDraft({
                                  ...clipDraft,
                                  caption: e.target.value,
                                })
                              }
                              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[11px] text-[var(--text-muted)]">
                              Hashtags
                            </label>
                            <input
                              type="text"
                              value={hashtagsDraft}
                              onChange={(e) => setHashtagsDraft(e.target.value)}
                              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2 text-xs">
                          <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                              Hook
                            </span>
                            <p className="mt-0.5 text-[var(--text-primary)]">{clip.hook}</p>
                          </div>
                          <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                              Script &amp; Visual Cue
                            </span>
                            <p className="mt-0.5 whitespace-pre-wrap text-[var(--text-secondary)]">
                              {clip.script}
                            </p>
                            {clip.visualCue && (
                              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                                Visual: {clip.visualCue}
                              </p>
                            )}
                          </div>
                          <div className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                              Caption &amp; CTA
                            </span>
                            <p className="mt-0.5 whitespace-pre-wrap text-[var(--text-secondary)]">
                              {clip.caption}
                            </p>
                            {clip.cta && (
                              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                                CTA: {clip.cta}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {clip.hashtags.map((tag, i) => (
                                <span
                                  key={i}
                                  className="rounded border border-[var(--border-default)] bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[10px] text-violet-700 dark:text-violet-300"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Tab 2: Subtitles (SRT) */}
            {activeTab === 'subtitles' && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-muted)]">
                    Timecoded SRT subtitle track ({selectedTask.language})
                  </p>
                  <div className="flex items-center gap-2">
                    {!isEditingSrt ? (
                      <button
                        type="button"
                        onClick={() => setIsEditingSrt(true)}
                        className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:border-violet-500/40 hover:text-[var(--text-primary)]"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Edit SRT</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isSavingEdits}
                          onClick={handleSaveSrtEdit}
                          className="rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
                        >
                          {isSavingEdits ? 'Saving...' : 'Save SRT'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSrtDraft(selectedTask.outputs?.subtitlesSrt || '');
                            setIsEditingSrt(false);
                          }}
                          className="rounded border border-[var(--border-default)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onCopyText(
                          selectedTask.outputs?.subtitlesSrt || '',
                          'SRT Subtitles'
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy SRT</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadSrt(
                          selectedTask.outputs?.subtitlesSrt || '',
                          selectedTask.outputs?.analysis.coreTopic || 'subtitles'
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download .srt</span>
                    </button>
                  </div>
                </div>

                {isEditingSrt ? (
                  <textarea
                    rows={12}
                    value={srtDraft}
                    onChange={(e) => setSrtDraft(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-input)] p-3 font-mono text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                  />
                ) : (
                  <pre className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-4 font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
                    {selectedTask.outputs.subtitlesSrt}
                  </pre>
                )}
              </div>
            )}

            {/* Tab 3: Video-Processing Jobs */}
            {activeTab === 'videoJobs' && (
              <div className="mt-4 space-y-2.5">
                {selectedTask.outputs.videoJobs.map((vjob) => (
                  <div
                    key={vjob.id}
                    className="flex flex-col justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-3.5 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--text-primary)]">
                          {vjob.clipTitle}
                        </span>
                        <span className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                          {vjob.platform}
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                          {vjob.aspectRatio}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {vjob.outputSpec}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--bg-surface)]">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${vjob.progress}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                        {vjob.progress}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab 4: Analysis & Hashtags */}
            {activeTab === 'analysis' && (
              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-2.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                    Content Analysis
                  </h4>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {selectedTask.outputs.analysis.coreTopic}
                  </p>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    {selectedTask.outputs.analysis.summary}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Target Audience: {selectedTask.outputs.analysis.targetAudience}
                  </p>
                  <ul className="space-y-1 pt-1 text-xs text-[var(--text-secondary)]">
                    {selectedTask.outputs.analysis.keyTakeaways.map((item, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500 dark:bg-violet-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                      Coordinated Hashtags
                    </h4>
                    <button
                      type="button"
                      onClick={() =>
                        onCopyText(
                          [
                            ...selectedTask.outputs!.hashtags.relevant,
                            ...selectedTask.outputs!.hashtags.trending,
                          ].join(' '),
                          'All Hashtags'
                        )
                      }
                      className="inline-flex items-center gap-1 rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      <Copy className="h-3 w-3" />
                      <span>Copy All</span>
                    </button>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] text-[var(--text-muted)]">Relevant</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTask.outputs.hashtags.relevant.map((tag, i) => (
                        <span
                          key={i}
                          className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] text-[var(--text-muted)]">Trending</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTask.outputs.hashtags.trending.map((tag, i) => (
                        <span
                          key={i}
                          className="rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-[11px] text-violet-700 dark:text-violet-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
    </section>
  );
}
