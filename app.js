// ===================== GLOBAL STATE =====================
let canvas = document.getElementById("canvas");
let ctx = canvas.getContext("2d");

let drawing = false;
let currentTool = "pencil";
let paths = [];
let currentPath = [];

let strokeColor = "#ffffff";
let fillColor = "#00ffcc";
let showGrid = false;

// Undo / Redo
let history = [];
let redoStack = [];

// ===================== CANVAS SETUP =====================
function resizeCanvas() {
  canvas.width = window.innerWidth - 40;
  canvas.height = window.innerHeight - 120;
  redraw();
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ===================== DRAWING =====================
canvas.addEventListener("mousedown", (e) => {
  drawing = true;
  currentPath = [];
  addPoint(e);
});

canvas.addEventListener("mousemove", (e) => {
  if (!drawing) return;
  addPoint(e);
  redraw();
});

canvas.addEventListener("mouseup", () => {
  drawing = false;
  if (currentPath.length > 0) {
    paths.push({
      points: [...currentPath],
      stroke: strokeColor,
      fill: fillColor,
      type: currentTool
    });
    saveState();
  }
});

function addPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  currentPath.push({ x, y });
}

// ===================== REDRAW =====================
function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (showGrid) drawGrid();

  paths.forEach(p => drawPath(p));

  if (drawing) {
    drawPath({ points: currentPath, stroke: strokeColor });
  }
}

function drawPath(path) {
  if (path.points.length < 2) return;

  ctx.beginPath();
  ctx.strokeStyle = path.stroke;
  ctx.lineWidth = 2;

  ctx.moveTo(path.points[0].x, path.points[0].y);
  path.points.forEach(pt => ctx.lineTo(pt.x, pt.y));

  ctx.stroke();
}

// ===================== GRID =====================
function drawGrid() {
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 0.5;

  for (let x = 0; x < canvas.width; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  for (let y = 0; y < canvas.height; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // draw points
  ctx.fillStyle = "red";
  paths.forEach(p => {
    p.points.forEach(pt => {
      ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
      ctx.fillText(`(${Math.round(pt.x)},${Math.round(pt.y)})`, pt.x + 4, pt.y - 4);
    });
  });
}

// ===================== TOOL SWITCH =====================
function setTool(tool) {
  currentTool = tool;
}

// ===================== COLORS =====================
function setStrokeColor(val) {
  strokeColor = val;
}
function setFillColor(val) {
  fillColor = val;
}

// ===================== UNDO / REDO =====================
function saveState() {
  history.push(JSON.stringify(paths));
  redoStack = [];
}

function undo() {
  if (history.length === 0) return;
  redoStack.push(history.pop());
  paths = history.length ? JSON.parse(history[history.length - 1]) : [];
  redraw();
}

function redo() {
  if (redoStack.length === 0) return;
  const state = redoStack.pop();
  history.push(state);
  paths = JSON.parse(state);
  redraw();
}

// ===================== GRAPH TOGGLE =====================
function toggleGraph() {
  showGrid = !showGrid;
  redraw();
}

// ===================== XML GENERATION =====================
function generateXML() {
  let size = prompt("Enter size (e.g., 24):", "24");
  if (!size) return;

  let scaleX = size / canvas.width;
  let scaleY = size / canvas.height;

  let pathData = "";

  paths.forEach(p => {
    if (p.points.length < 2) return;

    let d = `M ${Math.round(p.points[0].x * scaleX)} ${Math.round(p.points[0].y * scaleY)} `;

    for (let i = 1; i < p.points.length; i++) {
      d += `L ${Math.round(p.points[i].x * scaleX)} ${Math.round(p.points[i].y * scaleY)} `;
    }

    pathData += `<path android:fillColor="${p.fill}" android:strokeColor="${p.stroke}" android:pathData="${d.trim()}" />\n`;
  });

  let xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${size}"
    android:viewportHeight="${size}">
    ${pathData}
</vector>`;

  showXMLModal(xml);
}

// ===================== XML MODAL =====================
function showXMLModal(xml) {
  const modal = document.getElementById("xmlModal");
  const code = document.getElementById("xmlCode");

  code.innerText = xml; // FIXED (no HTML pollution)
  modal.style.display = "block";
}

function closeModal() {
  document.getElementById("xmlModal").style.display = "none";
}

// ===================== COPY FIX =====================
function copyXML() {
  const text = document.getElementById("xmlCode").innerText;
  navigator.clipboard.writeText(text).then(() => {
    alert("Copied clean XML ✅");
  });
}

// ===================== KEY SHORTCUTS =====================
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "z") undo();
  if (e.ctrlKey && e.key === "y") redo();
});
