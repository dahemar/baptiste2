#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const SHEET_ID = process.env.THEATRE_SHEET_ID || '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || process.env.GOOGLE_API_KEY;
const ranges = ['WORKS', 'SCENES', 'VIDEOS', 'THUMBNAILS', 'AUDIO', 'CREDITS'];

if (!API_KEY) {
  console.error('Missing GOOGLE_SHEETS_API_KEY');
  process.exit(2);
}

function isNumeric(s) { return typeof s === 'string' && /^\d+$/.test(s.trim()); }

function normalizeVideoUrl(url) {
  if (!url) return '';
  if (!url.startsWith('http') && !url.startsWith('/')) return `/${url}`;
  return url;
}

function findLocalThumbByBaseName(baseName) {
  if (!baseName) return undefined;
  const possibleDirs = [
    path.resolve(process.cwd(), 'public', 'assets', 'images', 'thumbnails'),
    path.resolve(process.cwd(), 'astro-app', 'public', 'assets', 'images', 'thumbnails'),
    path.resolve(process.cwd(), '..', 'astro-app', 'public', 'assets', 'images', 'thumbnails')
  ];

  const key = baseName.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

  for (const thumbDir of possibleDirs) {
    try {
      if (!fs.existsSync(thumbDir)) continue;
      const files = fs.readdirSync(thumbDir);
      for (const f of files) {
        const base = f.replace(/\.[^.]+$/, '');
        const fkey = base.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
        if (fkey === key) return `/assets/images/thumbnails/${f}`;
      }
    } catch (e) {
      // ignore
    }
  }
  return undefined;
}

