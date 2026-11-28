/* TN Bug Sheet - directory: who represents a place, all 234 MLAs, ministers and their departments.
   Data lives in Supabase (members only). Boundaries are bundled: web/data/tn_ac.geojson,
   from Datameet (CC BY 2.5 India), simplified, approximate near constituency edges. */
const DIR = { acs: null, mins: null, parties: [], byAc: new Map(), minByAc: new Map(), shapes: null, loading: null };
const DIR_CACHE = 'tnb-dir-v1';
const PARTY_NAME = { TVK: 'Tamilaga Vettri Kazhagam', DMK: 'Dravida Munnetra Kazhagam', AIADMK: 'All India Anna Dravida Munnetra Kazhagam', INC: 'Indian National Congress', PMK: 'Pattali Makkal Katchi', VCK: 'Viduthalai Chiruthaigal Katchi', IUML: 'Indian Union Muslim League', 'CPI(M)': 'Communist Party of India (Marxist)', CPI: 'Communist Party of India', DMDK: 'Desiya Murpokku Dravida Kazhagam', BJP: 'Bharatiya Janata Party', AMMK: 'Amma Makkal Munnetra Kazhagam' };
const GRADE = { A: 'official source', B: 'major news', C: 'secondary source' };

function dirIndex() {
  DIR.byAc = new Map(DIR.acs.map(a => [a.ac_no, a]));
  DIR.minByAc = new Map(DIR.mins.map(m => [m.ac_no, m]));
}
async function loadDirectory(force = false) {
  if (DIR.acs && !force) return;
  if (DIR.loading) return DIR.loading;
  DIR.loading = (async () => {
    try {
      const [a, m, pt] = await Promise.all([
        sb.from('constituencies').select('*').order('ac_no'),
        sb.from('ministers').select('*').order('seniority'),
        sb.from('parties').select('*'),
      ]);
      if (a.error) throw a.error; if (m.error) throw m.error;
      DIR.acs = a.data; DIR.mins = m.data; DIR.parties = pt.error ? [] : pt.data; dirIndex();
      try { localStorage.setItem(DIR_CACHE, JSON.stringify({ at: Date.now(), acs: DIR.acs, mins: DIR.mins, parties: DIR.parties })); } catch (_) {}
    } catch (e) {
      // Offline: fall back to the last copy on this phone.
      try { const c = JSON.parse(localStorage.getItem(DIR_CACHE)); if (c) { DIR.acs = c.acs; DIR.mins = c.mins; DIR.parties = c.parties || []; dirIndex(); return; } } catch (_) {}
      throw e;
    } finally { DIR.loading = null; }
  })();
  return DIR.loading;
}
async function loadShapes() {
  if (DIR.shapes) return;
  // the ward maps come along: inside them the ward decides the constituency (see acAt)
  const [g] = await Promise.all([fetch('data/tn_ac.geojson').then(r => r.json()), loadLocal().catch(() => {})]);
  DIR.shapes = g.features.map(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    polys.forEach(p => p[0].forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
    return { ac: f.properties.ac, polys, box: [x0, y0, x1, y1] };
  });
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function acAt(lat, lng) {
  if (!DIR.shapes) return null;
  // Inside the Tambaram Corporation ward map the ward decides the seat. The corporation lies wholly in Pallavaram (30) and
  // Tambaram (31), but the state-wide constituency shapes are coarse and put its edges in Alandur, Sholinganallur and Sriperumbudur.
  const w = LOCAL.wards ? wardAt(lat, lng) : null;
  if (w && w.ac) return w.ac;
  for (const s of DIR.shapes) {
    const [x0, y0, x1, y1] = s.box;
    if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
    for (const p of s.polys) if (inRing(lng, lat, p[0]) && !p.slice(1).some(h => inRing(lng, lat, h))) return s.ac;
  }
  return null;
}
const SIDE_TXT = { government: 'MLA is from the ruling side', outside_support: 'MLA backs the government from outside', opposition: 'MLA is from the opposition' };
const sideOf = code => ((DIR.parties || []).find(p => p.code === code) || {}).side || null;
const sideLabel = a => a.status === 'vacant' ? 'Seat vacant' : (SIDE_TXT[sideOf(a.party)] || '');
const mlaLine = a => a.status === 'vacant' ? `Vacant seat (was ${esc(a.mla_name)})` : `${esc(a.mla_name)} · ${esc(a.party)}`;
const acTitle = a => `${esc(a.name)}${a.reserved ? ` (${a.reserved})` : ''}`;

/* ---------- "who represents this spot" card on the map ---------- */
let hereAc = null;
async function updateHereCard() {
  const card = $('#hereCard'); if (!card || !me) return;
  try { await Promise.all([loadShapes(), loadDirectory(), loadLocal(), window.loadCouncillors ? loadCouncillors().catch(() => {}) : null]); } catch (_) { card.hidden = true; return; }
  localLayers();
  bindMapTap();
  if (window.pzCard && pzCard()) return; // district level of the live map owns the card
  // the spot the card is about: the pin if it is out, else the last spot tapped or searched, else your own location
  const p = pin.getLatLng(), nowhere = !here && !pinMoved, ac = nowhere ? null : acAt(p.lat, p.lng); // nowhere: no location fix yet and nothing picked
  if (ac !== hereAc) drawOutline(ac);
  hereAc = ac; lastWard = nowhere ? null : wardAt(p.lat, p.lng);
  if (nowhere) card.innerHTML = `<div class="hc-main"><div class="hc-t">Waiting for your location</div><div class="hc-s">Or tap the map to look at any area</div></div><button class="hc-all" id="hcAll">All MLAs</button>`;
  else if (!ac || !DIR.byAc.get(ac)) { card.innerHTML = `<div class="hc-t">Outside Tamil Nadu's constituency map</div><button class="hc-all" id="hcAll">All MLAs</button>`; }
  else {
    const a = DIR.byAc.get(ac), m = DIR.minByAc.get(ac);
    const side = sideLabel(a);
    card.innerHTML = `<div class="hc-main" id="hcOpen"><div class="hc-name">${acTitle(a)}</div><div class="hc-k">Constituency ${a.ac_no} · <a href="#" class="dlink" data-dist="${esc(a.district)}">${esc(a.district)} district</a></div>
      <div class="hc-t">${mlaLine(a)}</div><div class="hc-s">${m ? esc(m.designation) : side}</div>
      ${lastWard ? `<div class="hc-k">${localLine(lastWard)}</div>` : ''}</div>
      <button class="hc-all" id="hcAll">All MLAs</button>`;
    $('#hcOpen').onclick = () => openAc(ac);
  }
  $('#hcAll').onclick = () => openDirectory();
  card.hidden = false;
  if (window.renderHome && $('#scrHome').classList.contains('on')) renderHome();
}
/* ---------- local body limits: Chennai Corporation wards and zones, Chennai Metropolitan Area, Tambaram Corporation wards ----------
   Chennai: Datameet / Transparent Chennai shapes. Tambaram: the 70 wards traced from the corporation's own city map and
   placed on the ground with OpenStreetMap roads and the railway line (good to about 10 m; see docs/tambaram-ward-map.md). */
const LOCAL = { wards: null, layer: null, wardLayer: null, feats: null, loading: null, tcmc: false };
function loadLocal() {
  if (LOCAL.wards) return Promise.resolve();
  if (LOCAL.loading) return LOCAL.loading;
  LOCAL.loading = (async () => {
    const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
    const [g, t] = await Promise.all([get('data/chennai_local.geojson'), get('data/tambaram_wards.geojson').catch(() => ({ features: [] }))]);
    const prep = f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
      polys.forEach(p => p[0].forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
      return { ...f.properties, polys, box: [x0, y0, x1, y1] };
    };
    // Tambaram first: where the two maps meet (a strip a few metres wide at Madipakkam) its border is the better placed one
    LOCAL.feats = [...t.features, ...g.features.map(f => ({ ...f, properties: { corp: 'GCC', ...f.properties } }))];
    LOCAL.wards = LOCAL.feats.filter(f => f.properties.kind === 'ward').map(prep);
    LOCAL.tcmc = t.features.length > 0;   // the Tambaram ward map is on board
    localLayers();
  })();
  LOCAL.loading.catch(() => { LOCAL.loading = null; });
  return LOCAL.loading;
}
window.loadLocal = loadLocal;
// outlines on the map: zone and metro limits always, ward lines from zoom 13. Made once, when both the map and the shapes exist.
function localLayers() {
  if (LOCAL.layer || !LOCAL.feats || !map) return;
  const style = f => f.properties.kind === 'cma' ? { color: '#555', weight: 1.5, dashArray: '2 5', fill: false }
    : { color: '#6a6a6a', weight: 1.6, dashArray: '6 4', fill: false };
  LOCAL.layer = L.geoJSON({ type: 'FeatureCollection', features: LOCAL.feats.filter(f => f.properties.kind !== 'ward') }, { style, interactive: false });
  if (LOCAL.on !== false) LOCAL.layer.addTo(map);
  LOCAL.wardLayer = L.geoJSON({ type: 'FeatureCollection', features: LOCAL.feats.filter(f => f.properties.kind === 'ward') },
    { style: { color: '#9a9a9a', weight: 0.7, fill: false }, interactive: false });
  const sync = () => { const on = LOCAL.on !== false && map.getZoom() >= 13; if (on && !map.hasLayer(LOCAL.wardLayer)) LOCAL.wardLayer.addTo(map); if (!on && map.hasLayer(LOCAL.wardLayer)) map.removeLayer(LOCAL.wardLayer); };
  LOCAL.sync = sync; map.on('zoomend', sync); sync();
}
function wardAt(lat, lng) {
  if (!LOCAL.wards) return null;
  for (const s of LOCAL.wards) {
    const [x0, y0, x1, y1] = s.box;
    if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
    for (const p of s.polys) if (inRing(lng, lat, p[0]) && !p.slice(1).some(h => inRing(lng, lat, h))) return s;
  }
  return null;
}
// the councillors table key for a spot ("TCMC-27"), only where we hold both the ward map and the councillor list
function wardKeyAt(lat, lng) { const w = lat != null && lng != null ? wardAt(+lat, +lng) : null; return w && w.corp === 'TCMC' ? 'TCMC-' + w.w : null; }
window.wardKeyAt = wardKeyAt;
const zoneNo = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13, XIV: 14, XV: 15 };
const corpOf = w => w.corp === 'TCMC' ? 'Tambaram Corporation' : 'Chennai Corporation';
const zoneLabel = w => w.corp === 'TCMC' ? `Zone ${w.zn}` : `Zone ${zoneNo[w.zn] || w.zn} ${w.zname || ''}`.trim();
const localLine = w => !w ? '' : w.zn === '-' ? 'St. Thomas Mount Cantonment (not Chennai Corporation)'
  : `${corpOf(w)} · ${esc(zoneLabel(w))} · Ward ${w.w}`;
