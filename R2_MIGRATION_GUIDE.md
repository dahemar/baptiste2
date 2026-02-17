# Cloudflare R2 Migration Guide

This guide walks through migrating your video assets from GitHub Releases to Cloudflare R2.

## Current Status

- **Videos in GitHub Releases**: 34 MP4 files, 1.71 GB total
- **Current architecture**: Videos proxied through Vercel serverless (`/api/proxy`)
- **Problem**: High origin transfer costs due to streaming through Vercel

## R2 Benefits

- ✅ **1.71 GB fits in free tier** (10 GB storage included)
- ✅ **Zero egress fees** when serving through Cloudflare CDN
- ✅ **Better performance** with global CDN caching
- ✅ **Lower Vercel costs** by eliminating proxy streaming

## Prerequisites

Before starting, you'll need:

1. Cloudflare account
2. R2 enabled (https://dash.cloudflare.com/r2)
3. AWS CLI installed: `brew install awscli`

## Step 1: Create R2 API Token

1. Go to https://dash.cloudflare.com/7305104bf22993d080aa24f59e6a8465/r2/api-tokens
2. Click **Create API Token**
3. Set permissions:
   - **Object Read & Write**
   - **Bucket Read & Write**
4. Copy the **Access Key ID** and **Secret Access Key**

## Step 2: Set Environment Variables

```bash
export R2_ACCESS_KEY_ID='your-access-key-id-here'
export R2_SECRET_ACCESS_KEY='your-secret-access-key-here'
```

💡 **Tip**: Add these to `~/.zshrc` or `~/.bashrc` to persist across sessions.

## Step 3: Run Migration Script

```bash
cd /Users/david/Documents/GitHub/baptiste
chmod +x scripts/migrate-to-r2.sh
./scripts/migrate-to-r2.sh
```

This script will:
- Download all 34 videos from GitHub Releases (to `/tmp/baptiste-videos-migration`)
- Create an R2 bucket named `baptiste-videos`
- Upload all videos to R2 with optimal cache headers
- Set Content-Type to `video/mp4` for proper streaming

⏱ Expected time: 5-10 minutes (depending on connection speed)

## Step 4: Configure Public Access

Choose **ONE** of these options:

### Option A: R2.dev Subdomain (Quickest)

1. Go to https://dash.cloudflare.com/7305104bf22993d080aa24f59e6a8465/r2/default/buckets/baptiste-videos/settings
2. Scroll to **Public Access**
3. Click **Allow Access**
4. Copy the R2.dev URL (will be something like `https://pub-xxxxx.r2.dev`)

Videos will be accessible at: `https://pub-xxxxx.r2.dev/FILENAME.mp4`

### Option B: Custom Domain (Recommended for production)

1. Go to bucket settings
2. Click **Connect Domain**
3. Enter your domain (e.g., `videos.yourdomain.com`)
4. Follow DNS setup instructions

Videos will be accessible at: `https://videos.yourdomain.com/FILENAME.mp4`

### Option C: Cloudflare Workers (Most flexible)

Create a Worker to serve videos with custom logic (signed URLs, access control, etc.)

## Step 5: Update CSV with R2 URLs

Edit `scripts/update-csv-for-r2.js` and set the correct R2 URL:

```javascript
// Use the URL from Step 4
const R2_PUBLIC_URL = 'https://pub-xxxxx.r2.dev';  // or your custom domain
```

Then run:

```bash
node scripts/update-csv-for-r2.js
```

This will replace all GitHub URLs with R2 URLs in `astro-app/data/theatre-works.csv`.

## Step 6: Remove Proxy Code (Optional but Recommended)

Since videos will be served directly from R2/CDN, the proxy is no longer needed:

1. Remove `/api/proxy/[target].ts` endpoint (saves Vercel bandwidth)
2. Update `googleSheetsManager.ts` to NOT add `/api/proxy?url=` prefix
3. Videos will load directly from R2 with optimal caching

## Step 7: Test Locally

```bash
cd astro-app
rm -f .cache/theatre-works.json  # Clear cache
npm run dev
```

Open http://localhost:4321 and verify:
- Videos load correctly
- No console errors
- Network tab shows requests going to R2 (not GitHub or /api/proxy)

## Step 8: Deploy

```bash
git add -A
git commit -m "feat: migrate videos to Cloudflare R2

- Moved 34 videos (1.71 GB) from GitHub Releases to R2
- Updated CSV to use R2 URLs
- Removed proxy streaming (videos served directly from CDN)
- Zero egress fees, better caching, global CDN"

git push baptiste2 main
```

Vercel will auto-deploy. Check https://baptiste2.vercel.app after deployment.

## Monitoring

### Check R2 Usage

Dashboard: https://dash.cloudflare.com/7305104bf22993d080aa24f59e6a8465/r2

Monitor:
- **Storage**: Should stay ~1.71 GB (well under 10 GB free tier)
- **Class A operations**: PUT/POST/LIST (1M free/month)
- **Class B operations**: GET/HEAD (10M free/month)

### Optimize Further (if needed)

If you hit operation limits:
1. Increase browser `Cache-Control` to reduce re-requests
2. Use `immutable` directive (already set in migration script)
3. Consider HLS/DASH segmentation for very heavy traffic

## Rollback (if needed)

If something goes wrong:

```bash
git revert HEAD
git push baptiste2 main
```

Videos will fall back to GitHub Releases through the proxy.

## Cost Comparison

### Before (GitHub Releases + Vercel Proxy)
- ❌ Vercel origin transfer charges
- ❌ Multiple fetches per video (ranges, prefetch)
- ❌ No CDN caching

### After (R2 + Cloudflare CDN)
- ✅ Free storage (under 10 GB)
- ✅ Free operations (under 1M Class A / 10M Class B)
- ✅ Zero egress fees
- ✅ Global CDN caching

## Troubleshooting

### "Bucket already exists"
This is fine, script continues.

### "Access Denied"
Check API token permissions include Object & Bucket Read/Write.

### CORS errors in browser
Add CORS policy in R2 bucket settings:
```json
[
  {
    "AllowedOrigins": ["https://baptiste2.vercel.app", "http://localhost:4321"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

### Videos not loading
1. Verify public access is enabled
2. Check R2 URL is correct in CSV
3. Test a video URL directly in browser
4. Check browser console for errors

## Questions?

Issues with migration? Check:
- R2 dashboard for upload status
- Browser DevTools Network tab
- Vercel deployment logs
