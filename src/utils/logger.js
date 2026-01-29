// Sistema de logging para debug y monitoreo
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor() {
    this.level = LOG_LEVELS.INFO;
    this.isDevelopment = import.meta.env.DEV;
  }

  setLevel(level) {
    this.level = level;
  }

  debug(message, ...args) {
    if (this.level <= LOG_LEVELS.DEBUG) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message, ...args) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  warn(message, ...args) {
    if (this.level <= LOG_LEVELS.WARN) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message, ...args) {
    if (this.level <= LOG_LEVELS.ERROR) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  // Métodos específicos para la aplicación
  logGifLoad(workTitle, gifIndex, loadTime) {
    this.info(`GIF loaded: ${workTitle} - Scene ${gifIndex + 1} (${loadTime}ms)`);
  }

  logAudioLoad(workTitle, audioIndex, loadTime) {
    this.info(`Audio loaded: ${workTitle} - Audio ${audioIndex + 1} (${loadTime}ms)`);
  }

  logNavigation(fromWork, toWork) {
    this.info(`Navigation: ${fromWork} → ${toWork}`);
  }

  logError(type, error, context = {}) {
    this.error(`${type}: ${error.message}`, { error, context });
  }
}

export const logger = new Logger();

// Configurar nivel de log basado en el entorno
if (import.meta.env.DEV) {
  logger.setLevel(LOG_LEVELS.DEBUG);
} else {
  logger.setLevel(LOG_LEVELS.WARN);
}

export default logger; 