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
     init(el); render(project); setCamera('iso'|'3d'); setTool('select'|'move'
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
import { panelLabel, len, getUnitMode } from './pricing.js';
import { BASE_H, panelCorners, panelDims, panelEndpoints } from './geometry.js';

let renderer, labelRenderer, scene, world, container;
let orbit, gizmo, perspCam, orthoCam, activeCam;
let grid, areaGroup, railGroup;
let mode = 'iso', tool = 'move', stampKind = 'hole', snap = true, showLabels = true, showGrid = true;
let needsRender = true, raf = 0;
let project = null;
let selectCb = null, transformCb = null, stampCb = null, featureMoveCb = null, featureSelectCb = null;
let railSelectCb = null, railCreateCb = null, railEndpointCb = null, railMoveCb = null;
let draggingId = null, selectedId = null, selectedFeatureId = null;
let selectedIds = [], multiIds = [], pivot;
const pivotLast = new THREE.Vector3();
let featurePickMeshes = [];
let railPickMeshes = [], railHandleMeshes = [], selectedRailId = null;
let railPending = null, railPreview = null; // two-click handrail drawing
let drag = null; // active direct-manipulation drag (select tool)
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

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
  renderer.shadowMap.enabled = false; // shadows off — they only confuse the glass reads
  el.appendChild(renderer.domElement);

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
  el.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.background = makeBackdrop();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.05));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(180, 320, 160);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-160, 120, -120);
  scene.add(fill);

  grid = new THREE.GridHelper(480, 40, 0x9aa7b6, 0xc2cdd8);
  grid.material.transparent = true; grid.material.opacity = 0.5; grid.position.y = 0.02;
  scene.add(grid);
  areaGroup = new THREE.Group();
  scene.add(areaGroup);
  railGroup = new THREE.Group();
  scene.add(railGroup);

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
    if (!e.value) {
      if (gizmo.object === pivot) groupMove(true);
      else if (draggingId) { commitTransform(draggingId, true); draggingId = null; }
    }
  });
  gizmo.addEventListener('objectChange', () => {
    if (gizmo.object === pivot) { groupMove(false); return; }
    if (gizmo.object && gizmo.object.userData.panelId) {
      draggingId = gizmo.object.userData.panelId;
      commitTransform(draggingId, false);
    }
  });
  scene.add(gizmo);
  pivot = new THREE.Object3D(); scene.add(pivot); // anchor for multi-panel group moves
  applyMode();

  world = new THREE.Group();
  scene.add(world);

  renderer.domElement.addEventListener('pointerdown', onDown, true); // capture: decide before OrbitControls
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
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
  // rebuild the feature pick-list (transparent hit targets) for click/drag
  featurePickMeshes = [];
  for (const e of entries.values()) {
    for (const m of (e.featureMarks || [])) {
      for (const ch of m.children) if (ch.userData && ch.userData.featureHit) featurePickMeshes.push(ch);
    }
  }
  buildWorkArea();
  buildRails();
  refreshSelection();
  recomputeContentBox();
  setSnap(snap);
  needsRender = true;
}

// Optional work-area footprint drawn on the floor (a labelled rectangle) for scale.
function buildWorkArea() {
  if (!areaGroup) return;
  while (areaGroup.children.length) {
    const c = areaGroup.children.pop();
    c.geometry?.dispose?.();
    if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose?.());
    if (c.element && c.element.parentNode) c.element.parentNode.removeChild(c.element);
  }
  const a = project && project.area;
  if (!a || !(a.width > 0) || !(a.depth > 0)) return;
  const hx = a.width / 2, hz = a.depth / 2, y = 0.06;
  const pts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [-hx, -hz]].map(([x, z]) => new THREE.Vector3(x, y, z));
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.65 }));
  areaGroup.add(line);
  const th = Math.min(12, Math.max(4, Math.min(a.width, a.depth) * 0.05));
  const wl = makeDimText(len(a.width), th); wl.rotation.x = -Math.PI / 2; wl.position.set(0, y + 0.1, hz + th); areaGroup.add(wl);
  const dl = makeDimText(len(a.depth), th); dl.rotation.x = -Math.PI / 2; dl.rotation.z = Math.PI / 2; dl.position.set(hx + th, y + 0.1, 0); areaGroup.add(dl);
}

