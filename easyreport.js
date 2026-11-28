/* Easy reporting: show us (photo, video or voice note) or tell us (a line of text), any one is enough.
   The app guesses the type from the words, with a one-tap change, and suggests "urgent" with the reason
   (never when the note itself says it is not urgent).
   No AI here: plain word lists in Tamil and English. The team checks every report anyway.
   After sending, the reporter sees who to contact and what happens next. */
const GUESS = [ // first match wins, so the more specific types come first
  ['wires', /(live|naked|bare|loose|hanging|cut|fallen)\s*(wire|cable|line)|\bwire|transformer|\beb\s*(post|pole|box)|electric (pole|post)|spark|shock|மின்\s*கம்பி|கம்பி|டிரான்ஸ்பார்மர்/i],
  ['women', /\bunsafe|harass|eve.?teas|stalk|women|ladies|girls? (safety|unsafe)|no patrol|drunk(ards)?|பெண்|பாதுகாப்பு|கேலி/i],
  ['power', /power\s*(cut|off|fail|outage)|no (power|current|electricity)|current (cut|illa|poyi)|outage|voltage|மின்\s*(தடை|வெட்டு)|கரண்ட்|மின்சாரம்/i],
  ['light', /street\s*light|lamp|light (not|off|illa)|bulb|dark (road|street|stretch)|தெரு\s*விளக்கு|விளக்கு|இருட்டு/i],
  ['drain', /drain|gutter|manhole|canal|storm water|stagnant|water.?logg|flood|கால்வாய்|சாக்கடை|வடிகால்|மழைநீர்/i],
  ['water', /leak|pipe|sewage|overflow|drinking water|no water|metro\s*water|குடிநீர்|கழிவுநீர்|தண்ணீர்|குழாய்/i],
  ['garbage', /garbage|trash|rubbish|waste|dump|litter|bin\b|smell|குப்பை|கழிவு/i],
  ['road', /pot\s*hole|road|crater|speed\s*breaker|footpath|pavement|tar|பள்ளம்|சாலை|ரோடு/i],
];
const URGENT_WORDS = /(live|naked|bare|hanging|fallen)\s*(wire|cable|line)|spark|shock|electrocut|open manhole|manhole (open|without)|flood|knee.?deep|fallen (tree|pole)|accident|fire|smoke|ஆபத்து|விபத்து/i;
// The reporter's own words come first: "no urgency", "not urgent", "no rush", "not dangerous", "it can wait" (Tamil and
// Tanglish too) switch the urgent suggestion off. "No danger sign" is about a missing board, not about the danger.
const NOT_URGENT = new RegExp([
  "\\b(?:no|not|non|isn'?t|is not|without|nothing|zero)[\\s-]*(?:(?:an?|any|much|that|very|really|so|too|real|immediate|big|major|at|all)\\s+){0,2}(?:urgen(?:t|cy)|emergenc(?:y|ies)|rush|hurry|serious|danger(?:ous)?(?!\\s*(?:sign|board|notice|tape|mark))|risky?|threat)\\b",
  "\\bno\\s+need\\s+(?:to|for)\\s+(?:rush|hurry|panic|worry)\\b",
  "\\b(?:it|this|that|issue|fix|repair|work)\\s+can\\s+wait\\b", "\\blow\\s+priority\\b",
  "அவசரம்\\s*(?:(?:ஒன்றும்|எதுவும்|ஏதும்)\\s*)?(?:இல்லை|கிடையாது|தேவையில்லை|தேவை\\s*இல்லை)", "அவசரமில்லை",
  "ஆபத்து\\s*(?:(?:ஒன்றும்|எதுவும்|ஏதும்)\\s*)?(?:இல்லை|கிடையாது)", "ஆபத்தில்லை",
  "\\b(?:urgent|avasaram|abathu|aabathu)\\s+(?:onnum\\s+)?(?:illa|illai|ille|kidaiyathu|kidayathu)\\b",
].join('|'), 'gi');
// Not the reporter's own view: "EB said it is not urgent" quotes someone else, and "no urgent action taken" or
// "no urgency shown by officials" complains that nobody hurried. "I think it is not urgent" is their own view.
const NU_QUOTED = /\b(?:says?|said|saying|told|tells?|claims?|claimed|thinks?|feels?|replied|answered)\b[^.!?\n]{0,25}$/i;
const NU_OWN = /\b(?:i|we)\s+(?:would\s+)?(?:say|said|think|feel|told)\b[^.!?\n]{0,25}$/i;
const NU_ABOUT_OTHERS = /^\s*(?:action|attention|response|repl(?:y|ies)|steps?|measures?|repairs?|work|basis|care|shown|taken|from|by|hours?|for\s+(?:them|him|her|the|eb|tneb|tnpdcl))\b/i;
function saysNotUrgent(t) {
  if (!t) return false;
  NOT_URGENT.lastIndex = 0;
  for (let m; (m = NOT_URGENT.exec(t));) {
    const before = t.slice(0, m.index), after = t.slice(m.index + m[0].length);
    if (!(NU_QUOTED.test(before) && !NU_OWN.test(before)) && !NU_ABOUT_OTHERS.test(after)) return true;
  }
  return false;
}
window.saysNotUrgent = saysNotUrgent;
// near children or patients makes a dangerous type more urgent, but not a broken light or a pothole
const NEAR_WORDS = /child|children|kids|school|hospital|பள்ளி|குழந்தை|மருத்துவமனை/i, DANGER_CATS = ['wires', 'drain', 'women', 'water'];

