import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import CreditsPanel from './CreditsPanel';
import PlayGlyph, { PauseGlyph } from './PlayGlyph';
import FloatingVideoWindow, { VideoPopoutButton } from './FloatingVideoWindow';
import { capturePosterDataUrl, sceneVideoSource } from '../utils/scenePosterCapture';
import { forceConnectVideoToVuMeter } from './VUMeter';
import { THEATRE_FILES_VIEW_ENABLED } from '../config/features';

function isDebugSpacingEnabled() {
  try {
    return typeof window !== 'undefined' && window.location.search.includes('debugSpacing=1');
  } catch {
    return false;
  }
}

function renderDebugOverlay(text: string) {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById('__debug_spacing_overlay');
  const el = existing ?? document.createElement('div');
  el.id = '__debug_spacing_overlay';
  el.style.position = 'fixed';
  el.style.left = '8px';
  el.style.bottom = '8px';
  el.style.zIndex = '999999';
  el.style.background = 'rgba(0,0,0,0.75)';
  el.style.color = '#fff';
  el.style.padding = '8px 10px';
  el.style.borderRadius = '8px';
  el.style.font = '12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  el.style.maxWidth = '60vw';
  el.style.whiteSpace = 'pre-wrap';
  el.textContent = text;
  if (!existing) document.body.appendChild(el);
}

interface Scene {
  id: string;
  videoUrl: string;
  proxiedVideoUrl?: string;
  thumbnail?: string;
  duration?: number;
  name?: string;
  title?: string;
}

type TheatreViewMode = 'video' | 'playlist';

/** Stable cache key: canonical video URL from Sheets (updates when the sheet URL changes). */
function scenePosterCacheKey(scene?: Scene | null): string {
  return String(scene?.videoUrl || scene?.proxiedVideoUrl || '').trim();
}

function sceneSource(scene?: Scene | null): string {
  return String(scene?.proxiedVideoUrl || scene?.videoUrl || '').trim();
}

