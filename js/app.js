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
import { panelDims } from './geometry.js';
import { allLibraries, saveCustomItem } from './hardware.js';
import { downloadImage, printReport } from './exporter.js';
import { openPolyEditor } from './polyEditor.js';
import * as cloud from './cloud.js';

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
  scene.onRailSelect(onSceneRailSelect);
  scene.onRailCreate(onSceneRailCreate);
  scene.onRailEndpoint(onSceneRailEndpoint);
  scene.onRailMove(onSceneRailMove);

  wireHeader(); wireViewTools(); wireControls(); wireAccount();

  renderAll();
  scene.setCamera(state.project.options.camera || 'iso');
  scene.render(state.project); scene.select(state.selectedPanelIds); scene.fit();

  // Optional cloud sync — local-first, so this just mirrors designs when signed in.
  store.setCloudSync({ upsert: cloud.pushDesign, remove: cloud.deleteDesign });
  cloud.initCloud({
    onStatus: setSyncStatus,
    onUser: setAccountUI,
    onRemoteDesign: applyRemoteDesign,
    onRemoteDelete: applyRemoteDelete,
    getLocalDesigns: () => store.listProjects(),
  });
}

// ---- render pipeline -------------------------------------------------------
function renderAll() { renderControls(); renderScene({ fit: false }); renderHeader(); }

function renderControls() {
  controlsEl.innerHTML = controlsHTML(state.project, state.selectedPanelId, state.selectedRailId);
  (state.selectedPanelIds || []).forEach((id) => cardFor(id)?.classList.add('panel-card--sel'));
  renderTotals(); renderPlan();
}
function renderScene({ fit = false } = {}) {
  setUnitMode(state.project.options.units);
  scene.render(state.project);
  scene.select(state.selectedPanelIds);
  scene.selectRail(state.selectedRailId);
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
  planEl?.addEventListener('click', (e) => { const id = e.target.getAttribute?.('data-panel'); if (id) selectPanel(id, e.shiftKey); });
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

  // handrail numeric fields (height / rise / size / endpoints)
  if (el.dataset.rail && f?.startsWith('rail.')) {
    store.updateRail(el.dataset.rail, { [f.slice(5)]: num(el.value, 0) });
    renderScene(); renderTotals();
    return;
  }
  if (!f) return;

  if (f === 'name') { state.project.name = el.value; renderHeader(); emit(); return; }
  if (f.startsWith('client.')) { state.project.client[f.slice(7)] = el.value; emit(); return; }
  if (f === 'area.width' || f === 'area.depth') { state.project.area[f.split('.')[1]] = Math.max(0, num(el.value, 0)); emit(); renderScene(); return; }

  if (f === 'panel.name') { store.updatePanel(el.dataset.panel, { name: el.value }); renderScene(); return; }

  if (['panel.width', 'panel.height', 'panel.widthTop', 'panel.heightRight', 'panel.baseRise'].includes(f)) {
    store.updatePanel(el.dataset.panel, { [f.split('.')[1]]: num(el.value, 12) });
    renderScene(); renderTotals(); refreshCardCost(el.dataset.panel);
    return;
  }
  if (f === 'panel.thickness') { store.updatePanel(el.dataset.panel, { thickness: num(el.value, 0.5) }); renderScene(); return; }
  if (f === 'panel.channelThickness') { store.updatePanel(el.dataset.panel, { channelThickness: Math.max(0.25, num(el.value, 1.5)) }); renderScene(); return; }
  if (f === 'panel.x' || f === 'panel.z' || f === 'panel.rotationY' || f === 'panel.y') {
    store.updatePanel(el.dataset.panel, { [f.split('.')[1]]: num(el.value, 0) });
    renderScene();
    return;
  }

  // placed feature edits — positions/sizes are relative to (and bounded by) THIS panel
  if (f.startsWith('feat.')) {
    const panelId = el.dataset.panel, featId = el.dataset.feat;
    const p = store.findPanel(panelId); if (!p) return;
    const d = panelDims(p);
    const v = num(el.value, 0);
    const patch = {};
    if (f === 'feat.fromLeft') patch.x = clamp(v, 0, d.wBottom) - p.width / 2;     // L: from left edge
    else if (f === 'feat.fromBottom') patch.y = clamp(v, 0, d.hMax);                // B: up from the base
    else patch[f.split('.')[1]] = Math.max(0.0625, v);                             // d / w / h
    store.updateFeature(panelId, featId, patch);
    renderScene();
    return;
  }

  if (f === 'rate') { state.project.pricing.rates[el.dataset.glass] = num(el.value); emit(); renderTotals(); return; }
  if (f === 'featCost') { state.project.pricing.featureCosts[el.dataset.fkey] = num(el.value); emit(); renderTotals(); return; }
  if (['temperPerSqFt', 'markupPct', 'railPerFt'].includes(f)) { state.project.pricing[f] = num(el.value); emit(); renderTotals(); return; }
}

