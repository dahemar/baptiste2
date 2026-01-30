import React, { useRef, useEffect, useState } from 'react';
import { initializeHLS, destroyHLS } from '../utils/hlsManager';
import { destroyVideoResources } from '../utils/videoResourceManager';
import logger from '../utils/logger';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  workId: string;
  sceneId?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  autoInitialize?: boolean;
  className?: string;
}

/**
 * VideoPlayer Component - Optimized for Astro Islands
 * 
 * Features:
 * - Lazy HLS initialization (only when needed)
 * - preload="none" by default (no automatic loading)
 * - Resource cleanup on unmount
 * - Position retention when paused
 * - Native controls
 */
export default function VideoPlayer({
  src,
  poster,
  workId,
  sceneId = '0',
  onPlay,
  onPause,
  onEnded,
  autoInitialize = false,
  className = ''
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedTimeRef = useRef<number>(0);

  // Initialize HLS when needed (on first user interaction or autoInitialize)
  const initializeVideo = async () => {
    if (!videoRef.current || isInitialized || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      // Check if it's an HLS source
      const isHLS = src.endsWith('.m3u8');
      
      if (isHLS) {
        const success = await initializeHLS(videoRef.current, src);
        if (!success) {
          setError('HLS playback not supported');
          logger.error(`❌ Failed to initialize HLS for ${workId}-${sceneId}`);
        } else {
          setIsInitialized(true);
          logger.debug(`✅ HLS initialized for ${workId}-${sceneId}`);
        }
      } else {
        // For non-HLS videos, just set the src
        videoRef.current.src = src;
        setIsInitialized(true);
        logger.debug(`✅ Video initialized (non-HLS) for ${workId}-${sceneId}`);
      }
    } catch (err) {
      setError('Failed to initialize video');
      logger.error(`❌ Error initializing video ${workId}-${sceneId}:`, err);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle play event
  const handlePlay = () => {
    if (!isInitialized && !isLoading) {
      initializeVideo();
    }
    onPlay?.();
  };

  // Handle pause event - save position
  const handlePause = () => {
    if (videoRef.current) {
      savedTimeRef.current = videoRef.current.currentTime;
      logger.debug(`⏸️ Video paused at ${savedTimeRef.current}s for ${workId}-${sceneId}`);
    }
    onPause?.();
  };

  // Handle ended event
  const handleEnded = () => {
    savedTimeRef.current = 0;
    onEnded?.();
  };

  // Handle loadedmetadata - restore saved position
  const handleLoadedMetadata = () => {
    if (videoRef.current && savedTimeRef.current > 0) {
      videoRef.current.currentTime = savedTimeRef.current;
      logger.debug(`↻ Restored position to ${savedTimeRef.current}s for ${workId}-${sceneId}`);
    }
  };

  // Auto-initialize if requested (e.g., for visible videos)
  useEffect(() => {
    if (autoInitialize && !isInitialized && !isLoading) {
      initializeVideo();
    }
  }, [autoInitialize]);

  // Cleanup on unmount
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video) {
        destroyVideoResources(video, `${workId}-${sceneId}`);
      }
    };
  }, [workId, sceneId]);

  return (
    <div className={`video-player-wrapper ${className}`} data-work-id={workId} data-scene-id={sceneId}>
      <video
        ref={videoRef}
        className="video-player"
        preload="none"
        controls
        crossOrigin="anonymous"
        playsInline
        webkit-playsinline="true"
        poster={poster}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
        data-work-id={workId}
        data-scene-id={sceneId}
      />
      
      {isLoading && (
        <div className="video-loading">
          <span>Cargando video...</span>
        </div>
      )}
      
      {error && (
        <div className="video-error">
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
