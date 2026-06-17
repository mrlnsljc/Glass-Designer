/* =============================================================================
   geometry.js — placement math shared by the 3D scene and the 2D plan.

   A panel is a vertical sheet standing on the ground. Its footprint is a line
   segment of length = width, centred at (x, z), rotated `rotationY` degrees
   about the vertical axis. rotationY = 0 means the width runs along world X
   (the panel faces -Z). These helpers keep the 3D view and the top-down plan
   in perfect agreement.
   ============================================================================= */

export const PANEL_GAP = 0.5;
export const BASE_H = 4;      // base shoe height (in), when enabled

/* A panel face is a quad in its own local frame: x measured from the horizontal
   centre, y measured UP. Corner heights:
     BL = 0,  BR = baseRise,  TL = hLeft,  TR = baseRise + hRight
   • Rectangle: all defaults equal.
   • Tapered/rake (flat bottom, sloped top): hLeft ≠ hRight, baseRise = 0.
   • Stair parallelogram: baseRise slopes the BOTTOM edge; keep widths + heights
     equal and the top edge stays parallel to the bottom (vertical ends). */
/** True when a panel carries a usable freeform polygon outline. */
export const isPoly = (p) => !!(p.poly && Array.isArray(p.points) && p.points.length >= 3);

export function panelDims(p) {
  if (isPoly(p)) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of p.points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const w = (maxX - minX) || 1;
    return {
      wBottom: w, wTop: w, hLeft: maxY, hRight: maxY, baseRise: 0,
      wMax: w, hMax: maxY, vMin: minY, vMid: (minY + maxY) / 2, vSpan: (maxY - minY) || 1, poly: true,
    };
  }
  const wBottom = p.width;
  const wTop = p.customShape ? (p.widthTop ?? p.width) : p.width;
  const hLeft = p.height;
  const hRight = p.customShape ? (p.heightRight ?? p.height) : p.height;
  const baseRise = p.customShape ? (p.baseRise ?? 0) : 0; // right side of the base lifted (stair slope)
  const topMax = Math.max(hLeft, baseRise + hRight);
  const vMin = Math.min(0, baseRise);
  return {
    wBottom, wTop, hLeft, hRight, baseRise,
    wMax: Math.max(wBottom, wTop),
    hMax: topMax, vMin, vMid: (vMin + topMax) / 2, vSpan: (topMax - vMin) || 1,
  };
}

/** Outline as [x, y] points (x from centre, y up). Quads → [BL, BR, TR, TL];
    freeform polygons → the panel's own point list. */
export function panelCorners(p) {
  if (isPoly(p)) return p.points.map(([x, y]) => [x, y]);
  const d = panelDims(p);
  return [
    [-d.wBottom / 2, 0],                    // bottom-left
    [d.wBottom / 2, d.baseRise],            // bottom-right (lifted for stair slope)
    [d.wTop / 2, d.baseRise + d.hRight],    // top-right
    [-d.wTop / 2, d.hLeft],                 // top-left
  ];
}

/** Glass area of the (possibly tapered) panel, in square inches. */
export function panelArea(p) {
  const c = panelCorners(p);
  let a = 0;
  for (let i = 0; i < c.length; i++) {
    const [x1, y1] = c[i], [x2, y2] = c[(i + 1) % c.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Ground-plane endpoints {ax,az,bx,bz} and outward normal {nx,nz} of a panel. */
export function panelEndpoints(p) {
  const t = (p.rotationY || 0) * Math.PI / 180;
  const halfW = (isPoly(p) ? panelDims(p).wMax : p.width) / 2;
  const dx = Math.cos(t) * halfW;
  const dz = -Math.sin(t) * halfW;
  return {
    ax: p.x - dx, az: p.z - dz,
    bx: p.x + dx, bz: p.z + dz,
    nx: -Math.sin(t), nz: -Math.cos(t), // local -Z (front face) in world
  };
}

/** Total length of a handrail (in), including its stair rise. */
export function railLength(r) {
  return Math.hypot(r.bx - r.ax, r.bz - r.az, r.rise || 0);
}

/** Bounding box of all panel footprints + handrails (with a margin). Empty -> default area. */
export function panelBounds(project, margin = 8) {
  const ps = project.panels, rails = project.rails || [];
  if (!ps.length && !rails.length) return { minX: -60, maxX: 60, minZ: -60, maxZ: 60, empty: true, w: 120, d: 120 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of ps) {
    const e = panelEndpoints(p);
    minX = Math.min(minX, e.ax, e.bx); maxX = Math.max(maxX, e.ax, e.bx);
    minZ = Math.min(minZ, e.az, e.bz); maxZ = Math.max(maxZ, e.az, e.bz);
  }
  for (const r of rails) {
    minX = Math.min(minX, r.ax, r.bx); maxX = Math.max(maxX, r.ax, r.bx);
    minZ = Math.min(minZ, r.az, r.bz); maxZ = Math.max(maxZ, r.az, r.bz);
  }
  // Pad first, then derive w/d from the PADDED extents so the SVG viewBox matches
  // where panels are actually drawn (otherwise lines fall outside the box).
  const x0 = minX - margin, x1 = maxX + margin, z0 = minZ - margin, z1 = maxZ + margin;
  return {
    minX: x0, maxX: x1, minZ: z0, maxZ: z1,
    empty: false, w: (x1 - x0) || 1, d: (z1 - z0) || 1,
  };
}
