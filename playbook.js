/* Agent v0: rules-based plan for each bug (no AI yet). Same output shape the AI will fill later.
 * Every phone number here is marked with how it was checked. Unchecked ones say so on screen. */
const MINNAGAM = { name: 'TNPDCL Minnagam (24x7, calls and WhatsApp)', tel: '9498794987', shown: '94987 94987', checked: 'TN Energy Dept policy note 2024-25' };

function localBody(r) {
  // Which civic body owns streets here. Uses the ward maps (Chennai Corporation and Tambaram Corporation for now).
  const w = typeof wardAt === 'function' ? wardAt(r.lat, r.lng) : null;
  if (w && w.corp === 'TCMC') return { kind: 'tcmc', zone: w.zn, ward: w.w, name: `Tambaram Corporation, Zone ${w.zn}, Ward ${w.w}`,
    channel: `the Tambaram Corporation Zone ${w.zn} office (ask for the zone engineer, or the sanitary officer for garbage)`, checked: false };
  if (w) return { kind: 'gcc', name: `Greater Chennai Corporation, ${localLine(w)}`, channel: 'Namma Chennai app or 1913 helpline', checked: false };
  return { kind: 'other', name: 'Local body for this spot (corporation, municipality or panchayat)', channel: 'The local body office. Ward maps for this area are not loaded yet', checked: false };
}

function planFor(r) {
  const lb = localBody(r);
  const ac = typeof acAt === 'function' ? acAt(r.lat, r.lng) : null, a = ac && typeof DIR !== 'undefined' && DIR.byAc ? DIR.byAc.get(ac) : null;
  const mla = a && a.status !== 'vacant' ? `${a.mla_name} (${a.party}), MLA for ${a.name}` : null;
  const P = {
    wires: {
      priority: 'urgent', next: 'call', owner: 'TNPDCL (electricity distribution)', deadline: 2,
      steps: [
        `Call ${MINNAGAM.name} on ${MINNAGAM.shown}. Say: bare line sagging to first-floor level, give the location and the nearest pole number, ask for the complaint number.`,
        'Log the complaint number here. Follow up after 2 days.',
        'No visit in 2 days: call the local TNPDCL section office and ask for the Assistant Engineer (O&M) for this area.',
        'Still nothing: write to the Executive Engineer (O&M) of the division, quoting the complaint number.',
        'Then the Consumer Grievance Redressal Forum (CGRF) of the circle.'],
      ask: 'Inspect the line and re-tension it, raise it, or replace it with insulated aerial bunched cable.',
      questions: ['Which section office and Assistant Engineer cover this street?', 'When will the line crew visit?', 'Will they re-tension the line or replace it with covered cable?', 'Can I have the complaint number and the expected date?'],
      tel: MINNAGAM },
    power: { priority: 'high', next: 'call', owner: 'TNPDCL', deadline: 1, tel: MINNAGAM,
      steps: [`Call ${MINNAGAM.shown} and get a complaint number.`, 'Follow up next day.', 'Then the section office Assistant Engineer, then the Executive Engineer.'],
      ask: 'Restore supply or fix the fault.', questions: ['Is it a known outage or only this street?', 'Expected restoration time?', 'Complaint number?'] },
    light: { priority: 'normal', next: 'portal', owner: lb.name, deadline: 7,
      steps: [`File with ${lb.channel}.`, 'Follow up after 7 days.', 'Then the zone or ward engineer, then tag the office on X.'],
      ask: 'Repair or replace the streetlight.', questions: ['Who maintains streetlights on this street?', 'Expected repair date?'] },
    road: { priority: 'normal', next: 'portal', owner: `${lb.name}. Check first: NH = NHAI, SH = Highways`, deadline: 15,
      steps: [`Confirm who owns the road. Then file with ${lb.channel}.`, 'Follow up after 15 days.', 'Then the zone engineer, then the ward councillor and an X post tagging the office.'],
      ask: 'Patch or relay the road.', questions: ['Who owns this road?', 'Is relaying already planned?'] },
    garbage: { priority: 'normal', next: 'portal', owner: lb.name, deadline: 2,
      steps: [`File with ${lb.channel}.`, 'Follow up after 2 days.', 'Then the zone sanitary officer.'], ask: 'Clear the garbage and fix the pickup schedule.', questions: ['When is pickup scheduled here?'] },
    drain: { priority: 'high', next: 'portal', owner: lb.name, deadline: 3,
      steps: [`File with ${lb.channel}.`, 'Follow up after 3 days.', 'Then the zone engineer.'], ask: 'Clear or cover the drain.', questions: ['Is this a storm drain or sewer line?'] },
    water: { priority: 'high', next: 'portal', owner: lb.kind === 'gcc' ? 'Chennai Metrowater (1916)' : lb.name, deadline: 3,
      steps: [lb.kind === 'gcc' ? 'Call Metrowater 1916 or use their complaint site.' : `File with ${lb.channel}.`, 'Follow up after 3 days.', 'Then the area engineer.'], ask: 'Fix the leak.', questions: ['Which depot covers this street?'] },
    women: { priority: 'urgent', next: 'call', owner: 'Local police station, plus the local body for lighting', deadline: 2,
      steps: ['If anyone is in danger now: 112.', 'Call the nearest police station (see the area panel) and ask for patrolling at this spot.', 'If lighting is the cause, file a streetlight complaint too.', 'Then the Inspector, then the Assistant Commissioner of the area.'],
      ask: 'Patrolling and lighting at this spot.', questions: ['Can a patrol cover this stretch in the evenings?', 'Who is the beat officer?'] },
  };
  const p = P[r.category] || { priority: 'normal', next: 'portal', owner: lb.name, deadline: 7, steps: ['Work out the responsible office.', 'File and keep the reference number.'], ask: 'Fix the problem.', questions: [] };
  return { ...p, mla, lb, place: a ? `${a.name}, ${a.district} district` : 'this location', where: a ? `${a.name} constituency, ${a.district} district` : 'Constituency not found for this point' };
}

