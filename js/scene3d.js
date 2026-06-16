/* =============================================================================
   scene3d.js — the semi-3D viewport (Three.js) for a freeform set of glass
   panels on a blank canvas.

   • Reconciling renderer: render(project) diffs the panel list against existing
     meshes and updates in place, so editing a dimension re-sizes a panel live
     without rebuilding the world (and without dropping the move gizmo).
   • Move / rotate gizmo (TransformControls): click a panel to select, drag to
     reposition on the ground (X/Z) or rotate about vertical. Locked panels
     can't be dragged. Writes back to the model live via onTransform().
   • Two cameras share the scene: orthographic ISO (rotation locked) and
     perspective 3D (full orbit). A faint optional grid + soft contact shadow
     ground the glass — no deck, floor or house.

   Public API:
     init(el); render(project); setCamera('iso'|'3d'); setGizmoMode('translate'
     |'rotate'); setSnap(bool); setLabels(bool); setGrid(bool); select(id);
     fit(); snapshot(); onSelect(cb); onTransform(cb)
   ============================================================================= */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { glassType } from './glassTypes.js';
import { featureType } from './features.js';
import { panelLabel, ftIn } from './pricing.js';
import { BASE_H, panelCorners, panelDims } from './geometry.js';

let renderer, labelRenderer, scene, world, container;
let orbit, gizmo, perspCam, orthoCam, activeCam;
let grid, shadowPlane;
let mode = 'iso', gizmoMode = 'translate', snap = true, showLabels = true, showGrid = true;
let interaction = 'select', stampKind = 'hole';
let needsRender = true, raf = 0;
let project = null;
let selectCb = null, transformCb = null, stampCb = null;
let draggingId = null, selectedId = null;

const entries = new Map(); // panelId -> { group, glass, edges, chip, sig }
const contentBox = new THREE.Box3();

const ISO_AZ = Math.PI / 4;
const ISO_EL = Math.atan(Math.SQRT1_2);
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

const metalMat = () => new THREE.MeshStandardMaterial({ color: 0xc3c7cc, roughness: 0.35, metalness: 0.85 });
const edgeMat = () => new THREE.LineBasicMaterial({ color: 0x223040, transparent: true, opacity: 0.55 });
const selEdgeMat = new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 1 });
function glassMaterial(tint) {
  return new THREE.MeshStandardMaterial({
    color: tint.render.color, roughness: tint.render.roughness, metalness: 0,
    transparent: true, opacity: tint.render.opacity, side: THREE.DoubleSide, envMapIntensity: 1.1,
  });
}

// ---------------------------------------------------------------------------
export function init(el) {
  container = el;
  const w = el.clientWidth || 800, h = el.clientHeight || 600;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  el.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.background = makeBackdrop();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(180, 320, 160); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { near: 10, far: 1600, left: -500, right: 500, top: 500, bottom: -500 });
  scene.add(sun);

  // soft contact shadow catcher (grounds the glass; not a visible floor)
  shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.16 }));
  shadowPlane.rotation.x = -Math.PI / 2; shadowPlane.position.y = 0; shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  grid = new THREE.GridHelper(480, 40, 0x9aa7b6, 0xc2cdd8);
  grid.material.transparent = true; grid.material.opacity = 0.5; grid.position.y = 0.02;
  scene.add(grid);

  perspCam = new THREE.PerspectiveCamera(42, w / h, 1, 100000);
  orthoCam = new THREE.OrthographicCamera(-w, w, h, -h, -100000, 100000);
  activeCam = orthoCam;

  orbit = new OrbitControls(activeCam, renderer.domElement);
  orbit.enableDamping = true; orbit.dampingFactor = 0.12;
  orbit.addEventListener('change', () => { needsRender = true; });

  gizmo = new TransformControls(activeCam, renderer.domElement);
  gizmo.setSpace('world');
  gizmo.addEventListener('change', () => { needsRender = true; });
  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (!e.value && draggingId) { commitTransform(draggingId, true); draggingId = null; }
  });
  gizmo.addEventListener('objectChange', () => {
    if (gizmo.object && gizmo.object.userData.panelId) {
      draggingId = gizmo.object.userData.panelId;
      commitTransform(draggingId, false);
    }
  });
  scene.add(gizmo);
  applyMode();

  world = new THREE.Group();
  scene.add(world);

  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);
  new ResizeObserver(resize).observe(el);
  loop();
}

