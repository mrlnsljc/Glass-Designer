/* =============================================================================
   ui.js — pure HTML builders for the controls panel (model -> string).
   app.js does delegated event handling via the data-* attributes.
   ============================================================================= */

import { GLASS_TYPES, GLASS_ORDER } from './glassTypes.js';
import { FEATURE_TYPES, FEATURE_ORDER, featureType } from './features.js';
import { allLibraries, libraryName } from './hardware.js';
import { panelDims } from './geometry.js';
import { quote, money, panelCost, panelLabel, featureFromCorner } from './pricing.js';

export function controlsHTML(project, selectedId) {
  return [
    jobSection(project),
    panelsSection(project, selectedId),
    hardwareSection(project),
    pricingSection(project),
    optionsSection(project),
  ].join('');
}

// ---- job + client ----------------------------------------------------------
function jobSection(p) {
  const c = p.client;
  return section('job', 'Job details', `
    <label class="fld"><span>Project name</span>
      <input data-field="name" value="${attr(p.name)}" placeholder="e.g. Smith — master shower"></label>
    <div class="grid2">
      <label class="fld"><span>Client</span><input data-field="client.name" value="${attr(c.name)}"></label>
      <label class="fld"><span>Phone</span><input data-field="client.phone" value="${attr(c.phone)}"></label>
      <label class="fld"><span>Email</span><input data-field="client.email" value="${attr(c.email)}"></label>
      <label class="fld"><span>Address</span><input data-field="client.address" value="${attr(c.address)}"></label>
    </div>
    <label class="fld"><span>Notes</span><textarea data-field="client.notes" rows="2">${esc(c.notes)}</textarea></label>
  `, false);
}

// ---- panels ----------------------------------------------------------------
function panelsSection(p, selectedId) {
  const add = `
    <div class="add-bar">
      <button class="btn btn--primary btn--sm" data-act="addPanel">＋ Panel</button>
      <button class="btn btn--sm" data-act="addRun" title="Three panels in a straight run">Inline run</button>
      <button class="btn btn--sm" data-act="addCorner" title="Two panels at 90° (shower / deck corner)">90° corner</button>
    </div>`;
  const list = p.panels.length
    ? p.panels.map((pn, i) => panelCard(p, pn, i, selectedId)).join('')
    : `<p class="empty-hint">Blank canvas. Add a panel, then set its size — or drag it in the 3D view to position it.</p>`;
  return section('panels', `Panels${p.panels.length ? ` <span class="count">${p.panels.length}</span>` : ''}`, add + `<div class="panel-list">${list}</div>`, true);
}

function panelCard(p, pn, i, selectedId) {
  const dn = `data-panel="${pn.id}"`;
  const cost = panelCost(pn, p.pricing).total;
  const sel = pn.id === selectedId ? 'panel-card--sel' : '';
  return `<div class="panel-card ${sel}" data-act="selectPanel" ${dn}>
    <div class="pc-head">
      <span class="pcode" style="--c:${GLASS_TYPES[pn.glassType]?.swatch}">${esc(panelLabel(pn, i))}</span>
      <input class="pname" data-field="panel.name" ${dn} value="${attr(pn.name)}" placeholder="Label (optional)">
      <button class="icon-btn ${pn.locked ? 'on' : ''}" tabindex="-1" data-act="toggleLock" ${dn} title="${pn.locked ? 'Unlock' : 'Lock'} position">${pn.locked ? '🔒' : '🔓'}</button>
      <button class="icon-btn" tabindex="-1" data-act="dupPanel" ${dn} title="Duplicate">⧉</button>
      <button class="icon-btn" tabindex="-1" data-act="removePanel" ${dn} title="Delete">✕</button>
    </div>
    <div class="pc-glass">
      <select class="gsel" data-field="panel.glassType" ${dn}>
        ${GLASS_ORDER.map((g) => `<option value="${g}" ${g === pn.glassType ? 'selected' : ''}>${GLASS_TYPES[g].name}</option>`).join('')}
      </select>
      <span class="pcost">${money(cost)}</span>
    </div>
    <div class="pc-dims">
      ${field('panel.width', pn.width, pn.id, pn.customShape ? 'W↓' : 'W', 'in', 1, 0.125)}
      ${field('panel.height', pn.height, pn.id, pn.customShape ? 'H←' : 'H', 'in', 1, 0.125)}
      ${field('panel.thickness', pn.thickness ?? 0.5, pn.id, 'Thk', 'in', 0.0625, 0.0625)}
    </div>
    ${pn.customShape ? `<div class="pc-dims">
      ${field('panel.widthTop', pn.widthTop ?? pn.width, pn.id, 'W↑', 'in', 1, 0.125)}
      ${field('panel.heightRight', pn.heightRight ?? pn.height, pn.id, 'H→', 'in', 1, 0.125)}
      ${field('panel.baseRise', pn.baseRise ?? 0, pn.id, 'Rise', 'in', null, 0.125)}
    </div>
    <p class="feats-hint">Stair panel: keep W↓=W↑ and H←=H→, then set <b>Rise</b> to how much the right side climbs across the panel (negative = down to the right).</p>` : ''}
    <label class="chk chk--sm"><input type="checkbox" data-field="panel.customShape" data-panel="${pn.id}" ${pn.customShape ? 'checked' : ''}> Custom / tapered / stair shape</label>
    <div class="pc-pos">
      ${field('panel.x', round(pn.x), pn.id, 'X', 'in', null, 0.25)}
      ${field('panel.z', round(pn.z), pn.id, 'Z', 'in', null, 0.25)}
      ${field('panel.rotationY', round(pn.rotationY), pn.id, '∠', '°', null, 1)}
      ${field('panel.y', round(pn.y), pn.id, 'Elev', 'in', 0, 0.25)}
    </div>
    <div class="pc-channels">
      <span class="ch-lbl">Channels</span>
      ${chTog(pn, 'top', 'Top')}${chTog(pn, 'bottom', 'Bottom')}${chTog(pn, 'left', 'Left')}${chTog(pn, 'right', 'Right')}
    </div>
    ${featuresBlock(pn)}
  </div>`;
}

