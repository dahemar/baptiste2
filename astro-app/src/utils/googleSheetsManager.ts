import fs from 'node:fs/promises';
import path from 'node:path';
import * as fsSync from 'node:fs';
import crypto from 'node:crypto';

const CACHE_PATH = path.resolve(process.cwd(), '.cache/theatre-works.json');

export async function loadFromCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    // Support two cache shapes:
    // - Array of works
    // - Object { fetchedAt, count, works }
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.works)) return parsed.works;
    // If it's some other object, return it as-is (fallback)
    return parsed;
  } catch {
    return null;
  }
}

export async function saveToCache(data: unknown) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// In-memory cache for this module
const cache = new Map<string, any>();
const CACHE_KEY = 'theatreWorks';

export function clearMemoryCache() {
  cache.delete(CACHE_KEY);
}

export async function fetchFromGoogleSheets(): Promise<any[]> {
  const CACHE_KEY = 'theatreWorks';
  // Return cached value if present
  if (cache.has(CACHE_KEY)) {
    const cached = cache.get(CACHE_KEY);
    if (Array.isArray(cached) && cached.length > 0) return cached;
  }

  let rows: any[] | null = null;

  // 1) Prefer an existing helper `getGoogleSheetRows()` if available (global)
  try {
    if (typeof (globalThis as any).getGoogleSheetRows === 'function') {
      rows = await (globalThis as any).getGoogleSheetRows();
    }
  } catch (e) {
    console.warn('fetchFromGoogleSheets: getGoogleSheetRows() failed', (e as any)?.message ?? e);
  }

  // 2) If not provided, try to fetch directly using Google Sheets API (env-configured)
  if (!Array.isArray(rows) || rows.length === 0) {
    const SHEET_ID = process.env.THEATRE_SHEET_ID ?? '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
    const API_KEY = process.env.GOOGLE_SHEETS_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (API_KEY) {
      // Attempt to fetch structured ranges for sections (WORKS, SCENES, VIDEOS, THUMBNAILS, AUDIO, CREDITS)
      const ranges = ['WORKS', 'SCENES', 'VIDEOS', 'THUMBNAILS', 'AUDIO', 'CREDITS'];
      const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${qs}&key=${API_KEY}`;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          const valueRanges = Array.isArray(data?.valueRanges) ? data.valueRanges : [];
          const combined: any[] = [];
          for (let i = 0; i < ranges.length; i++) {
            const sectionName = ranges[i];
            const vr = valueRanges[i];
            const vals = Array.isArray(vr?.values) ? vr.values : [];
            if (vals.length === 0) continue;
            // create a header row that parseTheatreWorks can recognize: ['WORKS','ID', 'Title', ...]
            const hdr = Array.isArray(vals[0]) ? vals[0] : vals[0];
            combined.push([sectionName, ...(hdr || [])]);
            for (let r = 1; r < vals.length; r++) {
              const row = Array.isArray(vals[r]) ? vals[r] : [vals[r]];
              combined.push([sectionName, ...row]);
            }
          }

          if (combined.length > 0) {
            rows = combined;
          } else {
            // fallback: try single range read of theatre_works
            const fallbackUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/theatre_works?key=${API_KEY}`;
            const fres = await fetch(fallbackUrl, { signal: controller.signal });
            if (fres.ok) {
              const fdata = await fres.json();
              rows = Array.isArray(fdata?.values) ? fdata.values : [];
            }
          }
        } else {
          console.warn('fetchFromGoogleSheets: Google Sheets API returned', res.status);
        }
      } catch (e) {
        console.warn('fetchFromGoogleSheets: failed to fetch from Google Sheets API', (e as any)?.message ?? e);
      } finally {
        clearTimeout(t);
      }
    } else {
      // No API key available
      rows = [];
    }
  }

  // 2b) Fallback: try loading from local CSV file if Google Sheets returned nothing
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('fetchFromGoogleSheets: trying local CSV fallback');
    const csvPaths = [
      path.resolve(process.cwd(), 'data', 'theatre-works.csv'),
      path.resolve(process.cwd(), 'data', 'theatre-works.csv.backup'),
      path.resolve(process.cwd(), 'astro-app', 'data', 'theatre-works.csv'),
      path.resolve(process.cwd(), 'astro-app', 'data', 'theatre-works.csv.backup'),
      path.resolve(process.cwd(), '..', 'astro-app', 'data', 'theatre-works.csv'),
      path.resolve(process.cwd(), '..', 'astro-app', 'data', 'theatre-works.csv.backup'),
      path.resolve(process.cwd(), 'baptiste-theatre_works-updated.csv'),
      path.resolve(process.cwd(), 'baptiste-theatre_works-releases.csv'),
    ];
    for (const csvPath of csvPaths) {
      try {
        if (!fsSync.existsSync(csvPath)) continue;
        const csvContent = await fs.readFile(csvPath, 'utf-8');
        const csvRows = csvContent.split('\n')
          .map(line => line.replace(/\r$/, ''))
          .filter(line => line.trim().length > 0)
          .map(line => {
            // Simple CSV split - handle fields but none of ours contain commas
            return line.split(',').map(f => f.trim());
          });
        if (csvRows.length > 0) {
          rows = csvRows;
          console.log(`fetchFromGoogleSheets: loaded ${rows.length} rows from CSV fallback: ${csvPath}`);
          break;
        }
      } catch (e) {
        console.warn(`fetchFromGoogleSheets: failed to read CSV ${csvPath}`, (e as any)?.message ?? e);
      }
    }
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    console.warn('fetchFromGoogleSheets: no rows obtained from any source');
    try { await saveToCache([]); } catch {}
    return [];
  }

  // 3) Parse rows using parseRow(row) if available, otherwise minimal header-based parser
  let parseRowFn: ((row: any) => any) | null = null;
  if (typeof (globalThis as any).parseRow === 'function') {
    parseRowFn = (globalThis as any).parseRow;
  }

  let parsed: any[] = [];
  // If rows is an array-of-arrays and appears to be the theatre worksheet sections,
  // prefer the structured `parseTheatreWorks` parser which builds works/scenes.
  if (Array.isArray(rows) && Array.isArray(rows[0]) && rows.some(r => Array.isArray(r) && String(r[0] || '').toUpperCase() === 'WORKS')) {
    try {
      parsed = parseTheatreWorks(rows as string[][]);
      // persist and return early
      cache.set(CACHE_KEY, parsed);
      try { await saveToCache(parsed); } catch (e) { console.warn('fetchFromGoogleSheets: saveToCache failed', e); }
      return parsed;
    } catch (e) {
      console.warn('fetchFromGoogleSheets: parseTheatreWorks failed, falling back', (e as any)?.message ?? e);
    }
  }
  if (parseRowFn) {
    try {
      parsed = rows.map((r: any) => parseRowFn!(r));
    } catch (e) {
      console.warn('fetchFromGoogleSheets: parseRow failed, falling back to header parser', (e as any)?.message ?? e);
      parseRowFn = null;
    }
  }

  if (!parseRowFn) {
    // Expect rows as array-of-arrays with first row headers
    const headers = Array.isArray(rows[0]) ? rows[0].map((h: any) => String(h ?? '').trim()) : [];
    parsed = rows.slice(headers.length ? 1 : 0).map((row: any) => {
      if (!Array.isArray(row)) return row;
      const obj: any = {};
      for (let i = 0; i < row.length; i++) {
        const key = headers[i] || `col${i}`;
        obj[key] = row[i] ?? null;
      }
      return obj;
    });
  }

  // 4) Cache and persist
  cache.set(CACHE_KEY, parsed);
  try { await saveToCache(parsed); } catch (e) { console.warn('fetchFromGoogleSheets: saveToCache failed', e); }

  return parsed;
}

