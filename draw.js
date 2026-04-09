/* =====================================================
   DRAWING TOOL — Vanilla JavaScript
   Full drawing tools + Vector Path tracking for XML export
   ===================================================== */

// ─── Canvas Setup ────────────────────────────────────
const bgCanvas    = document.getElementById('bg-canvas');
const bgCtx       = bgCanvas.getContext('2d');
const mainCanvas  = document.getElementById('main-canvas');
const ctx         = mainCanvas.getContext('2d');
const overlayCanvas = document.getElementById('overlay-canvas');
const ovCtx       = overlayCanvas.getContext('2d');
const canvasWrapper = document.getElementById('canvas-wrapper');

const CANVAS_W = 900;
const CANVAS_H = 580;

function initCanvases() {
  [bgCanvas, mainCanvas, overlayCanvas].forEach(c => { c.width = CANVAS_W; c.height = CANVAS_H; });
  canvasWrapper.style.width  = CANVAS_W + 'px';
  canvasWrapper.style.height = CANVAS_H + 'px';
  bgCtx.fillStyle = '#1e1e2e';
  bgCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}
initCanvases();

// ─── State ───────────────────────────────────────────
let currentTool   = 'pencil';
let isDrawing     = false;
let startX = 0, startY = 0;
let snapBeforeStroke = null;
let livePoints    = [];

// Drawing style
let strokeColor   = '#38bdf8';
let fillColor     = '#1e3a5f';
let useFill       = false;
let brushSize     = 5;
let opacity       = 1.0;
let lineCap       = 'round';
let fontSize      = 24;
let fontFamily    = 'Arial';

// Vector path tracking — every stroke stored for XML export
let vectorPaths   = [];

// History (canvas snapshots + path snapshots)
let history       = [];
let redoStack     = [];
let gridVisible   = false;
let bgImage       = null;
let isDark        = true;

// ─── Swatches ────────────────────────────────────────
const SWATCHES = [
  '#ffffff','#000000','#f43f5e','#f97316','#facc15',
  '#22c55e','#38bdf8','#818cf8','#a855f7','#ec4899',
  '#64748b','#1e293b','#0ea5e9','#06b6d4','#14b8a6'
];
function buildSwatches(containerId, isStroke) {
  const el = document.getElementById(containerId);
  SWATCHES.forEach(color => {
    const s = document.createElement('div');
    s.className = 'swatch'; s.style.background = color; s.title = color;
    s.addEventListener('click', () => {
      if (isStroke) {
        strokeColor = color;
        document.getElementById('stroke-color').value = color;
        document.getElementById('stroke-hex').textContent = color;
      } else {
        fillColor = color;
        document.getElementById('fill-color').value = color;
        document.getElementById('fill-hex').textContent = color;
      }
    });
    el.appendChild(s);
  });
}
buildSwatches('stroke-swatches', true);
buildSwatches('fill-swatches', false);

// ─── UI Event Listeners ──────────────────────────────
document.getElementById('stroke-color').addEventListener('input', e => {
  strokeColor = e.target.value;
  document.getElementById('stroke-hex').textContent = e.target.value;
});
document.getElementById('fill-color').addEventListener('input', e => {
  fillColor = e.target.value;
  document.getElementById('fill-hex').textContent = e.target.value;
});
document.getElementById('use-fill').addEventListener('change', e => { useFill = e.target.checked; });
document.getElementById('brush-size').addEventListener('input', e => {
  brushSize = +e.target.value;
  document.getElementById('brush-size-label').textContent = brushSize;
});
document.getElementById('opacity-slider').addEventListener('input', e => {
  opacity = +e.target.value / 100;
  document.getElementById('opacity-label').textContent = e.target.value;
});
document.getElementById('line-cap').addEventListener('change', e => { lineCap = e.target.value; });
document.getElementById('font-size').addEventListener('input', e => {
  fontSize = +e.target.value;
  document.getElementById('font-size-label').textContent = e.target.value;
});
document.getElementById('font-family').addEventListener('change', e => { fontFamily = e.target.value; });
document.getElementById('apply-bg-color').addEventListener('click', () => {
  const col = document.getElementById('bg-color').value;
  saveState(); bgCtx.fillStyle = col; bgCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  if (bgImage) drawBgImage();
});

