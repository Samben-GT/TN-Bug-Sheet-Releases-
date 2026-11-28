/* Work: to-do items the admin assigns to staff (Bala: calls to verify numbers, Niranjan: photos, FSD review).
 * Also: "View as" for the admin (see the app as a member, using the admin's own session, so nothing is
 * impersonated and every save is still recorded under the admin), and MLA photo slots (staff upload thumbnails). */
let viewAs = null; // { email, name, role, title, patch } while the admin views as someone
const eff = () => viewAs || me;
const WK = { items: [] };
const WKIND = { call_verify: 'Call to verify', upload: 'Upload', review: 'Review', other: 'Task' };
const WSTAT = { todo: 'To do', doing: 'Started', done: 'Done', blocked: 'Stuck' };
const REACHED = [['answered', 'They picked up'], ['no_answer', 'Rang, no answer'], ['switched_off', 'Switched off / not reachable'], ['wrong_number', 'Wrong number / does not exist']];
const RIGHT = [['yes', 'Yes, this is that office'], ['no', 'No, a different office or person'], ['unsure', 'Not sure']];

/* ---------- after sign-in ---------- */
async function workAfterSignIn() {
  viewAs = null; renderViewAsBar();
  await loadWork();
}
async function loadWork() {
  if (!me) return;
  const who = eff().email.toLowerCase();
  const { data, error } = await sb.from('work_items').select('*').eq('assignee', who).order('sort').order('created_at');
  WK.items = error ? [] : (data || []);
  const open = WK.items.filter(x => x.status !== 'done').length;
  $('#btnWork').hidden = !(open || WK.items.length || me.role === 'admin');
  $('#wcnt').textContent = open;
}
$('#btnWork').onclick = () => { renderWork(); show('scrWork'); };

