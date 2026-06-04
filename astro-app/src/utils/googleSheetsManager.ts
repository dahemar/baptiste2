import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { deriveAutoThumbnailUrl } from './r2Thumbnails';

// In Vercel runtime we want the canonical source of truth to be Google Sheets.
// Avoid shipping/using stale on-disk caches or local CSV fallbacks.
const IS_VERCEL_RUNTIME = !!process.env.VERCEL;
const IS_DEV_RUNTIME = process.env.NODE_ENV !== 'production';

/** 0 in dev = always refetch Sheets on each page load (avoids stale credits/scenes). */
const THEATRE_CACHE_TTL_MS = IS_DEV_RUNTIME
  ? 0
  : IS_VERCEL_RUNTIME
    ? 20_000
    : 60_000;

type TimedCacheEntry<T> = { data: T; expiresAt: number };

const OLD_R2_PUBLIC_HOST = 'pub-16fb774f4ada4a69b6c70bc856201eeb.r2.dev';
const NEW_R2_PUBLIC_HOST = 'pub-f04cf0f8494f457e889559aa0b6e57b7.r2.dev';
const DEFAULT_THEATRE_SHEET_ID = '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
const DEFAULT_THEATRE_AUDIO_TABS = ['files', 'theatre-audio', 'theatre_audio', 'theatre-playlist', 'theatre_playlist'];

interface TheatreAudioFile {
  id: string;
  filename: string;
  audioUrl: string;
  proxiedAudioUrl?: string;
  workTitle?: string;
  order?: number;
}

function getTheatreSheetId(): string {
  return process.env.THEATRE_SHEET_ID ?? DEFAULT_THEATRE_SHEET_ID;
}

function getGoogleSheetsApiKey(): string | undefined {
  return process.env.GOOGLE_SHEETS_API_KEY ?? process.env.GOOGLE_API_KEY;
}

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

// In-memory cache for this module
const cache = new Map<string, TimedCacheEntry<unknown>>();
const CACHE_KEY = 'theatreWorks';
const THEATRE_AUDIO_CACHE_KEY = 'theatreAudio';

