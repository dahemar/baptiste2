import React from 'react';
import './CreditsPanel.css';

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
}

export default function CreditsPanel({ 
  isVisible, 
  title, 
  credits = [],
  onPrevWork,
  onNextWork
}: CreditsPanelProps) {
  if (!isVisible) {
    return null;
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="credits-panel visible" onWheel={handleWheel}>
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
    </div>
  );
}
