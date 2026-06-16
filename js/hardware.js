/* =============================================================================
   hardware.js — glass hardware libraries you add to a job as a bill of materials.

   IMPORTANT: these are EDITABLE STARTER TEMPLATES, not official vendor catalogues.
   I can't ship CRL / FMF part numbers + live pricing from memory, so each library
   lists the common item *types* with placeholder prices for you to correct. Set
   your real part # + price on each line you add (the price is editable per line),
   and use the "My Hardware" library to save your own items — those persist in the
   browser across projects.

   Library item:  { id, cat, name, unit, price }
   Job line (BOM): { id, lib, name, unit, price, qty }  (stored on the project)
   ============================================================================= */

const item = (id, cat, name, unit, price) => ({ id, cat, name, unit, price });

// Common item *types*; prices are placeholders to edit.
const COMMON = [
  item('hinge-wall', 'Hinges', 'Wall-mount hinge', 'ea', 45),
  item('hinge-g2g', 'Hinges', 'Glass-to-glass hinge (180°)', 'ea', 55),
  item('hinge-90', 'Hinges', 'Glass-to-glass hinge (90°)', 'ea', 55),
  item('clamp-sq', 'Clamps', 'Square glass clamp', 'ea', 12),
  item('clamp-rd', 'Clamps', 'Round glass clamp', 'ea', 12),
  item('standoff', 'Standoffs', 'Standoff / spigot', 'ea', 28),
  item('uchannel', 'Channel', 'Base shoe / U-channel', 'ft', 22),
  item('handle-ladder', 'Handles', 'Ladder pull (back-to-back)', 'ea', 95),
  item('handle-towel', 'Handles', 'Towel bar', 'ea', 60),
  item('knob', 'Handles', 'Door knob / pull', 'ea', 28),
  item('header', 'Door', 'Header / sleeve-over', 'ft', 30),
  item('hinge-patch', 'Door', 'Patch fitting', 'ea', 70),
  item('slider-kit', 'Door', 'Sliding door kit', 'set', 240),
  item('seal', 'Seals', 'Wipe / fin seal', 'ft', 4),
  item('clip', 'Clips', 'Glass clip / bracket', 'ea', 9),
];

export const HARDWARE_LIBRARIES = {
  crl: { id: 'crl', name: 'CR Laurence (CRL)', items: COMMON.map((i) => ({ ...i })) },
  fmf: { id: 'fmf', name: 'FMF Hardware', items: COMMON.map((i) => ({ ...i })) },
  standard: { id: 'standard', name: 'Standard / Generic', items: COMMON.map((i) => ({ ...i })) },
};

// ---- persistent user library ("My Hardware") ------------------------------
const LS_CUSTOM = 'grd.hardware.custom.v1';
export function customLibrary() {
  let items = [];
  try { items = JSON.parse(localStorage.getItem(LS_CUSTOM)) || []; } catch { items = []; }
  return { id: 'custom', name: 'My Hardware', items };
}
export function saveCustomItem(it) {
  const lib = customLibrary();
  const idx = lib.items.findIndex((x) => x.id === it.id);
  if (idx >= 0) lib.items[idx] = it; else lib.items.push(it);
  localStorage.setItem(LS_CUSTOM, JSON.stringify(lib.items));
}
export function deleteCustomItem(id) {
  const lib = customLibrary();
  localStorage.setItem(LS_CUSTOM, JSON.stringify(lib.items.filter((x) => x.id !== id)));
}

export function allLibraries() {
  return [HARDWARE_LIBRARIES.crl, HARDWARE_LIBRARIES.fmf, HARDWARE_LIBRARIES.standard, customLibrary()];
}
export function findLibrary(id) { return allLibraries().find((l) => l.id === id); }
export const libraryName = (id) => (findLibrary(id)?.name) || id;
