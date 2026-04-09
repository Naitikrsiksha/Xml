/* =====================================================
   XML VECTOR TOOL — Full Drawing Tools + Vector Tracking
   Every stroke is tracked as Android Vector path data.
   ===================================================== */

// ─── Canvas Setup ───────────────────────────────────
const bgCanvas  = document.getElementById('bg-canvas');
const bgCtx     = bgCanvas.getContext('2d');
const mainCanvas = document.getElementById('main-canvas');
const ctx       = mainCanvas.getContext('2d');
const ovCanvas  = document.getElementById('overlay-canvas');
const ovCtx     = ovCanvas.getContext('2d');
const wrapper   = document.getElementById('canvas-wrapper');

const CW = 900, CH = 580;

[bgCanvas, mainCanvas, ovCanvas].forEach(c => { c.width = CW; c.height = CH; });
wrapper.style.width  = CW + 'px';
wrapper.style.height = CH + 'px';

bgCtx.fillStyle = '#13131f';
bgCtx.fillRect(0, 0, CW, CH);

// ─── App State ──────────────────────────────────────
let currentTool = 'pencil';
let isDrawing   = false;
let startX = 0, startY = 0;
let livePoints  = [];        // points collected during current stroke (pencil/brush)
let snapBeforeStroke = null; // snapshot for shape preview

let strokeColor = '#38bdf8';
let fillColor   = '#1e3a5f';
let useFill     = false;
let strokeWidth = 4;
let opacityVal  = 1.0;
let fontSize    = 24;
let fontFamily  = 'Arial';

// Vector path storage — every drawn shape/stroke
// { type, strokeColor, fillColor, useFill, strokeWidth, opacity, points:[{x,y}], closed, pathData }
let vectorPaths = [];

// Undo / Redo stacks (snapshots of vectorPaths + canvas)
let undoStack   = [];
let redoStack   = [];

// Dot-mode state (manual point placement)
let dotShape    = null;  // { color, points, closed }
let pendingDotX = 0, pendingDotY = 0;

// Graph overlay
let showGraph   = false;

// Background image
let bgImage     = null;

// ─── Swatches ───────────────────────────────────────
const SWATCHES = [
  '#38bdf8','#0ea5e9','#6366f1','#a855f7','#ec4899',
  '#f43f5e','#f97316','#facc15','#22c55e','#14b8a6',
  '#ffffff','#000000','#334155','#7f1d1d','#1a1a2e'
];

function buildSwatches(id, onPick) {
  const el = document.getElementById(id);
  if (!el) return;
  SWATCHES.forEach(c => {
    const s = document.createElement('div');
    s.className = 'swatch'; s.style.background = c; s.title = c;
    s.addEventListener('click', () => onPick(c));
    el.appendChild(s);
  });
}
buildSwatches('stroke-swatches', c => {
  strokeColor = c;
  document.getElementById('stroke-color').value = c;
  document.getElementById('stroke-hex').textContent = c;
});
buildSwatches('fill-swatches', c => {
  fillColor = c;
  document.getElementById('fill-color').value = c;
  document.getElementById('fill-hex').textContent = c;
});
buildSwatches('modal-swatches', c => {
  document.getElementById('modal-color-pick').value = c;
  document.getElementById('modal-color-hex').value = c;
});

// ─── UI Controls ────────────────────────────────────
document.getElementById('stroke-color').addEventListener('input', e => {
  strokeColor = e.target.value;
  document.getElementById('stroke-hex').textContent = e.target.value;
});
document.getElementById('fill-color').addEventListener('input', e => {
  fillColor = e.target.value;
  document.getElementById('fill-hex').textContent = e.target.value;
});
document.getElementById('use-fill').addEventListener('change', e => { useFill = e.target.checked; });
document.getElementById('stroke-width').addEventListener('input', e => {
  strokeWidth = +e.target.value;
  document.getElementById('stroke-width-label').textContent = strokeWidth;
});
document.getElementById('opacity-slider').addEventListener('input', e => {
  opacityVal = +e.target.value / 100;
  document.getElementById('opacity-label').textContent = e.target.value;
});
document.getElementById('font-size').addEventListener('input', e => {
  fontSize = +e.target.value;
  document.getElementById('font-size-label').textContent = e.target.value;
});
document.getElementById('font-family').addEventListener('change', e => { fontFamily = e.target.value; });
document.getElementById('apply-bg-color').addEventListener('click', () => {
  const col = document.getElementById('bg-color').value;
  bgCtx.fillStyle = col; bgCtx.fillRect(0, 0, CW, CH);
  if (bgImage) drawBgImage();
});

