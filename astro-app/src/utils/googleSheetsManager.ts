/// <reference types="node" />
// Google Sheets Content Manager for Astro
import logger from './logger';
import fs from 'fs/promises';
import path from 'path';

interface RawSheetData {
  values?: string[][];
}

interface TheatreWork {
  id: string;
  title: string;
  scenes: Scene[];
  credits?: Credit[];
}

interface Credit {
  role: string;
  name: string;
}

interface Scene {
  id: string;
  videoUrl: string;
  thumbnail?: string;
  duration?: number;
}

class GoogleSheetsManager {
  private sheetId: string;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.sheetId = '15S6aAhOP-p20BuDP-UEdGkSoTk8ScMkHR9cnGsmlLHI';
    this.apiKey = 'AIzaSyBHQgbSv588A3qr-Kzeo6YrZ9TbVNlrSkc';
    this.baseUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
  }

  async loadTheatreWorksData(options?: {
    cachePath?: string;
    fetchTimeoutMs?: number;
    preferCacheOnFailure?: boolean;
    writeCache?: boolean;
  }): Promise<TheatreWork[]> {
    const cachePath = options?.cachePath ?? path.join(process.cwd(), '.cache', 'theatre-works.json');
    const fetchTimeoutMs = options?.fetchTimeoutMs ?? 5000;
    const preferCacheOnFailure = options?.preferCacheOnFailure ?? true;
    const writeCache = options?.writeCache ?? true;

    try {
      logger.info('🔄 Loading Theatre Works data...');

      const rawValues = await this.loadRawSheetValues('theatre_works', { timeoutMs: fetchTimeoutMs });
      logger.info('✅ Data loaded');

      const works = this.parseTheatreWorks(rawValues);
      logger.info(`✅ Parsed ${works.length} works`);

      if (writeCache) {
        await this.writeCache(cachePath, works);
      }

      return works;
    } catch (error) {
      logger.error('❌ Error loading Theatre Works data (will try cache):', error);

      if (preferCacheOnFailure) {
        const cached = await this.readCache(cachePath);
        if (cached) {
          logger.info(`📦 Using cached Theatre Works data (${cached.length} works)`);
          return cached;
        }
      }

      // Never block the dev server request forever. Return empty state.
      logger.warn('⚠️ No cache available; returning empty Theatre Works data');
      return [];
    }
  }

  private async loadRawSheetValues(sheetName: string, options?: { timeoutMs?: number }): Promise<string[][]> {
    const url = `${this.baseUrl}/${this.sheetId}/values/${encodeURIComponent(sheetName)}?key=${this.apiKey}`;
    
    try {
      const response = await this.fetchWithTimeout(url, options?.timeoutMs ?? 5000);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }
      
      const data: RawSheetData = await response.json();
      return data.values || [];
    } catch (error) {
      logger.error(`❌ Error fetching sheet "${sheetName}":`, error);
      throw error;
    }
  }

  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readCache(cachePath: string): Promise<TheatreWork[] | null> {
    try {
      const raw = await fs.readFile(cachePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TheatreWork[]) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(cachePath: string, works: TheatreWork[]): Promise<void> {
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(works, null, 2), 'utf8');
      logger.debug(`💾 Wrote Theatre Works cache: ${cachePath}`);
    } catch (e) {
      logger.warn('⚠️ Failed to write Theatre Works cache', e);
    }
  }

  private parseTheatreWorks(rawValues: string[][]): TheatreWork[] {
    if (!rawValues || rawValues.length < 2) {
      return [];
    }

    // Parse sections: WORKS, SCENES, VIDEOS, AUDIO
    const works = new Map<string, any>();
    const scenes = new Map<string, any>();
    const videos = new Map<string, string>();
    const thumbnails = new Map<string, string>();
    const audio = new Map<string, string>();
    const credits = new Map<string, Credit[]>();

    let currentSection = '';

    const isNumeric = (s: any) => typeof s === 'string' && /^\d+$/.test(s.trim());

    for (const row of rawValues) {
      if (!row || row.length === 0) continue;

      const firstCell = String(row[0] || '').toUpperCase();

      // Detect section headers or implicit section rows
      if (['WORKS','SCENES','VIDEOS','AUDIO','CREDITS','THUMBNAILS'].includes(firstCell)) {
        // If this row is a header (second cell is 'ID' or 'id'), set section and skip
        if (String(row[1] || '').toUpperCase() === 'ID') {
          currentSection = firstCell;
          logger.debug(`📋 Section header: ${currentSection}`);
          continue;
        }

        // If second cell looks numeric, treat this as a data row but ensure section is set
        if (isNumeric(row[1])) {
          currentSection = firstCell;
          logger.debug(`📋 Implicit section switch to: ${currentSection}`);
          // fall through to parse the data row
        }
      }

      // Parse data rows based on current section
      if (currentSection === 'WORKS' && firstCell === 'WORKS') {
        const id = String(row[1] || '').trim();
        const title = String(row[2] || '').trim();
        const author = String(row[3] || '').trim();
        if (id) {
          works.set(id, { id, title: title || `Work ${id}`, author: author || 'Unknown', scenes: [] });
          logger.debug(`✅ Added work: ${id} - ${title}`);
        }
      } else if (currentSection === 'SCENES' && firstCell === 'SCENES') {
        const sceneId = String(row[1] || '').trim();
        const workId = String(row[2] || '').trim();
        const sceneName = String(row[3] || '').trim();
        if (sceneId && workId) {
          scenes.set(sceneId, { sceneId, workId, name: sceneName || `Scene ${sceneId}` });
          logger.debug(`📝 Scene ${sceneId} -> Work ${workId}: "${sceneName}"`);
        }
      } else if (currentSection === 'VIDEOS' && firstCell === 'VIDEOS') {
        const videoId = String(row[1] || '').trim();
        const sceneId = String(row[2] || '').trim();
        const videoFile = String(row[3] || '').trim();
        if (sceneId && videoFile) {
          const cleanPath = videoFile.replace(/^\./, '');
          videos.set(sceneId, cleanPath);
          logger.debug(`🎥 Video for scene ${sceneId}: ${cleanPath}`);
        }
      } else if (currentSection === 'THUMBNAILS' && firstCell === 'THUMBNAILS') {
        const thumbId = String(row[1] || '').trim();
        const sceneId = String(row[2] || '').trim();
        const imageFile = String(row[3] || '').trim();
        if (sceneId && imageFile) {
          const cleanPath = imageFile.replace(/^\./, '');
          thumbnails.set(sceneId, cleanPath);
          logger.debug(`🔖 Thumbnail for scene ${sceneId}: ${cleanPath}`);
        }
      } else if (currentSection === 'AUDIO' && firstCell === 'AUDIO') {
        const audioId = String(row[1] || '').trim();
        const sceneId = String(row[2] || '').trim();
        const audioFile = String(row[3] || '').trim();
        if (sceneId && audioFile) {
          const cleanPath = audioFile.replace(/^\./, '');
          audio.set(sceneId, cleanPath);
        }
      } else if (currentSection === 'CREDITS' && firstCell === 'CREDITS') {
        const creditId = String(row[1] || '').trim();
        const workId = String(row[2] || '').trim();
        const role = String(row[3] || '').trim();
        const name = String(row[4] || '').trim();
        // Aceptar créditos aunque el nombre esté vacío
        if (workId && role) {
          if (!credits.has(workId)) {
            credits.set(workId, []);
          }
          credits.get(workId)?.push({ role, name: name || '' });
          logger.debug(`👤 Credit for work ${workId}: ${role}${name ? ' - ' + name : ''}`);
        }
      }
    }

    // Combine scenes with videos and assign to works
    for (const [sceneId, sceneData] of scenes.entries()) {
      const { workId, name } = sceneData;
      const work = works.get(workId);
      if (!work) {
        logger.debug(`⚠️ Scene ${sceneId} references non-existent work ${workId}`);
        continue;
      }

      const videoUrl = this.normalizeVideoUrl(videos.get(sceneId) || '');
      const audioUrl = this.normalizeVideoUrl(audio.get(sceneId) || '');
      const thumbnail = this.deriveThumbnailFromVideoUrl(videoUrl);

      if (!videoUrl) {
        logger.debug(`⚠️ Scene ${sceneId} has no video URL`);
      }

      work.scenes.push({
        id: `${workId}-scene-${work.scenes.length}`,
        videoUrl,
        thumbnail,
      });
    }

    // Assign credits to works
    for (const [workId, workCredits] of credits.entries()) {
      const work = works.get(workId);
      if (work) {
        work.credits = workCredits;
        logger.debug(`✅ Assigned ${workCredits.length} credits to work ${workId}`);
      }
    }

    const result = Array.from(works.values());
    const totalScenes = result.reduce((sum, work) => sum + work.scenes.length, 0);
    logger.info(`📦 Parsed ${result.length} works with ${totalScenes} total scenes`);
    
    // Log details of each work
    result.forEach((work: TheatreWork) => {
      logger.debug(`📁 Work ${work.id}: "${work.title}" (${work.scenes.length} scenes)`);
      work.scenes.slice(0, 2).forEach((scene: Scene) => {
        logger.debug(`  🎬 Scene ${scene.id}: ${scene.videoUrl}`);
      });
    });
    
    return result;
  }

  private normalizeVideoUrl(url: string): string {
    if (!url) return '';
    
    // Si es URL local, asegurar que empiece con /
    if (!url.startsWith('http') && !url.startsWith('/')) {
      return `/${url}`;
    }
    
    return url;
  }

  private deriveThumbnailFromVideoUrl(videoUrl: string): string | undefined {
    if (!videoUrl) return undefined;

    // Handle MP4 (prefer basename so nested folders still work)
    if (videoUrl.includes('/assets/videos/')) {
      const mp4Match = videoUrl.match(/\/([^\/\?#]+)\.mp4(?:[\?#].*)?$/i);
      if (mp4Match?.[1]) {
        return `/assets/images/thumbnails/${mp4Match[1]}.jpg`;
      }
    }

    // Handle HLS paths: /assets/videos/hls/<name>/master.m3u8 (or similar)
    const hlsMatch = videoUrl.match(/\/assets\/videos\/hls\/([^\/]+)\//i);
    if (hlsMatch?.[1]) {
      return `/assets/images/thumbnails/${hlsMatch[1]}.jpg`;
    }

    return undefined;
  }

  private deriveThumbnail(videoUrl: string): string | undefined {
    // Derive thumbnail from video URL
    // Example: /assets/videos/work1/scene1.mp4 -> /assets/videos/work1/scene1-thumb.jpg
    if (videoUrl.includes('/hls/')) {
      // For HLS videos, look for thumbnail in same directory
      const basePath = videoUrl.substring(0, videoUrl.lastIndexOf('/'));
      return `${basePath}/thumbnail.jpg`;
    }
    
    return undefined;
  }
}

const sheetsManager = new GoogleSheetsManager();
export default sheetsManager;
