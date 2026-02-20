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

export interface AudiovisualVideo {
  id: string;
  title?: string;
  credits?: string;
  year?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  externalUrl?: string;
}

export interface AudiovisualProject {
  id: string;
  projectTitle?: string;
  footerName?: string;
  footerCredits?: string;
  footerYear?: string;
  videos: AudiovisualVideo[];
}

export interface ContactInfo {
  email?: string;
  instagram?: string;
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
  // CSV exported from Google Sheets can include newlines inside quoted cells.
  // We must parse the whole text as a stream rather than splitting by \n.
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(current);
    current = '';
  };

  const pushRow = () => {
    // Ignore fully empty trailing rows
    const hasContent = row.some((c) => String(c || '').trim().length > 0);
    if (hasContent) rows.push(row);
    row = [];
  };

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      pushField();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      // Handle CRLF
      if (char === '\r' && next === '\n') i++;
      pushField();
      pushRow();
      continue;
    }

    current += char;
  }

  // Flush last row
  pushField();
  pushRow();
  return rows;
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

export async function loadAudiovisualData(): Promise<AudiovisualProject[]> {
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

  // Sheet supports project grouping so projects with multiple videos can share:
  // - a single title at the top (project_title)
  // - a single footer (title/credits/year) rendered once per project
  // Rows can be:
  // - row_type=project: defines project_title + optional footer fields
  // - row_type=video: defines video_url/thumbnail/external (+ optional per-video meta)
  // Legacy rows without row_type still work.

  const projects: AudiovisualProject[] = [];
  let current: AudiovisualProject | null = null;
  let currentProjectTitle = '';
  let projectCounter = 0;
  let videoCounter = 0;

  const ensureProject = (projectTitle: string) => {
    const key = (projectTitle || '').trim() || '__no_project__';
    if (!current || (String(current.projectTitle || '').trim() || '__no_project__') !== key) {
      projectCounter++;
      current = {
        id: `p${projectCounter}`,
        projectTitle: projectTitle ? projectTitle : undefined,
        footerName: undefined,
        footerCredits: undefined,
        footerYear: undefined,
        videos: [],
      };
      projects.push(current);
      videoCounter = 0;
    }
    return current;
  };

  for (const row of rows) {
    const rowTypeRaw = rowValue(row, ['row_type', 'type', 'rowType']);
    const rowType = String(rowTypeRaw || '').trim().toLowerCase();
    const projectTitle = rowValue(row, ['project_title', 'project', 'projectTitle']);
    const title = rowValue(row, ['title', 'Title']);
    const credits = rowValue(row, ['credits', 'Credits']);
    const year = rowValue(row, ['year', 'Year']);
    const videoUrl = rowValue(row, ['video_url', 'video', 'Video_URL']);
    const thumbnailUrl = rowValue(row, ['thumbnail_url', 'thumbnail', 'image_url']);
    const externalUrl = rowValue(row, ['external_url', 'url', 'link']);

    const hasAnyMedia = !!(videoUrl || thumbnailUrl || externalUrl);

    if ((rowType === 'project' || (!hasAnyMedia && !!projectTitle)) && projectTitle) {
      currentProjectTitle = projectTitle;
      const p = ensureProject(projectTitle);
      if (title && !p.footerName) p.footerName = title;
      if (credits && !p.footerCredits) p.footerCredits = credits;
      if (year && !p.footerYear) p.footerYear = year;
      continue;
    }

    // If we got here and the row sets a project title, treat it as a boundary.
    if (projectTitle) currentProjectTitle = projectTitle;
    const p = ensureProject(projectTitle || currentProjectTitle);

    if (!hasAnyMedia) {
      // Ignore blank lines that are not project headers.
      continue;
    }

    videoCounter++;
    const id = rowValue(row, ['id', 'ID']) || `${p.id}-v${videoCounter}`;
    p.videos.push({
      id,
      title: title || undefined,
      credits: credits || undefined,
      year: year || undefined,
      videoUrl: videoUrl || undefined,
      thumbnailUrl: thumbnailUrl || undefined,
      externalUrl: externalUrl || undefined,
    });
  }

  // If a project has no explicit footer, but only one video provides meta,
  // treat that as the project footer so it can be shown once.
  for (const p of projects) {
    if (p.footerName || p.footerCredits || p.footerYear) continue;
    if (p.videos.length < 2) continue;
    const candidates = p.videos.filter((v) => (v.title || v.credits || v.year));
    if (candidates.length !== 1) continue;
    const v = candidates[0];
    p.footerName = v.title;
    p.footerCredits = v.credits;
    p.footerYear = v.year;
  }

  return projects;
}

export async function loadContactData(): Promise<ContactInfo> {
  const envRange = process.env.CONTACT_SHEET_RANGE;
  const rows = await loadSectionRows({
    cacheKey: 'contact',
    rangeNames: [
      envRange || '',
      'contact',
      'CONTACT',
      'Contact',
    ].filter(Boolean),
    gvizTabName: 'contact',
    csvUrlEnvVar: 'CONTACT_CSV_URL',
    localFileName: 'contact.csv',
  });

  // expected columns: key,value (flexible)
  const info: ContactInfo = {};
  for (const row of rows) {
    const key = rowValue(row, ['key', 'Key', 'field', 'Field']).toLowerCase();
    const value = rowValue(row, ['value', 'Value', 'val']);
    if (!key || !value) continue;
    if (key === 'email' || key === 'mail') info.email = value;
    if (key === 'instagram' || key === 'ig') info.instagram = value;
  }
  return info;
}

export function clearSectionMemoryCache() {
  memoryCache.clear();
}
