// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  root: '.', // Forzar root explícito para evitar escaneo del directorio padre
  integrations: [react()],
  // Configuración para acceder a los assets del proyecto padre
  // publicDir: '../public', // TEMPORALMENTE DESHABILITADO - causaba conflictos con src del proyecto viejo
  // Optimización de build
  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'hls': ['hls.js']
          }
        }
      }
    },
    // Asegurar que hls.js no cause problemas en SSR
    ssr: {
      noExternal: ['hls.js']
    }
  }
});