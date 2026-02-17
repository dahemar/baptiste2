#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  return rows
    .map((row) => row.map((col) => csvEscape(col)).join(','))
    .join('\n') + '\n';
}

function pickFirst(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
      return String(obj[key]).trim();
    }
  }
  return '';
}

function normalizeBoolLike(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '';
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return 'true';
  if (['0', 'false', 'no', 'n'].includes(normalized)) return 'false';
  return normalized;
}

function unwrapProxiedVideoUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';
  const prefix = '/api/proxy/';
  if (!url.startsWith(prefix)) return url;
  const encoded = url.slice(prefix.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return url;
  }
}

function loadWorksFromCache() {
  const cacheCandidates = [
    path.resolve(process.cwd(), 'astro-app/.cache/theatre-works.json'),
    path.resolve(process.cwd(), '.cache/theatre-works.json'),
  ];

  for (const cachePath of cacheCandidates) {
    if (!fs.existsSync(cachePath)) continue;
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.works)) return parsed.works;
  }

  throw new Error('No theatre works cache found. Expected astro-app/.cache/theatre-works.json or .cache/theatre-works.json');
}

function resolveOutputDir() {
  const cwd = process.cwd();
  const isAstroAppCwd = path.basename(cwd) === 'astro-app';
  if (isAstroAppCwd) {
    return path.resolve(cwd, 'data');
  }
  return path.resolve(cwd, 'astro-app', 'data');
}

function main() {
  const works = loadWorksFromCache();
  const outDir = resolveOutputDir();
  fs.mkdirSync(outDir, { recursive: true });

  const worksRows = [
    ['work_slug', 'title', 'author'],
  ];
  const scenesRows = [
    ['scene_id', 'work_slug', 'scene_order', 'scene_title', 'video_url'],
  ];
  const creditsRows = [
    ['work_slug', 'role', 'name', 'order'],
  ];

  for (const work of works) {
    const workSlug = String(work?.id ?? '').trim();
    const meta = (work && typeof work.meta === 'object' && work.meta) ? work.meta : {};
    const author = pickFirst(meta, ['Author', 'author', 'creator', 'Creator']);
    const isMusic = normalizeBoolLike(work?.isMusic ?? pickFirst(meta, ['is_music', 'Tag', 'Category', 'type']));

    worksRows.push([
      workSlug,
      String(work?.title ?? ''),
      author,
    ]);

    const scenes = Array.isArray(work?.scenes) ? work.scenes : [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i] || {};
      const sceneId = String(scene.id || `${workSlug}__${i + 1}`).trim();
      scenesRows.push([
        sceneId,
        workSlug,
        String(i + 1),
        String(scene.title ?? ''),
        unwrapProxiedVideoUrl(String(scene.videoUrl ?? '')),
      ]);
    }

    const credits = Array.isArray(work?.credits) ? work.credits : [];
    for (let i = 0; i < credits.length; i++) {
      const credit = credits[i] || {};
      creditsRows.push([
        workSlug,
        String(credit.role ?? ''),
        String(credit.name ?? ''),
        String(i + 1),
      ]);
    }
  }

  const worksOut = path.join(outDir, 'theatre-works-works.csv');
  const scenesOut = path.join(outDir, 'theatre-works-scenes.csv');
  const creditsOut = path.join(outDir, 'theatre-works-credits.csv');

  fs.writeFileSync(worksOut, toCsv(worksRows), 'utf-8');
  fs.writeFileSync(scenesOut, toCsv(scenesRows), 'utf-8');
  fs.writeFileSync(creditsOut, toCsv(creditsRows), 'utf-8');

  console.log('Generated simplified theatre CSV files:');
  console.log('-', worksOut, `rows=${worksRows.length - 1}`);
  console.log('-', scenesOut, `rows=${scenesRows.length - 1}`);
  console.log('-', creditsOut, `rows=${creditsRows.length - 1}`);
}

main();