function planHtml(r) {
  const p = planFor(r);
  const pri = { urgent: 'Urgent', high: 'High', normal: 'Normal' }[p.priority], nxt = { call: 'Phone call', portal: 'Portal', public_post: 'Public post' }[p.next];
  return `<div class="plan">
    <div class="plan-h">Suggested plan <span class="muted small">(rules, AI not switched on yet)</span></div>
    <div class="plan-row"><b>Who fixes it</b><span>${esc(p.owner)}</span></div>
    <div class="plan-row"><b>Where</b><span>${esc(p.where)}${p.mla ? ` · ${esc(p.mla)}` : ''}</span></div>
    <div class="plan-row"><b>Suggest</b><span>${pri} · ${nxt} · follow up in ${p.deadline} day${p.deadline > 1 ? 's' : ''}</span></div>
    <ol>${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    <div id="planDir"></div>
    ${p.tel ? `<p class="muted small">${esc(p.tel.shown)} checked against: ${esc(p.tel.checked)}. Other contacts above are not checked yet.</p>` : '<p class="muted small">Contacts above are not checked yet.</p>'}
    <div class="row"><button class="cta static ghost" id="planApply" style="margin-top:0">Use: ${pri} + ${nxt}</button>${p.next === 'call' ? '<button class="cta static" id="planBrief" style="margin-top:0">Call brief</button>' : ''}</div>
  </div>`;
}

