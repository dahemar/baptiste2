// Sistema de logging para debug y monitoreo
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
} as const;

class Logger {
  private level: number;
  private isDevelopment: boolean;

  constructor() {
    this.level = LOG_LEVELS.INFO;
    this.isDevelopment = import.meta.env.DEV;
  }

  setLevel(level: number) {
    this.level = level;
  }

  debug(message: string, ...args: any[]) {
    if (this.level <= LOG_LEVELS.DEBUG) {
      console.log(`🐛 [DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.level <= LOG_LEVELS.INFO) {
      console.log(`ℹ️ [INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.level <= LOG_LEVELS.WARN) {
      console.warn(`⚠️ [WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]) {
    if (this.level <= LOG_LEVELS.ERROR) {
      console.error(`❌ [ERROR] ${message}`, ...args);
    }
  }

  group(label: string) {
    if (this.isDevelopment && this.level <= LOG_LEVELS.DEBUG) {
      console.group(label);
    }
  }

  groupEnd() {
    if (this.isDevelopment && this.level <= LOG_LEVELS.DEBUG) {
      console.groupEnd();
    }
  }
}

const logger = new Logger();
export default logger;