// ---------------------------------------------------------------------------
//  Handrails (two-point tubes) — rebuilt wholesale each render (few of them).
// ---------------------------------------------------------------------------
const railSelMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3, metalness: 0.6 });
const _up = new THREE.Vector3(0, 1, 0);

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.geometry?.dispose?.();
    if (c.material && c.material !== railSelMat) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose?.());
    if (c.element && c.element.parentNode) c.element.parentNode.removeChild(c.element);
  }
}

function buildRails() {
  if (!railGroup) return;
  clearGroup(railGroup);
  railPickMeshes = []; railHandleMeshes = [];
  const rails = (project && project.rails) || [];
  for (const r of rails) {
    const sel = r.id === selectedRailId;
    const hA = r.height, hB = r.height + (r.rise || 0);
    const A = new THREE.Vector3(r.ax, hA, r.az), B = new THREE.Vector3(r.bx, hB, r.bz);
    const dir = B.clone().sub(A); const L = dir.length() || 1;
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(_up, dir.clone().normalize());
    const s = Math.max(0.25, r.size || 1.5);
    const mat = sel ? railSelMat : metalMat();

    const barGeo = r.profile === 'square'
      ? new THREE.BoxGeometry(s, L, s)
      : new THREE.CylinderGeometry(s / 2, s / 2, L, 18);
    const bar = new THREE.Mesh(barGeo, mat);
    bar.position.copy(mid); bar.quaternion.copy(quat); railGroup.add(bar);

    if (r.posts) {
      for (const [px, pz, ph] of [[r.ax, r.az, hA], [r.bx, r.bz, hB]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.45, s * 0.45, ph, 12), mat);
        post.position.set(px, ph / 2, pz); railGroup.add(post);
      }
    }

    // fat transparent hit cylinder for easy clicking
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(s, 3), Math.max(s, 3), L, 8), hitMat);
    hit.position.copy(mid); hit.quaternion.copy(quat);
    hit.userData = { railId: r.id, railHit: true };
    railGroup.add(hit); railPickMeshes.push(hit);

    // endpoint drag handles — shown while the Rail tool is active or this rail is selected
    if (tool === 'rail' || sel) {
      for (const [end, p] of [['a', A], ['b', B]]) {
        const handle = new THREE.Mesh(new THREE.SphereGeometry(Math.max(s, 2.4), 12, 12),
          new THREE.MeshBasicMaterial({ color: sel ? 0x1d4ed8 : 0x2563eb }));
        handle.position.copy(p);
        handle.userData = { railId: r.id, end, railHandle: true };
        railGroup.add(handle); railHandleMeshes.push(handle);
      }
    }
  }
}

// Raw ground point under the cursor (no snapping).
function rawGround() {
  if (!raycaster.ray.intersectPlane(groundPlane, _hitPt)) return null;
  return { x: _hitPt.x, z: _hitPt.z };
}

const SNAP_R = 12; // handrails "prefer" panels within this radius (in), but aren't confined
function closestOnSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * dx, z: az + t * dz };
}

// Snap a ground point to nearby glass (preferred) then the grid. A handrail
// endpoint snaps to a panel's ends OR anywhere along its run, and reports that
// panel's top height so the rail can sit on the glass. `top` is null when the
// point didn't land near any panel (free placement).
function snapEndpoint(x, z) {
  let best = SNAP_R, bx = null, bz = null, top = null;
  for (const p of (project?.panels || [])) {
    const e = panelEndpoints(p);
    const pTop = (p.y || 0) + panelDims(p).hMax;
    const proj = closestOnSeg(x, z, e.ax, e.az, e.bx, e.bz);
    for (const [cx, cz] of [[e.ax, e.az], [e.bx, e.bz], [proj.x, proj.z]]) {
      const dd = Math.hypot(x - cx, z - cz);
      if (dd < best) { best = dd; bx = cx; bz = cz; top = pTop; }
    }
  }
  if (bx != null) return { x: round(bx), z: round(bz), top };
  if (snap) { x = Math.round(x); z = Math.round(z); }
  return { x: round(x), z: round(z), top: null };
}

// Convenience: raycast the ground and snap. Returns { x, z, top } or null.
function groundSnap() {
  const g = rawGround(); if (!g) return null;
  return snapEndpoint(g.x, g.z);
}

