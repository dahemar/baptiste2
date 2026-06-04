# Edit site content via Google Sheets (short guide)

This short guide explains what you need to edit in Google Sheets to update the site.

Quick summary
- The site reads a single spreadsheet (ID = `THEATRE_SHEET_ID`).
- Important tabs (exact names): `theatre_works`, `theatre-works-scenes`, `theatre-works-credits`, `files`, `about`, `music`, `audiovisual`, `contact`.
- Video URLs in the sheet should be the public URLs you get from your storage (e.g. Cloudflare R2).

Only one manual step on the site: to force an immediate refresh call
`https://www.YOUR_DOMAIN/api/theatre-works?force=1` (or use the automatic webhook).

Google Sheets: tabs and columns (what you need to edit)
- `theatre_works` (one row per project/work)
  - Required columns: `work_slug`, `title`.
  - Optional metadata columns: `author`, `year`, `tag`, etc.
  - `work_slug` must be unique and is used to link scenes and credits.

- `theatre-works-scenes` (one row per scene)
  - Required columns: `scene_id`, `work_slug`, `scene_order`, `scene_title`, `video_url`.
  - `work_slug` must match a value in `theatre_works`.
  - `video_url` must be a public, fully qualified URL (the site expects the public link you obtained from your storage provider).

- `theatre-works-credits` (optional)
  - Columns: `work_slug`, `role`, `name`, `order`.
  - Use `work_slug` to attach credits to the right work.

- `files` (desktop **files** player — separate from scene videos; preferred tab name)
  - Same columns as `theatre-audio` (legacy alias, still supported).
  - Required columns: `filename`, `audio_url`.
  - Optional: `id`, `work_title`, `order`.
  - `audio_url` must be a public MP3 (or other audio) URL on R2/S3.

- `about` (bio + presentation on `/about` and `/contact` redirect)
  - Columns: `key`, `value_en`, `value_fr`.
  - Keys: `presentation_title`, `presentation_intro`, `presentation_theatre`, `presentation_music`, `presentation_audiovisual`, `presentation_image`, `bio_p1` … `bio_p4`, `contact_email`, `contact_instagram`.

How to add or edit videos (brief)
- Upload your video to your storage (Cloudflare R2 or other) and copy the public URL the service gives you.
- Paste that URL into the `video_url` field for the corresponding `scene_id` in `theatre-works-scenes`.
- Save the sheet and either wait for automatic refresh or call the `?force=1` endpoint.

Theatre audio files (desktop **files** tab)
1. Upload an `.mp3` to R2 and copy the public URL.
2. Edit tab **`files`** (header: `id`, `filename`, `audio_url`, `work_title`, `order`).
3. Add one row per file (example):

   `test-chien-kora` | `Chien Kora (audio test)` | `https://pub-...r2.dev/.../my-file.mp3` | `Rectum Crocodile` | `1`

4. Reload the site (or call `?force=1` on theatre-works API).

About / bio (`about` tab)
- Edit bilingual copy in columns `value_en` / `value_fr` (see keys above).
- Local dev fallback: `astro-app/data/about.csv` when the tab is missing.

Music (`music` tab — `/music`, grouped by **project**)
- One row per release.
- Columns: `id`, `title`, `format`, `year`, `type`, `cover_key`, `cover_url`, `url`, `all_releases_url`, `project`, `project_order`.
- `project`: section heading (e.g. `Apulati Bien`, `IVM Trio`, `XOLOT`). Use a new name on new rows to add a project later.
- `project_order`: section order on the page (1 = first). Within a project, releases sort by `sort_order` / year / id.
- `type` (`album`, `ep`, …) is optional metadata; the site no longer groups by format.
- Local dev fallback: `astro-app/data/music.csv`.
- Upgrade an existing sheet: Apps Script → paste `scripts/apps-script-upgrade-music-by-project.gs` → run `upgradeMusicTabByProject`.

Install missing tabs (one-time)
- **Easiest (no service account):** open the spreadsheet → Extensions → Apps Script → paste `scripts/apps-script-sync-about-and-files.gs` → run `installAboutAndFilesTabs`.
- **CLI (service account):** share the sheet with the SA email, then `node scripts/sync_content_tabs_to_sheets.js` (writes `about`, `files`, `music` from `astro-app/data/`).
- Seed CSV copies for manual import: `astro-app/public/sheet-seeds/` (`about.csv`, `files.csv`, `music.csv`).

Note: the Google Sheets **API key** can only **read** public data. Creating tabs requires Apps Script or a service account (OAuth).

Upload helper (R2 + append row to `files` tab): `node scripts/upload_theatre_audio_sample.mjs`

Minimal workflow example
1. Add a new row to `theatre_works` with a new `work_slug` and `title`.
2. Add rows to `theatre-works-scenes` with `work_slug` matching the new work; set `video_url` to the uploaded public video link.
3. (Optional) Add rows to `theatre-works-credits` using the same `work_slug`.
4. Force refresh: click this link to reload the sheet immediately:

  https://www.blechapelain.work/api/theatre-works?force=1

Manual action required
- The only manual action you need is to click the link above after editing the sheet (or rely on the automatic webhook). That triggers the server to clear its memory cache and read the latest spreadsheet data.

What the key fields mean (brief)
- `work_slug`: short unique identifier for a work/project. It's used to group scenes and attach credits. Keep it simple (no spaces or special chars), e.g. `concours-de-larmes`.
- `scene_id`: unique identifier for each scene row; used internally to map videos/thumbnails. It can be any unique string (for example `1-scene-0`).
- `scene_order`: numeric order of the scene within its work; the client uses this to sort scenes.
- `video_url`: public, fully qualified URL to the video file (this should be the public link from your storage provider).

Where to look in the repo
- Google Sheets loader: `src/utils/googleSheetsManager.ts`
- Section loaders: `src/utils/sectionContentManager.ts`
- Force-reload endpoint: `/api/theatre-works?force=1`
- Automatic webhook (optional): `/api/webhook/refresh-theatre`

If you want, I can add one example row per tab to this file (very brief) so non-technical editors can copy/paste.