function makeBackdrop() {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#eef3f8'); g.addColorStop(1, '#d3dbe5');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

// ---------------------------------------------------------------------------
//  Reconcile the scene with the model
// ---------------------------------------------------------------------------
export function render(proj) {
  project = proj;
  showLabels = proj.options.showLabels; showGrid = proj.options.showGrid;
  snap = proj.options.snap;
  grid.visible = showGrid;
  labelRenderer.domElement.style.display = showLabels ? '' : 'none';

  const seen = new Set();
  proj.panels.forEach((p, i) => {
    seen.add(p.id);
    const sig = signature(p, proj.options, i);
    let e = entries.get(p.id);
    if (!e) { e = { group: new THREE.Group() }; e.group.userData.panelId = p.id; world.add(e.group); entries.set(p.id, e); }
    if (e.sig !== sig) { buildPanel(e, p, i, proj.options); e.sig = sig; }
    e.group.position.set(p.x, p.y || 0, p.z);
    e.group.rotation.y = (p.rotationY || 0) * D2R;
  });
  // remove deleted
  for (const [id, e] of entries) {
    if (seen.has(id)) continue;
    disposeGroup(e.group); world.remove(e.group); entries.delete(id);
    if (gizmo.object === e.group) gizmo.detach();
  }
  refreshSelection();
  recomputeContentBox();
  setSnap(snap);
  needsRender = true;
}

const signature = (p, o, i) =>
  [p.width, p.height, p.thickness, p.widthTop, p.heightRight, p.customShape, p.glassType,
    o.baseShoe, o.topRail, showLabels, panelLabel(p, i),
    (p.features || []).map((f) => `${f.kind}:${f.x}:${f.y}:${f.d || ''}:${f.w || ''}:${f.h || ''}`).join(',')].join('|');

function glassGeometry(p) {
  const c = panelCorners(p);
  const shape = new THREE.Shape();
  shape.moveTo(c[0][0], c[0][1]);
  for (let i = 1; i < c.length; i++) shape.lineTo(c[i][0], c[i][1]);
  shape.closePath();
  const t = p.thickness || 0.5;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -t / 2); // centre across thickness; base stays at local y = 0
  return geo;
}

function buildPanel(entry, p, i, o) {
  const g = entry.group;
  disposeChildren(g);
  const tint = glassType(p.glassType);
  const d = panelDims(p);
  const y0 = o.baseShoe ? BASE_H : 0; // glass sits on top of the shoe when enabled

  if (o.baseShoe) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(d.wBottom + 1, BASE_H, 3.2), metalMat());
    shoe.position.y = BASE_H / 2; shoe.castShadow = true; shoe.receiveShadow = true; g.add(shoe);
  }

  const geo = glassGeometry(p);
  const glass = new THREE.Mesh(geo, glassMaterial(tint));
  glass.position.y = y0; glass.castShadow = true;
  glass.userData.panelId = p.id;
  g.add(glass); entry.glass = glass;

  entry.normalEdgeMat = edgeMat();
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), entry.normalEdgeMat);
  edges.position.copy(glass.position); g.add(edges); entry.edges = edges;

  addFeatures(g, p, y0);

  if (o.topRail) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(d.wTop + 1, 1.8, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.4, metalness: 0.7 }));
    rail.position.y = y0 + d.hMax + 1; rail.castShadow = true; g.add(rail);
  }

  if (showLabels) {
    const el = document.createElement('div');
    el.className = 'panel-chip';
    el.style.setProperty('--chip', '#' + tint.render.color.toString(16).padStart(6, '0'));
    const fcount = (p.features || []).length;
    const dims = p.customShape ? `${ftIn(d.wBottom)}↔${ftIn(d.wTop)} × ${ftIn(d.hLeft)}↕${ftIn(d.hRight)}` : `${ftIn(d.wBottom)} × ${ftIn(d.hLeft)}`;
    el.innerHTML = `<b>${escapeHTML(panelLabel(p, i))}</b> ${dims}<span>${tint.short}${(p.y > 0) ? ' · ↑' + ftIn(p.y) : ''}${fcount ? ' · ' + fcount + '◳' : ''}${p.locked ? ' · 🔒' : ''}</span>`;
    const chip = new CSS2DObject(el);
    chip.position.set(0, y0 + d.hMax / 2, (p.thickness || 0.5) / 2 + 0.2);
    g.add(chip); entry.chip = chip;
  }
}

const featFill = new THREE.MeshBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
const featInk = new THREE.MeshBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
const featLine = new THREE.LineBasicMaterial({ color: 0x111827 });