// Tool buttons
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
    ovCanvas.style.cursor = currentTool === 'text' ? 'text' : 'crosshair';
    document.getElementById('text-panel').style.display = currentTool === 'text' ? 'flex' : 'none';
  });
});

// ─── History ────────────────────────────────────────
function saveState() {
  redoStack = [];
  undoStack.push({
    canvas: mainCanvas.toDataURL(),
    paths:  JSON.stringify(vectorPaths),
    dotShape: dotShape ? JSON.stringify(dotShape) : null
  });
  if (undoStack.length > 60) undoStack.shift();
}
function restoreState(snap) {
  return new Promise(res => {
    vectorPaths = JSON.parse(snap.paths);
    dotShape    = snap.dotShape ? JSON.parse(snap.dotShape) : null;
    const img   = new Image();
    img.onload  = () => { ctx.clearRect(0,0,CW,CH); ctx.drawImage(img,0,0); refreshOverlay(); refreshPathsList(); updateStatus(); res(); };
    img.src = snap.canvas;
  });
}
document.getElementById('btn-undo').addEventListener('click', async () => {
  if (!undoStack.length) return;
  redoStack.push({ canvas: mainCanvas.toDataURL(), paths: JSON.stringify(vectorPaths), dotShape: dotShape ? JSON.stringify(dotShape) : null });
  await restoreState(undoStack.pop());
});
document.getElementById('btn-redo').addEventListener('click', async () => {
  if (!redoStack.length) return;
  undoStack.push({ canvas: mainCanvas.toDataURL(), paths: JSON.stringify(vectorPaths), dotShape: dotShape ? JSON.stringify(dotShape) : null });
  await restoreState(redoStack.pop());
});

// ─── Clear ──────────────────────────────────────────
document.getElementById('btn-clear').addEventListener('click', () => {
  saveState();
  ctx.clearRect(0, 0, CW, CH);
  vectorPaths = []; dotShape = null;
  refreshOverlay(); refreshPathsList(); updateStatus();
});
document.getElementById('btn-delete-last').addEventListener('click', () => {
  if (!vectorPaths.length) return;
  saveState();
  vectorPaths.pop();
  // Redraw canvas from scratch
  redrawAllPaths();
  refreshOverlay(); refreshPathsList(); updateStatus();
});

// ─── Background Image ────────────────────────────────
document.getElementById('bg-upload').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      bgImage = img;
      bgCtx.clearRect(0,0,CW,CH);
      bgCtx.fillStyle = document.getElementById('bg-color').value || '#13131f';
      bgCtx.fillRect(0,0,CW,CH);
      drawBgImage();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});
document.getElementById('btn-remove-bg').addEventListener('click', () => {
  bgImage = null;
  bgCtx.clearRect(0,0,CW,CH);
  bgCtx.fillStyle = document.getElementById('bg-color').value || '#13131f';
  bgCtx.fillRect(0,0,CW,CH);
});
function drawBgImage() {
  if (!bgImage) return;
  const r = Math.min(CW/bgImage.width, CH/bgImage.height);
  const w = bgImage.width*r, h = bgImage.height*r;
  bgCtx.drawImage(bgImage, (CW-w)/2, (CH-h)/2, w, h);
}

// ─── Canvas Context Style ────────────────────────────
function applyStyle(customColor) {
  ctx.globalAlpha   = opacityVal;
  ctx.strokeStyle   = customColor || strokeColor;
  ctx.fillStyle     = fillColor;
  ctx.lineWidth     = strokeWidth;
  ctx.lineCap       = 'round';
  ctx.lineJoin      = 'round';
}

// ─── Coordinate Helper ───────────────────────────────
function getPos(e) {
  const rect = ovCanvas.getBoundingClientRect();
  const sx = CW / rect.width, sy = CH / rect.height;
  let cx = e.clientX, cy = e.clientY;
  if (e.touches) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
  return { x: Math.round((cx - rect.left) * sx), y: Math.round((cy - rect.top) * sy) };
}

