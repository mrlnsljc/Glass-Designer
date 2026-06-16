/* =============================================================================
   planView.js — top-down SVG schematic of the panel layout. Pure model -> SVG.
   Used as a live thumbnail in the editor and embedded in the printed report.
   Each panel is a coloured segment; tap (in the editor) selects via data-panel.
   ============================================================================= */

import { panelEndpoints, panelBounds } from './geometry.js';
import { panelLabel } from './pricing.js';
import { glassType } from './glassTypes.js';

export function planSVG(project, { selectedId = null, width = 280, interactive = true } = {}) {
  const b = panelBounds(project, 12);
  const pad = 22;
  const scale = Math.min((width - pad * 2) / b.w, (width * 0.9 - pad * 2) / b.d);
  const W = b.w * scale + pad * 2;
  const H = b.d * scale + pad * 2;
  const sx = (x) => pad + (x - b.minX) * scale;
  const sy = (z) => pad + (z - b.minZ) * scale; // +z downward

  const out = [`<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" class="plan-svg" xmlns="http://www.w3.org/2000/svg">`];
  out.push(`<rect x="1" y="1" width="${(W - 2).toFixed(1)}" height="${(H - 2).toFixed(1)}" rx="6" class="plan-bg"/>`);

  if (b.empty) {
    out.push(`<text x="${(W / 2).toFixed(1)}" y="${(H / 2).toFixed(1)}" class="plan-empty" text-anchor="middle">empty — add a panel</text>`);
    out.push('</svg>');
    return out.join('');
  }

  const tap = interactive ? 'plan-tappable' : '';
  project.panels.forEach((p, i) => {
    const e = panelEndpoints(p);
    const x1 = sx(e.ax), y1 = sy(e.az), x2 = sx(e.bx), y2 = sy(e.bz);
    const sel = p.id === selectedId ? 'plan-panel--sel' : '';
    const tint = '#' + glassType(p.glassType).render.color.toString(16).padStart(6, '0');
    out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="plan-panel ${sel} ${tap}" stroke="${tint}" data-panel="${p.id}"/>`);
    const mx = (x1 + x2) / 2 + e.nx * 11, my = (y1 + y2) / 2 + e.nz * 11;
    out.push(`<text x="${mx.toFixed(1)}" y="${(my + 3).toFixed(1)}" class="plan-code" data-panel="${p.id}" text-anchor="middle">${esc(panelLabel(p, i))}</text>`);
  });

  out.push('</svg>');
  return out.join('');
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
