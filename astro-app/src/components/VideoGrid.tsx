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
  // DEV logging: surface incoming props shape to help debug missing videos
  useEffect(() => {
    try {
      const sample = Array.isArray(works) && works.length > 0 ? works[0] : null;
      // eslint-disable-next-line no-console
      console.debug('[VideoGrid] mounted - works.length=', Array.isArray(works) ? works.length : typeof works, 'sample=', sample);
      if ((import.meta as any).env?.DEV) {
        // Show a small overlay with counts for quick visual feedback
        try {
          renderDebugOverlay(`VideoGrid\nworks: ${Array.isArray(works) ? works.length : 'n/a'}\nscenes(sample): ${sample?.scenes?.length ?? 'n/a'}`);
        } catch {}
      }
    } catch (e) { /* swallow logging errors */ }
  }, [works]);

  /**
   * Normalize proxied URLs: older cache values used `/api/proxy?url=ENCODED` which
   * our dev server wasn't reliably receiving. Convert to a path-based base64 URL
   * using a URL-safe base64 (replace +/ with -_ and drop padding). This avoids
   * issues with slashes and query-string stripping.
   */
  function normalizeProxiedUrl(url?: string | null) {
    if (!url) return undefined;
    try {
      // already path-based
      if (url.startsWith('/api/proxy/')) return url;
      const q = url.split('?url=');
      if (q.length === 2) {
        const decoded = decodeURIComponent(q[1]);
        // btoa is safe here because the target is ASCII URL
        const rawB64 = (typeof window !== 'undefined' && (window as any).btoa) ? (window as any).btoa(decoded) : Buffer.from(decoded, 'utf8').toString('base64');
        const safe = rawB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return `/api/proxy/${safe}`;
      }
      return url;
    } catch (e) {
      return url;
    }
  }

  // DEV-only registration of proxied URLs to avoid relying on query-string behavior
  const DEV_ALLOWED_HOSTS = [
    'github.com',
    'release-assets.githubusercontent.com',
    'github-production-release-asset-2e65be.s3.amazonaws.com',
    'github-production-release-asset-*.s3.amazonaws.com'
  ];

  const [registeredIds, setRegisteredIds] = React.useState<Record<string,string>>({});
  const registeredRef = React.useRef<Record<string,string>>({});

  function hostIsAllowedForDev(url?: string) {
    if (!url) return false;
    try {
      const u = new URL(url);
      return DEV_ALLOWED_HOSTS.some(h => h.includes('*') ? u.hostname.startsWith(h.split('*')[0]) : u.hostname === h);
    } catch { return false; }
  }

  useEffect(() => {
    if (!(import.meta as any).env?.DEV) return;
    // register all dev-eligible video urls once
    const toRegister = new Set<string>();
    works.forEach(w => w.scenes?.forEach(s => {
      const url = s.videoUrl;
      if (hostIsAllowedForDev(url)) toRegister.add(url);
    }));

    toRegister.forEach(url => {
      if (registeredRef.current[url]) return; // already registered
      // POST /api/proxy/register to get an id
      (async () => {
        try {
          const res = await fetch('/api/proxy/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
          if (!res.ok) {
            console.debug('[VideoGrid] register failed', { url, status: res.status });
            return;
          }
          const j = await res.json();
          if (j?.id) {
            registeredRef.current[url] = j.id;
            setRegisteredIds(prev => ({ ...prev, [url]: j.id }));
            console.debug('[VideoGrid] registered proxied id', { url, id: j.id });
          }
        } catch (e) {
          console.warn('[VideoGrid] register error', e);
        }
      })();
    });
  }, [works]);

  function servedUrlForScene(scene: Scene) {
    if ((import.meta as any).env?.DEV) {
      const id = registeredIds[scene.videoUrl];
      if (id) return `/api/proxy/serve?id=${encodeURIComponent(id)}`;
    }
    return normalizeProxiedUrl(scene.proxiedVideoUrl ?? scene.videoUrl) ?? undefined;
  }

  const [currentWorkIndex, setCurrentWorkIndex] = useState(0);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hoveredScene, setHoveredScene] = useState<{ workIndex: number; sceneIndex: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const mobileFixedVideoRef = useRef<HTMLVideoElement | null>(null);
  const [showSceneArrows, setShowSceneArrows] = useState(false);
  const arrowsTimerRef = useRef<number | null>(null);
  // Debug: count of video failures observed at runtime
  const [videoFailures, setVideoFailures] = useState(0);

  // Parse credits from current work
  const currentWork = works[currentWorkIndex];
  const credits = currentWork?.credits || [];

  // Credits visibility - only show when playing
  const creditsVisible = isPlaying;

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

  // Attach runtime listeners to all video elements for debug (loadedmetadata, error, play rejection)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let failures = 0;
    const listeners: Array<() => void> = [];

    const attach = (video: HTMLVideoElement) => {
      try {
        // log creation
        // eslint-disable-next-line no-console
        console.debug('[VideoGrid] video element created', { src: video.currentSrc || video.src, poster: video.getAttribute('poster') });

        const onLoaded = () => {
          // Detect audio availability where possible
          const hasAudio = (video as any).mozHasAudio === true || (video as any).webkitAudioDecodedByteCount > 0 || (video as any).audioTracks?.length > 0 || (video as any).captureStream ? true : undefined;
          // eslint-disable-next-line no-console
          console.debug('[VideoGrid] loadedmetadata', { src: video.currentSrc || video.src, duration: video.duration, videoWidth: video.videoWidth, videoHeight: video.videoHeight, muted: video.muted, volume: video.volume, defaultMuted: (video as any).defaultMuted, hasAudio, audioTracks: (video as any).audioTracks });
        };
        video.addEventListener('loadedmetadata', onLoaded);
        listeners.push(() => video.removeEventListener('loadedmetadata', onLoaded));

        const onError = (ev: any) => {
          failures++;
          setVideoFailures((v) => v + 1);
          // eslint-disable-next-line no-console
          console.error('[VideoGrid] video error', { src: video.currentSrc || video.src, code: ev?.target?.error?.code, message: ev?.target?.error?.message });
        };
        video.addEventListener('error', onError);
        listeners.push(() => video.removeEventListener('error', onError));

        // Poster fallback: try to load poster, if it fails try local candidate names
        const poster = video.getAttribute('poster');
        if (poster) {
          try {
            const img = new Image();
            let triedFallback = false;
            img.onload = () => {
              // works
            };
            img.onerror = () => {
              // Try some local candidates derived from poster filename or video filename
              if (triedFallback) return;
              triedFallback = true;
              const tryCandidates = (cands: string[]) => {
                for (const c of cands) {
                  const p = `/assets/images/thumbnails/${c}`;
                  const im = new Image();
                  im.onload = () => {
                    video.setAttribute('poster', p);
                  };
                  im.onerror = () => {};
                  im.src = p;
                }
              };

              const base = (poster.split('/').pop() || '').split('#')[0].split('?')[0];
              const nameNoExt = base.replace(/\.[^.]+$/, '');
              const candidates = [
                `${nameNoExt}.jpg`,
                `${nameNoExt.replace(/\./g, ' ')}.jpg`,
                `${nameNoExt.normalize('NFD').replace(/\p{Diacritic}/gu, '')}.jpg`
              ];
              tryCandidates(candidates);

              // finally try deriving from video src
              const vbase = (video.src || '').split('/').pop() || '';
              const vNoExt = vbase.replace(/\.[^.]+$/, '');
              tryCandidates([`${vNoExt.replace(/\./g,' ')}.jpg`, `${vNoExt}.jpg`]);
            };
            img.src = poster;
          } catch {}
        }

        // Wrap play() to log rejection
        const origPlay = video.play;
        // @ts-ignore - override for instrumentation
        video.play = function () {
          // @ts-ignore
          return origPlay.apply(this).catch((err: any) => {
            failures++;
            setVideoFailures((v) => v + 1);
            // eslint-disable-next-line no-console
            console.error('[VideoGrid] play() rejected', { src: video.currentSrc || video.src, err });
            throw err;
          });
        };
        // restore function on cleanup
        listeners.push(() => { try { video.play = origPlay; } catch {} });
      } catch (e) {
        // ignore
      }
    };

    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('.scene-item video, .mobile-item video, video[ref]'));
    videos.forEach(attach);

    // Also observe future additions (islands hydrate after SSR)
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof HTMLElement) {
            const newVideos = Array.from(node.querySelectorAll ? node.querySelectorAll('video') : []);
            newVideos.forEach(attach);
            if (node.tagName === 'VIDEO') attach(node as HTMLVideoElement);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    listeners.push(() => mo.disconnect());

    return () => listeners.forEach((fn) => { try { fn(); } catch {} });
  }, [works, currentWorkIndex, currentSceneIndex, isMobile]);

  // Pause all videos except the specified one
  const pauseAllVideosExcept = useCallback((workIdx: number | null, sceneIdx: number | null) => {
    const allVideos = document.querySelectorAll('.scene-item video');
    allVideos.forEach((video) => {
      const videoEl = video as HTMLVideoElement;
      const item = videoEl.closest('.scene-item');
      const videoWorkIndex = parseInt(item?.getAttribute('data-work-index') || '-1');
      const videoSceneIndex = parseInt(item?.getAttribute('data-scene-index') || '-1');
      
      if (workIdx === null || sceneIdx === null || videoWorkIndex !== workIdx || videoSceneIndex !== sceneIdx) {
        if (!videoEl.paused) {
          videoEl.pause();
        }
      }
    });
  }, []);

  // Play the specified video
  const playVideo = useCallback(async (workIdx: number, sceneIdx: number) => {
    const selector = `[data-work-index="${workIdx}"][data-scene-index="${sceneIdx}"] video`;
    const videoElement = document.querySelector(selector) as HTMLVideoElement;
    
    if (videoElement) {
      try {
        // Ensure audio is enabled when user requests playback
        try { videoElement.muted = false; videoElement.volume = 1.0; } catch {}
        // eslint-disable-next-line no-console
        console.debug('[VideoGrid] attempting to play', { src: videoElement.currentSrc || videoElement.src, muted: videoElement.muted, volume: videoElement.volume });
        videoElement.currentTime = 0;
        await videoElement.play();
        activeVideoRef.current = videoElement;
        // Log success and audio state
        // eslint-disable-next-line no-console
        console.debug('[VideoGrid] play succeeded', { src: videoElement.currentSrc || videoElement.src, muted: videoElement.muted, volume: videoElement.volume, audioTracks: (videoElement as any).audioTracks?.length });
        const onPlaying = () => {
          // eslint-disable-next-line no-console
          console.debug('[VideoGrid] playing event', { src: videoElement.currentSrc || videoElement.src, muted: videoElement.muted, volume: videoElement.volume });
          videoElement.removeEventListener('playing', onPlaying);
        };
        videoElement.addEventListener('playing', onPlaying);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[VideoGrid] Error playing video:', error);
      }
    }
  }, []);

  // Handle scene click
  const handleSceneClick = useCallback((workIdx: number, sceneIdx: number) => {
    pauseAllVideosExcept(null, null);
    
    const sameWork = workIdx === currentWorkIndex;
    const sameScene = sceneIdx === currentSceneIndex;
    
    if (sameWork && sameScene) {
      // Toggle play/pause for current scene
      setIsPlaying(prev => !prev);
    } else {
      // Change scene and start playing
      setCurrentWorkIndex(workIdx);
      setCurrentSceneIndex(sceneIdx);
      setIsPlaying(true);
      
      // Scroll scene into view
      setTimeout(() => {
        const sceneElement = document.querySelector(`[data-work-index="${workIdx}"][data-scene-index="${sceneIdx}"]`);
        sceneElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }, 50);
    }
  }, [currentWorkIndex, currentSceneIndex, pauseAllVideosExcept]);

  // Handle play/pause state
  useEffect(() => {
    if (isPlaying) {
      pauseAllVideosExcept(currentWorkIndex, currentSceneIndex);
      setTimeout(() => {
        playVideo(currentWorkIndex, currentSceneIndex);
      }, 100);
    } else {
      pauseAllVideosExcept(null, null);
    }
  }, [isPlaying, currentWorkIndex, currentSceneIndex, pauseAllVideosExcept, playVideo]);

  useEffect(() => {
    if (!isMobile || !mobileFixedVideoRef.current) return;
    const video = mobileFixedVideoRef.current;
    if (!isPlaying) {
      video.pause();
      return;
    }
    const play = () => {
      video.muted = false;
      video.volume = 1.0;
      video.play().catch(() => {});
    };
    if (video.readyState >= 2) {
      play();
    } else {
      const handleCanPlay = () => {
        play();
        video.removeEventListener('canplay', handleCanPlay);
      };
      video.addEventListener('canplay', handleCanPlay);
    }
  }, [isMobile, isPlaying, currentWorkIndex, currentSceneIndex]);

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
      <>
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
                  const next = (currentSceneIndex + 1) % total;
                  setCurrentSceneIndex(next);
                  setIsPlaying(true);
                }}
              >
                {'>'}
              </button>

              {/* Video element */}
              <video
                key={`player-${currentWorkIndex}-${currentSceneIndex}`}
                ref={mobileFixedVideoRef}
                src={works[currentWorkIndex]?.scenes?.[currentSceneIndex]?.videoUrl}
                poster={works[currentWorkIndex]?.scenes?.[currentSceneIndex]?.thumbnail}
                loop
                crossOrigin="anonymous"
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
                    vid.play().catch(() => {});
                  } else {
                    vid.pause();
                  }
                }}
              />
            </div>

            {/* Project navigation - always visible when modal is open */}
            <div className="project-nav-controls">
              <button
                className="project-nav-btn prev"
                aria-label="Previous project"
                onClick={() => {
                  const totalWorks = works.length;
                  if (!totalWorks) return;
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
          </>
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
                          src={servedUrlForScene(firstScene)}
                          poster={firstScene.thumbnail}
                          crossOrigin="anonymous"
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
      {/* Debug badge (DEV only) */}
      {(import.meta as any).env?.DEV && (
        <div style={{position:'fixed',left:8,bottom:8,zIndex:999999,background:'rgba(0,0,0,0.75)',color:'#fff',padding:'6px 8px',borderRadius:6,fontSize:12}}>
          <div>videos: {Array.isArray(works) ? works.reduce((s,w)=>s+(w.scenes?.length||0),0) : 'n/a'}</div>
          <div>failures: {videoFailures}</div>
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
                      src={servedUrlForScene(scene)}
                      poster={scene.thumbnail}
                      crossOrigin="anonymous"
                      playsInline
                      preload={workIdx === currentWorkIndex ? 'metadata' : 'none'}
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

      {/* Debug badge (DEV only) */}
      {(import.meta as any).env?.DEV && (
        <div style={{position:'fixed',left:8,bottom:8,right:8,zIndex:999999,display:'flex',gap:12,justifyContent:'flex-end'}}>
          <div style={{background:'rgba(0,0,0,0.75)',color:'#fff',padding:'6px 8px',borderRadius:6,fontSize:12}}>
            <div>videos: {Array.isArray(works) ? works.reduce((s,w)=>s+(w.scenes?.length||0),0) : 'n/a'}</div>
            <div>failures: {videoFailures}</div>
          </div>
        </div>
      )}

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