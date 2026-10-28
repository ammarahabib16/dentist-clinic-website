const fs=require('fs');
function stripComments(s){return s.replace(/<!--[\s\S]*?-->/g,'');}
function nonAscii(s){return [...stripComments(s)].filter(c=>c.charCodeAt(0)>127);}
for(const f of ['index.html','index-videosmooth.html','index-lenis.html']){
  const raw=fs.readFileSync(f,'utf8');
  const bom=fs.readFileSync(f)[0]===0xEF;
  const na=nonAscii(raw);
  const counts={};
  for(const c of na) counts[c]=(counts[c]||0)+1;
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  console.log(f,'bom='+bom,'nonAsciiOutsideComments='+na.length,'distinct='+Object.keys(counts).length);
  console.log('   top:',top.map(([c,n])=>JSON.stringify(c)+'x'+n).join(' '));
}