/* ---------- my work ---------- */
function renderWork() {
  const who = eff(), open = WK.items.filter(x => x.status !== 'done'), done = WK.items.filter(x => x.status === 'done');
  const first = (who.name || who.email).split(' ')[0];
  $('#workTitle').textContent = viewAs ? first + "'s work" : 'My work';
  $('#work').innerHTML = (WK.items.length ? `<div class="streak-banner"><div><div style="font-weight:800;font-size:15px">${open.length} to do · ${done.length} done</div>
      <div class="small muted">${open.length ? 'Tap a task to start' : 'All done. Nice.'} · என் வேலைகள்</div></div>
      <span class="tag ${open.length ? 'pending' : 'resolved'}">${open.length ? 'In progress' : 'Clear'}</span></div>` : '')
    + (open.length ? open.map(wiHtml).join('') : '<div class="empty">Nothing assigned right now.</div>')
    + (done.length ? `<h3>Done</h3>${done.map(wiHtml).join('')}` : '')
    + (me.role === 'rm' || me.role === 'admin' ? '<button class="cta static ghost" id="wFaces">Photo slots: MLAs, parties, officers</button>' : '');
  $('#work').querySelectorAll('[data-wi]').forEach(b => b.onclick = () => wiAct(b.dataset.wi, b.dataset.a));
  if ($('#wFaces')) $('#wFaces').onclick = openFaces;
}
function wiHtml(w) {
  const r = w.result || {}, calls = r.calls || [];
  const last = calls[calls.length - 1];
  return `<div class="item wi ${w.status}"><div class="item-top"><div class="t">
      <div class="vkind">${WKIND[w.kind] || 'Task'}</div>
      <div style="font-weight:700">${esc(w.title)}</div>
      ${w.details ? `<div class="muted small" style="margin-top:4px">${esc(w.details)}</div>` : ''}
      ${last ? `<div class="small" style="margin-top:6px"><b>Last call:</b> ${esc((REACHED.find(x => x[0] === last.reached) || [, last.reached])[1])}${last.spoke_to ? ' · ' + esc(last.spoke_to) : ''} · ${new Date(last.at).toLocaleString('en-IN')}</div>` : ''}
      ${w.status === 'done' && w.done_at ? `<div class="muted small">Done ${new Date(w.done_at).toLocaleString('en-IN')}</div>` : ''}
    </div><span class="tag ${w.status === 'done' ? 'resolved' : w.status === 'blocked' ? 'rejected' : w.status === 'doing' ? 'pending' : ''}">${WSTAT[w.status]}</span></div>
    <div class="vacts">
      ${w.link ? `<button data-wi="${w.id}" data-a="link">Open ${esc(w.link_label || 'link')}</button>` : ''}
      ${w.kind === 'upload' && /photo/i.test(w.title) ? `<button data-wi="${w.id}" data-a="faces">Photo slots</button>` : ''}
      ${w.kind === 'call_verify' && w.status !== 'done' ? `<button data-wi="${w.id}" data-a="call">Log a call</button>` : ''}
      ${w.status === 'todo' ? `<button data-wi="${w.id}" data-a="doing">Start</button>` : ''}
      ${w.status !== 'done' && w.kind !== 'call_verify' ? `<button data-wi="${w.id}" data-a="done" data-v="correct">Done</button>` : ''}
      ${w.status !== 'done' && w.status !== 'blocked' ? `<button data-wi="${w.id}" data-a="blocked">Stuck</button>` : ''}
      ${w.status === 'done' || w.status === 'blocked' ? `<button data-wi="${w.id}" data-a="todo">Reopen</button>` : ''}
    </div></div>`;
}
async function wiAct(id, a) {
  const w = WK.items.find(x => x.id === id); if (!w) return;
  if (a === 'link') { window.open(w.link, '_blank', 'noopener'); return; }
  if (a === 'faces') { openFaces(); return; }
  if (a === 'call') { callLog(w); return; }
  let note = null;
  if (a === 'blocked') { note = prompt('What is stopping you? (Sam sees this)'); if (note === null) return; }
  const result = note ? { ...(w.result || {}), stuck: note.slice(0, 300) } : w.result;
  const { error } = await sb.from('work_items').update({ status: a, result }).eq('id', id);
  if (error) return toast(error.message, 4000);
  toast(a === 'done' ? 'Marked done' : 'Updated'); await loadWork(); renderWork();
}

