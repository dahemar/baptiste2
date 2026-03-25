import fs from 'node:fs/promises';
import path from 'node:path';
import * as fsSync from 'node:fs';
import crypto from 'node:crypto';

const CACHE_PATH = path.resolve(process.cwd(), '.cache/theatre-works.json');

// In Vercel runtime we want the canonical source of truth to be Google Sheets.
// Avoid shipping/using stale on-disk caches or local CSV fallbacks.
const IS_VERCEL_RUNTIME = !!process.env.VERCEL;

const OLD_R2_PUBLIC_HOST = 'pub-16fb774f4ada4a69b6c70bc856201eeb.r2.dev';
const NEW_R2_PUBLIC_HOST = 'pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev';

function rewriteR2PublicUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    if (u.hostname === OLD_R2_PUBLIC_HOST) {
      u.hostname = NEW_R2_PUBLIC_HOST;
      u.protocol = 'https:';
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function rewritePossiblyProxiedVideoUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/api/proxy/')) {
    const encoded = url.slice('/api/proxy/'.length);
    try {
      const decoded = decodeURIComponent(encoded);
      // Prefer returning the canonical upstream URL (not the Vercel proxy path).
      // This prevents large binaries (video) from being streamed through Vercel in production.
      const rewritten = rewriteR2PublicUrl(decoded);
      if (rewritten.startsWith('http://') || rewritten.startsWith('https://')) return rewritten;
    } catch {
      // leave as-is
    }
    return url;
  }
  return rewriteR2PublicUrl(url);
}

export async function loadFromCache() {
  if (IS_VERCEL_RUNTIME) return null;
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
  if (IS_VERCEL_RUNTIME) return;
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// In-memory cache for this module
const cache = new Map<string, any>();
const CACHE_KEY = 'theatreWorks';

export function clearMemoryCache() {
  cache.delete(CACHE_KEY);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  out.push(current.trim());
  return out;
}

function parseCsvTextRows(csvContent: string): string[][] {
  return (csvContent || '')
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.trim().length > 0)
    .map(line => parseCsvLine(line));
}

function inferTheatreSectionName(rangeOrTabName: string): string {
  const upper = String(rangeOrTabName || '').toUpperCase();
  if (upper.includes('SCENE')) return 'SCENES';
  if (upper.includes('CREDIT')) return 'CREDITS';
  if (upper.includes('WORK')) return 'WORKS';
  return upper;
}

async function fetchGvizSheetAsRows(sheetId: string, sheetName: string, timeoutMs = 10000): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const text = await res.text();
    return parseCsvTextRows(text);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function fetchTheatreDataViaGviz(sheetId: string): Promise<any[] | null> {
  if (!sheetId) return null;
  // IMPORTANT:
  // When `sheet=` points to a non-existent tab, gviz often returns the *first* tab.
  // That creates silent mis-parses (e.g. treating WORKS columns as SCENES), leading to empty videoUrl.
  // So: only fetch tab names we know exist for this spreadsheet.
  const trySheets = ['theatre_works', 'theatre-works-scenes', 'theatre-works-credits'];

  const combined: any[] = [];
  const pushSection = (rangeName: string, vals: any[]) => {
    if (!Array.isArray(vals) || vals.length === 0) return;
    const sectionName = inferTheatreSectionName(rangeName);
    const hdr = Array.isArray(vals[0]) ? vals[0] : [vals[0]];
    combined.push([sectionName, ...(hdr || [])]);
    for (let r = 1; r < vals.length; r++) {
      const row = Array.isArray(vals[r]) ? vals[r] : [vals[r]];
      combined.push([sectionName, ...row]);
    }
  };

  for (const tab of trySheets) {
    const vals = await fetchGvizSheetAsRows(sheetId, tab, 10000);
    if (!vals || vals.length === 0) continue;
    pushSection(tab, vals);
  }

  if (combined.length === 0) return null;
  try {
    return parseTheatreWorks(combined as string[][]);
  } catch {
    return null;
  }
}