function addFeatures(g, p, y0) {
  const halfT = (p.thickness || 0.5) / 2 + 0.06;
  for (const f of (p.features || [])) {
    const t = featureType(f.kind);
    const mark = new THREE.Group();
    mark.position.set(f.x, y0 + f.y, 0); // f.y is height above the panel base
    if (t.shape === 'circle') {
      const r = (f.d || t.d) / 2;
      for (const z of [halfT, -halfT]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.6, r, 24), featInk);
        ring.position.z = z; mark.add(ring);
      }
      const bore = new THREE.Mesh(new THREE.CircleGeometry(r * 0.6, 24), featFill);
      bore.position.z = halfT; mark.add(bore);
    } else {
      const w = f.w || t.w, h = f.h || t.h;
      for (const z of [halfT, -halfT]) {
        const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h), featFill);
        fill.position.z = z; mark.add(fill);
      }
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), featLine);
      outline.position.z = halfT; mark.add(outline);
    }
    g.add(mark);
  }
}

// ---------------------------------------------------------------------------
//  Selection + gizmo
// ---------------------------------------------------------------------------
export function select(id) {
  selectedId = id;
  refreshSelection();
  needsRender = true;
}

function refreshSelection() {
  for (const [pid, e] of entries) {
    if (e.edges) e.edges.material = (pid === selectedId) ? selEdgeMat : e.normalEdgeMat;
  }
  const e = selectedId ? entries.get(selectedId) : null;
  const panel = selectedId && project ? project.panels.find((p) => p.id === selectedId) : null;
  if (interaction === 'select' && e && panel && !panel.locked) { gizmo.attach(e.group); applyMode(); }
  else gizmo.detach();
}

// ---------------------------------------------------------------------------
//  Picking
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster(); const ptr = new THREE.Vector2();
let downXY = null, downOnGizmo = false;

function onDown(e) { downXY = { x: e.clientX, y: e.clientY }; downOnGizmo = !!gizmo.axis; }
function onUp(e) {
  const wasGizmo = downOnGizmo; const d = downXY; downXY = null; downOnGizmo = false;
  if (!d || wasGizmo || gizmo.dragging) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // a drag, not a click
  const rect = renderer.domElement.getBoundingClientRect();
  ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ptr, activeCam);
  const meshes = [...entries.values()].map((en) => en.glass).filter(Boolean);
  const hit = raycaster.intersectObjects(meshes, false)[0];

  if (interaction === 'stamp') {
    if (hit && stampCb) {
      const glass = hit.object;
      const panel = project ? project.panels.find((p) => p.id === glass.userData.panelId) : null;
      const local = glass.worldToLocal(hit.point.clone()); // x from centre, y up from base
      const d = panel ? panelDims(panel) : { wMax: 36, hMax: 42 };
      let x = Math.max(-d.wMax / 2 + 0.5, Math.min(d.wMax / 2 - 0.5, local.x));
      let y = Math.max(0.5, Math.min(d.hMax - 0.5, local.y));
      if (snap) { x = Math.round(x * 4) / 4; y = Math.round(y * 4) / 4; }
      stampCb(glass.userData.panelId, stampKind, round(x), round(y));
    }
    return;
  }
  if (selectCb) selectCb(hit ? hit.object.userData.panelId : null);
}

function commitTransform(id, save) {
  const e = entries.get(id); if (!e) return;
  if (e.group.position.y < 0) e.group.position.y = 0; // keep panels on/above the ground
  const t = {
    x: round(e.group.position.x), y: Math.max(0, round(e.group.position.y)), z: round(e.group.position.z),
    rotationY: round(e.group.rotation.y * R2D),
  };
  if (transformCb) transformCb(id, t, save);
}

export function onSelect(cb) { selectCb = cb; }
export function onTransform(cb) { transformCb = cb; }
export function onStamp(cb) { stampCb = cb; }

/** Switch between selecting/moving panels and stamping holes/cut-outs. */
export function setInteraction(m, kind) {
  interaction = m;
  if (kind) stampKind = kind;
  if (interaction === 'stamp') gizmo.detach(); else refreshSelection();
  if (renderer) renderer.domElement.style.cursor = interaction === 'stamp' ? 'crosshair' : '';
  needsRender = true;
}
export function getInteraction() { return interaction; }

// ---------------------------------------------------------------------------
//  Cameras / modes
// ---------------------------------------------------------------------------
export function setCamera(m) { mode = m; gizmo.camera = (m === 'iso') ? orthoCam : perspCam; applyCamMode(); fit(); }
export function getCamera() { return mode; }

