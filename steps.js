/* "What we'll do next": the live step list for one bug. The reporter and the team see the same list.
   Anyone working the bug can do a step, mark it done and say what was done, with photos, a voice note or a short video.
   Team steps (checking the report) only the team can tick. The team can also add, skip or reopen steps.
   Steps start from the rules plan in playbook.js; attachments go to the private "steps" bucket, in the report's folder. */
const STEPS = { timer: null };

// the first set of steps for a report, written so a reporter can act on them
function stepsFor(r) {
  const p = window.planFor ? planFor(r) : { steps: [], owner: 'the responsible office' };
  const wk = window.wardOf ? wardOf(r) : r.ward, c = wk && window.councillorFor ? councillorFor(wk) : null;
  const out = [{ who: 'team', title: 'Check the report', detail: 'Our team checks the photo, the spot and the category, usually within 48 hours.' }];
  p.steps.forEach((s, i) => out.push({ who: 'anyone', title: s.replace(/\s*Log the complaint number here\.?/i, '').replace(/\(see the area panel\)/i, '(see the area card)').slice(0, 200) || s,
    detail: i === 0 ? `Who fixes it: ${p.owner}. If you get a complaint number, put it in your note.` : '' }));
  if (c && c.phone && !['wires', 'power'].includes(r.category)) out.splice(2, 0, { who: 'anyone', title: `Tell the ward councillor, ${cleanName(c.name)}`, detail: `Ward ${c.ward}. Phone ${c.phone}, published by the corporation. Ask them to follow it up.` });
  out.push({ who: 'anyone', title: 'Confirm it is fixed', detail: 'Go back to the spot and add a photo after the fix.' });
  return out;
}
window.stepsFor = stepsFor;

async function loadSteps(r, seed) {
  const { data, error } = await sb.from('bug_steps').select('*').eq('report_id', r.id).order('ord');
  if (error) throw error;
  if (data && data.length) return data;
  if (!seed) return [];
  await sb.rpc('seed_steps', { p_report: r.id, p_steps: stepsFor(r) });
  const again = await sb.from('bug_steps').select('*').eq('report_id', r.id).order('ord');
  return again.data || [];
}

