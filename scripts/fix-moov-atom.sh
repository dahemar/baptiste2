#!/bin/bash
set -e

# Fix MP4 files with moov atom at the end (not streamable)
# This moves the moov atom to the beginning for progressive web streaming

AWS_PROFILE="r2"
R2_BUCKET="baptiste-videos"
R2_ENDPOINT="https://7305104bf22993d080aa24f59e6a8465.r2.cloudflarestorage.com"
PUBLIC_URL="https://pub-16fb774f4ada4a69b6c70bc856201eeb.r2.dev"

echo "🔧 Fixing moov atom position in ALL MP4 videos..."
echo "📊 This will process ~1.71GB of video files"
echo ""

# Get list of all MP4 files in R2
echo "📋 Fetching list of videos from R2..."
VIDEOS=$(aws s3 ls \
  --profile "$AWS_PROFILE" \
  --endpoint-url "$R2_ENDPOINT" \
  "s3://$R2_BUCKET/" \
  | grep '\.mp4$' \
  | awk '{print $4}')

TOTAL=$(echo "$VIDEOS" | wc -l | tr -d ' ')
CURRENT=0

echo "Found $TOTAL videos to process"
echo ""

for video in $VIDEOS; do
  CURRENT=$((CURRENT + 1))
  echo "[$CURRENT/$TOTAL] Processing: $video"
  
  # Download from R2
  echo "  ⬇️  Downloading..."
  aws s3 cp \
    --profile "$AWS_PROFILE" \
    --endpoint-url "$R2_ENDPOINT" \
    --quiet \
    "s3://$R2_BUCKET/$video" \
    "/tmp/$video"
  
  # Fix with ffmpeg (move moov atom to beginning)
  echo "  🔧 Fixing moov atom..."
  ffmpeg -i "/tmp/$video" \
    -c copy \
    -movflags +faststart \
    -loglevel error \
    -stats \
    -y \
    "/tmp/fixed_$video"
  
  # Upload fixed version back to R2
  echo "  ⬆️  Uploading..."
  aws s3 cp \
    --profile "$AWS_PROFILE" \
    --endpoint-url "$R2_ENDPOINT" \
    --content-type "video/mp4" \
    --cache-control "public, max-age=31536000, immutable" \
    --quiet \
    "/tmp/fixed_$video" \
    "s3://$R2_BUCKET/$video"
  
  # Cleanup
  rm -f "/tmp/$video" "/tmp/fixed_$video"
  
  echo "  ✅ Done"
  echo ""
done

echo "🎉 All $TOTAL videos fixed!"
echo ""
echo "🧪 Test in browser: http://localhost:4321"
echo "   Videos should now load and play immediately, even the large ones"
