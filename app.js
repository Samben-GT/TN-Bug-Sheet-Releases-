// Netlify only: clear the service worker and caches the POS app once left on that address.
// Never runs on GitHub Pages, where the live POS app shares the samben-gt.github.io domain.
if (location.hostname.endsWith('netlify.app') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
}
/* TN Bug Sheet - reporter app, v0.2
 * Sign in by email code -> map with your location -> report form -> upload to Supabase.
 * Each report is kept on the phone (IndexedDB) and retried until the server has it.
 */
'use strict';

const VERSION = 'v0.50';
const CATS = [ // icon: emoji used in lists; svg + ta (Tamil) used on the report form
  { id: 'road', icon: '\u{1F6A7}', name: 'Pothole or damaged road', ta: 'சாலை பள்ளம்', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19L8 5M20 19L16 5M12 7v2M12 13v2M12 18v2"/></svg>' },
  { id: 'women', icon: '\u{1F6E1}', name: 'Women safety: unsafe spot', ta: 'பெண்கள் பாதுகாப்பு', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' },
  { id: 'light', icon: '\u{1F4A1}', name: 'Streetlight not working', ta: 'தெருவிளக்கு எரியவில்லை', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>' },
  { id: 'garbage', icon: '\u{1F5D1}', name: 'Garbage not collected', ta: 'குப்பை அகற்றப்படவில்லை', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>' },
  { id: 'drain', icon: '\u{1F30A}', name: 'Open or blocked drain', ta: 'கால்வாய் அடைப்பு', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M12 4v16M16 4v16"/></svg>' },
  { id: 'water', icon: '\u{1F6B0}', name: 'Water or sewage leak', ta: 'குடிநீர் / கழிவுநீர் கசிவு', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>' },
  { id: 'power', icon: '⚡', name: 'Power fault', ta: 'மின்சாரம் தடை', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10"/></svg>' },
  { id: 'wires', icon: '\u{1F50C}', name: 'Exposed wires or EB post', ta: 'மின்கம்பி ஆபத்து', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' },
  { id: 'other', icon: '❓', name: 'Something else', ta: 'மற்றவை', svg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/></svg>' },
];
const SINCE = { today: 'Today', week: 'This week', month: 'This month', longer: 'Longer' };
const MAX_PHOTOS = 4, PHOTO_MAX_SIDE = 1600, PHOTO_QUALITY = 0.8, THUMB_SIDE = 360;
const KEEP_ONLINE_DAYS = 30; // full photos stay on the server this long after backup, then only thumbnails
const CLEARING_ON = false; // Sam, 27 Nov: keep every photo online for now (paid plan next month)
const CHENNAI = [13.0827, 80.2707];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catOf = id => CATS.find(c => c.id === id) || CATS[CATS.length - 1];
const isAndroid = typeof window.TNB !== 'undefined';
const sb = window.supabase.createClient(TNB_CONFIG.supabaseUrl, TNB_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});
let me = null; // { id, email, role }

/* Mobile-number logins: a number is stored as a private login name, 91XXXXXXXXXX@phone.tnbugsheet.app. No email is ever sent to it. */
const PHONE_DOMAIN = 'phone.tnbugsheet.app';
function toLogin(v) {
  v = String(v || '').trim();
  if (v.includes('@')) return v.toLowerCase();
  let d = v.replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  else if (d.length === 11 && d[0] === '0') d = '91' + d.slice(1);
  return /^91[6-9]\d{9}$/.test(d) ? `${d}@${PHONE_DOMAIN}` : v.toLowerCase();
}
function displayId(e) {
  e = String(e || '');
  if (!e.endsWith('@' + PHONE_DOMAIN)) return e;
  const n = e.split('@')[0]; return `+${n.slice(0, 2)} ${n.slice(2, 7)} ${n.slice(7)}`;
}
const isPhoneLogin = e => String(e || '').endsWith('@' + PHONE_DOMAIN);
const validLogin = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
window.toLogin = toLogin; window.displayId = displayId; window.isPhoneLogin = isPhoneLogin;

/* ---------- activity trail for issue reports: screens, taps, typed text and errors from the last few minutes.
   Testing phase (Sam, 27 Nov): typed text is kept, passwords never. Kept only on this phone (session) until the user sends an issue. ---------- */
const TRAIL_KEY = 'tnb-trail', TRAIL_MS = 10 * 60e3;
function trail(kind, what) {
  try {
    const now = Date.now(), list = JSON.parse(sessionStorage.getItem(TRAIL_KEY) || '[]').filter(x => now - x.t < TRAIL_MS);
    list.push({ t: now, k: kind, w: String(what || '').replace(/\s+/g, ' ').trim().slice(0, 140) });
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(list.slice(-300)));
  } catch (_) {}
}
function trailSince(ms) { try { const now = Date.now(); return JSON.parse(sessionStorage.getItem(TRAIL_KEY) || '[]').filter(x => now - x.t <= ms); } catch (_) { return []; } }
document.addEventListener('click', e => {
  const el = e.target.closest('button, a, [data-ac], [data-p], .item, .chip'); if (!el) return;
  const label = el.getAttribute('aria-label') || el.textContent || el.id || el.className;
  trail('tap', (el.id ? '#' + el.id + ' ' : '') + label);
}, true);
document.addEventListener('change', e => {
  const el = e.target; if (!el || !el.matches || !el.matches('input, textarea, select')) return;
  if (el.type === 'password' || el.type === 'file' || /pass|otp|code/i.test(el.id + ' ' + (el.name || '') + ' ' + (el.autocomplete || ''))) return; // never passwords or codes
  trail('typed', (el.id ? '#' + el.id + ': ' : '') + (el.type === 'checkbox' ? (el.checked ? 'ticked' : 'unticked') : el.value));
}, true);
window.addEventListener('error', e => trail('error', (e.message || 'error') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : '')));
window.addEventListener('unhandledrejection', e => trail('error', 'Promise: ' + ((e.reason && e.reason.message) || e.reason)));

function toast(msg, ms = 2400) {
  trail('toast', msg);
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}
const store = {
  get: (k, d) => { try { const v = localStorage.getItem('tnb-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('tnb-' + k, JSON.stringify(v)); } catch {} },
};

/* ---------- reports database (IndexedDB) ---------- */
const db = {
  open() {
    if (this.p) return this.p;
    this.p = new Promise((res, rej) => {
      const r = indexedDB.open('tnbugsheet', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('reports', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.p;
  },
  async tx(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction('reports', mode), s = t.objectStore('reports'); const out = fn(s);
      t.oncomplete = () => res(out && 'result' in out ? out.result : out); t.onerror = () => rej(t.error);
    });
  },
  put: r => db.tx('readwrite', s => s.put(r)),
  del: id => db.tx('readwrite', s => s.delete(id)),
  get: id => db.tx('readonly', s => s.get(id)),
  all: () => db.tx('readonly', s => s.getAll()).then(a => a.sort((x, y) => y.time - x.time)),
};

/* ---------- screens and back navigation ---------- */
const stack = ['scrMap'];
function show(id, push = true) {
  trail('screen', id + ($('#' + id + ' .title') ? ' (' + $('#' + id + ' .title').textContent + ')' : ''));
  const overlay = $('#' + id).classList.contains('overlay'); // place sheet sits over the live map
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id || (overlay && s.id === 'scrMap')));
  if (push && stack[stack.length - 1] !== id) stack.push(id);
  if (id === 'scrMap' && map) setTimeout(() => map.invalidateSize(), 50);
}
function back() {
  if ($('#consent').classList.contains('on')) return true;
  if (stack.length <= 1) return false;
  stack.pop(); show(stack[stack.length - 1], false); return true;
}
window.nativeBack = back; // the Android back button asks the page first
document.querySelectorAll('[data-back]').forEach(b => b.onclick = back);

/* ---------- map and location ----------
   Your own location is the small blue dot. The red pin is off the map until a spot is marked on purpose:
   press and hold the map, pick a place in search, or open a bug on the map. A plain tap never drops it, and with the
   pin out a tap on the map only puts it away. `pin` still holds the spot the map card is about (it follows your
   location, then your taps) while it is off the map, so everything that reads pin.getLatLng() keeps working.
   pinShown = the pin is on the map. pinExact = it was set by hand at street zoom, so a report can be filed right there.
   A report starts at the pin only when it is on the map; with no pin it starts at your own location. */
let map, pin, meDot, accCircle, here = null, pinMoved = false, pinShown = false, pinExact = false, pinAt = 0, gpsErr = null, watchId = null;
let pressN = 0, pinPressN = -1; // presses on the map so far, and the press that set the pin (see the tap handler in directory.js)
const PIN_ZOOM = 16; // from this zoom level in, a pin set by hand is exact enough to file at
function initMap() {
  // tapHold: press and hold works on every touch phone, also where the browser sends no long-press event of its own
  map = L.map('map', { zoomControl: false, attributionControl: true, tapHold: true }).setView(CHENNAI, 12);
  if (window.mapLookInit) mapLookInit(); // base map + layer picker (maplook.js)
  else L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const pinIcon = L.divIcon({ className: '', iconSize: [34, 46], iconAnchor: [17, 44],
    html: '<svg class="pin" viewBox="0 0 34 46" xmlns="http://www.w3.org/2000/svg"><path d="M17 1C8.2 1 1 8 1 16.7 1 28.5 17 45 17 45s16-16.5 16-28.3C33 8 25.8 1 17 1z" fill="#e8475f" stroke="#fff" stroke-width="2"/><circle cx="17" cy="16.5" r="6" fill="#fff"/></svg>' });
  pin = L.marker(CHENNAI, { draggable: true, autoPan: true, icon: pinIcon }); // made here, put on the map by dropPin
  pin.on('dragend', () => { pinMoved = true; pinExact = map.getZoom() >= PIN_ZOOM; pinAt = Date.now(); pinPressN = pressN; updateGps(); });
  (window.PointerEvent ? ['pointerdown'] : ['touchstart', 'mousedown']).forEach(t => map.getContainer().addEventListener(t, () => { pressN++; }, true));
  // A touch on the pin itself is the start of a drag. Without these two the map would take the tap (and put the pin
  // away) or the hold (and re-drop the pin under the finger).
  pin.on('click', () => {}); pin.on('contextmenu', () => {});
  map.on('contextmenu', e => dropPin(e.latlng, map.getZoom() >= PIN_ZOOM)); // press and hold (right click on a computer)
  startGps();
}
function startGps() {
  if (!('geolocation' in navigator)) { gpsErr = 'This phone has no location service'; updateGps(); return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(p => {
    const first = !here;
    here = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }; gpsErr = null;
    const ll = [here.lat, here.lng];
    if (!meDot) { // the blue dot and its accuracy ring; taps pass through both
      accCircle = L.circle(ll, { radius: here.acc, weight: 1, color: '#2f7df6', fillOpacity: 0.08, interactive: false }).addTo(map);
      meDot = L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: -500, icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: '<i class="me-dot"></i>' }) }).addTo(map);
    } else { accCircle.setLatLng(ll).setRadius(here.acc); meDot.setLatLng(ll); }
    if (!pinMoved) pin.setLatLng(ll);
    if (first) map.setView(ll, 18);
    updateGps();
  }, e => {
    gpsErr = e.code === 1 ? 'Location is off. Turn it on in settings.' : 'Still looking for your location...';
    updateGps();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
function gpsMsg(t, bad) { const g = $('#gps'); g.textContent = t; g.classList.toggle('bad', !!bad); g.classList.remove('haspin'); }
// the chip under the search bar (your location, or the pin with a way to remove it) and the hint above the card
function updateGps() {
  const hint = $('#mapHint');
  if (hint) hint.textContent = pinShown ? 'Drag the pin · tap the map to remove it' : window.PZ && PZ.on ? 'Tap to go deeper · hold to drop a pin' : 'Tap a spot · hold to drop a pin';
  if (pinShown) {
    const p = pin.getLatLng(), g = $('#gps');
    g.classList.remove('bad'); g.classList.add('haspin');
    g.innerHTML = `<span>Pin at ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span><button type="button" id="gpsX" aria-label="Remove the pin">&#10005;</button>`;
    $('#gpsX').onclick = clearPin;
  } else if (gpsErr) gpsMsg(gpsErr, true);
  else if (here) gpsMsg(here.acc > 50 ? `Location is rough: about ${here.acc} m` : `You are here, accurate to about ${here.acc} m`, here.acc > 50);
  else gpsMsg('Finding your location...');
}
// look at a spot without marking it: the map card follows, the pin stays off the map
function lookAt(ll) { hidePin(); pin.setLatLng(ll); pinMoved = true; updateGps(); }
// mark one exact spot: the pin goes on the map there. exact = set by hand at street zoom
function dropPin(ll, exact) {
  pin.setLatLng(ll); if (!pinShown) { pin.addTo(map); pinShown = true; }
  pinMoved = true; pinExact = !!exact; pinAt = Date.now(); pinPressN = pressN;
  if (window.closeSearch) closeSearch();
  if (window.pzSpot) pzSpot(pin.getLatLng()); // the live map opens the constituency the pin is in
  updateGps();
}
// put the pin away; the map card stays on that spot
function hidePin() { if (pinShown) map.removeLayer(pin); pinShown = pinExact = false; }
function clearPin() { hidePin(); updateGps(); }
$('#btnRecenter').onclick = () => { // back to my own location: no pin, the card follows me again
  pinMoved = false; hidePin();
  if (here) { pin.setLatLng([here.lat, here.lng]); map.setView([here.lat, here.lng], 18); } else startGps();
  updateGps();
};

/* ---------- report form ---------- */
let draft = null;
function newDraft(opt = {}) {
  // Where the report starts:
  //   the pin is on the map -> at the pin. Filed right there if it was set by hand at street zoom; otherwise the
  //     picker opens on it, to confirm the exact spot (a pin from search, or one dropped while zoomed out)
  //   opt.at (the area sheet) -> the picker opens on that spot
  //   otherwise -> your own location; with no location fix the picker opens on the spot the map card is about
  const p = pin.getLatLng(), at = opt.at ? L.latLng(opt.at) : null, byPin = pinShown && !at && !opt.gps, s = at || p, byHand = byPin || !!at;
  draft = { cat: null, photos: [], note: '', since: null, lat: s.lat, lng: s.lng, acc: null, byHand: byPin, mode: 'map', address: null, placed: byPin && pinExact, media: [], catManual: false, catGuessed: false, urgentTouched: false, urgent: false };
  $('#inNote').value = ''; $('#formErr').textContent = ''; $('#inAddr').value = ''; $('#addrRes').innerHTML = '';
  document.querySelectorAll('#since button').forEach(b => b.classList.remove('on'));
  $('#inPin').value = ''; $('#pinRes').innerHTML = ''; $('#locAddr').open = false;
  setLocMode(byHand || !here ? 'map' : 'gps', true);
  $('#inUrgent').checked = false; $('#catPick').open = false;
  renderCats(); renderPhotos(); if (window.renderGuess) { renderGuess(); renderMedia(); }
  Promise.all([loadShapes(), loadDirectory(), window.loadCouncillors ? loadCouncillors() : null, window.loadLocal ? loadLocal().catch(() => {}) : null]).then(() => draft && renderWhere()).catch(() => {});
}
/* where is the bug: current location, a pin dropped on the map, or a PIN code that takes the map to the right area */
const ROUGH_M = 300; // a GPS fix worse than this cannot tell neighbouring constituencies apart
function whereAc() {
  const d = draft; if (!d || typeof acAt !== 'function') return null;
  if (d.mode === 'gps' && (!here || (d.acc && d.acc > ROUGH_M))) return null;
  if ((d.mode === 'pin' || d.mode === 'map') && !d.placed) return null;
  if (d.mode === 'address' && !d.address) return null;
  const ac = acAt(d.lat, d.lng); return ac && typeof DIR !== 'undefined' && DIR.byAc ? DIR.byAc.get(ac) || null : null;
}
// how far a hand-placed spot is from where you are: a quick check that the report goes to the place you mean
function farTxt(d) {
  if (!here) return '';
  const m = L.latLng(d.lat, d.lng).distanceTo([here.lat, here.lng]);
  return m < 50 ? '' : ` · ${m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km'} from where you are`;
}
function renderWhere() {
  const d = draft, at = `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`;
  $('#where').innerHTML = d.mode === 'gps' ? (here ? `Your location: ${at} (about ${d.acc} m)` : 'Waiting for your location... or drop a pin.')
    : d.mode === 'address' ? (d.address ? `${esc(d.address)}<br><span class="muted small">${at}</span>` : 'Type the street or landmark and pick a match.')
    : d.mode === 'pin' ? (d.placed ? `Pin placed: ${at}${farTxt(d)}` : 'Enter the PIN code, pick the area, then place the pin.')
    : d.placed ? `Pin dropped: ${at}${farTxt(d)}` : 'Tap the exact spot on the map.';
  const a = whereAc(), f = $('#filedIn');
  if (a) f.innerHTML = `<span>Will be filed in <b>${esc(a.name)}</b>, Constituency ${a.ac_no} · ${esc(a.district)}</span><button type="button" id="fiChange">Change</button>`;
  else if (d.mode === 'gps' && here && d.acc > ROUGH_M) f.innerHTML = `<span class="warn">Your location is rough (about ${d.acc} m). Drop a pin so it goes to the right constituency.</span><button type="button" id="fiChange">Drop a pin</button>`;
  else if ((d.mode !== 'gps' || here) && !((d.mode === 'pin' || d.mode === 'map') && !d.placed) && !(d.mode === 'address' && !d.address) && typeof acAt === 'function' && DIR.byAc && DIR.byAc.size) f.innerHTML = `<span class="warn">This spot is outside the Tamil Nadu constituency map.</span><button type="button" id="fiChange">Change</button>`;
  else f.innerHTML = '<span class="muted">Choose where the bug is first.</span>';
  f.classList.toggle('ok', !!a);
  if (window.renderWardRow) renderWardRow(a && a.ac_no);
  const c = $('#fiChange'); if (c) c.onclick = () => { if (d.mode === 'gps' && d.acc > ROUGH_M) setLocMode('map'); else $('#locSeg').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
}
function setLocMode(m, quiet) {
  draft.mode = m;
  document.querySelectorAll('#locSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === m || (m === 'address' && b.dataset.m === 'pin')));
  $('#locPin').hidden = !(m === 'pin' || m === 'address'); $('#pickMap').hidden = true;
  if (m === 'gps') {
    if (here) Object.assign(draft, { lat: here.lat, lng: here.lng, acc: here.acc, byHand: false, address: null });
    else if (!quiet) toast('No location fix yet. Turn on location or drop a pin.');
  }
  if (m === 'pin') { draft.placed = false; if (!quiet) setTimeout(() => $('#inPin').focus(), 50); }
  if (m === 'map' && !quiet) openPicker();
  renderWhere();
}
document.querySelectorAll('#locSeg button').forEach(b => b.onclick = () => setLocMode(b.dataset.m));
let pickMap = null;
function openPicker(center, zoom) {
  $('#pickMap').hidden = false;
  const c = center || [draft.lat, draft.lng];
  if (!pickMap) {
    pickMap = L.map('pickMapEl', { zoomControl: false, attributionControl: false }).setView(c, zoom || 17);
    L.tileLayer(document.documentElement.classList.contains('dark') ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(pickMap);
    pickMap.on('click', e => pickMap.setView(e.latlng, Math.max(pickMap.getZoom(), 17))); // in pin mode a plain tap places the pin
  } else pickMap.setView(c, zoom || 17);
  setTimeout(() => pickMap.invalidateSize(), 60);
  $('#pickMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#pickOk').onclick = () => {
  const c = pickMap.getCenter();
  Object.assign(draft, { lat: c.lat, lng: c.lng, acc: null, byHand: true, address: null, placed: true });
  if (draft.mode !== 'pin') draft.mode = 'map';
  $('#pickMap').hidden = true; renderWhere();
};
$('#pickCancel').onclick = () => { $('#pickMap').hidden = true; };
/* PIN code: show every constituency the PIN touches, with the localities people know; picking one moves the map there to place the pin.
   India Post names come from our server; the map outline and points come from OpenStreetMap on the phone, then are shared through the cache. */
let pinSeq = 0;
const nomi = async q => { const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&' + q, { headers: { 'Accept-Language': 'en' } }); return r.ok ? r.json() : []; };
function pinRender(v, geo, busy) {
  const box = $('#pinRes'), groups = new Map();
  const add = (ac, loc, lat, lng, w) => { if (!ac || !DIR.byAc.get(ac)) return; const g = groups.get(ac) || { ac, locs: [], pts: [], w: 0 }; if (loc && !g.locs.includes(loc)) { g.locs.push(loc); g.pts.unshift([lat, lng]); } else g.pts.push([lat, lng]); g.w += w; groups.set(ac, g); };
  (geo.localities || []).forEach(l => l.lat && add(acAt(l.lat, l.lng), l.name, l.lat, l.lng, 3));
  if (geo.box) { const [s1, n1, w1, e1] = geo.box; for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { const la = s1 + (n1 - s1) * (i + 0.5) / 6, lo = w1 + (e1 - w1) * (j + 0.5) / 6; add(acAt(la, lo), null, la, lo, 1); } }
  if (!groups.size && geo.center) add(acAt(geo.center[0], geo.center[1]), null, geo.center[0], geo.center[1], 1);
  const list = [...groups.values()].sort((x, y) => y.w - x.w);
  if (!list.length) { box.innerHTML = '<div class="muted small pin-msg">Could not place this PIN on the constituency map. Drop a pin instead.</div>'; return list; }
  const go = g => { const a = DIR.byAc.get(g.ac); pinSeq++; box.innerHTML = `<div class="small pin-msg">PIN ${v} · <b>${esc(a.name)}</b>. Now tap the exact spot on the map.</div>`; openPicker(g.pts[0], 16); };
  if (list.length === 1 && !busy) { go(list[0]); return list; }
  const unplaced = (geo.localities || []).filter(l => !l.lat && l.tried !== false).map(l => l.name);
  box.innerHTML = `<div class="muted small pin-msg">PIN ${v} covers ${list.length} constituenc${list.length === 1 ? 'y' : 'ies'}. Pick the one with the bug:</div>` + list.map((g, i) => { const a = DIR.byAc.get(g.ac);
    return `<button type="button" class="pin-hit" data-i="${i}"><b>${esc(a.name)}</b> <span class="muted small">· Constituency ${a.ac_no} · ${esc(a.district)}</span><span class="muted small">${g.locs.length ? esc(g.locs.join(', ')) : busy ? 'Finding area names...' : 'Part of this PIN area'}</span></button>`; }).join('')
    + (unplaced.length ? `<div class="muted small pin-msg">Also in this PIN: ${esc(unplaced.join(', '))}</div>` : '');
  box.querySelectorAll('.pin-hit').forEach(b => b.onclick = () => go(list[+b.dataset.i]));
  return list;
}
$('#inPin').addEventListener('input', async () => {
  const v = $('#inPin').value.replace(/\D/g, '').slice(0, 6); $('#inPin').value = v; const seq = ++pinSeq, box = $('#pinRes');
  if (v.length < 6) { box.innerHTML = ''; return; }
  if (!/^6[0-4]/.test(v)) { box.innerHTML = '<div class="muted small pin-msg">Tamil Nadu PIN codes start with 60 to 64.</div>'; return; }
  box.innerHTML = '<div class="muted small pin-msg">Looking up ' + v + '...</div>';
  try {
    await Promise.all([loadShapes(), loadDirectory()]);
    const [{ data }, nom] = await Promise.all([sb.functions.invoke('pin-lookup', { body: { pin: v } }).catch(() => ({ data: null })), nomi('limit=1&postalcode=' + v).catch(() => [])]);
    if (seq !== pinSeq) return;
    if (data && data.box) { pinRender(v, data, false); return; } // already placed by someone
    const geo = { pin: v, district: data && data.district, localities: ((data && data.localities) || []).map(l => ({ ...l, tried: false })), box: nom[0] && nom[0].boundingbox ? nom[0].boundingbox.map(Number) : null, center: nom[0] ? [+nom[0].lat, +nom[0].lon] : null };
    if (!geo.box && !geo.localities.length) { box.innerHTML = '<div class="muted small pin-msg">PIN not found. Drop a pin instead.</div>'; return; }
    const todo = geo.localities.length && geo.box;
    pinRender(v, geo, !!todo);
    if (!todo) return;
    const [s1, n1, w1, e1] = geo.box, near = (la, lo) => la >= s1 - 0.03 && la <= n1 + 0.03 && lo >= w1 - 0.03 && lo <= e1 + 0.03;
    for (const l of geo.localities) { // one lookup a second, as OpenStreetMap asks
      await new Promise(r => setTimeout(r, 1100)); if (seq !== pinSeq) return;
      const hits = await nomi('limit=3&viewbox=76.2,13.6,80.4,8.0&bounded=1&q=' + encodeURIComponent(`${l.name}, ${l.district || geo.district || ''}, Tamil Nadu`)).catch(() => []);
      const p = hits.find(x => near(+x.lat, +x.lon)); l.tried = true; if (p) { l.lat = +(+p.lat).toFixed(5); l.lng = +(+p.lon).toFixed(5); }
      if (seq !== pinSeq) return; pinRender(v, geo, true);
    }
    if (seq !== pinSeq) return;
    pinRender(v, geo, false);
    sb.rpc('pin_geo_save', { p: v, d: { center: geo.center, box: geo.box, district: geo.district, localities: geo.localities.map(l => ({ name: l.name, lat: l.lat || null, lng: l.lng || null })) } }).then(() => {}, () => {});
  } catch (_) { if (seq === pinSeq) box.innerHTML = '<div class="muted small pin-msg">PIN search needs internet. Drop a pin instead.</div>'; }
});
let addrT = null, addrSeq = 0;
$('#inAddr').addEventListener('input', () => {
  clearTimeout(addrT); const q = $('#inAddr').value.trim(), seq = ++addrSeq;
  if (q.length < 3) { $('#addrRes').innerHTML = ''; return; }
  addrT = setTimeout(async () => {
    $('#addrRes').innerHTML = '<div class="muted small" style="padding:8px 2px">Searching...</div>';
    try {
      const near = here ? `&lat=${here.lat}&lon=${here.lng}` : '';
      const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=in&viewbox=76.2,13.6,80.4,8.0&bounded=1' + near + '&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } });
      const js = seq === addrSeq && res.ok ? await res.json() : [];
      if (seq !== addrSeq) return;
      $('#addrRes').innerHTML = js.length ? js.map((p, i) => `<button class="addr-hit" data-i="${i}"><b>${esc(p.name || p.display_name.split(',')[0])}</b><span class="muted small">${esc(p.display_name.split(',').slice(1, 4).join(',').trim())}</span></button>`).join('')
        : '<div class="muted small" style="padding:8px 2px">No match. Try a nearby landmark, or pick on the map.</div>';
      $('#addrRes').querySelectorAll('.addr-hit').forEach(b => b.onclick = () => {
        const p = js[+b.dataset.i];
        Object.assign(draft, { lat: +p.lat, lng: +p.lon, acc: null, byHand: true, mode: 'address', address: (q + ' · ' + p.display_name.split(',').slice(0, 3).join(',')).slice(0, 200) }); setLocMode('address', true);
        $('#addrRes').innerHTML = ''; renderWhere();
      });
    } catch (_) { if (seq === addrSeq) $('#addrRes').innerHTML = '<div class="muted small" style="padding:8px 2px">Search needs internet. Pick on the map instead.</div>'; }
  }, 700);
});
const HAS_LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|org|net|io|ly|me|co|app|xyz|link)\b)/i;
function renderCats() {
  $('#cats').innerHTML = CATS.map(c => `<button data-c="${c.id}" class="${draft.cat === c.id ? 'on' : ''}"><span class="cat-ic">${c.svg}</span><span class="cat-en">${esc(c.name)}</span><span class="cat-ta">${esc(c.ta)}</span></button>`).join('');
  $('#cats').querySelectorAll('button').forEach(b => b.onclick = () => { draft.cat = b.dataset.c; draft.catManual = true; draft.catGuessed = false; $('#formErr').textContent = ''; renderCats(); if (window.renderGuess) renderGuess(); });
  const n = $('#catNote');
  if (n) { n.hidden = draft.cat !== 'women'; n.innerHTML = 'In danger right now? <a href="tel:112"><b>Call 112</b></a> (or 181 women helpline) first.<br>Use this for unsafe spots: dark stretches, no patrol, harassment hotspots, broken lights near bus stops. Do not name or photograph any person.'; }
}
function renderPhotos() {
  const box = $('#photos'), add = box.querySelector('.add');
  box.querySelectorAll('.ph').forEach(e => e.remove());
  draft.photos.forEach((src, i) => {
    const d = document.createElement('div'); d.className = 'ph';
    d.innerHTML = `<img src="${src}" alt=""><button aria-label="Remove">✕</button>`;
    d.querySelector('button').onclick = () => { draft.photos.splice(i, 1); renderPhotos(); };
    box.insertBefore(d, add);
  });
  add.style.display = draft.photos.length >= MAX_PHOTOS ? 'none' : '';
}
// shrink each photo to at most 1600 px and re-encode as JPEG (also drops the original file's metadata)
function shrink(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', PHOTO_QUALITY));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that photo')); };
    img.src = url;
  });
}
// small copy that stays on the server after the full photo is archived
function thumbOf(dataUrl) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, THUMB_SIDE / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => res(null); img.src = dataUrl;
  });
}
$('#inPhoto').onchange = async e => {
  const files = [...e.target.files].slice(0, MAX_PHOTOS - draft.photos.length);
  for (const f of files) { try { draft.photos.push(await shrink(f)); } catch (err) { toast(err.message); } }
  e.target.value = ''; renderPhotos();
};
document.querySelectorAll('#since button').forEach(b => b.onclick = () => {
  draft.since = draft.since === b.dataset.v ? null : b.dataset.v;
  document.querySelectorAll('#since button').forEach(x => x.classList.toggle('on', x.dataset.v === draft.since));
});
function reportBlocked() {
  if (!me || me.active !== false) return false;
  $('#mTitle').textContent = 'Reporting is turned off';
  $('#mBody').innerHTML = '<p>Your reporting access has been turned off, so you cannot send new reports. You can still see the map and your old reports.</p><p class="muted small">Contact your admin to turn it back on.</p>';
  $('#mOk').style.display = 'none'; $('#mCancel').textContent = 'OK';
  $('#mCancel').onclick = () => { $('#modal').classList.remove('on'); $('#mOk').style.display = ''; $('#mCancel').textContent = 'Cancel'; };
  $('#modal').classList.add('on'); return true;
}
window.reportBlocked = reportBlocked;
// opt (only from our own code, a click hands in an event): { at: [lat, lng] } place it by hand starting there, { gps: true } use my location even if the pin is out
function startReport(opt) { if (reportBlocked()) return; newDraft(opt && (opt.at || opt.gps) ? opt : {}); show('scrForm'); if (draft.mode === 'map' && !draft.placed) setTimeout(() => openPicker(), 150); }
window.startReport = startReport;
$('#btnReport').onclick = startReport;
$('#btnNewBug').onclick = startReport;