// ─── Path Data Builders ──────────────────────────────
function pointsToPathData(pts, closed) {
  if (!pts.length) return '';
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x},${pts[i].y}`;
  if (closed) d += ' Z';
  return d;
}
function rectPathData(x1,y1,x2,y2) {
  const lx=Math.min(x1,x2), ly=Math.min(y1,y2), rx=Math.max(x1,x2), ry=Math.max(y1,y2);
  return `M ${lx},${ly} L ${rx},${ly} L ${rx},${ry} L ${lx},${ry} Z`;
}
function circlePathData(x1,y1,x2,y2) {
  const cx=(x1+x2)/2, cy=(y1+y2)/2, rx=Math.abs(x2-x1)/2, ry=Math.abs(y2-y1)/2;
  const N = 32; const pts = [];
  for (let i=0;i<N;i++) {
    const a = (i/N)*Math.PI*2;
    pts.push({ x: Math.round(cx + rx*Math.cos(a)), y: Math.round(cy + ry*Math.sin(a)) });
  }
  return pointsToPathData(pts, true);
}
function trianglePathData(x1,y1,x2,y2) {
  const mx=(x1+x2)/2;
  return `M ${Math.round(mx)},${Math.round(y1)} L ${Math.round(x2)},${Math.round(y2)} L ${Math.round(x1)},${Math.round(y2)} Z`;
}

// ─── Flood Fill (canvas pixel fill) ──────────────────
function hexToRgba(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16), 255];
}
function floodFill(fx, fy, fillCol) {
  const imageData = ctx.getImageData(0,0,CW,CH);
  const data = imageData.data;
  const x0=Math.floor(fx), y0=Math.floor(fy);
  const i0=(y0*CW+x0)*4;
  const [tr,tg,tb,ta]=[data[i0],data[i0+1],data[i0+2],data[i0+3]];
  const [fr,fg,fb]   = hexToRgba(fillCol);
  if (tr===fr && tg===fg && tb===fb && ta===255) return;
  const stack=[x0,y0], visited=new Uint8Array(CW*CH);
  while (stack.length) {
    const cy=stack.pop(), cx=stack.pop();
    if (cx<0||cx>=CW||cy<0||cy>=CH) continue;
    const ii=cy*CW+cx; if (visited[ii]) continue;
    const pi=ii*4;
    if (data[pi]!==tr||data[pi+1]!==tg||data[pi+2]!==tb||data[pi+3]!==ta) continue;
    visited[ii]=1; data[pi]=fr; data[pi+1]=fg; data[pi+2]=fb; data[pi+3]=255;
    stack.push(cx+1,cy,cx-1,cy,cx,cy+1,cx,cy-1);
  }
  ctx.putImageData(imageData,0,0);
}

// ─── Shape Preview ────────────────────────────────────
function previewShape(x1,y1,x2,y2) {
  if (!snapBeforeStroke) return;
  const img=new Image();
  img.onload=()=>{
    ctx.clearRect(0,0,CW,CH); ctx.drawImage(img,0,0);
    drawShapeOnCtx(x1,y1,x2,y2);
  };
  img.src=snapBeforeStroke;
}
function drawShapeOnCtx(x1,y1,x2,y2) {
  applyStyle();
  ctx.beginPath();
  switch(currentTool){
    case 'line':  ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); break;
    case 'rect':
      if(useFill){ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));}
      ctx.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1)); break;
    case 'circle':{
      const ecx=(x1+x2)/2, ecy=(y1+y2)/2, rx=Math.abs(x2-x1)/2, ry=Math.abs(y2-y1)/2;
      ctx.ellipse(ecx,ecy,rx,ry,0,0,Math.PI*2);
      if(useFill) ctx.fill(); ctx.stroke(); break;
    }
    case 'triangle':
      ctx.moveTo((x1+x2)/2,y1); ctx.lineTo(x2,y2); ctx.lineTo(x1,y2); ctx.closePath();
      if(useFill) ctx.fill(); ctx.stroke(); break;
  }
  ctx.globalAlpha=1;
}

// ─── Store Vector Path ────────────────────────────────
function storeVectorPath(type, points, closed, pd) {
  vectorPaths.push({
    type,
    strokeColor,
    fillColor: useFill ? fillColor : 'none',
    strokeWidth,
    opacity: opacityVal,
    points: points.map(p=>({x:p.x,y:p.y})),
    closed,
    pathData: pd || pointsToPathData(points, closed)
  });
  refreshPathsList();
  updateStatus();
}

// ─── Redraw all paths (for undo) ─────────────────────
function redrawAllPaths() {
  ctx.clearRect(0,0,CW,CH);
  vectorPaths.forEach(vp => {
    if (!vp.pathData) return;
    ctx.save();
    ctx.globalAlpha = vp.opacity;
    ctx.strokeStyle = vp.strokeColor;
    ctx.lineWidth   = vp.strokeWidth;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Re-render path visually
    const p2d = new Path2D();
    const cmds = vp.pathData.match(/[MLZ][^MLZ]*/gi)||[];
    cmds.forEach(cmd=>{
      const t=cmd[0].toUpperCase();
      const nums=cmd.slice(1).trim().split(/[\s,]+/).map(Number).filter(n=>!isNaN(n));
      if(t==='M'&&nums.length>=2) p2d.moveTo(nums[0],nums[1]);
      else if(t==='L'&&nums.length>=2) p2d.lineTo(nums[0],nums[1]);
      else if(t==='Z') p2d.closePath();
    });
    if(vp.fillColor && vp.fillColor!=='none'){ctx.fillStyle=vp.fillColor; ctx.fill(p2d);}
    ctx.stroke(p2d);
    ctx.restore();
  });
}

// ─── Mouse / Touch Events ─────────────────────────────
ovCanvas.addEventListener('mousedown', onDown);
ovCanvas.addEventListener('mousemove', onMove);
ovCanvas.addEventListener('mouseup',   onUp);
ovCanvas.addEventListener('mouseleave',onUp);
ovCanvas.addEventListener('touchstart', e=>{e.preventDefault();onDown(e);},{passive:false});
ovCanvas.addEventListener('touchmove',  e=>{e.preventDefault();onMove(e);},{passive:false});
ovCanvas.addEventListener('touchend',   e=>{e.preventDefault();onUp(e);},{passive:false});

ovCanvas.addEventListener('mousemove', e => {
  const {x,y}=getPos(e);
  document.getElementById('status-coords').textContent=`X: ${x}   Y: ${y}`;
});

function onDown(e) {
  const {x,y}=getPos(e);

  if (currentTool==='text') { activateText(x,y); return; }

  if (currentTool==='dot') {
    handleDotClick(x,y); return;
  }
  if (currentTool==='fill') {
    saveState();
    floodFill(x,y,strokeColor);
    // Store as a rect covering the clicked area (approximation)
    storeVectorPath('fill', [{x:x-1,y:y-1},{x:x+1,y:y+1}], false, `M ${x},${y}`);
    return;
  }

  isDrawing=true; startX=x; startY=y; livePoints=[{x,y}];

  if(['line','rect','circle','triangle'].includes(currentTool)){
    snapBeforeStroke=mainCanvas.toDataURL();
  } else {
    saveState();
    applyStyle(); ctx.beginPath(); ctx.moveTo(x,y);
  }
}

function onMove(e) {
  if (!isDrawing) return;
  const {x,y}=getPos(e);

  if(['line','rect','circle','triangle'].includes(currentTool)){
    previewShape(startX,startY,x,y); return;
  }

  // Freehand (pencil/brush/eraser)
  applyStyle();
  if(currentTool==='eraser'){
    ctx.globalCompositeOperation='destination-out';
    ctx.globalAlpha=1; ctx.lineWidth=strokeWidth*2.5;
  } else {
    ctx.globalCompositeOperation='source-over';
  }
  ctx.lineTo(x,y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x,y);
  ctx.globalCompositeOperation='source-over';

  // Sample points for pencil/brush
  if(currentTool!=='eraser'){
    const last=livePoints[livePoints.length-1];
    if(!last||Math.hypot(x-last.x,y-last.y)>=4) livePoints.push({x,y});
  }
}

function onUp(e) {
  if (!isDrawing) return;
  isDrawing=false;
  ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;

  const {x,y}=getPos(e);

  if(['line','rect','circle','triangle'].includes(currentTool)){
    drawShapeOnCtx(startX,startY,x,y);
    snapBeforeStroke=null;

    let pd='', closed=false;
    switch(currentTool){
      case 'line':     pd=`M ${startX},${startY} L ${x},${y}`; break;
      case 'rect':     pd=rectPathData(startX,startY,x,y); closed=true; break;
      case 'circle':   pd=circlePathData(startX,startY,x,y); closed=true; break;
      case 'triangle': pd=trianglePathData(startX,startY,x,y); closed=true; break;
    }
    saveState();
    storeVectorPath(currentTool, [], closed, pd);
  } else if(currentTool==='pencil'||currentTool==='brush'){
    if(livePoints.length>1){
      storeVectorPath(currentTool, livePoints, false);
    }
  }
  livePoints=[];
  refreshOverlay();
}

// ─── Text Tool ───────────────────────────────────────
let textX=0, textY=0;
const textWrap  = document.getElementById('text-input-wrap');
const textInput = document.getElementById('text-input');

function activateText(x,y){
  textX=x; textY=y;
  textWrap.style.display='block'; textWrap.style.left=x+'px'; textWrap.style.top=y+'px';
  textInput.style.fontSize=fontSize+'px'; textInput.style.fontFamily=fontFamily;
  textInput.style.color=strokeColor; textInput.value=''; textInput.focus();
}
textInput.addEventListener('keydown', e=>{
  if(e.key==='Enter') commitText();
  if(e.key==='Escape') textWrap.style.display='none';
});
function commitText(){
  const txt=textInput.value.trim(); if(!txt){ textWrap.style.display='none'; return; }
  saveState();
  applyStyle(); ctx.font=`${fontSize}px "${fontFamily}"`;
  ctx.fillStyle=strokeColor; ctx.globalAlpha=opacityVal;
  ctx.fillText(txt, textX, textY+fontSize); ctx.globalAlpha=1;
  // Store as a "text" vector path (approximation by bounding box)
  const tw=ctx.measureText(txt).width;
  const pd=`M ${textX},${textY} L ${Math.round(textX+tw)},${textY} L ${Math.round(textX+tw)},${Math.round(textY+fontSize)} L ${textX},${Math.round(textY+fontSize)} Z`;
  storeVectorPath('text', [], true, pd);
  textWrap.style.display='none';
}

// ─── Dot Mode (manual coordinate placement) ──────────
function handleDotClick(x,y){
  if(!dotShape){
    pendingDotX=x; pendingDotY=y;
    openColorModal();
    return;
  }
  saveState();
  dotShape.points.push({x,y});
  // Draw dot
  ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2);
  ctx.fillStyle=dotShape.color; ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=1; ctx.stroke();
  // Label
  ctx.save(); ctx.font='11px monospace'; ctx.fillStyle='#fff';
  ctx.shadowColor='#000'; ctx.shadowBlur=3;
  ctx.fillText(`(${x},${y})`,x+6,y-4); ctx.restore();
  updateStatus();
}

// Close Path for dot mode
document.getElementById('btn-close-path').addEventListener('click', ()=>{
  if(!dotShape){ alert('Use the Dots tool and place points first.'); return; }
  if(dotShape.points.length<2){ alert('Need at least 2 points!'); return; }
  saveState();
  dotShape.closed=true;
  storeVectorPath('dot', dotShape.points, true);
  dotShape=null;
  refreshOverlay(); updateStatus();
});

// Color modal for dot mode
function openColorModal(){ document.getElementById('color-modal').style.display='flex'; }
function closeColorModal(){ document.getElementById('color-modal').style.display='none'; }

document.getElementById('modal-color-pick').addEventListener('input', e=>{
  document.getElementById('modal-color-hex').value=e.target.value;
});
document.getElementById('modal-color-hex').addEventListener('input', e=>{
  const v=e.target.value;
  if(/^#[0-9a-fA-F]{6}$/.test(v)) document.getElementById('modal-color-pick').value=v;
});
document.getElementById('modal-color-confirm').addEventListener('click', ()=>{
  let color=document.getElementById('modal-color-hex').value.trim();
  if(!/^#[0-9a-fA-F]{6}$/.test(color)) color='#38bdf8';
  dotShape={color, points:[{x:pendingDotX,y:pendingDotY}], closed:false};
  // Draw first dot
  ctx.beginPath(); ctx.arc(pendingDotX,pendingDotY,4,0,Math.PI*2);
  ctx.fillStyle=color; ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=1; ctx.stroke();
  ctx.save(); ctx.font='11px monospace'; ctx.fillStyle='#fff';
  ctx.shadowColor='#000'; ctx.shadowBlur=3;
  ctx.fillText(`(${pendingDotX},${pendingDotY})`,pendingDotX+6,pendingDotY-4); ctx.restore();
  closeColorModal(); updateStatus();
});
document.getElementById('modal-color-cancel').addEventListener('click', closeColorModal);

// ─── Graph Overlay ────────────────────────────────────
document.getElementById('btn-graph').addEventListener('click', ()=>{
  showGraph=!showGraph;
  document.getElementById('btn-graph').classList.toggle('active', showGraph);
  document.getElementById('btn-graph').querySelector('span').textContent = showGraph?'Hide Graph':'Graph';
  refreshOverlay();
});

function refreshOverlay(){
  ovCtx.clearRect(0,0,CW,CH);
  if(!showGraph) return;
  // Grid
  ovCtx.save();
  ovCtx.strokeStyle='rgba(100,116,139,0.25)'; ovCtx.lineWidth=0.5;
  for(let x=0;x<=CW;x+=40){ ovCtx.beginPath(); ovCtx.moveTo(x,0); ovCtx.lineTo(x,CH); ovCtx.stroke(); }
  for(let y=0;y<=CH;y+=40){ ovCtx.beginPath(); ovCtx.moveTo(0,y); ovCtx.lineTo(CW,y); ovCtx.stroke(); }
  // Axis numbers
  ovCtx.fillStyle='rgba(100,116,139,0.55)'; ovCtx.font='8px monospace';
  for(let x=40;x<CW;x+=80) ovCtx.fillText(x,x+2,10);
  for(let y=40;y<CH;y+=80) ovCtx.fillText(y,2,y-2);
  ovCtx.restore();

  // Overlay key coordinate labels on all paths
  ovCtx.save();
  ovCtx.font='10px monospace'; ovCtx.fillStyle='rgba(255,255,255,0.75)';
  ovCtx.shadowColor='#000'; ovCtx.shadowBlur=2;
  vectorPaths.forEach(vp=>{
    const pts = vp.points||[];
    pts.forEach((pt,i)=>{
      ovCtx.beginPath(); ovCtx.arc(pt.x,pt.y,3,0,Math.PI*2);
      ovCtx.fillStyle=vp.strokeColor||'#38bdf8'; ovCtx.fill();
      ovCtx.fillStyle='rgba(255,255,255,0.85)';
      ovCtx.fillText(`(${pt.x},${pt.y})`,pt.x+5,pt.y-3);
    });
  });
  ovCtx.restore();
}

// ─── Paths List (right panel) ─────────────────────────
function refreshPathsList(){
  const list=document.getElementById('paths-list');
  const count=document.getElementById('path-count');
  list.innerHTML=''; count.textContent=vectorPaths.length;
  vectorPaths.forEach((vp,i)=>{
    const d=document.createElement('div');
    d.className='path-item';
    d.innerHTML=`<div class="path-dot" style="background:${vp.strokeColor}"></div>
      <span>${i+1}. ${vp.type} (${vp.points?.length||'~'} pts)</span>`;
    list.appendChild(d);
  });
  document.getElementById('status-paths').textContent=`Paths: ${vectorPaths.length}`;
}

function updateStatus(){
  const dotPts=dotShape?dotShape.points.length:0;
  document.getElementById('status-mode').textContent=
    currentTool==='dot'
      ? (dotShape?`Dots mode — ${dotPts} pts placed, click [Close Z] to finish`:'Dots mode — click to start a new shape')
      : `Tool: ${currentTool} | Draw on canvas → paths auto-tracked`;
}

// ─── XML Generation ───────────────────────────────────
function generateXML(outW, outH){
  const scaleX=outW/CW, scaleY=outH/CH;

  function scalePathData(pd){
    return pd.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => {
      return `${Math.round(+x*scaleX*10)/10},${Math.round(+y*scaleY*10)/10}`;
    });
  }

  let pathsXml='';
  vectorPaths.forEach(vp=>{
    if(!vp.pathData) return;
    const pd=scalePathData(vp.pathData);
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
  return xml
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/(&lt;\?xml[^?]*\?&gt;)/g,'<span class="xml-dec">$1</span>')
    .replace(/(&lt;\/?)([a-zA-Z:]+)/g,'$1<span class="xml-tag">$2</span>')
    .replace(/(\/?&gt;)/g,'<span class="xml-slash">$1</span>')
    .replace(/([a-zA-Z:]+)(=)("(?:[^"]*)")/g,'<span class="xml-attr">$1</span>$2<span class="xml-str">$3</span>');
}

document.getElementById('btn-run').addEventListener('click', ()=>{
  if(!vectorPaths.length){ alert('No paths drawn yet! Use any drawing tool on the canvas.'); return; }
  document.getElementById('xml-modal').style.display='flex';
  renderXml();
});
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
    const ta=document.createElement('textarea'); ta.value=raw;
    ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta); showToast();
  });
});

document.getElementById('btn-download-xml').addEventListener('click',()=>{
  const raw=document.getElementById('xml-modal').dataset.raw||'';
  let name=(document.getElementById('xml-filename').value||'vector_drawable').trim();
  if(!name.endsWith('.xml')) name+='.xml';
  const blob=new Blob([raw],{type:'text/xml'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
});

// ─── Text-to-Path (opentype.js) ──────────────────────
const fontCache={};
async function loadFont(url){
  if(fontCache[url]) return fontCache[url];
  return new Promise((res,rej)=>{
    opentype.load(url,(err,font)=>{ if(err){ rej(err); return; } fontCache[url]=font; res(font); });
  });
}

document.getElementById('btn-t2p-add').addEventListener('click', async()=>{
  const text=document.getElementById('t2p-text').value.trim();
  if(!text){ alert('Enter some text first!'); return; }
  const fontUrl=document.getElementById('t2p-font').value;
  const fsize=parseInt(document.getElementById('t2p-size').value)||72;
  const color=document.getElementById('t2p-color').value||'#38bdf8';
  const btn=document.getElementById('btn-t2p-add');
  btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Loading...';
  try{
    const font=await loadFont(fontUrl);
    const path=font.getPath(text,30,fsize+30,fsize);
    const svg=path.toSVG(1);
    const match=svg.match(/d="([^"]+)"/);
    if(!match) throw new Error('No path data extracted');
    const rawD=match[1];
    // Draw on canvas
    saveState();
    const p2d=new Path2D(rawD);
    ctx.save(); ctx.globalAlpha=opacityVal;
    ctx.fillStyle=color; ctx.fill(p2d);
    ctx.strokeStyle=color; ctx.lineWidth=1; ctx.stroke(p2d);
    ctx.restore();
    // Store
    vectorPaths.push({ type:'text-path', strokeColor:color, fillColor:color, strokeWidth:1, opacity:opacityVal, points:[], closed:true, pathData:rawD });
    refreshPathsList(); updateStatus();
    alert(`Text "${text}" added as ${rawD.split(/[ML]/).length} vector commands!`);
  } catch(err){
    alert('Font load error: '+err.message+'\nTry a different font or use the Text tool instead.');
  } finally{
    btn.disabled=false; btn.innerHTML='<i class="fas fa-plus"></i> Add Path';
  }
});

// ─── Keyboard Shortcuts ────────────────────────────────
document.addEventListener('keydown', e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'){ e.preventDefault(); document.getElementById('btn-undo').click(); }
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))){ e.preventDefault(); document.getElementById('btn-redo').click(); }
  if(e.key==='Escape'){ closeColorModal(); document.getElementById('xml-modal').style.display='none'; textWrap.style.display='none'; }
});

// ─── Init ─────────────────────────────────────────────
updateStatus();
refreshPathsList();
