# APULATI - Astro Edition

Proyecto migrado de React + Vite a Astro para mejor rendimiento con muchos videos.

## 🚀 Inicio Rápido

```bash
cd astro-app
npm run dev
```

Luego abre http://localhost:4321

## 📁 Estructura

- `/` - Página principal con información del proyecto
- `/theatre-works` - Grid de obras teatrales con ~40 videos

## ✨ Características Clave

### VideoPlayer Optimizado
- **Lazy HLS**: hls.js solo se carga cuando es necesario
- **preload="none"**: Videos no cargan hasta interacción
- **Resource Management**: Limpieza automática de recursos
- **Position Memory**: Retiene posición al pausar

### VideoGrid con Islands
- **Lazy Rendering**: Solo renderiza current ±1 obras
- **Scroll Detection**: Detecta obra actual automáticamente
- **Thumbnail Navigation**: Click para cambiar de escena
- **No Auto-play**: Ningún video se reproduce automáticamente

## 🎯 Optimizaciones vs React Original

| Mejora | Beneficio |
|--------|-----------|
| Islands Architecture | Solo hidrata componentes visibles |
| Lazy Rendering | Solo 3 videos montados en vez de 40 |
| Lazy HLS Loading | hls.js solo cuando es necesario |
| preload="none" | No descarga hasta interacción |
| Resource Cleanup | Libera decodificadores y buffers |

## 📦 Assets

Los assets se comparten con el proyecto padre:
- Videos: `../public/assets/videos/`
- No hay duplicación de archivos pesados

## 🛠️ Comandos

```bash
npm run dev      # Desarrollo (puerto 4321)
npm run build    # Build de producción
npm run preview  # Preview del build
```

## 🔧 Configuración

### Astro Config
- `publicDir: '../public'` - Accede a assets del proyecto padre
- Integración de React para islands
- TypeScript strict mode
- Optimización de chunks (HLS separado)

### Despliegue en Vercel
El archivo `vercel.json` está configurado para routing.

## 📝 Notas de Desarrollo

### Logger
El sistema incluye logging detallado visible en la consola del navegador.

### HLS Manager
- Detección automática de soporte nativo
- Fallback a hls.js si es necesario
- Configuración optimizada de buffers

### Video Resource Manager
- Política de montaje: current ±1
- Destrucción agresiva de recursos
- Limpieza de decodificadores y buffers

## 📚 Documentación

Ver `MIGRATION_GUIDE.md` para detalles completos de la migración.

## 🔗 Referencias

- [Astro Documentation](https://docs.astro.build)
- [Astro Islands](https://docs.astro.build/en/concepts/islands/)
- [HLS.js](https://github.com/video-dev/hls.js/)

