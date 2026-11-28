/* Atlas: state -> district -> constituency, drawn from bundled SVG paths.
   Calmer than the prototype: no glow, no grid, no pulsing, short glides, real bugs, follows the app theme. */
const AT = { data: null, level: 'state', d: null, a: null, vb: null, anim: 0, bugs: null, built: false };
const atNS = 'http://www.w3.org/2000/svg';
const atEl = (t, a = {}, p) => { const e = document.createElementNS(atNS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const atRM = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function openAtlas() {
  show('scrAtlas');
  if (!AT.data) {
    $('#atSheet').innerHTML = loaderHtml('Loading the map...');
    try { const [d] = await Promise.all([fetch('data/atlas.json').then(r => r.json()), loadDirectory()]); AT.data = d; }
    catch (e) { $('#atSheet').innerHTML = `<div class="empty">Could not load the atlas. ${esc(e.message || e)}</div>`; return; }
  }
  if (!AT.built) atBuild();
  atLoadBugs().then(() => atRedraw());
  if (AT.level === 'dist' && AT.d) atOpenDist(AT.d, true); else if (AT.level === 'ac' && AT.a) atOpenAc(AT.a, true); else atOpenState(true);
}

function atBuild() {
  const A = AT.data, svg = $('#atMap');
  svg.innerHTML = '';
  AT.g = { dists: atEl('g', {}, svg), acs: atEl('g', {}, svg), edge: atEl('path', { class: 'at-edge' }, svg), bugs: atEl('g', {}, svg), labels: atEl('g', {}, svg), me: atEl('g', {}, svg) };
  AT.distEl = new Map(); AT.acEl = new Map(); AT.acBy = new Map(A.acs.map(a => [a.n, a]));
  A.dists.forEach(d => { const p = atEl('path', { d: d.p, class: 'at-dist' }, AT.g.dists); p.onclick = () => atOpenDist(d); AT.distEl.set(d.name, p); });
  A.acs.forEach(a => { const p = atEl('path', { d: a.p, class: 'at-ac' }, AT.g.acs); p.style.display = 'none'; p.onclick = e => { e.stopPropagation(); atOpenAc(a); }; AT.acEl.set(a.n, p); });
  AT.rings = new Map(A.acs.map(a => [a.n, a.p.split('Z').filter(Boolean).map(r => r.slice(1).split('L').map(q => q.split(',').map(Number)))]));
  // gestures: pinch out, wheel out, Escape or tapping the sea go up a level
  let pinch = null;
  svg.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }, { passive: true });
  svg.addEventListener('touchmove', e => { if (pinch && e.touches.length === 2) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); if (d < pinch * 0.7) { pinch = null; atUp(); } } }, { passive: true });
  svg.addEventListener('touchend', () => { pinch = null; });
  let wt = 0; svg.addEventListener('wheel', e => { e.preventDefault(); if (e.deltaY > 30 && Date.now() - wt > 700) { wt = Date.now(); atUp(); } }, { passive: false });
  svg.addEventListener('click', e => { if (e.target === svg) atUp(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && $('#scrAtlas').classList.contains('on')) atUp(); });
  addEventListener('resize', () => { if ($('#scrAtlas').classList.contains('on')) atSetVB(atFit(AT.level === 'state' ? [0, 0, A.W, A.H] : AT.level === 'dist' ? AT.d.b : AT.a.b)); });
  $('#atLocate').onclick = atLocate;
  AT.built = true;
}

/* camera */
function atSetVB(v) { AT.vb = v; $('#atMap').setAttribute('viewBox', v.map(n => n.toFixed(2)).join(' ')); }
function atFit(b, pad = 0.1) {
  const box = $('#atMap').getBoundingClientRect(), r = (box.width || 360) / (box.height || 400);
  let [x, y, w, h] = b; w = Math.max(w, 8); h = Math.max(h, 8);
  const W = w * (1 + pad * 2), H = h * (1 + pad * 2), vw = Math.max(W, H * r), vh = vw / r;
  return [x + w / 2 - vw / 2, y + h / 2 - vh / 2, vw, vh];
}
function atGlide(to, ms = 650) {
  cancelAnimationFrame(AT.anim);
  if (atRM || !AT.vb) { atSetVB(to); return Promise.resolve(); }
  const from = AT.vb.slice(), t0 = performance.now(), ease = t => 1 - Math.pow(1 - t, 3);
  return new Promise(res => { const step = now => { const t = Math.min(1, (now - t0) / ms), e = ease(t);
    atSetVB(from.map((f, i) => f + (to[i] - f) * e)); if (t < 1) AT.anim = requestAnimationFrame(step); else res(); };
    AT.anim = requestAnimationFrame(step); });
}

