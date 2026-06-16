/* =============================================================================
   app.js — controller. Owns the render pipeline + all event wiring.

   Render granularity (so typing/dragging never loses focus):
     • renderControls()  rebuild the left-panel HTML  (structural changes only)
     • renderScene()     reconcile the 3D panels       (any geometry change)
     • renderTotals()    refresh the totals bar        (size/price change)
   Live value edits + gizmo drags update the scene/inputs in place.
   ============================================================================= */

import * as store from './state.js';
import { state, emit } from './state.js';
import * as scene from './scene3d.js';
import { controlsHTML, totalsHTML } from './ui.js';
import { planSVG } from './planView.js';
import { quote, money, panelCost, panelLabel } from './pricing.js';
import { downloadImage, printReport } from './exporter.js';

const $ = (s, r = document) => r.querySelector(s);
let stageEl, controlsEl, totalsEl, planEl;

boot();

function boot() {
  store.init();
  stageEl = $('#stage'); controlsEl = $('#controls'); totalsEl = $('#totals'); planEl = $('#planThumb');

  scene.init(stageEl);
  scene.onSelect(onScenePick);
  scene.onTransform(onSceneTransform);

  wireHeader(); wireViewTools(); wireControls();

  renderAll();
  scene.setCamera(state.project.options.camera || 'iso');
  scene.render(state.project); scene.select(state.selectedPanelId); scene.fit();
}

// ---- render pipeline -------------------------------------------------------
function renderAll() { renderControls(); renderScene({ fit: false }); renderHeader(); }

function renderControls() {
  controlsEl.innerHTML = controlsHTML(state.project, state.selectedPanelId);
  renderTotals(); renderPlan();
}
function renderScene({ fit = false } = {}) {
  scene.render(state.project);
  scene.select(state.selectedPanelId);
  if (fit) scene.fit();
  renderPlan();
}
function renderTotals() { totalsEl.innerHTML = totalsHTML(state.project); }
function renderPlan() { if (planEl) planEl.innerHTML = planSVG(state.project, { selectedId: state.selectedPanelId, width: 260 }); }
function renderHeader() {
  $('#title').textContent = state.project.name || 'Untitled Design';
  $('#btnCam').textContent = (state.project.options.camera === '3d') ? '3D' : 'Iso';
  $('#btnLabels').classList.toggle('on', !!state.project.options.showLabels);
  $('#vtSnap').classList.toggle('on', !!state.project.options.snap);
}

// ---------------------------------------------------------------------------
//  Controls events
// ---------------------------------------------------------------------------
function wireControls() {
  controlsEl.addEventListener('input', onControlInput);
  controlsEl.addEventListener('change', onControlChange);
  controlsEl.addEventListener('click', onControlClick);
  planEl?.addEventListener('click', (e) => { const id = e.target.getAttribute?.('data-panel'); if (id) selectPanel(id); });
}

function onControlInput(e) {
  const el = e.target, f = el.dataset.field; if (!f) return;
  if (f === 'name') { state.project.name = el.value; renderHeader(); emit(); return; }
  if (f.startsWith('client.')) { state.project.client[f.slice(7)] = el.value; emit(); return; }

  if (f === 'panel.name') { store.updatePanel(el.dataset.panel, { name: el.value }); renderScene(); return; }

  if (f === 'panel.width' || f === 'panel.height' || f === 'panel.holes') {
    const key = f.split('.')[1];
    store.updatePanel(el.dataset.panel, { [key]: num(el.value, key === 'holes' ? 0 : 12) });
    renderScene(); renderTotals(); refreshCardCost(el.dataset.panel);
    return;
  }
  if (f === 'panel.x' || f === 'panel.z' || f === 'panel.rotationY') {
    const key = f.split('.')[1];
    store.updatePanel(el.dataset.panel, { [key]: num(el.value, 0) });
    renderScene();
    return;
  }
  if (f === 'rate') { state.project.pricing.rates[el.dataset.glass] = num(el.value); emit(); renderTotals(); return; }
  if (['holeCost', 'temperPerSqFt', 'markupPct'].includes(f)) { state.project.pricing[f] = num(el.value); emit(); renderTotals(); return; }
}