function chTog(pn, edge, label) {
  const on = pn.channels && pn.channels[edge];
  return `<label class="ch-tog ${on ? 'on' : ''}"><input type="checkbox" tabindex="-1" data-channel="${edge}" data-panel="${pn.id}" ${on ? 'checked' : ''}>${label}</label>`;
}

function featuresBlock(pn) {
  const list = (pn.features || []).map((f) => featureRow(pn, f)).join('');
  return `<div class="pc-feats">
    <div class="feats-head">
      <span>Holes &amp; cut-outs${pn.features?.length ? ` · ${pn.features.length}` : ''}</span>
      <button class="btn btn--xs" data-act="addFeatureCenter" data-kind="hole" data-panel="${pn.id}" title="Add a hole at center">＋ Hole</button>
    </div>
    ${list || `<p class="feats-hint">Use the <b>Stamp</b> tool above the 3D view to place these on the panel.</p>`}
  </div>`;
}

function featureRow(pn, f) {
  const t = featureType(f.kind);
  const c = featureFromCorner(pn, f);
  const d = panelDims(pn);
  const dn = `data-panel="${pn.id}" data-feat="${f.id}"`;
  // position + size inputs are bounded to THIS panel's own dimensions
  const size = t.shape === 'circle'
    ? `${fnum('feat.d', f.d ?? t.d, dn, '⌀', 0.0625, round(Math.min(d.wBottom, d.hMax)))}`
    : `${fnum('feat.w', f.w ?? t.w, dn, 'w', 0.0625, round(d.wBottom))}${fnum('feat.h', f.h ?? t.h, dn, 'h', 0.0625, round(d.hMax))}`;
  return `<div class="feat-row" ${dn}>
    <span class="feat-tag">${t.short}</span>
    ${fnum('feat.fromLeft', round(c.fromLeft), dn, 'L', 0, round(d.wBottom))}
    ${fnum('feat.fromBottom', round(c.fromBottom), dn, 'B', 0, round(d.hMax))}
    ${size}
    <button class="icon-btn" tabindex="-1" data-act="removeFeature" ${dn} title="Remove">✕</button>
  </div>`;
}

function field(name, value, panelId, label, suffix, min, step) {
  const minAttr = min != null ? `min="${min}"` : '';
  return `<label class="dim"><span>${label}</span>
    <input class="num" type="number" ${minAttr} step="${step}" value="${value}" data-field="${name}" data-panel="${panelId}">${suffix ? `<i>${suffix}</i>` : ''}</label>`;
}
function fnum(name, value, dn, label, min, max) {
  const a = (min != null ? `min="${min}" ` : '') + (max != null ? `max="${max}" ` : '');
  return `<label class="fnum"><span>${label}</span><input class="num" type="number" ${a}step="0.125" value="${value}" data-field="${name}" ${dn}></label>`;
}

// ---- hardware --------------------------------------------------------------
function hardwareSection(p) {
  const libs = allLibraries();
  const options = libs.map((l) => l.items.length
    ? `<optgroup label="${esc(l.name)}">${l.items.map((it) => `<option value="${l.id}|${it.id}">${esc(it.name)}${it.unit ? ` (${esc(it.unit)})` : ''} — ${money(it.price)}</option>`).join('')}</optgroup>`
    : '').join('');
  const lines = (p.hardware || []).map(hwLine).join('') || `<p class="feats-hint">No hardware added yet.</p>`;
  return section('hardware', `Hardware${p.hardware?.length ? ` <span class="count">${p.hardware.length}</span>` : ''}`, `
    <div class="hw-pick">
      <select data-hw="pick">${options}</select>
      <button class="btn btn--sm" data-act="addHardware">＋ Add</button>
    </div>
    <div class="hw-list">${lines}</div>
    <details class="hw-custom"><summary>New item → My Hardware</summary>
      <div class="hw-newitem">
        <input data-hw="custName" placeholder="Item name">
        <span class="suffix">$<input class="num" data-hw="custPrice" type="number" min="0" step="0.5" value="0"></span>
        <button class="btn btn--sm" data-act="saveCustomHw">Save</button>
      </div>
      <p class="feats-hint">Saved items appear under “My Hardware” in the picker and persist across projects. CRL/FMF prices are placeholders — edit each line to your real cost.</p>
    </details>
  `, false);
}