function updateRailPreview() {
  if (!railPending) { if (railPreview) { railPreview.visible = false; } return; }
  const g = groundSnap(); if (!g) return;
  if (!railPreview) {
    railPreview = new THREE.Line(new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x2563eb, dashSize: 4, gapSize: 3 }));
    scene.add(railPreview);
  }
  const h = 42;
  railPreview.visible = true;
  railPreview.geometry.setFromPoints([new THREE.Vector3(railPending.x, h, railPending.z), new THREE.Vector3(g.x, h, g.z)]);
  railPreview.computeLineDistances();
  needsRender = true;
}

function clearRailPending() {
  railPending = null;
  if (railPreview) { railPreview.visible = false; needsRender = true; }
}

const signature = (p, o, i) =>
  [p.width, p.height, p.thickness, p.widthTop, p.heightRight, p.baseRise, p.customShape, p.glassType,
    p.poly, JSON.stringify(p.points), p.baseShoe, o.topRail, showLabels, getUnitMode(), panelLabel(p, i), channelSig(p),
    (p.features || []).map((f) => `${f.kind}:${f.x}:${f.y}:${f.d || ''}:${f.w || ''}:${f.h || ''}:${f.len || ''}`).join(',')].join('|');

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
  const y0 = p.baseShoe ? BASE_H : 0; // glass sits on top of the shoe when enabled

  if (p.baseShoe) {
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

  entry.featureMarks = addFeatures(g, p, y0);
  addChannels(g, p, y0);

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
    const dims = p.customShape ? `${len(d.wBottom)}↔${len(d.wTop)} × ${len(d.hLeft)}↕${len(d.hRight)}` : `${len(d.wBottom)} × ${len(d.hLeft)}`;
    el.innerHTML = `<b>${escapeHTML(panelLabel(p, i))}</b> ${dims}<span>${tint.short}${(p.y > 0) ? ' · ↑' + len(p.y) : ''}${fcount ? ' · ' + fcount + '◳' : ''}${p.locked ? ' · 🔒' : ''}</span>`;
    const chip = new CSS2DObject(el);
    chip.position.set(0, y0 + d.vMid, (p.thickness || 0.5) / 2 + 0.2);
    g.add(chip); entry.chip = chip;
  }
}

const featFill = new THREE.MeshBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
const featInk = new THREE.MeshBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
const featLine = new THREE.LineBasicMaterial({ color: 0x111827 });
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });

// Returns the array of feature "mark" groups (each tagged for picking/dragging).
function addFeatures(g, p, y0) {
  const marks = [];
  const halfT = (p.thickness || 0.5) / 2 + 0.06;
  for (const f of (p.features || [])) {
    const t = featureType(f.kind);
    const ink = featInk;
    const mark = new THREE.Group();
    mark.position.set(f.x, y0 + f.y, 0); // f.y is height above the panel base
    mark.userData = { featureId: f.id, panelId: p.id, y0 };
    let hitGeo;
    if (t.shape === 'spigot') {
      const w = f.w || t.w, h = f.h || t.h, dz = (p.thickness || 0.5) + 2.6;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, dz), metalMat());
      mark.add(body);
      const base = new THREE.Mesh(new THREE.BoxGeometry(w * 1.5, w * 0.7, dz * 1.2),
        new THREE.MeshStandardMaterial({ color: 0xb6bcc2, roughness: 0.4, metalness: 0.85 }));
      base.position.y = -h / 2 + w * 0.35; mark.add(base); // base plate near the bottom
      hitGeo = new THREE.PlaneGeometry(Math.max(w, 3), Math.max(h, 3));
    } else if (t.shape === 'handle') {
      // Vertical ladder pull: a round bar of length f.len standing off the glass on two posts.
      const L = Math.max(1, f.len || t.len), r = (t.dia || 0.75) / 2;
      const standoff = halfT + 1.8;             // bar sits ~1.8" proud of the glass face
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 16), metalMat());
      bar.position.z = standoff; mark.add(bar);  // CylinderGeometry is vertical (along Y) by default
      for (const sy of [L / 2 - r, -(L / 2 - r)]) { // two posts back to the glass
        const post = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, standoff, 12), metalMat());
        post.rotation.x = Math.PI / 2; post.position.set(0, sy, standoff / 2); mark.add(post);
      }
      hitGeo = new THREE.PlaneGeometry(Math.max(r * 2, 2.4), Math.max(L, 3));
    } else if (t.shape === 'circle') {
      const r = (f.d || t.d) / 2;
      for (const z of [halfT, -halfT]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.6, r, 24), ink);
        ring.position.z = z; mark.add(ring);
      }
      const bore = new THREE.Mesh(new THREE.CircleGeometry(r * 0.6, 24), featFill);
      bore.position.z = halfT; mark.add(bore);
      hitGeo = new THREE.CircleGeometry(Math.max(r, 2.4), 16);
    } else {
      const w = f.w || t.w, h = f.h || t.h;
      for (const z of [halfT, -halfT]) {
        const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h), featFill);
        fill.position.z = z; mark.add(fill);
      }
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), featLine);
      outline.position.z = halfT; mark.add(outline);
      hitGeo = new THREE.PlaneGeometry(Math.max(w, 3), Math.max(h, 3));
    }
    const hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.z = halfT + 0.05;
    hit.userData = { featureId: f.id, panelId: p.id, featureHit: true };
    mark.add(hit);
    g.add(mark);
    marks.push(mark);
  }
  return marks;
}