async function readCsvRows(filePath: string): Promise<string[][]> {
  const csvContent = await fs.readFile(filePath, 'utf-8');
  return csvContent
    .split('\n')
    .map(line => line.replace(/\r$/, ''))
    .filter(line => line.trim().length > 0)
    .map(line => parseCsvLine(line));
}

async function loadSimplifiedTheatreRowsFromCsv(): Promise<string[][] | null> {
  const dataDirs = [
    path.resolve(process.cwd(), 'data'),
    path.resolve(process.cwd(), 'astro-app', 'data'),
    path.resolve(process.cwd(), '..', 'astro-app', 'data'),
  ];

  for (const dir of dataDirs) {
    const worksPath = path.join(dir, 'theatre-works-works.csv');
    const scenesPath = path.join(dir, 'theatre-works-scenes.csv');
    const creditsPath = path.join(dir, 'theatre-works-credits.csv');

    if (!fsSync.existsSync(worksPath) || !fsSync.existsSync(scenesPath)) {
      continue;
    }

    try {
      const combined: string[][] = [];
      const worksRows = await readCsvRows(worksPath);
      if (worksRows.length > 0) {
        combined.push(['WORKS', ...(worksRows[0] || [])]);
        for (const row of worksRows.slice(1)) combined.push(['WORKS', ...row]);
      }

      const scenesRows = await readCsvRows(scenesPath);
      if (scenesRows.length > 0) {
        combined.push(['SCENES', ...(scenesRows[0] || [])]);
        for (const row of scenesRows.slice(1)) combined.push(['SCENES', ...row]);
      }

      if (fsSync.existsSync(creditsPath)) {
        const creditsRows = await readCsvRows(creditsPath);
        if (creditsRows.length > 0) {
          combined.push(['CREDITS', ...(creditsRows[0] || [])]);
          for (const row of creditsRows.slice(1)) combined.push(['CREDITS', ...row]);
        }
      }

      if (combined.length > 0) {
        console.log(`fetchFromGoogleSheets: loaded simplified theatre CSV set from ${dir}`);
        return combined;
      }
    } catch (e) {
      console.warn(`fetchFromGoogleSheets: failed simplified CSV set in ${dir}`, (e as any)?.message ?? e);
    }
  }

  return null;
}