function onControlChange(e) {
  const el = e.target;
  if (el.dataset.railfield === 'profile') {
    store.updateRail(el.dataset.rail, { profile: el.value }); renderScene();
    return;
  }
  if (el.dataset.railposts !== undefined) {
    store.updateRail(el.dataset.rail, { posts: el.checked });
    el.closest('.ch-tog')?.classList.toggle('on', el.checked);
    renderScene();
    return;
  }
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
  if (el.dataset.channel) {
    const p = store.findPanel(el.dataset.panel);
    if (p) { store.updatePanel(el.dataset.panel, { channels: { ...(p.channels || {}), [el.dataset.channel]: el.checked } }); }
    el.closest('.ch-tog')?.classList.toggle('on', el.checked);
    renderScene();
    return;
  }
  if (el.dataset.baseshoe !== undefined) {
    store.updatePanel(el.dataset.panel, { baseShoe: el.checked });
    el.closest('.ch-tog')?.classList.toggle('on', el.checked);
    renderScene();
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
  // A pricing-rate change affects EVERY panel's displayed cost — refresh those in
  // place. We deliberately do NOT rebuild the whole form here, so the browser's
  // native Tab key keeps moving from field to field (rebuilding would destroy the
  // field you're tabbing into). All other value edits are already kept current by
  // the live `input` handler above.
  if (['rate', 'featCost', 'temperPerSqFt'].includes(el.dataset.field)) refreshAllPanelCosts();
}

function onControlClick(e) {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const act = btn.dataset.act, id = btn.dataset.panel, railId = btn.dataset.rail;
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
      state.selectedPanelId = id; state.selectedPanelIds = [id];
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
      selectPanel(id, e.shiftKey);
      break;
    case 'editPoly': openPanelPolyEditor(id); break;
    case 'clearPoly':
      store.updatePanel(id, { poly: false, points: null });
      renderControls(); renderScene();
      break;
    case 'drawRail': setTool('rail'); break;
    case 'removeRail': store.removeRail(railId); renderControls(); renderScene(); break;
    case 'selectRail':
      if (e.target.closest('input,select,button,textarea')) return;
      selectRail(railId);
      break;
  }
}

// ---- custom polygon outline ------------------------------------------------
function openPanelPolyEditor(id) {
  const p = store.findPanel(id); if (!p) return;
  state.selectedPanelId = id; state.selectedPanelIds = [id];
  openPolyEditor($('#modal'), { points: p.points, width: p.width, height: p.height, name: p.name || '' }, (points) => {
    store.updatePanel(id, { poly: true, points, customShape: false });
    renderControls(); renderScene({ fit: true });
  });
}