const CHANNEL_W = 1.5; // default visible width of an edge channel (in)
const channelSig = (p) => {
  const ch = p.channels;
  const tag = ch ? `${ch.top ? 1 : 0}${ch.bottom ? 1 : 0}${ch.left ? 1 : 0}${ch.right ? 1 : 0}` : '0000';
  return `${tag}@${p.channelThickness ?? CHANNEL_W}`;
};

// U-channel along the chosen edges (shower / enclosure glass). Each enabled edge
// gets an aluminium box running corner-to-corner (works on sloped edges too).
// Edge channels only apply to rectangle/quad panels (not freeform polygons).
function addChannels(g, p, y0) {
  const ch = p.channels;
  if (p.poly || !ch || !(ch.top || ch.bottom || ch.left || ch.right)) return;
  const c = panelCorners(p); // [BL, BR, TR, TL] as [x, y]
  const w = p.channelThickness ?? CHANNEL_W;
  const depth = (p.thickness || 0.5) + Math.max(1, w) * 1.2;
  const edges = [['bottom', c[0], c[1]], ['right', c[1], c[2]], ['top', c[2], c[3]], ['left', c[3], c[0]]];
  for (const [name, A, B] of edges) {
    if (!ch[name]) continue;
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const box = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dy), w, depth), metalMat());
    box.position.set((A[0] + B[0]) / 2, y0 + (A[1] + B[1]) / 2, 0);
    box.rotation.z = Math.atan2(dy, dx);
    g.add(box);
  }
}

// ---------------------------------------------------------------------------
//  Selection + gizmo
// ---------------------------------------------------------------------------
export function select(ids) {
  selectedIds = Array.isArray(ids) ? ids.filter(Boolean) : (ids ? [ids] : []);
  selectedId = selectedIds[selectedIds.length - 1] || null;
  refreshSelection();
  needsRender = true;
}

function refreshSelection() {
  for (const [pid, e] of entries) {
    if (e.edges) e.edges.material = selectedIds.includes(pid) ? selEdgeMat : e.normalEdgeMat;
  }
  multiIds = [];
  if (tool !== 'move' && tool !== 'rotate') { gizmo.detach(); return; }
  const movable = selectedIds.filter((id) => {
    const p = project && project.panels.find((x) => x.id === id);
    return p && !p.locked && entries.get(id);
  });
  if (movable.length === 0) { gizmo.detach(); return; }
  if (movable.length === 1 || tool === 'rotate') {
    // single target (Rotate always acts on the primary panel only)
    const id = (tool === 'rotate' && movable.includes(selectedId)) ? selectedId : movable[0];
    gizmo.attach(entries.get(id).group); applyMode();
  } else {
    // 2+ panels + Move tool → group move via a pivot at the centroid
    multiIds = movable;
    const c = new THREE.Vector3();
    for (const id of movable) c.add(entries.get(id).group.position);
    c.multiplyScalar(1 / movable.length);
    pivot.position.copy(c); pivotLast.copy(c);
    gizmo.attach(pivot); applyMode();
  }
}

// Apply the pivot's movement delta to every panel in the multi-selection.
function groupMove(save) {
  const dx = pivot.position.x - pivotLast.x, dy = pivot.position.y - pivotLast.y, dz = pivot.position.z - pivotLast.z;
  pivotLast.copy(pivot.position);
  for (const id of multiIds) {
    const e = entries.get(id); if (!e) continue;
    e.group.position.x += dx;
    e.group.position.y = Math.max(0, e.group.position.y + dy);
    e.group.position.z += dz;
    if (transformCb) transformCb(id, { x: round(e.group.position.x), y: Math.max(0, round(e.group.position.y)), z: round(e.group.position.z) }, save);
  }
}

