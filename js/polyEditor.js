/* =============================================================================
   polyEditor.js — modal editor for a panel's freeform outline.

   A panel can be any closed polygon (e.g. an angled, stepped or notched piece).
   You edit the elevation outline here: drag the corner handles, type exact X/Y
   inches, add / remove vertices, or start from a preset. The outline is stored
   on the panel as `points` = [[x-from-centre, y-up], …] with the base at y = 0
   and the shape horizontally centred (so it sits and frames like other panels).

   Coordinates inside the editor are plain inches from a bottom-left origin
   (X → right, Y → up); we only re-centre on save.
   ============================================================================= */

import { len } from './pricing.js';

const SNAP = 0.5; // editor grid (in)
const round2 = (n) => Math.round((n || 0) * 100) / 100;

// Presets are [x, y] inch lists from a bottom-left origin (y up).
const PRESETS = {
  rect:    (w = 36, h = 42) => [[0, 0], [w, 0], [w, h], [0, h]],
  lshape:  () => [[0, 0], [48, 0], [48, 24], [24, 24], [24, 60], [0, 60]],
  gable:   () => [[0, 0], [48, 0], [48, 36], [24, 54], [0, 36]],         // pentagon / peak
  rake:    () => [[0, 0], [48, 0], [48, 24], [0, 60]],                   // angled top (raked)
  // the attached sketch: an A–B–C–D–E–F hexagon (flat top-left, long slope to a point)
  hex:     () => [[0, 42], [42, 42], [120, 0], [30, 12], [12, 12], [0, 12]],
};

let host, onSaveCb, pts = [], dragI = -1, panelName = '';

/** Open the editor for a panel. `initial` = existing centred points or null. */
export function openPolyEditor(modalEl, { points, width = 36, height = 42, name = '' }, onSave) {
  host = modalEl; onSaveCb = onSave; panelName = name || 'panel';
  pts = (Array.isArray(points) && points.length >= 3)
    ? toEditor(points)
    : PRESETS.rect(width || 36, height || 42);
  render();
  host.classList.add('open');
}

function close() { host.classList.remove('open'); host.onclick = null; host.innerHTML = ''; }

// stored (centred, base-0) -> editor (bottom-left origin)
function toEditor(points) {
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  return points.map(([x, y]) => [round2(x - minX), round2(y - minY)]);
}
// editor -> stored (centre X, base 0)
function toStored() {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, minY = Math.min(...ys);
  return pts.map(([x, y]) => [round2(x - cx), round2(y - minY)]);
}

function bbox() {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function render() {
  const b = bbox();
  const bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY);
  const pad = Math.max(6, Math.max(bw, bh) * 0.12);
  const W = bw + pad * 2, H = bh + pad * 2;
  // group flips Y so inches go up; a point (x,y) in inches plots straight in group space
  const gT = `translate(${(pad - b.minX).toFixed(2)} ${(H - pad + b.minY).toFixed(2)}) scale(1 -1)`;
  const poly = pts.map((p) => p.join(',')).join(' ');
  const handles = pts.map((p, i) =>
    `<circle class="pe-vert" data-i="${i}" cx="${p[0]}" cy="${p[1]}" r="${(Math.max(bw, bh) * 0.02 + 1.5).toFixed(2)}"/>`).join('');
  const rows = pts.map((p, i) => `<div class="pe-row" data-i="${i}">
      <span class="pe-n">${i + 1}</span>
      <label>X<input class="num" type="number" step="0.5" value="${p[0]}" data-pe="x" data-i="${i}"></label>
      <label>Y<input class="num" type="number" step="0.5" value="${p[1]}" data-pe="y" data-i="${i}"></label>
      <button class="icon-btn" data-pe-del="${i}" title="Remove point" ${pts.length <= 3 ? 'disabled' : ''}>✕</button>
    </div>`).join('');

  host.innerHTML = `<div class="modal-card pe-card">
    <header><h3>Custom outline — ${esc(panelName)}</h3><button class="icon-btn" data-pe-close>✕</button></header>
    <div class="pe-body">
      <div class="pe-stage">
        <svg viewBox="0 0 ${W.toFixed(2)} ${H.toFixed(2)}" class="pe-svg" preserveAspectRatio="xMidYMid meet">
          <g transform="${gT}">
            <polygon class="pe-poly" points="${poly}"/>
            ${handles}
          </g>
        </svg>
        <div class="pe-size">${len(bw)} wide × ${len(bh)} tall · drag a corner or edit numbers</div>
        <div class="pe-presets">
          <span>Start from:</span>
          <button class="btn btn--xs" data-pe-preset="rect">Rectangle</button>
          <button class="btn btn--xs" data-pe-preset="rake">Raked</button>
          <button class="btn btn--xs" data-pe-preset="gable">Gable</button>
          <button class="btn btn--xs" data-pe-preset="lshape">L-shape</button>
          <button class="btn btn--xs" data-pe-preset="hex">Sketch hex</button>
        </div>
      </div>
      <div class="pe-list">
        <div class="pe-list-head"><span>Vertices (in)</span><button class="btn btn--xs" data-pe-add>＋ Point</button></div>
        ${rows}
        <p class="feats-hint">Points are inches from the bottom-left. Order goes around the outline. The shape is re-centred on save.</p>
      </div>
    </div>
    <footer class="pe-foot">
      <button class="btn" data-pe-close>Cancel</button>
      <button class="btn btn--primary" data-pe-save>Use this shape</button>
    </footer>
  </div>`;

  wire();
}

