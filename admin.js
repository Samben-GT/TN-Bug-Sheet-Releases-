/* TN Bug Sheet - admin screens: bug queue and lifecycle, users, audit log.
 * Uses globals from app.js (sb, me, show, back, esc, toast, catOf, STATUS_ADMIN below).
 * Every write is checked again in the database (row-level security + status rules) and logged in audit_log.
 */
'use strict';

const LIFE = [
  ['submitted', 'New'], ['approved', 'Approved'], ['routed', 'Routed'], ['filed', 'Complaint filed'],
  ['escalated', 'Escalated on X'], ['legal', 'Legal'], ['resolved', 'Fixed'],
];
const ENDS = { rejected: 'Rejected', duplicate: 'Duplicate', closed: 'Closed' };
const LABEL = Object.assign(Object.fromEntries(LIFE), ENDS);
const FILTERS = ['submitted', 'approved', 'routed', 'filed', 'escalated', 'legal', 'resolved', 'rejected', 'duplicate', 'closed', 'all', 'spam'];
const isSpam = r => r.status === 'submitted' && r.spam_score >= 50; // own tab, never blocked (Sam, 27 Nov)
const fmt = t => t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const days = (a, b = Date.now()) => Math.floor((b - new Date(a)) / 864e5);
let admTab = 'queue', admFilter = 'submitted';