// ---- handrails -------------------------------------------------------------
// Endpoints snapped to glass report that panel's top height, so a new handrail
// sits ON the glass (and follows a stair run as rise) instead of a flat default.
function onSceneRailCreate(ax, az, bx, bz, topA, topB) {
  if (Math.hypot(bx - ax, bz - az) < 1) return; // ignore a double-click in place
  const over = { ax, az, bx, bz };
  if (topA != null || topB != null) {
    const hA = topA != null ? topA : topB;
    const hB = topB != null ? topB : hA;
    over.height = round(hA); over.rise = round(hB - hA);
  }
  store.addRail(over);
  state.selectedRailId = state.project.rails[state.project.rails.length - 1].id;
  renderControls(); renderScene();
  railCardFor(state.selectedRailId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function onSceneRailSelect(railId) { selectRail(railId); }
function setRailCardFields(railId, vals) {
  const card = railCardFor(railId); if (!card) return;
  for (const [f, v] of Object.entries(vals)) {
    const el = card.querySelector(`input[data-field="${f}"]`);
    if (el && document.activeElement !== el) el.value = round(v);
  }
}
function onSceneRailEndpoint(railId, end, x, z, save) {
  store.setRailEndpoint(railId, end, x, z, save);
  setRailCardFields(railId, end === 'a' ? { 'rail.ax': x, 'rail.az': z } : { 'rail.bx': x, 'rail.bz': z });
  if (save) { renderControls(); renderTotals(); }
  renderPlan();
}
function onSceneRailMove(railId, pos, save) {
  store.setRailPos(railId, pos, save);
  setRailCardFields(railId, { 'rail.ax': pos.ax, 'rail.az': pos.az, 'rail.bx': pos.bx, 'rail.bz': pos.bz });
  if (save) { renderControls(); renderTotals(); }
  renderPlan();
}
function selectRail(railId) {
  state.selectedRailId = railId || null;
  state.selectedPanelIds = []; state.selectedPanelId = null;
  scene.select([]); scene.selectRail(state.selectedRailId);
  controlsEl.querySelectorAll('.panel-card--sel').forEach((n) => n.classList.remove('panel-card--sel'));
  railCardFor(railId)?.classList.add('panel-card--sel');
  renderPlan();
}
const railCardFor = (id) => controlsEl.querySelector(`.panel-card[data-rail="${id}"]`);

// ---- stamping holes / cut-outs from the 3D view ----------------------------
function onSceneStamp(panelId, kind, x, y) {
  store.addFeature(panelId, makeFeature(kind, x, y));
  state.selectedPanelId = panelId; state.selectedPanelIds = [panelId];
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
  state.selectedPanelId = panelId; state.selectedPanelIds = [panelId];
  scene.select(state.selectedPanelIds);
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
// `additive` (Shift) adds/removes from the multi-selection; otherwise selects one.
function selectPanel(id, additive) {
  if (!id) state.selectedPanelIds = [];
  else if (additive) {
    const set = new Set(state.selectedPanelIds || []);
    set.has(id) ? set.delete(id) : set.add(id);
    state.selectedPanelIds = [...set];
  } else {
    state.selectedPanelIds = [id];
  }
  state.selectedPanelId = state.selectedPanelIds[state.selectedPanelIds.length - 1] || null;
  if (state.selectedRailId) { state.selectedRailId = null; scene.selectRail(null); }
  scene.select(state.selectedPanelIds);
  controlsEl.querySelectorAll('.panel-card--sel').forEach((n) => n.classList.remove('panel-card--sel'));
  state.selectedPanelIds.forEach((pid) => cardFor(pid)?.classList.add('panel-card--sel'));
  renderPlan();
}
function onScenePick(id, additive) {
  selectPanel(id, additive);
  if (id && !additive) cardFor(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
function refreshAllPanelCosts() {
  state.project.panels.forEach((p) => {
    const card = cardFor(p.id);
    if (card) card.querySelector('.pcost').textContent = money(panelCost(p, state.project.pricing).total);
  });
  renderTotals();
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

// ---------------------------------------------------------------------------
//  Account + cloud sync UI
// ---------------------------------------------------------------------------
let signedIn = false;
function wireAccount() {
  const btn = $('#btnAccount'), menu = $('#acctMenu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!signedIn) { cloud.signIn(); return; } // signed out → start Google sign-in
    menu.classList.toggle('open');             // signed in → show account menu
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
  menu.addEventListener('click', (e) => {
    if (e.target.closest('[data-acct="signout"]')) { menu.classList.remove('open'); cloud.signOut(); }
  });
}

function setAccountUI(user) {
  signedIn = !!user;
  const label = $('#acctLabel');
  if (user) {
    label.textContent = (user.name || user.email || 'Account').split(' ')[0];
    $('#btnAccount').title = 'Synced as ' + (user.email || '');
    $('#acctName').textContent = user.name || '';
    $('#acctEmail').textContent = user.email || '';
  } else {
    label.textContent = 'Sign in';
    $('#btnAccount').title = 'Sign in to sync across devices';
    $('#acctMenu').classList.remove('open');
  }
}

const SYNC_TITLES = { 'signed-out': 'Not signed in — designs stay on this device', syncing: 'Syncing…', synced: 'All designs synced', offline: 'Offline — will sync when reconnected', error: 'Sync error — check connection' };
function setSyncStatus(status) {
  const dot = $('#syncDot'); if (!dot) return;
  dot.className = 'sync-dot sync-' + status;
  dot.title = SYNC_TITLES[status] || '';
}

// A remote design arrived from another device. Don't clobber a field you're
// editing right now; otherwise merge (last-edit-wins) and refresh if it's active.
function applyRemoteDesign(project) {
  if (project.id === state.project?.id && isEditingControls()) return;
  const res = store.mergeRemoteDesign(project);
  if (res.activeChanged) { renderAll(); scene.render(state.project); scene.select(state.selectedPanelIds); scene.selectRail(state.selectedRailId); }
}
function applyRemoteDelete(id) {
  const res = store.removeRemoteDesign(id);
  if (res.activeRemoved) {
    state.selectedPanelId = null; state.selectedPanelIds = []; state.selectedRailId = null;
    renderAll(); scene.render(state.project); scene.fit();
  }
}
const isEditingControls = () => { const a = document.activeElement; return a && controlsEl.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName); };

const HINTS = {
  select: 'Holes tool · drag a hole / cut-out to move it around on its glass (panels: use Move / Rotate)',
  move: 'Move tool · drag a panel gizmo, or drag a handrail to slide it (drag a blue end-dot to adjust one end)',
  rotate: 'Rotate tool · click a panel, then drag the ring to spin it',
  rail: 'Rail tool · click a start point, then an end point to draw a handrail · it snaps onto nearby glass · drag the rail or its end-dots to adjust',
};
const setHint = (t) => { const h = $('.hint'); if (h) h.textContent = t; };

/** Switch the active manipulation tool and sync the toolbar. */
function setTool(name) {
  scene.setTool(name);
  $('#vtSelect').classList.toggle('on', name === 'select');
  $('#vtMove').classList.toggle('on', name === 'move');
  $('#vtRotate').classList.toggle('on', name === 'rotate');
  $('#vtRail').classList.toggle('on', name === 'rail');
  $('#vtStamp').classList.remove('on'); $('#vtStamp').textContent = 'Stamp ▾';
  $$('#stampMenu [data-stamp]').forEach((x) => x.classList.toggle('on', x.dataset.stamp === 'off'));
  setHint(HINTS[name] || HINTS.select);
}

function setStamp(kind) {
  if (kind === 'off') { setTool('move'); return; }
  scene.setTool('stamp', kind);
  ['vtSelect', 'vtMove', 'vtRotate', 'vtRail'].forEach((id) => $('#' + id).classList.remove('on'));
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
  $('#vtRail').addEventListener('click', () => setTool('rail'));
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
    case 'print': printReport(state.project, scene.snapshot({ scale: 2 }), { pricing: true, panelImages: scene.snapshotPanels({ scale: 2 }) }); break;
    case 'print-nopricing': printReport(state.project, scene.snapshot({ scale: 2 }), { pricing: false, panelImages: scene.snapshotPanels({ scale: 2 }) }); break;
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
  state.selectedPanelId = null; state.selectedPanelIds = [];
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
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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