function hwLine(l) {
  const dn = `data-hw-line="${l.id}"`;
  return `<div class="hw-line" ${dn}>
    <input class="hw-name" data-hwfield="name" ${dn} value="${attr(l.name)}">
    <span class="hw-lib">${esc(libraryName(l.lib))}</span>
    <label class="fnum"><span>×</span><input class="num" type="number" min="0" step="1" data-hwfield="qty" ${dn} value="${l.qty ?? 1}"></label>
    <label class="fnum"><span>$</span><input class="num" type="number" min="0" step="0.5" data-hwfield="price" ${dn} value="${l.price ?? 0}"></label>
    <span class="hw-total">${money((l.qty || 0) * (l.price || 0))}</span>
    <button class="icon-btn" tabindex="-1" data-act="removeHardware" ${dn} title="Remove">✕</button>
  </div>`;
}

// ---- pricing ---------------------------------------------------------------
function pricingSection(p) {
  const r = p.pricing, fc = r.featureCosts || {};
  const rateRows = GLASS_ORDER.map((g) => `
    <label class="fld rate">
      <span><i class="sw" style="background:${GLASS_TYPES[g].swatch}"></i>${GLASS_TYPES[g].name}</span>
      <span class="suffix">$<input class="num" type="number" min="0" step="0.5" value="${r.rates[g]}" data-field="rate" data-glass="${g}">/ft²</span>
    </label>`).join('');
  const featRows = FEATURE_ORDER.map((k) => {
    const t = FEATURE_TYPES[k];
    return `<label class="fld rate">
      <span>${t.name}</span>
      <span class="suffix">$<input class="num" type="number" min="0" step="0.5" value="${fc[t.costKey] ?? 0}" data-field="featCost" data-fkey="${t.costKey}">/ea</span>
    </label>`;
  }).join('');
  return section('pricing', 'Glass, cut-outs &amp; pricing', `
    <div class="sub-label">Glass — $/ft²</div>
    ${rateRows}
    <div class="sub-label">Holes &amp; cut-outs — $ each</div>
    ${featRows}
    <div class="grid2">
      <label class="fld"><span>Tempering</span><span class="suffix">$<input class="num" type="number" min="0" step="0.5" value="${r.temperPerSqFt}" data-field="temperPerSqFt">/ft²</span></label>
      <label class="fld"><span>Markup</span><span class="suffix"><input class="num" type="number" min="0" step="1" value="${r.markupPct}" data-field="markupPct">%</span></label>
    </div>`, false);
}

// ---- options ---------------------------------------------------------------
function optionsSection(p) {
  const o = p.options;
  const opt = (key, label) => `<label class="chk"><input type="checkbox" data-opt="${key}" ${o[key] ? 'checked' : ''}> ${label}</label>`;
  return section('options', 'View &amp; hardware mounts', `
    <label class="fld"><span>Dimension units</span>
      <select data-opt-units>
        <option value="ftin" ${o.units !== 'inch' ? 'selected' : ''}>Feet + inches (3' 6")</option>
        <option value="inch" ${o.units === 'inch' ? 'selected' : ''}>Inches, 3 decimals (42.000")</option>
      </select></label>
    <div class="opts">
      ${opt('showGrid', 'Reference grid')}
      ${opt('showLabels', 'Panel labels')}
      ${opt('snap', 'Snap when dragging / stamping (1″ / 15°)')}
      ${opt('baseShoe', 'Base shoe (channel mount)')}
      ${opt('topRail', 'Top rail / header')}
    </div>`, false);
}

// ---- totals (live) ---------------------------------------------------------
export function totalsHTML(project) {
  const q = quote(project);
  return `
    <div class="tot-row"><span>${q.panelCount} panel${q.panelCount !== 1 ? 's' : ''} · ${q.totalArea.toFixed(1)} ft²${q.totalFeatures ? ' · ' + q.totalFeatures + ' cut-outs' : ''}</span></div>
    <div class="tot-row"><span>Glass &amp; fab</span><b>${money(q.glassSubtotal)}</b></div>
    ${q.hardwareSubtotal ? `<div class="tot-row"><span>Hardware</span><b>${money(q.hardwareSubtotal)}</b></div>` : ''}
    ${q.markup ? `<div class="tot-row"><span>Markup</span><b>${money(q.markup)}</b></div>` : ''}
    <div class="tot-row tot-grand"><span>Total</span><b>${money(q.total)}</b></div>`;
}

// ---- helpers ---------------------------------------------------------------
function section(id, title, body, open) {
  return `<details class="sec" data-sec="${id}" ${open ? 'open' : ''}>
    <summary>${title}</summary>
    <div class="sec-body">${body}</div>
  </details>`;
}
const round = (n) => Math.round((n || 0) * 100) / 100;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
const attr = (s) => esc(s).replace(/"/g, '&quot;');