function readTimedCache<T>(key: string): T | null {
  if (THEATRE_CACHE_TTL_MS <= 0) return null;
  const entry = cache.get(key) as TimedCacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function writeTimedCache<T>(key: string, data: T): void {
  if (THEATRE_CACHE_TTL_MS <= 0) return;
  cache.set(key, { data, expiresAt: Date.now() + THEATRE_CACHE_TTL_MS });
}

export function clearMemoryCache() {
  cache.delete(CACHE_KEY);
  cache.delete(THEATRE_AUDIO_CACHE_KEY);
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

async function fetchGvizSheetAsRows(sheetId: string, sheetName: string, timeoutMs = 6000): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return [];
    const text = await res.text();
    return parseCsvTextRows(text);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

async function fetchGoogleSheetRangeRows(sheetId: string, apiKey: string, range: string, timeoutMs = 10000): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.values) ? data.values : [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

function getTheatreAudioRanges(): string[] {
  const envRange = process.env.THEATRE_AUDIO_RANGE;
  if (envRange) return [envRange];
  return DEFAULT_THEATRE_AUDIO_TABS;
}

/** Tab name used in Google Sheets for the desktop "files" audio list (editable). */
export const THEATRE_FILES_SHEET_TAB = 'files';

function normalizeAudioHeader(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function getRowValueByAliases(headers: string[], row: string[], aliases: string[]): string {
  const aliasSet = new Set(aliases.map(normalizeAudioHeader));
  for (let i = 0; i < headers.length; i++) {
    if (aliasSet.has(normalizeAudioHeader(headers[i]))) {
      return String(row[i] || '').trim();
    }
  }
  return '';
}

function fileNameFromUrl(url: string): string {
  if (!url) return 'untitled';
  try {
    const parsed = new URL(url);
    const filename = parsed.pathname.split('/').filter(Boolean).pop();
    return filename ? decodeURIComponent(filename) : url;
  } catch {
    const filename = url.split('/').filter(Boolean).pop();
    return filename ? decodeURIComponent(filename) : url;
  }
}

function parseTheatreAudioFiles(rows: string[][]): TheatreAudioFile[] {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const headers = rows[0].map((h) => String(h || '').trim());
  const normalizedHeaders = headers.map(normalizeAudioHeader);
  const hasAudioUrlColumn = normalizedHeaders.some((h) =>
    ['audio_url', 'audio', 'url', 'file', 'file_url', 's3_url', 'r2_url'].includes(h)
  );
  if (!hasAudioUrlColumn) return [];

  const files = rows.slice(1).map((row, index) => {
    const audioUrlRaw = getRowValueByAliases(headers, row, ['audio_url', 'audio', 'url', 'file', 'file_url', 's3_url', 'r2_url']);
    const audioUrl = normalizeVideoUrl(audioUrlRaw);
    if (!audioUrl) return null;

    const explicitFilename = getRowValueByAliases(headers, row, ['filename', 'file_name', 'title', 'name']);
    const workTitle = getRowValueByAliases(headers, row, ['work_title', 'work', 'project', 'piece']);
    const orderRaw = getRowValueByAliases(headers, row, ['order', 'position', 'sort']);
    const parsedOrder = Number.parseFloat(orderRaw);
    const id = getRowValueByAliases(headers, row, ['id', 'audio_id']) || `audio-${index + 1}`;
    const proxiedAudioUrl = IS_VERCEL_RUNTIME ? undefined : toProxiedVideoUrl(audioUrl);

    return {
      id,
      filename: explicitFilename || fileNameFromUrl(audioUrl),
      audioUrl,
      proxiedAudioUrl,
      workTitle: workTitle || undefined,
      order: Number.isFinite(parsedOrder) ? parsedOrder : undefined,
    };
  }).filter(Boolean) as TheatreAudioFile[];

  return files.sort((a, b) => {
    if (typeof a.order === 'number' && typeof b.order === 'number') return a.order - b.order;
    if (typeof a.order === 'number') return -1;
    if (typeof b.order === 'number') return 1;
    return 0;
  });
}

async function fetchTheatreAudioFilesViaGviz(sheetId: string): Promise<TheatreAudioFile[]> {
  const tabs = getTheatreAudioRanges();
  const tabResults = await Promise.all(
    tabs.map(async (tab) => ({
      tab,
      files: parseTheatreAudioFiles(await fetchGvizSheetAsRows(sheetId, tab, 6000)),
    })),
  );
  for (const { files } of tabResults) {
    if (files.length > 0) return files;
  }
  return [];
}

async function loadLocalTheatreAudioCsv(): Promise<TheatreAudioFile[]> {
  try {
    const csvPath = path.join(process.cwd(), 'data', 'theatre-audio.csv');
    const text = await readFile(csvPath, 'utf8');
    const rows = parseCsvTextRows(text);
    const files = parseTheatreAudioFiles(rows);
    if (files.length > 0) {
      console.log('[loadTheatreAudioFilesData] loaded local fallback', csvPath, files.length);
    }
    return files;
  } catch {
    return [];
  }
}

export async function loadTheatreAudioFilesData(options?: { force?: boolean }): Promise<TheatreAudioFile[]> {
  const force = !!(options && options.force);
  if (!force) {
    const cached = readTimedCache<TheatreAudioFile[]>(THEATRE_AUDIO_CACHE_KEY);
    if (cached) return cached;
  }

  const sheetId = getTheatreSheetId();
  const apiKey = getGoogleSheetsApiKey();

  if (apiKey) {
    const rangeResults = await Promise.all(
      getTheatreAudioRanges().map((range) =>
        fetchGoogleSheetRangeRows(sheetId, apiKey, range, 6000).then((rows) => ({
          range,
          files: parseTheatreAudioFiles(rows),
        })),
      ),
    );
    for (const { files } of rangeResults) {
      if (files.length > 0) {
        writeTimedCache(THEATRE_AUDIO_CACHE_KEY, files);
        return files;
      }
    }
  }

  const viaGviz = await fetchTheatreAudioFilesViaGviz(sheetId);
  if (viaGviz.length > 0) {
    writeTimedCache(THEATRE_AUDIO_CACHE_KEY, viaGviz);
    return viaGviz;
  }

  const local = await loadLocalTheatreAudioCsv();
  if (local.length > 0) writeTimedCache(THEATRE_AUDIO_CACHE_KEY, local);
  return local;
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

  const tabResults = await Promise.all(
    trySheets.map(async (tab) => ({
      tab,
      vals: await fetchGvizSheetAsRows(sheetId, tab, 6000),
    })),
  );
  for (const { tab, vals } of tabResults) {
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

export async function fetchFromGoogleSheets(): Promise<any[]> {
  const CACHE_KEY = 'theatreWorks';

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
    const SHEET_ID = getTheatreSheetId();
    const API_KEY = getGoogleSheetsApiKey();
    if (API_KEY) {
      const batchGetCombinedRows = async (ranges: string[]) => {
        const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${qs}&key=${API_KEY}`;
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 6000);
        try {
          const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
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
      const t = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
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
            const fres = await fetch(fallbackUrl, { signal: controller.signal, cache: 'no-store' });
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

  if (!Array.isArray(rows) || rows.length === 0) {
    console.warn('fetchFromGoogleSheets: no rows obtained from any source');
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

  return parsed;
}

// No side-effects on import

function parseTheatreWorks(rawValues: string[][]): any[] {
  if (!rawValues || rawValues.length < 2) return [];

  const works = new Map<string, any>();
  const scenes = new Map<string, any>();
  const videos = new Map<string, string>();
  const credits = new Map<string, any[]>();
  const sectionHeaders: Record<string, string[]> = {};

  let currentSection = '';
  const normalizeHeader = (value: any) => String(value || '').trim().toLowerCase();
  const sectionNames = ['WORKS', 'SCENES', 'VIDEOS', 'CREDITS'];

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

    // Legacy sections: thumbnails are client-generated from video first frame.
    if (first === 'THUMBNAILS' || first === 'AUDIO') continue;

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
        const synopsis = meta['synopsis'] || meta['Synopsis'] || meta['description'] || meta['Description'] || '';
        works.set(id, { id, title: title || `Work ${id}`, scenes: [], meta, isMusic, synopsis: synopsis.trim() || undefined });
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
      // Thumbnails are generated client-side from the first video frame (not from Sheets).

      if (sceneId && workId) scenes.set(sceneId, { sceneId, workId, name: sceneName });
      if (sceneId && inlineVideo) videos.set(sceneId, inlineVideo);
    } else if (currentSection === 'VIDEOS') {
      const sceneId = getValueByAliases('VIDEOS', row as string[], ['scene_id', 'scene', 'id_scene'], 2);
      const videoFile = normalizeAssetPath(getValueByAliases('VIDEOS', row as string[], ['video_url', 'video', 'video_file', 'file'], 3));
      if (sceneId && videoFile) videos.set(sceneId, videoFile);
    } else if (currentSection === 'CREDITS') {
      const workId = getValueByAliases('CREDITS', row as string[], ['work_id', 'work_slug', 'work', 'id_work'], 2);
      const role = getValueByAliases('CREDITS', row as string[], ['role', 'credit_role'], 3);
      const name = getValueByAliases('CREDITS', row as string[], ['name', 'person', 'credit_name'], 4);
      if (workId && role) {
        const roleNorm = role.trim().toLowerCase();
        const isSynopsisRole = /^(synopsis|description|short[\s_-]?description|teaser|summary)$/.test(roleNorm);
        if (isSynopsisRole && name) {
          const w = works.get(workId);
          if (w && !w.synopsis) w.synopsis = name.trim();
          continue;
        }
        if (!credits.has(workId)) credits.set(workId, []);
        credits.get(workId)?.push({ role, name });
      }
    }
  }

  for (const [sceneId, s] of scenes.entries()) {
    const work = works.get(s.workId);
    if (!work) continue;
    const videoUrl = normalizeVideoUrl(videos.get(sceneId) || '');

    // Optional dev-only proxy URL for hosts that block CORS.
    // In Vercel (prod) we always return canonical upstream URLs to avoid streaming large files through Vercel.
    const proxiedVideoUrl = IS_VERCEL_RUNTIME ? undefined : toProxiedVideoUrl(videoUrl);
    work.scenes.push({
      id: `${s.workId}-scene-${work.scenes.length}`,
      name: s.name,
      videoUrl,
      proxiedVideoUrl,
      thumbnail: deriveAutoThumbnailUrl(videoUrl),
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
    hostname.endsWith('.s3.amazonaws.com') ||
    hostname.endsWith('.r2.dev')
  );
}

function toProxiedVideoUrl(videoUrl: string): string | undefined {
  if (IS_VERCEL_RUNTIME) return undefined;
  if (!videoUrl || typeof videoUrl !== 'string') return undefined;
  if (videoUrl.startsWith('/api/proxy/')) return videoUrl;
  try {
    const u = new URL(videoUrl);
    if (!shouldProxyHost(u.hostname)) return undefined;
    if (u.hostname.endsWith('.r2.dev')) {
      return `/api/proxy/serve?url=${encodeURIComponent(videoUrl)}`;
    }
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
      const { thumbnail: _ignoredThumb, ...sceneWithoutThumb } = scene || {};
      return {
        ...sceneWithoutThumb,
        videoUrl: rawVideoUrl,
        proxiedVideoUrl,
        thumbnail: deriveAutoThumbnailUrl(rawVideoUrl),
      };
    });

    return {
      ...work,
      scenes: normalizedScenes,
    };
  }) as T;
}

// Convenience wrapper expected by older code.
// Keep local/dev aligned with the canonical remote source by fetching first,
// then falling back to cache only if remote loading fails.
export async function loadTheatreWorksData(options?: { force?: boolean }) {
  const force = !!(options && options.force);

  if (force) {
    try { clearMemoryCache(); } catch { /* ignore */ }
  } else {
    const cached = readTimedCache<any[]>(CACHE_KEY);
    if (cached && cached.length > 0) return normalizeWorksVideoUrls(cached);
  }

  try {
    const fetched = await fetchFromGoogleSheets();
    if (Array.isArray(fetched) && fetched.length > 0) {
      const normalized = normalizeWorksVideoUrls(fetched);
      writeTimedCache(CACHE_KEY, normalized);
      return normalized;
    }
  } catch (e) {
    console.warn('loadTheatreWorksData: fetchFromGoogleSheets failed', (e as any)?.message ?? e);
  }

  return [];
}

const defaultExport = {
  loadTheatreWorksData,
  loadTheatreAudioFilesData,
  fetchFromGoogleSheets,
  clearMemoryCache,
};

export default defaultExport;