function guessCat(t) { if (!t || t.length < 4) return null; const g = GUESS.find(([, re]) => re.test(t)); return g ? g[0] : null; }
function urgencyFor(cat, t) {
  if (saysNotUrgent(t)) return null; // the reporter wrote that it is not urgent: do not suggest otherwise
  const m = t && (t.match(URGENT_WORDS) || (DANGER_CATS.includes(cat) && t.match(NEAR_WORDS)));
  if (m) return `"${m[0].toLowerCase()}" in your note`;
  if (cat === 'wires') return 'exposed wires can kill';
  if (cat === 'women') return 'it is about someone\'s safety';
  return null;
}
window.guessCat = guessCat;

function renderGuess() {
  if (!draft) return;
  const t = ($('#inNote').value || '').trim();
  if (!draft.catManual) { const g = guessCat(t); if (g !== draft.cat) { draft.cat = g; renderCats(); } draft.catGuessed = !!draft.cat; }
  const c = draft.cat ? catOf(draft.cat) : null, box = $('#catGuess');
  box.innerHTML = c ? `<span class="cg-ic">${c.svg || c.icon}</span><span><span class="muted small">${draft.catManual ? 'Type' : 'Looks like'}</span><br><b>${esc(c.name)}</b></span><button type="button" class="linkbtn" id="cgChange">Change</button>`
    : `<span class="muted small">${t.length >= 4 ? 'Not sure of the type. That is fine, the team will sort it.' : 'Write a line and we will work out the type.'}</span><button type="button" class="linkbtn" id="cgChange">Choose</button>`;
  $('#cgChange').onclick = () => { $('#catPick').open = true; $('#catPick').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  // urgent: suggested from the type and the words; the reporter can untick it. A note that says it is not urgent
  // switches the suggestion off. urgentBy keeps who ticked the box: the reporter, or the app as a suggestion left on.
  const why = urgencyFor(draft.cat, t);
  if (draft.urgentTouched !== true) $('#inUrgent').checked = !!why;
  draft.urgent = $('#inUrgent').checked; draft.urgentBy = draft.urgent ? (draft.urgentTouched ? 'reporter' : 'app') : null;
  draft.urgentWhy = draft.urgent ? (draft.urgentTouched ? 'Marked urgent by the reporter' : why) : null;
  $('#urgWhy').textContent = draft.urgent && !draft.urgentTouched && why ? `Suggested urgent: ${why}. Untick if it is not.`
    : !draft.urgent && saysNotUrgent(t) ? 'You wrote that it is not urgent, so it is not marked urgent.' : '';
  const n = $('#catNote');
  if (n) { n.hidden = draft.cat !== 'women'; n.innerHTML = 'In danger right now? <a href="tel:112"><b>Call 112</b></a> (or 181 women helpline) first.<br>Use this for unsafe spots: dark stretches, no patrol, harassment hotspots, broken lights near bus stops. Do not name or photograph any person.'; }
}
window.renderGuess = renderGuess;

function renderMedia() {
  const box = $('#mediaList'); if (!box || !draft) return;
  box.innerHTML = (draft.media || []).map((m, i) => `<span class="st-file">${m.kind === 'audio' ? 'Voice note' : 'Video'} <span class="muted small">${Math.max(1, Math.round(m.blob.size / 1024 / 1024 * 10) / 10)} MB</span><button data-rm="${i}" aria-label="Remove">&times;</button></span>`).join('');
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { draft.media.splice(+b.dataset.rm, 1); renderMedia(); });
}
window.renderMedia = renderMedia;

$('#inNote').addEventListener('input', () => { clearTimeout(renderGuess.t); renderGuess.t = setTimeout(renderGuess, 250); });
$('#inUrgent').onchange = () => { draft.urgentTouched = true; renderGuess(); };
$('#inVideo').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (f.size > 30 * 1024 * 1024) return toast('That video is too big. Keep it under a minute.');
  if ((draft.media || []).length >= 3) return toast('Up to 3 voice notes or videos');
  const type = f.type || 'video/mp4'; draft.media.push({ kind: 'video', blob: f, type, ext: (type.split('/')[1] || 'mp4').replace('quicktime', 'mov') }); renderMedia(); $('#formErr').textContent = ''; };