// No side-effects on import

function parseTheatreWorks(rawValues: string[][]): any[] {
  if (!rawValues || rawValues.length < 2) return [];

  const works = new Map<string, any>();
  const scenes = new Map<string, any>();
  const videos = new Map<string, string>();
  const thumbnails = new Map<string, string>();
  const audio = new Map<string, string>();
  const credits = new Map<string, any[]>();
  const sectionHeaders: Record<string, string[]> = {};

  let currentSection = '';
  const isNumeric = (s: any) => typeof s === 'string' && /^\d+$/.test(s.trim());

  for (const row of rawValues) {
    if (!row || row.length === 0) continue;
    const first = String(row[0] || '').toUpperCase();

    if (['WORKS','SCENES','VIDEOS','AUDIO','CREDITS','THUMBNAILS'].includes(first)) {
      if (String(row[1] || '').toUpperCase() === 'ID') {
        currentSection = first;
        // Capture headers for this section (slice off the section column)
        sectionHeaders[currentSection] = row.slice(1).map((h: any) => String(h || '').trim());
        continue;
      }
      if (isNumeric(row[1])) { currentSection = first; }
    }

    if (currentSection === 'WORKS') {
      const headers = sectionHeaders['WORKS'] || [];
      const id = String(row[1] || '').trim();
      const title = String(row[2] || '').trim();
      if (id) {
        const meta: Record<string,string> = {};
        for (let i = 0; i < headers.length; i++) {
          const key = headers[i];
          if (!key) continue;
          meta[key] = String(row[i+1] || '').trim();
        }
        const isMusic = (meta['Tag'] || meta['tag'] || meta['Category'] || meta['type'] || '').toLowerCase().includes('music');
        works.set(id, { id, title: title || `Work ${id}`, scenes: [], meta, isMusic });
      }
    } else if (currentSection === 'SCENES') {
      const sceneId = String(row[1] || '').trim();
      const workId = String(row[2] || '').trim();
      const sceneName = String(row[3] || '').trim();
      if (sceneId && workId) scenes.set(sceneId, { sceneId, workId, name: sceneName });
    } else if (currentSection === 'VIDEOS') {
      const videoId = String(row[1] || '').trim();
      const sceneId = String(row[2] || '').trim();
      const videoFile = String(row[3] || '').trim();
      if (sceneId && videoFile) videos.set(sceneId, videoFile.replace(/^\./, ''));
    } else if (currentSection === 'THUMBNAILS') {
      const sceneId = String(row[2] || '').trim();
      const imageFile = String(row[3] || '').trim();
      if (sceneId && imageFile) thumbnails.set(sceneId, imageFile.replace(/^\./, ''));
    } else if (currentSection === 'AUDIO') {
      const sceneId = String(row[2] || '').trim();
      const audioFile = String(row[3] || '').trim();
      if (sceneId && audioFile) audio.set(sceneId, audioFile.replace(/^\./, ''));
    } else if (currentSection === 'CREDITS') {
      const workId = String(row[2] || '').trim();
      const role = String(row[3] || '').trim();
      const name = String(row[4] || '').trim();
      if (workId && role) {
        if (!credits.has(workId)) credits.set(workId, []);
        credits.get(workId)?.push({ role, name });
      }
    }
  }

  function findLocalThumbByBaseName(baseName: string): string | undefined {
    if (!baseName) return undefined;
    const key = baseName
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');

    const possibleDirs = [
      path.resolve(process.cwd(), 'public', 'assets', 'images', 'thumbnails'),
      path.resolve(process.cwd(), 'astro-app', 'public', 'assets', 'images', 'thumbnails'),
      path.resolve(process.cwd(), '..', 'astro-app', 'public', 'assets', 'images', 'thumbnails')
    ];

    for (const d of possibleDirs) {
      try {
        if (!fsSync.existsSync(d)) continue;
        const files = fsSync.readdirSync(d);
        for (const f of files) {
          const base = f.replace(/\.[^.]+$/, '');
          const fkey = base
            .normalize('NFD').replace(/\p{Diacritic}/gu, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
          if (fkey === key) return `/assets/images/thumbnails/${f}`;
        }
      } catch (e) {
        // ignore
      }
    }
    return undefined;
  }

  function resolveLocalFromThumbUrl(maybeUrl: string): string | undefined {
    try {
      const u = new URL(maybeUrl);
      const base = decodeURIComponent(u.pathname.split('/').pop() || '');
      const baseNoExt = base.replace(/\.[^.]+$/, '');
      return findLocalThumbByBaseName(baseNoExt) || undefined;
    } catch (e) {
      return undefined;
    }
  }

  for (const [sceneId, s] of scenes.entries()) {
    const work = works.get(s.workId);
    if (!work) continue;
    const videoUrl = normalizeVideoUrl(videos.get(sceneId) || '');

    // Prefer sheet thumbnail but attempt to resolve to a local file if possible
    let thumb = thumbnails.get(sceneId) || undefined;

    const tryResolveLocalFromName = (name: string | undefined) => {
      if (!name) return undefined;
      // If it's an absolute public path, accept as-is
      if (name.startsWith('/assets/')) return name;
      // If it's a full URL, try to resolve local based on its basename
      if (name.startsWith('http')) {
        return resolveLocalFromThumbUrl(name);
      }
      // Otherwise treat as a bare filename and try local candidates
      const base = decodeURIComponent((name || '').split('/').pop() || '');
      const baseNoExt = base.replace(/\.[^.]+$/, '');
      const candidate = findLocalThumbByBaseName(baseNoExt) || undefined;
      // If we couldn't find a local match, return undefined (do not emit a dotted public path)
      return candidate;
    };

    if (thumb) {
      const resolved = tryResolveLocalFromName(thumb);
      if (resolved) {
        thumb = resolved; // prefer local resolution
        console.log('[parseTheatreWorks] resolved sheet thumbnail to local', { workId: s.workId, sceneId, original: thumbnails.get(sceneId), resolved: thumb });
      } else if (!thumb.startsWith('/') && !thumb.startsWith('http')) {
        // If the sheet provided a bare filename but we couldn't resolve it, try deriving from video instead
        console.log('[parseTheatreWorks] sheet thumbnail not found locally, will try derive from video', { workId: s.workId, sceneId, original: thumbnails.get(sceneId) });
      } else if (thumb.startsWith('http')) {
        console.log('[parseTheatreWorks] sheet thumbnail left as remote url', { workId: s.workId, sceneId, thumb });
      }
    }

    // If this work is music-tagged, prefer local (derive) thumbnails
    if (work?.isMusic) {
      const localFromVideo = deriveThumbnailFromVideoUrl(videoUrl);
      if (localFromVideo) thumb = localFromVideo;
    }

    // Final fallback: derive from video
    if (!thumb) {
      const derived = deriveThumbnailFromVideoUrl(videoUrl);
      thumb = derived;
      console.log('[parseTheatreWorks] derived thumbnail from video', { workId: s.workId, sceneId, derived });
    }

    // If thumbnail is a remote URL, rewrite to dev thumbnail proxy so thumbnails load fast and can be cached locally
    // Skip proxy for R2 URLs (they are already fast and have proper CORS)
    if (thumb && typeof thumb === 'string' && thumb.startsWith('http')) {
      try {
        const thumbUrl = new URL(thumb);
        // Only proxy GitHub/S3 thumbnails, not R2
        if (!thumbUrl.hostname.includes('r2.dev')) {
          thumb = `/api/thumb/${encodeURIComponent(thumb)}`;
        }
      } catch (e) {
        // ignore
      }
    }

    // Provide an optional proxied video URL for hosts that block CORS so dev can proxy through the server
    let proxiedVideoUrl: string | undefined = undefined;
    try {
      const u = new URL(videoUrl);
      if (
        ['github.com', 'release-assets.githubusercontent.com'].includes(u.hostname) ||
        u.hostname.endsWith('.s3.amazonaws.com') ||
        u.hostname.endsWith('.r2.dev')
      ) {
        // Use path-encoded form to avoid query parsing issues in dev proxy
        proxiedVideoUrl = `/api/proxy/${encodeURIComponent(videoUrl)}`;
      }
    } catch {}

    // Prefer proxied path URL as the canonical `videoUrl` so client-side uses the safe form
    const canonicalVideoUrl = proxiedVideoUrl ?? videoUrl;
    work.scenes.push({ id: `${s.workId}-scene-${work.scenes.length}`, videoUrl: canonicalVideoUrl, proxiedVideoUrl, thumbnail: thumb });
  }

  for (const [workId, cs] of credits.entries()) {
    const w = works.get(workId);
    if (w) w.credits = cs;
  }

  // Debug: summary counts
  console.debug('[parseTheatreWorks] completed', { works: works.size, scenes: scenes.size });

  return Array.from(works.values());
}

function normalizeVideoUrl(url: string): string {
  if (!url) return '';
  if (!url.startsWith('http') && !url.startsWith('/')) return `/${url}`;
  return url;
}

function normalizeCandidatesFromBase(base: string): string[] {
  if (!base) return [];
  const decoded = decodeURIComponent(base);
  const nameNoExt = decoded.replace(/\.[^.]+$/, '');
  const out = new Set<string>();
  out.add(`${nameNoExt}.jpg`);
  out.add(`${nameNoExt.replace(/\./g, ' ')}.jpg`);
  out.add(`${decoded}`);
  // also try removing diacritics
  const noDiacritics = nameNoExt.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  out.add(`${noDiacritics}.jpg`);
  out.add(`${noDiacritics.replace(/\./g, ' ')}.jpg`);
  // spaces -> dots variant
  out.add(`${nameNoExt.replace(/ /g, '.')}.jpg`);
  return Array.from(out);
}

function deriveThumbnailFromVideoUrl(videoUrl: string): string | undefined {
  if (!videoUrl) return undefined;
  try {
    // normalize URL and extract base name
    const urlObj = new URL(videoUrl, 'https://example.org');
    const pathname = decodeURIComponent(urlObj.pathname || '');
    const base = pathname.split('/').pop() || '';

    // Build a normalized lookup of actual thumbnail filenames to handle inconsistent naming
    const possibleDirs = [
      path.resolve(process.cwd(), 'public', 'assets', 'images', 'thumbnails'),
      path.resolve(process.cwd(), 'astro-app', 'public', 'assets', 'images', 'thumbnails'),
      path.resolve(process.cwd(), '..', 'astro-app', 'public', 'assets', 'images', 'thumbnails')
    ];

    const lookup: Record<string, string> = {};
    for (const thumbDir of possibleDirs) {
      try {
        if (!fsSync.existsSync(thumbDir)) continue;
        const files = fsSync.readdirSync(thumbDir);
        for (const f of files) {
          // drop extension then normalize filename to key: lowercase, remove diacritics, replace non-alphanum with space, collapse spaces
          const baseName = f.replace(/\.[^.]+$/, '');
          const key = baseName
            .normalize('NFD').replace(/\p{Diacritic}/gu, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
          lookup[key] = f;
        }
      } catch (e) {
        // ignore
      }
    }

    const probeKeys = (candidateBase: string) => {
      const key = candidateBase
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
      if (lookup[key]) return `/assets/images/thumbnails/${lookup[key]}`;
      return undefined;
    };

    // Try probing by derived candidates
    const candidates = normalizeCandidatesFromBase(base);
    for (const cand of candidates) {
      const res = probeKeys(cand.replace(/\.jpg$/i, ''));
      if (res) return res;
    }

    // Also probe by the raw base (without ext) and by splitting dots to spaces
    const rawProbe = probeKeys(base.replace(/\.jpg$/i, '').replace(/\.[^.]+$/, ''));
    if (rawProbe) return rawProbe;

    // fallback to generated path (may be remote in sheet); try mp4 and hls heuristics
    const mp4Match = videoUrl.match(/\/([^\/\?#]+)\.mp4(?:[\?#].*)?$/i);
    if (mp4Match?.[1]) {
      const gen = `${mp4Match[1]}.jpg`;
      const genProbe = probeKeys(mp4Match[1]);
      if (genProbe) return genProbe;
      return `/assets/images/thumbnails/${gen}`;
    }
    const hlsMatch = videoUrl.match(/\/hls\/([^\/]+)\//i);
    if (hlsMatch?.[1]) return `/assets/images/thumbnails/${hlsMatch[1]}.jpg`;
  } catch (e) {
    // ignore and fallback
  }
  return undefined;
}

// Convenience wrapper expected by older code: load theatre works from cache then Google Sheets
export async function loadTheatreWorksData(options?: { force?: boolean }) {
  const force = !!(options && options.force);

  if (!force) {
    try {
      const cached = await loadFromCache();
      if (Array.isArray(cached) && cached.length > 0) {
        // Check if cache is stale: scenes should have proxiedVideoUrl and thumbnail
        const firstScene = cached[0]?.scenes?.[0];
        const hasR2WithoutProxy = !!(
          firstScene &&
          typeof firstScene.videoUrl === 'string' &&
          firstScene.videoUrl.includes('.r2.dev') &&
          !firstScene.proxiedVideoUrl
        );
        const isStale = (firstScene && !firstScene.proxiedVideoUrl && !firstScene.thumbnail) || hasR2WithoutProxy;
        if (isStale) {
          console.warn('loadTheatreWorksData: cache appears stale (no proxiedVideoUrl/thumbnail), forcing refresh');
        } else {
          return cached;
        }
      }
    } catch (e) {
      console.warn('loadTheatreWorksData: loadFromCache failed', (e as any)?.message ?? e);
    }
  }

  try {
    const fetched = await fetchFromGoogleSheets();
    if (Array.isArray(fetched) && fetched.length > 0) return fetched;
  } catch (e) {
    console.warn('loadTheatreWorksData: fetchFromGoogleSheets failed', (e as any)?.message ?? e);
  }

  // Background: prefetch thumbnails for any remote thumb entries in cache
  try {
    const maybeCached = await loadFromCache();
    if (Array.isArray(maybeCached) && maybeCached.length > 0) {
      setTimeout(() => {
        void prefetchThumbnails(maybeCached);
      }, 1000);
    }
  } catch (e) {
    // ignore
  }

  // Final fallback to cache (may be empty array)
  try {
    const fallback = await loadFromCache();
    if (Array.isArray(fallback)) return fallback;
  } catch (e) {
    // ignore
  }

  return [];
}

const defaultExport = {
  loadTheatreWorksData,
  loadFromCache,
  saveToCache,
  fetchFromGoogleSheets,
  clearMemoryCache,
};

export default defaultExport;

async function prefetchThumbnails(works: any[]) {
  try {
    const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'thumbs');
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const tasks: string[] = [];
    for (const w of works) {
      for (const s of (w.scenes || [])) {
        const t = s.thumbnail;
        if (!t) continue;
        // thumbnails rewritten to /api/thumb/<encoded> for remote URLs
        if (typeof t === 'string' && t.startsWith('/api/thumb/')) {
          const enc = t.replace('/api/thumb/', '');
          let remote: string;
          try { remote = decodeURIComponent(enc); } catch { remote = enc; }
          tasks.push(remote);
        }
      }
    }

    const unique = Array.from(new Set(tasks));
    const CONC = 4;
    for (let i = 0; i < unique.length; i += CONC) {
      const batch = unique.slice(i, i + CONC).map(async (remote) => {
        try {
          const ext = (path.extname(new URL(remote).pathname) || '').replace(/^\./, '') || 'jpg';
          const fname = crypto.createHash('sha1').update(remote).digest('hex') + '.' + ext;
          const filePath = path.join(CACHE_DIR, fname);
          if (fsSync.existsSync(filePath)) return;
          const controller = new AbortController();
          const to = setTimeout(() => controller.abort(), 7000);
          const res = await fetch(remote, { signal: controller.signal, redirect: 'follow' }).catch(() => null);
          clearTimeout(to);
          if (!res || !res.ok) return;
          const ab = await res.arrayBuffer().catch(() => null);
          if (!ab) return;
          await fs.writeFile(filePath + '.tmp', Buffer.from(ab));
          try { await fs.rename(filePath + '.tmp', filePath); } catch (e) { /* ignore */ }
        } catch (e) {
          // ignore individual failures
        }
      });
      await Promise.allSettled(batch);
    }
  } catch (e) {
    // ignore
  }
}
