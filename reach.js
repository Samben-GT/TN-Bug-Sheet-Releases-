/* Reach map: every stakeholder for a bug and whether the bug has actually reached them.
 * Staff (admin, relationship managers) add offices from the directory, the MLA, the portal or anyone else,
 * then move each one along: planned, sent, reached, acknowledged, acting, fixed (or no response / refused / wrong office).
 * Every change is in the audit log. */
const REACH = [['planned', 'Planned'], ['sent', 'Sent, no reply yet'], ['reached', 'Reached them'], ['acknowledged', 'Acknowledged'], ['acting', 'Acting on it'], ['fixed', 'Fixed'],
  ['no_response', 'No response'], ['refused', 'Refused'], ['wrong_office', 'Wrong office']];
const LADDER = ['planned', 'sent', 'reached', 'acknowledged', 'acting', 'fixed'];
const RKIND = [['owner', 'Fixes it'], ['escalation', 'Escalation'], ['elected', 'Elected rep'], ['portal', 'Portal or helpline'], ['media', 'Media or public post'], ['other', 'Other']];
const RCHAN = [['', 'Not yet'], ['call', 'Phone call'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['portal', 'Portal'], ['visit', 'Visited'], ['letter', 'Letter'], ['x', 'X post'], ['in_person', 'Met in person']];
const lab = (list, k) => (list.find(x => x[0] === k) || [0, k || '-'])[1];

function reachHtml() { return `<div class="plan reach" id="reachBox"><div class="plan-h">Who has it</div><p class="muted small">Loading...</p></div>`; }

async function bindReach(r) {
  const box = $('#reachBox'); if (!box) return;
  const { data, error } = await sb.from('bug_contacts').select('*').eq('report_id', r.id).order('created_at');
  if (error) { box.innerHTML = `<div class="plan-h">Who has it</div><p class="small">${esc(error.message)}</p>`; return; }
  const list = data || [], today = new Date().toISOString().slice(0, 10);
  const reached = list.filter(c => ['reached', 'acknowledged', 'acting', 'fixed'].includes(c.status)).length;
  const acked = list.filter(c => ['acknowledged', 'acting', 'fixed'].includes(c.status)).length;
  box.innerHTML = `<div class="plan-h">Who has it</div>
    <p class="small" style="margin:0 0 8px">${list.length ? `<b>Reached ${reached} of ${list.length}</b>${acked ? ` · ${acked} acknowledged` : ''}` : 'No stakeholders mapped yet. Add the office that fixes it first, then who to escalate to.'}</p>
    ${list.map(c => {
      const i = LADDER.indexOf(c.status), bad = i < 0, late = c.follow_up && c.follow_up < today && !['fixed', 'refused', 'wrong_office'].includes(c.status);
      return `<button class="rc" data-c="${c.id}">
        <div class="rc-t"><b>${esc(c.who)}</b><span class="rc-k">${esc(lab(RKIND, c.kind))}</span></div>
        <div class="rc-l">${LADDER.map((s, j) => `<i class="${!bad && j <= i ? 'on' : ''}"></i>`).join('')}<span class="rc-s ${bad ? 'bad' : c.status}">${esc(lab(REACH, c.status))}</span></div>
        <div class="muted small">${[c.channel && lab(RCHAN, c.channel), c.ref && 'Ref ' + esc(c.ref), c.contacted_at && 'on ' + new Date(c.contacted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
          c.follow_up && `<span class="${late ? 'danger' : ''}">follow up ${new Date(c.follow_up).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}${late ? ' (overdue)' : ''}</span>`].filter(Boolean).join(' · ')}</div>
        ${c.note ? `<div class="small">${esc(c.note)}</div>` : ''}</button>`; }).join('')}
    <button class="cta static ghost" id="reachAdd" style="margin-top:10px">Add a stakeholder</button>`;
  box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => editContact(r, list.find(c => c.id === b.dataset.c)));
  $('#reachAdd').onclick = () => addContact(r, list);
}

async function addContact(r, list) {
  const offices = await officesFor(r).catch(() => []);
  const ac = typeof acAt === 'function' ? acAt(r.lat, r.lng) : null;
  const a = ac && typeof DIR !== 'undefined' && DIR.byAc ? DIR.byAc.get(ac) : null;
  const have = new Set(list.map(c => c.entry_id || c.who));
  const opts = offices.filter(e => !have.has(e.id)).slice(0, 25).map(e => ['e:' + e.id, e.name]);
  if (a && !have.has('MLA, ' + a.name)) opts.push(['mla', 'MLA, ' + a.name]);
  const rt = r.routing || {}; if (rt.portal && !have.has(rt.portal)) opts.push(['portal', rt.portal]);
  opts.push(['other', 'Someone else (type below)']);
  const f = await form('Add a stakeholder', [
    { key: 'pick', label: 'Who', type: 'select', options: opts, value: opts[0][0] },
    { key: 'who', label: 'Name of office or post (only for Someone else)', hint: 'Ward councillor, Ward 12 / CM Helpline 1100' },
    { key: 'kind', label: 'Their part', type: 'select', options: RKIND, value: opts[0][0].startsWith('e:') && !list.length ? 'owner' : opts[0][0] === 'mla' ? 'elected' : 'escalation' },
    { key: 'status', label: 'Has it reached them?', type: 'select', options: REACH, value: 'planned' },
    { key: 'channel', label: 'How', type: 'select', options: RCHAN, value: '' },
    { key: 'ref', label: 'Complaint or reference number', hint: 'From the call or portal' },
    { key: 'follow_up', label: 'Follow up on', type: 'date' },
    { key: 'note', label: 'Note', type: 'area', hint: 'Spoke to the section office, said crew will come tomorrow' }], 'Add');
  if (!f) return;
  let who = '', entry_id = null, kind = f.kind;
  if (f.pick.startsWith('e:')) { entry_id = f.pick.slice(2); who = (offices.find(e => e.id === entry_id) || {}).name; }
  else if (f.pick === 'mla') { who = 'MLA, ' + a.name; kind = kind === 'owner' ? 'elected' : kind; }
  else if (f.pick === 'portal') { who = rt.portal; }
  else who = f.who;
  if (!who || who.length < 2) return toast('Type the office or post');
  const row = { report_id: r.id, entry_id, who, kind, status: f.status, channel: f.channel || null, ref: f.ref || null, note: f.note || null,
    follow_up: f.follow_up || null, contacted_at: f.status !== 'planned' ? new Date().toISOString() : null };
  const { error } = await sb.from('bug_contacts').insert(row);
  if (error) return toast(error.message, 4500);
  toast('Added'); bindReach(r);
}

async function editContact(r, c) {
  const f = await form(c.who, [
    { key: 'status', label: 'Has it reached them?', type: 'select', options: REACH, value: c.status },
    { key: 'channel', label: 'How', type: 'select', options: RCHAN, value: c.channel || '' },
    { key: 'ref', label: 'Complaint or reference number', value: c.ref },
    { key: 'follow_up', label: 'Follow up on', type: 'date', value: c.follow_up },
    { key: 'kind', label: 'Their part', type: 'select', options: RKIND, value: c.kind },
    { key: 'note', label: 'Note', type: 'area', value: c.note }], 'Save');
  if (!f) return;
  const upd = { status: f.status, channel: f.channel || null, ref: f.ref || null, follow_up: f.follow_up || null, kind: f.kind, note: f.note || null, updated_at: new Date().toISOString() };
  if (f.status !== c.status && f.status !== 'planned') upd.contacted_at = new Date().toISOString();
  const { error } = await sb.from('bug_contacts').update(upd).eq('id', c.id);
  if (error) return toast(error.message, 4500);
  toast('Saved'); bindReach(r);
}
