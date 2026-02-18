import fs from 'node:fs/promises';
import path from 'node:path';
import * as fsSync from 'node:fs';

const IS_VERCEL_RUNTIME = !!process.env.VERCEL;

type Row = Record<string, string>;

export interface MusicRelease {
  id: string;
  title: string;
  format: string;
  year: string;
  type: string;
  url: string;
  coverKey: string;
  coverUrl?: string;
}

export interface AudiovisualWork {
  id: string;
  title: string;
  credits: string;
  year: string;
  videoUrl: string;
  thumbnailUrl?: string;
  externalUrl?: string;
}

const memoryCache = new Map<string, any[]>();

function getSheetId() {
  return process.env.CONTENT_SHEET_ID ?? process.env.THEATRE_SHEET_ID ?? '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
}

function getApiKey() {
  return process.env.GOOGLE_SHEETS_API_KEY ?? process.env.GOOGLE_API_KEY;
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

function parseCsvRows(csvText: string): string[][] {
  return csvText
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0)
    .map((line) => parseCsvLine(line));
}

function mapRows(rows: string[][]): Row[] {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h || '').trim());
  return rows.slice(1).map((row) => {
    const obj: Row = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = String(row[i] || '').trim();
    }
    return obj;
  });
}

function rowValue(row: Row, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

async function tryFetchSheetRange(range: string): Promise<string[][] | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const sheetId = getSheetId();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    const values = Array.isArray(data?.values) ? data.values : [];
    return values.length > 1 ? values : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryFetchFirstAvailableRange(rangeCandidates: string[]): Promise<string[][] | null> {
  for (const candidate of rangeCandidates) {
    const range = String(candidate || '').trim();
    if (!range) continue;
    const rows = await tryFetchSheetRange(range);
    if (rows && rows.length > 1) {
      return rows;
    }
  }
  return null;
}

async function tryFetchCsvUrl(url?: string): Promise<string[][] | null> {
  if (!url) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    const rows = parseCsvRows(text);
    return rows.length > 1 ? rows : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryReadLocalCsv(fileName: string): Promise<string[][] | null> {
  const candidates = [
    path.resolve(process.cwd(), 'data', fileName),
    path.resolve(process.cwd(), 'astro-app', 'data', fileName),
    path.resolve(process.cwd(), '..', 'astro-app', 'data', fileName),
  ];

  for (const filePath of candidates) {
    try {
      if (!fsSync.existsSync(filePath)) continue;
      const text = await fs.readFile(filePath, 'utf-8');
      const rows = parseCsvRows(text);
      if (rows.length > 1) return rows;
    } catch {
      // ignore and continue
    }
  }
  return null;
}

async function tryFetchGvizTab(tabName: string): Promise<string[][] | null> {
  const sheetId = getSheetId();
  if (!sheetId || !tabName) return null;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const text = await res.text();
    const rows = parseCsvRows(text);
    return rows.length > 1 ? rows : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadSectionRows(options: {
  cacheKey: string;
  rangeNames: string[];
  gvizTabName: string;
  csvUrlEnvVar: string;
  localFileName: string;
}): Promise<Row[]> {
  // On Vercel: always load fresh from Sheets — no disk or memory cache
  if (!IS_VERCEL_RUNTIME && memoryCache.has(options.cacheKey)) {
    return memoryCache.get(options.cacheKey) as Row[];
  }

  let rows: string[][] | null = null;

  // 1) Google Sheets API (requires API key)
  if (!rows) rows = await tryFetchFirstAvailableRange(options.rangeNames);

  // 2) gviz CSV export (keyless, public sheet)
  if (!rows) rows = await tryFetchGvizTab(options.gvizTabName);

  // 3) CSV URL from env
  if (!rows) rows = await tryFetchCsvUrl(process.env[options.csvUrlEnvVar]);

  // 4) Local CSV fallback (disabled on Vercel)
  if (!rows && !IS_VERCEL_RUNTIME) rows = await tryReadLocalCsv(options.localFileName);

  const mapped = mapRows(rows || []);
  if (!IS_VERCEL_RUNTIME) memoryCache.set(options.cacheKey, mapped);
  return mapped;
}

export async function loadMusicData(): Promise<{ allReleasesUrl: string; releases: MusicRelease[] }> {
  const envRange = process.env.MUSIC_SHEET_RANGE;
  const rows = await loadSectionRows({
    cacheKey: 'music',
    rangeNames: [
      envRange || '',
      'music',
      'MUSIC',
      'Music',
    ].filter(Boolean),
    gvizTabName: 'music',
    csvUrlEnvVar: 'MUSIC_CSV_URL',
    localFileName: 'music.csv',
  });

  const releases: MusicRelease[] = rows
    .map((row) => ({
      id: rowValue(row, ['id', 'ID']),
      title: rowValue(row, ['title', 'Title']),
      format: rowValue(row, ['format', 'Format']),
      year: rowValue(row, ['year', 'Year']),
      type: rowValue(row, ['type', 'Type']) || 'other',
      url: rowValue(row, ['url', 'discogs_url', 'link', 'URL']),
      coverKey: rowValue(row, ['cover_key', 'key', 'image_key', 'cover']),
      coverUrl: rowValue(row, ['cover_url', 'image_url']),
    }))
    .filter((row) => row.title.length > 0);

  const allReleasesUrl =
    rowValue(rows[0] || {}, ['all_releases_url', 'discogs_all_url']) ||
    'https://www.discogs.com/fr/artist/5751087-Apulati-Bien?superFilter=Releases';

  return { allReleasesUrl, releases };
}

export async function loadAudiovisualData(): Promise<AudiovisualWork[]> {
  const envRange = process.env.AUDIOVISUAL_SHEET_RANGE;
  const rows = await loadSectionRows({
    cacheKey: 'audiovisual',
    rangeNames: [
      envRange || '',
      'audiovisual',
      'AUDIOVISUAL',
      'Audiovisual',
    ].filter(Boolean),
    gvizTabName: 'audiovisual',
    csvUrlEnvVar: 'AUDIOVISUAL_CSV_URL',
    localFileName: 'audiovisual.csv',
  });

  return rows
    .map((row) => ({
      id: rowValue(row, ['id', 'ID']),
      title: rowValue(row, ['title', 'Title']),
      credits: rowValue(row, ['credits', 'Credits']),
      year: rowValue(row, ['year', 'Year']),
      videoUrl: rowValue(row, ['video_url', 'video', 'Video_URL']),
      thumbnailUrl: rowValue(row, ['thumbnail_url', 'thumbnail', 'image_url']),
      externalUrl: rowValue(row, ['external_url', 'url', 'link']),
    }))
    .filter((row) => row.title.length > 0);
}

export function clearSectionMemoryCache() {
  memoryCache.clear();
}
