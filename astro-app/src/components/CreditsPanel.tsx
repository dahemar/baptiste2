import React, { useCallback, useEffect, useRef, useState } from 'react';
import './CreditsPanel.css';
import VUMeter from './VUMeter';

interface Credit {
  role: string;
  name: string;
}

interface CreditsPanelProps {
  isVisible: boolean;
  title: string;
  credits?: Credit[];
  onPrevWork?: (() => void) | undefined;
  onNextWork?: (() => void) | undefined;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  currentWorkIndex?: number;
  currentSceneIndex?: number;
}

export default function CreditsPanel({ 
  isVisible, 
  title, 
  credits = [],
  onPrevWork,
  onNextWork,
  videoRef,
  currentWorkIndex = 0,
  currentSceneIndex = 0,
}: CreditsPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const [showBottomFade, setShowBottomFade] = useState(false);

  const updateBottomFade = useCallback(() => {
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion || typeof window === 'undefined') {
      setShowBottomFade(false);
      return;
    }

    const threshold = 8;
    const hasHiddenContentBelow = scrollRegion.scrollTop + scrollRegion.clientHeight < scrollRegion.scrollHeight - threshold;
    setShowBottomFade(hasHiddenContentBelow);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const scrollRegion = scrollRegionRef.current;
    if (!scrollRegion) return;

    const handleViewportChange = () => updateBottomFade();
    const handlePanelScroll = () => updateBottomFade();

    updateBottomFade();
    scrollRegion.addEventListener('scroll', handlePanelScroll, { passive: true });
    window.addEventListener('resize', handleViewportChange);

    return () => {
      scrollRegion.removeEventListener('scroll', handlePanelScroll);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [isVisible, credits, title, updateBottomFade]);

  if (!isVisible) {
    return null;
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  const isMobileViewport = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  return (
    <div
      ref={panelRef}
      className={`credits-panel visible ${showBottomFade ? 'show-bottom-fade' : ''}`}
      onWheel={handleWheel}
    >
      <div ref={scrollRegionRef} className="credits-scroll-region">
        <div className="credits-content">
          <div className="credit-line">
            <span className="credit-title">{title}</span>
          </div>

          {credits && credits.map((credit, index) => (
            <div key={index} className="credit-line">
              <span className="credit-role">{credit.role}:</span>
              <span className="credit-name">{credit.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="credits-bottom-fade" aria-hidden="true" />

      {/* Project navigation inside credits (desktop) - rendered only if handlers provided */}
      {(onPrevWork || onNextWork) && (
        <div className="credits-project-nav">
          {onPrevWork ? (
            <button className="project-nav prev" onClick={onPrevWork} aria-label="Previous project">‹ prev</button>
          ) : <div />}

          {onNextWork ? (
            <button className="project-nav next" onClick={onNextWork} aria-label="Next project">next ›</button>
          ) : <div />}
        </div>
      )}

      {!isMobileViewport && (
        <VUMeter
          inCreditsPanel
          videoRef={videoRef}
          currentWorkIndex={currentWorkIndex}
          currentSceneIndex={currentSceneIndex}
        />
      )}
    </div>
  );
}
