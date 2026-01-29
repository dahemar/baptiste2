import React, { useState, useEffect, useRef } from 'react';
import LazyImage from '../components/LazyImage';
import logger from '../utils/logger';
import { MESSAGES } from '../config/constants';
import './TheatreWorks.css';

const TheatreWorks = ({ works }) => {
  const [currentWorkIndex, setCurrentWorkIndex] = useState(0);
  const [currentGifIndex, setCurrentGifIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [gifShouldPlay, setGifShouldPlay] = useState(false);
  const [hasUserClicked, setHasUserClicked] = useState(false);
  const [gifKey, setGifKey] = useState(0);
  const [playState, setPlayState] = useState(0);
  
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const currentWork = works[currentWorkIndex];

  // Manejar navegación entre obras
  const goToPreviousWork = () => {
    const newIndex = currentWorkIndex === 0 ? works.length - 1 : currentWorkIndex - 1;
    logger.logNavigation(currentWork.title, works[newIndex].title);
    setCurrentWorkIndex(newIndex);
    setCurrentGifIndex(0);
    setIsPlaying(false);
    setHasUserClicked(false);
    setGifKey(0);
  };

  const goToNextWork = () => {
    const newIndex = currentWorkIndex === works.length - 1 ? 0 : currentWorkIndex + 1;
    logger.logNavigation(currentWork.title, works[newIndex].title);
    setCurrentWorkIndex(newIndex);
    setCurrentGifIndex(0);
    setIsPlaying(false);
    setHasUserClicked(false);
    setGifKey(0);
  };

  // Manejar navegación entre videos
  const goToPreviousGif = () => {
    setCurrentGifIndex(prev => prev === 0 ? currentWork.gifs.length - 1 : prev - 1);
    setHasUserClicked(true);
    setGifKey(prev => prev + 1);
    setPlayState(prev => prev + 1);
    
    // Iniciar reproducción automáticamente
    setTimeout(() => {
      if (audioRef.current && videoRef.current) {
        audioRef.current.play();
        videoRef.current.play();
        setIsPlaying(true);
        setGifShouldPlay(true);
      }
    }, 100);
  };

  const goToNextGif = () => {
    setCurrentGifIndex(prev => prev === currentWork.gifs.length - 1 ? 0 : prev + 1);
    setHasUserClicked(true);
    setGifKey(prev => prev + 1);
    setPlayState(prev => prev + 1);
    
    // Iniciar reproducción automáticamente
    setTimeout(() => {
      if (audioRef.current && videoRef.current) {
        audioRef.current.play();
        videoRef.current.play();
        setIsPlaying(true);
        setGifShouldPlay(true);
      }
    }, 100);
  };

  // Manejar reproducción/pausa de audio y video
  const handlePlayClick = () => {
    if (audioRef.current && videoRef.current) {
      setHasUserClicked(true);
      if (isPlaying) {
        audioRef.current.pause();
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        videoRef.current.play();
        setIsPlaying(true);
        setGifShouldPlay(true);
      }
    }
  };

  // Cambiar audio y video cuando cambia el índice
  useEffect(() => {
    if (audioRef.current && videoRef.current) {
      audioRef.current.src = currentWork.audio[currentGifIndex];
      videoRef.current.src = currentWork.gifs[currentGifIndex];
      audioRef.current.load();
      videoRef.current.load();
      // Pausar automáticamente cuando cambia
      if (isPlaying) {
        audioRef.current.pause();
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [currentGifIndex, currentWork]);

  // Medir tiempo de carga de GIFs
  useEffect(() => {
    window.gifLoadStartTime = Date.now();
  }, [currentGifIndex, currentWorkIndex]);

  // Resetear cuando cambia la obra
  useEffect(() => {
    if (audioRef.current && videoRef.current) {
      audioRef.current.pause();
      videoRef.current.pause();
      audioRef.current.currentTime = 0;
      videoRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setHasUserClicked(false);
    setGifKey(0);
    setPlayState(0);
  }, [currentWorkIndex]);

  // Prevenir scroll en la página
  useEffect(() => {
    document.body.classList.add('theatre-works-page');
    
    return () => {
      document.body.classList.remove('theatre-works-page');
    };
  }, []);

  // Manejar carga de video
  const handleGifLoad = () => {
    const loadTime = Date.now() - (window.gifLoadStartTime || Date.now());
    logger.logGifLoad(currentWork.title, currentGifIndex, loadTime);
    console.log('Video loaded:', currentWork.gifs[currentGifIndex]);
    setIsLoading(false);
  };

  // Manejar cuando el video está listo para reproducir
  const handleCanPlay = () => {
    console.log('Video can play:', currentWork.gifs[currentGifIndex]);
  };

  const handleGifError = (error) => {
    logger.logError('VIDEO_LOAD_ERROR', error, {
      work: currentWork.title,
      gifIndex: currentGifIndex,
      gifPath: currentWork.gifs[currentGifIndex]
    });
    console.error('Video load error:', error, currentWork.gifs[currentGifIndex]);
    setIsLoading(false);
  };

  return (
    <div className="theatre-works">
      <div className="work-container">
        <div className="work-header">
          <h1 className="work-title">{currentWork.title}</h1>
          <p className="work-author">by {currentWork.author}</p>
        </div>

        <div className="gif-container">
          {isLoading && (
            <div className="loading-overlay">
              <div className="loading-spinner"></div>
              <p>{MESSAGES.LOADING}</p>
            </div>
          )}
          
          <video
            ref={videoRef}
            key={`${gifKey}-${playState}`}
            src={currentWork.gifs[currentGifIndex]}
            className="theatre-gif"
            style={{ 
              filter: isPlaying ? 'none' : 'grayscale(100%) brightness(0.8)'
            }}
            onLoadedData={handleGifLoad}
            onCanPlay={handleCanPlay}
            onError={handleGifError}
            muted
            playsInline
            loop
            preload="auto"
          />

          <div className="play-overlay" onClick={handlePlayClick}>
            <div className="play-button">
              <span>{!hasUserClicked ? 'click to play' : (isPlaying ? '' : '')}</span>
            </div>
          </div>

          {/* Flechas laterales */}
          <button 
            className="side-nav-button prev-button"
            onClick={goToPreviousGif}
            aria-label="Previous scene"
          >
            &lt;
          </button>
          
          <button 
            className="side-nav-button next-button"
            onClick={goToNextGif}
            aria-label="Next scene"
          >
            &gt;
          </button>

          {/* Contador abajo */}
          <div className="gif-navigation">
            <div className="gif-counter">
              {currentGifIndex + 1} / {currentWork.gifs.length}
            </div>
          </div>
        </div>

        <div className="work-navigation">
          <button 
            className="work-nav-button prev-work"
            onClick={goToPreviousWork}
          >
            {MESSAGES.PREVIOUS_WORK}
          </button>
          
          <button 
            className="work-nav-button next-work"
            onClick={goToNextWork}
          >
            {MESSAGES.NEXT_WORK}
          </button>
        </div>

        <audio
          ref={audioRef}
          loop
          preload="auto"
          onEnded={() => {
            // El audio se reproduce en bucle automáticamente
          }}
        />
      </div>
    </div>
  );
};

export default TheatreWorks; 