/* ---------- log a verification call ---------- */
const selStyle = el => el.querySelectorAll('select').forEach(x => Object.assign(x.style, { width: '100%', padding: '12px', background: 'var(--soft)', color: 'var(--text)', border: '1.5px solid var(--line)', borderRadius: '12px' }));
function callLog(w) {
  $('#mTitle').textContent = 'Log the call';
  $('#mBody').innerHTML = `<p class="muted small">${esc(w.title)}. Fill what you remember. Rough notes are fine, a recording fills the gaps later. If you record, tell them at the start that the call is recorded.</p>
    <label for="kReach">What happened?</label><select id="kReach">${REACHED.map(x => `<option value="${x[0]}">${x[1]}</option>`).join('')}</select>
    <div id="kAns">
      <label for="kRight">Is this the right office?</label><select id="kRight">${RIGHT.map(x => `<option value="${x[0]}">${x[1]}</option>`).join('')}</select>
      <label for="kWho">Who did you speak to? (name and post, as they said)</label><input id="kWho" placeholder="Mr. Kumar, AE Chromepet">
      <label for="kNum">Correct number for this office, if they gave one</label><input id="kNum" inputmode="tel" placeholder="Only if different">
      <label for="kArea">Which areas or zone do they cover?</label><input id="kArea" placeholder="Zone 3: Chromepet, Hastinapuram">
    </div>
    <label for="kNotes">What was discussed</label><textarea id="kNotes" rows="4" placeholder="Anything they said, in Tamil or English"></textarea>
    <label for="kRec">Call recording (optional)</label><input id="kRec" type="file" accept="audio/*">
    <p class="muted small">Up to 20 MB. Staff only. Sam can get it transcribed later.</p>
    <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="kDone" type="checkbox" style="width:auto" checked> This task is finished</label>`;
  selStyle($('#mBody'));
  const sync = () => { const ans = $('#kReach').value === 'answered'; $('#kAns').hidden = !ans; $('#kDone').checked = ans; };
  $('#kReach').onchange = sync; sync();
  $('#mOk').textContent = 'Save'; $('#mCancel').textContent = 'Cancel';
  const close = () => $('#modal').classList.remove('on');
  $('#mCancel').onclick = close;
  $('#mOk').onclick = async () => {
    const reached = $('#kReach').value, ans = reached === 'answered', file = $('#kRec').files[0];
    if (file && file.size > 20e6) return toast('Recording is over 20 MB');
    $('#mOk').disabled = true; $('#mOk').textContent = 'Saving...';
    try {
      let rec = null;
      if (file) {
        const ext = (file.name.split('.').pop() || 'm4a').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
        rec = `${me.id}/call-${w.id}-${Date.now()}.${ext}`;
        const up = await sb.storage.from('evidence').upload(rec, file, { contentType: file.type || 'audio/mp4' });
        if (up.error) throw up.error;
      }
      const call = { at: new Date().toISOString(), by: me.email, reached,
        right_office: ans ? $('#kRight').value : null, spoke_to: ans ? $('#kWho').value.trim().slice(0, 160) || null : null,
        correct_number: ans ? $('#kNum').value.trim().slice(0, 40) || null : null, area: ans ? $('#kArea').value.trim().slice(0, 300) || null : null,
        notes: $('#kNotes').value.trim().slice(0, 3000) || null, recording: rec, transcript: null };
      if (w.entry_id && ans) {
        const verdict = call.right_office === 'yes' && !call.correct_number ? 'correct' : call.right_office === 'no' || call.correct_number ? 'wrong' : 'unsure';
        const note = [call.spoke_to && 'Spoke to ' + call.spoke_to, call.correct_number && 'Correct number: ' + call.correct_number, call.area && 'Covers: ' + call.area, call.notes].filter(Boolean).join('. ').slice(0, 500);
        const ins = { entry_id: w.entry_id, verdict, method: 'called', note: note || null, evidence: rec };
        if (call.correct_number) ins.proposed = { phone: call.correct_number };
        const { error: ce } = await sb.from('entry_checks').insert(ins);
        if (ce) throw ce;
      }
      const result = { ...(w.result || {}), calls: [...((w.result || {}).calls || []), call] };
      const { error } = await sb.from('work_items').update({ result, status: $('#kDone').checked ? 'done' : 'doing' }).eq('id', w.id);
      if (error) throw error;
      close(); toast('Call saved'); await loadWork(); renderWork();
    } catch (err) { toast((err && err.message) || String(err), 4500); }
    finally { $('#mOk').disabled = false; $('#mOk').textContent = 'Save'; }
  };
  $('#modal').classList.add('on');
}

