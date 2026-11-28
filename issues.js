/* Report an issue: anyone signed in can send a note, an optional screenshot, where they were in the app,
 * and their activity from the last 5 minutes (screens, buttons, typed text, errors) plus where they are. Never passwords.
 * The admin reviews them in Admin > Issues. */
const ISTAT = { new: 'New', seen: 'Seen', fixed: 'Fixed', wont_fix: "Won't fix" };
const TRAIL_SEND_MS = 5 * 60e3;

function currentScreen() { const s = document.querySelector('.screen.on:not(#scrMap)') || $('#scrMap'); return s ? s.id : ''; }
function openIssue(ctx = {}) {
  const where = { screen: currentScreen(), ...ctx };
  const steps = trailSince(TRAIL_SEND_MS);
  $('#mTitle').textContent = 'Report an issue';
  $('#mBody').innerHTML = `<p class="muted small">Wrong name, wrong number, something broken? Tell us. Sam reviews every report.</p>
    ${ctx.ac_name ? `<p class="small"><b>About:</b> ${esc(ctx.ac_name)}${ctx.mla ? ' · MLA ' + esc(ctx.mla) : ''}</p>` : ''}
    <label for="iBody">What is wrong?</label><textarea id="iBody" rows="5" placeholder="Example: The minister shown here is wrong, the correct one is..."></textarea>
    <label for="iShot">Screenshot (optional)</label><input id="iShot" type="file" accept="image/*">
    <label class="small" style="display:flex;gap:8px;align-items:flex-start;margin-top:12px"><input id="iTrail" type="checkbox" style="width:auto;margin-top:2px" checked>
      <span>Attach what I did in the last 5 minutes (${steps.length} step${steps.length === 1 ? '' : 's'}: screens, buttons, what I typed, any errors) and my location. Never passwords.</span></label>`;
  $('#mOk').textContent = 'Send'; $('#mCancel').textContent = 'Cancel';
  const close = () => $('#modal').classList.remove('on');
  $('#mCancel').onclick = close;
  $('#mOk').onclick = async () => {
    const body = $('#iBody').value.trim(), file = $('#iShot').files[0];
    if (body.length < 3) return toast('Type what is wrong');
    if (!me) return toast('Sign in first');
    $('#mOk').disabled = true; $('#mOk').textContent = 'Sending...';
    try {
      let shot = null;
      if (file) {
        const blob = await (await fetch(await shrink(file))).blob();
        shot = `${me.id}/${Date.now()}.jpg`;
        const up = await sb.storage.from('issues').upload(shot, blob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
      }
      const context = { ...where, version: VERSION, app: window.TNB && TNB.version ? TNB.version() : 'web',
        ua: navigator.userAgent.slice(0, 200), screen_size: `${innerWidth}x${innerHeight}`, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        online: navigator.onLine, location: (typeof here !== 'undefined' && here) ? { lat: +(+here.lat).toFixed(5), lng: +(+here.lng).toFixed(5), acc: here.acc || null } : null, viewing_as: typeof viewAs !== 'undefined' && viewAs ? viewAs.email : null, sent_at: new Date().toISOString() };
      const activity = $('#iTrail').checked ? trailSince(TRAIL_SEND_MS) : null;
      const { error } = await sb.from('app_issues').insert({ body: body.slice(0, 3000), screenshot: shot, context, activity });
      if (error) throw error;
      close(); toast('Sent. Thank you, Sam will look at it.', 3000);
    } catch (err) { toast((err && err.message) || String(err), 4500); }
    finally { $('#mOk').disabled = false; $('#mOk').textContent = 'Send'; }
  };
  $('#modal').classList.add('on');
}
$('#btnIssue').onclick = () => openIssue({ what: 'Settings' });

/* ---------- admin review ---------- */
let issueFilter = 'open';
async function renderIssuesAdmin() {
  const { data, error } = await sb.from('app_issues').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  const all = data || [], list = all.filter(x => issueFilter === 'all' || (issueFilter === 'open' ? ['new', 'seen'].includes(x.status) : ['fixed', 'wont_fix'].includes(x.status)));
  const fmt = t => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  $('#adm').innerHTML = `<div class="seg" id="iSeg">${[['open', `Open ${all.filter(x => ['new', 'seen'].includes(x.status)).length}`], ['closed', 'Closed'], ['all', 'All']].map(x => `<button data-f="${x[0]}" class="${issueFilter === x[0] ? 'on' : ''}">${x[1]}</button>`).join('')}</div>
    ${list.length ? list.map(x => {
      const c = x.context || {}, steps = x.activity || [];
      return `<div class="user"><div class="top"><div><b>${esc(displayId(x.email || ''))}</b> <span class="tag ${x.status === 'new' ? 'pending' : x.status === 'fixed' ? 'resolved' : ''}">${ISTAT[x.status]}</span>
          <div class="muted small">${new Date(x.created_at).toLocaleString('en-IN')} · ${esc(c.what || c.screen || '')}${c.ac_name ? ' · ' + esc(c.ac_name) : ''} · ${esc(c.version || '')} ${esc(c.app || '')}</div></div></div>
        <p style="margin:8px 0;white-space:pre-wrap">${esc(x.body)}</p>
        ${x.screenshot ? `<button class="mini" data-ishot="${esc(x.screenshot)}">Open screenshot</button>` : ''}
        ${steps.length ? `<details style="margin-top:8px"><summary class="small"><b>Last 5 minutes</b> · ${steps.length} steps</summary>
          <div class="small mono" style="margin-top:6px;line-height:1.6">${steps.map(s => `<div${s.k === 'error' ? ' class="danger"' : ''}>${fmt(s.t)} · ${esc(s.k)} · ${esc(s.w)}</div>`).join('')}</div></details>` : '<div class="muted small">No activity attached.</div>'}
        <details style="margin-top:6px"><summary class="small">Device</summary><div class="small muted">${esc(c.ua || '')}<br>${esc(c.screen_size || '')} · ${esc(c.theme || '')} · ${c.online === false ? 'offline' : 'online'}${c.viewing_as ? ' · viewing as ' + esc(c.viewing_as) : ''}</div></details>
        <textarea data-inote="${x.id}" rows="2" placeholder="Your note (what you fixed)" style="margin-top:8px">${esc(x.admin_note || '')}</textarea>
        <div class="vacts">${['seen', 'fixed', 'wont_fix'].map(st => `<button data-iid="${x.id}" data-ist="${st}"${st === 'fixed' ? ' data-v="correct"' : ''}>${ISTAT[st]}</button>`).join('')}</div></div>`;
    }).join('') : '<div class="empty">No issues here.</div>'}`;
  $('#iSeg').querySelectorAll('button').forEach(b => b.onclick = () => { issueFilter = b.dataset.f; renderIssuesAdmin(); });
  $('#adm').querySelectorAll('[data-ishot]').forEach(b => b.onclick = async () => {
    const { data: d, error: e } = await sb.storage.from('issues').createSignedUrl(b.dataset.ishot, 600);
    if (e || !d) return toast(e ? e.message : 'Could not open'); window.open(d.signedUrl, '_blank', 'noopener');
  });
  $('#adm').querySelectorAll('[data-iid]').forEach(b => b.onclick = async () => {
    const note = $(`[data-inote="${b.dataset.iid}"]`).value.trim().slice(0, 1000) || null;
    const { error: e } = await sb.from('app_issues').update({ status: b.dataset.ist, admin_note: note, updated_at: new Date().toISOString() }).eq('id', b.dataset.iid);
    if (e) return toast(e.message); toast('Updated'); renderIssuesAdmin();
  });
}