function deriveThumbnailFromVideoUrl(videoUrl) {
  if (!videoUrl) return undefined;
  try {
    const urlObj = new URL(videoUrl, 'https://example.org');
    const pathname = decodeURIComponent(urlObj.pathname || '');
    const base = (pathname.split('/').pop() || '').replace(/\.[^.]+$/, '');

    // Try direct lookup by base
    const direct = findLocalThumbByBaseName(base);
    if (direct) return direct;

    // Try some variants
    const candidates = [base, base.replace(/\./g, ' '), base.replace(/\./g, ''), base.replace(/\./g, '_')];
    for (const c of candidates) {
      const res = findLocalThumbByBaseName(c);
      if (res) return res;
    }

    // fallback to generated path (may be remote in sheet); try mp4 and hls heuristics
    const mp4Match = videoUrl.match(/\/([^\/\?#]+)\.mp4(?:[\?#].*)?$/i);
    if (mp4Match && mp4Match[1]) return `/assets/images/thumbnails/${mp4Match[1]}.jpg`;
    const hlsMatch = videoUrl.match(/\/hls\/([^\/]+)\//i);
    if (hlsMatch && hlsMatch[1]) return `/assets/images/thumbnails/${hlsMatch[1]}.jpg`;
  } catch (e) {
    // ignore
  }
  return undefined;
}

function parseTheatreWorks(rawValues) {
  if (!rawValues || rawValues.length < 2) return [];
  const works = new Map();
  const scenes = new Map();
  const videos = new Map();
  const thumbnails = new Map();
  const audio = new Map();
  const credits = new Map();

  let currentSection = '';
  for (const row of rawValues) {
    if (!row || row.length === 0) continue;
    const first = String(row[0] || '').toUpperCase();

    if (['WORKS','SCENES','VIDEOS','AUDIO','CREDITS','THUMBNAILS'].includes(first)) {
      if (String(row[1] || '').toUpperCase() === 'ID') { currentSection = first; continue; }
      if (isNumeric(String(row[1] || ''))) { currentSection = first; }
    }

    if (currentSection === 'WORKS') {
      const id = String(row[1] || '').trim();
      const title = String(row[2] || '').trim();
      if (id) works.set(id, { id, title: title || `Work ${id}`, scenes: [] });
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
        credits.get(workId).push({ role, name });
      }
    }
  }

  for (const [sceneId, s] of scenes.entries()) {
    const work = works.get(s.workId);
    if (!work) continue;
    const videoUrl = normalizeVideoUrl(videos.get(sceneId) || '');

    let thumbRaw = thumbnails.get(sceneId) || undefined;
    let thumb = undefined;

    if (thumbRaw && String(thumbRaw).startsWith('http')) {
      // try to resolve remote sheet-provided URL to a local file by basename
      try {
        const u = new URL(thumbRaw);
        const base = decodeURIComponent(u.pathname.split('/').pop() || '').replace(/\.[^.]+$/, '');
        thumb = findLocalThumbByBaseName(base) || undefined;
      } catch (e) {
        thumb = undefined;
      }
      // if not found locally, keep remote URL as fallback
      if (!thumb) thumb = thumbRaw;
    } else if (thumbRaw && !String(thumbRaw).startsWith('/')) {
      // bare filename: try to resolve to local normalized filename
      const base = decodeURIComponent((thumbRaw || '').split('/').pop() || '').replace(/\.[^.]+$/, '');
      thumb = findLocalThumbByBaseName(base) || undefined;
      // if not found locally, leave undefined so derive from video can fill in
    } else if (thumbRaw && String(thumbRaw).startsWith('/')) {
      thumb = thumbRaw; // already a public path
    }

    // final fallback: derive from video if we still don't have one
    if (!thumb) {
      thumb = deriveThumbnailFromVideoUrl(videoUrl);
    }

    // compute a proxied video url for developer convenience when hosting blocks CORS
    let proxiedVideoUrl = undefined;
    try {
      const u = new URL(videoUrl);
      if (['github.com', 'release-assets.githubusercontent.com'].includes(u.hostname) || u.hostname.endsWith('.s3.amazonaws.com')) {
        proxiedVideoUrl = `/api/proxy?url=${encodeURIComponent(videoUrl)}`;
      }
    } catch (e) {}

    work.scenes.push({ id: `${s.workId}-scene-${work.scenes.length}`, videoUrl, proxiedVideoUrl, thumbnail: thumb });
  }

  for (const [workId, cs] of credits.entries()) {
    const w = works.get(workId);
    if (w) w.credits = cs;
  }

  return Array.from(works.values());
}

async function main() {
  try {
    const qs = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?${qs}&key=${API_KEY}`;
    console.log('Fetching', url.replace(/key=.*/,'key=REDACTED'));
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    const data = await res.json();
    if (!res.ok) {
      // batchGet may fail if the sheet doesn't expose named ranges; try single-range fallback
      console.warn('batchGet failed, falling back to single-range theatre_works');
      const fres = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/theatre_works?key=${API_KEY}`, { signal: controller.signal });
      if (!fres.ok) {
        console.error('Google Sheets API returned', fres.status);
        process.exit(3);
      }
      const fdata = await fres.json();
      const vals = Array.isArray(fdata.values) ? fdata.values : [];
      const parsed = parseTheatreWorks(vals);
      const out = { fetchedAt: new Date().toISOString(), count: parsed.length, works: parsed };
      const outDir = path.resolve('astro-app/.cache');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, 'theatre-works.json');
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
      console.log('Wrote', outPath, 'works=', parsed.length);
      process.exit(0);
    }
    const valueRanges = Array.isArray(data?.valueRanges) ? data.valueRanges : [];
    const combined = [];
    for (let i = 0; i < ranges.length; i++) {
      const sectionName = ranges[i];
      const vr = valueRanges[i];
      const vals = Array.isArray(vr?.values) ? vr.values : [];
      if (vals.length === 0) continue;
      const hdr = Array.isArray(vals[0]) ? vals[0] : vals[0];
      combined.push([sectionName, ...(hdr || [])]);
      for (let r = 1; r < vals.length; r++) {
        const row = Array.isArray(vals[r]) ? vals[r] : [vals[r]];
        combined.push([sectionName, ...row]);
      }
    }

    const parsed = parseTheatreWorks(combined);
    const out = { fetchedAt: new Date().toISOString(), count: parsed.length, works: parsed };
    const outDir = path.resolve('astro-app/.cache');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'theatre-works.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('Wrote', outPath, 'works=', parsed.length);
    process.exit(0);
  } catch (err) {
    console.error(err && err.stack || err);
    process.exit(5);
  }
}

main();
