/* Pulse: the live map. Bugs are tiny blinking dots at their exact spot, news is a soft glow inside the constituency
   (or district) it is about. Borders never change colour with bugs or news; they follow the Atlas look.
   Tap to go deeper, one level per tap:
     1 tap  -> the district under your finger, with its bug and news counts
     2 taps -> its constituencies
     3 taps -> the constituency you tapped
     4 taps -> its wards (where the ward map exists)
   Tapping outside the current area starts again from that spot. The trail at the top goes back up.
   Taps move what the bottom card is about, they never drop the pin. Press and hold drops it (app.js); pzSpot then
   opens the constituency the pin is in without moving the map. */
const PZ = { on: false, level: 0, dist: null, ac: null, data: null, layers: {}, distGeo: null, wardSel: null, bound: false };
window.PZ = PZ;
const pzKey = n => String(n || '').toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]/g, '');
const pzLL = polys => polys.map(p => p.map(r => r.map(([x, y]) => [y, x])));
const pzRM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pzBottom = () => [30, Math.round(innerHeight * 0.3)]; // keep the area clear of the card at the bottom

async function pzLoad() {
  await Promise.all([loadDirectory(), loadShapes(), loadLocal().catch(() => {})]).catch(() => {});
  const out = { bugs: [], news: [] };
  try { const data = await bugPoints();
    out.bugs = (data || []).filter(r => r.lat && r.lng).map(r => ({ lat: r.lat, lng: r.lng, ac: acAt(r.lat, r.lng), s: !OPEN_ST(r.status) ? 'fixed' : (r.priority === 'urgent' || r.reported_urgent) ? 'urgent' : 'open' })); } catch (_) {}
  try { const { data } = await sb.from('news').select('id,ac_nos,districts,statewide').eq('hidden', false); out.news = (data || []).filter(n => !n.statewide); } catch (_) {}
  // per constituency and per district (a story tagged to both counts once per district)
  out.byAc = {}; out.byD = {};
  const acRow = ac => DIR.byAc && DIR.byAc.get(ac), dRow = d => out.byD[d] || (out.byD[d] = { open: 0, fixed: 0, urgent: 0, news: new Set() });
  out.bugs.forEach(b => { const a = acRow(b.ac); if (!a) return; const x = out.byAc[b.ac] || (out.byAc[b.ac] = { open: 0, fixed: 0, urgent: 0, news: 0 });
    x[b.s]++; dRow(a.district)[b.s]++; });
  out.news.forEach(n => { (n.ac_nos || []).forEach(ac => { const a = acRow(ac); if (!a) return; (out.byAc[ac] || (out.byAc[ac] = { open: 0, fixed: 0, urgent: 0, news: 0 })).news++; dRow(a.district).news.add(n.id); });
    (n.districts || []).forEach(d => { const dn = pzDistName(d); if (dn) dRow(dn).news.add(n.id); }); });
  return out;
}
// directory spelling of a district name from any spelling
function pzDistName(n) { if (!DIR.acs) return n; const k = pzKey(n); const d = DIR.acs.find(a => pzKey(a.district) === k); return d ? d.district : null; }

