import {
  loadMusicData,
  MUSIC_PROJECT_ORDER,
  resolveMusicProject,
  type MusicRelease,
} from './sectionContentManager';
import { musicCoverR2Url } from './bandcampScraper';

const IS_VERCEL_RUNTIME = !!process.env.VERCEL;
const IS_DEV_RUNTIME = process.env.NODE_ENV !== 'production';

const MUSIC_PAGE_CACHE_TTL_MS = IS_DEV_RUNTIME
  ? 10 * 60_000
  : IS_VERCEL_RUNTIME
    ? 2 * 60_000
    : 15 * 60_000;

export interface MusicEntry {
  key: string;
  src: string;
  title: string;
  format: string;
  year: string;
  type: string;
  url: string;
  id: string;
  sortOrder: string;
  project: string;
}

export interface MusicProjectSection {
  name: string;
  releases: MusicEntry[];
}

export interface MusicPageModel {
  allReleasesUrl: string;
  projects: MusicProjectSection[];
}

type MusicPageCacheEntry = { data: MusicPageModel; expiresAt: number };
let musicPageCache: MusicPageCacheEntry | null = null;

export function clearMusicPageCache(): void {
  musicPageCache = null;
}

function isBandcampUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.bandcamp.com');
  } catch {
    return false;
  }
}

function sortCustom(a: MusicEntry, b: MusicEntry): number {
  return (
    (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
    a.title.localeCompare(b.title) ||
    Number(b.year) - Number(a.year)
  );
}

function projectSortKey(name: string, orderFromSheet: number): number {
  if (Number.isFinite(orderFromSheet) && orderFromSheet > 0) return orderFromSheet;
  const idx = MUSIC_PROJECT_ORDER.indexOf(name as (typeof MUSIC_PROJECT_ORDER)[number]);
  if (idx >= 0) return idx + 1;
  return 100;
}

function buildEntries(
  releases: MusicRelease[],
  allReleasesUrl: string,
  localImages: Record<string, string>,
): MusicEntry[] {
  const matchedIds = new Set<string>();

  const externalEntries: MusicEntry[] = releases
    .filter((item) => !!item.coverUrl)
    .map((item) => {
      matchedIds.add(item.id);
      return {
        key: item.coverKey || item.id,
        src: item.coverUrl || '',
        title: item.title,
        format: item.format,
        year: item.year,
        type: (item.type || 'other').toLowerCase(),
        url: item.url || allReleasesUrl,
        id: item.id,
        sortOrder: item.sortOrder,
        project: resolveMusicProject(item),
      };
    });

  const bandcampEntries: MusicEntry[] = releases
    .filter((item) => item.url && !matchedIds.has(item.id) && isBandcampUrl(item.url))
    .map((item) => {
      matchedIds.add(item.id);
      return {
        key: item.coverKey || item.id,
        src: musicCoverR2Url(item.id),
        title: item.title,
        format: item.format,
        year: item.year,
        type: (item.type || 'other').toLowerCase(),
        url: item.url || allReleasesUrl,
        id: item.id,
        sortOrder: item.sortOrder,
        project: resolveMusicProject(item),
      };
    });

  const localEntries: MusicEntry[] = Object.entries(localImages)
    .map(([path, src]) => {
      const key = path.split('/').pop() || '';
      const found = releases.find((r) => r.coverKey === key && !matchedIds.has(r.id));
      if (!found) return null;
      matchedIds.add(found.id);
      return {
        key,
        src: typeof src === 'string' ? src : '',
        title: found.title || key.replace(/\.(jpg|jpeg|png|webp)$/i, ''),
        format: found.format || '',
        year: found.year || '',
        type: (found.type || 'other').toLowerCase(),
        url: found.url || allReleasesUrl,
        id: found.id,
        sortOrder: found.sortOrder,
        project: resolveMusicProject(found),
      };
    })
    .filter((entry): entry is MusicEntry => entry !== null);

  const noImageEntries: MusicEntry[] = releases
    .filter((item) => !matchedIds.has(item.id))
    .map((item) => ({
      key: item.coverKey || item.id,
      src: '',
      title: item.title,
      format: item.format,
      year: item.year,
      type: (item.type || 'other').toLowerCase(),
      url: item.url || allReleasesUrl,
      id: item.id,
      sortOrder: item.sortOrder,
      project: resolveMusicProject(item),
    }));

  return [...externalEntries, ...bandcampEntries, ...localEntries, ...noImageEntries];
}

function groupByProject(
  entries: MusicEntry[],
  releases: MusicRelease[],
): MusicProjectSection[] {
  const orderByProject = new Map<string, number>();
  for (const release of releases) {
    const name = resolveMusicProject(release);
    const order = Number(release.projectOrder);
    if (!orderByProject.has(name) || (Number.isFinite(order) && order > 0)) {
      orderByProject.set(name, projectSortKey(name, order));
    }
  }

  const byProject = new Map<string, MusicEntry[]>();
  for (const entry of entries) {
    const list = byProject.get(entry.project) || [];
    list.push(entry);
    byProject.set(entry.project, list);
  }

  return [...byProject.entries()]
    .map(([name, projectEntries]) => ({
      name,
      releases: projectEntries.sort(sortCustom),
      sortKey: orderByProject.get(name) ?? projectSortKey(name, NaN),
    }))
    .sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name))
    .map(({ name, releases: projectReleases }) => ({ name, releases: projectReleases }));
}

export async function loadMusicPageModel(
  localImages: Record<string, string>,
): Promise<MusicPageModel> {
  if (musicPageCache && Date.now() < musicPageCache.expiresAt) {
    return musicPageCache.data;
  }

  const { allReleasesUrl, releases } = await loadMusicData();
  const mergedEntries = buildEntries(releases, allReleasesUrl, localImages);

  const model: MusicPageModel = {
    allReleasesUrl,
    projects: groupByProject(mergedEntries, releases),
  };

  musicPageCache = { data: model, expiresAt: Date.now() + MUSIC_PAGE_CACHE_TTL_MS };
  return model;
}