// ---------------------------------------------------------------------------
//  Picking + direct manipulation (Select tool = click/drag panels & features)
// ---------------------------------------------------------------------------
const raycaster = new THREE.Raycaster(); const ptr = new THREE.Vector2();
const _hitPt = new THREE.Vector3();
let downXY = null, downOnGizmo = false, downOnCanvas = false;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function setNDC(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}
function raycastGlass() {
  return raycaster.intersectObjects([...entries.values()].map((en) => en.glass).filter(Boolean), false)[0] || null;
}

function onDown(e) {
  downOnCanvas = true; // this pointer sequence started on the canvas
  downXY = { x: e.clientX, y: e.clientY };
  downOnGizmo = !!gizmo.axis;
  drag = null;
  if (downOnGizmo) return; // the panel gizmo handles its own drag

  // Handrails are grabbable in both the Move and Rail tools: an endpoint handle
  // drags one end; the body drags the whole rail (like a hole/spigot). A plain
  // click (no drag) selects the rail. Empty rail-tool clicks draw points (onUp).
  if (tool === 'rail' || tool === 'move') {
    setNDC(e); raycaster.setFromCamera(ptr, activeCam);
    const hh = railHandleMeshes.length ? raycaster.intersectObjects(railHandleMeshes, false)[0] : null;
    if (hh) {
      drag = { type: 'rail-end', railId: hh.object.userData.railId, end: hh.object.userData.end, moved: false };
      orbit.enabled = false; return;
    }
    const rb = railPickMeshes.length ? raycaster.intersectObjects(railPickMeshes, false)[0] : null;
    if (rb) {
      const r = project.rails.find((x) => x.id === rb.object.userData.railId);
      const g0 = rawGround();
      if (r && g0) {
        drag = { type: 'rail-body', railId: r.id, start: g0, orig: { ax: r.ax, az: r.az, bx: r.bx, bz: r.bz }, moved: false };
        orbit.enabled = false; return;
      }
    }
    if (tool === 'rail') return; // empty rail-tool click → drawn in onUp
    // move tool with no rail hit → fall through to the panel gizmo/selection behaviour
  }

  if (tool !== 'select') return; // only the Holes tool drags features
  setNDC(e); raycaster.setFromCamera(ptr, activeCam);

  // The Select tool grabs ONLY placed holes / cut-outs. Panels are moved with the
  // Move/Rotate gizmo, so dragging a panel body (or empty space) just orbits.
  const fhit = featurePickMeshes.length ? raycaster.intersectObjects(featurePickMeshes, false)[0] : null;
  if (!fhit) return;
  const { featureId, panelId } = fhit.object.userData;
  const panel = project.panels.find((p) => p.id === panelId);
  if (!panel || panel.locked) return; // locked panel: its features are frozen too (a click still selects)
  const en = entries.get(panelId); if (!en) return;
  const mark = (en.featureMarks || []).find((m) => m.userData.featureId === featureId);
  const feat = (panel.features || []).find((f) => f.id === featureId);
  const q = en.group.getWorldQuaternion(new THREE.Quaternion());
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, fhit.point);
  const local0 = en.glass.worldToLocal(fhit.point.clone());
  drag = {
    type: 'feature', panelId, featureId, glass: en.glass, mark, y0: mark.userData.y0, plane,
    offX: (feat ? feat.x : local0.x) - local0.x, offY: (feat ? feat.y : local0.y) - local0.y, moved: false,
  };
  orbit.enabled = false;
}

