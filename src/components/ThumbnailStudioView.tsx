import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Film,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Palette,
  Save,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { saveThumbnailToFirestore } from '../services/firestoreService';
import {
  deleteFirebaseStorageAsset,
  uploadThumbnailBlob,
} from '../services/storageService';
import { generateThumbnailConcepts } from '../services/studioAiApi';
import type { BrandKitConfig } from '../types/brandKit';
import type { CreatorProject } from '../types/creator';
import type {
  SocialMediaType,
  SocialPlatform,
  YouTubePrivacyStatus,
} from '../types/social';
import type {
  ThumbnailAspectRatio,
  ThumbnailAsset,
  ThumbnailConcept,
  ThumbnailLayoutType,
  ThumbnailPalette,
  ThumbnailStudioDraftSeed,
  ThumbnailStylePreset,
} from '../types/thumbnail';

interface ThumbnailStudioViewProps {
  userId: string;
  projects: CreatorProject[];
  brandKit: BrandKitConfig;
  thumbnails: ThumbnailAsset[];
  draftSeed: ThumbnailStudioDraftSeed | null;
  onConsumeDraftSeed?: () => void;
  onDeleteThumbnail: (asset: ThumbnailAsset) => Promise<void>;
  onStageSocialPost: (draft: {
    platform: SocialPlatform;
    title?: string;
    caption: string;
    hashtags?: string[];
    mediaType: SocialMediaType;
    mediaUrl?: string;
    youtubePrivacy?: YouTubePrivacyStatus;
    projectId?: string;
  }) => Promise<void>;
  onNotify: (
    title: string,
    description?: string,
    variant?: 'success' | 'info' | 'error'
  ) => void;
}

const ASPECT_DIMENSIONS: Record<
  ThumbnailAspectRatio,
  { width: number; height: number; label: string; sub: string }
> = {
  '16:9': { width: 1280, height: 720, label: '16:9 YouTube', sub: '1280 × 720' },
  '9:16': { width: 1080, height: 1920, label: '9:16 Reels / Shorts', sub: '1080 × 1920' },
  '1:1': { width: 1080, height: 1080, label: '1:1 Feed / LinkedIn', sub: '1080 × 1080' },
};

const STYLE_PRESETS: Array<{ id: ThumbnailStylePreset; label: string }> = [
  { id: 'bold-creator', label: 'Bold Creator' },
  { id: 'editorial-minimal', label: 'Editorial Minimal' },
  { id: 'tech-dark', label: 'Tech Dark' },
  { id: 'split-comparison', label: 'Split Comparison' },
  { id: 'stat-spotlight', label: 'Stat Spotlight' },
];

const LAYOUT_OPTIONS: Array<{ id: ThumbnailLayoutType; label: string }> = [
  { id: 'split-left', label: 'Left Split' },
  { id: 'center-spotlight', label: 'Center Spotlight' },
  { id: 'bottom-editorial', label: 'Bottom Editorial' },
  { id: 'stat-grid', label: 'Stat Callout' },
];

const DEFAULT_PALETTE: ThumbnailPalette = {
  background: '#0B1020',
  surface: '#151E34',
  accent: '#7C3AED',
  text: '#F8FAFC',
  mutedText: '#CBD5E1',
};

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines.slice(0, 4);
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number
) {
  const imgRatio = img.width / Math.max(1, img.height);
  const canvasRatio = w / h;
  let drawW = w;
  let drawH = h;
  let offsetX = 0;
  let offsetY = 0;

  if (imgRatio > canvasRatio) {
    drawH = h;
    drawW = h * imgRatio;
    offsetX = -(drawW - w) / 2;
  } else {
    drawW = w;
    drawH = w / Math.max(0.01, imgRatio);
    offsetY = -(drawH - h) / 2;
  }
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
}