/* geometry */
function atProject(lat, lon) { const [mx, my, kx, ky] = AT.data.lonlat; return [(lon - mx) * kx, (my - lat) * ky]; }
function atInside(n, x, y) { let c = false;
  for (const ring of AT.rings.get(n)) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
  return c; }
function atHit(lat, lng) { if (!AT.data) return null; const [x, y] = atProject(lat, lng);
  return AT.data.acs.find(a => x >= a.b[0] && x <= a.b[0] + a.b[2] && y >= a.b[1] && y <= a.b[1] + a.b[3] && atInside(a.n, x, y)) || null; }

/* real bugs from the app (reporters see their own plus public reporters' checked ones, staff see all) */
async function atLoadBugs() {
  try { const data = await bugPoints();
    AT.bugs = (data || []).filter(r => r.lat && r.lng).map(r => { const [x, y] = atProject(r.lat, r.lng), a = atHit(r.lat, r.lng);
      return { x, y, ac: a && a.n, s: !OPEN_ST(r.status) ? 'fixed' : r.priority === 'urgent' ? 'urgent' : 'open' }; });
  } catch (_) { AT.bugs = []; }
}
const atSum = acs => (AT.bugs || []).filter(b => acs.includes(b.ac)).reduce((o, b) => (o[b.s]++, o), { urgent: 0, open: 0, fixed: 0 });

/* drawing */
function atLabels(items, size) { AT.g.labels.innerHTML = ''; items.forEach(it => { const t = atEl('text', { x: it.c[0], y: it.c[1], class: 'at-lbl', 'font-size': size, 'stroke-width': (size * 0.18).toFixed(2) }, AT.g.labels); t.textContent = it.t; }); }
function atDots(acs) { AT.g.bugs.innerHTML = ''; const r = AT.vb[2] / 140;
  (AT.bugs || []).filter(b => acs.includes(b.ac)).forEach(b => atEl('circle', { cx: b.x, cy: b.y, r: r * (b.s === 'urgent' ? 1.15 : 0.9), class: 'at-bug ' + b.s }, AT.g.bugs)); }
function atRedraw() { if (AT.level === 'dist') atDots(AT.d.acs); else if (AT.level === 'ac') atDots([AT.a.n]); atSheet(); }
function atCrumbs(path) { $('#atCrumbs').innerHTML = path.map((p, i) => `${i ? '<i>&#8250;</i>' : ''}<button class="${i === path.length - 1 ? 'cur' : ''}" data-i="${i}">${esc(p.t)}</button>`).join('');
  $('#atCrumbs').querySelectorAll('button').forEach(b => b.onclick = () => path[+b.dataset.i].go()); }
