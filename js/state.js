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

const LS_LIBRARY = 'grd.library.v2';
const LS_ACTIVE = 'grd.active.v2';

export const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const defaultPricing = () => ({
  rates: Object.fromEntries(GLASS_ORDER.map((k) => [k, GLASS_TYPES[k].defaultRate])),
  holeCost: 6,
  temperPerSqFt: 0,
  markupPct: 0,
});

export const makePanel = (over = {}) => ({
  id: uid('pnl'),
  name: '',
  width: 36, height: 42, thickness: 0.5,
  glassType: 'clear', holes: 0,
  x: 0, z: 0, rotationY: 0, // ground position (in) + heading (deg)
  locked: false,
  ...over,
});

export function newProject(name = 'Untitled Design') {
  return {
    id: uid('prj'),
    name,
    client: { name: '', phone: '', email: '', address: '', notes: '' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    defaults: { width: 36, height: 42, thickness: 0.5, glassType: 'clear', holes: 0 },
    options: { showGrid: true, showLabels: true, camera: 'iso', snap: true, baseShoe: false, topRail: false },
    panels: [], // blank canvas
    pricing: defaultPricing(),
  };
}

// ---------------------------------------------------------------------------
export const state = { project: null, selectedPanelId: null };

const subscribers = new Set();
export const subscribe = (fn) => { subscribers.add(fn); return () => subscribers.delete(fn); };

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
}
export function listProjects() { return Object.values(readLib()).sort((a, b) => b.updatedAt - a.updatedAt); }

export function loadProject(id) {
  const lib = readLib();
  if (!lib[id]) return false;
  state.project = lib[id]; state.selectedPanelId = null;
  localStorage.setItem(LS_ACTIVE, id);
  emit(false); return true;
}
export function deleteProject(id) {
  const lib = readLib(); delete lib[id]; writeLib(lib);
  if (state.project && state.project.id === id) state.project = Object.values(lib)[0] || newProject();
  emit(false);
}
export function setActiveProject(project) {
  state.project = project; state.selectedPanelId = null; saveActive(); emit(false);
}
export function init() {
  const lib = readLib();
  const activeId = localStorage.getItem(LS_ACTIVE);
  state.project = (activeId && lib[activeId]) || Object.values(lib)[0] || newProject();
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
  const p = makePanel({ width: d.width, height: d.height, thickness: d.thickness, glassType: d.glassType, holes: d.holes, x, z, rotationY, ...over });
  ps.push(p);
  state.selectedPanelId = p.id;
  emit();
  return p.id;
}

/** Add several panels at once (used by templates); selects the first. */
export function addPanels(list) {
  const ids = list.map((over) => {
    const d = state.project.defaults;
    const p = makePanel({ width: d.width, height: d.height, thickness: d.thickness, glassType: d.glassType, holes: d.holes, ...over });
    state.project.panels.push(p);
    return p.id;
  });
  state.selectedPanelId = ids[0] || state.selectedPanelId;
  emit();
  return ids;
}

export function duplicatePanel(id) {
  const p = findPanel(id); if (!p) return null;
  const copy = makePanel({ ...p, id: uid('pnl'), x: p.x + 8, z: p.z + 8, locked: false });
  state.project.panels.push(copy);
  state.selectedPanelId = copy.id;
  emit();
  return copy.id;
}

export function removePanel(id) {
  state.project.panels = state.project.panels.filter((p) => p.id !== id);
  if (state.selectedPanelId === id) state.selectedPanelId = null;
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
  if (t.z != null) p.z = t.z;
  if (t.rotationY != null) p.rotationY = t.rotationY;
  if (save) emit(); else subscribers.forEach((fn) => fn(state.project));
}
