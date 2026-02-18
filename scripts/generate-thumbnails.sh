#!/bin/bash

R2_URL="https://pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev"
TEMP_DIR="/tmp/r2-thumbnails"
mkdir -p "$TEMP_DIR"

# Videos que necesitan thumbnails (basado en el CSV)
VIDEOS=(
  "1.La.Nuit.mp4"
  "2.Gorge.rouge.mp4"
  "3.Intro.Pleurs.mp4"
  "4.End.Song.mp4"
  "5.Toux.mp4"
  "6.Eteignez.tout.mp4"
  "1.Drone.Postures.mp4"
  "2.Organ.Vinyl.mp4"
  "3.Loop.Felicidad.mp4"
  "4.Piano.Theme.mp4"
  "5.Orfeu.Granular.mp4"
  "6.Freeze.Cabelo.mp4"
  "Jeremiades.1.mp4"
  "Jeremiades.2.mp4"
  "Jeremiades.3.mp4"
)

echo "🎬 Generando thumbnails desde videos en R2..."
echo "📂 Directorio: $TEMP_DIR"
echo ""

SUCCESS=0
FAILED=0

for VIDEO in "${VIDEOS[@]}"; do
  THUMB="${VIDEO%.mp4}.jpg"
  VIDEO_URL="$R2_URL/$VIDEO"
  THUMB_PATH="$TEMP_DIR/$THUMB"
  
  echo "📹 $VIDEO"
  
  # Extraer frame en segundo 2 (calidad alta: q:v 2)
  if ffmpeg -ss 2 -i "$VIDEO_URL" -vframes 1 -q:v 2 "$THUMB_PATH" -y >/dev/null 2>&1; then
    SIZE=$(du -h "$THUMB_PATH" | awk '{print $1}')
    echo "  ✅ Generado: $SIZE ($THUMB)"
    ((SUCCESS++))
  else
    echo "  ❌ Error generando thumbnail"
    ((FAILED++))
  fi
done

echo ""
echo "📊 Resumen:"
echo "  ✅ Exitosos: $SUCCESS"
echo "  ❌ Fallidos: $FAILED"
echo "  📁 Ubicación: $TEMP_DIR"
TOTAL_SIZE=$(du -sh "$TEMP_DIR" 2>/dev/null | awk '{print $1}')
echo "  💾 Tamaño total: $TOTAL_SIZE"
