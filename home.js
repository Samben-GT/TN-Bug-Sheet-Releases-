/* Home dashboard: the app opens here. It shows the reporter's home area straight away (no GPS wait, works offline),
   and offers a one-tap switch when GPS says they are somewhere else. Switching lasts for this session only. */
const HOME = { bugs: null, news: null, pol: null, polKey: '', seq: 0, view: null };
const IC = {
  bug: '<path d="M8 8a4 4 0 018 0v1H8z M6 10h12v4a6 6 0 01-12 0z M12 10v10 M3 13h3M18 13h3M4 8l2.5 1.5M20 8l-2.5 1.5M4 19l2.5-2M20 19l-2.5-2"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 01-2-2z M17 9h3v8a2 2 0 01-2 2 M7 9h7M7 12h7M7 15h4"/>',
  mla: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/>',
  mp: '<path d="M3 20h18M5 20V10M9 20V10M15 20V10M19 20V10M2 10h20L12 4z"/>',
  police: '<path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6z M9.5 11.5l2 2 3.5-4"/>',
  office: '<path d="M4 20V8l8-4 8 4v12 M9 20v-5h6v5 M8 10h1M11.5 10h1M15 10h1"/>',
  phone: '<path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/>',
  map: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  atlas: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14"/>',
  who: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.5a3 3 0 010 5.6M18 14.8c1.8.7 3 2.5 3 5.2"/>',
  mine: '<path d="M6 3h9l4 4v14H6z M9 12h7M9 16h5"/>',
  work: '<path d="M9 6h11M9 12h11M9 18h11 M3.5 6l1.2 1.2L7 5M3.5 12l1.2 1.2L7 11M3.5 18l1.2 1.2L7 17"/>',
  law: '<path d="M12 4v16M6 20h12M5 8h14M7 8l-3 6a3 3 0 006 0zM17 8l-3 6a3 3 0 006 0z"/>',
  admin: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/>',
};
const ico = k => `<svg viewBox="0 0 24 24" class="ht-i">${IC[k]}</svg>`;

function openHome(push = true) { show('scrHome', push); return renderHome(); }

