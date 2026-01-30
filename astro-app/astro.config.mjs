// @ts-check
// Temporarily disabled imports and complex config to isolate startup blocking.
// Revert these changes after diagnosing which import causes the hang.
/*
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
*/

import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel/serverless';

// https://astro.build/config
export default defineConfig({
  adapter: vercel(),
  root: '.', // Forzar root explícito para evitar escaneo del directorio padre
  integrations: [react()],
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