/* ---------- drawing ---------- */
async function pzBuild() {
  if (!PZ.distGeo) PZ.distGeo = await (await fetch('data/tn_district.geojson')).json();
  const L_ = PZ.layers;
  // districts: always there, quiet, the selected one gets the accent edge
  if (!L_.dist) {
    L_.distBy = new Map();
    L_.dist = L.geoJSON(PZ.distGeo, { interactive: false, style: () => ({ className: 'pz-dist', weight: 1 }),
      onEachFeature: (f, l) => { const dn = pzDistName(f.properties.d) || f.properties.d; L_.distBy.set(dn, l); } });
  }
  // constituencies: drawn once, shown only for the selected district
  if (!L_.ac) {
    L_.acBy = new Map();
    L_.ac = L.layerGroup((DIR.shapes || []).map(sh => { const p = L.polygon(pzLL(sh.polys), { className: 'pz-ac pz-off', weight: 1, interactive: false }); L_.acBy.set(sh.ac, p); return p; }));
    L_.acLbl = L.layerGroup();
  }
  L_.wards = L_.wards || L.layerGroup();
  pzDots(); pzNews();
}
function pzDots() {
  const L_ = PZ.layers; if (L_.bugs) map.removeLayer(L_.bugs);
  L_.bugs = L.layerGroup(PZ.data.bugs.map((b, i) => L.marker([b.lat, b.lng], { interactive: false, keyboard: false,
    icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: `<i class="pz-bug ${b.s}" style="animation-delay:${pzRM ? 0 : (i % 17) * 0.11}s"></i>` }) })));
  if (PZ.on) L_.bugs.addTo(map);
}
function pzNews() {
  const L_ = PZ.layers; if (L_.news) map.removeLayer(L_.news);
  const spots = [];
  Object.entries(PZ.data.byAc).forEach(([ac, x]) => { if (!x.news) return; const sh = DIR.shapes.find(s => s.ac === +ac); if (sh) spots.push({ ll: interiorPoint(sh), n: x.news }); });
  // stories tagged only to a district glow at the district's middle
  const acTagged = new Set(PZ.data.news.filter(n => (n.ac_nos || []).length).map(n => n.id));
  const dOnly = {}; PZ.data.news.filter(n => !acTagged.has(n.id)).forEach(n => (n.districts || []).forEach(d => { const dn = pzDistName(d); if (dn) dOnly[dn] = (dOnly[dn] || 0) + 1; }));
  Object.entries(dOnly).forEach(([d, n]) => { const l = L_.distBy && L_.distBy.get(d); if (l) spots.push({ ll: l.getBounds().getCenter(), n, wide: true }); });
  L_.news = L.layerGroup(spots.map(s => { const r = Math.round(Math.min(90, (s.wide ? 46 : 30) + 10 * Math.log2(1 + s.n)));
    return L.marker(s.ll, { interactive: false, keyboard: false, zIndexOffset: -1000,
      icon: L.divIcon({ className: '', iconSize: [r, r], iconAnchor: [r / 2, r / 2], html: `<i class="pz-news${s.wide ? ' wide' : ''}" style="animation-delay:${pzRM ? 0 : (Math.random() * 3).toFixed(2)}s"></i>` }) }); }));
  if (PZ.on) L_.news.addTo(map);
}
const pzCls = (l, add, rm) => { const p = l && l._path; if (!p) return; (rm || []).forEach(c => p.classList.remove(c)); (add || []).forEach(c => p.classList.add(c)); };

