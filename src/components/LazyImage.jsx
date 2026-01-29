import React, { useState, useEffect, useRef } from 'react';

const LazyImage = ({ src, alt, className, onLoad, onError, ...props }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const handleLoad = () => {
      setIsLoaded(true);
      onLoad?.();
    };

    const handleError = () => {
      setHasError(true);
      onError?.();
    };

    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleError);

    return () => {
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };
  }, [onLoad, onError]);

  return (
    <div className={`lazy-image-container ${className || ''}`}>
      {!isLoaded && !hasError && (
        <div className="lazy-image-placeholder">
          <div className="loading-spinner"></div>
          <p>Loading...</p>
        </div>
      )}
      
      {hasError && (
        <div className="lazy-image-error">
          <p>Failed to load image</p>
        </div>
      )}
      
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`lazy-image ${isLoaded ? 'loaded' : ''}`}
        style={{ 
          display: isLoaded ? 'block' : 'none',
          opacity: isLoaded ? 1 : 0,
          transition: 'opacity 0.3s ease'
        }}
        {...props}
      />
    </div>
  );
};

export default LazyImage; 