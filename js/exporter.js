/* =============================================================================
   exporter.js — client deliverables.

     • downloadImage()  save the 3D render as PNG/JPEG to send a client.
     • printReport()    open a clean, print-ready quote + cut list in a new
                        window (the browser's "Save as PDF" makes the PDF on
                        desktop and iOS — no extra library needed).
   ============================================================================= */

import { quote, money, len, areaSqft } from './pricing.js';
import { glassType } from './glassTypes.js';
import { libraryName } from './hardware.js';
import { planSVG } from './planView.js';
import { panelDims } from './geometry.js';

const stamp = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const safe = (s) => (s || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'design';

export function downloadImage(dataURL, project, fmt = 'png') {
  if (fmt === 'jpeg') {
    const img = new Image(); img.src = dataURL;
    return img.decode().then(() => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      triggerDownload(c.toDataURL('image/jpeg', 0.92), `${safe(project.name)}_render.jpg`);
    });
  }
  triggerDownload(dataURL, `${safe(project.name)}_render.png`);
  return Promise.resolve();
}

function triggerDownload(url, filename) {
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

export function printReport(project, renderDataURL, { pricing = true, panelImages = [] } = {}) {
  const q = quote(project);
  const c = project.client || {};
  const dimOf = (p) => p.poly ? `${len(panelDims(p).wMax)} ⬡` : p.customShape ? `${len(p.width)}↔${len(p.widthTop ?? p.width)}` : len(p.width);
  const htOf = (p) => p.poly ? len(panelDims(p).hMax) : p.customShape ? `${len(p.height)}↕${len(p.heightRight ?? p.height)}` : len(p.height);
  const rows = q.rows.map((r) => {
    const gt = glassType(r.panel.glassType);
    return `<tr>
      <td class="c">${esc(r.code)}</td>
      <td class="c">${dimOf(r.panel)}</td>
      <td class="c">${htOf(r.panel)}</td>
      <td class="c">${(r.panel.thickness || 0.5)}"</td>
      <td class="c">${areaSqft(r.panel).toFixed(2)}</td>
      <td>${gt.name}</td>
      <td class="c">${r.panel.y > 0 ? len(r.panel.y) : '—'}</td>
      <td class="c">${(r.panel.features || []).length}</td>
      ${pricing ? `<td class="r">${money(r.cost.total)}</td>` : ''}
    </tr>`;
  }).join('');

  const hwRows = q.hardwareRows.map((r) => `<tr>
      <td>${esc(r.line.name)}</td><td>${esc(libraryName(r.line.lib))}</td>
      <td class="c">${r.line.qty}</td>${pricing ? `<td class="r">${money(r.line.price)}</td><td class="r">${money(r.total)}</td>` : ''}
    </tr>`).join('');

  const railRows = q.railRows.map((r, i) => `<tr>
      <td class="c">R${i + 1}</td>
      <td class="c">${len(Math.hypot(r.rail.bx - r.rail.ax, r.rail.bz - r.rail.az))}</td>
      <td class="c">${r.ft.toFixed(2)} ft</td>
      <td class="c">${len(r.rail.height)}${r.rail.rise ? ` (+${len(r.rail.rise)})` : ''}</td>
      <td class="c">${r.rail.profile === 'square' ? 'Square' : 'Round'} ${len(r.rail.size)}${r.rail.posts ? ' · posts' : ''}</td>
      ${pricing ? `<td class="r">${money(r.total)}</td>` : ''}
    </tr>`).join('');

  const clientTable = `<table class="client muted">
        ${c.name ? `<tr><td><b>Client</b></td><td>${esc(c.name)}</td></tr>` : ''}
        ${c.phone ? `<tr><td>Phone</td><td>${esc(c.phone)}</td></tr>` : ''}
        ${c.email ? `<tr><td>Email</td><td>${esc(c.email)}</td></tr>` : ''}
        ${c.address ? `<tr><td>Address</td><td>${esc(c.address)}</td></tr>` : ''}
      </table>`;
  const head = (subtitle, withClient) => `<div class="head">
      <div><h1>${esc(project.name)}</h1><div class="muted">Glass ${pricing ? 'Quote' : 'Design'} · ${stamp()} · ${subtitle}</div></div>
      ${withClient ? clientTable : ''}
    </div>`;

  // Each view gets its own page, sized to fit (never cut off).
  const renderSheet = renderDataURL
    ? `<section class="sheet">${head('3D view', true)}<div class="frame"><img src="${renderDataURL}" alt="3D render"></div></section>`
    : '';
  const planSheet = `<section class="sheet">${head('Top-down plan', !renderDataURL)}<div class="frame">${planSVG(project, { interactive: false, width: 760 })}</div></section>`;

  // One full page per panel — a "booklet" you can flip through on the job.
  const panelSheets = (panelImages || []).map((pi) =>
    `<section class="sheet">${head('Panel ' + esc(pi.label), false)}<div class="frame frame--panel"><img src="${pi.url}" alt="${esc(pi.label)}"></div></section>`
  ).join('');
  const scheduleSheet = `<section class="sheet">
      ${head('Panel schedule', false)}
      <table class="cut">
        <thead><tr>
          <th class="c">#</th><th class="c">Width</th><th class="c">Height</th><th class="c">Thk</th>
          <th class="c">Sq Ft</th><th>Glass</th><th class="c">Elev</th><th class="c">Cut-outs</th>${pricing ? '<th class="r">Cost</th>' : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${railRows ? `<h2>Handrails</h2>
      <table class="cut">
        <thead><tr><th class="c">#</th><th class="c">Run</th><th class="c">Length</th><th class="c">Top height</th><th>Profile</th>${pricing ? '<th class="r">Total</th>' : ''}</tr></thead>
        <tbody>${railRows}</tbody>
      </table>` : ''}
      ${hwRows ? `<h2>Hardware</h2>
      <table class="cut">
        <thead><tr><th>Item</th><th>Library</th><th class="c">Qty</th>${pricing ? '<th class="r">Unit</th><th class="r">Total</th>' : ''}</tr></thead>
        <tbody>${hwRows}</tbody>
      </table>` : ''}
      <table class="totals">
        <tr><td>Panels</td><td class="r">${q.panelCount}</td></tr>
        <tr><td>Total glass area</td><td class="r">${q.totalArea.toFixed(2)} sq ft</td></tr>
        <tr><td>Holes / cut-outs</td><td class="r">${q.totalFeatures}</td></tr>
        ${q.railCount ? `<tr><td>Handrail</td><td class="r">${q.railFt.toFixed(2)} ft</td></tr>` : ''}
        ${pricing ? `<tr><td>Glass &amp; fabrication</td><td class="r">${money(q.glassSubtotal)}</td></tr>
        ${q.railSubtotal ? `<tr><td>Handrail</td><td class="r">${money(q.railSubtotal)}</td></tr>` : ''}
        ${q.hardwareSubtotal ? `<tr><td>Hardware</td><td class="r">${money(q.hardwareSubtotal)}</td></tr>` : ''}
        ${q.markup ? `<tr><td>Markup (${project.pricing.markupPct}%)</td><td class="r">${money(q.markup)}</td></tr>` : ''}
        <tr class="grand"><td>Total</td><td class="r">${money(q.total)}</td></tr>` : ''}
      </table>
      ${c.notes ? `<p class="muted"><b>Notes:</b> ${esc(c.notes)}</p>` : ''}
      ${pricing ? '<p class="muted" style="margin-top:18px;font-size:11px">Estimate only. Final pricing subject to site measure and supplier confirmation.</p>' : ''}
    </section>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <title>${esc(project.name)} — ${pricing ? 'Quote' : 'Design'}</title>
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;background:#fff}
    body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111827}
    .sheet{padding:14mm;page-break-after:always}
    .sheet:last-child{page-break-after:auto}
    h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:16px 0 6px;color:#374151}.muted{color:#6b7280}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:10px;margin-bottom:12px}
    .client td{padding:1px 8px 1px 0;font-size:12px}
    .frame{text-align:center;border:1px solid #e5e7eb;border-radius:8px;background:#f8fafc;padding:12px}
    .frame img,.frame svg{display:block;margin:0 auto;max-width:100%;max-height:7in;width:auto;height:auto}
    .frame img{background:#eef3f8;border-radius:6px}
    .frame--panel img{max-height:8.6in}
    table.cut{width:100%;border-collapse:collapse;margin-top:6px}
    table.cut th,table.cut td{border:1px solid #d1d5db;padding:6px 8px;font-size:12px}
    table.cut th{background:#f3f4f6;text-align:left}
    td.c,th.c{text-align:center}td.r,th.r{text-align:right}
    .totals{margin-top:14px;margin-left:auto;width:300px}
    .totals td{padding:3px 6px}.totals .grand td{font-weight:700;font-size:15px;border-top:2px solid #111827}
    .plan-bg{fill:#f8fafc;stroke:#e2e8f0;stroke-width:1}
    .plan-panel{stroke-width:5;stroke-linecap:round}.plan-code{fill:#374151;font-size:11px;font-weight:600}
    .plan-rail{stroke:#d97706;stroke-width:2.5;stroke-dasharray:5 4;stroke-linecap:round}
    .plan-empty{fill:#94a3b8;font-size:12px}
    @media print{.sheet{padding:12mm}}
  </style></head><body>
    ${renderSheet}
    ${planSheet}
    ${scheduleSheet}
    ${panelSheets}
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to print/export the quote.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
