import React, { useCallback, useEffect, useRef, useState } from 'react';
import './CreditsPanel.css';
import VUMeter from './VUMeter';

interface Credit {
  role: string;
  name: string;
}

const SYNOPSIS_ROLE_RE = /^(synopsis|description|short[\s_-]?description|teaser|summary)$/i;
const DIRECTION_ROLE_RE = /^direction$/i;

function partitionCredits(credits: Credit[], synopsisProp?: string) {
  let synopsis = synopsisProp?.trim() || '';
  const direction: Credit[] = [];
  const other: Credit[] = [];

  for (const credit of credits) {
    const role = credit.role.trim();
    if (SYNOPSIS_ROLE_RE.test(role)) {
      if (!synopsis) synopsis = credit.name.trim();
      continue;
    }
    if (DIRECTION_ROLE_RE.test(role)) {
      direction.push(credit);
      continue;
    }
    other.push(credit);
  }

  return {
    synopsis: synopsis || undefined,
    direction,
    other,
  };
}

interface CreditsPanelProps {
  isVisible: boolean;
  title: string;
  credits?: Credit[];
  synopsis?: string;
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
  synopsis,
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

  const { synopsis: description, direction, other } = partitionCredits(credits, synopsis);

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
          <header className="credits-header">
            <h2 className="credit-title">{title}</h2>
            {direction.map((credit, index) => (
              <div key={`dir-${index}`} className="credit-line credit-line--meta">
                <span className="credit-role">{credit.role}:</span>
                <span className="credit-name">{credit.name}</span>
              </div>
            ))}
          </header>

          {description && (
            <section className="credits-lead" aria-label="Description">
              <p className="credit-synopsis">{description}</p>
            </section>
          )}

          {other.length > 0 && (
            <section className="credits-details" aria-label="Credits">
              {description && <hr className="credits-divider" />}
              {other.map((credit, index) => (
                <div key={`credit-${index}`} className="credit-line">
                  <span className="credit-role">{credit.role}:</span>
                  <span className="credit-name">{credit.name}</span>
                </div>
              ))}
            </section>
          )}
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
