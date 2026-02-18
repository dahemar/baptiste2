# Edit site content via Google Sheets (short guide)

This short guide explains what you need to edit in Google Sheets to update the site.

Quick summary
- The site reads a single spreadsheet (ID = `THEATRE_SHEET_ID`).
- Important tabs (exact names): `theatre_works`, `theatre-works-scenes`, `theatre-works-credits`.
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

How to add or edit videos (brief)
- Upload your video to your storage (Cloudflare R2 or other) and copy the public URL the service gives you.
- Paste that URL into the `video_url` field for the corresponding `scene_id` in `theatre-works-scenes`.
- Save the sheet and either wait for automatic refresh or call the `?force=1` endpoint.

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
