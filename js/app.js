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
import { quote, money, panelCost, setUnitMode } from './pricing.js';
import { makeFeature, featureType } from './features.js';
import { allLibraries, saveCustomItem } from './hardware.js';
import { downloadImage, printReport } from './exporter.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let stageEl, controlsEl, totalsEl, planEl;

boot();

function boot() {
  store.init();
  stageEl = $('#stage'); controlsEl = $('#controls'); totalsEl = $('#totals'); planEl = $('#planThumb');

  scene.init(stageEl);
  scene.onSelect(onScenePick);
  scene.onTransform(onSceneTransform);
  scene.onStamp(onSceneStamp);
  scene.onFeatureMove(onSceneFeatureMove);
  scene.onFeatureSelect(onSceneFeatureSelect);

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
  setUnitMode(state.project.options.units);
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
  const el = e.target, f = el.dataset.field;

  // hardware line fields (qty / price / name)
  if (el.dataset.hwfield) {
    const id = el.closest('[data-hw-line]')?.dataset.hwLine;
    const key = el.dataset.hwfield;
    store.updateHardware(id, { [key]: key === 'name' ? el.value : num(el.value, 0) });
    if (key !== 'name') { renderTotals(); refreshHwLineTotal(id); }
    return;
  }
  if (!f) return;

  if (f === 'name') { state.project.name = el.value; renderHeader(); emit(); return; }
  if (f.startsWith('client.')) { state.project.client[f.slice(7)] = el.value; emit(); return; }

  if (f === 'panel.name') { store.updatePanel(el.dataset.panel, { name: el.value }); renderScene(); return; }

  if (['panel.width', 'panel.height', 'panel.widthTop', 'panel.heightRight'].includes(f)) {
    store.updatePanel(el.dataset.panel, { [f.split('.')[1]]: num(el.value, 12) });
    renderScene(); renderTotals(); refreshCardCost(el.dataset.panel);
    return;
  }
  if (f === 'panel.thickness') { store.updatePanel(el.dataset.panel, { thickness: num(el.value, 0.5) }); renderScene(); return; }
  if (f === 'panel.x' || f === 'panel.z' || f === 'panel.rotationY' || f === 'panel.y') {
    store.updatePanel(el.dataset.panel, { [f.split('.')[1]]: num(el.value, 0) });
    renderScene();
    return;
  }

  // placed feature edits (position from corner / size)
  if (f.startsWith('feat.')) {
    const panelId = el.dataset.panel, featId = el.dataset.feat;
    const p = store.findPanel(panelId); if (!p) return;
    const v = num(el.value, 0);
    const patch = {};
    if (f === 'feat.fromLeft') patch.x = v - p.width / 2;
    else if (f === 'feat.fromBottom') patch.y = v - p.height / 2;
    else patch[f.split('.')[1]] = v; // d / w / h
    store.updateFeature(panelId, featId, patch);
    renderScene();
    return;
  }

  if (f === 'rate') { state.project.pricing.rates[el.dataset.glass] = num(el.value); emit(); renderTotals(); return; }
  if (f === 'featCost') { state.project.pricing.featureCosts[el.dataset.fkey] = num(el.value); emit(); renderTotals(); return; }
  if (['temperPerSqFt', 'markupPct'].includes(f)) { state.project.pricing[f] = num(el.value); emit(); renderTotals(); return; }
}

function onControlChange(e) {
  const el = e.target;
  if (el.dataset.optUnits !== undefined) {
    state.project.options.units = el.value; emit();
    setUnitMode(el.value); renderScene();
    return;
  }
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
  if (el.dataset.field === 'panel.customShape') {
    store.updatePanel(el.dataset.panel, { customShape: el.checked });
    renderControls(); renderScene();
    return;
  }
  // commit (rebuild for consistent per-line/per-panel costs + derived values) on blur
  if (el.dataset.hwfield || (el.dataset.field || '').startsWith('feat.') ||
    ['rate', 'featCost', 'temperPerSqFt', 'markupPct', 'panel.width', 'panel.height',
      'panel.widthTop', 'panel.heightRight', 'panel.thickness', 'panel.y'].includes(el.dataset.field)) {
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
    case 'addFeatureCenter':
      store.addFeature(id, makeFeature(btn.dataset.kind, 0, 0));
      state.selectedPanelId = id;
      renderControls(); renderScene();
      break;
    case 'removeFeature':
      store.removeFeature(id, btn.dataset.feat);
      renderControls(); renderScene();
      break;
    case 'addHardware': {
      const sel = controlsEl.querySelector('[data-hw="pick"]');
      const [libId, itemId] = (sel?.value || '').split('|');
      const lib = allLibraries().find((l) => l.id === libId);
      const it = lib?.items.find((x) => x.id === itemId);
      if (it) { store.addHardware({ lib: libId, name: it.name, unit: it.unit, price: it.price }); renderControls(); }
      break;
    }
    case 'removeHardware':
      store.removeHardware(btn.dataset.hwLine);
      renderControls();
      break;
    case 'saveCustomHw': {
      const name = controlsEl.querySelector('[data-hw="custName"]')?.value.trim();
      const price = num(controlsEl.querySelector('[data-hw="custPrice"]')?.value, 0);
      if (!name) { alert('Enter an item name.'); break; }
      saveCustomItem({ id: 'cu_' + Date.now().toString(36), cat: 'Custom', name, unit: 'ea', price });
      renderControls();
      break;
    }
    case 'selectPanel':
      if (e.target.closest('input,select,button,textarea')) return;
      selectPanel(id);
      break;
  }
}

