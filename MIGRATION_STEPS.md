# 🚀 Quick Start: R2 Migration

## What I've prepared for you:

✅ Migration script that downloads all 34 videos and uploads to R2  
✅ CSV update script to replace GitHub URLs with R2 URLs  
✅ Verification script to test all videos are accessible  
✅ Setup checker to verify prerequisites  
✅ Complete documentation in `R2_MIGRATION_GUIDE.md`

## Your action items (15 minutes):

### 1. Create R2 API Token (5 min)

Go to: https://dash.cloudflare.com/7305104bf22993d080aa24f59e6a8465/r2/api-tokens

1. Click **"Create API Token"**
2. Permissions: Select **"Admin Read & Write"** (or at minimum "Object Read & Write" + "Bucket Read & Write")
3. Copy the credentials shown:
   - **Access Key ID**: starts with `...`
   - **Secret Access Key**: long string

### 2. Set Environment Variables

```bash
export R2_ACCESS_KEY_ID='paste-your-access-key-id-here'
export R2_SECRET_ACCESS_KEY='paste-your-secret-access-key-here'
```

💡 To make permanent, add to `~/.zshrc`:
```bash
echo "export R2_ACCESS_KEY_ID='your-key'" >> ~/.zshrc
echo "export R2_SECRET_ACCESS_KEY='your-secret'" >> ~/.zshrc
source ~/.zshrc
```

### 3. Check Prerequisites

```bash
npm run r2:check
```

Should show:
```
✓ AWS CLI installed
✓ R2 credentials set
✓ All prerequisites met!
```

If AWS CLI is missing:
```bash
brew install awscli
```

### 4. Run Migration (5-10 min)

```bash
npm run r2:migrate
```

This will:
- Download all 34 videos from GitHub (to `/tmp/baptiste-videos-migration/`)
- Create bucket `baptiste-videos` in your R2 account
- Upload all videos with optimal cache headers
- Take 5-10 minutes depending on your connection

### 5. Enable Public Access (2 min)

Go to: https://dash.cloudflare.com/7305104bf22993d080aa24f59e6a8465/r2/default/buckets/baptiste-videos/settings

1. Scroll to **"Public Access"** section
2. Click **"Allow Access"**
3. **Copy the R2.dev URL** shown (looks like: `https://pub-abc123.r2.dev`)

### 6. Update CSV with R2 URLs (1 min)

Edit `scripts/update-csv-for-r2.js` line 13:

```javascript
const R2_PUBLIC_URL = 'https://pub-YOUR-SUBDOMAIN.r2.dev';  // paste your URL from step 5
```

Then run:
```bash
npm run r2:update-csv
```

### 7. Verify Migration

```bash
npm run r2:verify
```

Should show all 34 videos accessible with 200 status.

### 8. Test Locally

```bash
cd astro-app
rm -f .cache/theatre-works.json  # clear cache
npm run dev
```

Open http://localhost:4321 and verify videos play correctly.

### 9. Deploy

```bash
git add -A
git commit -m "feat: migrate videos to Cloudflare R2"
git push baptiste2 main
```

Vercel will auto-deploy. Check https://baptiste2.vercel.app after ~2 minutes.

## Result:

- ✅ 1.71 GB video storage in R2 free tier
- ✅ Zero egress fees (was costing you money in Vercel)
- ✅ Global CDN caching
- ✅ Videos load faster for users worldwide
- ✅ `/api/proxy` no longer needed (can be removed)

## Need help?

- Full details: See `R2_MIGRATION_GUIDE.md`
- Stuck? Check the troubleshooting section in the guide
- CORS issues? Add CORS policy in R2 bucket settings (documented in guide)

## Cleanup (optional)

Once verified working in production, you can:
1. Delete GitHub Release assets (free up GitHub storage)
2. Remove `/api/proxy` code (no longer needed)
3. Remove proxy-related code in `googleSheetsManager.ts`