// Offices from the Verify directory for this spot: same constituency, else same district, plus statewide.
// Tambaram Corporation rows are tied to the ward map: only for spots inside the corporation, and zone officers only for
// the zone the spot is in, with the officer for this kind of bug first (sanitary officer for garbage, engineer otherwise).
async function officesFor(r) {
  try { if (window.loadLocal) await loadLocal(); } catch (_) {}
  const ac = typeof acAt === 'function' ? acAt(r.lat, r.lng) : null;
  const a = ac && typeof DIR !== 'undefined' && DIR.byAc ? DIR.byAc.get(ac) : null;
  const power = ['wires', 'power'].includes(r.category);
  const mapOn = typeof LOCAL !== 'undefined' && !!LOCAL.tcmc, lw = mapOn && r.lat != null ? wardAt(r.lat, r.lng) : null, tz = lw && lw.corp === 'TCMC' ? lw.zn : null;
  const isTcmc = e => /tambaram (city municipal )?corporation/i.test(e.department || ''), zoneOf = e => { const m = /Tambaram Corporation Zone (\d)/i.exec(e.area || ''); return m ? +m[1] : null; };
  const want = r.category === 'garbage' ? /sanitary|health/i : /engineer/i;
  const { data } = await sb.from('directory_entries').select('id,name,department,phone,email,status,source_url,details,ac_no,district,area')
    .neq('status', 'retired').limit(300);
  const rows = (data || []).filter(e => (power ? e.department === 'TNPDCL' : e.department !== 'TNPDCL') &&
    ((ac && e.ac_no === ac) || (e.ac_no == null && a && e.district === a.district) || (e.ac_no == null && !e.district)) &&
    (!mapOn || !isTcmc(e) || (tz != null && (zoneOf(e) == null || zoneOf(e) === tz))));
  const rank = e => (tz != null && zoneOf(e) === tz ? (want.test(e.name) ? -2 : -1) : ac && e.ac_no === ac ? 0 : e.district ? 1 : 2);
  return rows.sort((x, y) => rank(x) - rank(y));
}
async function planOffices(r) {
  const box = $('#planDir'); if (!box) return;
  const rows = await officesFor(r);
  if (!rows.length) { box.innerHTML = '<p class="muted small">No offices in the directory for this spot yet. Add them in Verify.</p>'; return; }
  box.innerHTML = `<div class="plan-h" style="font-size:14px;margin-top:8px">Offices for this spot</div>` + rows.slice(0, 8).map(e => `
    <div class="pol-row"><div class="pr-t"><b>${esc(e.name)}</b><span>${esc(e.details || e.department || '')}</span>
      <span>${e.status === 'verified' ? 'Verified' : 'Not checked yet'}${e.source_url ? ` · <a href="${esc(e.source_url)}" target="_blank" rel="noopener">source</a>` : ''}</span></div>
      ${e.phone ? `<a class="pr-btn call" href="tel:${esc(e.phone.replace(/[^\d+]/g, ''))}">Call</a>` : ''}</div>`).join('');
}

function bindPlan(r) {
  planOffices(r);
  const p = planFor(r);
  const ap = $('#planApply'); if (ap) ap.onclick = () => move(r, { priority: p.priority, next_action: p.next }, 'Plan applied');
  const bb = $('#planBrief'); if (bb) bb.onclick = () => callBrief(r, p);
}

function callBrief(r, p) {
  const days = Math.max(0, Math.round((Date.now() - new Date(r.received_at)) / 864e5));
  const c = catOf(r.category);
  const script = [
    `Hello, I'm Samuel. I'm calling to report a problem near ${p.place}: ${c.name.toLowerCase()}.`,
    `${r.note ? 'Details: ' + r.note + '.' : ''} ${r.since === 'longer' ? 'It has been like this for over a month.' : ''}`.trim(),
    `What I'm asking: ${p.ask}`,
    r.complaint_ref ? `My complaint number is ${r.complaint_ref}, filed ${days} days ago.` : 'Can you register this and give me a complaint number?',
    'Thank you. Can I note your name for my records?'].filter(Boolean);
  $('#mTitle').textContent = 'Call brief';
  $('#mBody').innerHTML = `
    <p><b>Call:</b> ${p.tel ? `<a href="tel:${p.tel.tel}">${esc(p.tel.name)}, ${esc(p.tel.shown)}</a>` : esc(p.owner)}</p>
    <p><b>Bug:</b> ${esc(r.id)} · ${esc(c.name)} · reported ${days} day${days === 1 ? '' : 's'} ago${r.complaint_ref ? ` · complaint ${esc(r.complaint_ref)}` : ''}</p>
    <p><b>Location:</b> ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)} · ${esc(p.where)}. Have the pole number or a landmark ready.</p>
    <h4>Say</h4><ol>${script.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    <h4>Ask</h4><ul>${p.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>
    <h4>After the call</h4><p class="muted small">Tap "Complaint raised" (after Approve) to save the complaint number and follow-up date. Put the officer's name and promise in Admin note.</p>`;
  $('#mOk').textContent = 'Copy script'; $('#mCancel').textContent = 'Close';
  $('#mOk').onclick = async () => { try { await navigator.clipboard.writeText(script.join('\n')); toast('Script copied'); } catch (_) {} };
  $('#mCancel').onclick = () => { $('#modal').classList.remove('on'); $('#mCancel').textContent = 'Cancel'; };
  $('#modal').classList.add('on');
}