function onMove(e) {
  // Dragging a handrail (endpoint or whole body) — works in Move and Rail tools.
  if (drag && (drag.type === 'rail-end' || drag.type === 'rail-body')) {
    setNDC(e); raycaster.setFromCamera(ptr, activeCam);
    const g = rawGround(); if (!g) return;
    if (downXY && Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > 3) drag.moved = true;
    const r = project.rails.find((x) => x.id === drag.railId); if (!r) return;
    if (drag.type === 'rail-end') {
      const s = snapEndpoint(g.x, g.z);
      if (drag.end === 'a') { r.ax = s.x; r.az = s.z; } else { r.bx = s.x; r.bz = s.z; }
      railEndpointCb?.(drag.railId, drag.end, s.x, s.z, false);
    } else {
      // rigid translate: move both ends by the cursor delta, then snap the rail to
      // the nearest panel (whichever end snaps more strongly) so it stays straight.
      const dx = g.x - drag.start.x, dz = g.z - drag.start.z;
      const ta = { x: drag.orig.ax + dx, z: drag.orig.az + dz };
      const tb = { x: drag.orig.bx + dx, z: drag.orig.bz + dz };
      const sa = snapEndpoint(ta.x, ta.z), sb = snapEndpoint(tb.x, tb.z);
      const da = Math.hypot(sa.x - ta.x, sa.z - ta.z), db = Math.hypot(sb.x - tb.x, sb.z - tb.z);
      const use = (sb.top != null && (sa.top == null || db < da)) ? [sb, tb] : [sa, ta];
      const cx = use[0].x - use[1].x, cz = use[0].z - use[1].z; // common correction
      r.ax = round(ta.x + cx); r.az = round(ta.z + cz);
      r.bx = round(tb.x + cx); r.bz = round(tb.z + cz);
      railMoveCb?.(drag.railId, { ax: r.ax, az: r.az, bx: r.bx, bz: r.bz }, false);
    }
    buildRails(); needsRender = true;
    return;
  }
  // Rail tool: between clicks, stretch the dashed preview to the cursor.
  if (tool === 'rail') {
    setNDC(e); raycaster.setFromCamera(ptr, activeCam);
    if (railPending) updateRailPreview();
    return;
  }
  if (!drag) return;
  setNDC(e); raycaster.setFromCamera(ptr, activeCam);
  if (!raycaster.ray.intersectPlane(drag.plane, _hitPt)) return;
  if (downXY && Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > 3) drag.moved = true;
  // Select tool only drags features, confined to the panel face (local X/Y).
  const local = drag.glass.worldToLocal(_hitPt.clone());
  const panel = project.panels.find((p) => p.id === drag.panelId);
  const d = panel ? panelDims(panel) : { wMax: 36, hMax: 42 };
  let x = clamp(local.x + drag.offX, -d.wMax / 2 + 0.5, d.wMax / 2 - 0.5);
  let y = clamp(local.y + drag.offY, 0.5, d.hMax - 0.5);
  if (snap) { x = Math.round(x * 4) / 4; y = Math.round(y * 4) / 4; }
  drag.mark.position.set(x, drag.y0 + y, drag.mark.position.z);
  if (featureMoveCb) featureMoveCb(drag.panelId, drag.featureId, { x: round(x), y: round(y) }, false);
  needsRender = true;
}