function onControlChange(e) {
  const el = e.target;
  if (el.dataset.opt) {
    state.project.options[el.dataset.opt] = el.checked; emit();
    renderScene();
    if (el.dataset.opt === 'showLabels' || el.dataset.opt === 'snap') renderHeader();
    return;
  }
  if (el.dataset.field === 'panel.glassType') {
    store.updatePanel(el.dataset.panel, { glassType: el.value });
    renderControls(); renderScene();
    return;
  }
  if (['rate', 'holeCost', 'temperPerSqFt', 'markupPct', 'panel.width', 'panel.height', 'panel.holes'].includes(el.dataset.field)) {
    renderControls();
  }
}

function onControlClick(e) {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const act = btn.dataset.act, id = btn.dataset.panel;
  switch (act) {
    case 'addPanel': store.addPanel(); renderControls(); renderScene({ fit: true }); break;
    case 'addRun': addRun(); break;
    case 'addCorner': addCorner(); break;
    case 'dupPanel': store.duplicatePanel(id); renderControls(); renderScene(); break;
    case 'removePanel': store.removePanel(id); renderControls(); renderScene(); break;
    case 'toggleLock': {
      const p = store.findPanel(id); store.updatePanel(id, { locked: !p.locked });
      renderControls(); renderScene();
      break;
    }
    case 'selectPanel':
      if (e.target.closest('input,select,button,textarea')) return;
      selectPanel(id);
      break;
  }
}

// ---- quick-add templates ---------------------------------------------------
function addRun() {
  const d = state.project.defaults, gap = 2, w = d.width;
  store.addPanels([0, 1, 2].map((i) => ({ x: (w + gap) * i - (w + gap), z: 0, rotationY: 0 })));
  renderControls(); renderScene({ fit: true });
}
function addCorner() {
  const d = state.project.defaults, w = d.width;
  // panel A along X (faces -Z), panel B perpendicular meeting A's right end
  store.addPanels([
    { x: 0, z: 0, rotationY: 0 },
    { x: w / 2 + 0.25, z: w / 2 + 0.25, rotationY: 90 },
  ]);
  renderControls(); renderScene({ fit: true });
}

