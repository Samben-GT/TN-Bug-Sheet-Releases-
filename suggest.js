/* Admin: suggested changes from the daily AI check. Nothing in the app's data changes until an admin approves, edits or rejects. */
let sugFilter = 'pending';
const SUG_T = { officers: 'Officer', constituencies: 'MLA / seat', ministers: 'Minister', parties: 'Party', directory_entries: 'Contact' };
async function renderSuggestAdmin() {
  const [{ data, error }, st] = await Promise.all([
    sb.from('proposed_changes').select('*').order('created_at', { ascending: false }).limit(300),
    sb.from('proposed_change_stats').select('*')]);
  if (error) throw error;
  const all = data || [], list = all.filter(x => sugFilter === 'all' || (sugFilter === 'pending' ? x.status === 'pending' : x.status !== 'pending'));
  const stats = (st.data || []).filter(s => s.decided > 0);
  $('#adm').innerHTML = `<p class="muted small">Changes the daily check found in news and official sites. Nothing changes in the app until you decide. Your decisions are the record that decides when the AI may act alone: 50 decisions on one kind of change with 95% approved as is. Court cases and criminal matters always need a person.</p>
    <div class="seg" id="sSeg">${[['pending', `To review ${all.filter(x => x.status === 'pending').length}`], ['done', 'Decided'], ['all', 'All']].map(x => `<button data-f="${x[0]}" class="${sugFilter === x[0] ? 'on' : ''}">${x[1]}</button>`).join('')}</div>
    ${stats.length ? `<div class="kv" style="grid-template-columns:1fr auto">${stats.map(s => `<div>${esc(SUG_T[s.target_table] || s.target_table)} · ${esc(s.field)}</div><div>${s.approved_as_is}/${s.decided} as is${s.decided >= 50 && s.pct_as_is >= 95 ? ' · ready' : ''}</div>`).join('')}</div>` : ''}
    ${list.length ? list.map(x => `<div class="item sug">
      <div class="item-top"><div class="t"><div class="small muted">${esc(SUG_T[x.target_table] || x.target_table)} · ${esc(x.field)}${x.confidence ? ' · ' + esc(x.confidence) + ' confidence' : ''}${x.sensitive ? ' · <b style="color:var(--red)">sensitive</b>' : ''}</div>
        <b>${esc(x.target_label || x.target_key)}</b></div><span class="tag ${x.status === 'pending' ? 'pending' : x.status === 'rejected' ? 'rejected' : 'approved'}">${esc(x.status)}</span></div>
      <div class="sug-diff"><div><span class="muted small">Now</span><div>${esc(x.old_value || '(empty)')}</div></div><div><span class="muted small">Suggested</span><div><b>${esc(x.new_value || '(empty)')}</b></div></div></div>
      ${x.evidence_note ? `<div class="small">${esc(x.evidence_note)}</div>` : ''}
      ${x.evidence_url ? `<a class="small" href="${esc(x.evidence_url)}" target="_blank" rel="noopener">Source</a>` : '<div class="small muted">No source link</div>'}
      ${x.status === 'pending' ? `<div class="vacts"><button data-sa="${x.id}" data-v="correct">Approve</button><button data-se="${x.id}">Edit</button><button data-sr="${x.id}">Reject</button></div>`
        : `<div class="small muted">${esc(x.decided_by || '')} · ${x.decided_at ? new Date(x.decided_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}${x.final_value && x.final_value !== x.new_value ? ' · saved as: ' + esc(x.final_value) : ''}${x.decision_note ? ' · ' + esc(x.decision_note) : ''}</div>`}
    </div>`).join('') : `<div class="empty">${sugFilter === 'pending' ? 'Nothing to review. The daily check adds suggestions here once it is scheduled.' : 'Nothing here yet.'}</div>`}`;
  $('#sSeg').querySelectorAll('button').forEach(b => b.onclick = () => { sugFilter = b.dataset.f; renderSuggestAdmin(); });
  const decide = async (id, d, v, note) => { const { error: e } = await sb.rpc('decide_proposed_change', { p_id: id, p_decision: d, p_value: v ?? null, p_note: note ?? null });
    if (e) return toast(e.message); toast(d === 'rejected' ? 'Rejected' : 'Saved to the app'); if (typeof OFF !== 'undefined') OFF = null; loadDirectory(true).catch(() => {}); renderSuggestAdmin(); };
  const byId = id => all.find(x => x.id === id);
  $('#adm').querySelectorAll('[data-sa]').forEach(b => b.onclick = () => { const x = byId(b.dataset.sa);
    if (x.sensitive && !confirm('This one is marked sensitive. Approve it as is?')) return; decide(x.id, 'approved'); });
  $('#adm').querySelectorAll('[data-se]').forEach(b => b.onclick = () => { const x = byId(b.dataset.se);
    const v = prompt('Correct value to save', x.new_value || ''); if (v == null) return; const n = prompt('Why the edit? (optional)', '') || ''; decide(x.id, 'edited', v.trim(), n); });
  $('#adm').querySelectorAll('[data-sr]').forEach(b => b.onclick = () => { const n = prompt('Why reject it? This teaches the check.', ''); if (!n) return toast('A reason is needed'); decide(b.dataset.sr, 'rejected', null, n); });
}