function audioFileSource(file?: AudioFile | null): string {
  return String(file?.proxiedAudioUrl || file?.audioUrl || '').trim();
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function sceneFileName(scene?: Scene | null): string {
  const explicitName = String(scene?.name || scene?.title || '').trim();
  if (explicitName) return explicitName;

  const source = sceneSource(scene);
  if (!source) return 'untitled';

  try {
    const url = new URL(source, typeof window !== 'undefined' ? window.location.href : 'https://example.com');
    const name = url.pathname.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : source;
  } catch {
    const name = source.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : source;
  }
}

interface Credit {
  role: string;
  name: string;
}

interface Work {
  id: string;
  title: string;
  scenes: Scene[];
  credits?: Credit[];
}

interface AudioFile {
  id: string;
  filename: string;
  audioUrl: string;
  proxiedAudioUrl?: string;
  workTitle?: string;
}

interface VideoGridProps {
  works: Work[];
  audioFiles?: AudioFile[];
}

/**
 * VideoGrid Component - Horizontal scrolling video grid
 * Migrated from React SceneGrid with core functionality
 */
export default function VideoGrid({ works, audioFiles = [] }: VideoGridProps) {
  const [viewMode, setViewMode] = useState<TheatreViewMode>('video');
  const [currentWorkIndex, setCurrentWorkIndex] = useState(0);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudioKey, setCurrentAudioKey] = useState<string | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState({ current: 0, duration: 0 });
  const [hoveredScene, setHoveredScene] = useState<{ workIndex: number; sceneIndex: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const mobileFixedVideoRef = useRef<HTMLVideoElement | null>(null);
  const [showSceneArrows, setShowSceneArrows] = useState(false);
  const [mobilePosterOverlay, setMobilePosterOverlay] = useState<{ visible: boolean; url?: string }>({ visible: false });
  const [generatedThumbnails, setGeneratedThumbnails] = useState<Record<string, string>>({});
  const [failedR2Posters, setFailedR2Posters] = useState<Set<string>>(() => new Set());
  const generatedThumbsRef = useRef<Record<string, string>>({});
  const failedThumbsRef = useRef<Set<string>>(new Set());
  const inFlightThumbsRef = useRef<Set<string>>(new Set());
  const arrowsTimerRef = useRef<number | null>(null);
  // Generation counter to cancel stale playVideo operations
  const playGenRef = useRef(0);
  // Track pending canplay listener so we can cancel it
  const pendingCanPlayRef = useRef<{ el: HTMLVideoElement; handler: () => void; timeout: number } | null>(null);
  // Mobile autoplay controls to prevent stale delayed play() from restarting after manual pause
  const mobileCanPlaythroughHandlerRef = useRef<(() => void) | null>(null);
  const mobileAutoplayVideoRef = useRef<HTMLVideoElement | null>(null);
  const mobileAutoplayTimerRef = useRef<number | null>(null);
  const mobileUserPausedRef = useRef(false);
  const mobileLoadedSceneKeyRef = useRef<string | null>(null);
  const [desktopPosterOverlay, setDesktopPosterOverlay] = useState<{ key: string | null; url?: string }>({ key: null });
  const [floatingWindows, setFloatingWindows] = useState<Array<{
    id: string;
    src: string;
    poster?: string;
    crossOrigin?: 'anonymous';
    title: string;
    initialTime: number;
    autoPlay: boolean;
    defaultX: number;
    defaultY: number;
    zIndex: number;
  }>>([]);
  const floatingZRef = useRef(4500);

  const cancelPendingMobileAutoplay = useCallback(() => {
    const pendingVideo = mobileAutoplayVideoRef.current;
    const pendingHandler = mobileCanPlaythroughHandlerRef.current;
    if (pendingVideo && pendingHandler) {
      pendingVideo.removeEventListener('canplaythrough', pendingHandler);
    }
    if (mobileAutoplayTimerRef.current !== null) {
      clearTimeout(mobileAutoplayTimerRef.current);
      mobileAutoplayTimerRef.current = null;
    }
    mobileCanPlaythroughHandlerRef.current = null;
    mobileAutoplayVideoRef.current = null;
  }, []);

  // Parse credits from current work
  const currentWork = works[currentWorkIndex];
  const credits = currentWork?.credits || [];
  const synopsis = currentWork?.synopsis || String(currentWork?.meta?.['synopsis'] || currentWork?.meta?.['description'] || '').trim() || null;

  // Credits visibility - only show when playing
  const creditsVisible = isPlaying;

  const resolveScenePoster = useCallback((_workIdx: number, _sceneIdx: number, scene?: Scene | null) => {
    const cacheKey = scenePosterCacheKey(scene);
    if (cacheKey && generatedThumbnails[cacheKey]) {
      return generatedThumbnails[cacheKey];
    }
    const r2Poster = String(scene?.thumbnail || '').trim();
    if (r2Poster && !failedR2Posters.has(r2Poster)) {
      return r2Poster;
    }
    return undefined;
  }, [generatedThumbnails, failedR2Posters]);

  const handleScenePosterError = useCallback((scene?: Scene | null) => {
    const r2Poster = String(scene?.thumbnail || '').trim();
    if (!r2Poster) return;
    setFailedR2Posters((prev) => {
      if (prev.has(r2Poster)) return prev;
      const next = new Set(prev);
      next.add(r2Poster);
      return next;
    });
  }, []);

  useEffect(() => {
    generatedThumbsRef.current = generatedThumbnails;
  }, [generatedThumbnails]);

  // Drop cached posters when a scene's video URL changes (e.g. after a Sheets update).
  useEffect(() => {
    const activeKeys = new Set<string>();
    for (const work of works) {
      for (const scene of work.scenes || []) {
        const key = scenePosterCacheKey(scene);
        if (key) activeKeys.add(key);
      }
    }

    setGeneratedThumbnails((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [url, poster] of Object.entries(prev)) {
        if (activeKeys.has(url)) next[url] = poster;
        else changed = true;
      }
      return changed ? next : prev;
    });

    failedThumbsRef.current = new Set(
      [...failedThumbsRef.current].filter((url) => activeKeys.has(url))
    );

    const activeR2Posters = new Set<string>();
    for (const work of works) {
      for (const scene of work.scenes || []) {
        const thumb = String(scene?.thumbnail || '').trim();
        if (thumb) activeR2Posters.add(thumb);
      }
    }
    setFailedR2Posters((prev) => {
      const next = new Set([...prev].filter((url) => activeR2Posters.has(url)));
      return next.size === prev.size ? prev : next;
    });
  }, [works]);

  /** Global CORS mode — disabled once any R2 video fails, since CORS isn't on the bucket. */
  const [r2CorsModeEnabled, setR2CorsModeEnabled] = useState(true);

  useEffect(() => {
    if (!r2CorsModeEnabled) {
      failedThumbsRef.current.clear();
    }
  }, [r2CorsModeEnabled]);

  const isR2Url = useCallback((maybeUrl?: string | null) => {
    if (!maybeUrl) return false;
    try {
      const u = new URL(maybeUrl, window.location.href);
      return u.hostname.endsWith('.r2.dev');
    } catch {
      return false;
    }
  }, []);

  const shouldUseCrossOriginAnonymous = useCallback((maybeUrl?: string | null) => {
    return r2CorsModeEnabled && isR2Url(maybeUrl);
  }, [r2CorsModeEnabled, isR2Url]);

  /** Load active playback with crossOrigin so Web Audio / VU meter can read R2 audio. */
  const prepareVideoElementForPlayback = useCallback(
    (el: HTMLVideoElement, scene?: Scene | null): boolean => {
      const url = sceneVideoSource(scene);
      if (!url) return false;

      if (shouldUseCrossOriginAnonymous(url)) {
        el.crossOrigin = 'anonymous';
      } else {
        el.crossOrigin = null;
        el.removeAttribute('crossorigin');
      }
      el.src = url;
      el.load();
      return true;
    },
    [shouldUseCrossOriginAnonymous],
  );

  const handlePossibleCorsPlaybackError = useCallback(
    (el: HTMLVideoElement, url: string) => {
      if (!shouldUseCrossOriginAnonymous(url)) return;
      try {
        el.pause();
        el.crossOrigin = null;
        el.removeAttribute('crossorigin');
        el.src = el.currentSrc || el.src || url;
        el.load();
      } catch { /* ignore */ }
      setR2CorsModeEnabled(false);
    },
    [shouldUseCrossOriginAnonymous],
  );

  useEffect(() => {
    let cancelled = false;
    const retryTimers: number[] = [];
    const EXTRACT_TIMEOUT = 5000;
    const isDev = !!(import.meta as any).env?.DEV;

    const extractFrameDirect = (videoUrl: string): Promise<string | null> => {
      return new Promise((resolve) => {
        const video = document.createElement('video');
        video.style.position = 'fixed';
        video.style.left = '-9999px';
        video.style.width = '1px';
        video.style.height = '1px';
        document.body.appendChild(video);
        let isCorsAttempt = false;
        try {
          const u = new URL(String(videoUrl || ''), window.location.href);
          if (u.origin !== window.location.origin) {
            // Extraction should keep trying crossOrigin for R2 even if playback CORS mode was disabled.
            if (isR2Url(videoUrl)) {
              video.crossOrigin = 'anonymous';
              isCorsAttempt = true;
            }
          }
        } catch {
          // ignore
        }
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;

        const finish = (result: string | null) => {
          video.pause();
          video.removeAttribute('src');
          video.load();
          video.remove();
          resolve(result);
        };

        const captureFrame = () => {
          finish(capturePosterDataUrl(video));
        };

        video.addEventListener('seeked', captureFrame, { once: true });

        video.addEventListener('error', () => {
          finish(isCorsAttempt ? '__cors_failure__' : null);
        }, { once: true });

        const timer = window.setTimeout(() => {
          finish(isCorsAttempt ? '__cors_failure__' : null);
        }, EXTRACT_TIMEOUT);

        video.addEventListener('seeked', () => clearTimeout(timer), { once: true });
        video.addEventListener('error', () => clearTimeout(timer), { once: true });

        video.addEventListener('loadeddata', () => {
          try {
            video.currentTime = 0.05;
          } catch {
            captureFrame();
          }
        }, { once: true });

        video.src = videoUrl;
        video.load();
      });
    };

    // DEV-only fallback: proxy video through same-origin endpoint for robust canvas extraction.
    const proxyCache: Map<string, string> = (window as any).__thumbProxyCache__ || new Map();
    (window as any).__thumbProxyCache__ = proxyCache;

    const getDevProxyId = async (r2Url: string): Promise<string | null> => {
      const cached = proxyCache.get(r2Url);
      if (cached) return cached;
      try {
        const res = await fetch('/api/proxy/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: r2Url }),
        });
        if (!res.ok) return null;
        const body = await res.json().catch(() => ({} as any));
        const id = String(body?.id || '');
        if (!id) return null;
        proxyCache.set(r2Url, id);
        return id;
      } catch {
        return null;
      }
    };

    const extractFrameViaDevProxy = async (videoUrl: string): Promise<string | null> => {
      const id = await getDevProxyId(videoUrl);
      if (!id) return null;
      return await extractFrameDirect(`/api/proxy/serve?id=${encodeURIComponent(id)}`);
    };

    const extractWithRetry = async (videoUrl: string): Promise<string | null | '__cors_failure__'> => {
      const first = await extractFrameDirect(videoUrl);
      if (first) return first;
      if (first === '__cors_failure__') {
        if (isDev) {
          const viaProxy = await extractFrameViaDevProxy(videoUrl);
          if (viaProxy) return viaProxy;
        }
        return '__cors_failure__';
      }
      // transient network/decoder hiccup retry
      await new Promise((r) => setTimeout(r, 220));
      const second = await extractFrameDirect(videoUrl);
      if (second) return second;
      if (second === '__cors_failure__' && isDev) {
        const viaProxy = await extractFrameViaDevProxy(videoUrl);
        if (viaProxy) return viaProxy;
      }
      return second;
    };

    const run = async () => {
      const tasks: Array<{ key: string; url: string }> = [];

      const hasDisplayPoster = (scene?: Scene | null) => {
        const cacheKey = scenePosterCacheKey(scene);
        if (cacheKey && generatedThumbsRef.current[cacheKey]) return true;
        const r2Poster = String(scene?.thumbnail || '').trim();
        return !!(r2Poster && !failedR2Posters.has(r2Poster));
      };

      const pushTask = (workIdx: number, sceneIdx: number) => {
        const scene = works[workIdx]?.scenes?.[sceneIdx];
        if (!scene || hasDisplayPoster(scene)) return;
        const cacheKey = scenePosterCacheKey(scene);
        if (!cacheKey) return;
        if (failedThumbsRef.current.has(cacheKey)) return;
        if (inFlightThumbsRef.current.has(cacheKey)) return;
        if (tasks.some((t) => t.key === cacheKey)) return;
        const url = sceneVideoSource(scene);
        if (!url) return;
        tasks.push({ key: cacheKey, url });
      };

      // Posters: first scene per work + current row (capped) + hover — never every scene at once.
      if (isMobile && !isPlaying) {
        works.forEach((_, workIdx) => pushTask(workIdx, 0));
      }
      if (!isMobile && !isPlaying) {
        works.forEach((_, workIdx) => pushTask(workIdx, 0));
        const currentScenes = works[currentWorkIndex]?.scenes || [];
        for (let sceneIdx = 0; sceneIdx < Math.min(currentScenes.length, 6); sceneIdx++) {
          pushTask(currentWorkIndex, sceneIdx);
        }
      }
      if (isPlaying) {
        pushTask(currentWorkIndex, currentSceneIndex);
        const count = works[currentWorkIndex]?.scenes?.length || 0;
        if (count > 1) {
          const prev = (currentSceneIndex - 1 + count) % count;
          const next = (currentSceneIndex + 1) % count;
          pushTask(currentWorkIndex, prev);
          pushTask(currentWorkIndex, next);
        }
      }
      if (hoveredScene && !isMobile) {
        pushTask(hoveredScene.workIndex, hoveredScene.sceneIndex);
      }

      const concurrency = 2;
      let cursor = 0;
      const workers = new Array(concurrency).fill(0).map(async () => {
        while (!cancelled) {
          const task = tasks[cursor++];
          if (!task) break;
          inFlightThumbsRef.current.add(task.key);

          let dataUrl: string | null = null;

          const direct = await extractWithRetry(task.url);
          if (direct !== '__cors_failure__') {
            dataUrl = direct;
          }

          inFlightThumbsRef.current.delete(task.key);
          if (cancelled) return;
          if (dataUrl) {
            setGeneratedThumbnails((prev) => {
              if (prev[task.key]) return prev;
              return { ...prev, [task.key]: dataUrl };
            });
          } else {
            failedThumbsRef.current.add(task.key);
            const tid = window.setTimeout(() => {
              failedThumbsRef.current.delete(task.key);
            }, 12000);
            retryTimers.push(tid);
          }
        }
      });

      await Promise.all(workers);
    };

    void run();

    return () => {
      cancelled = true;
      retryTimers.forEach((t) => clearTimeout(t));
    };
  }, [works, currentWorkIndex, currentSceneIndex, isMobile, isPlaying, hoveredScene, shouldUseCrossOriginAnonymous, isR2Url]);

  useEffect(() => {
    const container = document.querySelector('.viewer-container');
    if (!container) return;

    if (creditsVisible && !isMobile) {
      container.classList.add('credits-visible');
    } else {
      container.classList.remove('credits-visible');
    }

    if (isMobile && isPlaying) {
      container.classList.add('player-mode');
    } else {
      container.classList.remove('player-mode');
    }
  }, [creditsVisible, isMobile]);

  useEffect(() => {
    if (!(import.meta as any).env?.DEV) return;
    if (!isDebugSpacingEnabled()) return;
    const update = () => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.work-row'));
      if (rows.length < 1) {
        renderDebugOverlay('debugSpacing=1\nNo .work-row found yet');
        return;
      }

      const first = rows[0];
      const second = rows[1];
      const cs = window.getComputedStyle(first);
      const marginBottom = cs.marginBottom;
      const paddingTop = cs.paddingTop;
      const paddingBottom = cs.paddingBottom;

      let rectGap = 'n/a';
      if (second) {
        const r1 = first.getBoundingClientRect();
        const r2 = second.getBoundingClientRect();
        rectGap = `${Math.round(r2.top - r1.bottom)}px`;
      }

      renderDebugOverlay(
        [
          'debugSpacing=1',
          `rows: ${rows.length}`,
          `computed margin-bottom (.work-row): ${marginBottom}`,
          `computed padding-top: ${paddingTop}`,
          `computed padding-bottom: ${paddingBottom}`,
          `rect gap (row2.top - row1.bottom): ${rectGap}`,
        ].join('\n')
      );
    };

    const timer = window.setInterval(update, 500);
    update();
    return () => window.clearInterval(timer);
  }, [works, isMobile, isPlaying, currentWorkIndex, currentSceneIndex]);

  useEffect(() => {
    const shouldEnable = isMobile && isPlaying;
    if (shouldEnable) {
      document.body.classList.add('player-mode-active');
    } else {
      document.body.classList.remove('player-mode-active');
    }

    return () => {
      document.body.classList.remove('player-mode-active');
    };
  }, [isMobile, isPlaying]);

  const showArrowsForAWhile = useCallback(() => {
    setShowSceneArrows(true);
    if (arrowsTimerRef.current) {
      window.clearTimeout(arrowsTimerRef.current);
    }
    arrowsTimerRef.current = window.setTimeout(() => {
      setShowSceneArrows(false);
    }, 1500);
  }, []);

  useEffect(() => {
    setIsMobile(window.innerWidth <= 768);
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Hard-stop all videos except the specified one.
  // resetToStart=true is used for scene switches; false keeps the paused frame.
  const stopAllVideosExcept = useCallback((workIdx: number | null, sceneIdx: number | null, resetToStart: boolean = true) => {
    // Stop desktop grid videos
    const allVideos = document.querySelectorAll('.scene-item video');
    allVideos.forEach((video) => {
      const videoEl = video as HTMLVideoElement;
      const item = videoEl.closest('.scene-item');
      const videoWorkIndex = parseInt(item?.getAttribute('data-work-index') || '-1');
      const videoSceneIndex = parseInt(item?.getAttribute('data-scene-index') || '-1');
      
      if (workIdx === null || sceneIdx === null || videoWorkIndex !== workIdx || videoSceneIndex !== sceneIdx) {
        const wasPlaying = !videoEl.paused;
        if (wasPlaying) {
          videoEl.pause();
          if (resetToStart) {
            // Reset only on explicit scene switch.
            videoEl.currentTime = 0;
          }
        }
      }
    });

    // Stop mobile video if it's not the active one
    if (mobileFixedVideoRef.current) {
      const mobileVideo = mobileFixedVideoRef.current;
      const parent = mobileVideo.parentElement;
      const mobileWorkIdx = parseInt(parent?.getAttribute('data-work-index') || '-1');
      const mobileSceneIdx = parseInt(parent?.getAttribute('data-scene-index') || '-1');
      
      if (workIdx === null || sceneIdx === null || mobileWorkIdx !== workIdx || mobileSceneIdx !== sceneIdx) {
        const wasPlaying = !mobileVideo.paused;
        if (wasPlaying) {
          mobileVideo.pause();
          if (resetToStart) {
            mobileVideo.currentTime = 0;
          }
        }
      }
    }
  }, []);

  // Forcefully pause & mute the mobile video synchronously.
  // Must be called BEFORE any state change that unmounts or re-sources the video,
  // because React may remove the element before async effects can clean up.
  const forcePauseMobileVideo = useCallback(() => {
    const video = mobileFixedVideoRef.current;
    if (!video) return;
    try {
      cancelPendingMobileAutoplay();
      mobileLoadedSceneKeyRef.current = null;
      video.pause();
      video.muted = true;
      video.removeAttribute('src');
      video.load(); // release buffers & show poster
    } catch {}
  }, [cancelPendingMobileAutoplay]);

  const stopPlaylistAudio = useCallback((resetCurrent = false) => {
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        if (resetCurrent) {
          audio.removeAttribute('src');
          audio.load();
        }
      } catch {}
    }
    setIsAudioPlaying(false);
    if (resetCurrent) setCurrentAudioKey(null);
  }, []);

  const switchTheatreView = useCallback((nextMode: TheatreViewMode) => {
    if (nextMode === viewMode) return;
    if (nextMode === 'playlist' && !THEATRE_FILES_VIEW_ENABLED) return;

    if (nextMode === 'playlist') {
      forcePauseMobileVideo();
      setIsPlaying(false);
      stopAllVideosExcept(null, null, false);
      setDesktopPosterOverlay({ key: null });
    } else {
      stopPlaylistAudio(true);
    }

    setViewMode(nextMode);
  }, [forcePauseMobileVideo, stopAllVideosExcept, stopPlaylistAudio, viewMode]);

  const handlePlaylistPlay = useCallback(async (fileIdx: number) => {
    const file = audioFiles[fileIdx];
    const source = audioFileSource(file);
    if (!source) return;

    const key = file.id || `audio-${fileIdx}`;
    const audio = audioRef.current;
    if (!audio) return;

    if (currentAudioKey === key) {
      if (audio.paused) {
        try {
          await audio.play();
          setIsAudioPlaying(true);
        } catch (error) {
          console.error('Error playing playlist audio:', error);
        }
      } else {
        audio.pause();
        setIsAudioPlaying(false);
      }
      return;
    }

    try {
      audio.pause();
      audio.src = source;
      audio.load();
      setCurrentAudioKey(key);
      await audio.play();
      setIsAudioPlaying(true);
    } catch (error) {
      console.error('Error playing playlist audio:', error);
      setIsAudioPlaying(false);
    }
  }, [audioFiles, currentAudioKey]);

  const currentAudioIndex = useMemo(() => {
    if (!currentAudioKey) return -1;
    return audioFiles.findIndex((file, fileIdx) => (file.id || `audio-${fileIdx}`) === currentAudioKey);
  }, [audioFiles, currentAudioKey]);

  const currentAudioFile = currentAudioIndex >= 0 ? audioFiles[currentAudioIndex] : null;

  const handleTransportPlayPause = useCallback(() => {
    if (currentAudioIndex >= 0) {
      void handlePlaylistPlay(currentAudioIndex);
      return;
    }
    if (audioFiles.length > 0) void handlePlaylistPlay(0);
  }, [audioFiles.length, currentAudioIndex, handlePlaylistPlay]);

  const playAdjacentAudio = useCallback((delta: number) => {
    if (audioFiles.length === 0) return;
    let nextIdx = currentAudioIndex;
    if (nextIdx < 0) {
      nextIdx = delta < 0 ? audioFiles.length - 1 : 0;
    } else {
      nextIdx = (nextIdx + delta + audioFiles.length) % audioFiles.length;
    }
    void handlePlaylistPlay(nextIdx);
  }, [audioFiles.length, currentAudioIndex, handlePlaylistPlay]);

  const handleAudioProgressSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const bar = e.currentTarget;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const nextTime = ratio * audio.duration;
    try {
      audio.currentTime = nextTime;
      setAudioProgress({ current: nextTime, duration: audio.duration });
    } catch {
      // ignore seek errors
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const syncProgress = () => {
      setAudioProgress({
        current: audio.currentTime || 0,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      });
    };

    audio.addEventListener('timeupdate', syncProgress);
    audio.addEventListener('loadedmetadata', syncProgress);
    audio.addEventListener('durationchange', syncProgress);
    audio.addEventListener('seeked', syncProgress);

    return () => {
      audio.removeEventListener('timeupdate', syncProgress);
      audio.removeEventListener('loadedmetadata', syncProgress);
      audio.removeEventListener('durationchange', syncProgress);
      audio.removeEventListener('seeked', syncProgress);
    };
  }, [viewMode, currentAudioKey]);

  // Play the specified video — always restarts from beginning
  const playVideo = useCallback(async (workIdx: number, sceneIdx: number, fromUserGesture = false) => {
    // Increment generation to cancel any pending play from a previous call
    const gen = ++playGenRef.current;

    // Cancel any pending canplay listener from a previous call
    if (pendingCanPlayRef.current) {
      const { el, handler, timeout } = pendingCanPlayRef.current;
      el.removeEventListener('canplay', handler);
      clearTimeout(timeout);
      pendingCanPlayRef.current = null;
    }

    // Hard-stop everything else first
    stopAllVideosExcept(workIdx, sceneIdx);

    const selector = `[data-work-index="${workIdx}"][data-scene-index="${sceneIdx}"] video`;
    const videoElement = document.querySelector(selector) as HTMLVideoElement;
    
    if (!videoElement) return;

    const scene = works[workIdx]?.scenes?.[sceneIdx];
    prepareVideoElementForPlayback(videoElement, scene);

    // Always restart from the beginning
    videoElement.currentTime = 0;
    videoElement.preload = 'auto';

    const doPlay = async () => {
      // Stale check: if user clicked another video while we waited, abort
      if (playGenRef.current !== gen) return;

      // Make sure all others are still stopped (safety net)
      stopAllVideosExcept(workIdx, sceneIdx);

      try {
        videoElement.muted = false;
        videoElement.volume = 1.0;
        await videoElement.play();
        if (playGenRef.current !== gen) {
          try { videoElement.pause(); } catch {}
          return;
        }
        activeVideoRef.current = videoElement;
        forceConnectVideoToVuMeter(videoElement);
      } catch (error) {
        console.error('Error playing video:', error);
        // If unmuted play fails due to autoplay policy, try muted first
        try {
          if (playGenRef.current !== gen) return;
          videoElement.muted = true;
          await videoElement.play();
          if (playGenRef.current !== gen) {
            try { videoElement.pause(); } catch {}
            return;
          }
          activeVideoRef.current = videoElement;
          forceConnectVideoToVuMeter(videoElement);
          if (fromUserGesture) {
            // Unmute and restart playback to enable audio
            videoElement.muted = false;
            videoElement.volume = 1.0;
            // Call play again to apply the unmuted state
            await videoElement.play();
            if (playGenRef.current !== gen) {
              try { videoElement.pause(); } catch {}
              return;
            }
            forceConnectVideoToVuMeter(videoElement);
          }
        } catch (e2) {
          console.error('Error playing video (muted fallback):', e2);
        }
      }
    };

    // If this call comes from a direct user gesture (click/tap), attempt play immediately
    // to preserve gesture context and allow unmuted playback in browsers with autoplay rules.
    if (fromUserGesture) {
      // prepareVideoElementForPlayback already called load() — don't reload
      await doPlay();
    }
    // If already buffered enough, play immediately (readyState 2+ = has current frame)
    else if (videoElement.readyState >= 2) {
      await doPlay();
    } else {
      // Wait for canplay with a safety timeout
      const handleCanPlay = () => {
        videoElement.removeEventListener('canplay', handleCanPlay);
        if (pendingCanPlayRef.current?.el === videoElement) {
          clearTimeout(pendingCanPlayRef.current.timeout);
          pendingCanPlayRef.current = null;
        }
        doPlay();
      };
      
      videoElement.addEventListener('canplay', handleCanPlay);
      
      // Safety timeout: force play after 1s even if canplay hasn't fired
      const timeoutId = window.setTimeout(() => {
        videoElement.removeEventListener('canplay', handleCanPlay);
        if (pendingCanPlayRef.current?.el === videoElement) {
          pendingCanPlayRef.current = null;
        }
        console.warn('[VideoGrid] canplay timeout, forcing play');
        doPlay();
      }, 1000);
      
      pendingCanPlayRef.current = { el: videoElement, handler: handleCanPlay, timeout: timeoutId };
    }
  }, [works, stopAllVideosExcept, prepareVideoElementForPlayback]);

  // Handle scene click — always restart from beginning, only one video at a time
  const handleSceneClick = useCallback((workIdx: number, sceneIdx: number) => {
    const sameWork = workIdx === currentWorkIndex;
    const sameScene = sceneIdx === currentSceneIndex;
    
    if (sameWork && sameScene && isPlaying) {
      // Clicking the currently playing video: pause it
      setIsPlaying(false);
      stopAllVideosExcept(null, null, false);
      return;
    }

    // Any other click: start playing from beginning
    if (!isMobile) {
      const scene = works[workIdx]?.scenes?.[sceneIdx];
      const poster = resolveScenePoster(workIdx, sceneIdx, scene);
      setDesktopPosterOverlay({ key: `${workIdx}:${sceneIdx}`, url: poster });
    }

    setCurrentWorkIndex(workIdx);
    setCurrentSceneIndex(sceneIdx);
    setIsPlaying(true);

    // Play immediately within user gesture context
    playVideo(workIdx, sceneIdx, true);
    
    // Scroll scene into view
    setTimeout(() => {
      const sceneElement = document.querySelector(`[data-work-index="${workIdx}"][data-scene-index="${sceneIdx}"]`);
      sceneElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 50);
  }, [currentWorkIndex, currentSceneIndex, isPlaying, stopAllVideosExcept, playVideo, isMobile, works, resolveScenePoster]);

  const closeFloatingWindow = useCallback((id: string) => {
    setFloatingWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const focusFloatingWindow = useCallback((id: string) => {
    const nextZ = floatingZRef.current++;
    setFloatingWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, zIndex: nextZ } : w)),
    );
  }, []);

  const openFloatingVideo = useCallback(
    (workIdx: number, sceneIdx: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const work = works[workIdx];
      const scene = work?.scenes?.[sceneIdx];
      if (!scene) return;

      const src = sceneSource(scene);
      if (!src) return;

      const selector = `[data-work-index="${workIdx}"][data-scene-index="${sceneIdx}"] video`;
      const gridVideo = document.querySelector(selector) as HTMLVideoElement | null;
      const initialTime = gridVideo?.currentTime ?? 0;
      const autoPlay = !!(gridVideo && !gridVideo.paused && !gridVideo.ended);

      if (gridVideo && !gridVideo.paused) {
        try {
          gridVideo.pause();
        } catch {
          /* ignore */
        }
      }

      if (workIdx === currentWorkIndex && sceneIdx === currentSceneIndex && isPlaying) {
        setIsPlaying(false);
        stopAllVideosExcept(null, null, false);
      }

      const offset = floatingWindows.length * 28;
      const id = `float-${workIdx}-${sceneIdx}-${Date.now()}`;
      const title = sceneFileName(scene) || work?.title || 'Video';
      const maxX = typeof window !== 'undefined' ? Math.max(72, window.innerWidth - 520) : 72;
      const maxY = typeof window !== 'undefined' ? Math.max(96, window.innerHeight - 320) : 96;

      setFloatingWindows((prev) => [
        ...prev,
        {
          id,
          src,
          poster: resolveScenePoster(workIdx, sceneIdx, scene),
          crossOrigin: shouldUseCrossOriginAnonymous(src) ? 'anonymous' : undefined,
          title,
          initialTime,
          autoPlay,
          defaultX: Math.min(maxX, 72 + offset),
          defaultY: Math.min(maxY, 96 + offset),
          zIndex: floatingZRef.current++,
        },
      ]);
    },
    [
      works,
      floatingWindows.length,
      resolveScenePoster,
      shouldUseCrossOriginAnonymous,
      currentWorkIndex,
      currentSceneIndex,
      isPlaying,
      stopAllVideosExcept,
    ],
  );

  // Handle play/pause state — only stop videos, never start a second play here
  // (playVideo is called directly from handleSceneClick within user gesture context)
  useEffect(() => {
    if (!isPlaying) {
      if (!isMobile) setDesktopPosterOverlay({ key: null });
      stopAllVideosExcept(null, null, false);
      // Nuclear safety net: force-pause every <video> on the page
      // to guarantee no orphan audio survives unmount / state changes.
      const allVideos = document.querySelectorAll('video') as NodeListOf<HTMLVideoElement>;
      allVideos.forEach((v) => {
        if (v.closest('.floating-video-window')) return;
        try {
          if (!v.paused) {
            v.pause();
            v.muted = true;
          }
        } catch {}
      });
    }
  }, [isPlaying, stopAllVideosExcept, isMobile]);

  // Pause mobile video when the tab/app goes to background (e.g. swipe home on iOS)
  useEffect(() => {
    if (!isMobile) return;
    const handler = () => {
      if (document.hidden) {
        const video = mobileFixedVideoRef.current;
        if (video && !video.paused) {
          video.pause();
          video.muted = true;
        }
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [isMobile]);

  // Lightweight prefetch: fetch beginning of adjacent scenes into browser cache.
  // On mobile only one video plays at a time — only prefetch ±1 scene within the
  // current work. Skip entirely when the connection is slow or Save-Data is set.
  useEffect(() => {
    if (!isPlaying) return;
    const work = works[currentWorkIndex];
    if (!work) return;

    // Respect Save-Data and slow connections — don't compete with active playback
    if (isMobile) {
      const conn = (navigator as any).connection;
      if (conn) {
        if (conn.saveData) return;
        if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') return;
      }
    } else {
      // Desktop: only prefetch when active scene is already rendering frames,
      // so distant-row clicks don't compete with startup bandwidth.
      const activeVideo = document.querySelector(
        `[data-work-index="${currentWorkIndex}"][data-scene-index="${currentSceneIndex}"] video`
      ) as HTMLVideoElement | null;
      if (!activeVideo || activeVideo.paused || activeVideo.readyState < 2) return;
    }

    // On mobile, avoid competing with the *current* video's startup buffering.
    // Prefetching adjacent scenes too early can create a tiny stall right after playback begins.
    if (isMobile) {
      const active = mobileFixedVideoRef.current;
      if (!active || active.paused) return;
      // Wait until the browser has buffered at least ~2s ahead.
      const buffered = active.buffered;
      const current = active.currentTime || 0;
      let bufferedAhead = 0;
      try {
        if (buffered && buffered.length > 0) {
          bufferedAhead = Math.max(0, buffered.end(buffered.length - 1) - current);
        }
      } catch {
        bufferedAhead = 0;
      }
      if (active.readyState < 3 || bufferedAhead < 2) return;
    }

    const controller = new AbortController();
    // 256 KB on mobile, 384 KB on desktop
    const prefetchBytes = isMobile ? 262143 : 393215;
    // Mobile: delay more to ensure smooth start; Desktop: keep conservative delay
    const delay = isMobile ? 2000 : 1800;

    const toFetch = new Set<string>();

    if (isMobile) {
      // Only ±1 scene within the same work (same as the < > arrows).
      // Skip ±1 project prefetch — the active video's buffering takes priority.
      const sceneCount = work.scenes.length;
      if (sceneCount > 1) {
        const prevSceneIdx = (currentSceneIndex - 1 + sceneCount) % sceneCount;
        const nextSceneIdx = (currentSceneIndex + 1) % sceneCount;

        const prevSceneUrl = work.scenes[prevSceneIdx]?.proxiedVideoUrl ?? work.scenes[prevSceneIdx]?.videoUrl;
        const nextSceneUrl = work.scenes[nextSceneIdx]?.proxiedVideoUrl ?? work.scenes[nextSceneIdx]?.videoUrl;
        // Don't prefetch the same URL we're already playing
        const activeUrl = work.scenes[currentSceneIndex]?.proxiedVideoUrl ?? work.scenes[currentSceneIndex]?.videoUrl;
        if (prevSceneUrl && prevSceneUrl !== activeUrl) toFetch.add(prevSceneUrl);
        if (nextSceneUrl && nextSceneUrl !== activeUrl) toFetch.add(nextSceneUrl);
      }
    } else {
      // Desktop: prefetch only next scene, non-wrapping
      const nextIdx = currentSceneIndex + 1;
      if (nextIdx < work.scenes.length) {
        const nextUrl = work.scenes[nextIdx]?.proxiedVideoUrl ?? work.scenes[nextIdx]?.videoUrl;
        if (nextUrl) toFetch.add(nextUrl);
      }
    }

    if (toFetch.size === 0) return;

    const timer = window.setTimeout(() => {
      toFetch.forEach((url) => {
        fetch(url, {
          headers: { Range: `bytes=0-${prefetchBytes}` },
          signal: controller.signal,
        }).catch(() => {});
      });
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isPlaying, currentWorkIndex, currentSceneIndex, works, isMobile]);

  // Release video buffers from distant works when switching works
  // React removes src for distant works (lazy src), but we need to force
  // the browser to actually release the buffered data via load()
  useEffect(() => {
    const cleanup = () => {
      const allVideos = document.querySelectorAll('.scene-item video') as NodeListOf<HTMLVideoElement>;
      allVideos.forEach((video) => {
        // If React removed the src (distant work) but the video still has data buffered
        if (!video.hasAttribute('src') && video.readyState > 0) {
          video.load(); // Force the browser to release buffered data
        }
      });
    };

    // Defer cleanup to avoid interfering with current playback start
    if ('requestIdleCallback' in window) {
      const id = (window as any).requestIdleCallback(cleanup, { timeout: 2000 });
      return () => (window as any).cancelIdleCallback(id);
    } else {
      const id = setTimeout(cleanup, 500);
      return () => clearTimeout(id);
    }
  }, [currentWorkIndex]);

  // Comprehensive mobile playback manager.
  // Handles src assignment, loading and autoplay for the persistent video element
  // (no key-based remounting — the same <video> stays in the DOM across scenes).
  useEffect(() => {
    if (!isMobile) return;
    const video = mobileFixedVideoRef.current;
    if (!video) return;

    if (!isPlaying) {
      cancelPendingMobileAutoplay();
      mobileLoadedSceneKeyRef.current = null;
      setMobilePosterOverlay({ visible: false });
      // Force silence when leaving the player
      video.pause();
      video.muted = true;
      video.removeAttribute('src');
      video.load();
      return;
    }

    const scene = works[currentWorkIndex]?.scenes?.[currentSceneIndex];
    if (!scene) return;

    const newSrc = scene.proxiedVideoUrl ?? scene.videoUrl;
    const poster = resolveScenePoster(currentWorkIndex, currentSceneIndex, scene);
    const sceneKey = `${currentWorkIndex}:${currentSceneIndex}:${newSrc}`;

    if (mobileLoadedSceneKeyRef.current === sceneKey) {
      return;
    }

    cancelPendingMobileAutoplay();
    mobileUserPausedRef.current = false;
    mobileLoadedSceneKeyRef.current = sceneKey;
    setMobilePosterOverlay({ visible: true, url: poster });

    // Pause + clear old source before loading new one
    video.pause();
    if (poster) video.poster = poster;
    prepareVideoElementForPlayback(video, scene);
    video.currentTime = 0;
    video.preload = 'auto';

    let cancelled = false;

    const play = async () => {
      if (cancelled || mobileUserPausedRef.current) return;
      try {
        video.muted = false;
        video.volume = 1.0;
        await video.play();
      } catch {
        // Autoplay policy fallback: play muted then unmute
        try {
          video.muted = true;
          await video.play();
          // Don't call play() again: re-calling play() can cause a small hiccup on some devices.
          // We'll attempt to unmute once playback is confirmed (see handlePlaying).
        } catch (e2) {
          console.error('[mobile] play failed:', e2);
        }
      }
    };

    // Use 'canplaythrough' — Safari iOS can stall right after 'loadeddata';
    // 'canplaythrough' signals the browser has enough data to play without buffering.
    const handleReady = () => {
      // Cancel the safety timer so we don't call play() twice.
      if (mobileAutoplayTimerRef.current) {
        clearTimeout(mobileAutoplayTimerRef.current);
        mobileAutoplayTimerRef.current = null;
      }
      play();
    };
    const handlePlaying = () => {
      if (!cancelled && !mobileUserPausedRef.current) {
        setMobilePosterOverlay((prev) => ({ ...prev, visible: false }));

        // If we started muted due to autoplay policy, try unmuting without restarting playback.
        try {
          if (video.muted) {
            video.muted = false;
            video.volume = 1.0;
          }
        } catch {
          // ignore
        }
      }
    };
    mobileCanPlaythroughHandlerRef.current = handleReady;
    mobileAutoplayVideoRef.current = video;
    video.addEventListener('canplaythrough', handleReady, { once: true });
    video.addEventListener('playing', handlePlaying);

    // Safety timeout: force play after 1.5s even if event hasn't fired
    const timer = window.setTimeout(() => {
      video.removeEventListener('canplaythrough', handleReady);
      play();
    }, 1500);
    mobileAutoplayTimerRef.current = timer;

    return () => {
      cancelled = true;
      video.removeEventListener('playing', handlePlaying);
      cancelPendingMobileAutoplay();
    };
  }, [isMobile, isPlaying, currentWorkIndex, currentSceneIndex, works, resolveScenePoster, cancelPendingMobileAutoplay, prepareVideoElementForPlayback]);

  // Inject a <link rel="preload" as="video"> in <head> for the active video on mobile.
  // This lets Safari's speculative loader start fetching before the <video> src is set.
  useEffect(() => {
    if (!isMobile || !isPlaying) {
      // Remove hint when not playing
      document.getElementById('__mobile_video_preload')?.remove();
      return;
    }
    const scene = works[currentWorkIndex]?.scenes?.[currentSceneIndex];
    const url = scene?.proxiedVideoUrl ?? scene?.videoUrl;
    if (!url) return;

    let link = document.getElementById('__mobile_video_preload') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = '__mobile_video_preload';
      link.rel = 'preload';
      (link as any).as = 'video';
      document.head.appendChild(link);
    }
    link.href = url;

    return () => {
      // Remove on cleanup (scene change will re-run with new URL)
      document.getElementById('__mobile_video_preload')?.remove();
    };
  }, [isMobile, isPlaying, currentWorkIndex, currentSceneIndex, works]);

  // Listen for global closePlayer event (emitted by nav back button) to close mobile modal
  useEffect(() => {
    const handler = () => {
      try {
        forcePauseMobileVideo();
        setIsPlaying(false);
      } catch (e) {}
    };
    document.addEventListener('closePlayer', handler as EventListener);
    return () => document.removeEventListener('closePlayer', handler as EventListener);
  }, [forcePauseMobileVideo]);

  // Keyboard navigation
  useEffect(() => {
    if (isMobile) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const currentWork = works[currentWorkIndex];
      if (!currentWork) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (currentSceneIndex > 0) {
            handleSceneClick(currentWorkIndex, currentSceneIndex - 1);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (currentSceneIndex < currentWork.scenes.length - 1) {
            handleSceneClick(currentWorkIndex, currentSceneIndex + 1);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (currentWorkIndex > 0) {
            handleSceneClick(currentWorkIndex - 1, 0);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (currentWorkIndex < works.length - 1) {
            handleSceneClick(currentWorkIndex + 1, 0);
          }
          break;
        case ' ':
          e.preventDefault();
          setIsPlaying(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentWorkIndex, currentSceneIndex, works, handleSceneClick, isMobile]);

  // Horizontal scroll navigation
  const scrollHorizontal = useCallback((workIdx: number, direction: 'left' | 'right') => {
    const container = document.querySelector(`[data-work-index="${workIdx}"] .scenes-container`) as HTMLElement;
    if (container) {
      const scrollAmount = 400;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  }, []);

  // Check if scroll buttons should be visible
  const [scrollVisibility, setScrollVisibility] = useState<Record<number, { left: boolean; right: boolean }>>({});

  useEffect(() => {
    const checkScroll = () => {
      const newVisibility: Record<number, { left: boolean; right: boolean }> = {};
      works.forEach((_, idx) => {
        const container = document.querySelector(`[data-work-index="${idx}"] .scenes-container`) as HTMLElement;
        if (container) {
          // More robust calculation: use Math.ceil to handle subpixel rendering
          // and reduce magic offset to avoid false negatives when layout changes
          newVisibility[idx] = {
            left: container.scrollLeft > 10,
            right: Math.ceil(container.scrollLeft + container.clientWidth) < container.scrollWidth - 1
          };
        }
      });
      setScrollVisibility(newVisibility);
    };

    checkScroll();
    const containers = document.querySelectorAll('.scenes-container');
    containers.forEach(container => {
      container.addEventListener('scroll', checkScroll);
    });

    return () => {
      containers.forEach(container => {
        container.removeEventListener('scroll', checkScroll);
      });
    };
  }, [works]);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (!audio) return;
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {}
    };
  }, []);

  const renderViewSwitch = () => {
    if (isMobile || !THEATRE_FILES_VIEW_ENABLED) return null;
    return (
      <div className="theatre-view-switch" aria-label="theatre view">
        <button
          type="button"
          className={viewMode === 'video' ? 'active' : ''}
          onClick={() => switchTheatreView('video')}
        >
          videos
        </button>
        <span aria-hidden="true">/</span>
        <button
          type="button"
          className={viewMode === 'playlist' ? 'active' : ''}
          onClick={() => switchTheatreView('playlist')}
        >
          files
        </button>
      </div>
    );
  };

  useEffect(() => {
    if ((isMobile || !THEATRE_FILES_VIEW_ENABLED) && viewMode !== 'video') {
      stopPlaylistAudio(true);
      setViewMode('video');
    }
  }, [isMobile, viewMode, stopPlaylistAudio]);

  if (THEATRE_FILES_VIEW_ENABLED && !isMobile && viewMode === 'playlist') {
    const transportFileName = currentAudioFile
      ? (currentAudioFile.filename || sceneFileName({
          id: currentAudioFile.id,
          videoUrl: currentAudioFile.audioUrl,
          proxiedVideoUrl: currentAudioFile.proxiedAudioUrl,
        }))
      : 'select a file';
    const transportWorkTitle = currentAudioFile?.workTitle?.trim() || '';
    const progressRatio = audioProgress.duration > 0
      ? Math.min(1, audioProgress.current / audioProgress.duration)
      : 0;

    return (
      <div className="scene-grid playlist-mode">
        {renderViewSwitch()}
        <div className="playlist-panel" role="region" aria-label="sound files playlist">
          <div className="playlist-header" role="row">
            <span className="playlist-cell playlist-control-cell" aria-hidden="true" />
            <span className="playlist-cell playlist-file-cell">filename</span>
            <span className="playlist-cell playlist-work-cell">work</span>
          </div>
          {audioFiles.length === 0 ? (
            <div className="playlist-empty">
              no audio files found
            </div>
          ) : (
            audioFiles.map((file, fileIdx) => {
              const key = file.id || `audio-${fileIdx}`;
              const isCurrent = currentAudioKey === key;
              const isRowPlaying = isCurrent && isAudioPlaying;
              const fileName = file.filename || sceneFileName({ id: key, videoUrl: file.audioUrl, proxiedVideoUrl: file.proxiedAudioUrl });

              return (
                <div
                  className={`playlist-row ${isCurrent ? 'active' : ''}`}
                  role="row"
                  key={key}
                >
                  <span className="playlist-cell playlist-control-cell">
                    <button
                      type="button"
                      className={`playlist-play-button play-glyph-button ${isRowPlaying ? 'playing' : ''}`}
                      onClick={() => handlePlaylistPlay(fileIdx)}
                      aria-label={`${isRowPlaying ? 'Pause' : 'Play'} ${fileName}`}
                    >
                      {isRowPlaying ? <PauseGlyph /> : <PlayGlyph />}
                    </button>
                  </span>
                  <span className="playlist-cell playlist-file-cell" title={fileName}>
                    {fileName}
                  </span>
                  <span className="playlist-cell playlist-work-cell" title={file.workTitle || ''}>
                    {file.workTitle || ''}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <footer className="playlist-transport" aria-label="Playback controls">
          <div className="playlist-transport-controls">
            <button
              type="button"
              className="playlist-transport-btn"
              onClick={() => playAdjacentAudio(-1)}
              disabled={audioFiles.length === 0}
              aria-label="Previous file"
            >
              ‹
            </button>
            <button
              type="button"
              className="playlist-transport-btn playlist-transport-btn-play"
              onClick={handleTransportPlayPause}
              disabled={audioFiles.length === 0}
              aria-label={isAudioPlaying ? 'Pause' : 'Play'}
            >
              {isAudioPlaying ? '❚❚' : '▶'}
            </button>
            <button
              type="button"
              className="playlist-transport-btn"
              onClick={() => playAdjacentAudio(1)}
              disabled={audioFiles.length === 0}
              aria-label="Next file"
            >
              ›
            </button>
          </div>

          <div className="playlist-transport-meta">
            <span className="playlist-transport-title" title={transportFileName}>
              {transportFileName}
            </span>
            {transportWorkTitle ? (
              <span className="playlist-transport-work" title={transportWorkTitle}>
                {transportWorkTitle}
              </span>
            ) : null}
          </div>

          <div className="playlist-transport-progress">
            <span className="playlist-transport-time" aria-hidden="true">
              {formatAudioTime(audioProgress.current)}
            </span>
            <div
              className="playlist-transport-bar"
              role="slider"
              aria-label="Playback position"
              aria-valuemin={0}
              aria-valuemax={Math.floor(audioProgress.duration) || 0}
              aria-valuenow={Math.floor(audioProgress.current)}
              onClick={handleAudioProgressSeek}
            >
              <div
                className="playlist-transport-bar-fill"
                style={{ width: `${progressRatio * 100}%` }}
              />
            </div>
            <span className="playlist-transport-time" aria-hidden="true">
              {formatAudioTime(audioProgress.duration)}
            </span>
          </div>
        </footer>

        <audio
          ref={audioRef}
          preload="none"
          onPlay={() => setIsAudioPlaying(true)}
          onPause={() => setIsAudioPlaying(false)}
          onEnded={() => {
            setIsAudioPlaying(false);
            if (currentAudioIndex >= 0 && currentAudioIndex < audioFiles.length - 1) {
              void handlePlaylistPlay(currentAudioIndex + 1);
              return;
            }
            setCurrentAudioKey(null);
            setAudioProgress({ current: 0, duration: 0 });
          }}
        />
      </div>
    );
  }

  if (isMobile) {
    // Mobile: vertical list layout
    return (
      <div className={`scene-grid mobile ${isPlaying ? 'mobile-player-active' : ''}`}>
        {isPlaying && currentWorkIndex !== null && currentSceneIndex !== null && (
          <div
            className="mobile-fixed-player"
            onTouchStart={() => {
              showArrowsForAWhile();
            }}
            onTouchMove={() => {
              showArrowsForAWhile();
            }}
            onMouseEnter={() => {
              showArrowsForAWhile();
            }}
            onMouseMove={() => {
              showArrowsForAWhile();
            }}
          >
              {/* Modal-specific navigation bar (decoupled from main site nav) */}
              <div className="modal-nav">
                <button
                  className="nav-back-button modal-nav-back"
                  aria-label="Close player"
                  type="button"
                  onClick={() => {
                    try {
                      forcePauseMobileVideo();
                      setIsPlaying(false);
                    } catch (e) {}
                  }}
                >
                  ⟵
                </button>
              </div>

            {/* Video wrapper with scene navigation arrows overlaid */}
            <div className="video-wrapper">
              {/* Edge tap zones for touch navigation */}
              <button
                className="edge-tap-zone left"
                aria-label="Previous scene area"
                onClick={() => {
                  const total = works[currentWorkIndex]?.scenes?.length || 0;
                  if (!total) return;
                  forcePauseMobileVideo();
                  const prev = (currentSceneIndex - 1 + total) % total;
                  setCurrentSceneIndex(prev);
                  setIsPlaying(true);
                  showArrowsForAWhile();
                }}
              />
              <button
                className="edge-tap-zone right"
                aria-label="Next scene area"
                onClick={() => {
                  const total = works[currentWorkIndex]?.scenes?.length || 0;
                  if (!total) return;
                  forcePauseMobileVideo();
                  const next = (currentSceneIndex + 1) % total;
                  setCurrentSceneIndex(next);
                  setIsPlaying(true);
                  showArrowsForAWhile();
                }}
              />

              {/* Scene navigation arrows (visible when .show) */}
              <button
                className={`nav-arrow left ${showSceneArrows ? 'show' : ''}`}
                aria-label="Previous scene"
                onClick={() => {
                  const total = works[currentWorkIndex]?.scenes?.length || 0;
                  if (!total) return;
                  forcePauseMobileVideo();
                  const prev = (currentSceneIndex - 1 + total) % total;
                  setCurrentSceneIndex(prev);
                  setIsPlaying(true);
                }}
              >
                {'<'}
              </button>

              <button
                className={`nav-arrow right ${showSceneArrows ? 'show' : ''}`}
                aria-label="Next scene"
                onClick={() => {
                  const total = works[currentWorkIndex]?.scenes?.length || 0;
                  if (!total) return;
                  forcePauseMobileVideo();
                  const next = (currentSceneIndex + 1) % total;
                  setCurrentSceneIndex(next);
                  setIsPlaying(true);
                }}
              >
                {'>'}
              </button>

              {/* Video element */}
              <div 
                data-work-index={currentWorkIndex}
                data-scene-index={currentSceneIndex}
                style={{ width: '100%', height: '100%', position: 'relative' }}
              >
                <video
                  ref={mobileFixedVideoRef}
                  crossOrigin={shouldUseCrossOriginAnonymous(
                    works[currentWorkIndex]?.scenes?.[currentSceneIndex]?.proxiedVideoUrl ??
                      works[currentWorkIndex]?.scenes?.[currentSceneIndex]?.videoUrl,
                  )
                    ? 'anonymous'
                    : undefined}
                  poster={resolveScenePoster(currentWorkIndex, currentSceneIndex, works[currentWorkIndex]?.scenes?.[currentSceneIndex])}
                  loop
                  playsInline
                  preload="auto"
                  controls={false}
                  disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  onError={(e) => {
                    const url = works[currentWorkIndex]?.scenes?.[currentSceneIndex]?.proxiedVideoUrl ??
                      works[currentWorkIndex]?.scenes?.[currentSceneIndex]?.videoUrl;
                    handlePossibleCorsPlaybackError(e.currentTarget, url);
                  }}
                  onPlaying={(e) => {
                    activeVideoRef.current = e.currentTarget;
                    forceConnectVideoToVuMeter(e.currentTarget);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    showArrowsForAWhile();
                    const vid = e.currentTarget;
                    if (vid.paused) {
                      mobileUserPausedRef.current = false;
                      vid.muted = false;
                      vid.volume = 1.0;
                      vid.play().catch(() => {});
                    } else {
                      mobileUserPausedRef.current = true;
                      cancelPendingMobileAutoplay();
                      setMobilePosterOverlay((prev) => ({ ...prev, visible: false }));
                      vid.pause();
                    }
                  }}
                />
                {mobilePosterOverlay.visible && mobilePosterOverlay.url && (
                  <img
                    src={mobilePosterOverlay.url}
                    alt=""
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      pointerEvents: 'none',
                      zIndex: 1,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Project navigation - always visible when modal is open */}
            <div className="project-nav-controls">
              <button
                className="project-nav-btn prev"
                aria-label="Previous project"
                onClick={() => {
                  const totalWorks = works.length;
                  if (!totalWorks) return;
                  forcePauseMobileVideo();
                  const prevWork = (currentWorkIndex - 1 + totalWorks) % totalWorks;
                  setCurrentWorkIndex(prevWork);
                  setCurrentSceneIndex(0);
                }}
              >
                ‹ prev
              </button>
              <button
                className="project-nav-btn next"
                aria-label="Next project"
                onClick={() => {
                  const totalWorks = works.length;
                  if (!totalWorks) return;
                  forcePauseMobileVideo();
                  const nextWork = (currentWorkIndex + 1) % totalWorks;
                  setCurrentWorkIndex(nextWork);
                  setCurrentSceneIndex(0);
                }}
              >
                next ›
              </button>
            </div>

            {/* Credits panel under the video - only shows when playing */}
            <CreditsPanel
              isVisible={creditsVisible && isMobile}
              title={currentWork?.title || ''}
              credits={credits}
              synopsis={synopsis}
            />
          </div>
        )}

        {!isPlaying && (
          <div className="mobile-list">
            {works.map((work, workIdx) => {
              const firstScene = work.scenes && work.scenes.length ? work.scenes[0] : null;
              return (
                <div
                  key={work.id}
                  className="mobile-item"
                  data-work-index={workIdx}
                >
                  <div className="mobile-video-wrapper">
                    <div
                      className={`scene-item project-summary`}
                      onClick={() => {
                        // Open project in fixed mobile player and start at first scene
                        setCurrentWorkIndex(workIdx);
                        setCurrentSceneIndex(0);
                        setIsPlaying(true);
                        showArrowsForAWhile();
                      }}
                      data-work-index={workIdx}
                    >
                      {firstScene ? (
                        (() => {
                          const poster = resolveScenePoster(workIdx, 0, firstScene);
                          if (poster) {
                            return (
                              <img
                                className="mobile-video scene-poster-image"
                                src={poster}
                                alt={work.title}
                                loading={workIdx < 2 ? 'eager' : 'lazy'}
                                decoding="async"
                                onError={() => handleScenePosterError(firstScene)}
                              />
                            );
                          }
                          return (
                            <div className="scene-poster-placeholder mobile-video" aria-hidden="true" />
                          );
                        })()
                      ) : (
                        <div className="project-placeholder">No scenes</div>
                      )}
                      <button
                        type="button"
                        className="play-pause-button play-glyph-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentWorkIndex(workIdx);
                          setCurrentSceneIndex(0);
                          setIsPlaying(true);
                          showArrowsForAWhile();
                        }}
                        aria-label={`Open project ${work.title}`}
                      >
                        <PlayGlyph />
                      </button>
                    </div>
                  </div>
                  <div className="mobile-work-title">{work.title} <span className="mobile-scene-count">{work.scenes ? `· ${work.scenes.length} videos` : ''}</span></div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Desktop: horizontal scrolling grid
  return (
    <>
      {renderViewSwitch()}
      <div ref={containerRef} className="scene-grid">
        <div className="works-container">
          {works.map((work, workIdx) => (
            <div
              key={work.id}
              className={`work-row visible-work ${isPlaying && workIdx === currentWorkIndex ? 'active-work current-work playing' : ''} ${isPlaying && workIdx === currentWorkIndex + 1 ? 'next-work' : ''}`}
              data-work-index={workIdx}
            >
              <div className="work-row-header">
                <h2 className="work-row-heading theatre-ui-label">{work.title}</h2>
              </div>
              <div className="work-row-track">
                <button
                  className={`hscroll-btn hscroll-left ${scrollVisibility[workIdx]?.left ? 'visible' : ''}`}
                  onClick={() => scrollHorizontal(workIdx, 'left')}
                  aria-label="Scroll left"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="square" strokeLinejoin="miter"><path d="M15 18l-6-6 6-6"/></svg>
                </button>

                <button
                  className={`hscroll-btn hscroll-right ${scrollVisibility[workIdx]?.right ? 'visible' : ''}`}
                  onClick={() => scrollHorizontal(workIdx, 'right')}
                  aria-label="Scroll right"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="square" strokeLinejoin="miter"><path d="M9 18l6-6-6-6"/></svg>
                </button>

                <div className="scenes-container" data-work-index={workIdx}>
                {work.scenes.map((scene, sceneIdx) => (
                  <div
                    key={scene.id}
                    className={`scene-item ${
                      !isPlaying && !(hoveredScene?.workIndex === workIdx && hoveredScene?.sceneIndex === sceneIdx) ? 'initial-blur' : ''
                    } ${
                      isPlaying && workIdx === currentWorkIndex && sceneIdx === currentSceneIndex ? 'active' : ''
                    } ${
                      hoveredScene?.workIndex === workIdx && hoveredScene?.sceneIndex === sceneIdx ? 'hovered' : ''
                    }`}
                    data-work-index={workIdx}
                    data-scene-index={sceneIdx}
                    onClick={() => handleSceneClick(workIdx, sceneIdx)}
                    onMouseEnter={() => setHoveredScene({ workIndex: workIdx, sceneIndex: sceneIdx })}
                    onMouseLeave={() => setHoveredScene(null)}
                  >
                    {(() => {
                      const isActiveScene =
                        isPlaying && workIdx === currentWorkIndex && sceneIdx === currentSceneIndex;
                      const posterUrl = resolveScenePoster(workIdx, sceneIdx, scene);
                      return (
                        <>
                          {!isActiveScene && (
                            posterUrl ? (
                              <img
                                className="scene-poster-image"
                                src={posterUrl}
                                alt=""
                                decoding="async"
                                loading="lazy"
                                onError={() => handleScenePosterError(scene)}
                              />
                            ) : (
                              <div className="scene-poster-placeholder" aria-hidden="true" />
                            )
                          )}
                          <video
                            className="scene-video"
                            src={
                              Math.abs(workIdx - currentWorkIndex) <= 1 || sceneIdx === 0
                                ? (scene.proxiedVideoUrl ?? scene.videoUrl)
                                : undefined
                            }
                            crossOrigin={shouldUseCrossOriginAnonymous(scene.proxiedVideoUrl ?? scene.videoUrl) ? 'anonymous' : undefined}
                            poster={posterUrl}
                            playsInline
                            preload={
                              workIdx === currentWorkIndex && sceneIdx === currentSceneIndex ? 'auto' :
                              workIdx === currentWorkIndex && Math.abs(sceneIdx - currentSceneIndex) <= 1 ? 'metadata' :
                              sceneIdx === 0 ? 'metadata' :
                              Math.abs(workIdx - currentWorkIndex) <= 1 ? 'metadata' :
                              'none'
                            }
                            loop
                            onError={(e) => {
                              if (!isActiveScene) return;
                              const url = scene.proxiedVideoUrl ?? scene.videoUrl;
                              handlePossibleCorsPlaybackError(e.currentTarget, url);
                            }}
                            onPlaying={(e) => {
                              const key = `${workIdx}:${sceneIdx}`;
                              setDesktopPosterOverlay((prev) =>
                                prev.key === key ? { key: null } : prev,
                              );
                              activeVideoRef.current = e.currentTarget;
                              forceConnectVideoToVuMeter(e.currentTarget);
                            }}
                          />
                        </>
                      );
                    })()}
                    {desktopPosterOverlay.key === `${workIdx}:${sceneIdx}` && desktopPosterOverlay.url && (
                      <img
                        className="desktop-poster-overlay"
                        src={desktopPosterOverlay.url}
                        alt=""
                        aria-hidden="true"
                      />
                    )}
                    <VideoPopoutButton onClick={(e) => openFloatingVideo(workIdx, sceneIdx, e)} />
                    <button
                      type="button"
                      className={`play-pause-button${isPlaying && workIdx === currentWorkIndex && sceneIdx === currentSceneIndex ? '' : ' play-glyph-button'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSceneClick(workIdx, sceneIdx);
                      }}
                      aria-label={isPlaying && workIdx === currentWorkIndex && sceneIdx === currentSceneIndex ? 'Pause' : 'Play'}
                    >
                      {isPlaying && workIdx === currentWorkIndex && sceneIdx === currentSceneIndex ? '⏸' : <PlayGlyph />}
                    </button>
                  </div>
                ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {floatingWindows.map((entry) => (
        <FloatingVideoWindow
          key={entry.id}
          src={entry.src}
          poster={entry.poster}
          crossOrigin={entry.crossOrigin}
          title={entry.title}
          initialTime={entry.initialTime}
          autoPlay={entry.autoPlay}
          defaultX={entry.defaultX}
          defaultY={entry.defaultY}
          zIndex={entry.zIndex}
          onClose={() => closeFloatingWindow(entry.id)}
          onFocus={() => focusFloatingWindow(entry.id)}
          onVideoError={handlePossibleCorsPlaybackError}
        />
      ))}

      {/* Credits Panel */}
      <CreditsPanel
        isVisible={creditsVisible && !isMobile}
        title={currentWork?.title || ''}
        credits={credits}
        synopsis={synopsis}
        videoRef={activeVideoRef}
        currentWorkIndex={currentWorkIndex}
        currentSceneIndex={currentSceneIndex}
      />
    </>
  );
}