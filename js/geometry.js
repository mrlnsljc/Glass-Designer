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
   centre, y measured UP from the base (y = 0). A plain rectangle uses width
   (bottom) + height (left). With customShape on, the top width and right height
   can differ, giving trapezoid / rake panels for stairs and odd openings. */
export function panelDims(p) {
  const wBottom = p.width;
  const wTop = p.customShape ? (p.widthTop ?? p.width) : p.width;
  const hLeft = p.height;
  const hRight = p.customShape ? (p.heightRight ?? p.height) : p.height;
  return { wBottom, wTop, hLeft, hRight, hMax: Math.max(hLeft, hRight), wMax: Math.max(wBottom, wTop) };
}

/** Face corners [BL, BR, TR, TL] as [x, y] (x from centre, y from base). */
export function panelCorners(p) {
  const d = panelDims(p);
  return [
    [-d.wBottom / 2, 0],
    [d.wBottom / 2, 0],
    [d.wTop / 2, d.hRight],
    [-d.wTop / 2, d.hLeft],
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
  const dx = Math.cos(t) * (p.width / 2);
  const dz = -Math.sin(t) * (p.width / 2);
  return {
    ax: p.x - dx, az: p.z - dz,
    bx: p.x + dx, bz: p.z + dz,
    nx: -Math.sin(t), nz: -Math.cos(t), // local -Z (front face) in world
  };
}

/** Bounding box of all panel footprints (with a margin). Empty -> default area. */
export function panelBounds(project, margin = 8) {
  const ps = project.panels;
  if (!ps.length) return { minX: -60, maxX: 60, minZ: -60, maxZ: 60, empty: true, w: 120, d: 120 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of ps) {
    const e = panelEndpoints(p);
    minX = Math.min(minX, e.ax, e.bx); maxX = Math.max(maxX, e.ax, e.bx);
    minZ = Math.min(minZ, e.az, e.bz); maxZ = Math.max(maxZ, e.az, e.bz);
  }
  // Pad first, then derive w/d from the PADDED extents so the SVG viewBox matches
  // where panels are actually drawn (otherwise lines fall outside the box).
  const x0 = minX - margin, x1 = maxX + margin, z0 = minZ - margin, z1 = maxZ + margin;
  return {
    minX: x0, maxX: x1, minZ: z0, maxZ: z1,
    empty: false, w: (x1 - x0) || 1, d: (z1 - z0) || 1,
  };
}
