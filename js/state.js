/* =============================================================================
   state.js — project model + persistence + tiny pub/sub.

   A project is a BLANK CANVAS holding a flat list of glass panels. Each panel
   stands on the ground and carries its own size, finish, holes, position
   (x,z on the ground plane), rotation (about vertical) and lock state. This one
   model serves both glass railings and shower/enclosure layouts.

   Units: everything is INCHES. Angles are DEGREES (converted to radians only
   inside the 3D scene). Persistence is localStorage; a project is a self-
   contained JSON blob so backup/restore works across laptop ⇄ phone.
   ============================================================================= */

import { GLASS_TYPES, GLASS_ORDER } from './glassTypes.js';
import { defaultFeatureCosts, makeFeature } from './features.js';

const LS_LIBRARY = 'grd.library.v2';
const LS_ACTIVE = 'grd.active.v2';

export const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const round2 = (n) => Math.round((n || 0) * 100) / 100;

const defaultPricing = () => ({
  rates: Object.fromEntries(GLASS_ORDER.map((k) => [k, GLASS_TYPES[k].defaultRate])),
  featureCosts: defaultFeatureCosts(),
  temperPerSqFt: 0,
  railPerFt: 0,            // handrail price per linear foot
  markupPct: 0,
});

export const makePanel = (over = {}) => ({
  id: uid('pnl'),
  name: '',
  width: 36, height: 42, thickness: 0.5,
  widthTop: 36, heightRight: 42, baseRise: 0, customShape: false, // tapered / rake / stair-parallelogram panels
  poly: false, points: null, // freeform polygon outline ([[x-from-centre, y-up], …]); overrides the quad math
  glassType: 'clear',
  features: [],            // placed holes / cut-outs / spigots
  baseShoe: false,         // bottom mounting shoe (raises the glass) — per panel
  channels: { top: false, bottom: false, left: false, right: false }, // edge channels (showers)
  channelThickness: 1.5,   // visible width of the edge channel (in)
  x: 0, y: 0, z: 0, rotationY: 0, // ground position + elevation (in) + heading (deg)
  locked: false,
  ...over,
});

/** A handrail: a straight tube between two ground points, at a given height
    (with optional stair rise at the far end). */
export const makeRail = (over = {}) => ({
  id: uid('rail'),
  ax: 0, az: 0, bx: 36, bz: 0,   // ground endpoints (in)
  height: 42, rise: 0,           // top height at A (in); B is height + rise (stairs)
  profile: 'round',              // 'round' | 'square'
  size: 1.5,                     // tube diameter / side (in)
  posts: false,                  // drop vertical end posts to the ground
  ...over,
});

/** Backfill new fields on older/imported projects so the app never trips. */
function normalize(p) {
  if (!p) return p;
  p.options = p.options || {};
  if (p.options.units == null) p.options.units = 'ftin';
  if (!p.area) p.area = { width: 0, depth: 0 };
  p.pricing = p.pricing || defaultPricing();
  // merge so new feature buckets (e.g. spigot) get a default while keeping edits
  const hadFeatureCosts = !!p.pricing.featureCosts;
  p.pricing.featureCosts = { ...defaultFeatureCosts(), ...(p.pricing.featureCosts || {}) };
  if (!hadFeatureCosts && p.pricing.holeCost != null) p.pricing.featureCosts.hole = p.pricing.holeCost;
  if (p.pricing.railPerFt == null) p.pricing.railPerFt = 0;
  p.hardware = Array.isArray(p.hardware) ? p.hardware : [];
  p.rails = Array.isArray(p.rails) ? p.rails.map((r) => ({ ...makeRail(), ...r })) : [];
  (p.panels || []).forEach((pn) => {
    if (pn.y == null) pn.y = 0;
    if (pn.widthTop == null) pn.widthTop = pn.width;
    if (pn.heightRight == null) pn.heightRight = pn.height;
    if (pn.baseRise == null) pn.baseRise = 0;
    if (pn.customShape == null) pn.customShape = false;
    if (pn.poly == null) pn.poly = false;
    if (!Array.isArray(pn.points)) pn.points = null;
    if (pn.channelThickness == null) pn.channelThickness = 1.5;
    if (pn.baseShoe == null) pn.baseShoe = !!(p.options && p.options.baseShoe); // inherit old global
    if (!pn.channels) pn.channels = { top: false, bottom: false, left: false, right: false };
    if (!Array.isArray(pn.features)) {
      pn.features = [];
      const n = pn.holes || 0; // migrate the old "holes: N" count to placed holes (4" up from base)
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        pn.features.push(makeFeature('hole', round2(-pn.width / 2 + 4 + t * (pn.width - 8)), 4));
      }
    }
    (pn.features || []).forEach((f) => { if (f.kind === 'handle' && f.len == null) f.len = 8; }); // ladder-pull length
    delete pn.holes;
  });
  return p;
}

