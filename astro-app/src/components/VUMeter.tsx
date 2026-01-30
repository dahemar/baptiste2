import React, { useEffect, useRef } from 'react';
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
      // eslint-disable-next-line no-console
      console.debug('[VUMeter] AudioContext initialized', { state: GLOBAL_AUDIO_CONTEXT.state });
    } catch (error) {
      console.error('Error initializing global AudioContext:', error);
    }
  }
  return { context: GLOBAL_AUDIO_CONTEXT, analyser: GLOBAL_ANALYSER };
};

// Connect audio/video element to global analyser
const connectMediaToAnalyser = (mediaElement: HTMLMediaElement | null) => {
  if (!mediaElement) return;
  
  if (CONNECTED_AUDIO_ELEMENTS.has(mediaElement)) return;

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

    // Diagnostic: log crossOrigin + origin check to detect possible CORS restrictions
    try {
      const src = (mediaElement.currentSrc || mediaElement.src) || '';
      let originDifferent = false;
      try { originDifferent = new URL(src).origin !== location.origin; } catch {}
      // eslint-disable-next-line no-console
      console.debug('[VUMeter] connecting media', { src, crossOrigin: mediaElement.crossOrigin, originDifferent });
      if (originDifferent && !mediaElement.crossOrigin) {
        // eslint-disable-next-line no-console
        console.warn('[VUMeter] media source appears cross-origin and <video> has no crossOrigin attribute; MediaElementAudioSourceNode may be blocked by CORS.');
      }
    } catch (e) {
      // ignore
    }

    const source = context.createMediaElementSource(mediaElement);
    source.connect(analyser);
    
    CONNECTED_AUDIO_ELEMENTS.add(mediaElement);
    mediaEl._webAudioSource = source;
    mediaEl._audioNode = source;
    // eslint-disable-next-line no-console
    console.debug('[VUMeter] connected media to analyser', { src: mediaElement.currentSrc || mediaElement.src });
  } catch (error: any) {
    if (error.message && (error.message.includes('already connected') || error.message.includes('MediaElementSourceNode'))) {
      // eslint-disable-next-line no-console
      console.debug('[VUMeter] media already connected to AudioContext', { src: mediaElement.currentSrc || mediaElement.src });
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
}

export default function VUMeter({ videoRef, currentWorkIndex, currentSceneIndex }: VUMeterProps) {
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
    const playingVideo = findPlayingVideo();
    if (playingVideo && playingVideo !== lastActiveVideoRef.current) {
      lastActiveVideoRef.current = playingVideo;
      connectMediaToAnalyser(playingVideo);
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
    ctx.fillRect(0, barY, width, barHeight);
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
      connectMediaToAnalyser(activeVideo);
    };

    const handlePlay = (event: Event) => {
      const target = event.target as HTMLVideoElement | null;
      if (target && target.tagName === 'VIDEO') {
        ensureAudioContext();
        connectMediaToAnalyser(target);
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

  return (
    <div className="vumeter-container">
      <canvas ref={canvasRef} className="vumeter-canvas" width="30" height="100" />
      <canvas ref={waveformRef} className="waveform-canvas" width="150" height="80" />
    </div>
  );
}
