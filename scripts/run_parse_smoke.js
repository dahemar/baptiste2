#!/usr/bin/env node
const util = require('util');

function isNumeric(s) { return typeof s === 'string' && /^\d+$/.test(s.trim()); }
function normalizeVideoUrl(url) {
  if (!url) return '';
  if (!url.startsWith('http') && !url.startsWith('/')) return `/${url}`;
  return url;
}
function deriveThumbnailFromVideoUrl(videoUrl) {
  if (!videoUrl) return undefined;
  const mp4Match = videoUrl.match(/\/([^\/?#]+)\.mp4(?:[\?#].*)?$/i);
  if (mp4Match && mp4Match[1]) return `/assets/images/thumbnails/${mp4Match[1]}.jpg`;
  const hlsMatch = videoUrl.match(/\/hls\/([^\/]+)\//i);
  if (hlsMatch && hlsMatch[1]) return `/assets/images/thumbnails/${hlsMatch[1]}.jpg`;
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
    const thumb = thumbnails.get(sceneId) || deriveThumbnailFromVideoUrl(videoUrl);
    work.scenes.push({ id: `${s.workId}-scene-${work.scenes.length}`, videoUrl, thumbnail: thumb });
  }

  for (const [workId, cs] of credits.entries()) {
    const w = works.get(workId);
    if (w) w.credits = cs;
  }

  return Array.from(works.values());
}

// Sample single-range shape: a header row, then data rows without section name in first column
const singleRange = [
  ['WORKS','ID','Title','Tag'],
  ['', '1', 'First Work', 'theatre'],
  ['', '2', 'Second Work', 'music'],
  ['SCENES','ID','WorkID','Name'],
  ['', '100', '1', 'Act I'],
  ['', '101', '1', 'Act II'],
  ['', '200', '2', 'Prelude'],
  ['VIDEOS','ID','SceneID','File'],
  ['', '500', '100', 'Elie.Concours.1.mp4'],
  ['', '501', '101', 'Elie.Concours.2.mp4'],
  ['', '600', '200', 'Music.Track.1.mp4'],
];

// Sample combined shape (section name in first column for every row)
const combined = [
  ['WORKS','ID','Title','Tag'],
  ['WORKS','1','First Work','theatre'],
  ['WORKS','2','Second Work','music'],
  ['SCENES','ID','WorkID','Name'],
  ['SCENES','100','1','Act I'],
  ['SCENES','101','1','Act II'],
  ['SCENES','200','2','Prelude'],
  ['VIDEOS','ID','SceneID','File'],
  ['VIDEOS','500','100','Elie.Concours.1.mp4'],
  ['VIDEOS','501','101','Elie.Concours.2.mp4'],
  ['VIDEOS','600','200','Music.Track.1.mp4'],
];

console.log('singleRange ->', util.inspect(parseTheatreWorks(singleRange), { depth: 4 }));
console.log('combined ->', util.inspect(parseTheatreWorks(combined), { depth: 4 }));

process.exit(0);