export function newProject(name = 'Untitled Design') {
  return {
    id: uid('prj'),
    name,
    client: { name: '', phone: '', email: '', address: '', notes: '' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    defaults: { width: 36, height: 42, thickness: 0.5, glassType: 'clear' },
    options: { showGrid: true, showLabels: true, camera: 'iso', snap: true, topRail: false, units: 'ftin' },
    area: { width: 0, depth: 0 }, // optional work-area footprint drawn on the ground (0 = off)
    panels: [], // blank canvas
    rails: [],  // handrails (two-point tubes)
    hardware: [], // bill of materials
    pricing: defaultPricing(),
  };
}

// ---------------------------------------------------------------------------
export const state = { project: null, selectedPanelId: null, selectedPanelIds: [], selectedRailId: null };

const subscribers = new Set();
export const subscribe = (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); };

// Optional cloud mirror (Firebase). When signed in, app.js wires { upsert, remove }
// here; saves/deletes are forwarded so designs sync. No-ops when signed out.
let cloudSync = null;
export const setCloudSync = (api) => { cloudSync = api; };

export function emit(touch = true) {
  if (touch && state.project) { state.project.updatedAt = Date.now(); saveActive(); }
  subscribers.forEach((fn) => fn(state.project));
}

// ---- persistence -----------------------------------------------------------
const readLib = () => { try { return JSON.parse(localStorage.getItem(LS_LIBRARY)) || {}; } catch { return {}; } };
const writeLib = (lib) => localStorage.setItem(LS_LIBRARY, JSON.stringify(lib));

export function saveActive() {
  if (!state.project) return;
  const lib = readLib();
  lib[state.project.id] = state.project;
  writeLib(lib);
  localStorage.setItem(LS_ACTIVE, state.project.id);
  cloudSync?.upsert?.(state.project); // mirror to the cloud (debounced; no-op if signed out)
}
export function listProjects() { return Object.values(readLib()).sort((a, b) => b.updatedAt - a.updatedAt); }

export function loadProject(id) {
  const lib = readLib();
  if (!lib[id]) return false;
  state.project = normalize(lib[id]); state.selectedPanelId = null; state.selectedPanelIds = []; state.selectedRailId = null;
  localStorage.setItem(LS_ACTIVE, id);
  emit(false); return true;
}
export function deleteProject(id) {
  const lib = readLib(); delete lib[id]; writeLib(lib);
  if (state.project && state.project.id === id) state.project = Object.values(lib)[0] || newProject();
  cloudSync?.remove?.(id);
  emit(false);
}

// ---- remote (cloud) changes ------------------------------------------------
// Applied by app.js from the Firestore listener. These touch localStorage
// DIRECTLY (no saveActive) so they never echo back to the cloud. Last-edit-wins
// by updatedAt: a remote copy only overwrites a local one when it's newer.
export function mergeRemoteDesign(remote) {
  if (!remote || !remote.id) return { changed: false };
  const lib = readLib();
  const cur = lib[remote.id];
  if (cur && (cur.updatedAt || 0) >= (remote.updatedAt || 0)) return { changed: false };
  lib[remote.id] = normalize(remote);
  writeLib(lib);
  if (state.project && state.project.id === remote.id) {
    state.project = lib[remote.id];
    return { changed: true, activeChanged: true };
  }
  return { changed: true, activeChanged: false };
}

export function removeRemoteDesign(id) {
  const lib = readLib();
  if (!lib[id]) return { changed: false };
  delete lib[id]; writeLib(lib);
  if (state.project && state.project.id === id) {
    state.project = Object.values(lib)[0] || newProject();
    return { changed: true, activeRemoved: true };
  }
  return { changed: true, activeRemoved: false };
}
export function setActiveProject(project) {
  state.project = normalize(project); state.selectedPanelId = null; state.selectedPanelIds = []; state.selectedRailId = null; saveActive(); emit(false);
}
export function init() {
  const lib = readLib();
  const activeId = localStorage.getItem(LS_ACTIVE);
  state.project = normalize((activeId && lib[activeId]) || Object.values(lib)[0] || newProject());
  saveActive();
}

// ---- backup / restore ------------------------------------------------------
export function exportJSON(project = state.project) { return JSON.stringify(project, null, 2); }
export function importJSON(text) {
  const p = JSON.parse(text);
  if (!p || !Array.isArray(p.panels)) throw new Error('Not a valid design file.');
  p.id = p.id || uid('prj'); p.name = p.name || 'Imported Design';
  setActiveProject(p); return p;
}

// ---------------------------------------------------------------------------
//  Panel mutations (all emit)
// ---------------------------------------------------------------------------
export function findPanel(id) { return state.project.panels.find((p) => p.id === id) || null; }

/** Drop a new panel; auto-places it just past the last panel so they don't stack. */
export function addPanel(over = {}) {
  const ps = state.project.panels;
  const d = state.project.defaults;
  let x = 0, z = 0, rotationY = 0;
  if (ps.length) {
    const last = ps[ps.length - 1];
    const t = (last.rotationY || 0) * Math.PI / 180;
    const w = over.width ?? d.width;
    const off = last.width / 2 + w / 2 + 2;
    x = last.x + Math.cos(t) * off;
    z = last.z - Math.sin(t) * off;
    rotationY = last.rotationY;
  }
  const p = makePanel({ width: d.width, height: d.height, thickness: d.thickness, glassType: d.glassType, x, z, rotationY, ...over });
  ps.push(p);
  state.selectedPanelId = p.id; state.selectedPanelIds = [p.id];
  emit();
  return p.id;
}

