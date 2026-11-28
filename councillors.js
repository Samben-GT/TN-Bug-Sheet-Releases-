/* Ward councillors. Tambaram City Municipal Corporation (70 wards) for now, read in full from the corporation's own
   councillor page. The ward of a spot comes from the ward map traced from the corporation's city map (directory.js,
   wardKeyAt); people can still correct it by hand, and the map's answer is kept with the report (reports.ward_map)
   so a wrong border shows up as a disagreement. Greater Chennai councillors come next. */
const COUN = { rows: null };
const TCMC_ACS = new Set([30, 31]); // Pallavaram, Tambaram assembly seats - the corporation sits inside these
const CORP_NAME = { TCMC: 'Tambaram Corporation', GCC: 'Greater Chennai Corporation' };
async function loadCouncillors() {
  if (COUN.rows) return COUN.rows;
  try {
    const { data, error } = await sb.from('councillors').select('corp,ward,zone,name,party,phone,status,note,source_url,checked_on').order('ward');
    if (error) throw error;
    COUN.rows = data || []; store.set('coun', COUN.rows);
  } catch (_) { COUN.rows = store.get('coun', []); }
  return COUN.rows;
}
window.loadCouncillors = loadCouncillors;
const wardKey = (corp, ward) => corp + '-' + ward;
function councillorFor(key) {
  if (!key || !COUN.rows) return null;
  const [corp, w] = key.split('-'); return COUN.rows.find(r => r.corp === corp && r.ward === +w) || null;
}
window.councillorFor = councillorFor;
const wardLabel = key => { const c = councillorFor(key); return c ? `${CORP_NAME[c.corp] || c.corp}, Ward ${c.ward}` : ''; };
window.wardLabel = wardLabel;
// the ward of a report: what the reporter kept or picked, else what the ward map says at the pin
const wardOf = r => !r ? null : r.ward || (window.wardKeyAt && r.lat != null ? wardKeyAt(r.lat, r.lng) : null);
window.wardOf = wardOf;
// options grouped by zone; councillor name helps people who know their councillor but not their ward number
function wardOptions(sel, none) {
  const rows = (COUN.rows || []).filter(r => r.corp === 'TCMC'), zones = [...new Set(rows.map(r => r.zone))].sort();
  return `<option value="">${none}</option>` + zones.map(z => `<optgroup label="${esc(z)}">` + rows.filter(r => r.zone === z)
    .map(r => `<option value="${wardKey(r.corp, r.ward)}" ${sel === wardKey(r.corp, r.ward) ? 'selected' : ''}>Ward ${r.ward} · ${esc(cleanName(r.name))}</option>`).join('') + '</optgroup>').join('');
}
window.wardOptions = wardOptions;
const cleanName = n => (n || '').replace(/^(Tmt|Thiru|Selvi|Dr)\.?\s*/i, '').trim();
window.cleanName = cleanName;
// a councillor card: name, party, published number, source
function councillorCard(c) {
  if (!c) return '<p class="muted">Councillor not added yet.</p>';
  return `<div class="kv"><div>Councillor</div><div><b>${esc(cleanName(c.name))}</b></div>
    <div>Ward</div><div>Ward ${c.ward} · ${esc(c.zone || '')} · ${esc(CORP_NAME[c.corp] || c.corp)}</div>
    <div>Party</div><div>${c.party ? esc(c.party) : '<span class="muted">Not listed</span>'}</div>
    <div>Phone</div><div>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a> <span class="muted small">published by the corporation</span>` : `<span class="muted">${esc(c.note || 'Not listed')}</span>`}</div></div>
    <p class="muted small">Checked ${esc(c.checked_on || '')} · <a href="${esc(c.source_url || '#')}" target="_blank" rel="noopener">Source</a></p>`;
}
window.councillorCard = councillorCard;

// home screen: your councillor, or pick your ward
async function homeCouncillor() {
  await Promise.all([loadCouncillors(), window.loadLocal ? loadLocal().catch(() => {}) : null]);
  const saved = typeof PROF !== 'undefined' && PROF.row ? PROF.row.home_ward : null;
  // not saved yet: offer the ward the map gives for where you are (a good GPS fix), else for the spot the map card is about
  const spot = typeof here !== 'undefined' && here && here.acc <= 300 ? here : (typeof pin !== 'undefined' && pin ? pin.getLatLng() : null);
  const guess = !saved && spot && window.wardKeyAt ? wardKeyAt(spot.lat, spot.lng) : null;
  const key = saved || guess, c = councillorFor(key);
  $('#mTitle').textContent = c ? (saved ? 'Your ward councillor' : 'Ward councillor here') : 'Find your ward councillor';
  $('#mBody').innerHTML = `${c ? councillorCard(c) : '<p class="muted small">Tambaram Corporation only for now. Pick your ward, or look for your councillor\'s name.</p>'}
    ${guess && c ? `<p class="note">The ward map puts ${spot === here ? 'you' : 'the spot on the map'} in Ward ${c.ward}. If this is your home ward, tap Save ward. If not, choose yours below.</p>` : ''}
    <label class="fl">${saved ? 'Change your ward' : 'Your ward'}</label>
    <select id="hcWard">${wardOptions(key, 'Choose your ward')}</select>
    <p class="muted small">This is saved to your profile so the app knows your ward. Only you and admins see it.</p>
    <div id="hcErr" class="err"></div>`;
  const close = () => { $('#modal').classList.remove('on'); $('#mOk').style.display = ''; $('#mOk').textContent = 'OK'; $('#mCancel').textContent = 'Cancel'; };
  $('#mOk').style.display = ''; $('#mOk').textContent = 'Save ward'; $('#mCancel').textContent = 'Close';
  $('#mCancel').onclick = close;
  $('#mOk').onclick = async () => {
    const v = $('#hcWard').value || null;
    const { error } = await sb.from('reporter_profiles').upsert({ user_id: me.id, home_ward: v }, { onConflict: 'user_id' });
    if (error) { $('#hcErr').textContent = error.message; return; }
    await loadProfile(true); close(); toast(v ? 'Ward saved' : 'Ward cleared'); if (window.renderHome) renderHome();
  };
  $('#modal').classList.add('on');
}
window.homeCouncillor = homeCouncillor;

// report form: the ward under "Will be filed in". Inside the Tambaram Corporation ward map the ward comes from the report's
// spot and follows it when the spot moves. The reporter can still pick another ward by hand; the map's answer goes with the report too.
function renderWardRow(ac) {
  const box = $('#wardRow'); if (!box) return;
  const mapOn = typeof LOCAL !== 'undefined' && !!LOCAL.tcmc, wn = k => k ? k.split('-')[1] : '';
  const guess = draft && ac && window.wardKeyAt ? wardKeyAt(draft.lat, draft.lng) : null;
  if (!draft || !ac || !(guess || TCMC_ACS.has(ac)) || !COUN.rows || !COUN.rows.length) { box.hidden = true; box.innerHTML = ''; if (draft) { draft.ward = null; draft.wardMap = null; draft.wardByHand = false; } return; }
  draft.wardMap = guess;
  if (draft.wardByHand && draft.wardHandAt !== guess) draft.wardByHand = false;       // the spot moved into another ward: start again from the map
  if (!draft.wardByHand) draft.ward = mapOn ? guess : (draft.ward === undefined ? (PROF.row && PROF.row.home_ward) || null : draft.ward);
  const c = councillorFor(draft.ward);
  const coun = c ? `Councillor: ${esc(cleanName(c.name))}${c.party ? ' · ' + esc(c.party) : ''}` : '';
  const hint = !mapOn ? coun
    : !guess ? 'This spot is outside the Tambaram Corporation ward map. Pick a ward only if you are sure it is inside the corporation.'
    : draft.ward === guess ? `From the ward map at this spot.${coun ? ' ' + coun + '.' : ''} Change it if you know the ward is different.`
    : `${draft.ward ? 'You picked Ward ' + wn(draft.ward) : 'You chose Not sure'}. The ward map says Ward ${wn(guess)} here. We keep both, so the map can be corrected.${draft.ward && coun ? ' ' + coun + '.' : ''}`;
  box.hidden = false;
  box.innerHTML = `<label class="fl">Ward <span class="muted small">(helps us reach the councillor and the right zone office)</span></label>
    <select id="inWard">${wardOptions(draft.ward, guess ? 'Not sure' : 'Not sure / outside the corporation')}</select>
    ${hint ? `<div class="muted small">${hint}</div>` : ''}`;
  $('#inWard').onchange = e => { draft.ward = e.target.value || null; draft.wardByHand = true; draft.wardHandAt = guess; renderWardRow(ac); };
}
window.renderWardRow = renderWardRow;

// street name for the record, looked up on the phone when the report is sent (OpenStreetMap)
async function streetAt(lat, lng) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' }, signal: ctl.signal });
    clearTimeout(t); if (!r.ok) return null;
    const a = (await r.json()).address || {};
    const road = a.road || a.pedestrian || a.residential || a.footway || null, area = a.neighbourhood || a.suburb || a.quarter || a.village || a.town || null;
    return [road, area].filter(Boolean).join(', ').slice(0, 120) || null;
  } catch (_) { return null; }
}
window.streetAt = streetAt;
