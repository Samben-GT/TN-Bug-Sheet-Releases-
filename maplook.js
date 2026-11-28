/* Map look and feel (Google Maps style): base map types, map details toggles, account avatar, chip row. */
(function () {
  const OSM = '&copy; OpenStreetMap contributors';
  const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', OSM_THUMB = 'https://tile.openstreetmap.org/12/2961/1897.png';
  // Thumbnails are real tiles over central Chennai (zoom 12). No API keys needed for any of these.
  const BASES = {
    default: { name: 'Default', url: OSM_URL, att: OSM, native: 19, thumb: OSM_THUMB },
    dark: { name: 'Dark', url: OSM_URL, att: OSM, native: 19, darkUi: true, darkTiles: true, thumb: OSM_THUMB },
    satellite: { name: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', native: 19,
      att: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
      labels: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
               'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      thumb: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1897/2961' },
    terrain: { name: 'Terrain', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', native: 18,
      att: 'Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors',
      thumb: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/12/1897/2961' },
  };
  const DETAILS = {
    corp: { name: 'Corporation limits', icon: '<svg viewBox="0 0 24 24"><path d="M4 5l5-2 6 2 5-2v16l-5 2-6-2-5 2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-dasharray="3 2"/></svg>', def: true },
    police: { name: 'Police stations', icon: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.5 11.5l2 2 3.5-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', def: false },
    glow: { name: 'Live bugs and news', icon: '<svg viewBox="0 0 24 24"><path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="11" r="3" fill="currentColor" opacity=".5"/></svg>', def: true },
    party: { name: 'Who holds each seat', icon: '<svg viewBox="0 0 24 24"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z" fill="currentColor" opacity=".25"/><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>', def: false },
    acs: { name: 'Constituency limits', icon: '<svg viewBox="0 0 24 24"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>', def: false },
  };
  const KEY = 'tnb-map-v1';
  let pref = { base: 'default', corp: true, acs: false, police: false, glow: true, party: false };
  try { pref = { ...pref, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (_) {} };

  let baseLayer = null, labelLayers = [], acLayer = null;
  function setBase(k) {
    const b = BASES[k] || BASES.default; pref.base = BASES[k] ? k : 'default';
    if (baseLayer) map.removeLayer(baseLayer);
    labelLayers.forEach(l => map.removeLayer(l)); labelLayers = [];
    const opt = { maxZoom: 20, attribution: b.att };
    if (b.native) opt.maxNativeZoom = b.native;
    baseLayer = L.tileLayer(b.url, opt).addTo(map); baseLayer.bringToBack();
    const ml = document.getElementById('mapLoad') || Object.assign(document.createElement('div'), { id: 'mapLoad', className: 'map-load', innerHTML: '<i></i>Loading map...' });
    if (!ml.parentNode) map.getContainer().parentNode.appendChild(ml);
    baseLayer.on('loading', () => ml.classList.add('on')); baseLayer.on('load', () => ml.classList.remove('on'));
    (b.labels || []).forEach(u => labelLayers.push(L.tileLayer(u, { maxZoom: 20, maxNativeZoom: 19, attribution: '' }).addTo(map)));
    const appDark = document.documentElement.classList.contains('dark');
    map.getContainer().classList.toggle('darktiles', !!b.darkTiles || (appDark && pref.base === 'default'));
    document.body.classList.toggle('mapdark', !!b.darkUi || appDark);
    save(); renderSheet();
  }
  async function setDetail(k, on) {
    pref[k] = on; save(); renderSheet();
    if (k === 'corp') {
      LOCAL.on = on;
      if (LOCAL.layer) { if (on) LOCAL.layer.addTo(map); else map.removeLayer(LOCAL.layer); }
      if (LOCAL.sync) LOCAL.sync();
    }
    if (k === 'police') policeLayer(on);
    if (k === 'glow') glowLayer(on);
    if (k === 'acs') acLines(on);
    if (k === 'party') partyLayer(on);
  }

  /* Constituency lines only when zoomed in (at state zoom 234 borders are a tangle), in neutral grey so red stays for bugs. */
  const toLL = polys => polys.map(p => p.map(r => r.map(([x, y]) => [y, x])));
  const AC_MIN_Z = 9;
  async function acLines(on) {
    if (on && !acLayer) {
      try { await loadShapes(); } catch (_) { return; }
      if (!pref.acs) return;
      acLayer = L.layerGroup(DIR.shapes.map(sh => L.polygon(toLL(sh.polys), { color: '#6b7280', weight: 0.8, opacity: 0.6, fill: false, interactive: false })));
      map.on('zoomend', acZoom);
    }
    acZoom();
  }
  function acZoom() {
    if (!acLayer) return;
    const show = pref.acs && map.getZoom() >= AC_MIN_Z;
    if (show && !map.hasLayer(acLayer)) acLayer.addTo(map); else if (!show && map.hasLayer(acLayer)) map.removeLayer(acLayer);
    const w = map.getZoom() >= 12 ? 1.4 : map.getZoom() >= 10 ? 1 : 0.7;
    acLayer.eachLayer(l => l.setStyle({ weight: w }));
  }

  /* Who holds each seat: a soft fill in the sitting MLA's party colour, hairline white edges, and a legend. Off by default. */
  const PARTY_COL = { TVK: '#c9971c', DMK: '#d32f2f', AIADMK: '#2e7d32', INC: '#1e88e5', BJP: '#f57c00', PMK: '#e6c229', VCK: '#7b1fa2',
    CPI: '#ec7a8a', 'CPI(M)': '#9b1c1c', IUML: '#00897b', AMMK: '#795548', DMDK: '#5c6bc0' };
  let partyGroup = null, partyLegend = null;
  async function partyLayer(on) {
    if (!on) { if (partyGroup) map.removeLayer(partyGroup); if (partyLegend) partyLegend.remove(); return; }
    try { await Promise.all([loadShapes(), loadDirectory()]); } catch (_) { return; }
    if (!pref.party) return;
    if (!partyGroup) {
      partyGroup = L.layerGroup(DIR.shapes.map(sh => { const a = DIR.byAc.get(sh.ac) || {}, vac = a.status === 'vacant';
        return L.polygon(toLL(sh.polys), { color: '#ffffff', weight: 0.5, opacity: 0.7, fill: true, fillColor: vac ? '#9ca3af' : (PARTY_COL[a.party] || '#9ca3af'), fillOpacity: vac ? 0.12 : 0.32, interactive: false, dashArray: vac ? '3 3' : null }); }));
      map.on('zoomend', () => { if (partyGroup) partyGroup.eachLayer(l => l.setStyle({ fillOpacity: map.getZoom() >= 11 ? 0.16 : 0.32 })); });
    }
    partyGroup.addTo(map);
    const count = {}; DIR.acs.forEach(a => { const k = a.status === 'vacant' ? 'Vacant' : a.party; count[k] = (count[k] || 0) + 1; });
    const keys = Object.keys(count).sort((x, y) => (x === 'Vacant') - (y === 'Vacant') || count[y] - count[x]);
    if (partyLegend) partyLegend.remove();
    partyLegend = document.createElement('div'); partyLegend.className = 'party-legend';
    partyLegend.innerHTML = keys.map(k => `<span><i style="background:${k === 'Vacant' ? '#9ca3af' : PARTY_COL[k] || '#9ca3af'}"></i>${esc(k)} ${count[k]}</span>`).join('');
    partyLegend.onclick = () => partyLegend.classList.toggle('open');
    document.getElementById('scrMap').appendChild(partyLegend);
  }

  /* police stations as map pins, from OpenStreetMap for the area on screen (zoom 12+), linked to the officers tree */
  let polGroup = null, polSeen = new Map(), polT = null;
  const shield = L.divIcon({ className: '', iconSize: [26, 30], iconAnchor: [13, 28], popupAnchor: [0, -26],
    html: '<svg class="pol-pin" viewBox="0 0 26 30"><path d="M13 1l11 4.5v8c0 7-4.8 12.6-11 15-6.2-2.4-11-8-11-15v-8z" fill="#1d4ed8" stroke="#fff" stroke-width="2"/><path d="M8.5 14l3 3 6-6.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' });
  const stKey = s => String(s || '').toLowerCase().replace(/\b(police station|police|station|ps|law and order|l ?& ?o|all women|awps|traffic|w\d+)\b/g, ' ').replace(/[^a-z]+/g, '').replace(/(?!^)[aeiouy]/g, '').replace(/(.)\1+/g, '$1'); // spelling-tolerant: Chromepet = Chrompet
  function polPopup(x) {
    const k = stKey(x.name), posts = (typeof OFF !== 'undefined' && OFF ? OFF : []).filter(o => o.rank === 'Inspector' && k && stKey(o.area) === k);
    return `<div class="pol-pop"><b>${esc(x.name)}</b>${x.ta && x.ta !== x.name ? `<div class="muted small">${esc(x.ta)}</div>` : ''}
      ${(() => { const op = posts.find(o => o.phone); const ph = x.phone || (op && op.phone.split(/[,/]/)[0].trim());
        if (!ph) return '<div class="muted small">Number not listed yet</div>';
        const tag = x.phone ? 'from OpenStreetMap' : op.verified ? 'checked' : op.phone_kind === 'official' ? 'official site' : 'unverified';
        return `<div><a href="tel:${esc(ph.replace(/[^\d+]/g, ''))}">${esc(ph)}</a> <span class="muted small">${tag}</span></div>`; })()}
      ${posts.length ? `<div class="small" style="margin-top:4px">${posts.map(o => esc(o.name || o.post.replace('Inspector of Police, ', 'Inspector · '))).join('<br>')}</div>` : ''}
      <div style="margin-top:6px;display:flex;gap:10px"><a href="#" data-polwho="${esc(x.name)}">In Who's who</a><a href="https://www.google.com/maps/dir/?api=1&destination=${x.la},${x.ln}" target="_blank" rel="noopener">Directions</a></div></div>`;
  }
  async function polLoad() {
    if (!pref.police || !polGroup || map.getZoom() < 12) return;
    if (typeof loadOff === 'function' && !OFF) loadOff().catch(() => {});
    const b = map.getBounds().pad(0.2), bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(n => n.toFixed(3)).join(',');
    const q = `[out:json][timeout:20];(node["amenity"="police"](${bb});way["amenity"="police"](${bb}););out center tags 200;`;
    try {
      if (typeof OFF !== 'undefined' && !OFF) sb.from('officers').select('*').order('sort').then(({ data }) => { if (data) OFF = data; });
      const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) return;
      (await res.json()).elements.forEach(e => {
        const la = e.lat ?? e.center?.lat, ln = e.lon ?? e.center?.lon, t = e.tags || {}; if (la == null || polSeen.has(e.id)) return;
        const x = { la, ln, name: t.name || t['name:en'] || 'Police station', ta: t['name:ta'] || '', phone: (t.phone || t['contact:phone'] || '').split(';')[0].trim() };
        const m = L.marker([la, ln], { icon: shield, title: x.name }).bindPopup(() => polPopup(x), { maxWidth: 240 });
        polSeen.set(e.id, m); polGroup.addLayer(m);
      });
    } catch (_) {}
  }
  function policeLayer(on) {
    if (on) {
      if (!polGroup) { polGroup = L.layerGroup(); map.on('moveend', () => { clearTimeout(polT); polT = setTimeout(polLoad, 600); }); }
      polGroup.addTo(map); if (map.getZoom() < 12 && window.toast) toast('Zoom in to see police stations'); polLoad();
    } else if (polGroup) map.removeLayer(polGroup);
  }
  document.addEventListener('click', e => { const a = e.target.closest('[data-polwho]'); if (!a) return; e.preventDefault();
    const n = a.dataset.polwho.replace(/police station/i, '').trim(); map.closePopup(); openDirectory().then(() => { dirTab = 'off'; dirQ = n; const i = $('#dirSearch'); if (i) i.value = n; renderDir(); }); });

  /* Bugs and news now live in mappulse.js (blinking dots, news glow, tap to go deeper). */
  const glowLayer = on => window.pzLayer && pzLayer(on);

  function renderSheet() {
    const t = $('#lsTypes'), d = $('#lsDetails'); if (!t) return;
    t.innerHTML = Object.entries(BASES).map(([k, b]) =>
      `<button class="ls-opt${pref.base === k ? ' on' : ''}" data-base="${k}"><span class="ls-img${b.darkTiles ? ' darktiles' : ''}"><img src="${b.thumb}" alt="" loading="lazy"></span><span>${b.name}</span></button>`).join('');
    d.innerHTML = Object.entries(DETAILS).map(([k, x]) =>
      `<button class="ls-opt${pref[k] ? ' on' : ''}" data-det="${k}"><span class="ls-img ic">${x.icon}</span><span>${x.name}</span></button>`).join('');
    t.querySelectorAll('[data-base]').forEach(b => b.onclick = () => setBase(b.dataset.base));
    d.querySelectorAll('[data-det]').forEach(b => b.onclick = () => setDetail(b.dataset.det, !pref[b.dataset.det]));
  }
  const openSheet = () => { renderSheet(); $('#layerSheet').hidden = false; };
  const closeSheet = () => { $('#layerSheet').hidden = true; };

  window.reapplyMapLook = () => { if (typeof map !== 'undefined' && map) setBase(pref.base); };
  window.mapLookInit = function () {
    // Tamil Nadu only: no zooming out to India or the world.
    const TN = L.latLngBounds([7.7, 75.9], [13.9, 80.7]);
    map.setMaxBounds(TN.pad(0.15)); map.options.maxBoundsViscosity = 1.0; map.setMinZoom(7);
    LOCAL.on = pref.corp !== false;
    setBase(pref.base);
    if (pref.acs) setDetail('acs', true);
    if (pref.party) setDetail('party', true);
    if (pref.police) setDetail('police', true);
    if (pref.glow) glowLayer(true);
    const av = $('#btnMe');
    if (av && me && me.email) {
      const id = window.displayId ? displayId(me.email) : me.email;
      av.textContent = (/^[a-z]/i.test(id) ? id[0] : '#').toUpperCase(); const hm = $('#homeMe'); if (hm) hm.textContent = av.textContent;
    }
  };
  $('#btnLayers').onclick = openSheet;
  $('#lsClose').onclick = closeSheet;
  $('#layerSheet').onclick = e => { if (e.target.id === 'layerSheet') closeSheet(); };
  $('#btnMe').onclick = () => openSettings();
  $('#btnWho').onclick = () => openDirectory();
  $('#btnAtlas').onclick = () => openAtlas();
  $('#btnHome').onclick = () => openHome();
  $('#homeMe').onclick = () => openProfile();
  // Close the sheet on the Android back button before leaving the screen.
  const prevBack = window.nativeBack;
  window.nativeBack = function () { if (!$('#layerSheet').hidden) { closeSheet(); return true; } return prevBack ? prevBack() : false; };
})();

/* App theme: 'auto' follows the phone, else 'light' or 'dark'. Default dark. Stored on this device. */
(function () {
  const KEY = 'tnb-theme', mq = matchMedia('(prefers-color-scheme: dark)');
  const get = () => { try { return localStorage.getItem(KEY) || 'dark'; } catch (_) { return 'dark'; } };
  function applyTheme() {
    const t = get(), dark = t === 'dark' || (t === 'auto' && mq.matches);
    document.documentElement.classList.toggle('dark', dark);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#17181b' : '#ffffff';
    document.querySelectorAll('#themeSeg [data-th]').forEach(b => b.classList.toggle('on', b.dataset.th === t));
    if (window.reapplyMapLook) window.reapplyMapLook();
  }
  window.applyTheme = applyTheme;
  if (mq.addEventListener) mq.addEventListener('change', () => { if (get() === 'auto') applyTheme(); });
  document.querySelectorAll('#themeSeg [data-th]').forEach(b => b.onclick = () => { try { localStorage.setItem(KEY, b.dataset.th); } catch (_) {} applyTheme(); });
  applyTheme();
})();