$('#btnVoice').onclick = () => { if ((draft.media || []).length >= 3) return toast('Up to 3 voice notes or videos');
  voiceNote(blob => { const type = (blob.type || 'audio/webm').split(';')[0]; draft.media.push({ kind: 'audio', blob, type, ext: type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('mpeg') ? 'mp3' : 'webm' }); renderMedia(); $('#formErr').textContent = ''; }); };

/* upload the voice notes and videos once the report row exists (the bucket checks the report belongs to you) */
async function uploadReportMedia(r) {
  if (!r.media || !r.media.length || r.mediaUp) return true;
  for (const m of r.media) {
    const { error } = await sb.storage.from('steps').upload(m.path, m.blob, { contentType: m.type, upsert: false });
    if (error && !/exists|duplicate/i.test(error.message || '')) throw error;
  }
  r.mediaUp = true; return true;
}
window.uploadReportMedia = uploadReportMedia;

/* after sending: who to contact now, and what happens next */
async function sentSheet(r) {
  try { await Promise.all([loadDirectory(), loadShapes(), window.loadCouncillors ? loadCouncillors() : null, window.loadLocal ? loadLocal().catch(() => {}) : null]); } catch (_) {}
  const sr = { id: r.id, category: r.cat, lat: r.lat, lng: r.lng, ward: r.ward };
  const p = window.planFor ? planFor(sr) : null, c = catOf(r.cat || 'other');
  const ac = acAt(r.lat, r.lng), a = ac && DIR.byAc.get(ac), wk = window.wardOf ? wardOf(r) : r.ward, coun = wk && window.councillorFor ? councillorFor(wk) : null;
  const contacts = [];
  if (r.cat === 'women') contacts.push({ t: 'Police emergency', s: 'If anyone is in danger now', tel: '112' });
  if (p && p.tel) contacts.push({ t: p.tel.name, s: 'Get a complaint number', tel: p.tel.tel, shown: p.tel.shown });
  if (coun && coun.phone && !['wires', 'power'].includes(r.cat)) contacts.push({ t: `Ward councillor, ${cleanName(coun.name)}`, s: `Ward ${coun.ward}${coun.party ? ' · ' + coun.party : ''} · published by the corporation`, tel: coun.phone });
  if (!contacts.length) contacts.push({ t: 'CM Helpline', s: 'State grievance line', tel: '1100' });
  const tips = { wires: 'Keep people and animals away from the wire. Do not touch it or anything touching it.', women: 'Avoid the stretch after dark if you can, and share your live location when you pass it.',
    drain: 'If the manhole is open, put something visible around it so no one steps in.', water: 'Do not drink tap water if the leak is near a sewer line until it is fixed.', power: 'Switch off big appliances so a surge does not damage them when power returns.' }[r.cat];
  $('#mTitle').textContent = 'Received. Thank you.';
  $('#mBody').innerHTML = `<div class="sent-sum"><span class="cg-ic">${c.svg || c.icon}</span><div><b>${r.cat ? esc(c.name) : 'Type to be sorted by the team'}</b>${r.urgent ? ' <span class="tag rejected">Urgent</span>' : ''}
      <div class="muted small">${a ? `${esc(a.name)}, Constituency ${a.ac_no}` : ''}${coun ? ` · Ward ${coun.ward}` : ''}${p && p.owner ? `<br>Handled by: ${esc(p.owner)}` : ''}</div></div></div>
    <div class="plan-h" style="margin-top:12px">Contact these people</div>
    ${contacts.map(x => `<a class="sent-call" href="tel:${esc(x.tel)}"><span><b>${esc(x.t)}</b><span class="muted small">${esc(x.s)}</span></span><span class="sent-n">${esc(x.shown || x.tel)}</span></a>`).join('')}
    <p class="small" style="margin-top:10px"><b>Next:</b> our team checks your report, usually within 48 hours. Then it is filed with the office. You can follow every step and do steps yourself.</p>
    ${tips ? `<details class="small"><summary>What to do meanwhile</summary><p>${esc(tips)}</p></details>` : ''}`;
  const close = () => { $('#modal').classList.remove('on'); $('#mOk').textContent = 'OK'; $('#mCancel').textContent = 'Cancel'; $('#mOk').style.display = ''; };
  $('#mOk').style.display = ''; $('#mOk').textContent = "What we'll do next"; $('#mCancel').textContent = 'Done';
  $('#mOk').onclick = () => { close(); openOne(r.id); };
  $('#mCancel').onclick = close;
  $('#modal').classList.add('on');
}
window.sentSheet = sentSheet;