/* ---------- admin: everyone's work, add tasks, view as ---------- */
async function renderWorkAdmin() {
  const [{ data: items, error }, { data: mem }] = await Promise.all([
    sb.from('work_items').select('*').order('assignee').order('sort').order('created_at'),
    sb.from('members').select('email,name,role,title,patch,active').order('added_at')]);
  if (error) throw error;
  const people = (mem || []).filter(m => m.active !== false);
  WK.people = people; WK.all = items || [];
  const byWho = e => WK.all.filter(x => x.assignee === e);
  $('#adm').innerHTML = `<button class="cta static" id="wAdd">Add a task</button>
    <button class="cta static ghost" id="wFacesA">Photo slots: MLAs, parties, officers</button>
    ${people.map(p => {
      const list = byWho(p.email), open = list.filter(x => x.status !== 'done').length;
      return `<div class="user"><div class="top"><div><b>${esc(p.name || p.email)}</b>${p.title ? ' <span class="tag filed">' + esc(p.title) + '</span>' : ''}
          <div class="muted small">${esc(p.role)} · ${list.length ? `${open} open of ${list.length}` : 'no tasks'}</div></div>
          ${p.email !== me.email ? `<button class="mini" data-va="${esc(p.email)}">View as</button>` : ''}</div>
        ${list.map(w => {
          const calls = ((w.result || {}).calls || []);
          return `<div class="rc"><div class="rc-t"><div><div style="font-weight:700;font-size:13.5px">${esc(w.title)}</div>
            <div class="muted small">${WKIND[w.kind]}${calls.length ? ` · ${calls.length} call${calls.length > 1 ? 's' : ''} logged` : ''}${(w.result || {}).stuck ? ' · stuck: ' + esc(w.result.stuck) : ''}</div></div>
            <span class="rc-k">${WSTAT[w.status]}</span></div>
            ${calls.map(c => `<div class="small" style="margin-top:6px;border-top:1px solid var(--line);padding-top:6px">${new Date(c.at).toLocaleString('en-IN')} · ${esc((REACHED.find(x => x[0] === c.reached) || [, c.reached])[1])}
              ${c.right_office ? ' · right office: ' + esc(c.right_office) : ''}${c.spoke_to ? '<br>Spoke to: ' + esc(c.spoke_to) : ''}${c.correct_number ? '<br>Correct number: <b>' + esc(c.correct_number) + '</b>' : ''}
              ${c.area ? '<br>Covers: ' + esc(c.area) : ''}${c.notes ? '<br>' + esc(c.notes) : ''}${c.recording ? `<br><button class="mini" data-rec="${esc(c.recording)}">Play recording</button>` : ''}${c.transcript ? '<br><i>Transcript:</i> ' + esc(c.transcript) : ''}</div>`).join('')}
            <div style="margin-top:6px"><button class="mini" data-wdel="${w.id}">Delete</button></div></div>`;
        }).join('')}</div>`;
    }).join('')}`;
  $('#wAdd').onclick = () => addTask();
  $('#wFacesA').onclick = openFaces;
  $('#adm').querySelectorAll('[data-va]').forEach(b => b.onclick = () => startViewAs(people.find(p => p.email === b.dataset.va)));
  $('#adm').querySelectorAll('[data-rec]').forEach(b => b.onclick = async () => {
    const { data, error: e } = await sb.storage.from('evidence').createSignedUrl(b.dataset.rec, 600);
    if (e || !data) return toast(e ? e.message : 'Could not open the recording');
    window.open(data.signedUrl, '_blank', 'noopener');
  });
  $('#adm').querySelectorAll('[data-wdel]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this task?')) return;
    const { error: e } = await sb.from('work_items').delete().eq('id', b.dataset.wdel);
    if (e) return toast(e.message); renderWorkAdmin();
  });
}
function addTask() {
  $('#mTitle').textContent = 'Add a task';
  $('#mBody').innerHTML = `<label for="tWho">For</label><select id="tWho">${WK.people.map(p => `<option value="${esc(p.email)}">${esc(p.name || p.email)}</option>`).join('')}</select>
    <label for="tKind">Kind</label><select id="tKind">${Object.entries(WKIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <label for="tTitle">Task</label><input id="tTitle" placeholder="Call the AE Pammal and confirm the number">
    <label for="tDet">Details (optional)</label><textarea id="tDet" rows="3"></textarea>
    <label for="tLink">Link (optional, e.g. a Drive doc)</label><input id="tLink" placeholder="https://docs.google.com/...">
    <label for="tLinkL">Link name</label><input id="tLinkL" placeholder="FSD">`;
  selStyle($('#mBody'));
  $('#mOk').textContent = 'Add'; $('#mCancel').textContent = 'Cancel';
  $('#mCancel').onclick = () => $('#modal').classList.remove('on');
  $('#mOk').onclick = async () => {
    const title = $('#tTitle').value.trim(), link = $('#tLink').value.trim();
    if (!title) return toast('Type the task');
    if (link && !/^https:\/\//.test(link)) return toast('Link must start with https://');
    const { error } = await sb.from('work_items').insert({ assignee: $('#tWho').value, kind: $('#tKind').value, title: title.slice(0, 160),
      details: $('#tDet').value.trim().slice(0, 1500) || null, link: link || null, link_label: $('#tLinkL').value.trim().slice(0, 80) || null });
    if (error) return toast(error.message, 4000);
    $('#modal').classList.remove('on'); toast('Task added'); renderWorkAdmin();
  };
  $('#modal').classList.add('on');
}

/* ---------- view as ---------- */
async function startViewAs(p) {
  if (!p || !me || me.role !== 'admin') return;
  viewAs = { email: p.email, name: p.name, role: p.role, title: p.title, patch: p.patch };
  $('#btnAdmin').hidden = true;
  if (typeof V !== 'undefined') delete V.patch;
  renderViewAsBar(); await loadWork();
  stack.length = 1; show('scrMap', false);
  try { sessionStorage.removeItem('tnb-welcomed'); } catch (_) {}
  if (p.title) welcomeTitle(p.title);
  toast(`Viewing as ${p.name || p.email}. Anything you save is still recorded as you.`, 4000);
}
async function stopViewAs() {
  viewAs = null; $('#btnAdmin').hidden = !(me && me.role === 'admin');
  if (typeof V !== 'undefined') delete V.patch;
  renderViewAsBar(); await loadWork(); stack.length = 1; show('scrMap', false);
}
function renderViewAsBar() {
  let bar = $('#viewAsBar');
  if (!viewAs) { if (bar) bar.remove(); document.body.classList.remove('viewing-as'); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'viewAsBar'; document.body.appendChild(bar); }
  bar.innerHTML = `<span>Viewing as <b>${esc(viewAs.name || viewAs.email)}</b> · ${esc(viewAs.title || viewAs.role)}</span><button id="vaExit">Exit</button>`;
  document.body.classList.add('viewing-as');
  $('#vaExit').onclick = stopViewAs;
}

/* ---------- MLA photo slots: staff upload one thumbnail per constituency ---------- */
const FACES = { map: null, urls: new Map(), filter: 'missing', q: '', group: 'mla' };
async function loadFaces(force) {
  if (FACES.map && !force) return;
  const { data } = await sb.from('face_photos').select('key,path,source_url,uploaded_by,updated_at');
  FACES.map = new Map((data || []).map(x => [x.key, x]));
}
async function faceUrls(keys) {
  await loadFaces();
  const need = keys.filter(k => FACES.map.has(k) && !FACES.urls.has(k));
  if (need.length) {
    const { data } = await sb.storage.from('faces').createSignedUrls(need.map(k => FACES.map.get(k).path), 3600);
    (data || []).forEach((d, i) => { if (d.signedUrl) FACES.urls.set(need[i], d.signedUrl); });
  }
}
// fill <img data-face="ac-12"> placeholders inside an element
async function fillFaces(root) {
  const els = [...root.querySelectorAll('[data-face]')]; if (!els.length) return;
  try { await Promise.all([faceUrls(els.map(e => e.dataset.face)), typeof loadWiki === 'function' ? loadWiki() : null]); } catch (_) { return; }
  els.forEach(e => { const u = FACES.urls.get(e.dataset.face) || (typeof wikiThumb === 'function' ? wikiThumb(e.dataset.face) : null); if (u) { e.src = u; e.hidden = false; } });
}
async function openFaces() {
  show('scrFaces');
  $('#faces').innerHTML = loaderHtml('Loading...');
  const [, , offs] = await Promise.all([loadDirectory(), loadFaces(true), sb.from('officers').select('id,name,post,area').order('sort'), loadWiki(true)]);
  FACES.officers = offs.data || [];
  renderFaces();
}
function faceSlots() {
  if (FACES.group === 'party') return DIR.parties.map(p => ({ key: 'party-' + p.code, kind: 'party', full: p.name, name: p.code, sub: p.name, hint: 'Party symbol or flag from the party\'s own site' }));
  if (FACES.group === 'off') return FACES.officers.filter(o => o.name).map(o => ({ key: 'off-' + o.id, kind: 'off', name: o.name, sub: o.post, hint: 'Official photo (department or district site)' }));
  return DIR.acs.filter(a => a.status !== 'vacant').map(a => ({ key: 'ac-' + a.ac_no, kind: 'mla', place: a.name, name: a.mla_name, sub: `${a.name} (${a.ac_no}) · ${a.district}`, copy: `${a.mla_name}, MLA ${a.name}`, hint: 'Official photo (assembly or government site) or Wikimedia Commons' }));
}
function renderFaces() {
  const all = faceSlots(), have = all.filter(x => FACES.map.has(x.key)).length;
  const q = FACES.q.trim().toLowerCase();
  const list = all.filter(x => (FACES.filter === 'all' || (FACES.filter === 'missing') !== FACES.map.has(x.key))
    && (!q || [x.name, x.sub].join(' ').toLowerCase().includes(q)));
  $('#faces').innerHTML = `<div class="seg" id="fGrp">${[['mla', 'MLAs'], ['party', 'Parties'], ['off', 'Officers']].map(x => `<button data-g="${x[0]}" class="${FACES.group === x[0] ? 'on' : ''}">${x[1]}</button>`).join('')}</div>
    <div class="streak-banner" style="margin-top:10px"><div><div style="font-weight:800;font-size:15px">${have} of ${all.length} photos</div>
      <div class="small muted">${esc((all[0] || {}).hint || '')}. Paste where you got it.</div></div></div>
    <div class="seg" id="fSeg">${[['missing', 'Missing'], ['done', 'Done'], ['all', 'All']].map(x => `<button data-f="${x[0]}" class="${FACES.filter === x[0] ? 'on' : ''}">${x[1]}</button>`).join('')}</div>
    <input id="fQ" placeholder="Search" value="${esc(FACES.q)}" style="margin:10px 0">
    ${me.role === 'admin' ? `<button class="cta static ghost" id="fWiki" style="margin-top:0">Find on Wikipedia (${all.filter(x => !PW.map.has(x.key)).length} not checked)</button>` : ''}
    ${all.some(x => (PW.map.get(x.key) || {}).status === 'review') ? `<p class="small" style="margin:8px 0">${all.filter(x => (PW.map.get(x.key) || {}).status === 'review').length} Wikipedia match(es) need your check: tap "Check".</p>` : ''}
    ${FACES.filter === 'missing' && list.length ? '<button class="cta static ghost" id="fCopy" style="margin-top:8px">Copy the missing names</button>' : ''}
    ${list.slice(0, 120).map(x => `<div class="pol-row"><span class="av"><span class="no">${esc((x.name || '?').slice(0, x.key.startsWith('party') ? 3 : 1))}</span><img data-face="${esc(x.key)}" alt="" hidden onload="this.previousElementSibling.hidden=true"></span>
      <div class="pr-t"><b>${esc(x.name)}</b><span class="muted small">${esc(x.sub || '')}${(() => { const w = PW.map.get(x.key); return !w ? '' : w.status === 'review' ? ' · <b>Wikipedia: check</b>' : wikiOk(w) ? ' · Wikipedia ✓' + (w.thumb_commons ? ' with photo' : '') : ' · Wikipedia: no'; })()}</span></div>
      ${(PW.map.get(x.key) || {}).status === 'review' && me.role === 'admin' ? `<button class="pr-btn" data-wr="${esc(x.key)}">Check</button>` : ''}
      <button class="pr-btn" data-fk="${esc(x.key)}">${FACES.map.has(x.key) ? 'Replace' : 'Add photo'}</button></div>`).join('')}
    ${list.length > 120 ? `<p class="muted small">Showing 120 of ${list.length}. Search to narrow.</p>` : ''}${!list.length ? '<div class="empty">Nothing here.</div>' : ''}`;
  $('#fGrp').querySelectorAll('button').forEach(b => b.onclick = () => { FACES.group = b.dataset.g; FACES.q = ''; renderFaces(); });
  $('#fSeg').querySelectorAll('button').forEach(b => b.onclick = () => { FACES.filter = b.dataset.f; renderFaces(); });
  $('#fQ').oninput = e => { FACES.q = e.target.value; clearTimeout(FACES.t); FACES.t = setTimeout(() => { renderFaces(); const i = $('#fQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  if ($('#fCopy')) $('#fCopy').onclick = async () => {
    const text = list.map(x => x.copy || `${x.name}, ${x.sub}`).join('\n');
    try { await navigator.clipboard.writeText(text); toast(list.length + ' names copied'); } catch (_) { toast('Could not copy'); }
  };
  $('#faces').querySelectorAll('[data-fk]').forEach(b => b.onclick = () => addFace(all.find(x => x.key === b.dataset.fk)));
  $('#faces').querySelectorAll('[data-wr]').forEach(b => b.onclick = () => wikiReview(b.dataset.wr, (all.find(x => x.key === b.dataset.wr) || {}).name));
  if ($('#fWiki')) { $('#fWiki').onclick = () => wikiRun(all, false); $('#fWiki').oncontextmenu = e => { e.preventDefault(); if (confirm('Recheck everyone in this group on Wikipedia?')) wikiRun(all, true); }; }
  fillFaces($('#faces'));
}
// square-crop to 240 px from the top centre (faces sit high in portraits)
function faceThumb(file, centre) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height), sx = (img.width - s) / 2, sy = img.height > img.width ? (centre ? (img.height - s) / 2 : Math.min((img.height - s) * 0.15, img.height - s)) : 0;
      const c = document.createElement('canvas'); c.width = c.height = 240;
      c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, 240, 240); URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error('Could not shrink the photo')), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read that photo')); };
    img.src = url;
  });
}
function addFace(x) {
  if (!x) return;
  const key = x.key, cur = FACES.map.get(key), party = key.startsWith('party-');
  $('#mTitle').textContent = x.name;
  $('#mBody').innerHTML = `<p class="muted small">${esc(x.sub || '')}. ${party ? 'Pick the party symbol or flag.' : 'Pick a clear photo of the face.'} It is cut to a small square thumbnail.</p>
    <label for="fFile">Photo</label><input id="fFile" type="file" accept="image/*">
    <label for="fSrc">Where is it from? (page link)</label><input id="fSrc" placeholder="https://assembly.tn.gov.in/..." value="${esc(cur ? cur.source_url : '')}">`;
  $('#mOk').textContent = 'Save'; $('#mCancel').textContent = 'Cancel';
  $('#mCancel').onclick = () => $('#modal').classList.remove('on');
  $('#mOk').onclick = async () => {
    const f = $('#fFile').files[0], src = $('#fSrc').value.trim();
    if (!f) return toast('Pick a photo');
    if (!/^https?:\/\/\S+\.\S+/.test(src)) return toast('Paste the link of the page the photo came from');
    $('#mOk').disabled = true; $('#mOk').textContent = 'Saving...';
    try {
      const blob = await faceThumb(f, party), path = `${key.replace(/[^A-Za-z0-9-]/g, '_')}-${Date.now()}.jpg`;
      const up = await sb.storage.from('faces').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const { error } = await sb.from('face_photos').upsert({ key, path, source_url: src.slice(0, 400), uploaded_by: me.email, updated_at: new Date().toISOString() });
      if (error) throw error;
      FACES.urls.delete(key); await loadFaces(true);
      $('#modal').classList.remove('on'); toast('Photo saved'); renderFaces();
    } catch (err) { toast((err && err.message) || String(err), 4500); }
    finally { $('#mOk').disabled = false; $('#mOk').textContent = 'Save'; }
  };
  $('#modal').classList.add('on');
}
