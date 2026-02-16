const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const https = require('https')

const CSV = 'baptiste-theatre_works-releases.csv'
const THUMBS_DIR = 'astro-app/public/assets/images/thumbnails'
const CACHE_JSON = 'astro-app/.cache/theatre-works.json'

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow redirect
        return resolve(download(res.headers.location, dest))
      }
      if (res.statusCode !== 200) {
        file.destroy()
        fs.unlink(dest, () => {})
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url))
      }
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
    }).on('error', (err) => {
      file.destroy()
      fs.unlink(dest, () => {})
      reject(err)
    })
  })
}

function basenameFromUrl(url) {
  try {
    const u = new URL(url)
    return decodeURIComponent(path.basename(u.pathname))
  } catch (e) {
    // fallback
    const bits = url.split('/')
    return decodeURIComponent(bits[bits.length - 1].split('?')[0])
  }
}

function normalizeName(n) {
  return n
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
}

async function main() {
  await fsp.mkdir(THUMBS_DIR, { recursive: true })
  const csv = (await fsp.readFile(CSV, 'utf8')).split(/\r?\n/)

  // Parse CSV for VIDEOS and THUMBNAILS mapping by scene id
  const videosByScene = new Map() // sceneId -> videoBasename
  const thumbnailsByScene = new Map() // sceneId -> thumbnailUrl/name
  for (const line of csv) {
    if (!line) continue
    if (line.startsWith('VIDEOS,')) {
      const parts = line.split(',', 4)
      const sceneId = parts[2]
      const url = (parts[3] || '').replace(/,$/, '')
      if (url) videosByScene.set(sceneId, basenameFromUrl(url))
      continue
    }
    if (line.startsWith('THUMBNAILS,')) {
      const parts = line.split(',', 4)
      const sceneId = parts[2]
      const url = (parts[3] || '').replace(/,$/, '')
      if (url) thumbnailsByScene.set(sceneId, basenameFromUrl(url))
      continue
    }
  }

  if (thumbnailsByScene.size === 0) {
    console.log('No THUMBNAILS lines found in', CSV)
    return
  }

  // Download thumbnail files (unique URLs)
  const uniqueThumbs = new Map() // name -> url
  for (const [sid, name] of thumbnailsByScene.entries()) {
    // find the URL from the CSV lines (we can reconstruct from name if needed)
    // prefer the percent-encoded variant if present in CSV
    // here we search CSV for a matching name or encoded name
    const encoded = encodeURIComponent(name)
    const found = csv.find((l) => l.includes(name) || l.includes(encoded))
    const m = found && found.match(/(https?:\/\/\S+)/)
    const url = m ? m[1].replace(/,$/, '') : null
    if (url) uniqueThumbs.set(name, url)
  }

  const downloaded = []
  for (const [name, url] of uniqueThumbs.entries()) {
    const dest = path.join(THUMBS_DIR, name)
    try {
      if (fs.existsSync(dest)) {
        console.log('Exists:', name)
        downloaded.push(name)
        continue
      }
      console.log('Downloading', url)
      await download(url, dest)
      console.log('Saved', dest)
      downloaded.push(name)
    } catch (err) {
      console.warn('Failed to download', url, err.message)
    }
  }

  // Load cache and try to assign thumbnails
  let cacheRaw
  try {
    cacheRaw = await fsp.readFile(CACHE_JSON, 'utf8')
  } catch (e) {
    console.error('Cannot read cache JSON', CACHE_JSON)
    return
  }
  const works = JSON.parse(cacheRaw)
  let updated = 0

  const downloadedNorm = new Map()
  for (const name of downloaded) downloadedNorm.set(normalizeName(name.replace(/\.[^.]+$/, '')), name)

  for (const work of works) {
    for (const scene of work.scenes || []) {
      if (scene.thumbnail && scene.thumbnail.startsWith('/assets/images/thumbnails/')) continue
      const videoBase = path.basename(scene.videoUrl || '').replace(/\.[^.]+$/, '')
      const vn = normalizeName(videoBase)
      // try direct match
      for (const [tnorm, realName] of downloadedNorm.entries()) {
        if (vn.includes(tnorm) || tnorm.includes(vn)) {
          scene.thumbnail = '/assets/images/thumbnails/' + realName
          updated++
          break
        }
      }
    }
  }

  if (updated > 0) {
    await fsp.writeFile(CACHE_JSON, JSON.stringify(works, null, 2), 'utf8')
    console.log('Updated cache, scenes updated:', updated)
  } else {
    console.log('No scene thumbnail assignments made.')
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
