/* Org chart: top-down cards joined by lines, like an HR org chart.
   orgChart(el, roots, opts)
   node: { id, title, sub, face, fallback, badge, tone, kids: [node] | () => [node], onTap }
   Leaf groups of more than 4 stack in a column so 100 police stations don't make a 20-screen-wide row. */
const OC = { open: new Map(), zoom: new Map() };
function orgChart(el, roots, opts = {}) {
  const id = opts.id || 'oc', open = OC.open.get(id) || new Set(opts.startOpen || []);
  OC.open.set(id, open);
  const kidsOf = n => typeof n.kids === 'function' ? n.kids() : (n.kids || []);
  const all = new Map();
  const card = (n, k) => `<div class="oc-card ${n.tone || ''}" data-ocn="${esc(n.id)}">
      ${n.face !== false ? avatar(n.face || '', n.title, n.fallback ?? (n.title || '?')[0]) : ''}
      <div class="oc-x"><div class="oc-t">${esc(n.title || '')}</div>${n.sub ? `<div class="oc-s">${esc(n.sub)}</div>` : ''}
      ${n.badge ? `<div class="oc-b">${n.badge}</div>` : ''}</div>
      ${k.length ? `<button class="oc-tg${open.has(n.id) ? ' on' : ''}" data-oct="${esc(n.id)}" aria-label="${open.has(n.id) ? 'Collapse' : 'Expand'}">${open.has(n.id) ? '&#9652;' : '&#9662;'} ${k.length}</button>` : ''}
    </div>`;
  const li = n => { all.set(String(n.id), n); const k = kidsOf(n);
    let sub = '';
    if (k.length && open.has(n.id)) {
      const stack = k.length > 4 && k.every(c => !kidsOf(c).length);
      sub = `<ul class="${stack ? 'stack' : ''}">${k.map(li).join('')}</ul>`;
    }
    return `<li>${card(n, k)}${sub}</li>`; };
  const z = OC.zoom.get(id) || 1;
  el.innerHTML = `<div class="oc-wrap"><div class="oc-tools"><button data-z="-1" aria-label="Zoom out">&minus;</button><button data-z="0">${Math.round(z * 100)}%</button><button data-z="1" aria-label="Zoom in">+</button><button data-z="all">${open.size ? 'Collapse all' : 'Expand'}</button></div>
    <div class="oc-scroll"><div class="oc-canvas" style="zoom:${z}"><ul class="oc">${roots.map(li).join('')}</ul></div></div></div>`;
  const scroller = el.querySelector('.oc-scroll'), prevX = OC['x' + id];
  // keep the tapped card in view after a redraw, else centre the top of the chart
  requestAnimationFrame(() => { const t = opts._focus && el.querySelector(`[data-ocn="${CSS.escape(opts._focus)}"]`);
    if (t) t.scrollIntoView({ block: 'nearest', inline: 'center' });
    else if (prevX == null) scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2; else scroller.scrollLeft = prevX; });
  scroller.addEventListener('scroll', () => { OC['x' + id] = scroller.scrollLeft; }, { passive: true });
  const redraw = focus => orgChart(el, roots, { ...opts, _focus: focus });
  el.querySelectorAll('[data-oct]').forEach(b => b.onclick = e => { e.stopPropagation(); const k = b.dataset.oct;
    const n = all.get(k); const key = n ? n.id : k; open.has(key) ? open.delete(key) : open.add(key); redraw(k); });
  el.querySelectorAll('[data-ocn]').forEach(c => c.onclick = () => { const n = all.get(c.dataset.ocn); if (!n) return;
    if (n.onTap) n.onTap(n); else if (kidsOf(n).length) { open.has(n.id) ? open.delete(n.id) : open.add(n.id); redraw(c.dataset.ocn); } });
  el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { const v = b.dataset.z;
    if (v === 'all') { if (open.size) open.clear(); else (opts.startOpen || []).forEach(x => open.add(x)); OC['x' + id] = null; return redraw(); }
    OC.zoom.set(id, v === '0' ? 1 : Math.min(1.4, Math.max(0.4, +(z + (+v) * 0.15).toFixed(2)))); redraw(); });
  // pinch to zoom
  let d0 = 0, z0 = z;
  scroller.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); z0 = OC.zoom.get(id) || 1; } }, { passive: true });
  scroller.addEventListener('touchmove', e => { if (e.touches.length === 2 && d0) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const nz = Math.min(1.4, Math.max(0.4, z0 * d / d0)); el.querySelector('.oc-canvas').style.zoom = nz; OC.zoom.set(id, nz); } }, { passive: true });
  scroller.addEventListener('touchend', () => { if (d0) { d0 = 0; redraw(); } });
  if (window.fillFaces) fillFaces(el);
}