const atAcRow = n => DIR.byAc && DIR.byAc.get(n);
function atPartyBar(acs) {
  const c = {}; acs.forEach(n => { const a = atAcRow(n); const k = !a ? '?' : a.status === 'vacant' ? 'Vacant' : a.party; c[k] = (c[k] || 0) + 1; });
  const e = Object.entries(c).sort((x, y) => y[1] - x[1]);
  return `<div class="at-parties">${e.map(([p, n]) => `<span>${esc(p)} ${n}</span>`).join('')}</div>`;
}
function atSheet() {
  const box = $('#atSheet'), A = AT.data;
  const stats = (a, b, c) => `<div class="at-stats">${[a, b, c].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
  if (AT.level === 'state') {
    const s = atSum(A.acs.map(a => a.n));
    box.innerHTML = `<div class="at-k">State</div><div class="at-h">Tamil Nadu</div>${stats([38, 'districts'], [234, 'constituencies'], [s.urgent + s.open, 'open bugs'])}
      ${atPartyBar(A.acs.map(a => a.n))}<p class="muted small">Tap a district to zoom in. Pinch out or use the trail above to go back.</p>`;
  } else if (AT.level === 'dist') {
    const d = AT.d, s = atSum(d.acs);
    box.innerHTML = `<div class="at-k">District</div><div class="at-h">${esc(d.name)}</div>${stats([d.acs.length, 'constituencies'], [s.urgent + s.open, 'open bugs'], [s.fixed, 'fixed'])}
      ${atPartyBar(d.acs)}<button class="cta static ghost" data-dist="${esc(atDistName(d.name))}">Officers and police stations</button>`;
  } else {
    const a = AT.a, row = atAcRow(a.n), s = atSum([a.n]);
    box.innerHTML = `<div class="at-k">Constituency ${a.n} · ${esc(a.d)}</div><div class="at-h">${esc(row ? row.name : a.name)}</div>${stats([s.urgent, 'urgent'], [s.open, 'open'], [s.fixed, 'fixed'])}
      <div class="at-mla">${avatar('ac-' + a.n, row && row.mla_name, undefined)}<div><b>${row ? (row.status === 'vacant' ? 'Seat vacant' : esc(row.mla_name)) : esc(a.mla)}</b>
      <div class="muted small">${row && row.status !== 'vacant' ? 'MLA · ' + esc(row.party) : row ? esc(row.status_note || '') : ''}</div></div></div>
      <button class="cta static" id="atOpenArea">Open area details</button>`;
    $('#atOpenArea').onclick = () => { back(); openAc(a.n); };
    if (window.fillFaces) fillFaces(box);
  }
}
// atlas district names come from the boundary file; match them to the directory's spelling
function atDistName(n) { if (!DIR.acs) return n; const s = new Set(DIR.acs.map(a => a.district)); if (s.has(n)) return n;
  const k = x => x.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]/g, ''); return [...s].find(x => k(x) === k(n)) || n; }

/* levels */
function atOpenState(jump) {
  const A = AT.data; AT.level = 'state'; AT.d = AT.a = null;
  AT.distEl.forEach(p => p.classList.remove('dim', 'on'));
  AT.acEl.forEach(p => { p.style.display = 'none'; p.classList.remove('dim', 'on'); });
  AT.g.edge.setAttribute('d', ''); AT.g.bugs.innerHTML = '';
  const to = atFit([0, 0, A.W, A.H], 0.03);
  (jump ? (atSetVB(to), Promise.resolve()) : atGlide(to)).then(() => atLabels(A.dists.map(d => ({ c: d.c, t: d.name })), 11));
  atSheet(); atCrumbs([{ t: 'Tamil Nadu', go: () => atOpenState() }]);
}
function atOpenDist(d, jump) {
  AT.level = 'dist'; AT.d = d; AT.a = null;
  AT.distEl.forEach((p, n) => { p.classList.toggle('dim', n !== d.name); p.classList.toggle('on', n === d.name); });
  AT.acEl.forEach((p, n) => { p.style.display = AT.acBy.get(n).d === d.name ? '' : 'none'; p.classList.remove('dim', 'on'); });
  AT.g.labels.innerHTML = ''; AT.g.bugs.innerHTML = ''; AT.g.edge.setAttribute('d', d.p);
  const to = atFit(d.b);
  (jump ? (atSetVB(to), Promise.resolve()) : atGlide(to)).then(() => { atLabels(d.acs.map(n => ({ c: AT.acBy.get(n).c, t: AT.acBy.get(n).name })), Math.max(4, d.b[2] / 30)); atDots(d.acs); });
  atSheet(); atCrumbs([{ t: 'Tamil Nadu', go: () => atOpenState() }, { t: d.name, go: () => atOpenDist(d) }]);
}
function atOpenAc(a, jump) {
  const d = AT.data.dists.find(x => x.name === a.d);
  AT.level = 'ac'; AT.d = d; AT.a = a;
  AT.distEl.forEach((p, n) => { p.classList.toggle('dim', n !== d.name); p.classList.toggle('on', n === d.name); });
  AT.acEl.forEach((p, n) => { const inD = AT.acBy.get(n).d === d.name; p.style.display = inD ? '' : 'none'; p.classList.toggle('dim', inD && n !== a.n); p.classList.toggle('on', n === a.n); });
  AT.g.labels.innerHTML = ''; AT.g.bugs.innerHTML = ''; AT.g.edge.setAttribute('d', a.p);
  const to = atFit(a.b, 0.16);
  (jump ? (atSetVB(to), Promise.resolve()) : atGlide(to)).then(() => { atLabels([{ c: [a.c[0], a.b[1] + a.b[3] * 0.06], t: a.name }], Math.max(2.5, a.b[2] / 42)); atDots([a.n]); });
  atSheet(); atCrumbs([{ t: 'Tamil Nadu', go: () => atOpenState() }, { t: d.name, go: () => atOpenDist(d) }, { t: a.name, go: () => atOpenAc(a) }]);
}
function atUp() { if (AT.level === 'ac') atOpenDist(AT.d); else if (AT.level === 'dist') atOpenState(); }

/* find me: the spot the map card is about (your location, or the last spot tapped, searched or pinned) */
function atLocate() {
  const p = typeof pin !== 'undefined' && pin ? pin.getLatLng() : null; if (!p) return toast('Location not available');
  const hit = atHit(p.lat, p.lng); if (!hit) return toast('That spot is outside Tamil Nadu');
  atOpenAc(hit);
  setTimeout(() => { const [x, y] = atProject(p.lat, p.lng), r = AT.vb[2] / 110; AT.g.me.innerHTML = ''; atEl('circle', { cx: x, cy: y, r, class: 'at-me' }, AT.g.me); }, atRM ? 0 : 700);
}
