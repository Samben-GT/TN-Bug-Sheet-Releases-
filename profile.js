/* Reporter profile: contact email, residence (constituency and area name only, never a street address) and the
   home area the dashboard opens on. Residence is visible only to the reporter and admins. */
const PROF = { row: null, loaded: false };
async function loadProfile(force) {
  if (!me) return null;
  if (PROF.loaded && !force) return PROF.row;
  try {
    const { data, error } = await sb.from('reporter_profiles').select('email,email_verified_at,residence_ac,residence_area,home_ac,home_ward,public_profile,contact_public,public_name,phone,gender').eq('user_id', me.id).maybeSingle();
    if (error) throw error;
    PROF.row = data; PROF.loaded = true; store.set('prof-' + me.id, data);
  } catch (_) { PROF.row = store.get('prof-' + me.id, null); } // offline: last saved copy, so the dashboard still opens on home
  return PROF.row;
}
window.loadProfile = loadProfile;
// the area the dashboard opens on: chosen home area, else residence
function homeAc() { const r = PROF.row; return r ? (r.home_ac || r.residence_ac || null) : null; }
window.homeAc = homeAc;
// a point inside a constituency, for the police lookup and the map
function acPoint(ac) {
  const s = DIR.shapes && DIR.shapes.find(x => x.ac === ac); if (!s) return null;
  const ring = s.polys.map(p => p[0]).sort((a, b) => b.length - a.length)[0];
  let x = 0, y = 0; ring.forEach(([lng, lat]) => { x += lng; y += lat; }); x /= ring.length; y /= ring.length;
  if (acAt(y, x) === ac) return [y, x];
  for (const [lng, lat] of ring) { const t = [(lat + y) / 2, (lng + x) / 2]; if (acAt(t[0], t[1]) === ac) return t; } // pull a vertex towards the middle
  return [(s.box[1] + s.box[3]) / 2, (s.box[0] + s.box[2]) / 2];
}
window.acPoint = acPoint;

const acOptions = (sel, none) => `<option value="">${none}</option>` + [...DIR.acs].sort((a, b) => a.name.localeCompare(b.name))
  .map(a => `<option value="${a.ac_no}" ${+sel === a.ac_no ? 'selected' : ''}>${esc(a.name)} (${a.ac_no}) · ${esc(a.district)}</option>`).join('');

async function openProfile() {
  show('scrProfile');
  const box = $('#profBody'); box.innerHTML = loaderHtml('Loading...');
  try { await Promise.all([loadDirectory(), loadShapes(), loadProfile(true), loadCouncillors(), pilotOn()]); } catch (_) {}
  const r = PROF.row || {}, login = displayId(me.email), phone = isPhoneLogin(me.email);
  const m = (await sb.rpc('my_membership').then(x => x.data, () => null)) || {};
  box.innerHTML = `
    <div class="prof-head">${avatar('', m.name || login)}<div><div class="prof-name">${esc(m.name || login)}</div>
      <div class="muted small">${esc(m.title || ({ admin: 'Admin', rm: 'Relationship manager', reporter: 'Reporter' }[me.role] || me.role))}${m.patch ? ' · ' + esc(m.patch) : ''}${me.active === false ? ' · <b class="danger">reporting off</b>' : ''}</div></div></div>
    <h3>Contact</h3>
    <div class="kv">
      <div>${phone ? 'Phone' : 'Sign-in'}</div><div>${esc(login)} <span class="tag resolved">Confirmed</span><div class="muted small">Your sign-in. Confirmed when your admin invited you.</div></div>
    </div>
    <label class="fl">Email <span class="muted small">(optional)</span></label>
    <input id="pfEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(r.email || '')}">
    <p class="muted small">${r.email ? (r.email_verified_at ? '<span class="tag resolved">Verified</span> ' : '<span class="tag pending">Not verified yet</span> ') : ''}Used to reach you about your reports when you are not in the app. Email verification is coming next.</p>
    <h3>Where you live</h3>
    <p class="muted small" style="margin-top:-4px">Only the constituency and area name, never your street address. Only admins can see it.</p>
    <label class="fl">Constituency</label>
    <select id="pfRes">${acOptions(r.residence_ac, 'Choose your constituency')}</select>
    <button type="button" class="linkbtn" id="pfHere">Use my current location</button>
    <label class="fl">Area <span class="muted small">(optional)</span></label>
    <input id="pfArea" maxlength="60" placeholder="Chromepet, Hasthinapuram..." value="${esc(r.residence_area || '')}">
    <h3>Home area</h3>
    <p class="muted small" style="margin-top:-4px">The dashboard opens on this area. Change it if you cover a different area from where you live.</p>
    <select id="pfHome">${acOptions(r.home_ac, 'Same as where I live')}</select>
    <h3>Your ward</h3>
    <p class="muted small" style="margin-top:-4px">Tambaram Corporation only for now. Lets the app show your ward councillor and fill in the ward on your reports.</p>
    <select id="pfWard">${wardOptions(r.home_ward, 'Not in Tambaram Corporation / not sure')}</select>
    ${me.role === 'admin' ? '' : privacyForm(r)}
    <div id="pfErr" class="err"></div>
    <button class="cta static" id="pfSave">Save</button>
    <button class="cta static ghost" id="pfSet">Settings and sign out</button>`;
  $('#pfSet').onclick = () => openSettings();
  bindPrivacy();
  if (window.fillFaces) fillFaces(box);
  $('#pfHere').onclick = () => {
    const use = (lat, lng) => { const ac = acAt(lat, lng); if (ac) { $('#pfRes').value = ac; toast('Set to ' + DIR.byAc.get(ac).name); } else toast('Your location is outside the constituency map'); };
    if (here && here.acc <= ROUGH_M) return use(here.lat, here.lng);
    if (!navigator.geolocation) return toast('Location is not available');
    toast('Finding you...');
    navigator.geolocation.getCurrentPosition(p => p.coords.accuracy <= ROUGH_M ? use(p.coords.latitude, p.coords.longitude) : toast('Location too rough. Pick from the list.'), () => toast('Location is off. Pick from the list.'), { enableHighAccuracy: true, timeout: 15000 });
  };
  $('#pfSave').onclick = async () => {
    const email = $('#pfEmail').value.trim(), res = +$('#pfRes').value || null, home = +$('#pfHome').value || null, ward = $('#pfWard').value || null, area = $('#pfArea').value.trim() || null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('#pfErr').textContent = 'That email does not look right.'; return; }
    if (area && /\d{2,}/.test(area)) { $('#pfErr').textContent = 'Area name only, please. No door or street numbers.'; return; }
    const pv = privacyValues(); if (pv.error) { $('#pfErr').textContent = pv.error; return; }
    $('#pfSave').disabled = true;
    const { error } = await sb.from('reporter_profiles').upsert({ user_id: me.id, email: email || null, residence_ac: res, residence_area: area, home_ac: home, home_ward: ward, ...pv }, { onConflict: 'user_id' });
    $('#pfSave').disabled = false;
    if (error) { $('#pfErr').textContent = error.message; return; }
    await loadProfile(true); if (typeof HOME !== 'undefined') HOME.view = null;
    toast('Profile saved'); back();
  };
}
window.openProfile = openProfile;
$('#btnProfile').onclick = () => openProfile();
