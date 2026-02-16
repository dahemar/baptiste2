const fs = require('fs');
const path = require('path');

const cachePath = path.join(__dirname, '..', 'astro-app', '.cache', 'theatre-works.json');
const thumbsDir = path.join(__dirname, '..', 'astro-app', 'public', 'assets', 'images', 'thumbnails');

function loadJSON(p){
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveJSON(p, obj){
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function normalizeName(s){
  return s.normalize('NFD').replace(/\p{Diacritic}/gu,'');
}

function candidatesFromBase(base){
  const list = [];
  list.push(base + '.jpg');
  list.push(base.replace(/\./g,' ') + '.jpg');
  list.push(base.replace(/\./g,' ') + '.jpeg');
  list.push(base + '.jpeg');
  // diacritics-removed
  const n = normalizeName(base);
  if(n !== base){
    list.push(n + '.jpg');
    list.push(n.replace(/\./g,' ') + '.jpg');
  }
  return Array.from(new Set(list));
}

function findMatch(candidates, filesLowerMap){
  for(const c of candidates){
    const key = c.toLowerCase();
    if(filesLowerMap[key]) return filesLowerMap[key];
  }
  return null;
}

(async function main(){
  if(!fs.existsSync(cachePath)){
    console.error('cache not found:', cachePath);
    process.exit(2);
  }
  if(!fs.existsSync(thumbsDir)){
    console.error('thumbnails dir not found:', thumbsDir);
    process.exit(2);
  }

  const data = loadJSON(cachePath);
  const files = fs.readdirSync(thumbsDir);
  const filesLowerMap = {};
  for(const f of files){ filesLowerMap[f.toLowerCase()] = f; }

  let updated = 0;
  let totalCandidates = 0;
  let unchanged = 0;

  for(const work of data){
    if(!work.scenes) continue;
    for(const scene of work.scenes){
      const cur = scene.thumbnail;
      let found = null;
      if(cur && typeof cur === 'string' && cur.startsWith('/assets/images/thumbnails/')){
        const fname = cur.split('/').pop();
        if(filesLowerMap[fname.toLowerCase()]){ unchanged++; continue; }
      }
      // try to derive from videoUrl
      const v = scene.videoUrl || scene.proxiedVideoUrl || '';
      let base = '';
      try{
        // videoUrl may be proxied path or full URL; grab last segment
        const last = v.split('/').pop() || '';
        base = last.replace(/\.[^.]+$/,'');
      }catch(e){ base=''; }
      // also try id-based
      if(!base) base = scene.id || '';

      const candidates = candidatesFromBase(decodeURIComponent(base));
      totalCandidates += candidates.length;
      found = findMatch(candidates, filesLowerMap);
      if(found){
        scene.thumbnail = '/assets/images/thumbnails/' + found;
        updated++;
      }
    }
  }

  if(updated>0){
    saveJSON(cachePath, data);
  }

  console.log('thumbs dir:', thumbsDir);
  console.log('total scenes scanned:', data.reduce((s,w)=>s+(w.scenes? w.scenes.length:0),0));
  console.log('candidates tested total:', totalCandidates);
  console.log('updated scenes:', updated);
  console.log('already correct:', unchanged);
  console.log('wrote file:', updated>0 ? cachePath : '(no changes)');
})();
