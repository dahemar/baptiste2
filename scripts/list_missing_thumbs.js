const fs = require('fs');
const p = 'astro-app/.cache/theatre-works.json';
const data = JSON.parse(fs.readFileSync(p,'utf8'));
for(const w of data){
  for(const s of w.scenes || []){
    if(!s.thumbnail){
      console.log(`${w.id} ${s.id} -> ${s.videoUrl || s.proxiedVideoUrl || ''}`);
    }
  }
}
