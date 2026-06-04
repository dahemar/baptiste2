import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import './VUMeter.css';

// Global Web Audio API context
let GLOBAL_AUDIO_CONTEXT: AudioContext | null = null;
let GLOBAL_ANALYSER: AnalyserNode | null = null;
const CONNECTED_AUDIO_ELEMENTS = new WeakSet<HTMLMediaElement>();

// Initialize global context
const initGlobalAudioContext = () => {
  if (!GLOBAL_AUDIO_CONTEXT) {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      GLOBAL_AUDIO_CONTEXT = new AudioContextClass();
      GLOBAL_ANALYSER = GLOBAL_AUDIO_CONTEXT.createAnalyser();
      GLOBAL_ANALYSER.fftSize = 256;
      GLOBAL_ANALYSER.smoothingTimeConstant = 0.8;
      
      GLOBAL_ANALYSER.connect(GLOBAL_AUDIO_CONTEXT.destination);
      
      (window as any).GLOBAL_AUDIO_CONTEXT = GLOBAL_AUDIO_CONTEXT;
      (window as any).GLOBAL_ANALYSER = GLOBAL_ANALYSER;
    } catch (error) {
      console.error('Error initializing global AudioContext:', error);
    }
  }
  return { context: GLOBAL_AUDIO_CONTEXT, analyser: GLOBAL_ANALYSER };
};

// Check if a media element can safely be connected to Web Audio API.
// createMediaElementSource on a cross-origin video without crossOrigin attribute
// causes the browser to SILENTLY MUTE all audio output from that element.
const isSafeForWebAudio = (el: HTMLMediaElement): boolean => {
  // Same-origin or blob/data URLs are always safe
  const src = el.currentSrc || el.src || '';
  if (!src || src.startsWith('blob:') || src.startsWith('data:')) return true;

  try {
    const srcUrl = new URL(src, window.location.href);
    // Same origin — safe
    if (srcUrl.origin === window.location.origin) return true;
  } catch {
    return true; // relative URL or unparseable — treat as same-origin
  }

  // Cross-origin: needs explicit CORS mode (not merely a present attribute)
  return el.crossOrigin === 'anonymous' || el.crossOrigin === 'use-credentials';
};

/** Wire the playing <video> to the shared analyser (safe to call after each play). */
export function forceConnectVideoToVuMeter(video: HTMLVideoElement | null | undefined) {
  if (!video) return;
  if (!isSafeForWebAudio(video)) {
    CONNECTED_AUDIO_ELEMENTS.delete(video);
    return;
  }
  const mediaEl = video as HTMLMediaElement & {
    _webAudioSource?: MediaElementAudioSourceNode;
    _audioNode?: MediaElementAudioSourceNode;
  };
  if (mediaEl._webAudioSource || mediaEl._audioNode) {
    CONNECTED_AUDIO_ELEMENTS.add(video);
    return;
  }
  CONNECTED_AUDIO_ELEMENTS.delete(video);
  connectMediaToAnalyser(video);
}

// Connect audio/video element to global analyser
const connectMediaToAnalyser = (mediaElement: HTMLMediaElement | null) => {
  if (!mediaElement) return;
  
  if (CONNECTED_AUDIO_ELEMENTS.has(mediaElement)) return;

  // IMPORTANT: Do NOT call createMediaElementSource on cross-origin media without
  // crossOrigin attribute — doing so silences the element's audio output permanently.
  if (!isSafeForWebAudio(mediaElement)) {
    return;
  }

  const mediaEl = mediaElement as any;
  if (mediaEl._webAudioSource || mediaEl._audioNode) {
    CONNECTED_AUDIO_ELEMENTS.add(mediaElement);
    return;
  }

  const { context, analyser } = initGlobalAudioContext();
  if (!context || !analyser) return;

  try {
    if (context.state === 'suspended') {
      context.resume().catch(err => {
        console.error('Error resuming AudioContext:', err);
      });
    }
    
    const source = context.createMediaElementSource(mediaElement);
    source.connect(analyser);
    
    CONNECTED_AUDIO_ELEMENTS.add(mediaElement);
    mediaEl._webAudioSource = source;
    mediaEl._audioNode = source;
  } catch (error: any) {
    if (error.message && (error.message.includes('already connected') || error.message.includes('MediaElementSourceNode'))) {
      CONNECTED_AUDIO_ELEMENTS.add(mediaElement);
      return;
    }
    console.error('Error connecting media to analyser:', error);
  }
};

interface VUMeterProps {
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  currentWorkIndex: number;
  currentSceneIndex: number;
  inCreditsPanel?: boolean;
}

