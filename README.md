# APULATI - Sound Design for Theatre

Portfolio web de diseño de sonido para teatro, desarrollado con React y Vite.

## 🎭 Características

- **Theatre Works**: Galería interactiva de obras de teatro con audio y video sincronizados
- **VU Meter & Waveform**: Visualizador de audio en tiempo real
- **Responsive Design**: Optimizado para desktop y móvil
- **Media Control**: Reproducción/pausa sincronizada de audio y video
- **Interactive Effects**: Efectos de hover con iluminación
- **Fixed Visualizer**: Visualizador posicionado fijo en panel de créditos
- **Modern UI**: Interfaz limpia y minimalista

## 🚀 Instalación y Desarrollo

```bash
# Instalar dependencias
npm install

# Ejecutar en modo desarrollo
npm run dev

# Construir para producción
npm run build

# Previsualizar build de producción
npm run preview
```

## 📁 Estructura del Proyecto

```
├── src/
│   ├── pages/
│   │   ├── TheatreWorks.jsx    # Página principal
│   │   ├── TheatreWorks.css    # Estilos principales
│   │   ├── Music.jsx           # Página de música
│   │   └── Contact.jsx         # Página de contacto
│   ├── components/
│   │   ├── SceneGrid.jsx       # Grid de escenas de video
│   │   ├── CreditsPanel.jsx    # Panel de créditos
│   │   ├── VUMeter.jsx         # Visualizador de audio
│   │   └── LazyImage.jsx       # Componente de imagen lazy
│   ├── config/
│   │   └── constants.js        # Configuración y rutas
│   └── App.jsx                 # Componente principal
├── public/
│   └── assets/                 # Archivos multimedia (MP4s comprimidos)
├── v2/                         # Versión alternativa
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions para deploy automático
└── deploy.sh                   # Script de deploy rápido
```

## 🎵 Obras Incluidas

- **Concours de Larmes** - Marvin M_Toumo
- **Qui a Peur** - Davide-Christelle Sanvee

## 🌐 Deploy

### Automático (Recomendado)
El proyecto está configurado con GitHub Actions para deploy automático:
- **Push a main**: Deployment automático
- **Manual**: Ir a Actions → "Build and Deploy to GitHub Pages" → "Run workflow"

### Manual desde local
```bash
./deploy.sh
```

### URLs
- **Desarrollo**: `http://localhost:5173/`
- **Producción**: `https://dahemar.github.io/apulati/`

Ver documentación completa en [.github/README_DEPLOYMENT.md](.github/README_DEPLOYMENT.md)

## 📱 Tecnologías

- React 19
- Vite
- React Router DOM
- CSS3

## 📄 Licencia

Proyecto privado - Todos los derechos reservados.
