const fs=require('fs');
const s=fs.readFileSync('script-videosmooth.js','utf8');
const lines=s.split(/\r?\n/);
let inBlock=false; const bad=[];
for(let i=0;i<lines.length;i++){
  const line=lines[i];
  const nonAscii=[...line].filter(c=>c.charCodeAt(0)>127);
  if(!nonAscii.length) continue;
  const trimmed=line.trim();
  const isLineComment=trimmed.startsWith('//');
  const isBlockStart=trimmed.startsWith('/*');
  const isBlock=inBlock||isBlockStart;
  if(trimmed.includes('/*')) inBlock=true;
  if(trimmed.includes('*/')) inBlock=false;
  if(!isLineComment&&!isBlock) bad.push({line:i+1,text:line.slice(0,120)});
}
console.log('non-ASCII lines outside comments:',bad.length);
for(const b of bad.slice(0,20)) console.log(b.line,b.text);
console.log('U+FFFD count:',[...s].filter(c=>c.charCodeAt(0)===0xFFFD).length);
console.log('BOM:',fs.readFileSync('script-videosmooth.js')[0]===0xEF);