/** Add several panels at once (used by templates); selects the first. */
export function addPanels(list) {
  const ids = list.map((over) => {
    const d = state.project.defaults;
    const p = makePanel({ width: d.width, height: d.height, thickness: d.thickness, glassType: d.glassType, ...over });
    state.project.panels.push(p);
    return p.id;
  });
  state.selectedPanelId = ids[0] || state.selectedPanelId;
  state.selectedPanelIds = ids.length ? [ids[0]] : (state.selectedPanelIds || []);
  emit();
  return ids;
}

export function duplicatePanel(id) {
  const p = findPanel(id); if (!p) return null;
  const copy = makePanel({
    ...p, id: uid('pnl'), x: p.x + 8, z: p.z + 8, locked: false,
    features: (p.features || []).map((f) => ({ ...f, id: uid('ft') })),
  });
  state.project.panels.push(copy);
  state.selectedPanelId = copy.id; state.selectedPanelIds = [copy.id];
  emit();
  return copy.id;
}

export function removePanel(id) {
  state.project.panels = state.project.panels.filter((p) => p.id !== id);
  state.selectedPanelIds = (state.selectedPanelIds || []).filter((x) => x !== id);
  if (state.selectedPanelId === id) state.selectedPanelId = state.selectedPanelIds[state.selectedPanelIds.length - 1] || null;
  emit();
}

export function updatePanel(id, patch) {
  const p = findPanel(id); if (!p) return;
  Object.assign(p, patch);
  emit();
}

/** Lightweight live transform from the 3D gizmo. `save` persists (drag end). */
export function setPanelTransform(id, t, save = true) {
  const p = findPanel(id); if (!p) return;
  if (t.x != null) p.x = t.x;
  if (t.y != null) p.y = Math.max(0, t.y);
  if (t.z != null) p.z = t.z;
  if (t.rotationY != null) p.rotationY = t.rotationY;
  if (save) emit(); else subscribers.forEach((fn) => fn(state.project));
}

// ---- panel features (holes / cut-outs) ------------------------------------
export function addFeature(panelId, feat) {
  const p = findPanel(panelId); if (!p) return null;
  (p.features = p.features || []).push(feat);
  emit();
  return feat.id;
}
export function updateFeature(panelId, featId, patch) {
  const p = findPanel(panelId); if (!p) return;
  const f = (p.features || []).find((x) => x.id === featId); if (!f) return;
  Object.assign(f, patch); emit();
}
export function removeFeature(panelId, featId) {
  const p = findPanel(panelId); if (!p) return;
  p.features = (p.features || []).filter((x) => x.id !== featId); emit();
}

/** Live feature reposition from the Select-tool drag. `save` persists (drag end). */
export function setFeaturePos(panelId, featId, x, y, save = true) {
  const p = findPanel(panelId); if (!p) return;
  const f = (p.features || []).find((z) => z.id === featId); if (!f) return;
  f.x = x; f.y = y;
  if (save) emit(); else subscribers.forEach((fn) => fn(state.project));
}

// ---- handrails ------------------------------------------------------------
export function findRail(id) { return (state.project.rails || []).find((r) => r.id === id) || null; }

export function addRail(over = {}) {
  state.project.rails = state.project.rails || [];
  const r = makeRail(over);
  state.project.rails.push(r);
  state.selectedRailId = r.id;
  emit();
  return r.id;
}
export function updateRail(id, patch) {
  const r = findRail(id); if (!r) return;
  Object.assign(r, patch); emit();
}
export function removeRail(id) {
  state.project.rails = (state.project.rails || []).filter((r) => r.id !== id);
  if (state.selectedRailId === id) state.selectedRailId = null;
  emit();
}
/** Live endpoint drag from the 3D view. `save` persists (drag end). */
export function setRailEndpoint(id, end, x, z, save = true) {
  const r = findRail(id); if (!r) return;
  if (end === 'a') { r.ax = x; r.az = z; } else { r.bx = x; r.bz = z; }
  if (save) emit(); else subscribers.forEach((fn) => fn(state.project));
}

// ---- hardware bill of materials -------------------------------------------
export function addHardware(line) {
  state.project.hardware = state.project.hardware || [];
  const l = { id: uid('hw'), qty: 1, ...line };
  state.project.hardware.push(l); emit(); return l.id;
}
export function updateHardware(id, patch) {
  const l = (state.project.hardware || []).find((x) => x.id === id); if (!l) return;
  Object.assign(l, patch); emit();
}
export function removeHardware(id) {
  state.project.hardware = (state.project.hardware || []).filter((x) => x.id !== id); emit();
}
