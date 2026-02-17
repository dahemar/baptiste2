# Cloudflare R2 CORS Configuration

## Issue
Videos hosted on R2 play without audio because the bucket lacks CORS headers. Browsers require proper CORS configuration for cross-origin media access.

## Solution
Configure CORS policy in Cloudflare R2 dashboard:

### Steps:
1. Go to: https://dash.cloudflare.com/7305104bf22993d080aa24f59e6a8465/r2/default/buckets/baptiste-videos/settings
2. Navigate to **CORS Policy** section
3. Add the following CORS rule:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:4321",
      "http://[::1]:4321",
      "https://baptiste2.vercel.app",
      "https://*.vercel.app"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD"
    ],
    "AllowedHeaders": [
      "Range",
      "Content-Type"
    ],
    "ExposeHeaders": [
      "Content-Length",
      "Content-Range",
      "Content-Type"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

4. Save the configuration

## Verification
After configuring CORS, test with:
```bash
curl -I -H "Origin: http://localhost:4321" https://pub-16fb774f4ada4a69b6c70bc856201eeb.r2.dev/Elie.Concours.1.mp4
```

You should see:
```
Access-Control-Allow-Origin: http://localhost:4321
Access-Control-Expose-Headers: Content-Length, Content-Range, Content-Type
```

## What This Fixes
- ✅ Audio playback from R2 videos in local development
- ✅ Audio playback from R2 videos in production (Vercel)
- ✅ Cross-origin media access compliance with browser policies
- ✅ Proper Range request handling for video seeking

## Alternative (Not Recommended)
If you cannot access Cloudflare dashboard immediately, you could temporarily proxy R2 URLs through the Astro API proxy (reverting the CSV changes), but this defeats the purpose of the R2 migration (cost reduction).
