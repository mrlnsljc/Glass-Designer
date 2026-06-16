/* =============================================================================
   pricing.js — turn the panel list into money + a cut list.

   Panel cost = area × $/sq-ft(finish) + tempering($/sq-ft) + holes × $/hole.
   Job total  = Σ panels × (1 + markup%).
   ============================================================================= */

export const sqft = (wIn, hIn) => (wIn * hIn) / 144;

export function panelCost(panel, pricing) {
  const area = sqft(panel.width, panel.height);
  const rate = pricing.rates[panel.glassType] ?? 0;
  const material = area * rate;
  const temper = area * (pricing.temperPerSqFt || 0);
  const holes = (panel.holes || 0) * (pricing.holeCost || 0);
  return { area, material, temper, holes, total: material + temper + holes };
}

export const panelLabel = (panel, i) => panel.name?.trim() || `P${i + 1}`;

/** Per-panel rows + grand totals. */
export function quote(project) {
  const pricing = project.pricing;
  let totalArea = 0, totalHoles = 0, subtotal = 0;
  const rows = project.panels.map((panel, i) => {
    const cost = panelCost(panel, pricing);
    totalArea += cost.area; totalHoles += (panel.holes || 0); subtotal += cost.total;
    return { code: panelLabel(panel, i), panel, cost };
  });
  const markup = subtotal * ((pricing.markupPct || 0) / 100);
  return {
    rows,
    panelCount: project.panels.length,
    totalArea, totalHoles, subtotal, markup, total: subtotal + markup,
  };
}

export const money = (n) =>
  '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