let lastWard = null;

let outline = null, wardOutline = null;
const toLatLngs = polys => polys.map(p => p.map(r => r.map(([x, y]) => [y, x])));
function drawOutline(ac) {
  if (!map || !DIR.shapes) return;
  if (outline) { map.removeLayer(outline); outline = null; }
  if (window.PZ && PZ.on) return; // the live map draws its own selected constituency
  const sh = DIR.shapes.find(x => x.ac === ac); if (!sh) return;
  outline = L.polygon(toLatLngs(sh.polys), { color: '#e8475f', weight: 2.5, fillColor: '#e8475f', fillOpacity: 0.08, interactive: false }).addTo(map);
}
function drawWard(w) {
  if (!map) return;
  if (wardOutline) { map.removeLayer(wardOutline); wardOutline = null; }
  if (w) wardOutline = L.polygon(toLatLngs(w.polys), { color: '#222', weight: 2, dashArray: '4 3', fillColor: '#222', fillOpacity: 0.05, interactive: false }).addTo(map);
}
// A point safely inside a shape (the box centre can fall outside odd shapes).
function interiorPoint(sh) {
  let best = null;
  for (const p of sh.polys) {
    const ring = p[0]; let y0 = 90, y1 = -90;
    ring.forEach(([, y]) => { y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const y = y0 + (y1 - y0) * f, xs = [];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) { const wdt = xs[k + 1] - xs[k]; if (!best || wdt > best.w) best = { w: wdt, lat: y, lng: (xs[k] + xs[k + 1]) / 2 }; }
      if (best) break;
    }
  }
  return best ? [best.lat, best.lng] : [(sh.box[1] + sh.box[3]) / 2, (sh.box[0] + sh.box[2]) / 2];
}
// Select an area: fly to it, outline it, point the card at a spot inside it. No pin: the outline shows what was picked.
async function focusShape(sh, isWard = false) {
  if (!sh) return;
  show('scrMap');
  await new Promise(r => setTimeout(r, 60));
  map.invalidateSize();
  const [x0, y0, x1, y1] = sh.box;
  map.flyToBounds([[y0, x0], [y1, x1]], { padding: [40, 40], duration: 0.8, maxZoom: 16 });
  hereAc = null; // force the outline to redraw
  lookAt(interiorPoint(sh));
  if (window.pzSpot) pzSpot(pin.getLatLng()); // the live map follows to that constituency
  if (isWard) setTimeout(() => drawWard(sh), 300);
}
async function focusAc(ac) { await loadShapes(); focusShape(DIR.shapes.find(x => x.ac === ac)); }
// One exact place (a search result, or a bug opened on the map): fly there and mark it with the pin.
async function focusPlace(lat, lng, zoom = 16) {
  show('scrMap'); await new Promise(r => setTimeout(r, 60)); map.invalidateSize();
  map.flyTo([lat, lng], zoom, { duration: 0.8 }); hereAc = null; dropPin([lat, lng], false);
}
let mapTapBound = false;
function bindMapTap() {
  if (mapTapBound || !map) return; mapTapBound = true;
  // A tap looks at a spot (or goes one level deeper on the live map). It never drops the pin: press and hold does (app.js).
  // With the pin out, a tap only puts it away, so the view stays where it is. Guards that keep a pin set on purpose:
  // the tap some phones send when the finger lifts after the hold (same press as the one that set the pin, or within
  // 700 ms of it), and a double tap, which zooms the map.
  let awayT = null, dblAt = 0;
  map.on('dblclick', () => { dblAt = Date.now(); clearTimeout(awayT); });
  map.on('click', e => {
    if (pinShown) {
      clearTimeout(awayT);
      if (pressN !== pinPressN && Date.now() - pinAt > 700 && Date.now() - dblAt > 350) awayT = setTimeout(() => { if (pinShown && Date.now() - dblAt > 350) clearPin(); }, 280);
      return;
    }
    if (window.PZ && PZ.on && window.pzTap) return pzTap(e);
    closeSearch(); drawWard(null); lookAt(e.latlng);
  });
}
const _updateGps = updateGps;
updateGps = function () { _updateGps(); clearTimeout(updateHereCard.t); updateHereCard.t = setTimeout(updateHereCard, 250); };