// Tool buttons
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
    overlayCanvas.style.cursor = currentTool === 'text' ? 'text' : 'crosshair';
    document.getElementById('text-panel').style.display = currentTool === 'text' ? 'flex' : 'none';
  });
});

// Header buttons
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);
document.getElementById('btn-grid').addEventListener('click', toggleGrid);
document.getElementById('btn-clear').addEventListener('click', clearCanvas);
document.getElementById('btn-download-png').addEventListener('click', () => downloadCanvas('png'));
document.getElementById('btn-download-jpg').addEventListener('click', () => downloadCanvas('jpg'));
document.getElementById('btn-remove-bg').addEventListener('click', removeBg);
document.getElementById('btn-export-xml').addEventListener('click', openXmlModal);
document.getElementById('btn-panel-xml').addEventListener('click', openXmlModal);

document.getElementById('bg-upload').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => { bgImage = img; bgCtx.clearRect(0,0,CANVAS_W,CANVAS_H); bgCtx.fillStyle='#1e1e2e'; bgCtx.fillRect(0,0,CANVAS_W,CANVAS_H); drawBgImage(); };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});
document.getElementById('btn-theme').addEventListener('click', () => {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.getElementById('btn-theme').innerHTML = isDark ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
});

// ─── Background Image ─────────────────────────────────
function drawBgImage() {
  if (!bgImage) return;
  const r = Math.min(CANVAS_W/bgImage.width, CANVAS_H/bgImage.height);
  const w = bgImage.width*r, h = bgImage.height*r;
  bgCtx.drawImage(bgImage, (CANVAS_W-w)/2, (CANVAS_H-h)/2, w, h);
}
function removeBg() {
  bgImage = null;
  bgCtx.clearRect(0,0,CANVAS_W,CANVAS_H);
  bgCtx.fillStyle = document.getElementById('bg-color').value || '#1e1e2e';
  bgCtx.fillRect(0,0,CANVAS_W,CANVAS_H);
}

// ─── History ──────────────────────────────────────────
function saveState() {
  redoStack = [];
  history.push({ canvas: mainCanvas.toDataURL(), paths: JSON.stringify(vectorPaths) });
  if (history.length > 60) history.shift();
  document.getElementById('vp-count').textContent = vectorPaths.length;
}
function undo() {
  if (!history.length) return;
  redoStack.push({ canvas: mainCanvas.toDataURL(), paths: JSON.stringify(vectorPaths) });
  const prev = history.pop();
  restoreState(prev);
}
function redo() {
  if (!redoStack.length) return;
  history.push({ canvas: mainCanvas.toDataURL(), paths: JSON.stringify(vectorPaths) });
  const next = redoStack.pop();
  restoreState(next);
}
function restoreState(snap) {
  vectorPaths = JSON.parse(snap.paths);
  const img = new Image();
  img.onload = () => { ctx.clearRect(0,0,CANVAS_W,CANVAS_H); ctx.drawImage(img,0,0); drawGrid(); };
  img.src = snap.canvas;
  document.getElementById('vp-count').textContent = vectorPaths.length;
}
function clearCanvas() {
  saveState(); ctx.clearRect(0,0,CANVAS_W,CANVAS_H); vectorPaths=[]; drawGrid();
  document.getElementById('vp-count').textContent = 0;
}

