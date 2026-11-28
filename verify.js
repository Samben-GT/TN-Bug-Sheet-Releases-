/* Verify: everyone helps check the offices and official contacts we collected from public sources.
 * Reporters mark entries correct, wrong or outdated (and how they checked). Two people agreeing marks an
 * entry verified or disputed (database trigger). Admins also see the checks, apply corrections and add entries. */
const V = { entries: [], filter: 'near', q: '' };
const KIND = { office: 'Office', contact: 'Contact', police: 'Police', portal: 'Portal', handle: 'Official handle', deadline: 'Deadline', road: 'Road owner', other: 'Other' };
const VSTAT = { unverified: 'Not checked yet', verified: 'Verified', disputed: 'Disputed', retired: 'Retired' };
const HOWV = [['called', 'I called the number'], ['visited', 'I visited the office'], ['official_site', 'Checked the official site'], ['other', 'Other']];
const HOWALL = [...HOWV, ['caller_id', 'Caller ID app']];
const CMATCH = [['correct', 'Yes, it matches this office'], ['unsure', 'Partly or not sure'], ['wrong', 'No, it shows someone else']];

async function openVerify() {
  show('scrVerify');
  $('#vList').innerHTML = loaderHtml('Loading the directory...');
  const who = typeof eff === 'function' ? eff() : me;
  const isAdm = who && who.role === 'admin', isRm = who && (who.role === 'rm' || isAdm);
  if (V.patch === undefined) { const pt = typeof viewAs !== 'undefined' && viewAs ? viewAs.patch : (await sb.rpc('my_patch')).data; V.patch = (pt || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const pb = $('#vTabs [data-f="patch"]'); if (pb) pb.hidden = !V.patch.length; }
  const q = sb.from('directory_entries').select('*').order('status').order('updated_at', { ascending: false }).limit(500);
  const [{ data, error }, checks] = await Promise.all([q,
    sb.from('entry_checks').select('id,entry_id,user_id,verdict,method,note,proposed,reviewed,created_at,caller_label,officer_name,evidence').order('created_at', { ascending: false }).limit(1000)]);
  if (error) { $('#vList').innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  V.entries = data || []; V.checks = (checks.data || []); V.isAdm = isAdm; V.isRm = isRm;
  renderVerify();
}

function renderVerify() {
  const p = pin ? pin.getLatLng() : null;
  const here = p && typeof acAt === 'function' ? acAt(p.lat, p.lng) : null;
  const hereDist = here && typeof DIR !== 'undefined' && DIR.byAc && DIR.byAc.get(here) ? DIR.byAc.get(here).district : null;
  const q = V.q.trim().toLowerCase();
  let list = V.entries.filter(e => {
    if (V.filter === 'near' && !(e.ac_no == null && !e.district) && !(here && e.ac_no === here) && !(hereDist && e.district === hereDist)) return false;
    if (V.filter === 'patch' && !V.patch.some(k => [e.name, e.area, e.department, e.details].join(' ').toLowerCase().includes(k))) return false;
    if (V.filter === 'todo' && e.status === 'verified') return false;
    if (V.filter === 'disputed' && e.status !== 'disputed') return false;
    return !q || [e.name, e.designation, e.department, e.area, e.district, e.phone].join(' ').toLowerCase().includes(q);
  });
  const mine = new Set(V.checks.filter(c => c.user_id === (me && me.id)).map(c => c.entry_id));
  const pending = V.isAdm ? V.checks.filter(c => !c.reviewed && c.verdict !== 'correct' && c.method !== 'caller_id').length : 0;
  $('#vHead').innerHTML = `<p class="muted small">Help keep these right. Only official offices and published official numbers are listed. Call or visit only during office hours, and never share anyone's personal number.</p>
    ${V.isRm && !V.isAdm ? '<p class="muted small"><b>Relationship manager:</b> use Caller ID on each office to record what the caller ID app shows for the number, with a screenshot. Crop out personal emails and profile photos first.</p>' : ''}
    ${V.isRm ? `<div class="row" style="margin:8px 0"><button class="cta static" id="vAdd" style="margin-top:0">Add an entry</button>${pending ? `<span class="pri high" style="align-self:center">${pending} correction${pending > 1 ? 's' : ''} to review</span>` : ''}</div>` : ''}`;
  $('#vList').innerHTML = list.length ? list.map(e => {
    const cs = V.checks.filter(c => c.entry_id === e.id);
    const real = cs.filter(c => c.method !== 'caller_id');
    const ok = new Set(real.filter(c => c.verdict === 'correct').map(c => c.user_id)).size, bad = new Set(real.filter(c => c.verdict === 'wrong' || c.verdict === 'outdated').map(c => c.user_id)).size;
    const cid = cs.find(c => c.method === 'caller_id');
    return `<div class="card vcard" data-id="${e.id}">
      <div class="vtop"><span class="vkind">${KIND[e.kind] || e.kind}</span><span class="vstat ${e.status}">${VSTAT[e.status]}</span></div>
      <b class="vname">${esc(e.name)}</b>
      ${e.department ? `<div class="muted small">${esc(e.department)}${e.area ? ' · ' + esc(e.area) : ''}</div>` : ''}
      ${e.phone ? `<div class="vphone"><a href="tel:${esc(e.phone.replace(/[^\d+]/g, ''))}">${esc(e.phone)}</a></div>` : ''}
      ${e.details ? `<p class="small" style="margin:6px 0">${esc(e.details)}</p>` : ''}
      <div class="muted small">${e.source_url ? `<a href="${esc(e.source_url)}" target="_blank" rel="noopener">${esc(e.source_name || 'Source')}</a>` : 'No source yet'}${e.checked_on ? ' · checked ' + esc(e.checked_on) : ''} · ${ok} confirmed, ${bad} said wrong</div>
      ${V.isRm && cid ? `<div class="vcid small"><b>Caller ID shows:</b> ${esc(cid.caller_label || '-')}${cid.officer_name ? ' · ' + esc(cid.officer_name) : ''} · ${esc((CMATCH.find(m => m[0] === cid.verdict) || [0, cid.verdict])[1])} · ${new Date(cid.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${cid.evidence ? ` · <a href="#" data-ev="${esc(cid.evidence)}">screenshot</a>` : ''}</div>` : ''}
      ${V.isRm ? `<div class="vacts"><button data-cid="1">${cid ? 'Caller ID again' : 'Caller ID'}</button></div>` : ''}
      ${mine.has(e.id) ? '<div class="muted small" style="margin-top:8px">You have checked this one. Thank you.</div>' : `<div class="vacts">
        <button data-v="correct">Correct</button><button data-v="wrong">Wrong</button><button data-v="outdated">Outdated</button></div>`}
      ${V.isAdm ? adminChecks(e, cs) : ''}
    </div>`; }).join('') : `<div class="empty">${V.filter === 'near' ? 'Nothing collected for this area yet. Try All.' : 'Nothing here.'}</div>`;
  $('#vList').querySelectorAll('.vcard').forEach(card => {
    const e = V.entries.find(x => x.id === card.dataset.id);
    card.querySelectorAll('[data-v]').forEach(b => b.onclick = () => checkEntry(e, b.dataset.v));
    card.querySelectorAll('[data-cid]').forEach(b => b.onclick = () => callerCheck(e));
    card.querySelectorAll('[data-ev]').forEach(a => a.onclick = ev => { ev.preventDefault(); openEvidence(a.dataset.ev); });
    card.querySelectorAll('[data-ap]').forEach(b => b.onclick = () => applyCheck(e, V.checks.find(c => c.id === b.dataset.ap)));
    card.querySelectorAll('[data-dis]').forEach(b => b.onclick = () => reviewed(b.dataset.dis));
    const st = card.querySelector('[data-st]'); if (st) st.onchange = () => setStatus(e, st.value);
  });
  const add = $('#vAdd'); if (add) add.onclick = () => editEntry(null);
}

function adminChecks(e, cs) {
  const open = cs.filter(c => !c.reviewed);
  return `<div class="vadm"><label class="small">Status <select data-st>${Object.keys(VSTAT).map(k => `<option value="${k}" ${k === e.status ? 'selected' : ''}>${VSTAT[k]}</option>`).join('')}</select></label>
    ${open.filter(c => c.method !== 'caller_id').map(c => `<div class="vcheck"><b>${esc(c.verdict)}</b> · ${esc((HOWALL.find(h => h[0] === c.method) || [0, c.method])[1])} · ${new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
      ${c.note ? `<div class="small">${esc(c.note)}</div>` : ''}
      ${Object.keys(c.proposed || {}).length ? `<div class="small">Suggests: ${Object.entries(c.proposed).map(([k, v]) => `${esc(k)} = ${esc(v)}`).join(', ')}</div>` : ''}
      <div class="row">${Object.keys(c.proposed || {}).length ? `<button class="chip" data-ap="${c.id}">Apply</button>` : ''}<button class="chip" data-dis="${c.id}">Done</button></div></div>`).join('')}
    <button class="chip" onclick="editEntry(V.entries.find(x => x.id === '${e.id}'))">Edit</button></div>`;
}

async function checkEntry(e, verdict) {
  const fields = [{ key: 'method', label: 'How did you check?', type: 'select', options: HOWV, value: 'called' },
    { key: 'note', label: 'What did you find?', type: 'area', hint: verdict === 'correct' ? 'Answered by the Zone 2 office, confirmed they handle streetlights' : 'Number not in service / now handled by another office' }];
  if (verdict !== 'correct') fields.push({ key: 'phone', label: 'Correct official number, if you know it', hint: 'Office number only, never a personal number' }, { key: 'name', label: 'Correct office or designation, if different' });
  const f = await form(verdict === 'correct' ? 'Confirm this entry' : 'Report a problem', fields, 'Send');
  if (!f) return;
  const proposed = {}; if (f.phone) proposed.phone = f.phone.trim(); if (f.name) proposed.name = f.name.trim();
  const { error } = await sb.from('entry_checks').insert({ entry_id: e.id, verdict, method: f.method, note: f.note || null, proposed });
  if (error) return toast(error.message);
  toast('Thanks, recorded'); openVerify();
}

async function applyCheck(e, c) {
  const { error } = await sb.from('directory_entries').update({ ...c.proposed, checked_on: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', e.id);
  if (error) return toast(error.message);
  await sb.from('entry_checks').update({ reviewed: true }).eq('id', c.id);
  toast('Correction applied'); openVerify();
}
async function reviewed(id) { await sb.from('entry_checks').update({ reviewed: true }).eq('id', id); openVerify(); }
async function setStatus(e, status) { const { error } = await sb.from('directory_entries').update({ status, updated_at: new Date().toISOString() }).eq('id', e.id); if (error) toast(error.message); else { toast('Saved'); openVerify(); } }

async function editEntry(e) {
  const v = e || {};
  const f = await form(e ? 'Edit entry' : 'Add an entry', [
    { key: 'kind', label: 'Type', type: 'select', options: Object.entries(KIND), value: v.kind || 'contact' },
    { key: 'name', label: 'Office or post', value: v.name, hint: 'Assistant Engineer, TNPDCL Potheri section' },
    { key: 'department', label: 'Department', value: v.department, hint: 'TNPDCL / Tambaram Corporation' },
    { key: 'area', label: 'Area covered', value: v.area },
    { key: 'district', label: 'District', value: v.district },
    { key: 'ac_no', label: 'Constituency number (optional)', value: v.ac_no != null ? String(v.ac_no) : '' },
    { key: 'phone', label: 'Official phone', value: v.phone },
    { key: 'details', label: 'What they handle', type: 'area', value: v.details },
    { key: 'source_name', label: 'Source name', value: v.source_name },
    { key: 'source_url', label: 'Source link (https://)', value: v.source_url }], e ? 'Save' : 'Add');
  if (!f) return;
  const row = { kind: f.kind, name: f.name, department: f.department || null, area: f.area || null, district: f.district || null,
    ac_no: f.ac_no ? parseInt(f.ac_no, 10) : null, phone: f.phone || null, details: f.details || null, source_name: f.source_name || null,
    source_url: f.source_url || null, updated_at: new Date().toISOString(), ...(e ? {} : { added_by: V.isAdm ? 'admin' : 'rm', status: 'unverified' }) };
  const { error } = e ? await sb.from('directory_entries').update(row).eq('id', e.id) : await sb.from('directory_entries').insert(row);
  if (error) return toast(error.message);
  toast('Saved'); openVerify();
}

/* Caller ID check (relationship manager): what the caller ID app shows for this office's number, plus a screenshot.
 * Crowdsourced labels never verify an entry on their own (database trigger skips them). */
function callerCheck(e) {
  $('#mTitle').textContent = 'Caller ID: ' + e.name;
  $('#mBody').innerHTML = `<p class="muted small">Look up ${e.phone ? '<b>' + esc(e.phone) + '</b>' : 'the number'} in your caller ID app. Crop out any personal email or profile photo before attaching. Officer names stay visible to staff only.</p>
    <label for="cLabel">What does it show?</label><input id="cLabel" placeholder="Ee Maraimalai / AE Chromepet EB">
    <label for="cName">Officer name, if shown (optional)</label><input id="cName" placeholder="As shown, staff only">
    <label for="cMatch">Does it match this office?</label><select id="cMatch">${CMATCH.map(m => `<option value="${m[0]}">${m[1]}</option>`).join('')}</select>
    <label for="cNote">Note (optional)</label><textarea id="cNote" rows="2" placeholder="Shows a different section / number not on caller ID"></textarea>
    <label for="cShot">Screenshot (optional)</label><input id="cShot" type="file" accept="image/*">`;
  $('#mBody').querySelectorAll('select').forEach(x => Object.assign(x.style, { width: '100%', padding: '12px', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '12px' }));
  $('#mOk').textContent = 'Save'; $('#mCancel').textContent = 'Cancel';
  const close = () => $('#modal').classList.remove('on');
  $('#mCancel').onclick = close;
  $('#mOk').onclick = async () => {
    const label = $('#cLabel').value.trim(), file = $('#cShot').files[0];
    if (!label) return toast('Type what the caller ID app shows');
    $('#mOk').disabled = true; $('#mOk').textContent = 'Saving...';
    try {
      let path = null;
      if (file) {
        const blob = await (await fetch(await shrink(file))).blob();
        path = `${me.id}/${e.id}-${Date.now()}.jpg`;
        const up = await sb.storage.from('evidence').upload(path, blob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
      }
      const { error } = await sb.from('entry_checks').insert({ entry_id: e.id, verdict: $('#cMatch').value, method: 'caller_id',
        caller_label: label.slice(0, 120), officer_name: $('#cName').value.trim().slice(0, 120) || null, note: $('#cNote').value.trim() || null, evidence: path });
      if (error) throw error;
      close(); toast('Caller ID saved'); openVerify();
    } catch (err) { toast((err && err.message) || String(err), 4500); }
    finally { $('#mOk').disabled = false; $('#mOk').textContent = 'Save'; }
  };
  $('#modal').classList.add('on');
}
async function openEvidence(path) {
  if (/^https:\/\//.test(path)) { window.open(path, '_blank', 'noopener'); return; } // screenshots logged by the admin live in Drive
  const { data, error } = await sb.storage.from('evidence').createSignedUrl(path, 600);
  if (error || !data) return toast(error ? error.message : 'Could not open the screenshot');
  window.open(data.signedUrl, '_blank', 'noopener');
}

(function () {
  const tabs = $('#vTabs'); if (!tabs) return;
  tabs.querySelectorAll('button').forEach(b => b.onclick = () => { V.filter = b.dataset.f; tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderVerify(); });
  $('#vSearch').oninput = e => { V.q = e.target.value; renderVerify(); };
  const chip = $('#btnVerify'); if (chip) chip.onclick = () => openVerify();
})();
