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
  return {
    minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin,
    empty: false, w: (maxX - minX) || 1, d: (maxZ - minZ) || 1,
  };
}