// ─── Grid ─────────────────────────────────────────────
function drawGrid() {
  ovCtx.clearRect(0,0,CANVAS_W,CANVAS_H);
  if (!gridVisible) return;
  ovCtx.save(); ovCtx.strokeStyle='rgba(100,116,139,0.28)'; ovCtx.lineWidth=0.5;
  for(let x=0;x<=CANVAS_W;x+=40){ ovCtx.beginPath(); ovCtx.moveTo(x,0); ovCtx.lineTo(x,CANVAS_H); ovCtx.stroke(); }
  for(let y=0;y<=CANVAS_H;y+=40){ ovCtx.beginPath(); ovCtx.moveTo(0,y); ovCtx.lineTo(CANVAS_W,y); ovCtx.stroke(); }
  ovCtx.restore();
}
function toggleGrid() {
  gridVisible = !gridVisible;
  document.getElementById('btn-grid').classList.toggle('active', gridVisible);
  drawGrid();
}

// ─── Apply Context Style ──────────────────────────────
function applyStyle() {
  ctx.globalAlpha   = opacity;
  ctx.strokeStyle   = strokeColor;
  ctx.fillStyle     = fillColor;
  ctx.lineWidth     = brushSize;
  ctx.lineCap       = lineCap;
  ctx.lineJoin      = 'round';
}

// ─── Flood Fill ───────────────────────────────────────
function hexToRgba(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16), 255];
}
function floodFill(startX, startY, fillCol) {
  const tempC = document.createElement('canvas'); tempC.width=CANVAS_W; tempC.height=CANVAS_H;
  const tempCtx = tempC.getContext('2d'); tempCtx.drawImage(bgCanvas,0,0); tempCtx.drawImage(mainCanvas,0,0);
  const imageData = tempCtx.getImageData(0,0,CANVAS_W,CANVAS_H); const data = imageData.data;
  const x0=Math.floor(startX), y0=Math.floor(startY);
  const i0=(y0*CANVAS_W+x0)*4;
  const [tr,tg,tb,ta]=[data[i0],data[i0+1],data[i0+2],data[i0+3]];
  const [fr,fg,fb]   = hexToRgba(fillCol);
  if(tr===fr&&tg===fg&&tb===fb&&ta===255) return;
  const stack=[x0,y0], visited=new Uint8Array(CANVAS_W*CANVAS_H);
  while(stack.length){ const cy=stack.pop(), cx=stack.pop();
    if(cx<0||cx>=CANVAS_W||cy<0||cy>=CANVAS_H) continue;
    const ii=cy*CANVAS_W+cx; if(visited[ii]) continue;
    const pi=ii*4; if(data[pi]!==tr||data[pi+1]!==tg||data[pi+2]!==tb||data[pi+3]!==ta) continue;
    visited[ii]=1; data[pi]=fr; data[pi+1]=fg; data[pi+2]=fb; data[pi+3]=255;
    stack.push(cx+1,cy,cx-1,cy,cx,cy+1,cx,cy-1);
  }
  // paint on main canvas (only visited pixels)
  const existing=ctx.getImageData(0,0,CANVAS_W,CANVAS_H);
  for(let i=0;i<data.length;i+=4){
    if(visited[i/4]){ existing.data[i]=fr; existing.data[i+1]=fg; existing.data[i+2]=fb; existing.data[i+3]=255; }
  }
  ctx.putImageData(existing,0,0);
}

// ─── Shape Drawing ────────────────────────────────────
function drawShapeOnCtx(x1,y1,x2,y2) {
  applyStyle(); ctx.beginPath();
  switch(currentTool){
    case 'line':  ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); break;
    case 'rect':
      if(useFill) ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));
      ctx.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1)); break;
    case 'circle':{
      const ecx=(x1+x2)/2, ecy=(y1+y2)/2, rx=Math.abs(x2-x1)/2, ry=Math.abs(y2-y1)/2;
      ctx.ellipse(ecx,ecy,rx,ry,0,0,Math.PI*2); if(useFill) ctx.fill(); ctx.stroke(); break;
    }
    case 'triangle':
      ctx.moveTo((x1+x2)/2,y1); ctx.lineTo(x2,y2); ctx.lineTo(x1,y2); ctx.closePath();
      if(useFill) ctx.fill(); ctx.stroke(); break;
  }
  ctx.globalAlpha=1;
}
function previewShape(x1,y1,x2,y2) {
  if(!snapBeforeStroke) return;
  const img=new Image();
  img.onload=()=>{ ctx.clearRect(0,0,CANVAS_W,CANVAS_H); ctx.drawImage(img,0,0); drawShapeOnCtx(x1,y1,x2,y2); };
  img.src=snapBeforeStroke;
}