const stepWhen = t => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
async function stepMediaUrls(steps) {
  const paths = steps.flatMap(s => (s.media || []).map(m => m.path)).filter(Boolean);
  if (!paths.length) return {};
  const { data } = await sb.storage.from('steps').createSignedUrls(paths, 3600);
  return Object.fromEntries((data || []).filter(x => x.signedUrl).map(x => [x.path, x.signedUrl]));
}
function mediaHtml(m, url) { return !url ? '' : m.kind === 'image' ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="" loading="lazy"></a>`
  : m.kind === 'audio' ? `<audio controls preload="none" src="${url}"></audio>` : `<video controls preload="metadata" src="${url}"></video>`; }


/* ---------- who to contact for a step, at this bug's spot ----------
   Built from our own data: police stations (officers, rank Inspector, with a map position) and their ACP/DCP/Commissioner,
   the ward councillor, the area MLA, and the offices in the Verify directory for this spot (TNPDCL for power).
   Official contacts and public roles only. A row with no number still shows the post, so people know whom to ask for. */
const kmTo = (a, b, c, d) => { const t = Math.PI / 180, x = (d - b) * t * Math.cos((a + c) / 2 * t), y = (c - a) * t; return 6371 * Math.hypot(x, y); };
async function contactsFor(r) {
  STEPS.who = STEPS.who || {};
  if (STEPS.who[r.id]) return STEPS.who[r.id];
  const out = { police: [], local: [], power: [], mla: [] };
  try { await Promise.all([window.loadOff ? loadOff() : null, window.loadCouncillors ? loadCouncillors() : null, window.loadDirectory ? loadDirectory() : null, window.loadLocal ? loadLocal().catch(() => {}) : null]); } catch (_) {}
  const off = (typeof OFF !== 'undefined' && OFF) || [], byId = new Map(off.map(o => [o.id, o]));
  const person = (o, why) => o && ({ name: o.name || '', post: o.post, phone: o.phone || '', why });
  // police: nearest stations from OpenStreetMap (fetched on the phone), matched by name to our station list for the number,
  // then the chain above the nearest one (ACP, DCP, Commissioner)
  if (r.lat && r.lng) {
    const sq = x => String(x || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/inspector of police|police station|police|station|traffic|law and order|crime|all women|\bps\b/g, ' ')
      .replace(/[^a-z]/g, '').replace(/th/g, 't').replace(/g/g, 'k').replace(/ee/g, 'i').replace(/oo/g, 'u');
    const ours = off.filter(o => o.rank === 'Inspector');
    let near = [];
    try {
      const q = `[out:json][timeout:20];(node["amenity"="police"](around:8000,${r.lat},${r.lng});way["amenity"="police"](around:8000,${r.lat},${r.lng}););out center tags 40;`;
      const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (res.ok) near = ((await res.json()).elements || []).map(e => ({ name: (e.tags || {}).name || (e.tags || {})['name:en'] || '', phone: ((e.tags || {}).phone || (e.tags || {})['contact:phone'] || '').split(';')[0].trim(),
        d: kmTo(r.lat, r.lng, e.lat ?? e.center?.lat, e.lon ?? e.center?.lon) })).filter(x => x.name && isFinite(x.d)).sort((a, b) => a.d - b.d);
    } catch (_) {}
    const law = near.filter(x => !/traffic/i.test(x.name)).slice(0, 2), tr = near.find(x => /traffic/i.test(x.name));
    let first = null;
    for (const x of [...law, ...(tr ? [tr] : [])]) {
      const k = sq(x.name), m = k.length > 3 && (ours.find(o => sq(o.area || o.post) === k && /traffic/i.test(o.post) === /traffic/i.test(x.name)) || ours.find(o => { const ko = sq(o.area || o.post); return ko.length > 3 && (ko.startsWith(k) || k.startsWith(ko)); }));
      if (m && !first && !/traffic/i.test(m.post)) first = m;
      out.police.push({ name: m ? (m.name || '') : x.name, post: m ? m.post : 'Police station', phone: (m && m.phone) || x.phone || '', why: `${/traffic/i.test(x.name) ? 'traffic, ' : ''}${x.d.toFixed(1)} km away` });
    }
    let up = first && byId.get(first.parent_id), n = 0;
    while (up && n++ < 4) { out.police.push(person(up, 'above the station')); up = byId.get(up.parent_id); }
    if (!out.police.length) out.police.push({ name: '', post: 'Police emergency', phone: '112', why: 'nearest stations could not be found right now' });
  }
  // local body: ward councillor (the reporter's ward, else the ward map at the pin), then the offices on file for this spot
  const wk = window.wardOf ? wardOf(r) : r.ward, c = wk && window.councillorFor ? councillorFor(wk) : null;
  if (c) out.local.push({ name: (window.cleanName ? cleanName(c.name) : c.name), post: `Ward ${c.ward} councillor${c.party ? ', ' + c.party : ''}`, phone: c.phone || '', why: r.ward ? 'ward of this bug' : 'ward from the ward map' });
  try {
    const rows = window.officesFor ? await officesFor(r) : [];
    rows.filter(e => e.department === 'TNPDCL').slice(0, 3).forEach(e => out.power.push({ name: e.name, post: e.department, phone: e.phone || '', why: e.status === 'verified' ? 'checked' : 'not checked yet' }));
    rows.filter(e => e.department !== 'TNPDCL').slice(0, 4).forEach(e => out.local.push({ name: e.name, post: e.department || '', phone: e.phone || '', why: e.status === 'verified' ? 'checked' : 'not checked yet' }));
  } catch (_) {}
  out.power.push({ name: 'Minnagam', post: 'TNPDCL 24-hour helpline', phone: '9498794987', why: 'any power problem' });
  // MLA of the constituency
  const ac = typeof acAt === 'function' && r.lat ? acAt(r.lat, r.lng) : null, a = ac && DIR.byAc && DIR.byAc.get(ac);
  if (a && a.status !== 'vacant') out.mla.push({ name: a.mla_name, post: `MLA, ${a.name}`, phone: a.phone || '', why: 'elected representative' });
  return (STEPS.who[r.id] = out);
}
function whoFor(step, w) {
  if (!w || !step) return [];
  const t = `${step.title} ${step.detail || ''}`.toLowerCase();
  if (/^check the report|confirm it is fixed/.test(t)) return [];
  const pick = [];
  if (/tnpdcl|minnagam|electric|\beb\b|power|wire|transformer|pole/.test(t)) pick.push(...w.power);
  const stations = w.police.filter(p => /km away|112/.test(p.why)), chain = w.police.filter(p => !stations.includes(p));
  if (/inspector, then|assistant commissioner|\bacp\b|\bdcp\b|commissioner of police|escalat/.test(t)) pick.push(...stations.filter(p => /^inspector/i.test(p.post)).slice(0, 1), ...chain);
  else if (/police|patrol|inspector|112/.test(t)) pick.push(...stations.slice(0, 3));
  if (/streetlight|lighting|local body|corporation|municipal|panchayat|councillor|garbage|drain|road|pothole|ward/.test(t)) pick.push(...(w.local.length ? w.local : w.mla));
  if (/\bmla\b|representative|escalat/.test(t)) pick.push(...w.mla);
  const seen = new Set();
  return pick.filter(p => p && !seen.has(p.post + p.name) && seen.add(p.post + p.name)).slice(0, 6);
}
function whoHtml(list) {
  if (!list.length) return '';
  return `<div class="st-who"><div class="st-who-h">Who to contact here</div>${list.map(p => `<div class="st-who-r"><div><b>${esc(p.name || p.post)}</b>${p.name ? `<span>${esc(p.post)}</span>` : ''}<span class="muted">${esc(p.why || '')}</span></div>
    ${p.phone ? `<a class="pr-btn call" href="tel:${esc(String(p.phone).replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>` : '<span class="muted small">no number on file</span>'}</div>`).join('')}</div>`;
}

/* render the list into box. opt.admin = team view. Refreshes itself every 20 s while it is on screen. */
async function renderSteps(box, r, opt = {}) {
  if (!box) return;
  const admin = !!opt.admin;
  let steps;
  try { steps = await loadSteps(r, true); } catch (e) { box.innerHTML = `<div class="steps"><div class="plan-h">What we'll do next</div><p class="muted small">${esc(e.message || e)}</p></div>`; return; }
  const [urls, who] = await Promise.all([stepMediaUrls(steps), contactsFor(r).catch(() => null)]);
  const done = steps.filter(s => s.status === 'done' || s.status === 'skipped').length, waiting = steps.filter(s => s.status === 'review').length, nextI = steps.findIndex(s => s.status === 'todo');
  box.innerHTML = `<div class="steps">
    <div class="plan-h">What we'll do next <span class="muted small">${done} of ${steps.length} done${waiting ? ` · ${waiting} waiting for review` : ''}</span></div>
    <div class="st-bar"><i style="width:${steps.length ? Math.round(done / steps.length * 100) : 0}%"></i></div>
    <p class="muted small">${admin ? 'The reporter sees this list and can do steps too.' : 'You can see everything done so far. You can do a step yourself: tap it, say what you did, and add a photo, voice note or video. The team reviews each step before it counts.'}</p>
    <ol class="st-list">${steps.map((s, i) => {
      const can = s.status === 'todo' && (s.who === 'anyone' || admin), mine = s.done_by === (me && me.id);
      const by = s.done_role === 'team' ? (mine ? 'You (team)' : 'The team') : mine ? 'You' : 'The reporter';
      return `<li class="st ${s.status}${i === nextI ? ' next' : ''}" data-id="${s.id}">
        <span class="st-dot">${s.status === 'done' ? '&#10003;' : s.status === 'skipped' ? '&ndash;' : s.status === 'review' ? '&hellip;' : i + 1}</span>
        <div class="st-b">
          <div class="st-t">${esc(s.title)}${s.who === 'team' ? ' <span class="tag">Team</span>' : ''}${i === nextI ? ' <span class="tag need">Next</span>' : ''}</div>
          ${s.detail ? `<div class="st-d">${esc(s.detail)}</div>` : ''}
          ${s.status === 'todo' ? whoHtml(whoFor(s, who)) : ''}
          ${s.status !== 'todo' ? `<div class="st-done">${s.status === 'skipped' ? 'Skipped' : s.status === 'review' ? 'Done, waiting for review' : 'Done'} · ${by} · ${stepWhen(s.done_at)}</div>${s.note ? `<div class="st-note">${esc(s.note)}</div>` : ''}
            ${(s.media || []).length ? `<div class="st-media">${s.media.map(m => mediaHtml(m, urls[m.path])).join('')}</div>` : ''}` : ''}
          <div class="st-act">${can ? `<button class="linkbtn" data-do="${s.id}">${admin ? 'Mark done' : 'I did this'}</button>` : ''}
            ${admin && s.status === 'review' ? `<button class="linkbtn" data-ok="${s.id}">Confirm done</button>` : ''}
            ${admin && s.status === 'todo' ? `<button class="linkbtn muted" data-skip="${s.id}">Skip</button>` : ''}
            ${admin && s.status !== 'todo' ? `<button class="linkbtn muted" data-reopen="${s.id}">Reopen</button>` : ''}</div>
          <div class="st-form" id="stf-${s.id}" hidden></div>
        </div></li>`; }).join('')}</ol>
    ${admin ? `<details class="st-add"><summary>Add a step</summary>
      <input id="stNewT" maxlength="200" placeholder="What needs doing, e.g. Call the zone 2 engineer">
      <input id="stNewD" maxlength="600" placeholder="Details (optional)">
      <label class="chk"><input type="checkbox" id="stNewTeam"> Team only</label>
      <button class="cta static" id="stNewSave">Add step</button></details>` : ''}
  </div>`;
  box.querySelectorAll('[data-do]').forEach(b => b.onclick = () => stepForm(box, r, opt, steps.find(s => s.id === +b.dataset.do)));
  box.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => { await stepSave(+b.dataset.ok, 'done', '', []); toast('Confirmed'); renderSteps(box, r, opt); });
  box.querySelectorAll('[data-skip]').forEach(b => b.onclick = async () => { const why = prompt('Why skip this step?'); if (!why) return; await stepSave(+b.dataset.skip, 'skipped', why, []); renderSteps(box, r, opt); });
  box.querySelectorAll('[data-reopen]').forEach(b => b.onclick = async () => { if (!confirm('Reopen this step? Its note and attachments are cleared.')) return; await stepSave(+b.dataset.reopen, 'todo', '', []); renderSteps(box, r, opt); });
  const ns = $('#stNewSave'); if (ns) ns.onclick = async () => {
    const t = $('#stNewT').value.trim(); if (!t) return toast('Say what needs doing');
    const nextOrd = steps.length ? Math.max(...steps.map(s => s.ord)) + 1 : 1;
    // keep "Confirm it is fixed" last
    const last = steps[steps.length - 1], before = last && /confirm it is fixed/i.test(last.title) && last.status === 'todo';
    if (before) await sb.from('bug_steps').update({ ord: nextOrd }).eq('id', last.id);
    const { error } = await sb.from('bug_steps').insert({ report_id: r.id, ord: before ? last.ord : nextOrd, who: $('#stNewTeam').checked ? 'team' : 'anyone', title: t, detail: $('#stNewD').value.trim() || null });
    if (error) return toast(error.message);
    toast('Step added'); renderSteps(box, r, opt);
  };
  // live: refresh while this list is on screen and no form is open
  clearInterval(STEPS.timer);
  STEPS.timer = setInterval(() => {
    if (!document.body.contains(box)) return clearInterval(STEPS.timer);
    if (document.hidden || box.querySelector('.st-form:not([hidden])')) return;
    renderSteps(box, r, opt);
  }, 20000);
}
window.renderSteps = renderSteps;

async function stepSave(id, status, note, media) {
  const { error } = await sb.rpc('step_update', { p_id: id, p_status: status, p_note: note, p_media: media });
  if (error) { toast(error.message); throw error; }
}

/* the "I did this" form: note plus photos, a voice note or a video */
function stepForm(box, r, opt, s) {
  const f = $('#stf-' + s.id); if (!f) return;
  box.querySelectorAll('.st-form').forEach(x => { if (x !== f) { x.hidden = true; x.innerHTML = ''; } });
  const files = []; // { kind, blob, ext, type, url }
  f.hidden = false;
  f.innerHTML = `<textarea id="stNote" rows="3" maxlength="2000" placeholder="What did you do? e.g. Called 94987 94987, complaint number 12345, they said a crew will come tomorrow"></textarea>
    <div class="st-att">
      <label class="st-btn">Photo<input type="file" accept="image/*" capture="environment" hidden id="stPh"></label>
      <button type="button" class="st-btn" id="stVoice">Voice note</button>
      <label class="st-btn">Video<input type="file" accept="video/*" capture="environment" hidden id="stVid"></label>
    </div>
    <div class="st-files" id="stFiles"></div>
    <div class="st-reach" id="stReach" hidden><label for="stOff" class="small">Did you reach an office? (counts as a check on its contact)</label>
      <select id="stOff"><option value="">No office reached</option></select>
      <select id="stHow" hidden><option value="called">I called them</option><option value="visited">I visited them</option></select></div>
    <div class="err" id="stErr"></div>
    <div class="row"><button class="cta static ghost" id="stCancel" style="margin-top:0">Cancel</button><button class="cta static" id="stSave" style="margin-top:0">Save step</button></div>`;
  const draw = () => { $('#stFiles').innerHTML = files.map((x, i) => `<span class="st-file">${x.kind === 'image' ? `<img src="${x.url}" alt="">` : x.kind === 'audio' ? 'Voice note' : 'Video'}<button data-rm="${i}" aria-label="Remove">&times;</button></span>`).join('');
    $('#stFiles').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { files.splice(+b.dataset.rm, 1); draw(); }); };
  const full = () => { if (files.length >= 6) { toast('Up to 6 attachments per step'); return true; } return false; };
  $('#stPh').onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (!file || full()) return;
    try { const d = await shrink(file); files.push({ kind: 'image', blob: dataUrlToBlob(d), ext: 'jpg', type: 'image/jpeg', url: d }); draw(); } catch (err) { toast(err.message); } };
  $('#stVid').onchange = e => { const file = e.target.files[0]; e.target.value = ''; if (!file || full()) return;
    if (file.size > 30 * 1024 * 1024) return toast('That video is too big. Keep it under a minute.');
    const type = file.type || 'video/mp4', ext = (type.split('/')[1] || 'mp4').replace('quicktime', 'mov');
    files.push({ kind: 'video', blob: file, ext, type, url: URL.createObjectURL(file) }); draw(); };
  $('#stVoice').onclick = () => voiceNote(blob => { if (full()) return; const type = blob.type || 'audio/webm';
    files.push({ kind: 'audio', blob, ext: type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm', type: type.split(';')[0], url: URL.createObjectURL(blob) }); draw(); });
  // Offices for this spot (Verify directory). Reaching one through this bug counts as a "correct" check on that entry.
  if (window.officesFor) officesFor(r).then(rows => {
    if (!rows.length || !$('#stOff')) return;
    $('#stOff').insertAdjacentHTML('beforeend', rows.slice(0, 30).map(e => `<option value="${esc(e.id)}">${esc(e.name)}${e.phone ? ' · ' + esc(e.phone) : ''}</option>`).join(''));
    $('#stReach').hidden = false;
    $('#stOff').onchange = () => { $('#stHow').hidden = !$('#stOff').value; };
  }).catch(() => {});
  $('#stCancel').onclick = () => { f.hidden = true; f.innerHTML = ''; };
  $('#stSave').onclick = async () => {
    const note = $('#stNote').value.trim();
    if (!note) { $('#stErr').textContent = 'Say what was done, even one line.'; return; }
    if (typeof HAS_LINK !== 'undefined' && HAS_LINK.test(note)) { $('#stErr').textContent = 'Links are not allowed. Describe it in words.'; return; }
    $('#stSave').disabled = true; $('#stSave').textContent = files.length ? 'Uploading...' : 'Saving...';
    try {
      const media = [];
      for (let i = 0; i < files.length; i++) {
        const x = files[i], path = `${r.id}/${me.id}-${Date.now()}-${i}.${x.ext}`;
        const { error } = await sb.storage.from('steps').upload(path, x.blob, { contentType: x.type, upsert: false });
        if (error) throw error;
        media.push({ path, kind: x.kind });
      }
      await stepSave(s.id, 'done', note, media);
      const off = $('#stOff') && $('#stOff').value;
      if (off) { const { error: ce } = await sb.from('entry_checks').insert({ entry_id: off, verdict: 'correct', method: $('#stHow').value || 'called',
        note: `Reached while working bug ${r.id}: ${note}`.slice(0, 500) });
        if (ce) toast('Step saved, but the office check failed: ' + ce.message, 4500); }
      toast(opt.admin ? 'Step saved.' : 'Thank you. The team will review it.'); renderSteps(box, r, opt);
    } catch (e) { $('#stErr').textContent = (e && e.message) || 'Could not save. Try again when you have signal.'; $('#stSave').disabled = false; $('#stSave').textContent = 'Save step'; }
  };
  setTimeout(() => $('#stNote').focus(), 50);
}

/* record a voice note in the app; falls back to the phone's recorder if the app cannot use the microphone */
async function voiceNote(done) {
  const fallback = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'audio/*'; i.setAttribute('capture', '');
    i.onchange = () => { const f = i.files[0]; if (f) { if (f.size > 15 * 1024 * 1024) return toast('That recording is too long'); done(f); } }; i.click(); };
  if (!navigator.mediaDevices || !window.MediaRecorder) return fallback();
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (_) { return fallback(); }
  const rec = new MediaRecorder(stream), parts = []; let t0 = Date.now(), tick;
  rec.ondataavailable = e => e.data.size && parts.push(e.data);
  rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); clearInterval(tick); $('#modal').classList.remove('on'); $('#mOk').style.display = ''; $('#mOk').textContent = 'OK'; $('#mCancel').textContent = 'Cancel';
    if (rec._keep && parts.length) done(new Blob(parts, { type: rec.mimeType || 'audio/webm' })); };
  $('#mTitle').textContent = 'Recording voice note';
  $('#mBody').innerHTML = '<div class="rec"><span class="rec-dot"></span><b id="recT">0:00</b></div><p class="muted small">Up to 2 minutes. Tap Stop when you are done.</p>';
  $('#mOk').style.display = ''; $('#mOk').textContent = 'Stop and keep'; $('#mCancel').textContent = 'Discard';
  $('#mOk').onclick = () => { rec._keep = true; rec.stop(); };
  $('#mCancel').onclick = () => { rec._keep = false; rec.stop(); };
  $('#modal').classList.add('on');
  rec.start();
  tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); const el = $('#recT'); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (s >= 120) { rec._keep = true; rec.stop(); } }, 500);
}
