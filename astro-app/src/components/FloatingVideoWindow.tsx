import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MIN_WIDTH = 280;
const MIN_HEIGHT = 158;

export function VideoPopoutGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="3" y="5" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="9" width="10" height="8" rx="1.5" fill="currentColor" opacity="0.92" />
    </svg>
  );
}

export function VideoPopoutButton({
  onClick,
  className = '',
}: {
  onClick: (e: React.MouseEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`video-popout-button${className ? ` ${className}` : ''}`}
      onClick={onClick}
      aria-label="Open in floating window"
      title="Open in floating window"
    >
      <VideoPopoutGlyph />
    </button>
  );
}

export interface FloatingVideoWindowProps {
  src: string;
  poster?: string;
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  title?: string;
  initialTime?: number;
  autoPlay?: boolean;
  defaultX?: number;
  defaultY?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  zIndex: number;
  onClose: () => void;
  onFocus: () => void;
  onVideoError?: (el: HTMLVideoElement, url: string) => void;
}

export default function FloatingVideoWindow({
  src,
  poster,
  crossOrigin,
  title = 'Video',
  initialTime = 0,
  autoPlay = false,
  defaultX = 72,
  defaultY = 96,
  defaultWidth = 480,
  defaultHeight = 270,
  zIndex,
  onClose,
  onFocus,
  onVideoError,
}: FloatingVideoWindowProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [position, setPosition] = useState({ x: defaultX, y: defaultY });
  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startY: number; startW: number; startH: number } | null>(null);

  const clampPosition = useCallback((x: number, y: number, w: number, h: number) => {
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - w - margin);
    const maxY = Math.max(margin, window.innerHeight - h - margin);
    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY),
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const startPlayback = () => {
      if (initialTime > 0 && Number.isFinite(initialTime)) {
        try {
          video.currentTime = initialTime;
        } catch {
          // ignore seek errors before metadata
        }
      }
      if (autoPlay) {
        video.muted = false;
        video.volume = 1;
        video.play().catch(() => {});
      }
    };

    video.addEventListener('loadeddata', startPlayback, { once: true });
    if (video.readyState >= 2) startPlayback();

    return () => {
      video.removeEventListener('loadeddata', startPlayback);
    };
  }, [src, initialTime, autoPlay]);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        const next = clampPosition(
          dragRef.current.originX + dx,
          dragRef.current.originY + dy,
          size.width,
          size.height,
        );
        setPosition(next);
      }
      if (resizeRef.current && resizeRef.current.pointerId === e.pointerId) {
        const dx = e.clientX - resizeRef.current.startX;
        const dy = e.clientY - resizeRef.current.startY;
        const nextW = Math.max(MIN_WIDTH, resizeRef.current.startW + dx);
        const nextH = Math.max(MIN_HEIGHT, resizeRef.current.startH + dy);
        setSize({ width: nextW, height: nextH });
        setPosition((prev) => clampPosition(prev.x, prev.y, nextW, nextH));
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
      if (resizeRef.current?.pointerId === e.pointerId) resizeRef.current = null;
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [clampPosition, size.width, size.height]);

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.floating-video-close')) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x,
      originY: position.y,
    };
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startW: size.width,
      startH: size.height,
    };
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="floating-video-window"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex,
      }}
      onPointerDown={onFocus}
      role="dialog"
      aria-label={title}
    >
      <div className="floating-video-toolbar" onPointerDown={startDrag}>
        <span className="floating-video-title">{title}</span>
        <button type="button" className="floating-video-close" onClick={onClose} aria-label="Close floating video">
          ×
        </button>
      </div>
      <div className="floating-video-body">
        <video
          ref={videoRef}
          className="floating-video-element"
          src={src}
          poster={poster}
          crossOrigin={crossOrigin}
          controls
          playsInline
          loop
          onError={(e) => onVideoError?.(e.currentTarget, src)}
        />
      </div>
      <div
        className="floating-video-resize"
        onPointerDown={startResize}
        aria-hidden="true"
        title="Resize"
      />
    </div>,
    document.body,
  );
}