/* ---------- levels ---------- */
function pzPaint() {
  const L_ = PZ.layers; if (!L_.dist) return;
  L_.distBy.forEach((l, d) => pzCls(l, PZ.level && d === PZ.dist ? ['on'] : PZ.level ? ['dim'] : [], ['on', 'dim']));
  const inD = ac => { const a = DIR.byAc.get(ac); return a && a.district === PZ.dist; };
  L_.acBy.forEach((l, ac) => { const show = PZ.level >= 2 && inD(ac);
    pzCls(l, show ? (PZ.level >= 3 ? (ac === PZ.ac ? ['on'] : ['dim']) : []) : ['pz-off'], ['pz-off', 'on', 'dim']); });
  L_.acLbl.clearLayers();
  if (PZ.level === 2) DIR.shapes.filter(sh => inD(sh.ac)).forEach(sh => { const a = DIR.byAc.get(sh.ac), x = PZ.data.byAc[sh.ac] || {}, n = (x.open || 0) + (x.urgent || 0);
    L_.acLbl.addLayer(L.marker(interiorPoint(sh), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'pz-lbl', iconSize: null, html: `<span>${esc(a.name)}${n ? ` <b>${n}</b>` : ''}</span>` }) })); });
  if (PZ.level < 4) { L_.wards.clearLayers(); PZ.wardSel = null; }
  pzCrumbs();
}
function pzFly(bounds, maxZoom) { map.flyToBounds(bounds, { paddingTopLeft: [30, 140], paddingBottomRight: pzBottom(), duration: pzRM ? 0 : 0.9, maxZoom: maxZoom || 16 }); }
function pzState() { PZ.level = 0; PZ.dist = PZ.ac = null; pzPaint(); updateHereCard(); }
function pzDist(d, level) {
  PZ.level = level; PZ.dist = d; PZ.ac = null; pzPaint();
  const l = PZ.layers.distBy.get(d); if (l) pzFly(l.getBounds(), 11);
  pzCard();
}
function pzAc(ac, ll) {
  const a = DIR.byAc.get(ac); if (!a) return;
  PZ.level = 3; PZ.dist = a.district; PZ.ac = ac; pzPaint();
  const l = PZ.layers.acBy.get(ac); if (l) pzFly(l.getBounds(), 15);
  hereAc = null;
  // the card moves to this constituency; a pin already standing inside it stays where it is (trail button)
  const p = pin.getLatLng();
  if (pinShown && acAt(p.lat, p.lng) === ac) updateGps(); else lookAt(ll || interiorPoint(DIR.shapes.find(s => s.ac === ac)));
}
function pzWards(ac, ll) {
  PZ.level = 4; PZ.ac = ac; pzPaint();
  const L_ = PZ.layers; L_.wards.clearLayers();
  const ws = (LOCAL.wards || []).filter(w => { const c = [(w.box[1] + w.box[3]) / 2, (w.box[0] + w.box[2]) / 2]; return (w.ac || acAt(c[0], c[1])) === ac; });
  ws.forEach(w => L_.wards.addLayer(L.polygon(pzLL(w.polys), { className: 'pz-ward', weight: 1, interactive: false })
    .bindTooltip(String(w.w), { permanent: true, direction: 'center', className: 'pz-wlbl' })));
  if (!map.hasLayer(L_.wards)) L_.wards.addTo(map);
  if (!ws.length) toast('No ward map for this area yet');
  pzWardAt(ll);
}
function pzWardHi(ll) { // light up the ward under a spot
  const w = wardAt(ll.lat, ll.lng); PZ.wardSel = w;
  PZ.layers.wards.eachLayer(l => pzCls(l, [], ['on']));
  if (w) PZ.layers.wards.eachLayer(l => { if (l.getTooltip() && l.getTooltip().getContent() === String(w.w)) pzCls(l, ['on']); });
}
function pzWardAt(ll) {
  if (!ll) return;
  pzWardHi(ll);
  hereAc = null; lookAt(ll);
}
// The pin was dropped (press and hold, a place from search, a bug opened on the map): show the constituency it is in,
// so the card is about the pin. The map does not move.
function pzSpot(ll) {
  if (!PZ.on || !PZ.layers.dist || !DIR.byAc || !DIR.shapes) return;
  const ac = acAt(ll.lat, ll.lng), a = ac && DIR.byAc.get(ac); if (!a) return;
  if (PZ.ac === ac && PZ.level === 4) return pzWardHi(ll);
  if (PZ.ac === ac && PZ.level === 3) return;
  PZ.level = 3; PZ.dist = a.district; PZ.ac = ac; pzPaint();
}
window.pzSpot = pzSpot;

/* the one tap handler for the map */
function pzTap(e) {
  if (typeof closeSearch === 'function') closeSearch();
  if (typeof drawWard === 'function') drawWard(null);
  const ll = e.latlng, ac = acAt(ll.lat, ll.lng), a = ac && DIR.byAc.get(ac);
  if (!a) { pzState(); return; }
  const d = a.district;
  if (PZ.level === 0 || d !== PZ.dist) return pzDist(d, 1);
  if (PZ.level === 1) return pzDist(d, 2);
  if (PZ.level === 2 || ac !== PZ.ac) return pzAc(ac, ll);
  if (PZ.level === 3) return pzWards(ac, ll);
  return pzWardAt(ll);
}
window.pzTap = pzTap;

