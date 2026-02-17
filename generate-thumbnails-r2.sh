#!/bin/bash

R2_URL="https://pub-16fb774f4ada4a69b6c70bc856201eeb.r2.dev"
TEMP_DIR="/tmp/r2-thumbnails"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

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

echo "🎬 Generando 15 thumbnails desde videos en R2..."
echo ""

SUCCESS=0
FAILED=0

for VIDEO in "${VIDEOS[@]}"; do
  THUMB="${VIDEO%.mp4}.jpg"
  VIDEO_URL="$R2_URL/$VIDEO"
  THUMB_PATH="$TEMP_DIR/$THUMB"
  
  printf "📹 %-25s" "$VIDEO"
  
  if ffmpeg -ss 2 -i "$VIDEO_URL" -vframes 1 -q:v 2 "$THUMB_PATH" -y >/dev/null 2>&1; then
    SIZE=$(du -h "$THUMB_PATH" | awk '{print $1}')
    echo " ✅ $SIZE"
    ((SUCCESS++))
  else
    echo " ❌ Error"
    ((FAILED++))
  fi
done

echo ""
echo "📊 Resumen:"
echo "  ✅ Exitosos: $SUCCESS"
echo "  ❌ Fallidos: $FAILED"
TOTAL_SIZE=$(du -sh "$TEMP_DIR" 2>/dev/null | awk '{print $1}')
echo "  💾 Tamaño total: $TOTAL_SIZE"
echo "  📁 Ubicación: $TEMP_DIR"
echo ""
ls -lh "$TEMP_DIR"/*.jpg 2>/dev/null | head -5