// ─── Vector Path Builders ─────────────────────────────
function pointsToPathData(pts, closed) {
  if(!pts.length) return '';
  let d=`M ${pts[0].x},${pts[0].y}`;
  for(let i=1;i<pts.length;i++) d+=` L ${pts[i].x},${pts[i].y}`;
  if(closed) d+=' Z'; return d;
}
function rectPathData(x1,y1,x2,y2) {
  const lx=Math.min(x1,x2),ly=Math.min(y1,y2),rx=Math.max(x1,x2),ry=Math.max(y1,y2);
  return `M ${lx},${ly} L ${rx},${ly} L ${rx},${ry} L ${lx},${ry} Z`;
}
function circlePathData(x1,y1,x2,y2) {
  const cx=(x1+x2)/2, cy=(y1+y2)/2, rx=Math.abs(x2-x1)/2, ry=Math.abs(y2-y1)/2;
  const N=32, pts=[];
  for(let i=0;i<N;i++){ const a=(i/N)*Math.PI*2; pts.push({x:Math.round(cx+rx*Math.cos(a)),y:Math.round(cy+ry*Math.sin(a))}); }
  return pointsToPathData(pts,true);
}
function trianglePathData(x1,y1,x2,y2) {
  const mx=Math.round((x1+x2)/2);
  return `M ${mx},${Math.round(y1)} L ${Math.round(x2)},${Math.round(y2)} L ${Math.round(x1)},${Math.round(y2)} Z`;
}
function storeVectorPath(type, points, closed, pd) {
  vectorPaths.push({
    type, strokeColor, fillColor: useFill?fillColor:'none',
    strokeWidth: brushSize, opacity, points: points.map(p=>({x:p.x,y:p.y})),
    closed, pathData: pd || pointsToPathData(points, closed)
  });
  document.getElementById('vp-count').textContent = vectorPaths.length;
}

// ─── Text Tool ────────────────────────────────────────
let textX=0, textY=0;
const textWrap  = document.getElementById('text-input-wrap');
const textInput = document.getElementById('text-input');
function activateText(x,y) {
  textX=x; textY=y;
  textWrap.style.display='block'; textWrap.style.left=x+'px'; textWrap.style.top=y+'px';
  textInput.style.fontSize=fontSize+'px'; textInput.style.fontFamily=fontFamily;
  textInput.style.color=strokeColor; textInput.value=''; textInput.focus();
}
textInput.addEventListener('keydown', e => {
  if(e.key==='Enter') commitText();
  if(e.key==='Escape') textWrap.style.display='none';
});
function commitText() {
  const txt=textInput.value.trim(); if(!txt){ textWrap.style.display='none'; return; }
  saveState(); applyStyle();
  ctx.font=`${fontSize}px "${fontFamily}"`; ctx.fillStyle=strokeColor;
  ctx.globalAlpha=opacity; ctx.fillText(txt,textX,textY+fontSize); ctx.globalAlpha=1;
  const tw=ctx.measureText(txt).width;
  storeVectorPath('text',[],true,`M ${textX},${textY} L ${Math.round(textX+tw)},${textY} L ${Math.round(textX+tw)},${Math.round(textY+fontSize)} L ${textX},${Math.round(textY+fontSize)} Z`);
  textWrap.style.display='none';
}

