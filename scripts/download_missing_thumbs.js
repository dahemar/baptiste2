const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const cachePath = path.join(__dirname, '..', 'astro-app', '.cache', 'theatre-works.json');
const thumbsDir = path.join(__dirname, '..', 'astro-app', 'public', 'assets', 'images', 'thumbnails');

if(!fs.existsSync(cachePath)){
  console.error('cache not found:', cachePath); process.exit(2);
}
if(!fs.existsSync(thumbsDir)){
  console.error('thumbnails dir not found:', thumbsDir); process.exit(2);
}

const data = JSON.parse(fs.readFileSync(cachePath,'utf8'));

const fetchWithTimeout = async (url, opts={})=>{
  const controller = new AbortController();
  const timeout = opts.timeout || 10000;
  const id = setTimeout(()=>controller.abort(), timeout);
  try{
    const res = await fetch(url, { signal: controller.signal, method: opts.method || 'GET', headers: opts.headers || {} });
    clearTimeout(id);
    return res;
  }catch(e){ clearTimeout(id); throw e; }
}

function decodeIfNeeded(s){
  if(!s) return '';
  try{ return decodeURIComponent(s); }catch(e){ return s; }
}

function makeCandidatesFromVideoUrl(videoUrl){
  // Accept either proxied encoded path (/api/proxy/<encoded>) or full URL
  let original = videoUrl || '';
  if(original.startsWith('/api/proxy/')){
    const enc = original.replace('/api/proxy/','');
    original = decodeIfNeeded(enc);
  }
  try{ if(/https?:\/\//.test(original)){
    // use last segment
    const u = new URL(original);
    const base = u.pathname.split('/').pop().replace(/\.[^.]+$/,'');
    const variants = [];
    variants.push(base + '.jpg');
    variants.push(base + '.jpeg');
    variants.push(base.replace(/\./g,' ') + '.jpg');
    variants.push(base.replace(/\./g,' ') + '.jpeg');
    // percent-encoded spaces
    variants.push(base.replace(/\./g,' ') .replace(/ /g,'%20') + '.jpg');
    variants.push(encodeURIComponent(base + '.jpg')); // encoded
    // also try with dots preserved (some thumbs use dots)
    variants.push(base + '.jpg');
    // produce full URLs pointing to same release directory
    const folder = u.pathname.split('/').slice(0,-1).join('/');
    const full = variants.map(v=> `${u.origin}${folder}/${v}`);
    return full;
  }}catch(e){}
  return [];
}

(async function main(){
  let updated = 0;
  for(const work of data){
    for(const scene of work.scenes || []){
      if(scene.thumbnail && typeof scene.thumbnail === 'string' && scene.thumbnail.startsWith('/assets/images/thumbnails/')) continue;
      const videoUrl = scene.videoUrl || scene.proxiedVideoUrl || '';
      const candidates = makeCandidatesFromVideoUrl(videoUrl);
      let found = false;
      for(const url of candidates){
        try{
          const head = await fetchWithTimeout(url, { method: 'HEAD', timeout: 8000 });
          if(head && head.ok){
            // download
            const get = await fetchWithTimeout(url, { method: 'GET', timeout: 15000 });
            if(get && get.ok){
              const buf = Buffer.from(await get.arrayBuffer());
              // determine filename: prefer decoded last segment with spaces
              let name = decodeURIComponent(new URL(url).pathname.split('/').pop());
              name = name.replace(/%20/g,' ');
              const out = path.join(thumbsDir, name);
              fs.writeFileSync(out, buf);
              scene.thumbnail = '/assets/images/thumbnails/' + name;
              updated++;
              found = true;
              console.log('Downloaded', url, '->', name);
              break;
            }
          }
        }catch(e){ /* ignore and try next */ }
      }
      if(!found){
        console.log('No thumbnail found for scene', work.id, scene.id, 'candidates:', candidates.length);
      }
    }
  }
  if(updated>0){
    fs.writeFileSync(cachePath, JSON.stringify(data,null,2), 'utf8');
    console.log('Updated cache with', updated, 'thumbnails.');
  }else{
    console.log('No updates.');
  }
})();