export default function VUMeter({ videoRef, currentWorkIndex, currentSceneIndex, inCreditsPanel = false }: VUMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);
  const lastActiveVideoRef = useRef<HTMLVideoElement | null>(null);

  const findPlayingVideo = () => {
    const videos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    return videos.find(video => !video.paused && !video.ended && video.currentTime > 0) || null;
  };

  const ensureConnectedToPlayingVideo = () => {
    const targetVideo = videoRef?.current ?? findPlayingVideo();
    if (!targetVideo || targetVideo.paused || targetVideo.ended) return;

    const mediaEl = targetVideo as HTMLMediaElement & {
      _webAudioSource?: MediaElementAudioSourceNode;
    };
    const alreadyWired = !!mediaEl._webAudioSource;

    if (targetVideo !== lastActiveVideoRef.current || !alreadyWired) {
      lastActiveVideoRef.current = targetVideo;
      forceConnectVideoToVuMeter(targetVideo);
    }
  };

  // Get audio data for visualizations
  const getAudioData = () => {
    if (!GLOBAL_ANALYSER) return { volume: 0, waveform: [] };

    try {
      const bufferLength = GLOBAL_ANALYSER.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      GLOBAL_ANALYSER.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const volume = Math.sqrt(sum / bufferLength) / 255 * 1.2;

      const waveformData = new Uint8Array(bufferLength);
      GLOBAL_ANALYSER.getByteTimeDomainData(waveformData);
      const waveform = Array.from(waveformData).map(value => (value - 128) / 128);

      return { volume, waveform };
    } catch (error) {
      return { volume: 0, waveform: [] };
    }
  };

  // Draw VU meter
  const drawVUMeter = (volume: number) => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    const barHeight = height * volume;
    const barY = height - barHeight;
    
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.9)');
    
    ctx.fillStyle = gradient;
    if (barHeight <= 1) {
      ctx.fillRect(0, height - 2, width, 2);
    } else {
      ctx.fillRect(0, barY, width, barHeight);
    }
  };

  // Draw waveform
  const drawWaveform = (waveform: number[]) => {
    if (!waveformRef.current) return;
    
    const canvas = waveformRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    
    if (!waveform.length) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    const sliceWidth = width / waveform.length;
    let x = 0;
    
    for (let i = 0; i < waveform.length; i++) {
      const v = waveform[i];
      const y = (v + 1) / 2 * height;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      
      x += sliceWidth;
    }
    
    ctx.stroke();
  };

  // Animation loop
  useEffect(() => {
    const animate = () => {
      if (!isMountedRef.current) return;

      ensureConnectedToPlayingVideo();
      
      const { volume, waveform } = getAudioData();
      drawVUMeter(volume);
      drawWaveform(waveform);
      
      intervalRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        cancelAnimationFrame(intervalRef.current);
      }
    };
  }, []);

  // Connect and reconnect video element to analyser when it changes
  useEffect(() => {
    lastActiveVideoRef.current = null;

    const getActiveVideo = () => {
      if (videoRef?.current) return videoRef.current;
      const selector = `[data-work-index="${currentWorkIndex}"][data-scene-index="${currentSceneIndex}"] video`;
      return document.querySelector(selector) as HTMLVideoElement | null;
    };

    const ensureAudioContext = () => {
      if (GLOBAL_AUDIO_CONTEXT && GLOBAL_AUDIO_CONTEXT.state === 'suspended') {
        GLOBAL_AUDIO_CONTEXT.resume().catch(err => {
          console.error('Error resuming AudioContext:', err);
        });
      }
    };

    const connectActiveVideo = () => {
      const activeVideo = getActiveVideo();
      if (!activeVideo) return;
      ensureAudioContext();
      forceConnectVideoToVuMeter(activeVideo);
    };

    const handlePlay = (event: Event) => {
      const target = event.target as HTMLVideoElement | null;
      if (target && target.tagName === 'VIDEO' && !target.closest('.floating-video-window')) {
        ensureAudioContext();
        forceConnectVideoToVuMeter(target);
      }
    };

    const activeVideo = getActiveVideo();
    const handleLoadedMetadata = () => connectActiveVideo();
    const handleCanPlay = () => connectActiveVideo();

    if (activeVideo) {
      activeVideo.addEventListener('loadedmetadata', handleLoadedMetadata);
      activeVideo.addEventListener('canplay', handleCanPlay);
    }

    document.addEventListener('play', handlePlay, true);

    if (activeVideo && activeVideo.readyState >= 1) {
      connectActiveVideo();
    }

    return () => {
      document.removeEventListener('play', handlePlay, true);
      if (activeVideo) {
        activeVideo.removeEventListener('loadedmetadata', handleLoadedMetadata);
        activeVideo.removeEventListener('canplay', handleCanPlay);
      }
    };
  }, [videoRef, currentWorkIndex, currentSceneIndex]);

  if (typeof document === 'undefined') return null;

  let containerStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: '2rem',
    right: '2rem',
    width: 'calc(20% - 4rem)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    zIndex: 99999,
    overflow: 'visible',
    pointerEvents: 'none',
  };

  if (inCreditsPanel) {
    // For in-panel mode we avoid absolute positioning to prevent clipping
    // inside the panel's scrolling area. Styles will be provided by
    // `.credits-vumeter` in CSS (sticky positioning).
    containerStyle = {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '10px',
      pointerEvents: 'none',
      width: '100%'
    } as React.CSSProperties;
  }

  const vuCanvasStyle: React.CSSProperties = {
    display: 'block',
    background: 'transparent',
    width: '30px',
    height: '100px',
    minWidth: '30px',
    minHeight: '100px',
  };

  const waveformCanvasStyle: React.CSSProperties = {
    display: 'block',
    background: 'transparent',
    width: '150px',
    height: '80px',
    minWidth: '150px',
    minHeight: '80px',
    flexShrink: 0,
  };

  const meterNode = (
    <div className={`vumeter-container ${inCreditsPanel ? 'in-credits-panel' : ''}`} style={containerStyle}>
      <canvas ref={canvasRef} className="vumeter-canvas" width="30" height="100" style={vuCanvasStyle} />
      <canvas ref={waveformRef} className="waveform-canvas" width="150" height="80" style={waveformCanvasStyle} />
    </div>
  );

  if (inCreditsPanel) {
    // render inline inside credits panel
    return (
      <div className="credits-vumeter" style={containerStyle}>
        {meterNode}
      </div>
    );
  }

  return ReactDOM.createPortal(meterNode, document.body);
}