function applyCamMode() {
  activeCam = mode === 'iso' ? orthoCam : perspCam;
  orbit.object = activeCam;
  if (mode === 'iso') { orbit.enableRotate = false; orbit.minPolarAngle = 0; orbit.maxPolarAngle = Math.PI; }
  else { orbit.enableRotate = true; orbit.minPolarAngle = 0.12; orbit.maxPolarAngle = Math.PI / 2 - 0.02; }
  gizmo.camera = activeCam;
  orbit.update(); needsRender = true;
}

export function setGizmoMode(m) { gizmoMode = m; applyMode(); }
function applyMode() {
  if (!gizmo) return;
  gizmo.setMode(gizmoMode);
  // translate: all three axes (Y lets panels step up/down for stairs); rotate: heading only
  if (gizmoMode === 'translate') { gizmo.showX = true; gizmo.showZ = true; gizmo.showY = true; }
  else { gizmo.showX = false; gizmo.showZ = false; gizmo.showY = true; }
  gizmo.setSize(0.9);
  needsRender = true;
}
export function setSnap(on) {
  snap = on;
  if (!gizmo) return;
  gizmo.setTranslationSnap(on ? 1 : null);
  gizmo.setRotationSnap(on ? 15 * D2R : null);
}
export function setLabels(on) { showLabels = on; labelRenderer.domElement.style.display = on ? '' : 'none'; needsRender = true; }
export function setGrid(on) { showGrid = on; if (grid) grid.visible = on; needsRender = true; }

function recomputeContentBox() {
  contentBox.makeEmpty();
  for (const e of entries.values()) if (e.glass) contentBox.expandByObject(e.group);
}

export function fit() {
  if (!container) return;
  let center, size;
  if (entries.size && !contentBox.isEmpty()) {
    center = contentBox.getCenter(new THREE.Vector3());
    size = contentBox.getSize(new THREE.Vector3());
  } else { center = new THREE.Vector3(0, 21, 0); size = new THREE.Vector3(120, 42, 120); }
  const target = new THREE.Vector3(center.x, Math.min(center.y, 30), center.z);
  orbit.target.copy(target);
  const dir = new THREE.Vector3(Math.cos(ISO_EL) * Math.sin(ISO_AZ), Math.sin(ISO_EL), Math.cos(ISO_EL) * Math.cos(ISO_AZ));
  const reach = Math.max(size.x, size.y, size.z, 48);

  if (mode === 'iso') {
    const aspect = container.clientWidth / container.clientHeight;
    const half = Math.max(size.x, size.z) * 0.7 + Math.max(size.y, 36) * 0.5 + 24;
    orthoCam.left = -half * aspect; orthoCam.right = half * aspect; orthoCam.top = half; orthoCam.bottom = -half;
    orthoCam.zoom = 1; orthoCam.updateProjectionMatrix();
    orthoCam.position.copy(target.clone().add(dir.clone().multiplyScalar(900)));
  } else {
    perspCam.position.copy(target.clone().add(dir.clone().multiplyScalar(reach * 2.1 + 60)));
    perspCam.updateProjectionMatrix();
  }
  activeCam.lookAt(target); orbit.update(); needsRender = true;
}

// ---------------------------------------------------------------------------
//  Export
// ---------------------------------------------------------------------------
export function snapshot({ scale = 2.5, clean = true } = {}) {
  const gv = grid.visible, sv = gizmo.visible;
  if (clean) { grid.visible = false; gizmo.visible = false; labelRenderer.domElement.style.display = 'none'; }
  renderer.setPixelRatio(scale);
  renderer.render(scene, activeCam);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  grid.visible = gv; gizmo.visible = sv;
  labelRenderer.domElement.style.display = showLabels ? '' : 'none';
  resize();
  return url;
}

// ---------------------------------------------------------------------------
function resize() {
  if (!container) return;
  const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
  perspCam.aspect = w / h; perspCam.updateProjectionMatrix();
  fit(); needsRender = true;
}

function disposeChildren(g) {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i];
    c.geometry?.dispose?.();
    if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose?.());
    if (c.element && c.element.parentNode) c.element.parentNode.removeChild(c.element);
    g.remove(c);
  }
}
function disposeGroup(g) { disposeChildren(g); }

function loop() {
  raf = requestAnimationFrame(loop);
  const moving = orbit.update();
  if (needsRender || moving) {
    renderer.render(scene, activeCam);
    labelRenderer.render(scene, activeCam);
    needsRender = false;
  }
}

const round = (n) => Math.round((n || 0) * 100) / 100;
const escapeHTML = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
