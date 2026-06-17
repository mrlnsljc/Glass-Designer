/* =============================================================================
   features.js — catalogue of holes & cut-outs you can "stamp" onto a panel.

   A feature instance stored on a panel looks like:
     { id, kind, x, y, d? , w?, h? }
   where (x, y) is the offset IN INCHES from the panel-face centre
   (x → right, y → up), and the size comes from d (circle) or w×h (rect).

   Each type here gives the default size, the render shape, a short chip code,
   and which pricing bucket it falls in (costKey -> pricing.featureCosts).
   ============================================================================= */

export const FEATURE_TYPES = {
  hole:    { id: 'hole',   name: 'Hole / Standoff', short: '⌀',  shape: 'circle', d: 0.5,        costKey: 'hole' },
  spigot:  { id: 'spigot', name: 'Spigot (base)',   short: 'SPG', shape: 'spigot', w: 2, h: 6,   costKey: 'spigot', snapBottom: true },
  hinge:   { id: 'hinge',  name: 'Hinge cut-out',   short: 'HNG', shape: 'rect',   w: 4,  h: 5,   costKey: 'hinge' },
  handle:  { id: 'handle', name: 'Handle / Pull',   short: 'HDL', shape: 'circle', d: 0.75,       costKey: 'handle' },
  lock:    { id: 'lock',   name: 'Lock / Latch',    short: 'LCK', shape: 'rect',   w: 0.9, h: 2.4, costKey: 'lock' },
  notch:   { id: 'notch',  name: 'Corner notch',    short: 'NTC', shape: 'rect',   w: 3,  h: 3,   costKey: 'notch' },
};

export const FEATURE_ORDER = ['hole', 'spigot', 'hinge', 'handle', 'lock', 'notch'];

export const featureType = (kind) => FEATURE_TYPES[kind] || FEATURE_TYPES.hole;

/** Default cost per feature bucket ($ each). Editable per project under pricing. */
export const defaultFeatureCosts = () => ({ hole: 6, spigot: 28, hinge: 18, handle: 10, lock: 14, notch: 12 });

/** Build a fully-formed feature instance for a kind at (x,y). */
export function makeFeature(kind, x = 0, y = 0) {
  const t = featureType(kind);
  const f = { id: 'ft_' + Math.random().toString(36).slice(2, 8), kind, x, y };
  if (t.shape === 'circle') f.d = t.d; else { f.w = t.w; f.h = t.h; }
  return f;
}