function onUp(e) {
  const wasCanvas = downOnCanvas; downOnCanvas = false;
  if (!wasCanvas) return; // pointer-up from a press that didn't start on the canvas (e.g. a side-panel button) — ignore

  // Commit a handrail drag (endpoint or whole body); a no-move drag = a select.
  if (drag && (drag.type === 'rail-end' || drag.type === 'rail-body')) {
    const dr = drag; drag = null; orbit.enabled = true; downXY = null;
    const r = project.rails.find((x) => x.id === dr.railId);
    if (dr.moved && r) {
      if (dr.type === 'rail-end') railEndpointCb?.(dr.railId, dr.end, dr.end === 'a' ? r.ax : r.bx, dr.end === 'a' ? r.az : r.bz, true);
      else railMoveCb?.(dr.railId, { ax: r.ax, az: r.az, bx: r.bx, bz: r.bz }, true);
    } else { railSelectCb?.(dr.railId); }
    needsRender = true; return;
  }

  // Rail tool — empty click: select a rail under the cursor, else drop a point.
  if (tool === 'rail') {
    const d0 = downXY; downXY = null; orbit.enabled = true; drag = null;
    if (d0 && Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 6) return; // an orbit drag, not a click
    setNDC(e); raycaster.setFromCamera(ptr, activeCam);
    const rhit = railPickMeshes.length ? raycaster.intersectObjects(railPickMeshes, false)[0] : null;
    if (rhit) { railSelectCb?.(rhit.object.userData.railId); return; }
    const g = groundSnap(); if (!g) return;
    if (!railPending) { railPending = { x: g.x, z: g.z, top: g.top }; updateRailPreview(); }
    else { const a = railPending; clearRailPending(); railCreateCb?.(a.x, a.z, g.x, g.z, a.top, g.top); }
    return;
  }

  if (drag) {
    const dr = drag; drag = null; downXY = null; orbit.enabled = true;
    if (dr.moved) {
      const panel = project.panels.find((p) => p.id === dr.panelId);
      const f = panel && (panel.features || []).find((x) => x.id === dr.featureId);
      if (f && featureMoveCb) featureMoveCb(dr.panelId, dr.featureId, { x: round(f.x), y: round(f.y) }, true);
    } else if (featureSelectCb) featureSelectCb(dr.panelId, dr.featureId);
    needsRender = true; return;
  }

  const wasGizmo = downOnGizmo; const d = downXY; downXY = null; downOnGizmo = false;
  if (!d || wasGizmo || gizmo.dragging) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // a drag (orbit), not a click
  setNDC(e); raycaster.setFromCamera(ptr, activeCam);
  const ghit = raycastGlass();
  if (tool === 'stamp') {
    if (ghit && stampCb) {
      const glass = ghit.object;
      const panel = project ? project.panels.find((p) => p.id === glass.userData.panelId) : null;
      const local = glass.worldToLocal(ghit.point.clone());
      const dd = panel ? panelDims(panel) : { wMax: 36, hMax: 42 };
      let x = clamp(local.x, -dd.wMax / 2 + 0.5, dd.wMax / 2 - 0.5);
      let y = clamp(local.y, 0.5, dd.hMax - 0.5);
      const st = featureType(stampKind);
      if (st.snapBottom) y = (st.h || 6) / 2; // spigots line up along the bottom edge
      if (snap) { x = Math.round(x * 4) / 4; y = Math.round(y * 4) / 4; }
      stampCb(glass.userData.panelId, stampKind, round(x), round(y));
    }
    return;
  }
  if (selectCb) selectCb(ghit ? ghit.object.userData.panelId : null, e.shiftKey);
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
export function onFeatureMove(cb) { featureMoveCb = cb; }
export function onFeatureSelect(cb) { featureSelectCb = cb; }
export function onRailSelect(cb) { railSelectCb = cb; }
export function onRailCreate(cb) { railCreateCb = cb; }
export function onRailEndpoint(cb) { railEndpointCb = cb; }
export function onRailMove(cb) { railMoveCb = cb; }

/** Highlight a handrail (or null). Rebuilds the rail group so the colour swaps. */
export function selectRail(id) { selectedRailId = id || null; buildRails(); needsRender = true; }

/** Active tool: 'select' | 'move' | 'rotate' | 'stamp' | 'rail'. */
export function setTool(t, kind) {
  const prev = tool;
  tool = t;
  if (kind) stampKind = kind;
  if (t !== 'rail') clearRailPending();           // leaving the rail tool drops a half-drawn line
  if (t === 'stamp' || t === 'rail') gizmo.detach(); else refreshSelection();
  if (prev === 'rail' || t === 'rail') buildRails(); // show/hide endpoint handles
  if (renderer) renderer.domElement.style.cursor = (t === 'stamp' || t === 'rail') ? 'crosshair' : 'default';
  needsRender = true;
}
export function getTool() { return tool; }

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

function applyMode() {
  if (!gizmo) return;
  const rotate = tool === 'rotate';
  gizmo.setMode(rotate ? 'rotate' : 'translate');
  // translate: all three axes (Y lets panels step up/down for stairs); rotate: heading only
  if (rotate) { gizmo.showX = false; gizmo.showZ = false; gizmo.showY = true; }
  else { gizmo.showX = true; gizmo.showZ = true; gizmo.showY = true; }
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
  if (railGroup && railGroup.children.length) contentBox.expandByObject(railGroup);
  const a = project && project.area;
  if (a && a.width > 0 && a.depth > 0) {
    contentBox.expandByPoint(new THREE.Vector3(-a.width / 2, 0, -a.depth / 2));
    contentBox.expandByPoint(new THREE.Vector3(a.width / 2, 42, a.depth / 2));
  }
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
export function snapshot({ scale = 2.5, clean = true, dims = true } = {}) {
  const gv = grid.visible, sv = gizmo.visible;
  if (clean) { grid.visible = false; gizmo.visible = false; labelRenderer.domElement.style.display = 'none'; }
  const tempDims = dims ? addDimLabels() : [];
  renderer.setPixelRatio(scale);
  renderer.render(scene, activeCam);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  tempDims.forEach((m) => { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); m.parent?.remove(m); });
  grid.visible = gv; gizmo.visible = sv;
  labelRenderer.domElement.style.display = showLabels ? '' : 'none';
  resize();
  return url;
}

// Bake raw dimension numbers onto one panel's glass; returns the temp meshes.
function addPanelDims(group, p) {
  const out = [];
  const d = panelDims(p);
  const y0 = project.options.baseShoe ? BASE_H : 0;
  const halfT = (p.thickness || 0.5) / 2 + 0.2;
  const th = Math.max(2.2, Math.min(7, Math.min(d.wBottom, d.hMax) * 0.16));
  const add = (text, x, y, vert) => {
    const m = makeDimText(text, th);
    if (vert) m.rotation.z = Math.PI / 2;
    m.position.set(x, y, halfT);
    group.add(m); out.push(m);
  };
  // Bottom width + left height always. Tapered panels also label top width + right height.
  add(len(d.wBottom), 0, y0 + th * 1.1, false);
  add(len(d.hLeft), -d.wBottom / 2 + th * 1.1, y0 + d.hLeft / 2, true);
  if (p.customShape) {
    const topMidY = y0 + (d.hLeft + d.baseRise + d.hRight) / 2;
    add(len(d.wTop), 0, topMidY - th * 1.1, false);
    add(len(d.hRight), d.wBottom / 2 - th * 1.1, y0 + d.baseRise + d.hRight / 2, true);
  }
  return out;
}
function addDimLabels() {
  const out = [];
  if (!project) return out;
  for (const [id, e] of entries) {
    const p = project.panels.find((x) => x.id === id); if (!p) continue;
    out.push(...addPanelDims(e.group, p));
  }
  return out;
}
const disposeDims = (arr) => arr.forEach((m) => { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); m.parent?.remove(m); });

