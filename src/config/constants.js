// Configuración de la aplicación
export const APP_CONFIG = {
  // Título de la aplicación
  TITLE: 'APULATI - Sound Design for Theatre',
  
  // Configuración de audio
  AUDIO: {
    LOOP: true,
    PRELOAD: 'auto',
    VOLUME: 1.0
  },
  
  // Configuración de GIFs
  GIF: {
    MAX_HEIGHT: '70vh',
    MAX_WIDTH: '100%',
    LOADING_TIMEOUT: 30000 // 30 segundos
  },
  
  // Configuración de navegación
  NAVIGATION: {
    AUTO_ADVANCE_DELAY: 5000, // 5 segundos
    TRANSITION_DURATION: 300
  },
  
  // Configuración de UI
  UI: {
    THEME: {
      BACKGROUND: '#0a0a0a',
      TEXT: '#ffffff',
      ACCENT: '#cccccc',
      BUTTON_BG: 'rgba(255,255,255,0.1)',
      BUTTON_HOVER: 'rgba(255,255,255,0.2)'
    },
    BREAKPOINTS: {
      MOBILE: 768,
      TABLET: 1024,
      DESKTOP: 1200
    }
  },
  
  // Configuración de logging
  LOGGING: {
    ENABLED: true,
    LEVEL: 'INFO', // DEBUG, INFO, WARN, ERROR
    PERFORMANCE_TRACKING: true
  }
};

// Rutas de archivos multimedia
export const MEDIA_PATHS = {
  CONCOURS_DE_LARMES: {
    title: 'Concours de Larmes',
    author: 'Marvin M_Toumo',
    gifs: [
      '/assets/Concours de Larmes - Marvin M_Toumo/Video/Elie Concours 1.mp4',
      '/assets/Concours de Larmes - Marvin M_Toumo/Video/Elie Concours 2.mp4',
      '/assets/Concours de Larmes - Marvin M_Toumo/Video/Elie Concours 3.mp4'
    ],
    audio: [
      '/assets/Concours de Larmes - Marvin M_Toumo/Audio/Elie Concours 1.wav',
      '/assets/Concours de Larmes - Marvin M_Toumo/Audio/Elie Concours 2.wav',
      '/assets/Concours de Larmes - Marvin M_Toumo/Audio/Elie Concours 3.wav'
    ]
  },
  QUI_A_PEUR: {
    title: 'Qui a Peur',
    author: 'Davide-Christelle Sanvee',
    gifs: [
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Video/1.Lamp 1.mp4',
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Video/2.Siffle 1.mp4',
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Video/3.Baldwin 1.mp4',
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Video/4.Shepperd 1.mp4',
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Video/5.Hand 1.mp4'
    ],
    audio: [
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Audio/1.Lamp 1.wav',
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Audio/2.Siffle.wav',
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Audio/3.Baldwin 1.wav',
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Audio/4.Shepperd 1.wav',
      '/assets/Qui a Peur - Davide-Christelle Sanvee/Audio/5.Hand 1.wav'
    ]
  }
};

// Mensajes de la aplicación
export const MESSAGES = {
  LOADING: 'Loading...',
  CLICK_TO_PLAY: 'Click to Play',
  PREVIOUS_WORK: '← Previous Work',
  NEXT_WORK: 'Next Work →',
  PREVIOUS_SCENE: '←',
  NEXT_SCENE: '→',
  ERROR_LOADING_GIF: 'Failed to load image',
  ERROR_LOADING_AUDIO: 'Failed to load audio'
};

// Configuración de rutas
export const ROUTES = {
  HOME: '/',
  MUSIC: '/music',
  CONTACT: '/contact'
}; 