/* ---------- small form sheet ---------- */
function form(title, fields, okLabel = 'Save') {
  return new Promise(res => {
    $('#mTitle').textContent = title;
    $('#mBody').innerHTML = fields.map((f, i) => `<label for="mf${i}">${esc(f.label)}</label>` + (
      f.type === 'select' ? `<select id="mf${i}">${f.options.map(o => `<option value="${esc(o[0])}" ${o[0] === f.value ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`
      : f.type === 'area' ? `<textarea id="mf${i}" rows="3" placeholder="${esc(f.hint || '')}">${esc(f.value || '')}</textarea>`
      : `<input id="mf${i}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.hint || '')}">`)).join('');
    $('#mBody').querySelectorAll('select').forEach(e => Object.assign(e.style, { width: '100%', padding: '12px', background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '12px' }));
    $('#mOk').textContent = okLabel; $('#mCancel').textContent = 'Cancel';
    const done = v => { $('#modal').classList.remove('on'); res(v); };
    $('#mCancel').onclick = () => done(null);
    $('#mOk').onclick = () => {
      const out = {};
      for (let i = 0; i < fields.length; i++) {
        const v = $('#mf' + i).value.trim();
        if (fields[i].required && !v) { toast(fields[i].label + ' is needed'); return; }
        out[fields[i].key] = v;
      }
      done(out);
    };
    $('#modal').classList.add('on');
  });
}
const fail = e => { toast((e && e.message) || String(e), 4500); return null; };
const signed = async paths => {
  if (!paths || !paths.length) return [];
  const { data } = await sb.storage.from('photos').createSignedUrls(paths, 3600);
  return (data || []).map(x => x.signedUrl).filter(Boolean);
};

/* ---------- screen ---------- */
async function openAdmin() { show('scrAdmin'); renderAdmin(); }
$('#btnAdmin').onclick = openAdmin;
$('#btnAdmRefresh').onclick = () => renderAdmin();
document.querySelectorAll('#admTabs button').forEach(b => b.onclick = () => {
  admTab = b.dataset.t; document.querySelectorAll('#admTabs button').forEach(x => x.classList.toggle('on', x === b)); renderAdmin();
});
function renderAdmin() {
  $('#adm').innerHTML = loaderHtml(admTab === 'audit' ? 'Loading activity...' : admTab === 'users' ? 'Loading people...' : admTab === 'work' ? 'Loading tasks...' : admTab === 'issues' ? 'Loading issues...' : admTab === 'ai' ? 'Loading AI log...' : admTab === 'notices' ? 'Loading notices...' : 'Loading bugs...');
  return ({ queue: renderQueue, users: renderUsers, work: renderWorkAdmin, issues: renderIssuesAdmin, suggest: renderSuggestAdmin, notices: renderNoticesAdmin, reels: () => renderReels($('#adm')), ai: renderAiLog, audit: renderAudit })[admTab]().catch(e => {
    $('#adm').innerHTML = `<div class="empty">Could not load this tab.<br><span class="small">${esc((e && e.message) || String(e))}</span><br><br>Check your connection and tap Refresh.</div>`;
  });
}

/* ---------- bugs ---------- */
async function renderQueue() {
  const { data: counts, error: ce } = await sb.from('reports').select('status,spam_score');
  if (ce) throw ce;
  const real = counts.filter(x => !isSpam(x));
  const n = real.reduce((t, x) => (t[x.status] = (t[x.status] || 0) + 1, t), {});
  n.spam = counts.length - real.length;
  let q = sb.from('reports').select('id,status,category,note,reported_at,received_at,thumbs,filed_at,deadline_at,user_id,priority,next_action,spam_score,spam_reasons,possible_duplicate_of,triage').order('received_at', { ascending: false }).limit(100);
  if (admFilter === 'spam') q = q.eq('status', 'submitted').gte('spam_score', 50);
  else if (admFilter !== 'all') q = q.eq('status', admFilter);
  const res = await q; if (res.error) throw res.error;
  const data = admFilter === 'spam' ? res.data : res.data.filter(r => !isSpam(r));
  const RANK = { urgent: 0, high: 1 };
  const spam = r => (r.spam_score >= 50 ? 1 : 0);
  const pri = r => r.priority || (r.triage && r.triage.priority); // the admin's own priority wins over the AI's suggestion
  data.sort((a, b) => spam(a) - spam(b) || (RANK[pri(a)] ?? 2) - (RANK[pri(b)] ?? 2)); // likely spam last, urgent first
  const urls = await signed(data.map(r => r.thumbs[0]).filter(Boolean));
  let u = 0;
  const { data: rch } = await sb.from('report_reach').select('*').in('report_id', data.map(r => r.id));
  const reach = new Map((rch || []).map(x => [x.report_id, x]));
  const reachTag = r => { const x = reach.get(r.id); if (['submitted', 'rejected', 'duplicate', 'closed'].includes(r.status)) return '';
    if (!x) return '<span class="pri reach0">Not mapped</span> ';
    return `<span class="pri ${x.reached ? 'reach1' : 'reach0'}">${x.reached ? `Reached ${x.reached}/${x.total}` : 'Not reached'}</span> `; };
  const overdue = r => r.status === 'filed' && r.deadline_at && new Date(r.deadline_at) < new Date();
  $('#adm').innerHTML = `
    <div class="stats"><div><b>${n.submitted || 0}</b>to check</div><div><b>${(n.filed || 0) + (n.escalated || 0) + (n.legal || 0)}</b>open complaints</div><div><b>${n.resolved || 0}</b>fixed</div></div>
    <div class="filters">${FILTERS.map(f => `<button data-f="${f}" class="${f === admFilter ? 'on' : ''}">${f === 'all' ? 'All' : f === 'spam' ? 'Spam' : LABEL[f]}<b>${f === 'all' ? real.length : (n[f] || 0)}</b></button>`).join('')}</div>
    ${data.length ? data.map(r => { const c = catOf(r.category); return `
      <button class="item" data-id="${esc(r.id)}"><div class="item-top">${r.thumbs[0] ? `<img src="${esc(urls[u++] || '')}" alt="">` : `<span class="noimg">${(r.media || []).length ? 'Media' : 'Text'}</span>`}
        <div class="t"><div>${r.spam_score >= 50 ? '<span class="pri spam">Likely spam</span> ' : r.possible_duplicate_of ? '<span class="pri dup">Duplicate?</span> ' : ''}${r.priority && r.priority !== 'normal' ? `<span class="pri ${r.priority}">${r.priority === 'urgent' ? 'Urgent' : 'High'}</span> ` : ''}${!r.priority && r.triage && ['urgent', 'high'].includes(r.triage.priority) ? `<span class="pri ${r.triage.priority}">AI: ${r.triage.priority === 'urgent' ? 'Urgent' : 'High'}</span> ` : ''}${r.triage && r.triage.women_safety ? '<span class="pri women">Women safety</span> ' : ''}${c.icon} ${esc(c.name)}</div><div class="muted small">${fmt(r.received_at)} · ${esc(r.id)}</div>
        <div class="muted small">${reachTag(r)}${esc(r.note || '')}</div></div>
        <span class="tag ${overdue(r) ? 'rejected' : r.status}">${overdue(r) ? 'Overdue' : LABEL[r.status]}</span></div></button>`; }).join('')
      : '<div class="empty">Nothing here.</div>'}`;
  $('#adm').querySelectorAll('.filters button').forEach(b => b.onclick = () => { admFilter = b.dataset.f; renderQueue().catch(fail); });
  $('#adm').querySelectorAll('.item').forEach(b => b.onclick = () => openReview(b.dataset.id));
}

// The Urgent row of the review screen says who ticked the box. The form ticks it by default for some bug types and
// words; that is the app's suggestion, not the reporter speaking. Rows from before v0.50 have no urgent_by: there the
// form wrote this exact reason only when the reporter had ticked the box. "Not urgent" in the note is shown too, with
// who read it that way: the word list in easyreport.js, or else the AI triage (which also reads other phrasings).
function urgentRow(r) {
  const said = !!(window.saysNotUrgent && saysNotUrgent(r.note)), aiSaid = !said && !!(r.triage && r.triage.not_urgent_said);
  const calm = said ? 'The reporter wrote that it is not urgent.' : aiSaid ? 'The AI reads the note as saying it is not urgent.' : '';
  if (!r.reported_urgent) return calm && ['Urgent', `No. ${calm}`];
  const by = r.urgent_by || (r.urgent_reason === 'Marked urgent by the reporter' ? 'reporter' : 'app');
  if (by === 'reporter') return ['Urgent', `<b class="danger">Reporter ticked Urgent</b>${calm ? `<br><span class="muted small">But ${said ? 'the note says it is not urgent' : 'the AI reads the note as saying it is not urgent'}. Check with the reporter.</span>` : ''}`];
  return ['Urgent', `Suggested by the app, not said by the reporter${r.urgent_reason ? ' · ' + esc(r.urgent_reason) : ''}<br><span class="muted small">${calm || 'The form ticks Urgent for this kind of bug. The reporter did not untick it.'}</span>`];
}
async function openReview(id) {
  if (!$('#scrReview').classList.contains('on')) { $('#rev').innerHTML = loaderHtml('Opening report...'); show('scrReview'); }
  const { data: r, error } = await sb.from('reports').select('*').eq('id', id).single();
  if (error) return fail(error);
  const [{ data: who }, { data: log }, photos] = await Promise.all([
    sb.from('profiles').select('email').eq('id', r.user_id).maybeSingle(),
    sb.from('audit_log').select('at,actor_email,action,changes').eq('entity', 'reports').eq('entity_id', id).order('at', { ascending: false }).limit(50),
    signed(r.photos_removed_at ? r.thumbs : r.photos),
  ]);
  try { await Promise.all([loadDirectory(), loadShapes(), window.loadCouncillors ? loadCouncillors() : null, window.loadLocal ? loadLocal().catch(() => {}) : null]); } catch (_) {} // for the plan's constituency lookup, the ward map and the ward councillor
  const c = catOf(r.category), rt = r.routing || {};
  const live = !['resolved', 'closed', 'rejected', 'duplicate'].includes(r.status);
  const idx = LIFE.findIndex(x => x[0] === r.status);
  const went = s => r.status === s || (s === 'escalated' && (['legal'].includes(r.status) || ['escalation', 'legal'].includes(r.resolved_stage))) || (s === 'legal' && r.resolved_stage === 'legal');
  const stage = `<div class="stage">${LIFE.map((x, i) => ['escalated', 'legal'].includes(x[0]) && !went(x[0]) ? '' : `<span class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${x[1]}</span>`).join('')}${ENDS[r.status] ? `<span class="now">${ENDS[r.status]}</span>` : ''}</div>`;
  const { count: also } = await sb.from('reports').select('id', { count: 'exact', head: true }).eq('duplicate_of', r.id);
  const rows = [
    also > 0 && ['Reported by', `<b>${also + 1} people</b> (${also} merged report${also === 1 ? '' : 's'})`],
    (r.spam_score > 0 || r.possible_duplicate_of) && ['Checks', `${r.spam_score >= 50 ? '<b class="spamtxt">Likely spam</b> · ' : ''}${esc((r.spam_reasons || []).join(' · ') || 'Looks fine')}`],
    // the reporter's own words first, then what the app and the AI made of them
    ['Reporter wrote', r.note ? esc(r.note) : '<span class="muted">Nothing written (photo, video or voice note only)</span>'],
    urgentRow(r),
    ['Bug', `${c.icon} ${esc(c.name)}${r.cat_guessed ? ' <span class="muted small">(type guessed from the note)</span>' : ''}`], r.triage && ['AI triage', `<b>${esc(r.triage.priority)}</b>${r.triage.women_safety ? ' · women safety' : ''}<br><span class="muted small">${esc(r.triage.reason || '')}</span>`], r.ai && r.ai.priority && ['AI says', esc(`${r.ai.priority} priority, ${r.ai.next_action || ''}`)], ['Since', esc(r.since || '-')],
    ['Where', `<a href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=19/${r.lat}/${r.lng}" target="_blank" rel="noopener">${r.lat}, ${r.lng}</a>${r.placed_by_hand ? (r.loc_mode === 'address' ? ' (typed address)' : ' (picked on map)') : r.accuracy_m ? ` (~${r.accuracy_m} m)` : ''}${r.address_text ? `<br>${esc(r.address_text)}` : ''}${r.street ? `<br>${esc(r.street)}` : ''}`],
    ...((wk, mapK) => !wk ? [] : [['Ward', (c => (c ? `${esc(wardLabel(wk))}<br>Councillor <b>${esc(cleanName(c.name))}</b>${c.party ? ' · ' + esc(c.party) : ''}${c.phone ? ` · <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}` : esc(wk))
      + (!r.ward ? '<br><span class="muted small">From the ward map at the pin. The reporter did not pick a ward.</span>'
        : mapK && mapK !== r.ward ? `<br><span class="small" style="color:var(--amber);font-weight:600">Picked by the reporter. The ward map says Ward ${esc(mapK.split('-')[1])} at this pin: check which is right.</span>` : ''))(window.councillorFor && councillorFor(wk))]])(window.wardOf ? wardOf(r) : r.ward, r.ward_map || (window.wardKeyAt ? wardKeyAt(r.lat, r.lng) : null)),
    ['Reporter', esc(who ? who.email : r.user_id)], ['Reported', fmt(r.reported_at)], ['Received', fmt(r.received_at)],
    r.reviewed_at && ['Reviewed', fmt(r.reviewed_at)], r.reject_reason && ['Reason', esc(r.reject_reason)], r.duplicate_of && ['Duplicate of', esc(r.duplicate_of)],
    r.routing && ['Portal', esc(rt.portal || '-')], r.routing && ['Office', esc(rt.office || '-')], r.routing && ['Officers', esc(rt.officers || '-')],
    r.routing && ['MLA', esc(rt.mla || '-')], r.routing && ['Handles', esc(rt.handles || '-')], r.routing && rt.sources && ['Sources', esc(rt.sources)],
    r.complaint_ref && ['Complaint', `${esc(r.portal)} · ${esc(r.complaint_ref)}`], r.filed_at && ['Filed', fmt(r.filed_at)],
    r.deadline_at && ['Deadline', fmt(r.deadline_at) + (r.status === 'filed' ? (new Date(r.deadline_at) < new Date() ? ` <span class="danger">overdue ${days(r.deadline_at)} d</span>` : ` (${-days(r.deadline_at)} d left)`) : '')],
    r.escalated_at && ['Escalated', fmt(r.escalated_at)], r.escalation_links.length && ['X posts', r.escalation_links.map(l => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l)}</a>`).join('<br>')],
    r.legal_at && ['Legal', fmt(r.legal_at) + ' · ' + esc(r.legal_note || '')],
    r.resolved_at && ['Fixed', `${fmt(r.resolved_at)} via ${esc(r.resolved_stage || '-')}`], r.closed_how && ['What worked', esc([(HOW.find(h => h[0] === r.closed_how) || [0, r.closed_how])[1], r.fixed_by, r.closure_note].filter(Boolean).join(' · '))], r.thanked_at && ['Thanked', fmt(r.thanked_at)],
    r.admin_note && ['Admin note', esc(r.admin_note)],
    r.photos_removed_at ? ['Photos', 'Full photos archived to phone, thumbnails shown'] : r.photos_backed_up_at && ['Backup', fmt(r.photos_backed_up_at)],
  ].filter(Boolean);
  $('#revTitle').textContent = r.id;
  $('#rev').innerHTML = `${stage}
    <div class="kv">${rows.map(x => `<div>${x[0]}</div><div>${x[1]}</div>`).join('')}</div>
    <div class="big">${photos.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt=""></a>`).join('')}</div>
    ${(r.media || []).length ? '<div id="revMedia" class="st-media rev-media"></div>' : ''}${live ? '<div id="revSteps"></div>' : ''}${live && window.aiHtml ? aiHtml(r) : ''}${live && window.planHtml ? planHtml(r) : ''}${window.reachHtml ? reachHtml() : ''}
    <div class="seg-k">Priority${r.category === 'women' ? ' <span class="muted small">(women safety: usually urgent)</span>' : ''}</div>
    <div class="seg" id="segPri">${[['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal']].map(([k, t]) => `<button data-v="${k}" class="${r.priority === k ? 'on ' + k : ''}">${t}</button>`).join('')}</div>
    <div class="seg-k">Next step</div>
    <div class="seg" id="segAct">${[['call', 'Phone call'], ['public_post', 'Public post'], ['portal', 'Portal']].map(([k, t]) => `<button data-v="${k}" class="${r.next_action === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="acts" id="acts"></div>
    <h3>History</h3>
    ${(log || []).map(l => `<div class="log"><div class="muted">${fmt(l.at)} · ${esc(l.actor_email || 'system')} · ${esc(l.action)}</div>${esc(summarise(l))}</div>`).join('') || '<p class="muted small">No history.</p>'}`;
  $('#segPri').querySelectorAll('button').forEach(b => b.onclick = () => move(r, { priority: r.priority === b.dataset.v ? null : b.dataset.v }, 'Priority saved'));
  $('#segAct').querySelectorAll('button').forEach(b => b.onclick = () => move(r, { next_action: r.next_action === b.dataset.v ? null : b.dataset.v }, 'Next step saved'));
  if (live && window.bindPlan) { bindPlan(r); bindAi(r); }
  if (window.bindReach) bindReach(r);
  if (live && window.renderSteps) renderSteps($('#revSteps'), r, { admin: true });
  if ((r.media || []).length && window.mediaHtml) sb.storage.from('steps').createSignedUrls(r.media.map(m => m.path), 3600).then(({ data }) => { const u = Object.fromEntries((data || []).map(x => [x.path, x.signedUrl])); const b = $('#revMedia'); if (b) b.innerHTML = r.media.map(m => mediaHtml(m, u[m.path])).join(''); });
  actions(r);
  if (window.qAdmin) qAdmin(r);
  show('scrReview');
}
function summarise(l) {
  const c = l.changes || {}, who = displayId(l.entity_id || '');
  if (l.action === 'invite_sent') return `Invite sent to ${who}`;
  if (l.action === 'invite_accepted') return `${who} set their password (invite accepted)`;
  if (l.action === 'sign_in') return `${who} signed in`;
  if (l.action === 'password_set') return l.actor_email && l.actor_email.toLowerCase() !== (l.entity_id || '') ? `Password set for ${who}` : `${who} changed their password`;
  if (l.entity === 'members' && l.action === 'insert') return `User added: ${c.name || l.entity_id} (${c.role || 'reporter'})`;
  if (l.entity === 'members' && l.action === 'delete') return `User removed: ${l.entity_id}`;
  if (l.action !== 'update') return l.action === 'insert' ? 'Report created' : 'Deleted';
  return Object.entries(l.changes || {}).map(([k, v]) => `${k}: ${short(v[0])} → ${short(v[1])}`).join('; ');
}
const short = v => { const s = v == null ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 60 ? s.slice(0, 57) + '...' : s; };

async function move(r, patch, msg) {
  const { error } = await sb.from('reports').update(patch).eq('id', r.id);
  if (error) return fail(error);
  toast(msg || 'Saved'); openReview(r.id);
}
// Every closure records what actually worked. This is the dataset the AI learns the playbook from.
const HOW = [['portal', 'Portal complaint'], ['phone_call', 'Phone call to the office'], ['public_post', 'Public post on X'], ['escalation', 'Escalation up the ladder'], ['legal', 'Legal notice'], ['fixed_on_own', 'Fixed before we acted']];
async function closeFixed(r, def, msg) {
  const f = await form('What got it fixed?', [
    { key: 'how', label: 'What worked', type: 'select', options: HOW, value: def },
    { key: 'by', label: 'Who acted (office or officer)', hint: 'AE Zone 2, Tambaram Corporation' },
    { key: 'note', label: 'Anything worth repeating next time', type: 'area', hint: 'Called twice, fixed in 3 days after the second call' }], 'Mark fixed');
  if (f) move(r, { status: 'resolved', closed_how: f.how, fixed_by: f.by || null, closure_note: f.note || null }, msg);
}
async function delReport(r) {
  if (!(await form(`Delete ${r.id} for good?`, [], 'Delete'))) return;
  const { error } = await sb.from('reports').delete().eq('id', r.id);
  if (error) return toast(error.message);
  toast('Deleted'); back(); if (typeof renderQueue === 'function') renderQueue().catch(() => {});
}
function btn(label, fn, cls = '') { const b = document.createElement('button'); b.className = 'cta static ' + cls; b.textContent = label; b.onclick = fn; $('#acts').appendChild(b); }

function actions(r) {
  const s = r.status;
  if (s === 'submitted') {
    if (r.spam_score >= 50) btn('Reject as spam', () => move(r, { status: 'rejected', reject_reason: 'Not a genuine civic report (spam check)' }, 'Rejected as spam'), 'ghost danger');
    if (r.possible_duplicate_of) {
      btn(`Merge into ${r.possible_duplicate_of.slice(-4)} (reported twice)`, () => move(r, { status: 'duplicate', duplicate_of: r.possible_duplicate_of }, 'Merged: the first report now counts 2 people'), 'ghost');
      btn('Delete this copy', () => delReport(r), 'ghost danger');
    }
    btn('Approve', () => move(r, { status: 'approved' }, 'Approved'));
    btn('Reject', async () => { const f = await form('Reject this report', [{ key: 'reason', label: 'Reason (the reporter sees this)', type: 'area', required: true, hint: 'Not a public problem / photo unclear / private property' }], 'Reject'); if (f) move(r, { status: 'rejected', reject_reason: f.reason }, 'Rejected'); }, 'ghost');
    btn('Mark as duplicate', async () => { const f = await form('Duplicate of', [{ key: 'id', label: 'Report ID it repeats', required: true, hint: 'TNB-...' }]); if (f) move(r, { status: 'duplicate', duplicate_of: f.id }, 'Marked duplicate'); }, 'ghost');
  }
  if (s === 'approved') {
    btn('Route: portal, officers, MLA', async () => {
      const rt = r.routing || {};
      const f = await form('Who handles this bug', [
        { key: 'portal', label: 'Portal to file on', value: rt.portal, required: true, hint: 'Tambaram Corporation / Namma Chennai / TNPDCL / CM Helpline' },
        { key: 'office', label: 'Office and ward or zone', value: rt.office, hint: 'Zone 2, ward 15' },
        { key: 'officers', label: 'Responsible officers', value: rt.officers, type: 'area', hint: 'AEE Zone 2, 9499012767' },
        { key: 'mla', label: 'MLA and constituency', value: rt.mla, hint: 'AC 30 Pallavaram' },
        { key: 'handles', label: 'Official X handles to tag later', value: rt.handles, type: 'area', hint: '@... (offices, verified only)' },
        { key: 'sources', label: 'Sources checked', value: rt.sources, type: 'area', hint: 'Links used to confirm the above' },
      ]);
      if (f) move(r, { status: 'routed', routing: f }, 'Routed');
    });
    btn('Ask Gemini to suggest routing (coming next)', () => toast('Gemini routing is the next build'), 'ghost');
  }
  if (s === 'routed') {
    btn('Complaint filed', async () => {
      const d = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
      const f = await form('Complaint raised on the portal', [
        { key: 'portal', label: 'Portal', value: (r.routing || {}).portal, required: true },
        { key: 'ref', label: 'Complaint number', required: true },
        { key: 'deadline', label: "Deadline (the department's own time limit)", type: 'date', value: d, required: true },
      ], 'Mark filed');
      if (f) move(r, { status: 'filed', portal: f.portal, complaint_ref: f.ref, deadline_at: new Date(f.deadline + 'T23:59:00+05:30').toISOString() }, 'Filed. Deadline running.');
    });
    btn('Back to approved', () => move(r, { status: 'approved' }), 'ghost');
  }
  if (s === 'filed') {
    btn('Fixed through the portal', () => closeFixed(r, r.next_action === 'call' ? 'phone_call' : 'portal', 'Marked fixed'));
    btn('Escalate on X', async () => { const f = await form('Escalated on X', [{ key: 'links', label: 'Links to the X posts (one per line)', type: 'area', required: true }], 'Mark escalated'); if (f) move(r, { status: 'escalated', escalation_links: f.links.split(/\s+/).filter(Boolean) }, 'Escalated'); }, 'ghost');
  }
  if (s === 'escalated') {
    btn('Fixed after escalation', () => closeFixed(r, 'escalation', 'Marked fixed. Remember to thank them.'));
    btn('Add X post link', async () => { const f = await form('Another X post', [{ key: 'link', label: 'Link', required: true }]); if (f) move(r, { escalation_links: [...r.escalation_links, f.link] }); }, 'ghost');
    btn('Move to legal', async () => { const f = await form('Legal route', [{ key: 'note', label: 'Note (who was consulted, what is filed)', type: 'area', required: true }], 'Move to legal'); if (f) move(r, { status: 'legal', legal_note: f.note }, 'Moved to legal'); }, 'ghost');
  }
  if (s === 'legal') btn('Fixed', () => closeFixed(r, 'legal', 'Marked fixed'));
  if (s === 'resolved' && r.resolved_stage === 'escalation' && !r.thanked_at) btn('Thanked them on X', () => move(r, { thanked_at: new Date().toISOString() }, 'Thank-you recorded'));
  if (['approved', 'routed', 'filed', 'escalated', 'legal'].includes(s)) btn('Close without a fix', async () => { const f = await form('Close this bug', [{ key: 'note', label: 'Why', type: 'area', required: true }], 'Close'); if (f) move(r, { status: 'closed', admin_note: f.note, closed_how: 'no_fix', closure_note: f.note }, 'Closed'); }, 'ghost danger');
  if (['rejected', 'duplicate'].includes(s)) btn('Reopen for review', () => move(r, { status: 'submitted' }, 'Reopened'), 'ghost');
  if (s === 'duplicate') btn('Delete this copy', () => delReport(r), 'ghost danger');
  btn('Admin note', async () => { const f = await form('Admin note (not shown to the reporter)', [{ key: 'note', label: 'Note', type: 'area', value: r.admin_note }]); if (f) move(r, { admin_note: f.note || null }); }, 'ghost');
}

/* ---------- users ---------- */
async function renderUsers() {
  const { data, error } = await sb.from('member_stats').select('*').order('added_at');
  if (error) throw error;
  $('#adm').innerHTML = `<button class="cta static" id="addUser">Invite a user</button>
    ${data.map(m => `<div class="user"><div class="top"><div><b>${esc(m.name || m.email)}</b>${m.role === 'admin' ? ' <span class="tag filed">admin</span>' : ''}${m.role === 'rm' ? ' <span class="tag filed">relationship manager</span>' : ''}${m.title ? ' <span class="tag filed">' + esc(m.title) + '</span>' : ''}${m.active ? '' : ' <span class="tag rejected">inactive</span>'}
        <div class="muted small">${esc(displayId(m.email))}${isPhoneLogin(m.email) ? ' · mobile login' : ''}${m.user_id ? '' : ' · no login yet'}</div></div>
        <button class="mini" data-invite="${esc(m.email)}">Invite</button> <button class="mini" data-edit="${esc(m.email)}">Edit</button></div>
      <div class="stats"><div><b>${m.reported}</b>reported</div><div><b>${m.approved}</b>approved</div><div><b>${m.filed}</b>filed</div><div><b>${m.resolved}</b>fixed</div><div><b>${m.rejected}</b>rejected</div><div><b>${m.last_report ? days(m.last_report) + ' d' : '-'}</b>since last</div></div></div>`).join('')}`;
  const callAdmin = async body => {
    const { data: r, error: e } = await sb.functions.invoke('admin-users', { body });
    if (e) { let m = e.message; try { m = (await e.context.json()).error || m; } catch (_) {} throw new Error(m); }
    return r;
  };
  const showInvite = (who, r) => {
    $('#mTitle').textContent = 'Invite for ' + who;
    $('#mBody').innerHTML = `<p class="muted small">Send this link. It opens the sign-up page with the code filled in, works once, and expires in ${r.expires_days} days.</p>
      <textarea readonly rows="4" id="invLink">${esc(r.link)}</textarea>
      <p class="muted small">Login: <b>${esc(displayId(r.email || ''))}</b> · Invite code: <b>${esc(r.code)}</b></p>
      <div class="row" style="margin-top:8px"><button class="cta static ghost" id="invCopy" style="margin-top:0">Copy link</button>
      ${isPhoneLogin(r.email) ? `<a class="cta static ghost" id="invWa" style="margin-top:0;text-align:center;text-decoration:none" target="_blank" rel="noopener"
        href="https://wa.me/${esc(r.email.split('@')[0])}?text=${encodeURIComponent(`You're invited to the TN Bug Sheet pilot. Open this link, set your password, and it will show you how to install the app (Android) or add it to your home screen (iPhone): ${r.link}`)}">WhatsApp</a>` : ''}</div>`;
    $('#invCopy').onclick = async () => { try { await navigator.clipboard.writeText(r.link); toast('Link copied'); } catch (_) { $('#invLink').select(); document.execCommand && document.execCommand('copy'); toast('Link selected, copy it'); } };
    $('#mOk').textContent = 'Share link'; $('#mCancel').textContent = 'Close';
    const done = () => { $('#modal').classList.remove('on'); $('#mCancel').textContent = 'Cancel'; };
    $('#mCancel').onclick = done;
    $('#mOk').onclick = async () => {
      const text = `You're invited to the TN Bug Sheet pilot. Open this link, set your password, and it will show you how to install the app (Android) or add it to your home screen (iPhone): ${r.link}`;
      // In the Android app, open the system share menu (WhatsApp, Gmail...). The WebView has no navigator.share.
      if (window.TNB && TNB.share) { TNB.share(text, '[]', 'invite'); return; }
      try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(r.link); toast('Link copied'); } }
      catch (_) { try { await navigator.clipboard.writeText(r.link); toast('Link copied'); } catch (__) { $('#invLink').select(); } }
    };
    $('#modal').classList.add('on');
  };
  const invite = async (email, extra = {}) => {
    try { const r = await callAdmin({ action: 'invite', email, ...extra }); return r ? { ...r, email } : r; } catch (e) { fail(e); return null; }
  };
  $('#addUser').onclick = async () => {
    const f = await form('Invite a user', [
      { key: 'name', label: 'Name', required: true },
      { key: 'email', label: 'Email or 10-digit mobile number (their login)', required: true },
      { key: 'role', label: 'Role', type: 'select', value: 'reporter', options: [['reporter', 'Reporter'], ['rm', 'Relationship manager'], ['admin', 'Admin']] },
    ], 'Create invite');
    if (!f) return;
    const login = toLogin(f.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login)) return fail(new Error('Enter an email or a 10-digit mobile number'));
    const r = await invite(login, { name: f.name, role: f.role });
    if (r) { renderUsers().catch(fail); showInvite(f.name, r); }
  };
  $('#adm').querySelectorAll('[data-invite]').forEach(b => b.onclick = async () => {
    const m = data.find(x => x.email === b.dataset.invite);
    const r = await invite(m.email); if (r) showInvite(m.name || m.email, r);
  });
  $('#adm').querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    const m = data.find(x => x.email === b.dataset.edit);
    const f = await form(displayId(m.email), [
      { key: 'name', label: 'Name', value: m.name },
      { key: 'role', label: 'Role', type: 'select', value: m.role, options: [['reporter', 'Reporter'], ['rm', 'Relationship manager'], ['admin', 'Admin']] },
      { key: 'active', label: 'Access', type: 'select', value: m.active ? 'yes' : 'no', options: [['yes', 'Active: can sign in and report'], ['no', 'Deactivated: cannot report']] },
      { key: 'title', label: 'Title (optional, shows a welcome banner)', value: m.title, hint: 'CEO' },
      { key: 'patch', label: 'Patch: areas they look after (comma separated)', type: 'area', value: m.patch, hint: 'Chromepet, Tambaram, Pallavaram' },
      { key: 'note', label: 'Note', type: 'area', value: m.user_note },
      { key: 'password', label: 'New password (leave blank to keep the current one)', type: 'text' },
    ]);
    if (!f) return;
    if (f.password) {
      if (f.password.length < 8) return fail(new Error('Password needs at least 8 characters'));
      try { await callAdmin({ action: 'set_password', email: m.email, password: f.password }); } catch (e) { return fail(e); }
    }
    const { error: e } = await sb.from('members').update({ name: f.name, role: f.role, active: f.active === 'yes', user_note: f.note || null, title: f.title || null, patch: f.patch || null }).eq('email', m.email);
    if (e) return fail(e);
    toast('Saved'); renderUsers().catch(fail);
  });
}

/* ---------- audit ---------- */
async function renderAudit() {
  const { data, error } = await sb.from('audit_log').select('*').order('at', { ascending: false }).limit(150);
  if (error) throw error;
  const quiet = l => ['invites', 'auth'].includes(l.entity);
  $('#adm').innerHTML = data.length ? data.map(l => `<div class="log"><div class="muted">${fmt(l.at)}${quiet(l) ? '' : ` · ${esc(displayId(l.actor_email || '') || 'system')} · ${esc(l.action)} ${esc(l.entity)} ${esc(l.entity_id)}`}</div>${esc(summarise(l))}</div>`).join('')
    + '<div class="muted small" style="padding:12px 0">Sign-ins are logged when someone types their password. Opening the app while already signed in is not logged.</div>' : '<div class="empty">No activity yet.</div>';
}
