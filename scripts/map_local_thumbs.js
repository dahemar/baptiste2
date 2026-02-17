const fs = require('fs')
const fsp = fs.promises
const path = require('path')

const THUMBS_DIR = 'astro-app/public/assets/images/thumbnails'
const CACHE_JSON = 'astro-app/.cache/theatre-works.json'

function normalize(s) {
  if (!s) return ''
  return s
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\.[^.]+$/, '')
    .replace(/%20/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
}

async function main() {
  const thumbs = await fsp.readdir(THUMBS_DIR).catch(() => [])
  if (thumbs.length === 0) {
    console.log('No thumbnails found in', THUMBS_DIR)
    return
  }
  const thumbMap = new Map()
  for (const t of thumbs) {
    const key = normalize(t)
    thumbMap.set(key, t)
  }

  let cacheRaw
  try {
    cacheRaw = await fsp.readFile(CACHE_JSON, 'utf8')
  } catch (e) {
    console.error('Cannot read cache JSON', CACHE_JSON)
    return
  }
  const works = JSON.parse(cacheRaw)
  let updated = 0
  const assignments = []

  for (const work of works) {
    for (const scene of work.scenes || []) {
      const hasLocal = scene.thumbnail && scene.thumbnail.startsWith('/assets/images/thumbnails/')
      if (hasLocal) continue
      const videoUrl = scene.videoUrl || ''
      const decodedUrl = videoUrl.includes('%') ? decodeURIComponent(videoUrl) : videoUrl
      const videoBase = path.basename(decodedUrl).replace(/\.[^.]+$/, '')
      const vnorm = normalize(videoBase)
      // direct substring match
      let matched = null
      for (const [tnorm, realName] of thumbMap.entries()) {
        if (tnorm.includes(vnorm) || vnorm.includes(tnorm)) {
          matched = realName
          break
        }
      }
      // token overlap heuristic
      if (!matched) {
        const tokens = vnorm.split(/[^a-z0-9]+/).filter(Boolean)
        for (const [tnorm, realName] of thumbMap.entries()) {
          let cnt = 0
          for (const tok of tokens) if (tok && tnorm.includes(tok)) cnt++
          if (tokens.length > 0 && cnt >= Math.max(1, Math.floor(tokens.length / 2))) {
            matched = realName
            break
          }
        }
      }
      // numeric prefix match (e.g., "1.la.nuit" vs "1.La Nuit")
      if (!matched) {
        const m = videoBase.match(/^(\d{1,2})/) || []
        if (m[1]) {
          for (const [tnorm, realName] of thumbMap.entries()) {
            if (tnorm.startsWith(m[1])) {
              matched = realName
              break
            }
          }
        }
      }

      if (matched) {
        scene.thumbnail = '/assets/images/thumbnails/' + matched
        updated++
        assignments.push({ scene: scene.id, thumbnail: matched })
      }
    }
  }

  if (updated > 0) {
    await fsp.writeFile(CACHE_JSON, JSON.stringify(works, null, 2), 'utf8')
    console.log('Assigned', updated, 'thumbnails to scenes')
    console.table(assignments)
  } else {
    console.log('No assignments made')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