function wire() {
  const svg = host.querySelector('.pe-svg');
  const g = svg.querySelector('g');

  const toInch = (e) => {
    const m = g.getScreenCTM().inverse();
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [snap(pt.x), snap(pt.y)];
  };

  svg.addEventListener('pointerdown', (e) => {
    const v = e.target.closest('.pe-vert'); if (!v) return;
    dragI = +v.dataset.i; svg.setPointerCapture(e.pointerId);
    v.classList.add('drag');
  });
  svg.addEventListener('pointermove', (e) => {
    if (dragI < 0) return;
    const [x, y] = toInch(e);
    pts[dragI] = [x, y];
    // live update without a full re-render (keeps the drag smooth)
    const v = g.querySelector(`.pe-vert[data-i="${dragI}"]`);
    if (v) { v.setAttribute('cx', x); v.setAttribute('cy', y); }
    g.querySelector('.pe-poly').setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    const rx = host.querySelector(`input[data-pe="x"][data-i="${dragI}"]`);
    const ry = host.querySelector(`input[data-pe="y"][data-i="${dragI}"]`);
    if (rx) rx.value = x; if (ry) ry.value = y;
  });
  const end = () => { if (dragI >= 0) { dragI = -1; render(); } };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  host.onclick = (e) => {
    if (e.target.dataset.peClose !== undefined) { close(); return; }
    if (e.target.dataset.peSave !== undefined) { onSaveCb?.(toStored()); close(); return; }
    if (e.target.dataset.peAdd !== undefined) { addPoint(); render(); return; }
    const pre = e.target.dataset.pePreset;
    if (pre) { pts = (PRESETS[pre] || PRESETS.rect)(); render(); return; }
    const del = e.target.dataset.peDel;
    if (del !== undefined && pts.length > 3) { pts.splice(+del, 1); render(); return; }
    if (e.target === host) close();
  };

  host.querySelectorAll('input[data-pe]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const i = +inp.dataset.i, k = inp.dataset.pe === 'x' ? 0 : 1;
      const n = parseFloat(inp.value); if (!Number.isFinite(n)) return;
      pts[i][k] = n;
      g.querySelector('.pe-poly').setAttribute('points', pts.map((p) => p.join(',')).join(' '));
      const v = g.querySelector(`.pe-vert[data-i="${i}"]`);
      if (v) v.setAttribute(k === 0 ? 'cx' : 'cy', n);
    });
  });
}

// Insert a vertex at the midpoint of the longest edge (keeps the outline sane).
function addPoint() {
  let bi = 0, best = -1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > best) { best = d; bi = i; }
  }
  const a = pts[bi], b = pts[(bi + 1) % pts.length];
  pts.splice(bi + 1, 0, [round2((a[0] + b[0]) / 2), round2((a[1] + b[1]) / 2)]);
}

const snap = (n) => Math.round(n / SNAP) * SNAP;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