// ─── Mouse / Touch Events ─────────────────────────────
function getPos(e) {
  const rect = overlayCanvas.getBoundingClientRect();
  const scaleX = CANVAS_W/rect.width, scaleY = CANVAS_H/rect.height;
  let cx=e.clientX, cy=e.clientY;
  if(e.touches){ cx=e.touches[0].clientX; cy=e.touches[0].clientY; }
  return { x: Math.round((cx-rect.left)*scaleX), y: Math.round((cy-rect.top)*scaleY) };
}

overlayCanvas.addEventListener('mousedown', onDown);
overlayCanvas.addEventListener('mousemove', onMove);
overlayCanvas.addEventListener('mouseup',   onUp);
overlayCanvas.addEventListener('mouseleave',onUp);
overlayCanvas.addEventListener('touchstart', e=>{e.preventDefault();onDown(e);},{passive:false});
overlayCanvas.addEventListener('touchmove',  e=>{e.preventDefault();onMove(e);},{passive:false});
overlayCanvas.addEventListener('touchend',   e=>{e.preventDefault();onUp(e);},{passive:false});

function onDown(e) {
  const {x,y}=getPos(e);
  if(currentTool==='text'){ activateText(x,y); return; }
  if(currentTool==='fill'){
    saveState(); floodFill(x,y,strokeColor);
    storeVectorPath('fill',[],false,`M ${x},${y}`); return;
  }
  isDrawing=true; startX=x; startY=y; livePoints=[{x,y}];
  if(['line','rect','circle','triangle'].includes(currentTool)){
    snapBeforeStroke=mainCanvas.toDataURL();
  } else {
    saveState(); applyStyle(); ctx.beginPath(); ctx.moveTo(x,y);
  }
}

function onMove(e) {
  if(!isDrawing) return;
  const {x,y}=getPos(e);
  if(['line','rect','circle','triangle'].includes(currentTool)){ previewShape(startX,startY,x,y); return; }
  applyStyle();
  if(currentTool==='eraser'){
    ctx.globalCompositeOperation='destination-out'; ctx.globalAlpha=1; ctx.lineWidth=brushSize*2;
  } else { ctx.globalCompositeOperation='source-over'; }
  ctx.lineTo(x,y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y);
  ctx.globalCompositeOperation='source-over';
  if(currentTool!=='eraser'){
    const last=livePoints[livePoints.length-1];
    if(!last||Math.hypot(x-last.x,y-last.y)>=4) livePoints.push({x,y});
  }
}

function onUp(e) {
  if(!isDrawing) return;
  isDrawing=false;
  ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
  const {x,y}=getPos(e);
  if(['line','rect','circle','triangle'].includes(currentTool)){
    drawShapeOnCtx(startX,startY,x,y); snapBeforeStroke=null;
    let pd='', closed=false;
    switch(currentTool){
      case 'line':     pd=`M ${startX},${startY} L ${x},${y}`; break;
      case 'rect':     pd=rectPathData(startX,startY,x,y); closed=true; break;
      case 'circle':   pd=circlePathData(startX,startY,x,y); closed=true; break;
      case 'triangle': pd=trianglePathData(startX,startY,x,y); closed=true; break;
    }
    saveState(); storeVectorPath(currentTool,[],closed,pd);
  } else if(currentTool==='pencil'||currentTool==='brush'){
    if(livePoints.length>1) storeVectorPath(currentTool,livePoints,false);
  }
  livePoints=[];
}

// ─── Download ─────────────────────────────────────────
function downloadCanvas(format) {
  const dl=document.createElement('canvas'); dl.width=CANVAS_W; dl.height=CANVAS_H;
  const dlCtx=dl.getContext('2d');
  dlCtx.drawImage(bgCanvas,0,0); dlCtx.drawImage(mainCanvas,0,0);
  const mime=format==='jpg'?'image/jpeg':'image/png';
  const a=document.createElement('a'); a.download=`drawing.${format}`;
  a.href=dl.toDataURL(mime,0.92); a.click();
}

