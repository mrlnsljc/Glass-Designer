/* =============================================================================
   glassTypes.js — catalogue of glass finishes.

   Each finish carries:
     • name        human label shown in the UI / cut list
     • short       short code used on panel chips (e.g. "CL")
     • defaultRate default $ / sq-ft (editable per project under pricing)
     • render      how it looks in the 3D scene:
                     color     base tint (hex)
                     opacity   0 = invisible, 1 = solid
                     roughness 0 = mirror-clear, 1 = fully frosted
     • swatch      CSS colour for the little square in the UI
   Add a finish by adding one entry here — the UI, pricing and 3D all read it.
   ============================================================================= */

export const GLASS_TYPES = {
  clear: {
    id: 'clear', name: 'Standard Clear', short: 'CL', defaultRate: 18,
    render: { color: 0x9ec6d6, opacity: 0.26, roughness: 0.05 },
    swatch: 'rgba(158,198,214,0.55)',
  },
  sapphire: {
    id: 'sapphire', name: 'Sapphire (Low-Iron)', short: 'SAP', defaultRate: 28,
    render: { color: 0xc3e7ea, opacity: 0.18, roughness: 0.03 },
    swatch: 'rgba(195,231,234,0.6)',
  },
  acid: {
    id: 'acid', name: 'Acid Etched', short: 'AE', defaultRate: 32,
    render: { color: 0xe2eaee, opacity: 0.72, roughness: 0.96 },
    swatch: 'rgba(226,234,238,0.85)',
  },
  gray: {
    id: 'gray', name: 'Tinted Gray', short: 'GRY', defaultRate: 24,
    render: { color: 0x4b5563, opacity: 0.5, roughness: 0.12 },
    swatch: 'rgba(75,85,99,0.7)',
  },
  bronze: {
    id: 'bronze', name: 'Tinted Bronze', short: 'BRZ', defaultRate: 24,
    render: { color: 0x7a5a36, opacity: 0.5, roughness: 0.12 },
    swatch: 'rgba(122,90,54,0.75)',
  },
};

export const GLASS_ORDER = ['clear', 'sapphire', 'acid', 'gray', 'bronze'];

export const glassType = (id) => GLASS_TYPES[id] || GLASS_TYPES.clear;
