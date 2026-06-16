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

export function printReport(project, renderDataURL, { pricing = true } = {}) {
  const q = quote(project);
  const c = project.client || {};
  const dimOf = (p) => p.customShape ? `${len(p.width)}↔${len(p.widthTop ?? p.width)}` : len(p.width);
  const htOf = (p) => p.customShape ? `${len(p.height)}↕${len(p.heightRight ?? p.height)}` : len(p.height);
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

  const html = `<!doctype html><html><head><meta charset="utf-8">
  <title>${esc(project.name)} — ${pricing ? 'Quote' : 'Design'}</title>
  <style>
    *{box-sizing:border-box}
    body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111827;margin:28px}
    h1{font-size:20px;margin:0 0 2px}.muted{color:#6b7280}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:10px;margin-bottom:14px}
    .client td{padding:1px 8px 1px 0}
    .vis{display:flex;gap:14px;margin:14px 0;align-items:stretch;flex-wrap:wrap}
    .vis img{max-width:360px;max-height:260px;border:1px solid #e5e7eb;border-radius:6px;background:#eef3f8}
    .vis .plan{flex:1;min-width:220px;border:1px solid #e5e7eb;border-radius:6px;padding:8px}
    table.cut{width:100%;border-collapse:collapse;margin-top:6px}
    table.cut th,table.cut td{border:1px solid #d1d5db;padding:5px 7px;font-size:12px}
    table.cut th{background:#f3f4f6;text-align:left}
    td.c,th.c{text-align:center}td.r,th.r{text-align:right}
    .totals{margin-top:12px;margin-left:auto;width:280px}
    .totals td{padding:3px 6px}.totals .grand td{font-weight:700;font-size:15px;border-top:2px solid #111827}
    .plan-svg{width:100%;height:auto}
    .plan-bg{fill:#f8fafc;stroke:#e2e8f0;stroke-width:1}
    .plan-panel{stroke-width:5;stroke-linecap:round}.plan-code{fill:#374151;font-size:10px;font-weight:600}
    .plan-empty{fill:#94a3b8;font-size:11px}
    @media print{body{margin:12mm}}
  </style></head><body>
    <div class="head">
      <div><h1>${esc(project.name)}</h1><div class="muted">Glass ${pricing ? 'Quote' : 'Design'} · ${stamp()}</div></div>
      <table class="client muted">
        ${c.name ? `<tr><td><b>Client</b></td><td>${esc(c.name)}</td></tr>` : ''}
        ${c.phone ? `<tr><td>Phone</td><td>${esc(c.phone)}</td></tr>` : ''}
        ${c.email ? `<tr><td>Email</td><td>${esc(c.email)}</td></tr>` : ''}
        ${c.address ? `<tr><td>Address</td><td>${esc(c.address)}</td></tr>` : ''}
      </table>
    </div>
    <div class="vis">
      ${renderDataURL ? `<img src="${renderDataURL}" alt="render">` : ''}
      <div class="plan">${planSVG(project, { interactive: false, width: 440 })}</div>
    </div>
    <table class="cut">
      <thead><tr>
        <th class="c">#</th><th class="c">Width</th><th class="c">Height</th><th class="c">Thk</th>
        <th class="c">Sq Ft</th><th>Glass</th><th class="c">Elev</th><th class="c">Cut-outs</th>${pricing ? '<th class="r">Cost</th>' : ''}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${hwRows ? `<h3 style="margin:18px 0 4px;font-size:14px">Hardware</h3>
    <table class="cut">
      <thead><tr><th>Item</th><th>Library</th><th class="c">Qty</th>${pricing ? '<th class="r">Unit</th><th class="r">Total</th>' : ''}</tr></thead>
      <tbody>${hwRows}</tbody>
    </table>` : ''}
    <table class="totals">
      <tr><td>Panels</td><td class="r">${q.panelCount}</td></tr>
      <tr><td>Total glass area</td><td class="r">${q.totalArea.toFixed(2)} sq ft</td></tr>
      <tr><td>Holes / cut-outs</td><td class="r">${q.totalFeatures}</td></tr>
      ${pricing ? `<tr><td>Glass &amp; fabrication</td><td class="r">${money(q.glassSubtotal)}</td></tr>
      ${q.hardwareSubtotal ? `<tr><td>Hardware</td><td class="r">${money(q.hardwareSubtotal)}</td></tr>` : ''}
      ${q.markup ? `<tr><td>Markup (${project.pricing.markupPct}%)</td><td class="r">${money(q.markup)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="r">${money(q.total)}</td></tr>` : ''}
    </table>
    ${c.notes ? `<p class="muted"><b>Notes:</b> ${esc(c.notes)}</p>` : ''}
    ${pricing ? '<p class="muted" style="margin-top:24px;font-size:11px">Estimate only. Final pricing subject to site measure and supplier confirmation.</p>' : ''}
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to print/export the quote.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