// ---- stamping holes / cut-outs from the 3D view ----------------------------
function onSceneStamp(panelId, kind, x, y) {
  store.addFeature(panelId, makeFeature(kind, x, y));
  state.selectedPanelId = panelId;
  renderControls(); renderScene();
}

// ---- dragging / selecting a placed feature with the Select tool ------------
const round = (n) => Math.round((n || 0) * 100) / 100;
function onSceneFeatureMove(panelId, featId, pos, save) {
  store.setFeaturePos(panelId, featId, pos.x, pos.y, save);
  const panel = store.findPanel(panelId);
  const row = cardFor(panelId)?.querySelector(`.feat-row[data-feat="${featId}"]`);
  if (row && panel) {
    const set = (f, v) => { const el = row.querySelector(`input[data-field="${f}"]`); if (el && document.activeElement !== el) el.value = v; };
    set('feat.fromLeft', round(panel.width / 2 + pos.x));
    set('feat.fromBottom', round(pos.y));
  }
  if (save) renderControls();
}
function onSceneFeatureSelect(panelId, featId) {
  state.selectedPanelId = panelId;
  scene.select(panelId);
  renderControls();
  const row = cardFor(panelId)?.querySelector(`.feat-row[data-feat="${featId}"]`);
  if (row) { row.classList.add('feat-row--sel'); row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
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
    set('panel.x', t.x); set('panel.z', t.z); set('panel.rotationY', t.rotationY); set('panel.y', t.y);
  }
  renderPlan();
}

function refreshCardCost(id) {
  const p = store.findPanel(id); if (!p) return;
  const card = cardFor(id);
  if (card) card.querySelector('.pcost').textContent = money(panelCost(p, state.project.pricing).total);
}
const cardFor = (id) => controlsEl.querySelector(`.panel-card[data-panel="${id}"]`);
function refreshHwLineTotal(id) {
  const l = (state.project.hardware || []).find((x) => x.id === id); if (!l) return;
  const row = controlsEl.querySelector(`.hw-line[data-hw-line="${id}"]`);
  if (row) row.querySelector('.hw-total').textContent = money((l.qty || 0) * (l.price || 0));
}

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

const HINTS = {
  select: 'Holes tool · drag a hole / cut-out to move it around on its glass (panels: use Move / Rotate)',
  move: 'Move tool · click a panel, then drag the gizmo arrows (incl. up/down for stairs)',
  rotate: 'Rotate tool · click a panel, then drag the ring to spin it',
};
const setHint = (t) => { const h = $('.hint'); if (h) h.textContent = t; };

/** Switch the active manipulation tool and sync the toolbar. */
function setTool(name) {
  scene.setTool(name);
  $('#vtSelect').classList.toggle('on', name === 'select');
  $('#vtMove').classList.toggle('on', name === 'move');
  $('#vtRotate').classList.toggle('on', name === 'rotate');
  $('#vtStamp').classList.remove('on'); $('#vtStamp').textContent = 'Stamp ▾';
  $$('#stampMenu [data-stamp]').forEach((x) => x.classList.toggle('on', x.dataset.stamp === 'off'));
  setHint(HINTS[name] || HINTS.select);
}

function setStamp(kind) {
  if (kind === 'off') { setTool('move'); return; }
  scene.setTool('stamp', kind);
  ['vtSelect', 'vtMove', 'vtRotate'].forEach((id) => $('#' + id).classList.remove('on'));
  const btn = $('#vtStamp');
  btn.classList.add('on'); btn.textContent = 'Stamp: ' + featureType(kind).short;
  setHint(`Click a panel to place a ${featureType(kind).name}`);
  $$('#stampMenu [data-stamp]').forEach((x) => x.classList.toggle('on', x.dataset.stamp === kind));
}

function wireViewTools() {
  $('#vtAdd').addEventListener('click', () => { setTool('move'); store.addPanel(); renderControls(); renderScene({ fit: true }); });
  $('#vtSelect').addEventListener('click', () => setTool('select'));
  $('#vtMove').addEventListener('click', () => setTool('move'));
  $('#vtRotate').addEventListener('click', () => setTool('rotate'));
  $('#vtSnap').addEventListener('click', () => {
    state.project.options.snap = !state.project.options.snap; emit();
    scene.setSnap(state.project.options.snap); renderHeader();
    const cb = controlsEl.querySelector('[data-opt="snap"]'); if (cb) cb.checked = state.project.options.snap;
  });

  const stampBtn = $('#vtStamp'), stampMenu = $('#stampMenu');
  stampBtn.addEventListener('click', (e) => { e.stopPropagation(); stampMenu.classList.toggle('open'); });
  document.addEventListener('click', () => stampMenu.classList.remove('open'));
  stampMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-stamp]'); if (!b) return;
    stampMenu.classList.remove('open');
    setStamp(b.dataset.stamp);
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
    case 'print': printReport(state.project, scene.snapshot({ scale: 2 }), { pricing: true }); break;
    case 'print-nopricing': printReport(state.project, scene.snapshot({ scale: 2 }), { pricing: false }); break;
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
  // Auto-update: when a freshly deployed service worker takes control, reload once
  // so the new version shows up on its own (no manual hard-refresh needed).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return; // skip the very first install (nothing to replace)
    reloading = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      setInterval(() => reg.update(), 60 * 60 * 1000); // check for updates hourly while open
    }).catch(() => {});
  });
}