export function ThumbnailStudioView({
  userId,
  projects,
  brandKit,
  thumbnails,
  draftSeed,
  onConsumeDraftSeed,
  onDeleteThumbnail,
  onStageSocialPost,
  onNotify,
}: ThumbnailStudioViewProps) {
  const [topic, setTopic] = useState(
    '3 AI Workflow Systems That Save Creators 10 Hours Every Week'
  );
  const [title, setTitle] = useState('Creator AI Systems');
  const [hook, setHook] = useState('Stop scripting from a blank page.');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<ThumbnailAspectRatio>('16:9');
  const [stylePreset, setStylePreset] = useState<ThumbnailStylePreset>('bold-creator');

  const [concepts, setConcepts] = useState<ThumbnailConcept[]>([]);
  const [activeConceptId, setActiveConceptId] = useState<string | null>(null);
  const [isGeneratingConcepts, setIsGeneratingConcepts] = useState(false);

  // Canvas Editor State
  const [headline, setHeadline] = useState('3X FASTER CONTENT');
  const [kicker, setKicker] = useState('CREATOR WORKFLOW');
  const [statCallout, setStatCallout] = useState('10 HRS SAVED');
  const [layout, setLayout] = useState<ThumbnailLayoutType>('split-left');
  const [palette, setPalette] = useState<ThumbnailPalette>(DEFAULT_PALETTE);
  const [scrimOpacity, setScrimOpacity] = useState(55);
  const [fontScale, setFontScale] = useState(100);
  const [showBrandWatermark, setShowBrandWatermark] = useState(true);

  const [bgImageDataUrl, setBgImageDataUrl] = useState<string | null>(null);
  const [loadedBgImg, setLoadedBgImg] = useState<HTMLImageElement | null>(null);
  const [loadedLogoImg, setLoadedLogoImg] = useState<HTMLImageElement | null>(null);

  // Video Frame Extractor State
  const [videoExtractUrl, setVideoExtractUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoTime, setVideoTime] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [busyThumbId, setBusyThumbId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  // Consume incoming seed from Content Studio
  useEffect(() => {
    if (!draftSeed) return;
    setTopic(draftSeed.topic || draftSeed.title);
    setTitle(draftSeed.title);
    setHeadline(draftSeed.title.split(/\s+/).slice(0, 5).join(' ').toUpperCase());
    if (draftSeed.hook) setHook(draftSeed.hook);
    if (draftSeed.aspectRatio) setAspectRatio(draftSeed.aspectRatio);
    if (draftSeed.projectId) setSelectedProjectId(draftSeed.projectId);
    onConsumeDraftSeed?.();
  }, [draftSeed, onConsumeDraftSeed]);

  // Load background image element when URL changes
  useEffect(() => {
    if (!bgImageDataUrl) {
      setLoadedBgImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setLoadedBgImg(img);
    img.onerror = () => setLoadedBgImg(null);
    img.src = bgImageDataUrl;
  }, [bgImageDataUrl]);

  // Load Brand Kit logo safely with crossOrigin so canvas export stays untainted
  useEffect(() => {
    if (!brandKit.logoUrl) {
      setLoadedLogoImg(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setLoadedLogoImg(img);
    img.onerror = () => setLoadedLogoImg(null);
    img.src = brandKit.logoUrl;
  }, [brandKit.logoUrl]);

  useEffect(() => {
    return () => {
      if (videoExtractUrl) URL.revokeObjectURL(videoExtractUrl);
    };
  }, [videoExtractUrl]);

  const dims = ASPECT_DIMENSIONS[aspectRatio];

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width: w, height: h } = dims;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    // 1. Base Gradient Background
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, palette.background);
    grad.addColorStop(1, palette.surface);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Subtle atmospheric radial spotlight using accent
    const rad = ctx.createRadialGradient(
      w * 0.78,
      h * 0.28,
      w * 0.04,
      w * 0.78,
      h * 0.28,
      w * 0.65
    );
    rad.addColorStop(0, `${palette.accent}44`);
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, w, h);

    // 2. Optional Uploaded Photo / Video Frame
    if (loadedBgImg) {
      ctx.save();
      drawCoverImage(ctx, loadedBgImg, w, h);
      ctx.restore();

      const scrimGrad = ctx.createLinearGradient(0, 0, w, h);
      const alphaHex = Math.round((scrimOpacity / 100) * 255)
        .toString(16)
        .padStart(2, '0');
      scrimGrad.addColorStop(0, `${palette.background}${alphaHex}`);
      scrimGrad.addColorStop(1, `${palette.surface}${alphaHex}`);
      ctx.fillStyle = scrimGrad;
      ctx.fillRect(0, 0, w, h);
    } else {
      // Crisp subtle grid pattern when no photo is loaded
      ctx.save();
      ctx.strokeStyle = `${palette.mutedText}18`;
      ctx.lineWidth = 1;
      const step = Math.round(w / 16);
      for (let x = step; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = step; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Layout-specific framing
    const scale = fontScale / 100;
    const isPortrait = aspectRatio === '9:16';
    const pad = Math.round(w * 0.075);

    if (layout === 'split-left') {
      // Left high-contrast panel strip
      ctx.save();
      ctx.fillStyle = `${palette.accent}`;
      ctx.fillRect(pad, pad, 10, h - pad * 2);
      ctx.restore();
    } else if (layout === 'bottom-editorial') {
      const bandH = Math.round(h * (isPortrait ? 0.44 : 0.52));
      const bandGrad = ctx.createLinearGradient(0, h - bandH, 0, h);
      bandGrad.addColorStop(0, 'rgba(0,0,0,0)');
      bandGrad.addColorStop(0.35, `${palette.background}D8`);
      bandGrad.addColorStop(1, `${palette.background}F5`);
      ctx.fillStyle = bandGrad;
      ctx.fillRect(0, h - bandH, w, bandH);
    } else if (layout === 'stat-grid') {
      ctx.save();
      ctx.fillStyle = `${palette.surface}D9`;
      ctx.strokeStyle = `${palette.accent}88`;
      ctx.lineWidth = 3;
      drawRoundedRectPath(ctx, pad - 18, pad - 18, w - (pad - 18) * 2, h - (pad - 18) * 2, 28);
      if (!loadedBgImg) ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 4. Text Placement Coordinates
    const textMaxW =
      layout === 'split-left' && !isPortrait ? Math.round(w * 0.62) : w - pad * 2;
    const headlineSize = Math.round((isPortrait ? 84 : 88) * scale);
    const kickerSize = Math.round((isPortrait ? 26 : 24) * scale);
    const statSize = Math.round((isPortrait ? 34 : 30) * scale);

    ctx.textBaseline = 'top';
    let textX = pad + (layout === 'split-left' ? 36 : 0);
    let textAlign: CanvasTextAlign = 'left';
    let startY = pad + 20;

    if (layout === 'center-spotlight') {
      textX = w / 2;
      textAlign = 'center';
      startY = Math.round(h * 0.28);
    } else if (layout === 'bottom-editorial') {
      startY = Math.round(h * (isPortrait ? 0.57 : 0.5));
    } else if (layout === 'split-left') {
      startY = Math.round(h * (isPortrait ? 0.24 : 0.2));
    } else {
      startY = Math.round(h * 0.18);
    }

    ctx.textAlign = textAlign;

    // Kicker Eyebrow Pill
    const cleanKicker = kicker.trim().toUpperCase();
    if (cleanKicker) {
      ctx.font = `700 ${kickerSize}px "JetBrains Mono", monospace`;
      const kickerMetrics = ctx.measureText(cleanKicker);
      const pillW = kickerMetrics.width + 36;
      const pillH = kickerSize + 20;
      const pillX = textAlign === 'center' ? textX - pillW / 2 : textX;

      ctx.save();
      ctx.fillStyle = palette.accent;
      drawRoundedRectPath(ctx, pillX, startY, pillW, pillH, 10);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(
        cleanKicker,
        textAlign === 'center' ? textX : pillX + 18,
        startY + 10
      );
      ctx.restore();

      startY += pillH + 26;
    }

    // Main Headline
    const cleanHeadline = headline.trim() || 'CREATORPILOT AI';
    ctx.font = `800 ${headlineSize}px "Plus Jakarta Sans", sans-serif`;
    const lines = wrapCanvasText(ctx, cleanHeadline, textMaxW);
    const lineHeight = Math.round(headlineSize * 1.12);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = palette.text;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], textX, startY + i * lineHeight);
    }
    ctx.restore();

    startY += lines.length * lineHeight + 28;

    // Stat Callout Badge
    const cleanStat = statCallout.trim();
    if (cleanStat) {
      ctx.font = `700 ${statSize}px "JetBrains Mono", monospace`;
      const statW = ctx.measureText(cleanStat).width + 40;
      const statH = statSize + 22;
      const statX = textAlign === 'center' ? textX - statW / 2 : textX;

      ctx.save();
      ctx.fillStyle = `${palette.surface}EE`;
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 3;
      drawRoundedRectPath(ctx, statX, startY, statW, statH, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = palette.text;
      ctx.fillText(
        cleanStat,
        textAlign === 'center' ? textX : statX + 20,
        startY + 11
      );
      ctx.restore();
    }

    // 5. Optional Brand Kit Watermark / Logo
    if (showBrandWatermark) {
      const wmY = h - pad - 44;
      const wmX = pad;
      ctx.save();
      ctx.textAlign = 'left';
      if (loadedLogoImg) {
        try {
          ctx.drawImage(loadedLogoImg, wmX, wmY - 6, 48, 48);
        } catch {
          // Ignore image draw failure
        }
      }
      const labelX = loadedLogoImg ? wmX + 62 : wmX;
      ctx.font = `600 22px "DM Sans", sans-serif`;
      ctx.fillStyle = palette.mutedText;
      ctx.fillText(
        brandKit.brandHandle || brandKit.brandName || 'CreatorPilot AI',
        labelX,
        wmY + 8
      );
      ctx.restore();
    }
  }, [
    dims,
    palette,
    loadedBgImg,
    scrimOpacity,
    fontScale,
    aspectRatio,
    layout,
    kicker,
    headline,
    statCallout,
    showBrandWatermark,
    loadedLogoImg,
    brandKit.brandHandle,
    brandKit.brandName,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const handleImportProject = (projId: string) => {
    setSelectedProjectId(projId);
    const proj = projects.find((p) => p.id === projId);
    if (!proj) return;
    setTitle(proj.title);
    setTopic(proj.result.analysis?.coreTopic || proj.config.sourceText.slice(0, 140));
    setHook(proj.result.instagramReel?.hook || '');
    setHeadline(
      (proj.result.instagramReel?.title || proj.title)
        .split(/\s+/)
        .slice(0, 5)
        .join(' ')
        .toUpperCase()
    );
    onNotify('Imported project context', `Loaded "${proj.title}".`, 'info');
  };

  const handleApplyConcept = (concept: ThumbnailConcept) => {
    setActiveConceptId(concept.id);
    setHeadline(concept.headline);
    setKicker(concept.kicker);
    setStatCallout(concept.statCallout);
    setLayout(concept.layout);
    setPalette(concept.palette);
  };

  const handleGenerateConcepts = async () => {
    if (!topic.trim() && !title.trim()) {
      onNotify(
        'Topic required',
        'Enter a video topic or title before generating concepts.',
        'error'
      );
      return;
    }

    setIsGeneratingConcepts(true);
    try {
      const resultConcepts = await generateThumbnailConcepts({
        topic: topic.trim() || title.trim(),
        title: title.trim() || undefined,
        hook: hook.trim() || undefined,
        aspectRatio,
        stylePreset,
        brandKit: {
          brandName: brandKit.brandName,
          colors: brandKit.colors,
        },
      });
      setConcepts(resultConcepts);
      if (resultConcepts[0]) {
        handleApplyConcept(resultConcepts[0]);
      }
      onNotify(
        '3 AI Thumbnail Concepts ready',
        'Select any concept card to load its typography, layout, and contrast palette.',
        'success'
      );
    } catch (err) {
      onNotify(
        'Concept generation failed',
        err instanceof Error ? err.message : 'Could not reach Gemini AI.',
        'error'
      );
    } finally {
      setIsGeneratingConcepts(false);
    }
  };

  const handleApplyBrandColors = () => {
    setPalette({
      background: '#090E1A',
      surface: brandKit.colors.secondary || '#1E293B',
      accent: brandKit.colors.primary || '#7C3AED',
      text: '#F8FAFC',
      mutedText: '#CBD5E1',
    });
    onNotify('Brand Kit colors applied', `Applied ${brandKit.brandName} palette.`, 'info');
  };

  const handleBgUpload = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) {
      onNotify('Invalid image', 'Please upload a PNG, JPG, or WebP image.', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBgImageDataUrl(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const handleVideoFileForFrame = (file: File | undefined) => {
    if (!file || !file.type.startsWith('video/')) {
      onNotify('Invalid video', 'Select an MP4, MOV, or WebM video file.', 'error');
      return;
    }
    if (videoExtractUrl) URL.revokeObjectURL(videoExtractUrl);
    const url = URL.createObjectURL(file);
    setVideoExtractUrl(url);
    setVideoTime(0);
  };

  const handleCaptureVideoFrame = () => {
    const vid = videoRef.current;
    if (!vid || vid.videoWidth === 0) return;
    const temp = document.createElement('canvas');
    temp.width = vid.videoWidth;
    temp.height = vid.videoHeight;
    const ctx = temp.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, temp.width, temp.height);
    setBgImageDataUrl(temp.toDataURL('image/png'));
    onNotify('Video frame captured', 'Applied current video frame as thumbnail backdrop.', 'success');
  };

  const exportCanvasBlob = (): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        reject(new Error('Thumbnail canvas is not ready.'));
        return;
      }
      renderCanvas();
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Could not encode PNG image from canvas.'));
            return;
          }
          resolve(blob);
        },
        'image/png',
        0.95
      );
    });
  };

  const handleDownloadPng = async () => {
    try {
      const blob = await exportCanvasBlob();
      const url = URL.createObjectURL(blob);
      const slug =
        (headline || title || 'thumbnail')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 40) || 'thumbnail';
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${slug}-${aspectRatio.replace(':', 'x')}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      onNotify('PNG downloaded', 'Exported full-resolution thumbnail image.', 'success');
    } catch (err) {
      onNotify(
        'Export failed',
        err instanceof Error ? err.message : 'Canvas export error.',
        'error'
      );
    }
  };

  const saveCurrentThumbnail = async (): Promise<ThumbnailAsset | null> => {
    setIsSaving(true);
    setUploadPct(5);
    try {
      const blob = await exportCanvasBlob();
      const thumbnailId = `thumb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const slug =
        (headline || title || 'thumbnail')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 40) || 'thumbnail';

      const uploadRes = await uploadThumbnailBlob(
        userId,
        thumbnailId,
        `${slug}.png`,
        blob,
        (pct) => setUploadPct(pct)
      );

      const activeConcept = concepts.find((c) => c.id === activeConceptId);
      const nowIso = new Date().toISOString();

      const asset: ThumbnailAsset = {
        id: thumbnailId,
        userId,
        title: (title || headline || 'Creator Thumbnail').trim().slice(0, 140),
        headline: headline.trim().slice(0, 120) || 'Creator Thumbnail',
        kicker: kicker.trim().slice(0, 60),
        ...(statCallout.trim() ? { statCallout: statCallout.trim().slice(0, 40) } : {}),
        aspectRatio,
        stylePreset,
        layout,
        palette,
        storageUrl: uploadRes.downloadUrl,
        storagePath: uploadRes.storagePath,
        ...(selectedProjectId ? { projectId: selectedProjectId } : {}),
        ...(activeConcept?.ctrRationale ? { ctrRationale: activeConcept.ctrRationale } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await saveThumbnailToFirestore(userId, asset);
      onNotify(
        'Thumbnail saved to Library',
        'Uploaded PNG to Firebase Storage and synced metadata.',
        'success'
      );
      return asset;
    } catch (err) {
      onNotify(
        'Save failed',
        err instanceof Error ? err.message : 'Could not save thumbnail.',
        'error'
      );
      return null;
    } finally {
      setIsSaving(false);
      setUploadPct(null);
    }
  };

  const handleSaveAndQueue = async () => {
    const saved = await saveCurrentThumbnail();
    if (!saved) return;
    await onStageSocialPost({
      platform: saved.aspectRatio === '9:16' ? 'instagram' : 'linkedin',
      title: saved.title,
      caption: `${saved.headline}${saved.kicker ? ` · ${saved.kicker}` : ''}`,
      mediaType: 'image',
      mediaUrl: saved.storageUrl,
      ...(saved.projectId ? { projectId: saved.projectId } : {}),
    });
  };

  const handleLoadLibraryItem = (asset: ThumbnailAsset) => {
    setTitle(asset.title);
    setHeadline(asset.headline);
    setKicker(asset.kicker);
    setStatCallout(asset.statCallout || '');
    setAspectRatio(asset.aspectRatio);
    setStylePreset(asset.stylePreset);
    setLayout(asset.layout);
    setPalette(asset.palette);
    if (asset.projectId) setSelectedProjectId(asset.projectId);
    onNotify('Loaded into editor', `"${asset.title}" parameters restored.`, 'info');
  };

  const handleDeleteItem = async (asset: ThumbnailAsset) => {
    setBusyThumbId(asset.id);
    try {
      await deleteFirebaseStorageAsset(asset.storagePath).catch(() => {});
      await onDeleteThumbnail(asset);
    } finally {
      setBusyThumbId(null);
    }
  };

  const previewAspectClass = useMemo(() => {
    if (aspectRatio === '9:16') return 'aspect-[9/16] max-h-[520px] mx-auto';
    if (aspectRatio === '1:1') return 'aspect-square max-h-[480px] mx-auto';
    return 'aspect-video w-full';
  }, [aspectRatio]);

  return (
    <div className="space-y-8">
      {/* Studio Brief & AI Concept Generator */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)] sm:p-7">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-default)] pb-5 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-xl font-bold text-[var(--text-primary)] sm:text-2xl">
              AI Thumbnail Studio
            </h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Generate high-CTR art direction with Gemini AI, compose on a full-resolution canvas, and stage to Social Publishing.
            </p>
          </div>

          {projects.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                aria-label="Import from saved project"
                value={selectedProjectId}
                onChange={(e) => handleImportProject(e.target.value)}
                className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              >
                <option value="">Import from Project...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label
              htmlFor="thumb-topic"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Video Topic / Core Hook
            </label>
            <input
              id="thumb-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., How I automated my entire content pipeline in 20 minutes"
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="thumb-title"
              className="block text-xs font-medium text-[var(--text-muted)]"
            >
              Asset Name
            </label>
            <input
              id="thumb-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., AI Workflow Launch"
              className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="block text-xs font-medium text-[var(--text-muted)]">
                Aspect Ratio
              </span>
              <div className="mt-1.5 inline-flex rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1">
                {(['16:9', '9:16', '1:1'] as ThumbnailAspectRatio[]).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setAspectRatio(ratio)}
                    className={`rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      aspectRatio === ratio
                        ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {ASPECT_DIMENSIONS[ratio].label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="thumb-style-preset"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Style Preset
              </label>
              <select
                id="thumb-style-preset"
                value={stylePreset}
                onChange={(e) => setStylePreset(e.target.value as ThumbnailStylePreset)}
                className="mt-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              >
                {STYLE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleGenerateConcepts()}
            disabled={isGeneratingConcepts}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:from-violet-500 hover:to-blue-500 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {isGeneratingConcepts ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Generating AI Art Direction...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>Generate 3 AI Concepts</span>
              </>
            )}
          </button>
        </div>

        {/* 3 AI Concept Cards */}
        {concepts.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {concepts.map((concept) => {
              const selected = activeConceptId === concept.id;
              return (
                <button
                  key={concept.id}
                  type="button"
                  onClick={() => handleApplyConcept(concept)}
                  className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {concept.conceptTitle}
                      </span>
                      {selected && (
                        <Check className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                      )}
                    </div>
                    <p className="mt-2 font-display text-sm font-bold text-[var(--text-primary)]">
                      {concept.headline}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                      {concept.kicker}
                      {concept.statCallout ? ` · ${concept.statCallout}` : ''} · {concept.layout}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                      {concept.ctrRationale}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-[var(--border-default)] pt-2.5">
                    <span className="text-[11px] text-[var(--text-muted)] truncate pr-2">
                      {concept.visualPromptNote}
                    </span>
                    <div className="flex items-center gap-1 shrink-0" aria-hidden="true">
                      <span
                        className="h-3 w-3 rounded-full border border-white/20"
                        style={{ backgroundColor: concept.palette.background }}
                      />
                      <span
                        className="h-3 w-3 rounded-full border border-white/20"
                        style={{ backgroundColor: concept.palette.accent }}
                      />
                      <span
                        className="h-3 w-3 rounded-full border border-white/20"
                        style={{ backgroundColor: concept.palette.text }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Interactive Canvas Compositor & Controls */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Live Canvas Preview */}
        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)] xl:col-span-7">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                Live Canvas Preview
              </h2>
              <p className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
                {dims.sub} · {aspectRatio} · {layout}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleDownloadPng()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download PNG</span>
              </button>
              <button
                type="button"
                onClick={() => void saveCurrentThumbnail()}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/35 bg-violet-500/10 px-3.5 py-2 text-xs font-semibold text-violet-700 dark:text-violet-200 transition-colors hover:bg-violet-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span>
                  {isSaving && uploadPct !== null
                    ? `Saving ${uploadPct}%`
                    : 'Save to Library'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleSaveAndQueue()}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-all hover:from-violet-500 hover:to-blue-500 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Save &amp; Queue Post</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
            <div className={`overflow-hidden rounded-lg shadow-md ${previewAspectClass}`}>
              <canvas
                ref={canvasRef}
                className="h-full w-full object-contain block"
              />
            </div>
          </div>

          {/* Optional Video Frame Extractor */}
          <div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Background Photo or Video Frame Backdrop
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={bgInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    handleBgUpload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    handleVideoFileForFrame(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => bgInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-violet-500/40 whitespace-nowrap shrink-0"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload Photo</span>
                </button>
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-violet-500/40 whitespace-nowrap shrink-0"
                >
                  <Film className="h-3.5 w-3.5" />
                  <span>Extract Video Frame</span>
                </button>
                {bgImageDataUrl && (
                  <button
                    type="button"
                    onClick={() => setBgImageDataUrl(null)}
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 whitespace-nowrap shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Clear Backdrop</span>
                  </button>
                )}
              </div>
            </div>

            {videoExtractUrl && (
              <div className="mt-3 space-y-2 border-t border-[var(--border-default)] pt-3">
                <video
                  ref={videoRef}
                  src={videoExtractUrl}
                  onLoadedMetadata={(e) =>
                    setVideoDuration(e.currentTarget.duration || 0)
                  }
                  onTimeUpdate={(e) => setVideoTime(e.currentTarget.currentTime)}
                  className="max-h-40 w-full rounded-lg bg-black object-contain"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0.1, videoDuration)}
                    step={0.1}
                    value={videoTime}
                    onChange={(e) => {
                      const t = Number(e.target.value);
                      setVideoTime(t);
                      if (videoRef.current) videoRef.current.currentTime = t;
                    }}
                    className="flex-1 accent-violet-600"
                  />
                  <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
                    {videoTime.toFixed(1)}s / {videoDuration.toFixed(1)}s
                  </span>
                  <button
                    type="button"
                    onClick={handleCaptureVideoFrame}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 whitespace-nowrap shrink-0"
                  >
                    Use This Frame
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Controls Panel */}
        <section className="space-y-5 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)] xl:col-span-5">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-3">
            <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Typography &amp; Layout Controls
            </h2>
            <button
              type="button"
              onClick={handleApplyBrandColors}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-violet-500/40 hover:text-[var(--text-primary)] whitespace-nowrap shrink-0"
            >
              <Palette className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
              <span>Apply Brand Kit</span>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="editor-headline"
                className="block text-xs font-medium text-[var(--text-muted)]"
              >
                Main Headline (2–6 punchy words)
              </label>
              <input
                id="editor-headline"
                type="text"
                maxLength={80}
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3.5 py-2 text-sm font-semibold text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="editor-kicker"
                  className="block text-xs font-medium text-[var(--text-muted)]"
                >
                  Eyebrow Kicker
                </label>
                <input
                  id="editor-kicker"
                  type="text"
                  maxLength={36}
                  value={kicker}
                  onChange={(e) => setKicker(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="editor-stat"
                  className="block text-xs font-medium text-[var(--text-muted)]"
                >
                  Stat / Proof Callout
                </label>
                <input
                  id="editor-stat"
                  type="text"
                  maxLength={24}
                  value={statCallout}
                  onChange={(e) => setStatCallout(e.target.value)}
                  placeholder="Optional e.g. 3X CTR"
                  className="mt-1.5 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-input)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] focus:border-violet-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                <LayoutTemplate className="h-3.5 w-3.5" />
                <span>Composition Layout</span>
              </span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {LAYOUT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setLayout(opt.id)}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                      layout === opt.id
                        ? 'border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                        : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  { key: 'background', label: 'Bg Start' },
                  { key: 'surface', label: 'Bg End' },
                  { key: 'accent', label: 'Accent' },
                  { key: 'text', label: 'Text' },
                ] as const
              ).map((c) => (
                <label
                  key={c.key}
                  className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-2.5 text-[11px] font-medium text-[var(--text-muted)]"
                >
                  <span>{c.label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={palette[c.key]}
                      onChange={(e) =>
                        setPalette((prev) => ({
                          ...prev,
                          [c.key]: e.target.value.toUpperCase(),
                        }))
                      }
                      className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <span className="font-mono text-[10px] text-[var(--text-primary)]">
                      {palette[c.key]}
                    </span>
                  </div>
                </label>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--text-muted)]">Headline Scale</span>
                  <span className="font-mono text-[var(--text-primary)] tabular-nums">
                    {fontScale}%
                  </span>
                </div>
                <input
                  type="range"
                  min={75}
                  max={130}
                  value={fontScale}
                  onChange={(e) => setFontScale(Number(e.target.value))}
                  className="mt-1.5 w-full accent-violet-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--text-muted)]">Backdrop Scrim</span>
                  <span className="font-mono text-[var(--text-primary)] tabular-nums">
                    {scrimOpacity}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={85}
                  value={scrimOpacity}
                  onChange={(e) => setScrimOpacity(Number(e.target.value))}
                  className="mt-1.5 w-full accent-violet-600"
                />
              </div>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={showBrandWatermark}
                onChange={(e) => setShowBrandWatermark(e.target.checked)}
                className="rounded border-[var(--border-default)] text-violet-600 focus:ring-violet-500"
              />
              <span>Include Brand Kit handle &amp; logo watermark</span>
            </label>
          </div>
        </section>
      </div>

      {/* Saved Thumbnail Library */}
      <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] pb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
              Saved Thumbnail Library ({thumbnails.length})
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Stored in Firebase Storage &amp; Firestore · Ready to queue as social post artwork
            </p>
          </div>
        </div>

        {thumbnails.length === 0 ? (
          <div className="py-12 text-center">
            <ImageIcon className="mx-auto h-8 w-8 text-[var(--text-muted)]/60" />
            <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">
              No saved thumbnails yet
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Design a thumbnail above and click Save to Library to persist your high-res PNG asset.
            </p>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {thumbnails.map((item) => (
              <article
                key={item.id}
                className="flex flex-col justify-between overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]"
              >
                <div>
                  <div className="aspect-video w-full overflow-hidden bg-slate-950">
                    <img
                      src={item.storageUrl}
                      alt={item.title}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="p-4">
                    <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {item.title}
                    </h3>
                    <p className="mt-1 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                      {item.aspectRatio} · {item.layout} ·{' '}
                      {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleLoadLibraryItem(item)}
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-violet-500/40 whitespace-nowrap"
                    >
                      Edit Copy
                    </button>
                    <a
                      href={item.storageUrl}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] whitespace-nowrap"
                    >
                      Open PNG
                    </a>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        void onStageSocialPost({
                          platform: item.aspectRatio === '9:16' ? 'instagram' : 'linkedin',
                          title: item.title,
                          caption: `${item.headline}${item.kicker ? ` · ${item.kicker}` : ''}`,
                          mediaType: 'image',
                          mediaUrl: item.storageUrl,
                          ...(item.projectId ? { projectId: item.projectId } : {}),
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-500/35 bg-violet-500/10 px-2.5 py-1.5 text-xs font-semibold text-violet-700 dark:text-violet-200 hover:bg-violet-500/20 whitespace-nowrap"
                    >
                      <Send className="h-3 w-3" />
                      <span>Queue</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyThumbId === item.id}
                      onClick={() => void handleDeleteItem(item)}
                      aria-label={`Delete ${item.title}`}
                      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 text-[var(--text-muted)] hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-300 disabled:opacity-50"
                    >
                      {busyThumbId === item.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