// ─── XML Export ───────────────────────────────────────
function generateXML(outW, outH) {
  const scaleX=outW/CANVAS_W, scaleY=outH/CANVAS_H;
  function scale(pd){
    return pd.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g,(_,x,y)=>
      `${Math.round(+x*scaleX*10)/10},${Math.round(+y*scaleY*10)/10}`);
  }
  let pathsXml='';
  vectorPaths.forEach(vp=>{
    if(!vp.pathData) return;
    const pd=scale(vp.pathData);
    const fill=vp.fillColor&&vp.fillColor!=='none'?vp.fillColor:'#00000000';
    pathsXml+=`    <path\n`;
    pathsXml+=`        android:strokeColor="${vp.strokeColor}"\n`;
    pathsXml+=`        android:strokeWidth="${vp.strokeWidth}"\n`;
    pathsXml+=`        android:fillColor="${fill}"\n`;
    pathsXml+=`        android:strokeAlpha="${Math.round(vp.opacity*255)}"\n`;
    pathsXml+=`        android:pathData="${pd}" />\n`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${outW}dp"
    android:height="${outH}dp"
    android:viewportWidth="${outW}"
    android:viewportHeight="${outH}">
${pathsXml}</vector>`;
}
function syntaxHighlight(xml){
  return xml.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/(&lt;\?xml[^?]*\?&gt;)/g,'<span class="xd">$1</span>')
    .replace(/(&lt;\/?)([a-zA-Z:]+)/g,'$1<span class="xt">$2</span>')
    .replace(/(\/?&gt;)/g,'<span class="xs">$1</span>')
    .replace(/([a-zA-Z:]+)(=)("(?:[^"]*)")/g,'<span class="xa">$1</span>$2<span class="xv">$3</span>');
}
function openXmlModal(){
  if(!vectorPaths.length){ alert('Draw something first! All strokes/shapes are tracked automatically.'); return; }
  document.getElementById('xml-modal').style.display='flex'; renderXml();
}
function renderXml(){
  const outW=parseInt(document.getElementById('out-width').value)||800;
  const outH=parseInt(document.getElementById('out-height').value)||800;
  const raw=generateXML(outW,outH);
  document.getElementById('xml-modal').dataset.raw=raw;
  document.getElementById('xml-display').innerHTML=syntaxHighlight(raw);
}
document.getElementById('xml-modal-close').addEventListener('click',()=>{ document.getElementById('xml-modal').style.display='none'; });
document.getElementById('btn-regenerate').addEventListener('click', renderXml);
document.getElementById('btn-copy-xml').addEventListener('click',()=>{
  const raw=document.getElementById('xml-modal').dataset.raw||'';
  const showToast=()=>{ const t=document.getElementById('copy-toast'); t.style.display='flex'; setTimeout(()=>t.style.display='none',2200); };
  navigator.clipboard.writeText(raw).then(showToast).catch(()=>{
    const ta=document.createElement('textarea'); ta.value=raw; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast();
  });
});
document.getElementById('btn-download-xml').addEventListener('click',()=>{
  const raw=document.getElementById('xml-modal').dataset.raw||'';
  let name=(document.getElementById('xml-filename').value||'vector_drawable').trim();
  if(!name.endsWith('.xml')) name+='.xml';
  const blob=new Blob([raw],{type:'text/xml'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
});

// ─── Keyboard Shortcuts ───────────────────────────────
document.addEventListener('keydown', e => {
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){ e.preventDefault(); undo(); }
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))){ e.preventDefault(); redo(); }
  if(e.key==='Escape'){ document.getElementById('xml-modal').style.display='none'; textWrap.style.display='none'; }
});

// ─── Init ─────────────────────────────────────────────
saveState();
drawGrid();
