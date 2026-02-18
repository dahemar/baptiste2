#!/bin/bash
set -e

# Upload thumbnails to R2
ACCOUNT_ID="7305104bf22993d080aa24f59e6a8465"
R2_ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
BUCKET_NAME="baptiste-videos"
THUMBS_DIR="/tmp/r2-thumbnails"

echo "📤 Subiendo thumbnails a R2..."
echo "Bucket: ${BUCKET_NAME}"
echo "Endpoint: ${R2_ENDPOINT}"
echo ""

if [ ! -d "$THUMBS_DIR" ]; then
  echo "❌ Error: Directorio $THUMBS_DIR no existe"
  exit 1
fi

THUMB_COUNT=$(ls "$THUMBS_DIR"/*.jpg 2>/dev/null | wc -l | tr -d ' ')
if [ "$THUMB_COUNT" -eq 0 ]; then
  echo "❌ Error: No hay thumbnails en $THUMBS_DIR"
  exit 1
fi

echo "📁 Encontrados $THUMB_COUNT thumbnails"
echo ""

SUCCESS=0
FAILED=0

for THUMB_PATH in "$THUMBS_DIR"/*.jpg; do
  THUMB_NAME=$(basename "$THUMB_PATH")
  
  printf "📤 %-30s" "$THUMB_NAME"
  
  if aws s3 cp "$THUMB_PATH" \
    "s3://${BUCKET_NAME}/${THUMB_NAME}" \
    --endpoint-url "$R2_ENDPOINT" \
    --profile r2 \
    --content-type "image/jpeg" \
    --cache-control "public, max-age=31536000, immutable" \
    >/dev/null 2>&1; then
    echo " ✅"
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
echo ""

if [ $SUCCESS -gt 0 ]; then
  echo "🌐 URLs públicas:"
  echo "https://pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev/[filename].jpg"
  echo ""
  echo "Ejemplo:"
  echo "https://pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev/1.La.Nuit.jpg"
fi
