/* Reels: social media reel drafts (Instagram Reels / YouTube Shorts).
 * Claude writes each draft (reel-draft function): title, on-screen cards in English and Tamil, caption, sources.
 * The reels approver (role "approver", e.g. Sam's mum) and the admin review here: edit any line, Approve or Skip.
 * Video look and posting are not built yet (Sam decides the look first). Approver logins see only this screen. */
'use strict';
const RL = { list: [] };
const RL_STATUS = { draft: 'Waiting for review', approved: 'Approved', skipped: 'Skipped', posted: 'Posted' };

async function openReels() {
  show('scrReels', me && me.role !== 'approver');
  $('#scrReels .back').style.visibility = me && me.role === 'approver' ? 'hidden' : '';
  $('#rlBody').innerHTML = '<div class="empty">Loading reels...</div>';
  try { await renderReels($('#rlBody')); } catch (e) { $('#rlBody').innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; }
}
window.openReels = openReels;

async function renderReels(box) {
  const { data, error } = await sb.from('reels').select('*').order('for_date', { ascending: false }).order('id', { ascending: false }).limit(30);
  if (error) throw error;
  RL.list = data || [];
  const admin = me && me.role === 'admin';
  box.innerHTML = `${admin ? `<div class="rl-new"><button class="cta static" id="rlMake">Make a reel draft</button></div>` : ''}
    <p class="muted small">${admin ? 'Claude writes each draft from our bugs or the news. ' : ''}Read each card, fix any line, then Approve or Skip. Nothing is posted anywhere yet.</p>
    ${RL.list.map(r => `<div class="rl" data-id="${r.id}">
      <div class="rl-h"><b>${esc(r.title)}</b><span class="tag ${r.status === 'draft' ? 'need' : ''}">${RL_STATUS[r.status] || r.status}</span></div>
      <div class="muted small">${fmtD(r.for_date)} · ${r.kind === 'news' ? 'News' : r.kind === 'fixed' ? 'Fixed bug' : 'Bugs'} · ${esc(r.area || '')}${r.approved_at ? ` · ${r.status} ${fmtD(r.approved_at)}` : ''}${r.edits ? ` · edited ${r.edits}x` : ''}</div>
      <ol class="rl-cards">${(r.script.cards || []).map((c, i) => `<li class="rl-c ${c.k}">
        <div class="rl-ck">${c.k === 'intro' ? 'Opening' : c.k === 'outro' ? 'Closing' : `Card ${i}`}${c.photo ? ' · with photo' : ''}</div>
        ${c.photo ? `<img class="rl-ph" loading="lazy" src="${sb.storage.from('reels').getPublicUrl(c.photo).data.publicUrl}" alt="">` : ''}
        <div class="rl-head" data-f="head" data-i="${i}">${esc(c.head || '')}</div>
        <div class="rl-line" data-f="line" data-i="${i}">${esc(c.line || '')}</div>
        <div class="rl-ta" data-f="ta" data-i="${i}">${esc(c.ta || '')}</div>
        ${c.who ? `<div class="muted small">Responsible: ${esc(c.who)}${c.src ? ` · Source: ${esc(c.src)}` : ''}</div>` : ''}
      </li>`).join('')}</ol>
      <div class="rl-cap"><div class="rl-ck">Caption</div><div data-f="caption">${esc(r.caption || '').replace(/\n/g, '<br>')}</div></div>
      ${(r.sources || []).filter(s => s.url).length ? `<div class="muted small">Sources: ${r.sources.filter(s => s.url).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source || 'link')}</a>`).join(', ')}</div>` : ''}
      ${r.approver_note ? `<div class="muted small">Note: ${esc(r.approver_note)}</div>` : ''}
      <div class="rl-act">
        ${r.status === 'draft' ? `<button class="cta static" data-ok="${r.id}">Approve</button><button class="chip" data-edit="${r.id}">Fix a line</button><button class="chip" data-skip="${r.id}">Skip</button>`
          : `<button class="chip" data-edit="${r.id}">Edit</button>${r.status !== 'draft' ? `<button class="chip" data-back2="${r.id}">Back to review</button>` : ''}`}
        <button class="chip" data-copy="${r.id}">Copy caption</button>
        ${admin ? `<button class="link small danger" data-del="${r.id}">Delete</button>` : ''}
      </div>
    </div>`).join('') || '<div class="empty">No reels yet.</div>'}`;

  const find = id => RL.list.find(x => x.id === +id);
  const set = async (id, patch, msg) => { const { error: e } = await sb.from('reels').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id); if (e) return toast(e.message); toast(msg); renderReels(box); };
  box.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => set(+b.dataset.ok, { status: 'approved', approved_by: me.id, approved_at: new Date().toISOString() }, 'Approved'));
  box.querySelectorAll('[data-skip]').forEach(b => b.onclick = async () => { const why = prompt('Why skip this one? (optional)') ; if (why === null) return;
    set(+b.dataset.skip, { status: 'skipped', approved_by: me.id, approved_at: new Date().toISOString(), approver_note: why || null }, 'Skipped'); });
  box.querySelectorAll('[data-back2]').forEach(b => b.onclick = () => set(+b.dataset.back2, { status: 'draft', approved_by: null, approved_at: null }, 'Back to review'));
  box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => { const r = find(b.dataset.copy); navigator.clipboard.writeText(r.caption || '').then(() => toast('Caption copied'), () => toast('Could not copy')); });
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Delete this reel draft?')) return; const { error: e } = await sb.from('reels').delete().eq('id', +b.dataset.del); if (e) return toast(e.message); renderReels(box); });
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editReel(box, find(b.dataset.edit)));
  const mk = $('#rlMake'); if (mk) mk.onclick = () => makeReel(box);
}
const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

// Edit: every card line and the caption become text boxes on one form.
async function editReel(box, r) {
  const cards = r.script.cards || [], fields = [];
  cards.forEach((c, i) => {
    const n = c.k === 'intro' ? 'Opening' : c.k === 'outro' ? 'Closing' : `Card ${i}`;
    fields.push({ key: `h${i}`, label: `${n}: headline`, value: c.head || '' }, { key: `l${i}`, label: `${n}: line`, value: c.line || '' }, { key: `t${i}`, label: `${n}: Tamil`, value: c.ta || '' });
  });
  fields.push({ key: 'title', label: 'Reel title', value: r.title, required: true }, { key: 'caption', label: 'Caption', type: 'area', value: r.caption || '' });
  const v = await form('Fix the reel', fields, 'Save');
  if (!v) return;
  const next = cards.map((c, i) => ({ ...c, head: v[`h${i}`].slice(0, 80), line: v[`l${i}`].slice(0, 160), ta: v[`t${i}`].slice(0, 220) }));
  const { error } = await sb.from('reels').update({ title: v.title.slice(0, 80), caption: v.caption.slice(0, 2000), script: { ...r.script, cards: next }, edits: (r.edits || 0) + 1, updated_at: new Date().toISOString() }).eq('id', r.id);
  if (error) return toast(error.message);
  toast('Saved'); renderReels(box);
}

// Admin: ask Claude for a new draft.
const RL_AREAS = [['Chromepet', 12.9516, 80.1462], ['Tambaram', 12.9249, 80.1000], ['Pallavaram', 12.9675, 80.1491], ['Guduvanchery', 12.8452, 80.0603], ['Kattankulathur', 12.809, 80.031]];
async function makeReel(box) {
  const v = await form('Make a reel draft', [
    { key: 'kind', label: 'What about', type: 'select', options: [['bugs', 'Bugs logged in an area'], ['news', 'Latest news for Tambaram and Pallavaram']], value: 'bugs' },
    { key: 'area', label: 'Area (for bugs)', type: 'select', options: RL_AREAS.map(a => [a[0], a[0]]), value: 'Chromepet' },
    { key: 'km', label: 'Within how many km (for bugs)', type: 'number', value: '3' },
  ], 'Write it');
  if (!v) return;
  const a = RL_AREAS.find(x => x[0] === v.area) || RL_AREAS[0];
  const body = v.kind === 'news' ? { kind: 'news', area: 'Tambaram and Pallavaram', ac_nos: [30, 31] } : { kind: 'bugs', area: a[0], lat: a[1], lng: a[2], km: +v.km || 3 };
  toast('Claude is writing the reel...', 6000);
  const { data, error } = await sb.functions.invoke('reel-draft', { body });
  if (error) return toast('Failed: ' + (error.message || error), 5000);
  if (data && data.ok === false) return toast(data.why || 'Nothing to make a reel from', 6000);
  renderReels(box);
}