async function renderHome() {
  if (!me || !$('#scrHome').classList.contains('on')) return;
  const seq = ++HOME.seq, box = $('#homeBody');
  try { await Promise.all([loadShapes(), loadDirectory()]); } catch (_) {}
  if (seq !== HOME.seq) return;
  if (window.loadProfile) await loadProfile();
  if (seq !== HOME.seq) return;
  const gpsAc = here && here.acc <= ROUGH_M ? acAt(here.lat, here.lng) : null; // only a decent fix counts
  const pinP = pin ? pin.getLatLng() : null, pinAc = pinP ? acAt(pinP.lat, pinP.lng) : null;
  const home = window.homeAc ? homeAc() : null;
  const ac = HOME.view || home || gpsAc || pinAc, a = ac && DIR.byAc.get(ac);
  const p = !ac ? null : ac === gpsAc ? { lat: here.lat, lng: here.lng } : ac === pinAc ? pinP : (pt => pt && { lat: pt[0], lng: pt[1] })(acPoint(ac));
  const ward = p && ac === gpsAc && typeof wardAt === 'function' ? wardAt(p.lat, p.lng) : null;
  // the ward maps load in the background; once they are in, draw Home again so the ward and councillor show
  if (typeof LOCAL !== 'undefined' && !LOCAL.wards && window.loadLocal) loadLocal().then(() => { if (seq === HOME.seq) renderHome(); }).catch(() => {});
  const tag = ac && ac === home ? 'Your area' : ac && ac === gpsAc ? 'You are here' : '';
  const sw = gpsAc && gpsAc !== ac && DIR.byAc.get(gpsAc) ? `<button class="h-switch" data-h="switch-gps">You are in <b>${esc(DIR.byAc.get(gpsAc).name)}</b> now. Switch</button>`
    : home && ac !== home && DIR.byAc.get(home) ? `<button class="h-switch" data-h="switch-home">Back to your area, <b>${esc(DIR.byAc.get(home).name)}</b></button>`
    : !home ? `<button class="h-switch" data-h="profile">Set your home area so this opens on it</button>` : '';
  const dist = a ? a.district : null;
  // counts (cached for the session, refreshed by renderHome(true) after a report)
  if (!HOME.bugs) { HOME.bugs = bugPoints().catch(() => []); }
  if (!HOME.news) { HOME.news = sb.from('news').select('ac_nos,districts,statewide,published_on').eq('hidden', false).then(r => r.data || []).catch(() => []); }
  if (!HOME.mps) { HOME.mps = sb.from('mps').select('pc_name,mp_name,party,source_url,checked_on').then(r => new Map((r.data || []).map(m => [m.pc_name, m]))).catch(() => new Map()); }
  const [bugs, news, mps] = await Promise.all([HOME.bugs, HOME.news, HOME.mps, window.loadCouncillors ? loadCouncillors() : null]);
  if (seq !== HOME.seq) return;
  const inAc = bugs.filter(b => b.lat && acAt(b.lat, b.lng) === ac);
  const open = inAc.filter(b => OPEN_ST(b.status)).length, fixed = inAc.length - open;
  const nHere = news.filter(n => (n.ac_nos || []).includes(ac) || (dist && !(n.ac_nos || []).length && (n.districts || []).includes(dist))).length;
  const offN = typeof OFF !== 'undefined' && OFF ? OFF.filter(o => o.district === dist).length : null;
  const role = typeof eff === 'function' ? eff().role : me.role;
  const mineN = +($('#cnt').textContent || 0), workN = +($('#wcnt').textContent || 0);
  const pcName = a && a.pc_name;
  const tile = (id, icon, label, big, small, extra = '') => `<button class="ht ${extra}" data-h="${id}">${icon ? ico(icon) : ''}<div class="ht-b">${big}</div><div class="ht-l">${label}</div>${small ? `<div class="ht-s">${small}</div>` : ''}</button>`;
  box.innerHTML = `
    <div class="h-where">
      <div class="h-hi">${a ? esc(a.name) : 'Your area'}${tag ? ` <span class="h-tag">${tag}</span>` : ''}</div>
      <div class="h-loc">${a ? `Constituency ${a.ac_no} · <a href="#" class="dlink" data-dist="${esc(dist)}">${esc(dist)} district</a>${ward ? ` · Ward ${ward.w}` : ''}` : 'Outside the constituency map, or location not found yet'}</div>
      <div class="h-btns"><button class="h-change" data-h="map" aria-label="Open the map">${ico('map')}<span>Map</span></button><button class="h-change" data-h="pick"><span>${a ? 'Change' : 'Set area'}</span></button></div>
      ${sw}
    </div>
    <button class="cta static h-cta" data-h="report">Report a bug <span class="ta">· புகார் செய்</span></button>
    <div class="h-sec">Around you</div>
    <div class="h-grid">
      ${tile('bugs', 'bug', 'Open bugs', open, fixed ? `${fixed} fixed` : 'in this constituency', open ? 'hot' : '')}
      ${tile('news', 'news', 'News', nHere, dist ? 'this area' : '', nHere ? 'warm' : '')}
      ${tile('mla', a ? '' : 'mla', a && a.status === 'vacant' ? 'Seat vacant' : 'Your MLA', a ? `<span class="ht-face">${avatar('ac-' + ac, a.mla_name, undefined)}</span>` : '-', a ? (a.status === 'vacant' ? 'by-poll pending' : esc(a.mla_name)) : '')}
      ${tile('police', 'police', 'Police station', '<span class="ht-sm" id="hPolN">...</span>', '<span id="hPolD"></span>')}
      ${tile('offices', 'office', 'District offices', offN == null ? '<span class="ht-sm">Open</span>' : offN, dist ? esc(dist) : '')}
      ${(mp => tile('mp', 'mp', 'Your MP', '<span class="ht-sm">' + (mp ? esc(mp.mp_name) : '-') + '</span>', mp ? `${esc(mp.party)} · ${esc(pcName)}` : (pcName ? esc(pcName) : '')))(pcName && mps.get(pcName))}
      ${(() => { const hw = typeof PROF !== 'undefined' && PROF.row && PROF.row.home_ward, hereW = !hw && ward && ward.corp === 'TCMC' ? 'TCMC-' + ward.w : null,
          c = (hw || hereW) && window.councillorFor ? councillorFor(hw || hereW) : null;   // saved home ward, else the ward you are standing in
        if (!c && !(ac && TCMC_ACS.has(ac))) return '';
        return tile('coun', 'who', 'Ward councillor', '<span class="ht-sm">' + (c ? esc(cleanName(c.name)) : 'Pick your ward') + '</span>', c ? `Ward ${c.ward}${hereW ? ' · where you are' : c.party ? ' · ' + esc(c.party) : ''}` : 'Tambaram Corporation'); })()}
      ${tile('help', 'phone', 'Helplines', '<span class="ht-sm">112 · 100</span>', '181 women')}
    </div>
    <div class="h-sec">Tools</div>
    <div class="h-grid">
      ${tile('map', 'map', 'Map', '', 'bugs and news areas')}
      ${tile('atlas', 'atlas', 'Atlas', '', 'state to street')}
      ${tile('who', 'who', "Who's who", '', 'MLAs, officers, parties')}
      ${tile('law', 'law', 'Law library', '', 'Acts, Constitution')}
      ${tile('mine', 'mine', 'My reports', mineN, window.QN && QN.open ? `<b class="need">${QN.open} need${QN.open === 1 ? 's' : ''} your reply</b>` : '', window.QN && QN.open ? 'hot' : '')}
      ${me.role !== 'reporter' || workN ? tile('work', 'work', 'My work', workN, '') : ''}
      ${role === 'admin' ? tile('admin', 'admin', 'Admin', '', 'queue, users, suggestions') : ''}
    </div>`;
  if (window.fillFaces) fillFaces(box);
  HOME.mp = pcName ? { pc: pcName, m: mps.get(pcName) } : null;
  box.querySelectorAll('[data-h]').forEach(b => b.onclick = () => homeGo(b.dataset.h, ac, dist));
  if (p && a) homePolice(p.lat, p.lng); else { const n = $('#hPolN'); if (n) n.textContent = '-'; }
}

