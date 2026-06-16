/* =============================================================================
   pricing.js — turn the panel list + hardware BOM into money.

   Panel cost = area × $/ft²(finish) + tempering($/ft²) + Σ features(by type cost).
   Hardware   = Σ line qty × price.
   Job total  = (glass + hardware) × (1 + markup%).
   ============================================================================= */

import { featureType } from './features.js';
import { panelArea } from './geometry.js';

export const sqft = (wIn, hIn) => (wIn * hIn) / 144;
export const areaSqft = (panel) => panelArea(panel) / 144; // real (possibly tapered) area

export function panelCost(panel, pricing) {
  const area = areaSqft(panel);
  const rate = pricing.rates[panel.glassType] ?? 0;
  const material = area * rate;
  const temper = area * (pricing.temperPerSqFt || 0);
  const fc = pricing.featureCosts || {};
  const features = (panel.features || []).reduce((sum, f) => sum + (fc[featureType(f.kind).costKey] || 0), 0);
  return { area, material, temper, features, total: material + temper + features };
}

export const panelLabel = (panel, i) => panel.name?.trim() || `P${i + 1}`;

export function quote(project) {
  const pricing = project.pricing;
  let totalArea = 0, totalFeatures = 0, glassSubtotal = 0;
  const rows = (project.panels || []).map((panel, i) => {
    const cost = panelCost(panel, pricing);
    totalArea += cost.area; totalFeatures += (panel.features || []).length; glassSubtotal += cost.total;
    return { code: panelLabel(panel, i), panel, cost };
  });

  const hardwareRows = (project.hardware || []).map((l) => ({ line: l, total: (l.qty || 0) * (l.price || 0) }));
  const hardwareSubtotal = hardwareRows.reduce((s, r) => s + r.total, 0);

  const subtotal = glassSubtotal + hardwareSubtotal;
  const markup = subtotal * ((pricing.markupPct || 0) / 100);
  return {
    rows, hardwareRows,
    panelCount: (project.panels || []).length,
    totalArea, totalFeatures,
    glassSubtotal, hardwareSubtotal, subtotal, markup, total: subtotal + markup,
  };
}

export const money = (n) =>
  '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- display units ---------------------------------------------------------
// 'ftin' -> 3' 6" ;  'inch' -> 42.000"  (set from project.options.units)
let unitMode = 'ftin';
export function setUnitMode(m) { unitMode = (m === 'inch') ? 'inch' : 'ftin'; }
export function getUnitMode() { return unitMode; }
/** Format a length for display, honouring the current unit mode. */
export function len(inches) {
  return unitMode === 'inch' ? `${(inches || 0).toFixed(3)}"` : ftIn(inches);
}

/** inches -> feet'inches" display, e.g. 42 -> 3' 6" */
export function ftIn(inches) {
  const sign = inches < 0 ? '-' : '';
  inches = Math.abs(inches);
  const ft = Math.floor(inches / 12);
  const inch = Math.round((inches - ft * 12) * 16) / 16;
  const whole = Math.floor(inch);
  const sixteenths = Math.round((inch - whole) * 16);
  let fracStr = '';
  if (sixteenths) { const g = gcd(sixteenths, 16); fracStr = ` ${sixteenths / g}/${16 / g}`; }
  const parts = [];
  if (ft) parts.push(`${ft}'`);
  parts.push(`${whole}${fracStr}"`);
  return sign + parts.join(' ');
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Feature position from the panel's bottom-left corner (fabrication): x from
    centre + half the bottom width; y is already measured up from the base. */
export function featureFromCorner(panel, feat) {
  return { fromLeft: panel.width / 2 + feat.x, fromBottom: feat.y };
}