export async function fetchFromGoogleSheets(): Promise<any[]> {
  const CACHE_KEY = 'theatreWorks';
  // Return cached value if present
  if (!IS_VERCEL_RUNTIME && cache.has(CACHE_KEY)) {
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
      const batchGetCombinedRows = async (ranges: string[]) => {
        const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${qs}&key=${API_KEY}`;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 10000);
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) return [] as any[];
          const data = await res.json();
          const valueRanges = Array.isArray(data?.valueRanges) ? data.valueRanges : [];
          const combined: any[] = [];
          for (let i = 0; i < ranges.length; i++) {
            const rangeName = ranges[i];
            const vr = valueRanges[i];
            const vals = Array.isArray(vr?.values) ? vr.values : [];
            if (vals.length === 0) continue;

            const sectionName = inferTheatreSectionName(rangeName);

            const hdr = Array.isArray(vals[0]) ? vals[0] : [vals[0]];
            combined.push([sectionName, ...(hdr || [])]);
            for (let r = 1; r < vals.length; r++) {
              const row = Array.isArray(vals[r]) ? vals[r] : [vals[r]];
              combined.push([sectionName, ...row]);
            }
          }
          return combined;
        } catch {
          return [] as any[];
        } finally {
          clearTimeout(t);
        }
      };

      // 2a) Preferred human-friendly schema first (easy manual edits with direct R2 URLs)
      const envRanges = [
        process.env.THEATRE_WORKS_RANGE,
        process.env.THEATRE_SCENES_RANGE,
        process.env.THEATRE_CREDITS_RANGE,
      ].filter(Boolean) as string[];

      // Default to the actual tab names in this spreadsheet.
      // Important: do NOT include invalid/guessed ranges in the same batchGet, or Google returns 400 for the whole request.
      const humanRanges = envRanges.length > 0
        ? envRanges
        : ['theatre_works', 'theatre-works-scenes', 'theatre-works-credits'];
      const humanCombined = await batchGetCombinedRows(humanRanges);
      if (humanCombined.length > 0) {
        rows = humanCombined;
      }

      // 2b) Legacy structured ranges fallback
      if (!Array.isArray(rows) || rows.length === 0) {
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
      }

      // If Sheets API attempts didn't yield any rows on Vercel, fall back dynamically to gviz export.
      if (IS_VERCEL_RUNTIME && (!Array.isArray(rows) || rows.length === 0)) {
        const viaGviz = await fetchTheatreDataViaGviz(SHEET_ID);
        if (Array.isArray(viaGviz) && viaGviz.length > 0) {
          return viaGviz;
        }
      }
    } else {
      // No API key available. On Vercel runtime we still want to load dynamically from Sheets.
      // Use the public gviz CSV export (requires the sheet/tabs to be accessible).
      if (SHEET_ID) {
        const viaGviz = await fetchTheatreDataViaGviz(SHEET_ID);
        if (Array.isArray(viaGviz) && viaGviz.length > 0) return viaGviz;
      }
    }
  }

  // 2b) Fallback: try loading from local CSV file if Google Sheets returned nothing.
  // Disabled on Vercel runtime to ensure data is always sourced dynamically from Google Sheets.
  if (!IS_VERCEL_RUNTIME && (!Array.isArray(rows) || rows.length === 0)) {
    console.log('fetchFromGoogleSheets: trying local CSV fallback');

    rows = await loadSimplifiedTheatreRowsFromCsv();

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
      if (Array.isArray(rows) && rows.length > 0) break;
      try {
        if (!fsSync.existsSync(csvPath)) continue;
        const csvRows = await readCsvRows(csvPath);
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
      // persist and return early (disabled on Vercel runtime)
      if (!IS_VERCEL_RUNTIME) {
        cache.set(CACHE_KEY, parsed);
        try { await saveToCache(parsed); } catch (e) { console.warn('fetchFromGoogleSheets: saveToCache failed', e); }
      }
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

  // 4) Cache and persist (disabled on Vercel runtime)
  if (!IS_VERCEL_RUNTIME) {
    cache.set(CACHE_KEY, parsed);
    try { await saveToCache(parsed); } catch (e) { console.warn('fetchFromGoogleSheets: saveToCache failed', e); }
  }

  return parsed;
}

// No side-effects on import

function parseTheatreWorks(rawValues: string[][]): any[] {
  if (!rawValues || rawValues.length < 2) return [];

  const works = new Map<string, any>();
  const scenes = new Map<string, any>();
  const videos = new Map<string, string>();
  const thumbnails = new Map<string, string>();
  const credits = new Map<string, any[]>();
  const sectionHeaders: Record<string, string[]> = {};

  let currentSection = '';
  const normalizeHeader = (value: any) => String(value || '').trim().toLowerCase();
  const sectionNames = ['WORKS', 'SCENES', 'VIDEOS', 'CREDITS', 'THUMBNAILS'];

  const getValueByAliases = (section: string, row: string[], aliases: string[], fallbackIndex?: number) => {
    const headers = sectionHeaders[section] || [];
    const aliasSet = new Set(aliases.map((a) => normalizeHeader(a)));
    for (let idx = 0; idx < headers.length; idx++) {
      const header = normalizeHeader(headers[idx]);
      if (aliasSet.has(header)) {
        return String(row[idx + 1] || '').trim();
      }
    }
    if (typeof fallbackIndex === 'number') {
      return String(row[fallbackIndex] || '').trim();
    }
    return '';
  };

  const normalizeAssetPath = (value: string) => String(value || '').trim().replace(/^\./, '');

  for (const row of rawValues) {
    if (!row || row.length === 0) continue;
    const first = String(row[0] || '').toUpperCase();

    if (sectionNames.includes(first)) {
      const second = String(row[1] || '').trim();
      const hasHeaderForSection = Array.isArray(sectionHeaders[first]) && sectionHeaders[first].length > 0;
      const looksLikeLegacyHeader = second.toUpperCase() === 'ID';

      if (looksLikeLegacyHeader || !hasHeaderForSection) {
        currentSection = first;
        // Capture headers for this section (slice off the section column)
        sectionHeaders[currentSection] = row.slice(1).map((h: any) => String(h || '').trim());
        continue;
      }

      // Data row for a known section
      currentSection = first;
    }

    if (currentSection === 'WORKS') {
      const headers = sectionHeaders['WORKS'] || [];
      const id = getValueByAliases('WORKS', row as string[], ['id', 'work_id', 'work_slug', 'slug'], 1);
      const title = getValueByAliases('WORKS', row as string[], ['title', 'name', 'work_title'], 2);
      if (id) {
        const meta: Record<string,string> = {};
        for (let i = 0; i < headers.length; i++) {
          const key = headers[i];
          if (!key) continue;
          meta[key] = String(row[i+1] || '').trim();
        }
        const isMusicRaw =
          meta['is_music'] ||
          meta['Is_Music'] ||
          meta['Tag'] ||
          meta['tag'] ||
          meta['Category'] ||
          meta['type'] ||
          '';
        const isMusicNorm = String(isMusicRaw).toLowerCase();
        const isMusic = ['1', 'true', 'yes', 'music'].includes(isMusicNorm) || isMusicNorm.includes('music');
        works.set(id, { id, title: title || `Work ${id}`, scenes: [], meta, isMusic });
      }
    } else if (currentSection === 'SCENES') {
      const workId = getValueByAliases('SCENES', row as string[], ['work_id', 'work_slug', 'work', 'id_work'], 2);
      let sceneId = getValueByAliases('SCENES', row as string[], ['scene_id', 'id', 'scene'], 1);
      const sceneName = getValueByAliases('SCENES', row as string[], ['scene_title', 'title', 'name'], 3);
      const sceneOrder = getValueByAliases('SCENES', row as string[], ['scene_order', 'order', 'position']);

      if (!sceneId && workId) {
        const orderOrIndex = sceneOrder || String(scenes.size + 1);
        sceneId = `${workId}__${orderOrIndex}`;
      }

      const inlineVideo = normalizeAssetPath(getValueByAliases('SCENES', row as string[], ['video_url', 'video', 'video_file', 'video_path']));
      // simplified schema: thumbnail_url removed; client will always generate thumbnails
      // audio_url removed from simplified schema; audio is embedded in video files

      if (sceneId && workId) scenes.set(sceneId, { sceneId, workId, name: sceneName });
      if (sceneId && inlineVideo) videos.set(sceneId, inlineVideo);
    } else if (currentSection === 'VIDEOS') {
      const sceneId = getValueByAliases('VIDEOS', row as string[], ['scene_id', 'scene', 'id_scene'], 2);
      const videoFile = normalizeAssetPath(getValueByAliases('VIDEOS', row as string[], ['video_url', 'video', 'video_file', 'file'], 3));
      if (sceneId && videoFile) videos.set(sceneId, videoFile);
    } else if (currentSection === 'THUMBNAILS') {
      const sceneId = getValueByAliases('THUMBNAILS', row as string[], ['scene_id', 'scene', 'id_scene'], 2);
      const imageFile = normalizeAssetPath(getValueByAliases('THUMBNAILS', row as string[], ['thumbnail_url', 'thumbnail', 'image_url', 'image_file'], 3));
      if (sceneId && imageFile) thumbnails.set(sceneId, imageFile);
    } else if (currentSection === 'CREDITS') {
      const workId = getValueByAliases('CREDITS', row as string[], ['work_id', 'work_slug', 'work', 'id_work'], 2);
      const role = getValueByAliases('CREDITS', row as string[], ['role', 'credit_role'], 3);
      const name = getValueByAliases('CREDITS', row as string[], ['name', 'person', 'credit_name'], 4);
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

    // Generate a deterministic local thumbnail path from video URL for instant first render.
    // This does not depend on thumbnail_url in Sheets.
    const thumb = deriveThumbnailFromVideoUrl(videoUrl);

    // Optional dev-only proxy URL for hosts that block CORS.
    // In Vercel (prod) we always return canonical upstream URLs to avoid streaming large files through Vercel.
    const proxiedVideoUrl = IS_VERCEL_RUNTIME ? undefined : toProxiedVideoUrl(videoUrl);
    work.scenes.push({
      id: `${s.workId}-scene-${work.scenes.length}`,
      videoUrl,
      proxiedVideoUrl,
      thumbnail: thumb,
    });
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
  const rewritten = rewritePossiblyProxiedVideoUrl(url);
  if (!rewritten.startsWith('http') && !rewritten.startsWith('/')) return `/${rewritten}`;
  return rewritten;
}

function shouldProxyHost(hostname: string): boolean {
  return (
    ['github.com', 'release-assets.githubusercontent.com'].includes(hostname) ||
    hostname.endsWith('.s3.amazonaws.com')
  );
}

function toProxiedVideoUrl(videoUrl: string): string | undefined {
  if (IS_VERCEL_RUNTIME) return undefined;
  if (!videoUrl || typeof videoUrl !== 'string') return undefined;
  if (videoUrl.startsWith('/api/proxy/')) return videoUrl;
  try {
    const u = new URL(videoUrl);
    if (!shouldProxyHost(u.hostname)) return undefined;
    return `/api/proxy/${encodeURIComponent(videoUrl)}`;
  } catch {
    return undefined;
  }
}

function normalizeWorksVideoUrls<T extends any[]>(works: T): T {
  return (works || []).map((work: any) => {
    const scenes = Array.isArray(work?.scenes) ? work.scenes : [];
    const normalizedScenes = scenes.map((scene: any) => {
      const rawVideoUrl = typeof scene?.videoUrl === 'string' ? rewritePossiblyProxiedVideoUrl(scene.videoUrl) : '';
      const existingProxiedRaw = typeof scene?.proxiedVideoUrl === 'string' ? scene.proxiedVideoUrl : undefined;
      const existingProxied = existingProxiedRaw ? rewritePossiblyProxiedVideoUrl(existingProxiedRaw) : undefined;
      const proxiedVideoUrl = IS_VERCEL_RUNTIME ? undefined : (existingProxied || toProxiedVideoUrl(rawVideoUrl));
      return {
        ...scene,
        videoUrl: rawVideoUrl,
        proxiedVideoUrl,
      };
    });

    return {
      ...work,
      scenes: normalizedScenes,
    };
  }) as T;
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

// Convenience wrapper expected by older code.
// Keep local/dev aligned with the canonical remote source by fetching first,
// then falling back to cache only if remote loading fails.
export async function loadTheatreWorksData(options?: { force?: boolean }) {
  const force = !!(options && options.force);

  // On Vercel, always hit Google Sheets (no disk cache, no local CSV fallbacks).
  if (IS_VERCEL_RUNTIME) {
    if (force) {
      try { clearMemoryCache(); } catch { /* ignore */ }
    }
    try {
      const fetched = await fetchFromGoogleSheets();
      if (Array.isArray(fetched) && fetched.length > 0) return normalizeWorksVideoUrls(fetched);
    } catch (e) {
      console.warn('loadTheatreWorksData: fetchFromGoogleSheets failed (vercel)', (e as any)?.message ?? e);
    }
    return [];
  }

  try {
    const fetched = await fetchFromGoogleSheets();
    if (Array.isArray(fetched) && fetched.length > 0) return normalizeWorksVideoUrls(fetched);
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
    if (Array.isArray(fallback)) return normalizeWorksVideoUrls(fallback);
  } catch (e) {
    console.warn('loadTheatreWorksData: final loadFromCache failed', (e as any)?.message ?? e);
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
