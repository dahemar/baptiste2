import React, { useState, useRef, useEffect, useCallback } from 'react';
import VideoPlayer from './VideoPlayer';
import CreditsPanel from './CreditsPanel';
import VUMeter from './VUMeter';

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

interface VideoGridProps {
  works: Work[];
}

/**
 * VideoGrid Component - Horizontal scrolling video grid
 * Migrated from React SceneGrid with core functionality
 */
export default function VideoGrid({ works }: VideoGridProps) {
  const [currentWorkIndex, setCurrentWorkIndex] = useState(0);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredScene, setHoveredScene] = useState<{ workIndex: number; sceneIndex: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const mobileFixedVideoRef = useRef<HTMLVideoElement | null>(null);
  const [showSceneArrows, setShowSceneArrows] = useState(false);
  const [generatedThumbnails, setGeneratedThumbnails] = useState<Record<string, string>>({});
  const generatedThumbsRef = useRef<Record<string, string>>({});
  const failedThumbsRef = useRef<Set<string>>(new Set());
  const arrowsTimerRef = useRef<number | null>(null);
  // Generation counter to cancel stale playVideo operations
  const playGenRef = useRef(0);
  // Track pending canplay listener so we can cancel it
  const pendingCanPlayRef = useRef<{ el: HTMLVideoElement; handler: () => void; timeout: number } | null>(null);

  // Parse credits from current work
  const currentWork = works[currentWorkIndex];
  const credits = currentWork?.credits || [];

  // Credits visibility - only show when playing
  const creditsVisible = isPlaying;

  const sceneThumbKey = useCallback((workIdx: number, sceneIdx: number) => `${workIdx}:${sceneIdx}`, []);

  const deriveLocalPosterFromVideo = useCallback((videoUrl?: string) => {
    const raw = String(videoUrl || '').trim();
    if (!raw) return undefined;
    try {
      const parsed = raw.startsWith('http') ? new URL(raw) : new URL(raw, window.location.origin);
      const fileName = decodeURIComponent(parsed.pathname.split('/').pop() || '');
      const base = fileName.replace(/\.[^.]+$/, '');
      if (!base) return undefined;
      const normalized = base.replace(/\./g, ' ').trim();
      if (!normalized) return undefined;
      return `/assets/images/thumbnails/${normalized}.jpg`;
    } catch {
      return undefined;
    }
  }, []);

  const resolveScenePoster = useCallback((workIdx: number, sceneIdx: number, scene?: Scene | null) => {
    const key = sceneThumbKey(workIdx, sceneIdx);
    if (scene?.thumbnail) return scene.thumbnail;
    const generated = generatedThumbnails[key];
    if (generated) return generated;
    const videoUrl = scene?.proxiedVideoUrl ?? scene?.videoUrl;
    return deriveLocalPosterFromVideo(videoUrl);
  }, [generatedThumbnails, deriveLocalPosterFromVideo, sceneThumbKey]);

  useEffect(() => {
    generatedThumbsRef.current = generatedThumbnails;
  }, [generatedThumbnails]);

  useEffect(() => {
    // Skip expensive thumbnail extraction on mobile — server-derived posters are enough
    if (isMobile) return;

    let cancelled = false;
    const activeExtractions = new Set<string>();

    const hasUsefulPixels = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const sampleW = Math.max(8, Math.floor(width / 12));
      const sampleH = Math.max(8, Math.floor(height / 12));
      const x = Math.max(0, Math.floor((width - sampleW) / 2));
      const y = Math.max(0, Math.floor((height - sampleH) / 2));
      const data = ctx.getImageData(x, y, sampleW, sampleH).data;
      let luminanceTotal = 0;
      let nonTransparent = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 8) continue;
        nonTransparent++;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        luminanceTotal += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      if (nonTransparent === 0) return false;
      const avgLum = luminanceTotal / nonTransparent;
      return avgLum > 14;
    };

    const seekTo = (video: HTMLVideoElement, time: number) =>
      new Promise<void>((resolve, reject) => {
        const onSeeked = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('seek failed'));
        };
        const cleanup = () => {
          video.removeEventListener('seeked', onSeeked);
          video.removeEventListener('error', onError);
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onError, { once: true });
        try {
          video.currentTime = time;
        } catch {
          cleanup();
          reject(new Error('invalid seek time'));
        }
      });

    const extractFrame = async (videoUrl: string): Promise<string | null> => {
      return await new Promise((resolve) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;

        const cleanup = () => {
          video.pause();
          video.removeAttribute('src');
          video.load();
        };

        const fail = () => {
          cleanup();
          resolve(null);
        };

        const timeout = window.setTimeout(fail, 12000);

        video.addEventListener('loadedmetadata', async () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 1280;
            canvas.height = video.videoHeight || 720;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              clearTimeout(timeout);
              fail();
              return;
            }

            const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 4;
            const probes = [0.12, 0.6, 1.25, 2.0]
              .map((t) => Math.min(Math.max(0.01, t), Math.max(0.01, duration - 0.08)));

            for (const probeTime of probes) {
              try {
                await seekTo(video, probeTime);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                if (!hasUsefulPixels(ctx, canvas.width, canvas.height)) continue;
                const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                clearTimeout(timeout);
                cleanup();
                resolve(dataUrl);
                return;
              } catch {
                // try next probe time
              }
            }

            clearTimeout(timeout);
            fail();
          } catch {
            clearTimeout(timeout);
            fail();
          }
        }, { once: true });

        video.addEventListener('error', () => {
          clearTimeout(timeout);
          fail();
        }, { once: true });

        video.src = videoUrl;
        video.load();
      });
    };

    const run = async () => {
      const tasks: Array<{ key: string; url: string }> = [];

      const pushTask = (workIdx: number, sceneIdx: number) => {
        const scene = works[workIdx]?.scenes?.[sceneIdx];
        if (!scene) return;
        if (scene.thumbnail) return;
        const key = sceneThumbKey(workIdx, sceneIdx);
        if (generatedThumbsRef.current[key]) return;
        if (failedThumbsRef.current.has(key)) return;
        if (activeExtractions.has(key)) return;
        if (tasks.some((t) => t.key === key)) return;
        const url = scene.proxiedVideoUrl ?? scene.videoUrl;
        if (!url) return;
        tasks.push({ key, url });
      };

      // Prioridad: escena activa y primer video de cada obra (previews iniciales inmediatos)
      pushTask(currentWorkIndex, currentSceneIndex);
      works.forEach((_, workIdx) => pushTask(workIdx, 0));

      works.forEach((work, workIdx) => {
        (work.scenes || []).forEach((scene, sceneIdx) => {
          pushTask(workIdx, sceneIdx);
        });
      });

      const concurrency = 4;
      let cursor = 0;
      const workers = new Array(concurrency).fill(0).map(async () => {
        while (!cancelled) {
          const task = tasks[cursor++];
          if (!task) break;
          activeExtractions.add(task.key);
          const dataUrl = await extractFrame(task.url);
          activeExtractions.delete(task.key);
          if (cancelled) return;
          if (dataUrl) {
            setGeneratedThumbnails((prev) => {
              if (prev[task.key]) return prev;
              return { ...prev, [task.key]: dataUrl };
            });
          } else {
            failedThumbsRef.current.add(task.key);
          }
        }
      });

      await Promise.all(workers);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [works, sceneThumbKey, currentWorkIndex, currentSceneIndex, isMobile]);

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

  // Hard-stop all videos except the specified one: pause + reset to beginning
  const stopAllVideosExcept = useCallback((workIdx: number | null, sceneIdx: number | null) => {
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
          // Reset only videos that were actively playing.
          // Keeping buffered paused videos avoids startup rebuffer stalls.
          videoEl.currentTime = 0;
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
          mobileVideo.currentTime = 0;
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
      video.pause();
      video.muted = true;
      video.removeAttribute('src');
      video.load(); // release buffers & show poster
    } catch {}
  }, []);

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

    // Restore src if it was removed by lazy loading
    let needsLoad = false;
    if (!videoElement.hasAttribute('src') || !videoElement.src || videoElement.src === window.location.href) {
      const scene = works[workIdx]?.scenes?.[sceneIdx];
      if (scene) {
        videoElement.src = scene.proxiedVideoUrl ?? scene.videoUrl;
        needsLoad = true;
      }
    }

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
        activeVideoRef.current = videoElement;
      } catch (error) {
        console.error('Error playing video:', error);
        // If unmuted play fails due to autoplay policy, try muted first
        try {
          videoElement.muted = true;
          await videoElement.play();
          activeVideoRef.current = videoElement;
          if (fromUserGesture) {
            // Unmute and restart playback to enable audio
            videoElement.muted = false;
            videoElement.volume = 1.0;
            // Call play again to apply the unmuted state
            await videoElement.play();
          }
        } catch (e2) {
          console.error('Error playing video (muted fallback):', e2);
        }
      }
    };

    // If this call comes from a direct user gesture (click/tap), attempt play immediately
    // to preserve gesture context and allow unmuted playback in browsers with autoplay rules.
    if (fromUserGesture) {
      if (needsLoad) {
        videoElement.load();
      }
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
      
      // Safety timeout: force play after 3s even if canplay hasn't fired
      const timeoutId = window.setTimeout(() => {
        videoElement.removeEventListener('canplay', handleCanPlay);
        if (pendingCanPlayRef.current?.el === videoElement) {
          pendingCanPlayRef.current = null;
        }
        console.warn('[VideoGrid] canplay timeout, forcing play');
        doPlay();
      }, 3000);
      
      pendingCanPlayRef.current = { el: videoElement, handler: handleCanPlay, timeout: timeoutId };
      
      // Kick the browser to start loading (needed for preload="none" videos)
      videoElement.load();
    }
  }, [works, stopAllVideosExcept]);

  // Handle scene click — always restart from beginning, only one video at a time
  const handleSceneClick = useCallback((workIdx: number, sceneIdx: number) => {
    const sameWork = workIdx === currentWorkIndex;
    const sameScene = sceneIdx === currentSceneIndex;
    
    if (sameWork && sameScene && isPlaying) {
      // Clicking the currently playing video: pause it
      setIsPlaying(false);
      stopAllVideosExcept(null, null);
      return;
    }

    // Any other click: start playing from beginning
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
  }, [currentWorkIndex, currentSceneIndex, isPlaying, stopAllVideosExcept, playVideo]);

  // Handle play/pause state — only stop videos, never start a second play here
  // (playVideo is called directly from handleSceneClick within user gesture context)
  useEffect(() => {
    if (!isPlaying) {
      stopAllVideosExcept(null, null);
      // Nuclear safety net: force-pause every <video> on the page
      // to guarantee no orphan audio survives unmount / state changes.
      const allVideos = document.querySelectorAll('video') as NodeListOf<HTMLVideoElement>;
      allVideos.forEach((v) => {
        try {
          if (!v.paused) {
            v.pause();
            v.muted = true;
          }
        } catch {}
      });
    }
  }, [isPlaying, stopAllVideosExcept]);

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
  // On mobile only one video plays at a time so we can be more aggressive.
  useEffect(() => {
    if (!isPlaying) return;
    const work = works[currentWorkIndex];
    if (!work) return;

    const controller = new AbortController();
    const prefetchBytes = isMobile ? 786431 : 393215; // 768KB mobile, 384KB desktop
    const delay = isMobile ? 600 : 1800; // Mobile: less competing traffic

    const toFetch: string[] = [];

    // Next scene
    const nextIdx = currentSceneIndex + 1;
    if (nextIdx < work.scenes.length) {
      const nextUrl = work.scenes[nextIdx]?.proxiedVideoUrl ?? work.scenes[nextIdx]?.videoUrl;
      if (nextUrl) toFetch.push(nextUrl);
    }

    // Previous scene (mobile only — common swipe-back pattern)
    if (isMobile && currentSceneIndex > 0) {
      const prevUrl = work.scenes[currentSceneIndex - 1]?.proxiedVideoUrl ?? work.scenes[currentSceneIndex - 1]?.videoUrl;
      if (prevUrl) toFetch.push(prevUrl);
    }

    if (toFetch.length === 0) return;

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

    // Pause + clear old source before loading new one
    video.pause();
    if (poster) video.poster = poster;
    video.src = newSrc;
    video.currentTime = 0;
    video.preload = 'auto';
    video.load();

    let cancelled = false;

    const play = async () => {
      if (cancelled) return;
      try {
        video.muted = false;
        video.volume = 1.0;
        await video.play();
      } catch {
        // Autoplay policy fallback: play muted then unmute
        try {
          video.muted = true;
          await video.play();
          if (!cancelled) {
            video.muted = false;
            video.volume = 1.0;
            await video.play();
          }
        } catch (e2) {
          console.error('[mobile] play failed:', e2);
        }
      }
    };

    // Use 'loadeddata' — fires earlier than 'canplay' for faster start
    const handleReady = () => play();
    video.addEventListener('loadeddata', handleReady, { once: true });

    // Safety timeout: force play after 2s even if event hasn't fired
    const timer = setTimeout(() => {
      video.removeEventListener('loadeddata', handleReady);
      play();
    }, 2000);

    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', handleReady);
      clearTimeout(timer);
    };
  }, [isMobile, isPlaying, currentWorkIndex, currentSceneIndex, works, resolveScenePoster]);

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

  if (isMobile) {
    // Mobile: vertical list layout
    return (
      <div className="scene-grid mobile">
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
            {/* Back button - direct child of modal, always visible */}
            <button
              className="back-button"
              aria-label="Back"
              onClick={() => {
                forcePauseMobileVideo();
                setIsPlaying(false);
              }}
            >
              ⟵
            </button>

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
                style={{ width: '100%', height: '100%' }}
              >
                <video
                  ref={mobileFixedVideoRef}
                  poster={resolveScenePoster(currentWorkIndex, currentSceneIndex, works[currentWorkIndex]?.scenes?.[currentSceneIndex])}
                  loop
                  playsInline
                  preload="auto"
                  controls={false}
                  disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  onClick={(e) => {
                    e.stopPropagation();
                    showArrowsForAWhile();
                    const vid = e.currentTarget;
                    if (vid.paused) {
                      vid.muted = false;
                      vid.volume = 1.0;
                      vid.play().catch(() => {});
                    } else {
                      vid.pause();
                    }
                  }}
                />
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
                        <video
                          src={firstScene.proxiedVideoUrl ?? firstScene.videoUrl}
                          poster={resolveScenePoster(workIdx, 0, firstScene)}
                          playsInline
                          preload="metadata"
                          loop
                          muted
                        />
                      ) : (
                        <div className="project-placeholder">No scenes</div>
                      )}
                      <button
                        className="play-pause-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentWorkIndex(workIdx);
                          setCurrentSceneIndex(0);
                          setIsPlaying(true);
                          showArrowsForAWhile();
                        }}
                        aria-label={`Open project ${work.title}`}
                      >
                        ▶
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
      <div ref={containerRef} className="scene-grid">
        <div className="works-container">
          {works.map((work, workIdx) => (
            <div
              key={work.id}
              className={`work-row visible-work ${isPlaying && workIdx === currentWorkIndex ? 'active-work current-work playing' : ''} ${isPlaying && workIdx === currentWorkIndex + 1 ? 'next-work' : ''}`}
              data-work-index={workIdx}
            >
              {/* Flechas de navegación fuera del scenes-container para que no se desplacen */}
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
                    <video
                      src={
                        Math.abs(workIdx - currentWorkIndex) <= 1 || sceneIdx === 0
                          ? (scene.proxiedVideoUrl ?? scene.videoUrl)
                          : undefined
                      }
                      poster={resolveScenePoster(workIdx, sceneIdx, scene)}
                      playsInline
                      preload={
                        workIdx === currentWorkIndex && sceneIdx === currentSceneIndex ? 'auto' :
                        workIdx === currentWorkIndex && Math.abs(sceneIdx - currentSceneIndex) <= 1 ? 'auto' :
                        sceneIdx === 0 ? 'metadata' :
                        Math.abs(workIdx - currentWorkIndex) <= 1 ? 'metadata' :
                        'none'
                      }
                      loop
                    />
                    <button 
                      className="play-pause-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSceneClick(workIdx, sceneIdx);
                      }}
                      aria-label={isPlaying && workIdx === currentWorkIndex && sceneIdx === currentSceneIndex ? 'Pause' : 'Play'}
                    >
                      {isPlaying && workIdx === currentWorkIndex && sceneIdx === currentSceneIndex ? '⏸' : '▶'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Credits Panel */}
      <CreditsPanel
        isVisible={creditsVisible && !isMobile}
        title={currentWork?.title || ''}
        credits={credits}
      />

      {/* VU Meter - solo cuando se está reproduciendo */}
      {isPlaying && !isMobile && (
        <VUMeter
          videoRef={activeVideoRef}
          currentWorkIndex={currentWorkIndex}
          currentSceneIndex={currentSceneIndex}
        />
      )}
    </>
  );
}