function newId(t) {
  const d = new Date(t), p = n => String(n).padStart(2, '0');
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TNB-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rnd}`;
}
$('#btnSave').onclick = async () => {
  draft.note = $('#inNote').value.trim();
  if (draft.note.trim().length < 8) { $('#formErr').textContent = 'Tell us in a line what the problem is (at least a few words). A photo, voice note or video helps, but is optional.'; $('#inNote') && $('#inNote').focus(); return; }
  if (HAS_LINK.test(draft.note)) { $('#formErr').textContent = 'Links are not allowed in the note. Describe it in words.'; return; }
  if (draft.mode === 'address' && !draft.address) { $('#formErr').textContent = 'Pick one of the address matches, or choose another way to set the spot.'; return; }
  if (draft.mode === 'gps' && !here) { $('#formErr').textContent = 'No location fix yet. Drop a pin instead.'; return; }
  if (draft.mode === 'pin' && !draft.placed) { $('#formErr').textContent = 'Place the pin on the map for this PIN code.'; return; }
  if (draft.mode === 'map' && !draft.placed) { $('#formErr').textContent = 'Drop the pin on the map first.'; return; }
  if (draft.mode === 'gps' && draft.acc > ROUGH_M) { $('#formErr').textContent = 'Your location is too rough to pick the constituency. Drop a pin.'; return; }
  if (typeof acAt === 'function' && DIR.byAc && DIR.byAc.size && !acAt(draft.lat, draft.lng)) { $('#formErr').textContent = 'This spot is outside the Tamil Nadu constituency map.'; return; }
  const t = Date.now();
  // ward: what the ward map says at the pin (wardMap), and what the reporter kept or picked by hand (ward)
  const wardMap = window.wardKeyAt ? wardKeyAt(draft.lat, draft.lng) : null;
  const r = { id: newId(t), time: t, cat: draft.cat, note: draft.note, since: draft.since,
    lat: +draft.lat.toFixed(6), lng: +draft.lng.toFixed(6), acc: draft.acc, byHand: draft.byHand, mode: draft.mode, address: draft.address,
    ward: draft.ward || (draft.wardByHand ? null : wardMap) || null, wardMap, photos: draft.photos,
    urgent: !!draft.urgent, urgentWhy: draft.urgentWhy || null, urgentBy: draft.urgentBy || null, catGuessed: !!draft.catGuessed,
    media: [],
    status: 'pending', app: VERSION, uid: me && me.id };
  if (!r.cat) r.cat = 'other';
  r.media = (draft.media || []).map((m, i) => ({ kind: m.kind, type: m.type, blob: m.blob, path: `${r.id}/${me && me.id}-report-${i}.${m.ext}` }));
  try { await db.put(r); } catch { $('#formErr').textContent = 'Could not save. Is the phone storage full?'; return; }
  stack.length = 1; show('scrMap', false); refreshCount();
  clearPin(); // the pin has done its job: the next report starts from your own location again
  toast('Sending...');
  const sent = await upload(r);
  if (sent && window.sentSheet) sentSheet(r); else toast(sent ? 'Report sent. Thank you.' : 'Saved. It will send when there is signal.', 3000);
};

/* ---------- upload to the server ----------
 * Photos go to the private "photos" bucket under the user's own folder, then the report row.
 * The AI category check (Gemini) will run on the server after the row arrives, never in the app.
 */
function dataUrlToBlob(u) {
  const b = atob(u.split(',')[1]), a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return new Blob([a], { type: 'image/jpeg' });
}
let uploading = false;
async function upload(r) {
  if (!me || !navigator.onLine) return false;
  try {
    const paths = [], thumbs = [];
    for (let i = 0; i < r.photos.length; i++) {
      const path = `${me.id}/${r.id}-${i + 1}.jpg`;
      const { error } = await sb.storage.from('photos').upload(path, dataUrlToBlob(r.photos[i]), { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
      paths.push(path);
      const t = await thumbOf(r.photos[i]);
      if (t) {
        const tp = `${me.id}/${r.id}-${i + 1}-thumb.jpg`;
        const { error: te } = await sb.storage.from('photos').upload(tp, dataUrlToBlob(t), { contentType: 'image/jpeg', upsert: true });
        if (!te) thumbs.push(tp);
      }
    }
    if (r.street === undefined && window.streetAt) { r.street = await streetAt(r.lat, r.lng); await db.put(r).catch(() => {}); }
    const { error } = await sb.from('reports').insert({
      id: r.id, reported_at: new Date(r.time).toISOString(), category: r.cat, note: r.note || null, since: r.since || null,
      lat: r.lat, lng: r.lng, accuracy_m: r.acc, placed_by_hand: r.byHand, photos: paths, thumbs, app_version: r.app,
      ...(r.mode ? { loc_mode: r.mode } : {}), ...(r.address ? { address_text: r.address } : {}),
      ...(r.ward ? { ward: r.ward } : {}), ...(r.wardMap ? { ward_map: r.wardMap } : {}), ...(r.street ? { street: r.street } : {}),
      ...(r.media && r.media.length ? { media: r.media.map(m => ({ path: m.path, kind: m.kind })) } : {}),
      ...(r.urgent ? { reported_urgent: true, urgent_reason: r.urgentWhy, ...(r.urgentBy ? { urgent_by: r.urgentBy } : {}) } : {}), ...(r.catGuessed ? { cat_guessed: true } : {}),
    });
    if (error && error.code !== '23505') throw error; // 23505 = already on the server from an earlier try
    if (window.uploadReportMedia) await uploadReportMedia(r);
    if (window.stepsFor) sb.rpc('seed_steps', { p_report: r.id, p_steps: stepsFor({ id: r.id, category: r.cat, lat: r.lat, lng: r.lng, ward: r.ward }) }).then(() => {}, () => {});
    r.status = 'sent'; r.sentAt = Date.now(); delete r.err; await db.put(r); refreshCount();
    return true;
  } catch (e) {
    r.err = (e && e.message) || String(e); await db.put(r).catch(() => {});
    return false;
  }
}
async function retryPending() {
  if (uploading || !me) return; uploading = true;
  try {
    const all = await db.all();
    let n = 0;
    for (const r of all) if (r.status === 'pending' && (!r.uid || r.uid === me.id) && await upload(r)) n++;
    if (n) toast(`${n} saved report${n > 1 ? 's' : ''} sent`);
  } finally { uploading = false; }
}
window.addEventListener('online', retryPending);

/* ---------- sending ---------- */
function reportText(r) {
  const c = catOf(r.cat), d = new Date(r.time);
  return [
    `TN Bug Sheet report ${r.id}`,
    `Bug: ${c.name}`,
    r.note ? `Note: ${r.note}` : null,
    r.since ? `Since: ${SINCE[r.since]}` : null,
    `Location: ${r.lat}, ${r.lng}` + (r.byHand ? ' (placed by hand)' : r.acc ? ` (about ${r.acc} m)` : ''),
    `Map: https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=19/${r.lat}/${r.lng}`,
    `Time: ${d.toLocaleString('en-IN')}`,
    `Photos: ${r.photos.length}`,
    `App: ${r.app}`,
  ].filter(Boolean).join('\n');
}
function dataUrlToFile(u, name) {
  const [h, b] = u.split(','), bin = atob(b), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new File([a], name, { type: h.slice(5, h.indexOf(';')) });
}
async function shareReport(r) {
  const text = reportText(r);
  let ok = false;
  try {
    if (isAndroid) {
      window.TNB.share(text, JSON.stringify(r.photos.map(p => p.split(',')[1])), r.id);
      ok = true; // the share menu opened; we cannot see which app was picked
    } else if (navigator.canShare) {
      const files = r.photos.map((p, i) => dataUrlToFile(p, `${r.id}-${i + 1}.jpg`));
      const data = navigator.canShare({ files }) ? { text, files } : { text };
      await navigator.share(data); ok = true;
    } else {
      await navigator.clipboard.writeText(text); toast('Report text copied. Paste it in WhatsApp with the photos.'); ok = true;
    }
  } catch (e) { if (e && e.name !== 'AbortError') toast('Could not open the share menu'); }
  return ok;
}

/* ---------- list, detail, settings ---------- */
async function refreshCount() {
  const all = await db.all().catch(() => []);
  $('#cnt').textContent = all.length;
  return all;
}
const STATUS = { pending: 'Waiting to send', sent: 'Sent', new: 'Sent', submitted: 'Sent', approved: 'Approved', routed: 'Approved', filed: 'Complaint filed', escalated: 'Escalated', legal: 'Escalated', resolved: 'Fixed', rejected: 'Not taken up', duplicate: 'Already reported', closed: 'Closed' };
let serverStatus = {};
async function pullStatus() {
  if (!me) return;
  const { data } = await sb.from('reports').select('id,status,complaint_ref,reject_reason').eq('user_id', me.id).order('reported_at', { ascending: false }).limit(500);
  if (data) serverStatus = Object.fromEntries(data.map(x => [x.id, x]));
}
const stOf = r => r.status === 'pending' ? 'pending' : (serverStatus[r.id] ? serverStatus[r.id].status : 'sent');
async function renderList() {
  await pullStatus().catch(() => {});
  const all = await refreshCount();
  const fixed = all.filter(r => stOf(r) === 'resolved').length, waiting = all.filter(r => stOf(r) === 'pending').length;
  const banner = all.length ? `<div class="streak-banner"><div><div style="font-weight:800;font-size:15px">${all.length} report${all.length === 1 ? '' : 's'} · ${fixed} fixed</div>
    <div class="small muted">${waiting ? waiting + ' waiting to send' : 'All sent'} · என் புகார்கள்</div></div><span class="tag ${fixed ? 'resolved' : 'filed'}">${fixed ? 'Getting things fixed' : 'On the way'}</span></div>` : '';
  $('#list').innerHTML = all.length ? banner + all.map(r => {
    const c = catOf(r.cat), st = stOf(r);
    return `<button class="item" data-id="${esc(r.id)}"><div class="item-top">${r.photos[0] ? `<img src="${r.photos[0]}" alt="">` : `<span class="noimg">${(r.media || []).some(m => m.kind === 'video') ? 'Video' : (r.media || []).length ? 'Voice' : 'Text'}</span>`}
      <div class="t"><div style="font-weight:700">${esc(c.name)}</div><div class="mono muted">${esc(r.id)}</div>
      <div class="muted small">${esc(r.note || new Date(r.time).toLocaleString('en-IN'))}</div></div>
      ${window.QN && QN.byReport.has(r.id) ? '<span class="tag need">Needs your reply</span>' : `<span class="tag ${st}">${STATUS[st]}</span>`}</div>${journeyHtml(st)}</button>`;
  }).join('') : '<div class="empty">No reports yet.<br>Tap "Report a bug" on the home screen.</div>';
  $('#list').querySelectorAll('.item').forEach(b => b.onclick = () => openOne(b.dataset.id));
}
// 4-step journey: sent, approved, complaint filed, fixed
function journeyHtml(st) {
  if (['rejected', 'duplicate', 'closed'].includes(st)) return '';
  const step = { pending: 0, sent: 1, new: 1, submitted: 1, approved: 2, routed: 2, filed: 3, escalated: 3, legal: 3, resolved: 4 }[st] ?? 1;
  return `<div class="journey">${[1, 2, 3, 4].map(i => `<span class="${i < step || st === 'resolved' ? 'done' : i === step ? 'now' : ''}"></span>`).join('')}</div>`;
}
async function openOne(id) {
  const r = await db.get(id); if (!r) return;
  const c = catOf(r.cat);
  $('#oneTitle').textContent = r.id;
  $('#one').innerHTML = `
    <div class="kv">
      <div>Bug</div><div>${c.icon} ${esc(c.name)}</div>
      <div>Note</div><div>${esc(r.note || '-')}</div>
      <div>Since</div><div>${esc(SINCE[r.since] || '-')}</div>
      <div>Location</div><div>${r.lat}, ${r.lng}${r.byHand ? ' (by hand)' : r.acc ? ` (~${r.acc} m)` : ''}</div>
      ${r.address ? `<div>Address</div><div>${esc(r.address)}</div>` : ''}
      <div>Time</div><div>${new Date(r.time).toLocaleString('en-IN')}</div>
      <div>Status</div><div>${STATUS[stOf(r)]}${r.sentAt ? ', sent ' + new Date(r.sentAt).toLocaleString('en-IN') : ''}</div>
      ${serverStatus[r.id] && serverStatus[r.id].reject_reason ? `<div>Reason</div><div>${esc(serverStatus[r.id].reject_reason)}</div>` : ''}
      ${serverStatus[r.id] && serverStatus[r.id].complaint_ref ? `<div>Complaint</div><div>${esc(serverStatus[r.id].complaint_ref)}</div>` : ''}
      ${r.status === 'pending' && r.err ? `<div>Last try</div><div class="danger">${esc(r.err)}</div>` : ''}
    </div>
    <div class="big">${r.photos.map(p => `<img src="${p}" alt="">`).join('')}</div>
    <div id="oneQ"></div>
    <div id="oneSteps"></div>
    ${r.status === 'pending' ? '<button class="cta static" id="oneSend">Send now</button>' : ''}
    <button class="cta static ghost" id="oneShare">Share on WhatsApp</button>
    <button class="cta static ghost danger" id="oneDel">Delete from this phone</button>`;
  if ($('#oneSend')) $('#oneSend').onclick = async () => { toast(await upload(r) ? 'Sent' : 'Could not send yet'); openOne(id); };
  $('#oneShare').onclick = () => shareReport(r);
  if (r.status !== 'pending' && window.qThread) qThread(r.id, $('#oneQ'));
  const ss = serverStatus[r.id] && serverStatus[r.id].status;
  if (r.status !== 'pending' && window.renderSteps && !['rejected', 'duplicate'].includes(ss)) renderSteps($('#oneSteps'), { id: r.id, category: r.cat, lat: r.lat, lng: r.lng, ward: r.ward });
  $('#oneDel').onclick = async () => {
    if (!confirm('Delete this report from the phone?')) return;
    await db.del(id); back(); renderList();
  };
  show('scrOne');
}
function openSettings() { $('#adminBox').hidden = !(me && me.role === 'admin'); if (me && me.role === 'admin') backupStats(); $('#acct').textContent = me ? `Signed in as ${me.email}` + (me.role === 'admin' ? ' (admin)' : '') : 'Not signed in'; show('scrSet'); }
$('#btnList').onclick = () => { renderList(); show('scrList'); if (window.loadQuestions) loadQuestions().then(renderList, () => {}); };
$('#btnSettings').onclick = openSettings;
$('#btnSaveSet').onclick = back;
$('#btnSignOut').onclick = async () => {
  const pending = (await db.all()).filter(r => r.status === 'pending').length;
  if (pending && !confirm(`${pending} report(s) are not sent yet. They stay on this phone and send after you sign in again. Sign out?`)) return;
  await sb.auth.signOut(); me = null; if (window.stopViewAs) { viewAs = null; renderViewAsBar(); } stack.length = 1; showLogin();
};

/* ---------- admin: back up photos to this phone, then free server space ---------- */
const blobToB64 = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1]); f.onerror = rej; f.readAsDataURL(b); });
function saveToPhone(name, blob) {
  if (isAndroid && TNB.saveFile) return blobToB64(blob).then(b64 => { if (!TNB.saveFile(name, b64)) throw new Error('Could not save ' + name); });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return Promise.resolve();
}
async function backupStats() {
  const notBacked = await sb.from('reports').select('id', { count: 'exact', head: true }).is('photos_backed_up_at', null);
  const cutoff = new Date(Date.now() - KEEP_ONLINE_DAYS * 864e5).toISOString();
  const removable = await sb.from('reports').select('id', { count: 'exact', head: true }).not('photos_backed_up_at', 'is', null).is('photos_removed_at', null).lt('photos_backed_up_at', cutoff);
  $('#bkStat').textContent = CLEARING_ON ? `${notBacked.count ?? '?'} report(s) not backed up yet. ${removable.count ?? '?'} backed up more than ${KEEP_ONLINE_DAYS} days ago, ready to clear from the server.`
    : `${notBacked.count ?? '?'} report(s) not backed up yet. Clearing old photos from the server is off for now, so everything stays online.`;
  const fb = $('#btnFree'); if (fb) fb.hidden = !CLEARING_ON;
}
$('#btnBackup').onclick = async () => {
  const btn = $('#btnBackup'); btn.disabled = true;
  try {
    const { data, error } = await sb.from('reports').select('id,photos').is('photos_backed_up_at', null).order('received_at').limit(200);
    if (error) throw error;
    let done = 0, files = 0;
    for (const rep of data) {
      for (const path of rep.photos) {
        const { data: blob, error: de } = await sb.storage.from('photos').download(path);
        if (de) throw de;
        await saveToPhone(path.split('/').pop(), blob); files++;
        btn.textContent = `Saving... ${files} photo(s)`;
      }
      const { error: ue } = await sb.from('reports').update({ photos_backed_up_at: new Date().toISOString() }).eq('id', rep.id);
      if (ue) throw ue; done++;
    }
    toast(done ? `${files} photo(s) from ${done} report(s) saved to Pictures/TN Bug Sheet` : 'Nothing new to back up', 3500);
  } catch (e) { toast('Backup stopped: ' + (e.message || e), 4000); }
  btn.disabled = false; btn.textContent = 'Back up photos to this phone'; backupStats();
};
$('#btnFree').onclick = async () => {
  if (!CLEARING_ON) return toast('Clearing is off for now. Every photo stays online.');
  const cutoff = new Date(Date.now() - KEEP_ONLINE_DAYS * 864e5).toISOString();
  const { data, error } = await sb.from('reports').select('id,photos').not('photos_backed_up_at', 'is', null).is('photos_removed_at', null).lt('photos_backed_up_at', cutoff).limit(500);
  if (error) { toast(error.message); return; }
  if (!data.length) { toast(`Nothing to clear. Photos stay online ${KEEP_ONLINE_DAYS} days after backup.`); return; }
  const n = data.reduce((t, x) => t + x.photos.length, 0);
  if (!confirm(`Delete ${n} full-size photo(s) of ${data.length} report(s) from the server? They are on this phone. Thumbnails stay online.`)) return;
  for (const rep of data) {
    const { error: re } = await sb.storage.from('photos').remove(rep.photos);
    if (re) { toast('Stopped: ' + re.message); break; }
    await sb.from('reports').update({ photos_removed_at: new Date().toISOString() }).eq('id', rep.id);
  }
  toast('Server space freed'); backupStats();
};


/* ---------- loader: a little bug walking in a circle, leaving footprints that fade ---------- */
const BUG_SVG = '<svg viewBox="0 0 64 48" class="bug" aria-hidden="true">'
  + '<g class="legs-a" stroke="#222" stroke-width="2.4" stroke-linecap="round" fill="none"><path d="M24 20 L14 12"/><path d="M32 24 L32 10"/><path d="M40 28 L50 20"/><path d="M24 30 L14 38"/><path d="M32 32 L32 44"/><path d="M40 34 L50 42"/></g>'
  + '<path d="M50 22 q8 -8 10 -14 M50 26 q9 -2 12 -8" stroke="#222" stroke-width="2" stroke-linecap="round" fill="none"/>'
  + '<ellipse cx="32" cy="27" rx="17" ry="12" fill="#e8475f"/>'
  + '<path d="M32 15 V39" stroke="#fff" stroke-width="2" opacity=".85"/>'
  + '<circle cx="25" cy="23" r="2.6" fill="#fff" opacity=".9"/><circle cx="38" cy="31" r="2.6" fill="#fff" opacity=".9"/><circle cx="26" cy="32" r="2" fill="#fff" opacity=".9"/>'
  + '<circle cx="50" cy="25" r="6" fill="#222"/></svg>';
// The bug wanders a lumpy loop at an uneven pace (never a perfect circle), wiggling as it goes and leaving footprints that fade.
document.querySelectorAll('.hero-bug').forEach(e => { e.innerHTML = BUG_SVG; });
window.loaderHtml = (text = 'Loading...') => `<div class="loader" role="status"><div class="ring"><div class="crawler">${BUG_SVG}</div></div><div class="ltext">${text}</div></div>`;
(function () {
  const st = new WeakMap(), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pathAt = (q, s) => { // lumpy closed loop around the centre; s = per-loader seed
    const r = 34 * (1 + 0.14 * Math.sin(3 * q + s) + 0.08 * Math.sin(5 * q + 2 * s) + 0.05 * Math.sin(7 * q + 3.1 * s));
    return [r * Math.sin(q), -r * Math.cos(q)]; // clockwise from the top
  };
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    document.querySelectorAll('.loader .ring').forEach(ring => {
      let o = st.get(ring);
      if (!o) { o = { q: Math.random() * 6.28, s: Math.random() * 6.28, t: 0, foot: 0, side: 1, px: null, py: null, bug: ring.querySelector('.crawler') }; st.set(ring, o); }
      o.t += dt;
      // uneven pace: strolls, hurries, nearly stops now and then
      const pace = Math.max(0.12, 0.75 + 0.45 * Math.sin(o.t * 1.3 + o.s) + 0.3 * Math.sin(o.t * 3.7) - (Math.sin(o.t * 0.9 + o.s) > 0.93 ? 0.7 : 0));
      if (!still) o.q += dt * 2.4 * pace;
      const [x, y] = pathAt(o.q, o.s), [nx, ny] = pathAt(o.q + 0.05, o.s);
      const wob = Math.sin(o.t * 2.1 + o.s) * 2.5; // drift sideways off the line a little
      const head = Math.atan2(ny - y, nx - x), wig = still ? 0 : Math.sin(o.t * 14) * 7 * pace + Math.sin(o.t * 2.3) * 6;
      const bx = x - Math.sin(head) * wob, by = y + Math.cos(head) * wob;
      o.bug.style.transform = `translate(${bx}px, ${by}px) rotate(${head * 57.3 + wig}deg)`;
      if (o.px !== null) o.foot += Math.hypot(bx - o.px, by - o.py);
      o.px = bx; o.py = by;
      if (o.foot > 8 && !still) { // drop a footprint, alternating left and right
        o.foot = 0; o.side = -o.side;
        const f = document.createElement('i'); f.className = 'step';
        f.style.transform = `translate(${bx - Math.sin(head) * 5 * o.side}px, ${by + Math.cos(head) * 5 * o.side}px) rotate(${head * 57.3 + 90}deg)`;
        ring.appendChild(f); setTimeout(() => f.remove(), 1400);
      }
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

/* ---------- sign in (email and password set by the admin) ---------- */
function showLogin() {
  hideBoot();
  $('#loginErr').textContent = '';
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 'scrLogin'));
}
const loginErr = t => { $('#loginErr').textContent = t; };
$('#btnSignIn').onclick = async () => {
  const email = toLogin($('#inEmail').value), password = $('#inPass').value;
  if (!validLogin(email)) { loginErr('Enter your email or 10-digit mobile number.'); return; }
  if (!password) { loginErr('Enter your password.'); return; }
  $('#btnSignIn').disabled = true; loginErr('');
  const { error } = await sb.auth.signInWithPassword({ email, password });
  $('#btnSignIn').disabled = false;
  if (error) { loginErr(error.status === 429 ? 'Too many tries. Wait a minute and try again.' : /invalid/i.test(error.message) ? 'Wrong email or password.' : error.message); return; }
  $('#inPass').value = ''; document.querySelectorAll('.pw input').forEach(i => i.type = 'password'); document.querySelectorAll('.pw-eye').forEach(b => b.textContent = 'Show');
  await afterSignIn();
};
/* ---------- show / hide on every password box ---------- */
document.querySelectorAll('input[type=password]').forEach(inp => {
  const wrap = document.createElement('div'); wrap.className = 'pw';
  inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
  const b = document.createElement('button'); b.type = 'button'; b.className = 'pw-eye'; b.textContent = 'Show';
  b.setAttribute('aria-label', 'Show password');
  b.onclick = () => { const hidden = inp.type === 'password'; inp.type = hidden ? 'text' : 'password'; b.textContent = hidden ? 'Hide' : 'Show'; b.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password'); inp.focus(); };
  wrap.appendChild(b);
});

/* ---------- onboarding: after the password is set in the browser ---------- */
const APK_URL = 'https://github.com/Samben-GT/TN-Bug-Sheet-Releases-/releases/latest/download/TN-Bug-Sheet.apk';
function showGetApp() {
  const ua = navigator.userAgent, android = /Android/i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const login = displayId((me && me.email) || $('#jEmail').value || '');
  $('#getAppBody').innerHTML = android ? `
    <h2 class="join-h">Get the app <span class="ta">செயலியை பெறுக</span></h2>
    <p class="muted">Your account is ready. The Android app is the best way to report: faster camera, works offline, and alerts when your bug moves.</p>
    <a class="cta static" href="${APK_URL}">Download the Android app</a>
    <ol class="steps">
      <li>Open the downloaded file <b>TN-Bug-Sheet.apk</b> (from the notification or your Downloads).</li>
      <li>If Android asks, allow your browser to <b>install unknown apps</b>, then tap Install. It's our own app, not on the Play Store yet.</li>
      <li>Open <b>TN Bug Sheet</b> and sign in with <b>${esc(login)}</b> and the password you just set.</li>
    </ol>` : ios ? `
    <h2 class="join-h">Add it to your home screen</h2>
    <p class="muted">Your account is ready. On iPhone the app runs from your home screen, no App Store needed.</p>
    <ol class="steps">
      <li>Open this page in <b>Safari</b> (not inside WhatsApp): tap the menu and choose Open in Safari.</li>
      <li>Tap the <b>Share</b> button (square with an arrow), then <b>Add to Home Screen</b>, then Add.</li>
      <li>Open <b>TN Bug Sheet</b> from your home screen and sign in with <b>${esc(login)}</b> and the password you just set.</li>
    </ol>` : `
    <h2 class="join-h">You're all set</h2>
    <p class="muted">Your account is ready. On a phone, open this link to get the app. On a computer you can use it right here.</p>`;
  show('scrGetApp');
}
$('#btnGetAppSkip').onclick = () => afterSignIn();

/* ---------- invite: first sign-in sets the password ---------- */
const joinErr = t => { $('#joinErr').textContent = t; };
// password strength and match hints on the invite page
function joinMeter() {
  const p = $('#jPass').value, p2 = $('#jPass2').value;
  let n = p.length >= 8 ? 1 : 0; if (p.length >= 12) n++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) n++; if (/\d/.test(p) || /[^A-Za-z0-9]/.test(p) || /\s/.test(p)) n++;
  if (p.length < 8) n = 0;
  document.querySelectorAll('.pw-meter i').forEach((i, k) => i.className = k < n ? 'on s' + n : '');
  $('#jStrength').textContent = !p ? 'Use 8 or more characters. A short sentence works well.' : p.length < 8 ? `${8 - p.length} more character${8 - p.length === 1 ? '' : 's'}` : ['', 'OK', 'Good', 'Strong', 'Very strong'][n];
  $('#jMatch').textContent = !p2 ? '' : p2 === p ? '\u2713 Passwords match' : 'Passwords do not match yet';
  $('#jMatch').className = 'small ' + (!p2 ? 'muted' : p2 === p ? 'okt' : 'muted');
}
['jPass', 'jPass2'].forEach(id => $('#' + id).addEventListener('input', joinMeter));
function showJoin(email = '', code = '') {
  hideBoot();
  $('#jEmail').value = displayId(email); $('#jCode').value = code; $('#jPass').value = ''; $('#jPass2').value = ''; joinErr('');
  $('#jEmail').readOnly = !!email;
  const fromLink = !!(email && code); $('#jCodeRow').hidden = fromLink; $('#jCodeOk').hidden = !fromLink;
  joinMeter();
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === 'scrJoin'));
  (email && code ? $('#jPass') : $('#jEmail')).focus();
}
function clearInviteFromUrl() { try { history.replaceState(null, '', location.pathname); } catch {} }
$('#btnHaveInvite').onclick = () => { const v = $('#inEmail').value.trim(); showJoin(v ? toLogin(v) : ''); };
$('#btnJoinBack').onclick = () => { clearInviteFromUrl(); showLogin(); };
$('#btnJoin').onclick = async () => {
  const email = toLogin($('#jEmail').value), code = $('#jCode').value.trim().toUpperCase();
  const password = $('#jPass').value;
  if (!validLogin(email)) return joinErr('Enter the email or mobile number the invite was for.');
  if (!code) return joinErr('Enter the invite code from your invite.');
  if (password.length < 8) return joinErr('Password needs at least 8 characters.');
  if (password !== $('#jPass2').value) return joinErr('The two passwords do not match.');
  $('#btnJoin').disabled = true; joinErr('');
  try {
    const { error } = await sb.functions.invoke('claim-invite', { body: { email, code, password } });
    if (error) { let m = error.message; try { m = (await error.context.json()).error || m; } catch (_) {} throw new Error(m); }
    const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    clearInviteFromUrl(); $('#jPass').value = ''; $('#jPass2').value = '';
    toast('Password set. Welcome!');
    if (!window.TNB) { showGetApp(); return; } // in a browser: offer the Android app or the home-screen web app
    await afterSignIn();
  } catch (e) { joinErr(e.message || String(e)); }
  finally { $('#btnJoin').disabled = false; }
};
$('#inPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btnSignIn').click(); });
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' && !me) afterSignIn(); });

let signingIn = null;
function afterSignIn() { return signingIn || (signingIn = doSignIn().finally(() => { signingIn = null; })); }
async function doSignIn() {
  // A network blip must never sign anyone out: only a clear "not on the list" answer does.
  const { data, error: ue } = await sb.auth.getUser();
  if (ue && !(data && data.user)) {
    const s = (await sb.auth.getSession()).data.session;
    if (!s) { showLogin(); return; }
    data.user = s.user; // offline: carry on with the saved session
  }
  if (!data || !data.user) { showLogin(); return; }
  let { data: mem, error: me1 } = await sb.rpc('my_membership');
  if (me1) mem = store.get('mem-' + data.user.id, null); // offline: last known role
  else store.set('mem-' + data.user.id, mem);
  if (!mem && !me1) {
    showLogin();
    loginErr(`${displayId(data.user.email)} is not on the reporter list yet. Ask Sam to add it.`);
    await sb.auth.signOut(); return;
  }
  if (!mem) { showLogin(); loginErr('No connection. Check your internet and open the app again.'); return; }
  const role = mem.role, active = mem.active !== false;
  me = { id: data.user.id, email: data.user.email, role, active };
  $('#btnAdmin').hidden = role !== 'admin';
  // Reels approver: a login that only reviews social media reels, nothing else in the app
  if (role === 'approver') { stack.length = 1; if (window.openReels) openReels(); $('#btnRlOut').hidden = false; $('#btnRlOut').onclick = () => $('#btnSignOut').click(); hideBoot(); return; }
  stack.length = 1; show('scrMap', false);
  if (!map) initMap(); else setTimeout(() => map.invalidateSize(), 50);
  refreshCount(); retryPending();
  if (window.updateHereCard) setTimeout(window.updateHereCard, 400);
  sb.rpc('my_title').then(({ data: t }) => { if (t) { me.title = t; welcomeTitle(t); } }).catch(() => {});
  if (window.workAfterSignIn) workAfterSignIn().catch(() => {});
  if (window.loadQuestions) loadQuestions().catch(() => {});
  bootMsg('Loading your area...');
  if (window.openHome) setTimeout(() => Promise.race([Promise.resolve(openHome()), new Promise(r => setTimeout(r, 5000))]).catch(() => {}).finally(hideBoot), 0); else hideBoot();
}
// one welcome per app session for members with a title (e.g. CEO)
function welcomeTitle(t) {
  try { if (sessionStorage.getItem('tnb-welcomed')) return; sessionStorage.setItem('tnb-welcomed', '1'); } catch (_) {}
  const el = document.createElement('div'); el.className = 'titlewelcome';
  el.innerHTML = `<div class="tw-in"><div class="tw-big">${esc(t)} in the house</div><div class="tw-sub">Everyone look busy</div></div>`;
  el.onclick = () => el.remove(); document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200); setTimeout(() => el.remove(), 3800);
}

/* ---------- start ---------- */
$('#ver').textContent = VERSION + (window.TNB && TNB.version ? ' / ' + TNB.version() : '');
/* start-up screen: stays until the dashboard (or login) is ready, so no half-built screen flashes */
const BOOT = { t0: Date.now() };
function bootMsg(t) { const m = $('#bootMsg'); if (m) m.textContent = t; }
function hideBoot() { const b = $('#boot'); if (!b || !b.classList.contains('on')) return; const wait = Math.max(0, 450 - (Date.now() - BOOT.t0)); setTimeout(() => { b.classList.remove('on'); setTimeout(() => b.remove(), 400); }, wait); }
window.hideBoot = hideBoot;
setTimeout(() => bootMsg('Slow connection. Still loading...'), 6000);
setTimeout(hideBoot, 15000); // never trap anyone behind it
async function start() {
  const q = new URLSearchParams(location.search);
  const { data } = await sb.auth.getSession();
  if (q.get('invite')) {
    // reopening an old invite link (or a home-screen shortcut saved from it) must not throw a signed-in person out
    if (data && data.session) { history.replaceState(null, '', location.pathname); await afterSignIn(); return; }
    showJoin(q.get('invite').toLowerCase(), (q.get('code') || '').toUpperCase()); return;
  }
  if (data && data.session) { bootMsg('Signing you in...'); await afterSignIn(); } else showLogin();
}
$('#btnAgree').onclick = () => { store.set('agreed', 1); $('#consent').classList.remove('on'); start(); };
if (store.get('agreed', 0)) start(); else { hideBoot(); $('#consent').classList.add('on'); }
refreshCount();