/* ---------- directory screen ---------- */
let dirTab = 'mla', dirQ = '', dirDist = '';
async function openDirectory() {
  show('scrDir');
  $('#dirBody').innerHTML = loaderHtml('Loading directory...');
  try { await loadDirectory(); } catch (e) { $('#dirBody').innerHTML = `<div class="empty">Could not load the directory.<br><span class="small">${esc(e.message || e)}</span></div>`; return; }
  const dists = [...new Set(DIR.acs.map(a => a.district))].sort();
  $('#dirDist').innerHTML = `<option value="">All 38 districts</option>` + dists.map(d => `<option ${d === dirDist ? 'selected' : ''}>${esc(d)}</option>`).join('');
  renderDir();
}
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' '); }
function renderDir() {
  document.querySelectorAll('#dirTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === dirTab));
  $('#dirDist').hidden = dirTab !== 'mla';
  $('#dirSearch').hidden = dirTab === 'party';
  if (dirTab === 'party') return renderParties();
  if (dirTab === 'off') return renderOfficers();
  const q = norm(dirQ).trim(), words = q ? q.split(' ') : [];
  const hit = hay => words.every(w => hay.includes(w));
  let html = '';
  if (dirTab === 'mla') {
    const rows = DIR.acs.filter(a => (!dirDist || a.district === dirDist) &&
      hit(norm([a.ac_no, a.name, a.district, a.pc_name, a.mla_name, a.party, PARTY_NAME[a.party], DIR.minByAc.get(a.ac_no)?.designation].join(' '))));
    html = (dirDist ? `<button class="item dir dist-open" data-dist="${esc(dirDist)}"><div class="t"><div><b>${esc(dirDist)} district</b></div><div class="muted small">Collector, police stations and offices with numbers</div></div><span class="tag">Open</span></button>` : '')
      + `<p class="muted small">${rows.length} of 234 constituencies</p>` + rows.map(a => {
      const m = DIR.minByAc.get(a.ac_no);
      return `<button class="item dir" data-ac="${a.ac_no}">${avatar('ac-' + a.ac_no, a.mla_name, a.ac_no)}<div class="t">
        <div>${acTitle(a)} <span class="muted small">· AC ${a.ac_no} · ${esc(a.district)}</span></div>
        <div class="muted small">${mlaLine(a)}${m ? ' · Minister' : ''}</div></div>${a.status === 'vacant' ? '<span class="tag rejected">Vacant</span>' : ''}</button>`;
    }).join('');
  } else {
    const rows = DIR.mins.filter(m => hit(norm([m.name, m.designation, m.portfolios, DIR.byAc.get(m.ac_no)?.name, DIR.byAc.get(m.ac_no)?.district].join(' '))));
    html = `<p class="muted small">${rows.length} of ${DIR.mins.length} in the Council of Ministers · as per G.O. Ms. No. 366, 30 May 2026</p>` + rows.map(m => {
      const a = DIR.byAc.get(m.ac_no);
      return `<button class="item dir" data-ac="${m.ac_no}">${avatar('ac-' + m.ac_no, m.name, m.seniority)}<div class="t">
        <div>${esc(m.name)}</div><div class="muted small">${esc(m.designation)}</div>
        <div class="muted small wrap">${esc(m.portfolios)}</div><div class="muted small">MLA, ${a ? acTitle(a) : ''}</div></div></button>`;
    }).join('');
  }
  $('#dirBody').innerHTML = html || '<div class="empty">No match.</div>';
  $('#dirBody').querySelectorAll('[data-ac]').forEach(b => b.onclick = () => openAc(+b.dataset.ac));
  if (window.fillFaces) fillFaces($('#dirBody'));
}
// photo thumbnail when staff have uploaded one, else the number or initial
// initials for people without a photo, in name order: "P. Saravanan" -> "PS", "Kumar. R" -> "KR"
function initials(name) {
  const t = String(name || '').replace(/\b(Dr|Thiru|Tmt|Selvi|Adv|Advocate)\b\.?/gi, ' ').split(/[\s.]+/).filter(w => /^[A-Za-z]/.test(w));
  return (t.length ? t.slice(0, 2).map(w => w[0]).join('') : String(name || '?').trim()[0] || '?').toUpperCase();
}
function avatar(key, name, fallback) {
  const fb = fallback == null || (typeof fallback === 'number' && name) ? initials(name) : fallback;
  return `<span class="av"><span class="no">${esc(String(fb))}</span><img data-face="${esc(key)}" alt="" hidden onload="this.previousElementSibling.hidden=true"></span>`;
}
$('#dirSearch').addEventListener('input', e => { dirQ = e.target.value; renderDir(); });
$('#dirDist').addEventListener('change', e => { dirDist = e.target.value; renderDir(); });
document.querySelectorAll('#dirTabs button').forEach(b => b.onclick = () => { dirTab = b.dataset.t; renderDir(); });

/* ---------- party tree: Assembly > Government / Opposition > party > MLAs ---------- */
const openParties = new Set();
function renderParties() {
  const sitting = DIR.acs.filter(a => a.status === 'sitting');
  const vacant = DIR.acs.length - sitting.length;
  const byParty = new Map();
  sitting.forEach(a => { if (!byParty.has(a.party)) byParty.set(a.party, []); byParty.get(a.party).push(a); });
  const info = new Map(DIR.parties.map(p => [p.code, p]));
  const seats = list => list.reduce((n, code) => n + (byParty.get(code) || []).length, 0);
  const sideOf = code => (info.get(code) || {}).side || 'opposition';
  const codes = [...byParty.keys()].sort((x, y) => byParty.get(y).length - byParty.get(x).length);
  const groups = [
    ['government', 'In government', 'Parties with ministers in the cabinet'],
    ['outside_support', 'Supporting from outside', 'Back the government, not in the cabinet'],
    ['opposition', 'Opposition', 'Not part of the government'],
  ];
  const govSeats = seats(codes.filter(c => sideOf(c) !== 'opposition'));
  const TONE = { government: 'gov', outside_support: 'sup', opposition: 'opp' };
  const partyNode = code => {
    const p = info.get(code) || { name: PARTY_NAME[code] || code }, mlas = byParty.get(code) || [];
    return { id: 'p-' + code, title: code, sub: p.name || PARTY_NAME[code] || code, face: 'party-' + code, fallback: code.slice(0, 3), tone: TONE[sideOf(code)],
      badge: `<span>${mlas.length} ${mlas.length === 1 ? 'seat' : 'seats'}</span>` + (p.leader_name ? `<span>${esc(p.leader_title || 'Leader')}: ${esc(p.leader_name)}</span>` : ''),
      kids: mlas.map(a => ({ id: 'm-' + a.ac_no, title: a.mla_name, sub: a.name + (DIR.minByAc.get(a.ac_no) ? ' · Minister' : ''), face: 'ac-' + a.ac_no, tone: 'compact', onTap: () => openAc(a.ac_no) })) };
  };
  const sides = groups.map(([side, title, sub]) => { const cs = codes.filter(c => sideOf(c) === side); if (!cs.length) return null;
    return { id: 's-' + side, title, sub, face: false, tone: TONE[side], badge: `<span>${seats(cs)} seats</span>`, kids: cs.map(partyNode) }; }).filter(Boolean);
  if (vacant) sides.push({ id: 's-vacant', title: 'Vacant seats', sub: DIR.acs.filter(a => a.status === 'vacant').map(a => a.name).join(', '), face: false, badge: `<span>${vacant}</span>` });
  $('#dirBody').innerHTML = `<p class="muted small">Every party with at least one seat in the 2026 Assembly, by side. Seat counts are current sitting MLAs. Tap the count under a card to open it, tap an MLA for their area.</p><div id="partyChart"></div>
    <p class="muted small">Sides as reported when the government was formed in May 2026. Alliances can shift, so report it if one looks out of date.</p>`;
  orgChart($('#partyChart'), [{ id: 'assembly', title: 'Tamil Nadu Legislative Assembly', sub: `234 seats · ${sitting.length} filled · majority 118`, face: false, tone: 'root',
    badge: `<span>Government side ${govSeats}</span><span>Opposition ${sitting.length - govSeats}</span>`, kids: sides }], { id: 'party', startOpen: ['assembly', 's-government'] });
}

/* ---------- one constituency ---------- */
async function openAc(ac) {
  show('scrAc');
  $('#acBody').innerHTML = loaderHtml('Opening...');
  try { await Promise.all([loadDirectory(), loadShapes()]); } catch (e) { $('#acBody').innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; return; }
  const a = DIR.byAc.get(ac); if (!a) { $('#acBody').innerHTML = '<div class="empty">Not found.</div>'; return; }
  const m = DIR.minByAc.get(ac), sh = DIR.shapes.find(x => x.ac === ac);
  // Frame the area in the strip of map above the sheet.
  if (map && sh) {
    const [x0, y0, x1, y1] = sh.box;
    setTimeout(() => { map.invalidateSize(); drawOutline(ac); hereAc = ac;
      map.flyToBounds([[y0, x0], [y1, x1]], { paddingTopLeft: [30, 30], paddingBottomRight: [30, Math.round(window.innerHeight * 0.6)], duration: 0.7, maxZoom: 15 }); }, 80);
  }
  const p = pin.getLatLng(), pinInside = acAt(p.lat, p.lng) === ac;
  const center = pinInside ? [p.lat, p.lng] : (sh ? interiorPoint(sh) : [p.lat, p.lng]);
  const src = (url, grade, date) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener">Source</a> · ${GRADE[grade] || ''} · checked ${esc(date)}` : '';
  const party = a.status === 'vacant' ? '' : `${esc(a.party)}${PARTY_NAME[a.party] ? ` (${esc(PARTY_NAME[a.party])})` : ''}`;
  const changed = a.party_2026 && a.party_2026 !== a.party ? `Elected in May 2026 as ${esc(a.party_2026)}.` : '';
  $('#acTitle').textContent = a.name;
  $('#acBody').innerHTML = `
    <h2 class="ps-name">${acTitle(a)}</h2>
    <div class="ps-sub">Assembly constituency ${a.ac_no} · <a href="#" class="dlink" data-dist="${esc(a.district)}">${esc(a.district)} district &#8250;</a></div>
    <div class="ps-sub"><span id="acBugLine">Counting bugs...</span></div>
    <div class="ps-sub ${a.status === 'vacant' ? '' : 'ps-side'}">${a.status === 'vacant' ? 'Seat vacant until the by-poll' : `${esc(a.mla_name)} · ${esc(a.party)} · ${esc(sideLabel(a))}`}</div>
    <div class="ps-acts">
      <button class="pa main" id="acReport"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>Report here</button>
      <button class="pa" id="acMap"><svg viewBox="0 0 24 24"><path d="M12 2C8 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3-7-7-7z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9" r="2.4" fill="currentColor"/></svg>Map</button>
      <button class="pa" id="acShare"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="19" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.3 10.8l7.4-4.4M8.3 13.2l7.4 4.4" stroke="currentColor" stroke-width="2"/></svg>Share</button>
      <a class="pa sos" href="tel:112"><svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z" fill="currentColor"/></svg>112</a>
    </div>

    <div class="ps-sec"><div class="ps-h">Bugs here</div><div id="acBugs" class="muted small">Loading...</div></div>

    <div class="ps-sec"><div class="ps-h">Latest news</div><div id="acNews" class="muted small">Loading news...</div></div>

    <div class="ps-sec"><div class="ps-h">Police stations nearby</div><div id="acPolice" class="muted small">Finding stations...</div></div>

    <div class="ps-sec"><div class="ps-h">Emergency and helplines</div>
      <div class="help-grid">
        <a href="tel:112"><b>112</b>Any emergency</a><a href="tel:100"><b>100</b>Police</a>
        <a href="tel:181"><b>181</b>Women helpline</a><a href="tel:1091"><b>1091</b>Women, police</a>
      </div>
      <div class="muted small" style="margin-top:8px">Tamil Nadu Police's Kavalan SOS app sends your location to the police in one tap.</div></div>

    <div class="ps-sec"><div class="ps-h">MLA</div>
      ${a.status === 'vacant' ? '' : `<img class="face" data-face="ac-${a.ac_no}" alt="" hidden>`}
      <div class="v vbig">${a.status === 'vacant' ? 'Seat vacant' : esc(a.mla_name)}</div>
      ${party ? `<div class="muted">${party}</div>` : ''}
      ${a.status_note ? `<p class="note">${esc(a.status_note)}</p>` : ''}${changed ? `<p class="note">${changed}</p>` : ''}
      <div id="acWiki"></div><div id="acAff"></div>
      <div class="src">${src(a.source_url, a.grade, a.checked_on)}</div></div>
    ${m ? `<div class="ps-sec"><div class="ps-h">Minister</div><div class="v">${esc(m.designation)}</div>
      <div class="muted small" style="margin-top:6px">Departments: ${esc(m.portfolios)}</div>
      <div class="src">${src(m.source_url, m.grade, m.checked_on)}</div></div>` : ''}
    ${lastWard && pinInside ? `<div class="ps-sec"><div class="ps-h">Local body at this spot</div><div class="v">${localLine(lastWard)}</div>
      ${lastWard.corp === 'TCMC' ? `${(c => c ? `<div style="margin-top:6px">Councillor <b>${esc(cleanName(c.name))}</b>${c.party ? ' · ' + esc(c.party) : ''}${c.phone ? ` · <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</div>` : '')(window.councillorFor && councillorFor('TCMC-' + lastWard.w))}
      <div class="muted small" style="margin-top:6px">Ward limits traced from the Tambaram Corporation's own city map, placed with OpenStreetMap roads. Good to about 10 metres, so a spot right on a ward border can show the ward next door.</div>`
      : '<div class="muted small" style="margin-top:6px">Ward and zone limits: Datameet / Transparent Chennai (CC BY-SA 2.5 India). May be older than the current zone layout.</div>'}</div>` : ''}
    <div class="ps-sec"><div class="ps-h">Who rules here</div>
      <div class="v">Government: TVK-led, Chief Minister C. Joseph Vijay</div>
      <div class="muted small">Lok Sabha: ${esc(a.pc_name)}. MP, councillors and local officers are being added.</div></div>
    <p class="muted small" style="margin:14px 0 0">Boundaries: Datameet (CC BY 2.5 India). Police stations: OpenStreetMap contributors.</p>
    <button class="cta static ghost" id="acIssue">Spot something wrong? Report it</button>`;
  $('#acMap').onclick = () => focusAc(ac);
  $('#acIssue').onclick = () => openIssue({ what: 'Area sheet', ac, ac_name: a.name, mla: a.mla_name });
  // Report in this area: at the pin if it is out and inside the area; at your own location if you are inside it;
  // otherwise the form opens with the map on this area, to tap the exact spot.
  $('#acReport').onclick = () => {
    const mine = here && here.acc <= ROUGH_M && acAt(here.lat, here.lng) === ac;
    const opt = pinShown && pinInside ? null : mine ? { gps: true } : { at: center };
    back(); setTimeout(() => startReport(opt), 120);
  };
  $('#acShare').onclick = async () => {
    const text = `${a.name} (AC ${a.ac_no}), ${a.district}. MLA: ${a.status === 'vacant' ? 'vacant' : `${a.mla_name} (${a.party})`}. Via TN Bug Sheet.`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Copied'); } } catch (_) {}
  };
  listBugs(ac);
  listNews(a);
  listPolice(center);
  if (window.fillFaces) fillFaces($('#acBody'));
  if (window.fillWiki && a.status !== 'vacant') fillWiki('ac-' + a.ac_no, $('#acWiki'));
  if (a.status !== 'vacant') fillAff(a.ac_no);
}
// Curated news: own-words summary and a link to the source. Area first, then district, then statewide.
async function listNews(a) {
  const box = $('#acNews'); if (!box) return;
  try {
    const { data, error } = await sb.from('news').select('id,title,summary,source_name,source_url,published_on,ac_nos,districts,statewide,hidden,departments,people,impact')
      .or(`ac_nos.cs.{${a.ac_no}},districts.cs.{"${a.district}"},statewide.eq.true`).order('published_on', { ascending: false, nullsFirst: false }).limit(12);
    if (error) throw error;
    // a story about named constituencies shows only there; the district tag counts only for district-wide stories (Sam, 27 Nov: Palar bridge showing in Pallavaram)
    const fits = n => (n.ac_nos || []).includes(a.ac_no) || n.statewide || (!(n.ac_nos || []).length && (n.districts || []).includes(a.district));
    const rank = n => (n.ac_nos || []).includes(a.ac_no) ? 0 : (n.districts || []).includes(a.district) ? 1 : 2;
    const list = (data || []).filter(fits).sort((x, y) => rank(x) - rank(y) || String(y.published_on).localeCompare(String(x.published_on))).slice(0, 6);
    if (!list.length) { box.textContent = 'No news collected for this area yet.'; return; }
    const isAdm = me && me.role === 'admin';
    const offs = await newsOfficers(list);
    const bugs = await areaBugs(a.ac_no);
    const tag = n => rank(n) === 0 ? '' : rank(n) === 1 ? `${esc(a.district)} district · ` : 'Across Tamil Nadu · ';
    box.innerHTML = list.map(n => `<div class="news-row${n.hidden ? ' hid' : ''}">
      <div class="nr-meta">${tag(n)}${esc(n.source_name)}${n.published_on ? ' · ' + new Date(n.published_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</div>
      <b>${esc(n.title)}</b><p>${esc(n.summary)}</p>${newsImpact(n, a, bugs)}${newsTags(n, offs)}
      <div class="nr-acts"><a href="${esc(n.source_url)}" target="_blank" rel="noopener">Read at source</a>${isAdm ? `<button data-hide="${n.id}" data-h="${n.hidden ? 0 : 1}">${n.hidden ? 'Show again' : 'Hide'}</button>` : ''}</div></div>`).join('')
      + '<div class="muted small" style="margin-top:6px">Summaries are written for this app; tap through for the full story.</div>';
    box.querySelectorAll('[data-hide]').forEach(b => b.onclick = async () => {
      const { error: e } = await sb.from('news').update({ hidden: b.dataset.h === '1' }).eq('id', b.dataset.hide);
      if (e) toast(e.message); else listNews(a);
    });
    if (window.fillFaces) fillFaces(box);
    box.querySelectorAll('[data-nac]').forEach(b => b.onclick = () => openAc(+b.dataset.nac));
    box.querySelectorAll('[data-nbugs]').forEach(b => b.onclick = () => { const el = document.getElementById('acBugs'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    box.querySelectorAll('[data-nq]').forEach(b => b.onclick = () => dirJump(b.dataset.nt, b.dataset.nq));
  } catch (e) { box.textContent = 'Could not load news right now.'; }
}
/* What a story means for this place: kind, timing, what it touches, one plain line, and the open bugs it relates to. */
const IMPACT_KIND = { improvement: ['Improvement', 'ok'], disruption: ['Disruption', 'warn'], problem: ['Problem', 'bad'], plan: ['Plan', 'info'], accountability: ['Accountability', 'acc'], demand: ['Public demand', 'mute'] };
const IMPACT_WHEN = { now: 'Now', soon: 'Next few months', long: 'Long term', past: 'Already happened' };
const IMPACT_SECTOR = { road: 'Roads', light: 'Streetlights', garbage: 'Garbage', drain: 'Drains', water: 'Water and sewage', power: 'Power', transport: 'Transport', health: 'Health', safety: 'Safety', governance: 'Officials', jobs: 'Jobs', housing: 'Housing' };
const SECTOR_CATS = { road: ['road'], light: ['light'], garbage: ['garbage'], drain: ['drain'], water: ['water'], power: ['power', 'wires'], safety: ['women'] };
async function areaBugs(ac) {
  try {
    if (!areaBugs.all) areaBugs.all = bugPoints();
    return (await areaBugs.all).filter(b => b.lat && OPEN_ST(b.status) && acAt(b.lat, b.lng) === ac);
  } catch (_) { return []; }
}
function newsImpact(n, a, bugs) {
  const i = n.impact; if (!i || !i.line) return '';
  const [kl, kc] = IMPACT_KIND[i.kind] || ['Impact', 'mute'];
  const cats = [...new Set((i.sectors || []).flatMap(s => SECTOR_CATS[s] || []))];
  const rel = cats.length ? bugs.filter(b => cats.includes(b.category) && (i.when !== 'past' || !n.published_on || String(b.reported_at) >= n.published_on)) : [];
  return `<div class="impact ${kc}"><div class="im-h"><span class="im-k">${kl}</span><span class="im-w">${IMPACT_WHEN[i.when] || ''}</span></div>
    <div class="im-l">${esc(i.line)}</div>
    ${(i.sectors || []).length ? `<div class="im-s">${i.sectors.map(s => `<span>${esc(IMPACT_SECTOR[s] || s)}</span>`).join('')}</div>` : ''}
    ${rel.length ? `<button class="im-b" data-nbugs="1">${rel.length} open bug${rel.length === 1 ? '' : 's'} here relate${rel.length === 1 ? 's' : ''} to this</button>` : ''}
    <div class="im-by">What it means here · our reading, not the source's words</div></div>`;
}
window.newsImpact = newsImpact;
// News tags: offices (departments) and the people who answer for them - minister, area MLA, officers.
async function newsOfficers(list) {
  const ids = [...new Set(list.flatMap(n => (n.people || []).filter(k => k.startsWith('off-')).map(k => k.slice(4))))];
  if (!ids.length) return new Map();
  if (OFF) return new Map(OFF.filter(o => ids.includes(o.id)).map(o => [o.id, o]));
  const { data } = await sb.from('officers').select('id,post,name').in('id', ids);
  return new Map((data || []).map(o => [o.id, o]));
}
function newsTags(n, offs) {
  const d = n.departments || [], p = n.people || [];
  if (!d.length && !p.length) return '';
  const short = s => String(s || '').split(',')[0];
  const ppl = p.map(k => {
    if (k.startsWith('ac-')) {
      const no = +k.slice(3), a = DIR.byAc && DIR.byAc.get(no), m = DIR.minByAc && DIR.minByAc.get(no);
      if (!a) return '';
      if (a.status === 'vacant') return `<button class="nt p" data-nac="${no}">${esc(a.name)} MLA (vacant)</button>`;
      const local = (n.ac_nos || []).includes(no); // tagged because the story is in their constituency
      const role = local || !m ? 'MLA, ' + esc(a.name) : /chief minister/i.test(m.designation) ? 'CM' : 'Minister';
      return `<button class="nt p" data-nac="${no}">${avatar(k, a.mla_name)}<span>${esc(a.mla_name)} <i>${role}</i></span></button>`;
    }
    if (k.startsWith('off-')) { const o = offs.get(k.slice(4)); if (!o) return '';
      return `<button class="nt p" data-nt="off" data-nq="${esc(o.name || short(o.post))}"><span>${esc(o.name || 'Post')} <i>${esc(short(o.post))}</i></span></button>`; }
    return '';
  }).join('');
  const dep = d.map(x => `<button class="nt d" data-nt="min" data-nq="${esc(x)}">${esc(x)}</button>`).join('');
  return `<div class="ntags">${dep}${ppl}</div>`;
}
// Jump into Who's who with a search filled in. Departments search ministers by portfolio words.
function dirJump(tab, q) {
  let words = q;
  if (tab === 'min') {
    const port = norm((DIR.mins || []).map(m => m.portfolios + ' ' + m.designation).join(' '));
    const keep = norm(q.replace(/\(.*?\)/g, '')).split(' ').filter(w => w.length > 3 && !/^(city|corporation|district|limited)$/.test(w) && port.includes(w));
    if (!keep.length) { toast(`No minister lists "${q}" yet`); return; }
    words = keep.slice(0, 2).join(' ');
  }
  back(); openDirectory().then(() => { dirTab = tab; dirQ = words; const i = $('#dirSearch'); if (i) i.value = words; renderDir(); });
}
const OPEN_ST = s => !['resolved', 'closed', 'rejected', 'duplicate'].includes(s);
const ST_TXT = { submitted: 'Waiting for check', approved: 'Approved', routed: 'Routed', filed: 'Complaint filed', escalated: 'Escalated', legal: 'Legal', resolved: 'Fixed', closed: 'Closed', rejected: 'Rejected', duplicate: 'Duplicate' };
async function listBugs(ac) {
  const box = $('#acBugs'), line = $('#acBugLine');
  try {
    const [data] = await Promise.all([bugPoints(), pilotOn()]);
    const here = (data || []).filter(r => acAt(r.lat, r.lng) === ac);
    const open = here.filter(r => OPEN_ST(r.status));
    const yours = me && !['admin', 'rm'].includes(me.role) && !PILOT.on ? ' (yours and public reporters)' : '';
    if (line) line.textContent = here.length ? `${open.length} open bug${open.length === 1 ? '' : 's'} · ${here.length} reported${yours}` : `No bugs reported yet${yours}`;
    if (!box) return;
    if (!here.length) { box.textContent = 'Nothing reported here yet. Spot something? Tap Report here.'; return; }
    const RANK = { urgent: 0, high: 1 };
    const womenFirst = typeof PROF !== 'undefined' && PROF.row && PROF.row.gender === 'female';
    here.sort((x, y) => (OPEN_ST(y.status) - OPEN_ST(x.status)) || (womenFirst ? (y.category === 'women') - (x.category === 'women') : 0) || ((RANK[x.priority] ?? 2) - (RANK[y.priority] ?? 2)));
    box.innerHTML = here.slice(0, 8).map(r => { const c = catOf(r.category); return `
      <button class="bug-row" data-id="${esc(r.id)}"><span class="br-ic">${c.icon}</span>
        <span class="br-t"><b>${r.priority && r.priority !== 'normal' ? `<span class="pri ${r.priority}">${r.priority === 'urgent' ? 'Urgent' : 'High'}</span> ` : ''}${esc(c.name)}</b>
        <span>${ST_TXT[r.status] || r.status} · ${new Date(r.received_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></span></button>`; }).join('')
      + (here.length > 8 ? `<div class="muted small" style="margin-top:6px">and ${here.length - 8} more</div>` : '');
    box.querySelectorAll('.bug-row').forEach(b => b.onclick = () => {
      if (me && me.role === 'admin' && window.openReview) openReview(b.dataset.id);
      else { const r = here.find(x => x.id === b.dataset.id); if (!r) return; if (r.mine) { if (window.openOne && db) db.get(r.id).then(x => x ? openOne(r.id) : focusPlace(r.lat, r.lng, 18)); else focusPlace(r.lat, r.lng, 18); } else openPublicReport(r.id); }
    });
  } catch (e) { if (line) line.textContent = ''; if (box) box.textContent = 'Could not load bugs right now.'; }
}
// Police stations from OpenStreetMap, fetched on the phone. Many stations have no phone number in OSM yet.
async function listPolice([lat, lng]) {
  const box = $('#acPolice'); if (!box) return;
  const q = `[out:json][timeout:20];(node["amenity"="police"](around:6000,${lat},${lng});way["amenity"="police"](around:6000,${lat},${lng}););out center tags 30;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!res.ok) throw new Error(res.status);
    const j = await res.json();
    const km = (a, b, c, d) => { const R = 6371, t = Math.PI / 180, x = (d - b) * t * Math.cos((a + c) / 2 * t), y = (c - a) * t; return R * Math.hypot(x, y); };
    const list = j.elements.map(e => { const la = e.lat ?? e.center?.lat, ln = e.lon ?? e.center?.lon, t = e.tags || {};
      return { la, ln, name: t.name || t['name:en'] || 'Police station', ta: t['name:ta'] || '', phone: (t.phone || t['contact:phone'] || '').split(';')[0].trim(), d: km(lat, lng, la, ln) }; })
      .filter(x => x.la != null).sort((x, y) => x.d - y.d).slice(0, 6);
    if (!list.length) { box.textContent = 'No police station mapped within 6 km. Call 100 or 112.'; return; }
    box.innerHTML = list.map(x => `<div class="pol-row"><div class="pr-t"><b>${esc(x.name)}</b>${x.ta && x.ta !== x.name ? `<span>${esc(x.ta)}</span>` : ''}<span>${x.d.toFixed(1)} km away${x.phone ? '' : ' · number not listed yet'}</span></div>
      ${x.phone ? `<a class="pr-btn call" href="tel:${esc(x.phone.replace(/[^\d+]/g, ''))}" aria-label="Call">Call</a>` : ''}
      <a class="pr-btn" href="https://www.google.com/maps/dir/?api=1&destination=${x.la},${x.ln}" target="_blank" rel="noopener" aria-label="Directions">Go</a></div>`).join('');
  } catch (e) { box.innerHTML = 'Could not reach the station map right now. For help call <a href="tel:100">100</a> or <a href="tel:112">112</a>.'; }
}
/* ---------- map search: constituencies, MLAs, districts, wards, then any place (OpenStreetMap) ---------- */
let msTimer = null, msSeq = 0;
function closeSearch() { const r = $('#msResults'); if (r) r.hidden = true; }
function localMatches(q) {
  const n = norm(q).trim(); if (!n || !DIR.acs) return [];
  const words = n.split(' '), hit = h => words.every(w => h.includes(w)), out = [];
  const wm = n.match(/^(?:ward\s*)?(\d{1,3})$/);
  if (wm && LOCAL.wards) {
    const pp = pin ? pin.getLatLng() : null, far = w => pp ? Math.hypot((w.box[0] + w.box[2]) / 2 - pp.lng, (w.box[1] + w.box[3]) / 2 - pp.lat) : 0;
    LOCAL.wards.filter(w => String(w.w) === wm[1] && w.zn !== '-').sort((x, y) => far(x) - far(y)).forEach(w => out.push({ kind: 'ward', w, t: `Ward ${w.w}`, s: `${corpOf(w)} · ${zoneLabel(w)}` }));
  }
  DIR.acs.forEach(a => {
    if (hit(norm([a.ac_no, a.name, a.mla_name, a.party, a.district].join(' ')))) out.push({ kind: 'ac', ac: a.ac_no, t: `${a.name}${a.reserved ? ` (${a.reserved})` : ''}`, s: `Constituency ${a.ac_no} · ${a.district} · ${a.status === 'vacant' ? 'vacant' : `${a.mla_name}, ${a.party}`}` });
  });
  const dists = [...new Set(DIR.acs.map(a => a.district))].filter(d => hit(norm(d)));
  dists.forEach(d => out.push({ kind: 'district', d, t: `${d} district`, s: `${DIR.acs.filter(a => a.district === d).length} constituencies` }));
  if (LOCAL.wards && /zone/.test(n)) [...new Map(LOCAL.wards.map(w => [w.corp + w.zn, w])).values()].filter(w => w.zn !== '-' && hit(norm(`${zoneLabel(w)} ${corpOf(w)}`))).forEach(w => out.push({ kind: 'zone', zn: w.zn, corp: w.corp, t: zoneLabel(w), s: corpOf(w) }));
  return out.slice(0, 8);
}
function renderResults(local, places, q) {
  const r = $('#msResults');
  const rows = [...local.map((x, i) => `<button class="ms-row" data-i="l${i}"><b>${esc(x.t)}</b><span>${esc(x.s)}</span></button>`),
    ...places.map((x, i) => `<button class="ms-row" data-i="p${i}"><b>${esc(x.t)}</b><span>${esc(x.s)}</span></button>`)];
  r.innerHTML = rows.length ? rows.join('') + (places.length ? '<div class="ms-foot">Places: OpenStreetMap Nominatim</div>' : '')
    : `<div class="ms-empty">${q.length < 3 ? 'Keep typing...' : 'No match yet...'}</div>`;
  r.hidden = false;
  r.querySelectorAll('.ms-row').forEach(b => b.onclick = () => {
    const k = b.dataset.i, x = k[0] === 'l' ? local[+k.slice(1)] : places[+k.slice(1)];
    closeSearch(); $('#mapSearch').blur(); $('#mapSearch').value = x.t; $('#msClear').hidden = false;
    pickResult(x);
  });
}
async function pickResult(x) {
  if (x.kind === 'ac') return focusAc(x.ac);
  if (x.kind === 'ward') return focusShape(x.w, true);
  if (x.kind === 'place') { drawWard(null); return focusPlace(x.lat, x.lng, x.zoom); }
  await loadShapes();
  const shapes = x.kind === 'district' ? DIR.shapes.filter(s => (DIR.byAc.get(s.ac) || {}).district === x.d) : LOCAL.wards.filter(w => w.zn === x.zn && w.corp === x.corp);
  if (!shapes.length) return;
  const box = shapes.reduce((b, s) => [Math.min(b[0], s.box[0]), Math.min(b[1], s.box[1]), Math.max(b[2], s.box[2]), Math.max(b[3], s.box[3])], [180, 90, -180, -90]);
  show('scrMap'); map.invalidateSize();
  map.flyToBounds([[box[1], box[0]], [box[3], box[2]]], { padding: [30, 30], duration: 0.8 });
  if (outline) { map.removeLayer(outline); outline = null; }
  drawWard(null);
  outline = L.featureGroup(shapes.map(s => L.polygon(toLatLngs(s.polys), { color: '#e8475f', weight: 1.5, fillColor: '#e8475f', fillOpacity: 0.06, interactive: false }))).addTo(map);
  hereAc = -1;
}
async function placeSearch(q, seq) {
  // Nominatim: free, 1 request a second at most, so only after a pause in typing.
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&viewbox=76.2,13.6,80.4,8.0&bounded=1&q=' + encodeURIComponent(q);
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok || seq !== msSeq) return [];
    const js = await res.json();
    return js.map(p => ({ kind: 'place', lat: +p.lat, lng: +p.lon, t: p.name || p.display_name.split(',')[0],
      s: p.display_name.split(',').slice(1, 4).join(',').trim(), zoom: p.addresstype === 'road' || p.class === 'amenity' || p.class === 'shop' ? 17 : 15 }));
  } catch (_) { return []; }
}
(function bindSearch() {
  const inp = $('#mapSearch'); if (!inp) return;
  inp.addEventListener('input', () => {
    const q = inp.value.trim(); $('#msClear').hidden = !q;
    clearTimeout(msTimer); const seq = ++msSeq;
    if (!q) return closeSearch();
    Promise.all([loadDirectory().catch(() => {}), loadLocal().catch(() => {})]).then(() => {
      if (seq !== msSeq) return;
      const local = localMatches(q); renderResults(local, [], q);
      if (q.length >= 3) msTimer = setTimeout(async () => { const pl = await placeSearch(q, seq); if (seq === msSeq) renderResults(local, pl, q); }, 650);
    });
  });
  inp.addEventListener('focus', () => { if (inp.value.trim()) inp.dispatchEvent(new Event('input')); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const f = $('#msResults .ms-row'); if (f) f.click(); } });
  $('#msClear').onclick = () => { inp.value = ''; $('#msClear').hidden = true; closeSearch(); drawWard(null); inp.focus(); };
})();
window.openDirectory = openDirectory; window.openAc = openAc; window.updateHereCard = updateHereCard;

/* ---------- officers tree: posts first, the current holder second (they change with transfers) ---------- */
const OFFB = [['civil', 'Administration (IAS)', 'Chief Secretary, collectors and their offices'], ['police', 'Police (IPS)', 'DGP, commissioners, SPs, then DCs, ACs, inspectors and SIs'], ['local', 'Local bodies', 'Corporation and municipal commissioners']];
let OFF = null; const offOpen = new Set();
async function loadOff() { if (OFF) return OFF; const { data, error } = await sb.from('officers').select('*').order('sort'); if (error) throw error; OFF = data || []; return OFF; }
const offShort = o => String(o.post || '').replace(/^Inspector of Police, /, '').replace(/ Police Station$/, '');
function phoneBadge(o) {
  if (!o.phone) return '<span>No number yet</span>';
  if (o.verified) return '<span class="ok">Number checked</span>';
  return o.phone_kind === 'official' ? '<span>Official site</span>' : '<span class="warn">Unverified number</span>';
}
function offNode(o, kids) {
  const insp = o.rank === 'Inspector';
  return { id: o.id, title: insp ? offShort(o) : (o.name || o.post), sub: insp ? (o.name || 'Police station') : (o.name ? o.post : 'Name not added yet'),
    face: 'off-' + o.id, fallback: (o.name || o.area || o.post || '?')[0], tone: insp ? 'compact' : '',
    badge: (o.service && !insp ? `<span>${esc(o.service)}</span>` : '') + phoneBadge(o),
    kids: () => kids(o.id).map(k => offNode(k, kids)), onTap: () => offDetail(o) };
}
async function renderOfficers() {
  if (!OFF) { $('#dirBody').innerHTML = loaderHtml('Loading officers...'); try { await loadOff(); } catch (e) { $('#dirBody').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; } }
  const kids = id => OFF.filter(o => (o.parent_id || null) === id);
  const q = norm(dirQ).trim(), words = q ? q.split(' ') : [];
  if (words.length) {
    const hits = OFF.filter(o => words.every(w => norm([o.post, o.name, o.area, o.district, o.rank, o.phone].join(' ')).includes(w))).slice(0, 60);
    $('#dirBody').innerHTML = `<p class="muted small">${hits.length} match${hits.length === 1 ? '' : 'es'}</p>` + hits.map(o => `<button class="item dir" data-off="${o.id}">${avatar('off-' + o.id, o.name || o.post, (o.name || o.area || '?')[0])}<div class="t">
      <div>${esc(o.name || offShort(o))}</div><div class="muted small">${esc(o.post)}</div><div class="oc-b" style="justify-content:flex-start">${phoneBadge(o)}</div></div></button>`).join('');
    $('#dirBody').querySelectorAll('[data-off]').forEach(b => b.onclick = () => offDetail(OFF.find(o => o.id === b.dataset.off)));
    if (window.fillFaces) fillFaces($('#dirBody'));
    return;
  }
  const branches = OFFB.map(([b, t, sub]) => ({ id: 'b-' + b, title: t, sub, face: false, kids: () => OFF.filter(o => o.branch === b && !o.parent_id).map(o => offNode(o, kids)) })).filter(n => n.kids().length);
  $('#dirBody').innerHTML = `<p class="muted small">Government yellow pages. Tap a card for numbers, tap the count under it to open the posts below. Posts stay, officers move: every entry shows where it came from.</p><div id="offChart"></div>`;
  orgChart($('#offChart'), [{ id: 'gov', title: 'Government of Tamil Nadu', sub: 'Administration, police and local bodies', face: false, tone: 'root', kids: branches }],
    { id: 'off', startOpen: ['gov'] });
}
function offDetail(o) {
  if (!o) return;
  const staff = me && ['admin', 'rm'].includes(typeof eff === 'function' ? eff().role : me.role);
  const nums = (o.phone || '').split(/[,/]/).map(n => n.trim()).filter(Boolean);
  const state = !o.phone ? 'No number added yet.' : o.verified ? `Checked${o.verified_by ? ' by ' + esc(o.verified_by.split('@')[0]) : ''}${o.verified_at ? ' on ' + new Date(o.verified_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}.`
    : o.phone_kind === 'official' ? 'From the official website. Not yet checked by calling.' : 'From a public phone directory. Not checked yet, it may be old.';
  $('#mTitle').textContent = o.name || offShort(o);
  $('#mBody').innerHTML = `<div class="muted">${esc(o.post)}</div>
    ${nums.length ? `<div style="margin:12px 0;display:flex;flex-direction:column;gap:8px">${nums.map(n => `<a class="pr-btn call" style="justify-content:center;height:42px" href="tel:${esc(n.replace(/[^0-9+]/g, ''))}">Call ${esc(n)}</a>`).join('')}</div>` : ''}
    ${o.email ? `<p><a href="mailto:${esc(o.email)}">${esc(o.email)}</a></p>` : ''}
    <p class="small ${o.verified ? '' : 'muted'}">${state}</p>
    ${o.note ? `<p class="note">${esc(o.note)}</p>` : ''}
    <div data-wiki="off-${o.id}"></div>
    <p class="src small">${o.phone_source ? `<a href="${esc(o.phone_source)}" target="_blank" rel="noopener">Number source</a> · ` : ''}${o.source_url ? `<a href="${esc(o.source_url)}" target="_blank" rel="noopener">Post source</a> · ` : ''}checked ${esc(o.checked_on || '-')}</p>`;
  if (window.fillWiki) fillWiki('off-' + o.id, $('#mBody [data-wiki]'));
  const close = () => $('#modal').classList.remove('on');
  $('#mCancel').textContent = 'Close'; $('#mCancel').onclick = close;
  $('#mOk').hidden = !(staff && o.phone && !o.verified);
  $('#mOk').disabled = false; $('#mOk').textContent = 'I called, it works';
  $('#mOk').onclick = async () => {
    $('#mOk').disabled = true;
    const patch = { verified: true, verified_by: me.email, verified_at: new Date().toISOString() };
    const { error } = await sb.rpc('mark_officer_verified', { p_id: o.id });
    if (error) { toast(error.message); $('#mOk').disabled = false; return; }
    Object.assign(o, patch); toast('Marked as checked'); close(); $('#mOk').hidden = false; renderDirSafe();
  };
  const oldCancel = $('#mCancel').onclick; $('#mCancel').onclick = () => { $('#mOk').hidden = false; oldCancel(); };
  $('#modal').classList.add('on');
}
function renderDirSafe() { if ($('#scrDir').classList.contains('on')) renderDir(); if ($('#scrDist') && $('#scrDist').classList.contains('on') && DIST.name) openDistrict(DIST.name, true); }

/* 2026 election affidavit (self-declared assets and criminal cases), via ADR's analysis of winners.
   Staff see it as a preview until the admin spot-checks it; the policy shows verified rows to everyone. */
const inr = n => n >= 1e7 ? `₹${(n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} crore` : n >= 1e5 ? `₹${(n / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 })} lakh` : `₹${n.toLocaleString('en-IN')}`;
async function fillAff(ac) {
  const el = $('#acAff'); if (!el) return;
  const { data: f } = await sb.from('mla_affidavits').select('*').eq('ac_no', ac).maybeSingle();
  if (!f || !$('#acAff')) return;
  el.innerHTML = `<div class="aff"><div class="aff-h">From their 2026 election affidavit${f.verified ? '' : ' <span class="tag pending">staff preview, not yet checked</span>'}</div>
    <div class="aff-g"><div><b>${f.assets_rs != null ? inr(f.assets_rs) : '-'}</b><span>declared assets</span></div>
    <div><b>${f.criminal_cases != null ? f.criminal_cases : 'None listed'}</b><span>declared criminal cases</span></div></div>
    <div class="muted small">Self-declared by the candidate under oath. A case is not a conviction.</div>
    <div class="src"><a href="${esc(f.source_url)}" target="_blank" rel="noopener">ADR analysis</a> · <a href="${esc(f.affidavit_url)}" target="_blank" rel="noopener">ECI affidavit portal</a> · checked ${esc(f.checked_on)}</div></div>`;
}

/* ---------- area sheet: swipe up for full height, down to shrink or close ---------- */
(function sheetDrag() {
  const sh = $('#scrAc'), body = $('#acBody'), grab = sh.querySelector('.ps-grab');
  const full = on => { sh.classList.toggle('full', on); if (!on) body.scrollTop = 0; };
  // only touch the class when it is actually set: removing a missing class still counts as a change and would re-trigger this forever
  new MutationObserver(() => { if (!sh.classList.contains('on')) { if (sh.classList.contains('full')) sh.classList.remove('full'); if (sh.style.transform) sh.style.transform = ''; } })
    .observe(sh, { attributes: true, attributeFilter: ['class'] });
  // Scrolling the content up also opens it fully.
  body.addEventListener('scroll', () => { if (body.scrollTop > 24 && !sh.classList.contains('full')) full(true); }, { passive: true });
  let y0 = null, dy = 0, fromTop = false;
  const start = e => { const t = e.touches ? e.touches[0] : e; const r = sh.getBoundingClientRect();
    fromTop = t.clientY - r.top < 56 || e.target === grab;
    if (!fromTop && body.scrollTop > 0) return;   // let the list scroll normally
    y0 = t.clientY; dy = 0; sh.style.transition = 'none'; };
  const move = e => { if (y0 == null) return; const t = e.touches ? e.touches[0] : e; dy = t.clientY - y0;
    if (!fromTop && dy < 0) { y0 = null; sh.style.transform = ''; return; }   // upward drag on content = scroll
    sh.style.transform = `translateY(${Math.max(dy, sh.classList.contains('full') ? 0 : -window.innerHeight * 0.3)}px)`; };
  const end = () => { if (y0 == null) return; y0 = null; sh.style.transition = ''; sh.style.transform = '';
    const isFull = sh.classList.contains('full');
    if (dy < -40) full(true);
    else if (dy > 80) { if (isFull) full(false); else back(); } };
  sh.addEventListener('touchstart', start, { passive: true });
  sh.addEventListener('touchmove', move, { passive: true });
  sh.addEventListener('touchend', end);
  grab.addEventListener('click', () => full(!sh.classList.contains('full')));
})();

/* ---------- district page: officers, police stations, offices ---------- */
const DIST = { name: null };
async function openDistrict(name, again = false) {
  DIST.name = name;
  if (!again) show('scrDist');
  $('#distTitle').textContent = name + ' district';
  const box = $('#distBody'); box.innerHTML = loaderHtml('Loading ' + name + '...');
  try { await Promise.all([loadDirectory(), loadOff()]); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; return; }
  const acs = DIR.acs.filter(a => a.district === name);
  const set = OFF.filter(o => o.district === name), ids = new Set(set.map(o => o.id));
  const kids = id => set.filter(o => o.parent_id === id);
  const roots = set.filter(o => !o.parent_id || !ids.has(o.parent_id));
  const branches = OFFB.map(([b, t, sub]) => { const top = roots.filter(o => o.branch === b); if (!top.length) return null;
    return { id: 'd-' + b, title: t.replace(/ \(.*\)/, ''), sub: top.length + (top.length === 1 ? ' office' : ' offices') + ' at the top', face: false, kids: top.map(o => offNode(o, kids)) }; }).filter(Boolean);
  const stations = set.filter(o => o.rank === 'Inspector');
  const withNo = stations.filter(o => o.phone).length;
  const byParent = new Map(); stations.forEach(o => { const k = o.parent_id || ''; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(o); });
  const parentName = id => { const p = OFF.find(o => o.id === id); return p ? (p.name ? `${p.post} (${p.name})` : p.post) : 'Other'; };
  const offices = set.filter(o => o.rank !== 'Inspector' && o.phone);
  const row = o => { const n = (o.phone || '').split(/[,/]/)[0].trim();
    return `<div class="pol-row"><button class="pr-t" data-off="${o.id}" style="text-align:left"><b>${esc(o.rank === 'Inspector' ? offShort(o) : (o.name ? o.post : o.post))}</b>
      <span class="small muted">${o.rank === 'Inspector' ? (o.name ? esc(o.name) + ' · ' : '') : (o.name ? esc(o.name) + ' · ' : '')}${n ? (o.verified ? 'checked' : o.phone_kind === 'official' ? 'official site' : 'unverified') : 'number not listed yet'}</span></button>
      ${n ? `<a class="pr-btn call" href="tel:${esc(n.replace(/[^0-9+]/g, ''))}">Call</a>` : ''}</div>`; };
  box.innerHTML = `
    <p class="muted small" style="margin-top:0">${acs.length} assembly constituencies · ${set.length} offices and posts on file · ${withNo} of ${stations.length} police stations have a number</p>
    <div class="ntags" style="margin-bottom:6px">${acs.map(a => `<button class="nt p" data-nac="${a.ac_no}">${esc(a.name)} <i>${a.status === 'vacant' ? 'vacant' : esc(a.mla_name)}</i></button>`).join('')}</div>
    ${branches.length ? `<h3>Who runs ${esc(name)}</h3><div id="distChart"></div>` : `<div class="empty">No district officers on file for ${esc(name)} yet. Chennai and Chengalpattu come first, then Kanchipuram and Tiruvallur.</div>`}
    ${offices.length ? `<h3>Offices with a number</h3><div class="ps-sec" style="border:0;padding-top:0">${offices.map(row).join('')}</div>` : ''}
    ${stations.length ? `<h3>Police stations <span class="ta">${stations.length}</span></h3>
      ${[...byParent].map(([pid, list]) => `<div class="ps-sec"><div class="ps-h small">${esc(parentName(pid))}</div>${list.map(row).join('')}</div>`).join('')}` : ''}
    <p class="muted small">Numbers marked unverified come from public phone directories and may be old. Called one and it worked? Open it and tap "I called, it works". Wrong? Report it from the area sheet.</p>`;
  if (branches.length) orgChart($('#distChart'), [{ id: 'dist', title: name + ' district', sub: acs.length + ' constituencies', face: false, tone: 'root', kids: branches }], { id: 'dist-' + name, startOpen: ['dist', ...branches.map(b => b.id)] });
  box.querySelectorAll('[data-off]').forEach(b => b.onclick = () => offDetail(OFF.find(o => o.id === b.dataset.off)));
  box.querySelectorAll('[data-nac]').forEach(b => b.onclick = () => openAc(+b.dataset.nac));
}
document.addEventListener('click', e => { const d = e.target.closest('[data-dist]'); if (!d) return; e.preventDefault(); e.stopPropagation(); openDistrict(d.dataset.dist); }, true);
