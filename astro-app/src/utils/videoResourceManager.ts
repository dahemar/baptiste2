/**
 * Video Resource Manager for Astro
 * 
 * Gestiona recursos de elementos <video> para prevenir saturación de decodificadores,
 * buffers y problemas de reproducción causados por múltiples videos activos.
 */

import logger from './logger';
import { destroyHLS, getHLSInstance } from './hlsManager';

/**
 * Destruye agresivamente un elemento video para liberar recursos
 */
export function destroyVideoResources(videoElement: HTMLVideoElement, videoKey: string = ''): void {
  if (!videoElement) return;
  
  try {
    const videoSrc = videoElement.currentSrc || videoElement.src || '';
    const shortName = videoSrc ? videoSrc.substring(videoSrc.lastIndexOf('/') + 1) : videoKey;
    
    // 1. Pausar reproducción
    if (!videoElement.paused) {
      videoElement.pause();
    }
    
    // 2. Limpiar HLS si está activo
    const hlsInstance = getHLSInstance(videoElement);
    if (hlsInstance) {
      destroyHLS(videoElement);
      logger.debug(`🧹 Destroyed HLS instance for ${shortName}`);
    }
    
    // 3. Remover src para liberar decodificador
    videoElement.removeAttribute('src');
    
    // 4. Limpiar sources (si existen)
    const sources = videoElement.querySelectorAll('source');
    sources.forEach(source => {
      source.removeAttribute('src');
    });
    
    // 5. Forzar liberación de buffers
    videoElement.load();
    
    logger.debug(`♻️ Cleaned video resources for ${shortName}`);
  } catch (error) {
    logger.error('❌ Error destroying video resources:', error);
  }
}

/**
 * Determina si una obra debe ser completamente renderizada (montada) o solo mostrar placeholder
 * 
 * Política: solo renderizar current ±1 para limitar instancias de <video> activas
 */
export function shouldRenderWork(currentIndex: number, workIndex: number, windowSize: number = 1): boolean {
  return Math.abs(currentIndex - workIndex) <= windowSize;
}

/**
 * Helper para limpiar recursos al desmontar componentes
 */
export function cleanupOnUnmount(videoElement: HTMLVideoElement | null): void {
  if (videoElement) {
    destroyVideoResources(videoElement);
  }
}