function homeGo(k, ac, dist) {
  const toMap = () => { stack.length = 1; show('scrMap', false); };
  switch (k) {
    case 'report': startReport(); break;
    case 'switch-gps': HOME.view = here && acAt(here.lat, here.lng); renderHome(); break;
    case 'switch-home': HOME.view = null; renderHome(); break;
    case 'profile': openProfile(); break;
    case 'pick': homePick(ac); break;
    case 'map': case 'bugs': toMap(); break;
    case 'news': case 'mla': case 'police': if (ac) { toMap(); setTimeout(() => openAc(ac), 80); } else toMap(); break;
    case 'offices': if (dist) openDistrict(dist); break;
    case 'mp': homeMp(); break;
    case 'coun': homeCouncillor(); break;
    case 'help': homeHelp(); break;
    case 'atlas': openAtlas(); break;
    case 'who': openDirectory(); break;
    case 'law': openLibrary(); break;
    case 'mine': $('#btnList').click(); break;
    case 'work': $('#btnWork').click(); break;
    case 'admin': openAdmin(); break;
  }
}
// view another area for this session, or save it as home
function homePick(cur) {
  $('#mTitle').textContent = 'Show which area?';
  $('#mBody').innerHTML = `<select id="hpSel">${[...DIR.acs].sort((x, y) => x.name.localeCompare(y.name)).map(a => `<option value="${a.ac_no}" ${a.ac_no === cur ? 'selected' : ''}>${esc(a.name)} (${a.ac_no}) · ${esc(a.district)}</option>`).join('')}</select>
    <label class="chk"><input type="checkbox" id="hpHome"> Make this my home area</label>`;
  $('#mOk').textContent = 'Show'; $('#mCancel').textContent = 'Cancel';
  const close = () => { $('#modal').classList.remove('on'); $('#mOk').textContent = 'Save'; };
  $('#mCancel').onclick = close;
  $('#mOk').onclick = async () => {
    const ac = +$('#hpSel').value, mk = $('#hpHome').checked; close();
    if (mk) { const { error } = await sb.from('reporter_profiles').upsert({ user_id: me.id, home_ac: ac }, { onConflict: 'user_id' }); if (error) toast(error.message); else { await loadProfile(true); toast('Home area saved'); } HOME.view = null; }
    else HOME.view = ac;
    renderHome();
  };
  $('#modal').classList.add('on');
}
function homeMp() {
  const x = HOME.mp; if (!x) return toast('Set your area first');
  const segs = DIR.acs.filter(a => a.pc_name === x.pc).map(a => `${esc(a.name)} (${a.ac_no})`).join(', ');
  $('#mTitle').textContent = x.pc + ' Lok Sabha seat';
  $('#mBody').innerHTML = x.m ? `<div class="kv"><div>MP</div><div><b>${esc(x.m.mp_name)}</b></div><div>Party</div><div>${esc(x.m.party)}</div><div>Elected</div><div>2024 general election</div><div>Assembly seats</div><div>${segs}</div></div>
    <p class="muted small">Checked ${esc(x.m.checked_on || '')} · <a href="${esc(x.m.source_url || '#')}" target="_blank" rel="noopener">Source</a></p>` : '<p class="muted">MP not added yet.</p>';
  $('#mOk').style.display = 'none'; $('#mCancel').textContent = 'Close';
  $('#mCancel').onclick = () => { $('#modal').classList.remove('on'); $('#mOk').style.display = ''; $('#mCancel').textContent = 'Cancel'; };
  $('#modal').classList.add('on');
}
function homeHelp() {
  $('#mTitle').textContent = 'Helplines';
  $('#mBody').innerHTML = `<div class="help-grid">${[['112', 'Any emergency'], ['100', 'Police'], ['101', 'Fire'], ['108', 'Ambulance'], ['181', 'Women helpline'], ['1091', 'Women, police'], ['1098', 'Child helpline'], ['94987 94987', 'Electricity (TNPDCL)'], ['1100', 'CM Helpline']]
    .map(([n, t]) => `<a class="help-n" href="tel:${n.replace(/\s/g, '')}"><b>${n}</b><span>${t}</span></a>`).join('')}</div>`;
  $('#mOk').style.display = 'none'; $('#mCancel').textContent = 'Close';
  $('#mCancel').onclick = () => { $('#modal').classList.remove('on'); $('#mOk').style.display = ''; };
  $('#modal').classList.add('on');
}
async function homePolice(lat, lng) {
  const key = lat.toFixed(3) + ',' + lng.toFixed(3), n = $('#hPolN'), d = $('#hPolD');
  const put = x => { if (!n) return; if (!x) { n.textContent = 'Call 100'; d.textContent = 'none mapped nearby'; return; } n.textContent = x.name.replace(/ police station$/i, ''); d.textContent = x.d.toFixed(1) + ' km away'; };
  if (HOME.polKey === key) return put(HOME.pol);
  const q = `[out:json][timeout:15];(node["amenity"="police"](around:5000,${lat},${lng});way["amenity"="police"](around:5000,${lat},${lng}););out center tags 15;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const j = await r.json(), km = (a, b, c, e) => { const t = Math.PI / 180; return 6371 * Math.hypot((e - b) * t * Math.cos((a + c) / 2 * t), (c - a) * t); };
    const best = j.elements.map(e => ({ name: (e.tags || {}).name || 'Police station', d: km(lat, lng, e.lat ?? e.center?.lat, e.lon ?? e.center?.lon) })).filter(x => !isNaN(x.d)).sort((x, y) => x.d - y.d)[0] || null;
    HOME.pol = best; HOME.polKey = key; put(best);
  } catch (_) { if (n) { n.textContent = 'Call 100'; d.textContent = 'station map offline'; } }
}
window.homeRefresh = () => { HOME.bugs = HOME.news = null; renderHome(); };