/* ---------- AI report (Gemini via the ai-report server function) ---------- */
function aiHtml(r) {
  const a = r.ai && r.ai.summary ? r.ai : null;
  if (!a) return `<div class="plan ai"><div class="plan-h">AI report</div>
    <p class="muted small">Gemini reads the photos and writes the complaint, severity and plan. Only photos, category, note and place names are sent.</p>
    <button class="cta static" id="aiRun" style="margin-top:4px">Run AI report</button></div>`;
  const pri = { urgent: 'Urgent', high: 'High', normal: 'Normal' }[a.severity] || a.severity;
  const nxt = { call: 'Phone call', portal: 'Portal', public_post: 'Public post' }[a.next_action] || a.next_action;
  const li = xs => (xs || []).map(x => `<li>${esc(x)}</li>`).join('');
  return `<div class="plan ai"><div class="plan-h">AI report <span class="muted small">(${esc(a.model || 'Gemini')}, ${esc(a.confidence || '')} confidence)</span></div>
    <p>${esc(a.summary)}</p>
    ${a.category_matches_report === false ? `<p class="note">AI thinks the category should be: <b>${esc(catOf(a.category).name)}</b></p>` : ''}
    <div class="plan-row"><b>Severity</b><span>${pri}. ${esc(a.severity_reason || '')}</span></div>
    <div class="plan-row"><b>Who fixes it</b><span>${esc(a.owner || '')}</span></div>
    <div class="plan-row"><b>Next</b><span>${nxt} · follow up in ${esc(String(a.follow_up_days || '-'))} days</span></div>
    ${a.hazards && a.hazards.length ? `<div class="plan-row"><b>Hazards</b><span>${a.hazards.map(esc).join(', ')}</span></div>` : ''}
    <ol>${li(a.steps)}</ol>
    ${a.details_to_collect && a.details_to_collect.length ? `<p class="small"><b>Collect before filing:</b> ${a.details_to_collect.map(esc).join(', ')}</p>` : ''}
    <details><summary><b>Complaint text (English)</b></summary><p class="small" id="aiEn">${esc(a.complaint_en || '')}</p></details>
    <details><summary><b>Complaint text (Tamil)</b></summary><p class="small" id="aiTa">${esc(a.complaint_ta || '')}</p></details>
    ${a.call_questions && a.call_questions.length ? `<details><summary><b>Questions for the call</b></summary><ul class="small">${li(a.call_questions)}</ul></details>` : ''}
    ${a.privacy && (a.privacy.number_plates_visible || a.privacy.faces_visible) ? `<p class="note">Photos show ${[a.privacy.faces_visible && 'faces', a.privacy.number_plates_visible && 'number plates'].filter(Boolean).join(' and ')}: blur before anything goes public.</p>` : ''}
    <div class="row"><button class="cta static ghost" id="aiApply" style="margin-top:0">Use: ${pri} + ${nxt}</button><button class="cta static ghost" id="aiCopy" style="margin-top:0">Copy complaint</button></div>
    <button class="chip" id="aiRun" style="margin-top:10px">Run again</button></div>`;
}
function bindAi(r) {
  const run = $('#aiRun');
  if (run) run.onclick = async () => {
    run.disabled = true; run.textContent = 'Reading the photos (up to a minute)...'; const old = $('#aiErr'); if (old) old.remove();
    const p = planFor(r);
    const { data, error } = await sb.functions.invoke('ai-report', { body: { id: r.id, context: { place: p.where, rules_plan: { owner: p.owner, priority: p.priority, next: p.next, steps: p.steps } } } });
    if (error) {
      let m = error.message; try { m = (await error.context.json()).error || m; } catch (_) {}
      if (/546|non-2xx|Failed to send/i.test(m)) m = 'The AI server stopped before answering (it took too long). Try again.';
      run.disabled = false; run.textContent = 'Try again';
      let e = $('#aiErr'); if (!e) { e = document.createElement('p'); e.id = 'aiErr'; e.className = 'err'; run.after(e); }
      e.textContent = 'AI report failed: ' + m; return;
    }
    toast('AI report ready'); openReview(r.id);
  };
  const ap = $('#aiApply'); if (ap) ap.onclick = () => move(r, { priority: r.ai.severity, next_action: r.ai.next_action }, 'AI plan applied');
  const cp = $('#aiCopy'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(r.ai.complaint_en + '\n\n' + r.ai.complaint_ta); toast('Complaint copied (English + Tamil)'); } catch (_) {} };
}