/* bottom card for the district levels; the constituency levels use the normal "who represents this spot" card */
function pzCard() {
  if (!PZ.on || !PZ.level || PZ.level > 2 || !PZ.dist) return false;
  const card = $('#hereCard'); if (!card) return false;
  const x = PZ.data.byD[PZ.dist] || { open: 0, fixed: 0, urgent: 0, news: new Set() };
  const acs = DIR.acs.filter(a => a.district === PZ.dist), seats = {}; acs.forEach(a => { const k = a.status === 'vacant' ? 'Vacant' : a.party; seats[k] = (seats[k] || 0) + 1; });
  card.innerHTML = `<div class="hc-main"><div class="hc-name">${esc(PZ.dist)} district</div>
    <div class="hc-k">${acs.length} constituencies · ${Object.entries(seats).sort((p, q) => q[1] - p[1]).map(([p, n]) => `${esc(p)} ${n}`).join(' · ')}</div>
    <div class="pz-stats"><span class="u"><b>${x.urgent}</b> urgent</span><span class="o"><b>${x.open}</b> open</span><span class="f"><b>${x.fixed}</b> fixed</span><span class="n"><b>${x.news.size}</b> news</span></div>
    <div class="hc-s">${PZ.level === 1 ? 'Tap again to see its constituencies' : 'Tap a constituency to go in'}</div></div>
    <button class="hc-all" data-dist="${esc(PZ.dist)}">Officers</button>`;
  card.hidden = false;
  return true;
}
window.pzCard = pzCard;
function pzCrumbs() {
  let c = $('#pzCrumbs'); if (!c) return;
  const a = PZ.ac && DIR.byAc.get(PZ.ac), path = [{ t: 'Tamil Nadu', go: () => { pzState(); map.flyTo([11.1, 78.6], 7, { duration: pzRM ? 0 : 0.9 }); } }];
  if (PZ.dist) path.push({ t: PZ.dist, go: () => pzDist(PZ.dist, 2) });
  if (a) path.push({ t: a.name, go: () => pzAc(PZ.ac) });
  if (PZ.level === 4) path.push({ t: 'Wards', go: () => {} });
  c.innerHTML = path.map((p, i) => `${i ? '<i>&#8250;</i>' : ''}<button class="${i === path.length - 1 ? 'cur' : ''}" data-i="${i}">${esc(p.t)}</button>`).join('');
  c.querySelectorAll('button').forEach(b => b.onclick = ev => { ev.stopPropagation(); path[+b.dataset.i].go(); });
}

/* summary line: what is going on across the state right now */
function pzSummary() {
  const s = $('#pzSum'); if (!s || !PZ.data) return;
  const n = { urgent: 0, open: 0, fixed: 0 }; PZ.data.bugs.forEach(b => n[b.s]++);
  s.innerHTML = `<span class="u"><i></i>${n.urgent} urgent</span><span class="o"><i></i>${n.open} open</span><span class="f"><i></i>${n.fixed} fixed</span><span class="n"><i></i>${PZ.data.news.length} news</span>`;
}

async function pzLayer(on) {
  PZ.on = on;
  const box = $('#pzBox');
  if (!on) { Object.values(PZ.layers).forEach(l => { if (l instanceof L.Layer && map.hasLayer(l)) map.removeLayer(l); }); if (box) box.hidden = true; PZ.level = 0; if (typeof pin !== 'undefined' && pin) updateGps(); return; }
  if (!box) { const b = document.createElement('div'); b.id = 'pzBox'; b.className = 'pz-box'; b.innerHTML = '<div id="pzCrumbs" class="pz-crumbs"></div><div id="pzSum" class="pz-sum"></div>'; map.getContainer().parentNode.appendChild(b); }
  $('#pzBox').hidden = false;
  if (!PZ.data) PZ.data = await pzLoad();
  await pzBuild();
  const L_ = PZ.layers; [L_.dist, L_.ac, L_.acLbl, L_.wards, L_.news, L_.bugs].forEach(l => l && !map.hasLayer(l) && l.addTo(map));
  pzPaint(); pzSummary();
  if (typeof pin !== 'undefined' && pin) updateGps(); // the hint above the card says what a tap does
}
window.pzLayer = pzLayer;
// after a new report or a news refresh: reload the dots and glows, keep where the user is
window.refreshGlow = async () => { if (!PZ.on) return; PZ.data = await pzLoad(); pzDots(); pzNews(); pzSummary(); if (PZ.level <= 2) pzCard(); };
