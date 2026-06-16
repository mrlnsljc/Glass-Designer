/* =============================================================================
   ui.js — pure HTML builders for the controls panel (model -> string).
   app.js does delegated event handling via the data-* attributes.
   ============================================================================= */

import { GLASS_TYPES, GLASS_ORDER } from './glassTypes.js';
import { quote, money, panelCost, panelLabel } from './pricing.js';

export function controlsHTML(project, selectedId) {
  return [
    jobSection(project),
    panelsSection(project, selectedId),
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
  const lock = pn.locked ? 'on' : '';
  return `<div class="panel-card ${sel}" data-act="selectPanel" ${dn}>
    <div class="pc-head">
      <span class="pcode" style="--c:${GLASS_TYPES[pn.glassType]?.swatch}">${esc(panelLabel(pn, i))}</span>
      <input class="pname" data-field="panel.name" ${dn} value="${attr(pn.name)}" placeholder="Label (optional)">
      <button class="icon-btn ${lock}" data-act="toggleLock" ${dn} title="${pn.locked ? 'Unlock' : 'Lock'} position">${pn.locked ? '🔒' : '🔓'}</button>
      <button class="icon-btn" data-act="dupPanel" ${dn} title="Duplicate">⧉</button>
      <button class="icon-btn" data-act="removePanel" ${dn} title="Delete">✕</button>
    </div>
    <div class="pc-glass">
      <select class="gsel" data-field="panel.glassType" ${dn}>
        ${GLASS_ORDER.map((g) => `<option value="${g}" ${g === pn.glassType ? 'selected' : ''}>${GLASS_TYPES[g].name}</option>`).join('')}
      </select>
      <span class="pcost">${money(cost)}</span>
    </div>
    <div class="pc-dims">
      ${field('panel.width', pn.width, pn.id, 'W', 'in', 1, 0.125)}
      ${field('panel.height', pn.height, pn.id, 'H', 'in', 1, 0.125)}
      ${field('panel.holes', pn.holes || 0, pn.id, 'Holes', '', 0, 1)}
    </div>
    <div class="pc-pos">
      ${field('panel.x', round(pn.x), pn.id, 'X', 'in', null, 0.25)}
      ${field('panel.z', round(pn.z), pn.id, 'Z', 'in', null, 0.25)}
      ${field('panel.rotationY', round(pn.rotationY), pn.id, '∠', '°', null, 1)}
    </div>
  </div>`;
}

function field(name, value, panelId, label, suffix, min, step) {
  const minAttr = min != null ? `min="${min}"` : '';
  return `<label class="dim"><span>${label}</span>
    <input class="num" type="number" ${minAttr} step="${step}" value="${value}" data-field="${name}" data-panel="${panelId}">${suffix ? `<i>${suffix}</i>` : ''}</label>`;
}

// ---- pricing ---------------------------------------------------------------
function pricingSection(p) {
  const r = p.pricing;
  const rateRows = GLASS_ORDER.map((g) => `
    <label class="fld rate">
      <span><i class="sw" style="background:${GLASS_TYPES[g].swatch}"></i>${GLASS_TYPES[g].name}</span>
      <span class="suffix">$<input class="num" type="number" min="0" step="0.5" value="${r.rates[g]}" data-field="rate" data-glass="${g}">/ft²</span>
    </label>`).join('');
  return section('pricing', 'Glass &amp; pricing', `
    ${rateRows}
    <div class="grid2">
      <label class="fld"><span>Hole drilling</span><span class="suffix">$<input class="num" type="number" min="0" step="0.5" value="${r.holeCost}" data-field="holeCost">/hole</span></label>
      <label class="fld"><span>Tempering</span><span class="suffix">$<input class="num" type="number" min="0" step="0.5" value="${r.temperPerSqFt}" data-field="temperPerSqFt">/ft²</span></label>
      <label class="fld"><span>Markup</span><span class="suffix"><input class="num" type="number" min="0" step="1" value="${r.markupPct}" data-field="markupPct">%</span></label>
    </div>`, false);
}

// ---- options ---------------------------------------------------------------
function optionsSection(p) {
  const o = p.options;
  const opt = (key, label) => `<label class="chk"><input type="checkbox" data-opt="${key}" ${o[key] ? 'checked' : ''}> ${label}</label>`;
  return section('options', 'View &amp; hardware', `
    <div class="opts">
      ${opt('showGrid', 'Reference grid')}
      ${opt('showLabels', 'Panel labels')}
      ${opt('snap', 'Snap when dragging (1″ / 15°)')}
      ${opt('baseShoe', 'Base shoe (channel mount)')}
      ${opt('topRail', 'Top rail / header')}
    </div>`, false);
}

// ---- totals (live) ---------------------------------------------------------
export function totalsHTML(project) {
  const q = quote(project);
  return `
    <div class="tot-row"><span>${q.panelCount} panel${q.panelCount !== 1 ? 's' : ''} · ${q.totalArea.toFixed(1)} ft²${q.totalHoles ? ' · ' + q.totalHoles + ' holes' : ''}</span></div>
    <div class="tot-row"><span>Subtotal</span><b>${money(q.subtotal)}</b></div>
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