// One face-on PNG per panel (the PDF booklet): each panel alone, framed full-size.
export function snapshotPanels({ scale = 2 } = {}) {
  if (!project || !project.panels.length) return [];
  const out = [];
  const gv = grid.visible, sv = gizmo.visible, ld = labelRenderer.domElement.style.display, rv = railGroup.visible;
  grid.visible = false; gizmo.visible = false; railGroup.visible = false; labelRenderer.domElement.style.display = 'none';
  for (const e of entries.values()) e.group.visible = false;

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
  const aspect = (container.clientWidth || 800) / (container.clientHeight || 600);

  project.panels.forEach((p, i) => {
    const e = entries.get(p.id); if (!e) return;
    e.group.visible = true;
    const dims = addPanelDims(e.group, p);
    const d = panelDims(p);
    const y0 = p.baseShoe ? BASE_H : 0;
    const center = e.group.localToWorld(new THREE.Vector3(0, y0 + d.vMid, 0));
    const q = e.group.getWorldQuaternion(new THREE.Quaternion());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
    cam.position.copy(center).addScaledVector(normal, 1000);
    cam.up.set(0, 1, 0); cam.lookAt(center);
    let halfW = (d.wMax / 2) * 1.16, halfH = (d.vSpan / 2) * 1.2;
    if (halfW / halfH < aspect) halfW = halfH * aspect; else halfH = halfW / aspect;
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
    cam.updateProjectionMatrix();

    renderer.setPixelRatio(scale);
    renderer.render(scene, cam);
    out.push({ id: p.id, label: panelLabel(p, i), url: renderer.domElement.toDataURL('image/png') });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    disposeDims(dims);
    e.group.visible = false;
  });

  for (const e of entries.values()) e.group.visible = true;
  grid.visible = gv; gizmo.visible = sv; railGroup.visible = rv; labelRenderer.domElement.style.display = ld;
  resize();
  return out;
}

function makeDimText(text, heightIn) {
  const fontPx = 80, pad = 16;
  const c = document.createElement('canvas');
  let ctx = c.getContext('2d');
  ctx.font = `700 ${fontPx}px Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  c.width = Math.ceil(tw + pad * 2); c.height = Math.ceil(fontPx + pad * 2);
  ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const r = 18, w = c.width, h = c.height;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r); ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.closePath(); ctx.fill();
  ctx.font = `700 ${fontPx}px Arial, sans-serif`;
  ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const aspect = w / h;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(heightIn * aspect, heightIn),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  mesh.renderOrder = 999;
  return mesh;
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
