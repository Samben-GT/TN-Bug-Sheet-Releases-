/* Who sees which report.
   - A reporter sees their own reports. Admins see all.
   - Another reporter's report is visible only if that reporter turned on "public profile", the team has
     checked the report, and it is not a women's safety report.
   - Even then, their email and phone stay hidden unless they also turned on "show my contact".
   The rules live in the database (bug_points, public_report, public_file_ok); this file only shows the result. */

// Pilot mode (Sam, 27 Nov): every member sees every bug with the reporter's name, except women's safety reports.
const PILOT = { on: null };
async function pilotOn() {
  if (PILOT.on === null) { try { const { data } = await sb.rpc('pilot_mode'); PILOT.on = !!data; } catch (_) { PILOT.on = false; } }
  return PILOT.on;
}
window.pilotOn = pilotOn;

async function bugPoints() {
  const { data, error } = await sb.rpc('bug_points');
  if (error) throw error;
  return data || [];
}
window.bugPoints = bugPoints;

async function openPublicReport(id) {
  const { data: r, error } = await sb.rpc('public_report', { p_id: id });
  if (error || !r) { toast('This report is private'); return; }
  const c = catOf(r.category), who = r.reporter || {};
  const paths = (r.thumbs && r.thumbs.length ? r.thumbs : r.photos || []).slice(0, 4);
  let urls = [];
  if (paths.length) { const { data } = await sb.storage.from('photos').createSignedUrls(paths, 3600); urls = (data || []).map(x => x.signedUrl).filter(Boolean); }
  const contact = [who.phone ? `<a class="sent-call" href="tel:${esc(who.phone)}"><span><b>Call</b></span><span class="sent-n">${esc(who.phone)}</span></a>` : '',
    who.email ? `<a class="sent-call" href="mailto:${esc(who.email)}"><span><b>Email</b></span><span class="sent-n">${esc(who.email)}</span></a>` : ''].join('');
  $('#mTitle').textContent = `${c.name}`;
  $('#mBody').innerHTML = `
    ${urls.length ? `<div class="pub-ph">${urls.map(u => `<img src="${esc(u)}" alt="">`).join('')}</div>` : ''}
    <div class="kv">
      <div>Status</div><div>${esc(ST_TXT[r.status] || r.status)}</div>
      ${r.note ? `<div>Note</div><div>${esc(r.note)}</div>` : ''}
      ${r.street || r.address ? `<div>Where</div><div>${esc(r.street || r.address)}</div>` : ''}
      ${r.ward ? `<div>Ward</div><div>${esc(window.wardLabel ? wardLabel(r.ward) : r.ward)}</div>` : ''}
      <div>Reported</div><div>${new Date(r.reported_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
      <div>By</div><div>${esc(who.name || 'A reporter')}</div>
      ${r.also_reported ? `<div>Reported by</div><div><b>${r.also_reported + 1} people</b></div>` : ''}
    </div>
    ${contact || '<p class="muted small">This reporter keeps their contact details private.</p>'}`;
  const close = () => { $('#modal').classList.remove('on'); $('#mOk').textContent = 'OK'; $('#mCancel').textContent = 'Cancel'; $('#mOk').style.display = ''; };
  $('#mOk').style.display = ''; $('#mOk').textContent = 'Show on map'; $('#mCancel').textContent = 'Close';
  $('#mOk').onclick = () => { close(); if (window.focusPlace) focusPlace(r.lat, r.lng, 18); };
  $('#mCancel').onclick = close;
  $('#modal').classList.add('on');
}
window.openPublicReport = openPublicReport;

/* Profile section: the two switches, a display name and an optional phone. */
function privacyForm(r) {
  r = r || {};
  const pilot = PILOT.on;
  return `<h3>About you</h3>
    <label for="pvGender">Gender (optional)</label>
    <select id="pvGender"><option value="">Prefer not to say</option>${[['female', 'Woman'], ['male', 'Man'], ['other', 'Other']].map(([v, l]) => `<option value="${v}" ${r.gender === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <p class="muted small">Used only to show women's safety items first. Never shown to anyone.</p>
    <h3>Privacy</h3>
    <p class="muted small" style="margin-top:-4px">${pilot ? 'Pilot phase: every member of the team can see every bug and who reported it, by name only, so you can check each other\'s reports. Your email and phone stay hidden. Women\'s safety reports are seen only by the admin.' : 'Your reports are private. Only you and the TN Bug Sheet team can see them.'}</p>
    <label class="pv-row"><input type="checkbox" id="pvPublic" ${r.public_profile ? 'checked' : ''}>
      <span><b>Make my profile public</b><span class="muted small">${pilot ? 'After the pilot: ' : ''}Other reporters can see your reports after our team checks them. Women's safety reports always stay private.</span></span></label>
    <div id="pvMore" style="${r.public_profile ? '' : 'display:none'}">
      <label class="small">Name shown to others</label>
      <input id="pvName" maxlength="40" placeholder="Your name or a nickname" value="${esc(r.public_name || '')}">
      <label class="pv-row"><input type="checkbox" id="pvContact" ${r.contact_public ? 'checked' : ''}>
        <span><b>Show my contact too</b><span class="muted small">Other reporters can see your email and phone. Leave this off to keep them private.</span></span></label>
      <div id="pvPhoneBox" style="${r.contact_public ? '' : 'display:none'}">
        <label class="small">Phone (optional)</label>
        <input id="pvPhone" inputmode="tel" maxlength="16" placeholder="98765 43210" value="${esc(r.phone || '')}">
      </div>
    </div>`;
}
function bindPrivacy() {
  const pub = $('#pvPublic'), con = $('#pvContact');
  if (!pub) return;
  pub.onchange = () => { $('#pvMore').style.display = pub.checked ? '' : 'none'; };
  con.onchange = () => { $('#pvPhoneBox').style.display = con.checked ? '' : 'none'; };
}
// values to save, or an error message
function privacyValues() {
  if (!$('#pvPublic')) return {};
  const gender = $('#pvGender') ? $('#pvGender').value || null : undefined;
  const pub = $('#pvPublic').checked, con = pub && $('#pvContact').checked;
  const name = $('#pvName').value.trim(), phone = $('#pvPhone').value.trim().replace(/\s+/g, ' ');
  if (pub && name && (name.length < 2 || name.length > 40)) return { error: 'Name should be 2 to 40 letters.' };
  if (con && phone && !/^[0-9+ ]{8,16}$/.test(phone)) return { error: 'That phone number does not look right.' };
  return { public_profile: pub, contact_public: con, public_name: name || null, phone: phone || null, gender };
}
window.privacyForm = privacyForm; window.bindPrivacy = bindPrivacy; window.privacyValues = privacyValues;