// ---------------------------------------------------------------------------
//  Selection + gizmo transform sync (no full rebuild)
// ---------------------------------------------------------------------------
function selectPanel(id) {
  state.selectedPanelId = (state.selectedPanelId === id) ? null : id;
  scene.select(state.selectedPanelId);
  controlsEl.querySelectorAll('.panel-card--sel').forEach((n) => n.classList.remove('panel-card--sel'));
  if (state.selectedPanelId) cardFor(id)?.classList.add('panel-card--sel');
  renderPlan();
}
function onScenePick(id) {
  selectPanel(id);
  if (id) cardFor(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function onSceneTransform(id, t, save) {
  store.setPanelTransform(id, t, save);
  const card = cardFor(id);
  if (card) {
    const set = (f, v) => { const el = card.querySelector(`input[data-field="${f}"]`); if (el && document.activeElement !== el) el.value = v; };
    set('panel.x', t.x); set('panel.z', t.z); set('panel.rotationY', t.rotationY);
  }
  renderPlan();
}

function refreshCardCost(id) {
  const p = store.findPanel(id); if (!p) return;
  const card = cardFor(id);
  if (card) card.querySelector('.pcost').textContent = money(panelCost(p, state.project.pricing).total);
}
const cardFor = (id) => controlsEl.querySelector(`.panel-card[data-panel="${id}"]`);

// ---------------------------------------------------------------------------
//  Header / view tools / file IO
// ---------------------------------------------------------------------------
function wireHeader() {
  $('#btnCam').addEventListener('click', () => {
    const next = state.project.options.camera === '3d' ? 'iso' : '3d';
    state.project.options.camera = next; emit(); scene.setCamera(next); renderHeader();
  });
  $('#btnLabels').addEventListener('click', () => {
    state.project.options.showLabels = !state.project.options.showLabels; emit();
    renderScene(); renderHeader();
    const cb = controlsEl.querySelector('[data-opt="showLabels"]'); if (cb) cb.checked = state.project.options.showLabels;
  });
  $('#btnFit').addEventListener('click', () => scene.fit());
  $('#btnPanel').addEventListener('click', () => document.body.classList.toggle('panel-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('panel-open'));

  const menuBtn = $('#btnMenu'), menu = $('#menu');
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); });
  document.addEventListener('click', () => menu.classList.remove('open'));
  menu.addEventListener('click', (e) => { const it = e.target.closest('[data-menu]'); if (!it) return; menu.classList.remove('open'); handleMenu(it.dataset.menu); });
  $('#fileInput').addEventListener('change', onFileChosen);
}

function wireViewTools() {
  $('#vtAdd').addEventListener('click', () => { store.addPanel(); renderControls(); renderScene({ fit: true }); });
  const move = $('#vtMove'), rot = $('#vtRotate');
  move.addEventListener('click', () => { scene.setGizmoMode('translate'); move.classList.add('on'); rot.classList.remove('on'); });
  rot.addEventListener('click', () => { scene.setGizmoMode('rotate'); rot.classList.add('on'); move.classList.remove('on'); });
  $('#vtSnap').addEventListener('click', () => {
    state.project.options.snap = !state.project.options.snap; emit();
    scene.setSnap(state.project.options.snap); renderHeader();
    const cb = controlsEl.querySelector('[data-opt="snap"]'); if (cb) cb.checked = state.project.options.snap;
  });
}

function handleMenu(cmd) {
  switch (cmd) {
    case 'new': loadFresh(store.newProject(`Design ${new Date().toLocaleDateString()}`)); break;
    case 'dup': {
      const copy = JSON.parse(store.exportJSON());
      copy.id = store.uid('prj'); copy.name += ' (copy)'; copy.createdAt = copy.updatedAt = Date.now();
      store.setActiveProject(copy); renderAll(); scene.render(copy); scene.fit(); break;
    }
    case 'open': openProjectsModal(); break;
    case 'png': downloadImage(scene.snapshot({ scale: 2.5 }), state.project, 'png'); break;
    case 'jpeg': downloadImage(scene.snapshot({ scale: 2.5 }), state.project, 'jpeg'); break;
    case 'print': printReport(state.project, scene.snapshot({ scale: 2 })); break;
    case 'backup': {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (state.project.name || 'design').replace(/[^\w.-]+/g, '_') + '.json'; a.click(); URL.revokeObjectURL(a.href); break;
    }
    case 'restore': $('#fileInput').click(); break;
    case 'delete':
      if (confirm(`Delete "${state.project.name}"? This cannot be undone.`)) { store.deleteProject(state.project.id); loadFresh(state.project); }
      break;
  }
}

function loadFresh(p) {
  if (p && p.id !== state.project?.id) store.setActiveProject(p);
  state.selectedPanelId = null;
  renderAll(); scene.setCamera(state.project.options.camera || 'iso'); scene.render(state.project); scene.fit();
}

function onFileChosen(e) {
  const file = e.target.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { try { store.importJSON(reader.result); loadFresh(state.project); } catch (err) { alert('Could not import: ' + err.message); } };
  reader.readAsText(file); e.target.value = '';
}

// ---- projects modal --------------------------------------------------------
function openProjectsModal() {
  const list = store.listProjects(), modal = $('#modal');
  modal.innerHTML = `<div class="modal-card">
      <header><h3>Saved projects</h3><button class="icon-btn" data-close>✕</button></header>
      <div class="proj-list">${list.length ? list.map(projCard).join('') : '<p class="muted" style="padding:1rem">No saved projects yet.</p>'}</div>
    </div>`;
  modal.classList.add('open');
  modal.onclick = (e) => {
    if (e.target.dataset.close !== undefined || e.target === modal) { modal.classList.remove('open'); return; }
    const open = e.target.closest('[data-open]'), del = e.target.closest('[data-del]');
    if (open) { store.loadProject(open.dataset.open); modal.classList.remove('open'); loadFresh(state.project); }
    if (del && confirm('Delete this project?')) { store.deleteProject(del.dataset.del); openProjectsModal(); }
  };
}
function projCard(p) {
  const q = quote(p), active = p.id === state.project.id;
  return `<div class="proj ${active ? 'proj--active' : ''}">
    <button class="proj-main" data-open="${p.id}">
      <b>${esc(p.name)}</b>
      <span class="muted">${p.client?.name ? esc(p.client.name) + ' · ' : ''}${q.panelCount} panel${q.panelCount !== 1 ? 's' : ''} · ${money(q.total)}</span>
      <span class="muted xs">updated ${new Date(p.updatedAt).toLocaleDateString()}</span>
    </button>
    <button class="icon-btn" data-del="${p.id}" title="Delete">🗑</button>
  </div>`;
}

// ---------------------------------------------------------------------------
const num = (v, f = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : f; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
