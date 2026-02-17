#!/bin/bash
set -e

# Cloudflare R2 Migration Script
# Downloads videos from GitHub Releases and uploads to R2

ACCOUNT_ID="7305104bf22993d080aa24f59e6a8465"
R2_ENDPOINT="https://${ACCOUNT_ID}.r2.cloudflarestorage.com"
BUCKET_NAME="baptiste-videos"
TEMP_DIR="/tmp/baptiste-videos-migration"
RELEASE_TAG="media-assets-2026-01-28"
REPO="dahemar/video-assets"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Cloudflare R2 Migration ===${NC}"
echo "Account ID: ${ACCOUNT_ID}"
echo "Bucket: ${BUCKET_NAME}"
echo "Endpoint: ${R2_ENDPOINT}"
echo ""

# Check for required credentials
if [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then
    echo -e "${RED}ERROR: R2 credentials not set${NC}"
    echo ""
    echo "Please set these environment variables:"
    echo "  export R2_ACCESS_KEY_ID='your-access-key-id'"
    echo "  export R2_SECRET_ACCESS_KEY='your-secret-access-key'"
    echo ""
    echo "Get credentials from: https://dash.cloudflare.com/${ACCOUNT_ID}/r2/api-tokens"
    exit 1
fi

# Check for aws CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}ERROR: AWS CLI not installed${NC}"
    echo "Install with: brew install awscli"
    exit 1
fi

# Configure AWS CLI for R2
echo -e "${BLUE}Configuring AWS CLI for R2...${NC}"
aws configure set aws_access_key_id "$R2_ACCESS_KEY_ID" --profile r2
aws configure set aws_secret_access_key "$R2_SECRET_ACCESS_KEY" --profile r2
aws configure set region auto --profile r2

# Create temp directory
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

# Get list of assets from GitHub Release
echo -e "${BLUE}Fetching asset list from GitHub...${NC}"
curl -sS "https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}" -o release.json

# Extract download URLs and filenames
python3 - <<'PYEOF'
import json, sys
with open('release.json') as f:
    data = json.load(f)
assets = data.get('assets', [])
with open('assets.txt', 'w') as out:
    for asset in assets:
        if asset['name'].endswith('.mp4'):
            out.write(f"{asset['browser_download_url']}\t{asset['name']}\t{asset['size']}\n")
print(f"Found {len([a for a in assets if a['name'].endswith('.mp4')])} video files")
PYEOF

VIDEO_COUNT=$(wc -l < assets.txt | tr -d ' ')
echo -e "${GREEN}Found ${VIDEO_COUNT} videos to migrate${NC}\n"

# Download all videos
echo -e "${BLUE}Step 1/2: Downloading videos from GitHub...${NC}"
mkdir -p videos
CURRENT=0
while IFS=$'\t' read -r url filename size; do
    CURRENT=$((CURRENT + 1))
    if [ -f "videos/$filename" ]; then
        echo "[$CURRENT/$VIDEO_COUNT] ✓ $filename (already downloaded)"
    else
        echo "[$CURRENT/$VIDEO_COUNT] Downloading $filename ($(numfmt --to=iec-i --suffix=B $size))..."
        curl -L --progress-bar "$url" -o "videos/$filename"
    fi
done < assets.txt
echo -e "${GREEN}✓ All videos downloaded${NC}\n"

# Create bucket if it doesn't exist
echo -e "${BLUE}Creating R2 bucket...${NC}"
aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --endpoint-url "$R2_ENDPOINT" \
    --profile r2 \
    2>/dev/null || echo "Bucket already exists or created"

# Upload to R2
echo -e "\n${BLUE}Step 2/2: Uploading to R2...${NC}"
CURRENT=0
while IFS=$'\t' read -r url filename size; do
    CURRENT=$((CURRENT + 1))
    echo "[$CURRENT/$VIDEO_COUNT] Uploading $filename to R2..."
    aws s3 cp "videos/$filename" \
        "s3://${BUCKET_NAME}/${filename}" \
        --endpoint-url "$R2_ENDPOINT" \
        --profile r2 \
        --content-type "video/mp4" \
        --cache-control "public, max-age=31536000, immutable"
done < assets.txt

echo -e "\n${GREEN}=== Migration Complete ===${NC}"
echo ""
echo "Videos uploaded to: ${BUCKET_NAME}"
echo "Files in bucket:"
aws s3 ls "s3://${BUCKET_NAME}/" --endpoint-url "$R2_ENDPOINT" --profile r2
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Configure public access or custom domain in Cloudflare dashboard"
echo "2. Run: npm run update-csv-urls to update video URLs"
echo "3. Deploy updated code to Vercel"
