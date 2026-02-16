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
  const [isMobile, setIsMobile] = useState(false);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const mobileFixedVideoRef = useRef<HTMLVideoElement | null>(null);
  const [showSceneArrows, setShowSceneArrows] = useState(false);
  const arrowsTimerRef = useRef<number | null>(null);

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
  const playVideo = useCallback(async (workIdx: number, sceneIdx: number, fromUserGesture = false) => {
    const selector = `[data-work-index="${workIdx}"][data-scene-index="${sceneIdx}"] video`;
    const videoElement = document.querySelector(selector) as HTMLVideoElement;
    
    if (videoElement) {
      // Restore src if it was removed by lazy loading or buffer cleanup
      if (!videoElement.hasAttribute('src') || !videoElement.src || videoElement.src === window.location.href) {
        const scene = works[workIdx]?.scenes?.[sceneIdx];
        if (scene) {
          videoElement.src = scene.proxiedVideoUrl ?? scene.videoUrl;
        }
      }

      // If already playing the same video (from useEffect after handleSceneClick), just ensure unmuted
      if (!videoElement.paused && activeVideoRef.current === videoElement) {
        videoElement.muted = false;
        videoElement.volume = 1.0;
        return;
      }

      // Boost preload for the selected video so it buffers faster
      videoElement.preload = 'auto';

      const doPlay = async () => {
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
            // Only unmute from user gesture context (otherwise browser blocks it)
            if (fromUserGesture) {
              videoElement.muted = false;
              videoElement.volume = 1.0;
            }
          } catch (e2) {
            console.error('Error playing video (muted fallback):', e2);
          }
        }
      };

      // If the video has enough data buffered, play immediately
      if (videoElement.readyState >= 3) { // HAVE_FUTURE_DATA
        await doPlay();
      } else {
        // Wait for enough data to start playing smoothly
        const handleCanPlay = () => {
          videoElement.removeEventListener('canplay', handleCanPlay);
          doPlay();
        };
        videoElement.addEventListener('canplay', handleCanPlay);
        // Load the video if it hasn't started loading
        videoElement.load();
      }
    }
  }, [works]);

  // Handle scene click
  const handleSceneClick = useCallback((workIdx: number, sceneIdx: number) => {
    pauseAllVideosExcept(null, null);
    
    const sameWork = workIdx === currentWorkIndex;
    const sameScene = sceneIdx === currentSceneIndex;
    
    if (sameWork && sameScene) {
      // Toggle play/pause for current scene
      const wasPlaying = isPlaying;
      setIsPlaying(prev => !prev);
      // If resuming, play immediately within user gesture context
      if (!wasPlaying) {
        playVideo(workIdx, sceneIdx, true);
      }
    } else {
      // Change scene and start playing
      setCurrentWorkIndex(workIdx);
      setCurrentSceneIndex(sceneIdx);
      setIsPlaying(true);
      
      // Play immediately within user gesture context (don't defer to useEffect with setTimeout)
      playVideo(workIdx, sceneIdx, true);
      
      // Scroll scene into view
      setTimeout(() => {
        const sceneElement = document.querySelector(`[data-work-index="${workIdx}"][data-scene-index="${sceneIdx}"]`);
        sceneElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }, 50);
    }
  }, [currentWorkIndex, currentSceneIndex, isPlaying, pauseAllVideosExcept, playVideo]);

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

  // Lightweight prefetch: fetch first ~512KB of next scene into browser cache
  // Much lighter than setting preload='auto' on adjacent video elements
  useEffect(() => {
    if (!isPlaying) return;
    const work = works[currentWorkIndex];
    if (!work) return;

    const nextIdx = currentSceneIndex + 1;
    if (nextIdx >= work.scenes.length) return;

    const nextScene = work.scenes[nextIdx];
    const nextUrl = nextScene?.proxiedVideoUrl ?? nextScene?.videoUrl;
    if (!nextUrl) return;

    // Fetch first 512KB with Range header to warm browser cache
    const controller = new AbortController();
    fetch(nextUrl, {
      headers: { Range: 'bytes=0-524287' },
      signal: controller.signal,
    }).catch(() => {}); // Ignore errors — this is best-effort

    return () => controller.abort();
  }, [isPlaying, currentWorkIndex, currentSceneIndex, works]);

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
                src={works[currentWorkIndex]?.scenes?.[currentSceneIndex]?.proxiedVideoUrl ?? works[currentWorkIndex]?.scenes?.[currentSceneIndex]?.videoUrl}
                poster={works[currentWorkIndex]?.scenes?.[currentSceneIndex]?.thumbnail}
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
                          poster={firstScene.thumbnail}
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
                        Math.abs(workIdx - currentWorkIndex) <= 1
                          ? (scene.proxiedVideoUrl ?? scene.videoUrl)
                          : undefined
                      }
                      poster={scene.thumbnail}
                      playsInline
                      preload={
                        workIdx === currentWorkIndex && sceneIdx === currentSceneIndex ? 'auto' :
                        workIdx === currentWorkIndex && Math.abs(sceneIdx - currentSceneIndex) <= 1 ? 'metadata' :
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