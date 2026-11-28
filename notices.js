/* Notices: banners on the home screen for logged-in users.
 * Admin writes them (Admin > Notices) for everyone, reporters, staff, or one home area.
 * The AI triage job also writes admin-only alerts for urgent and women safety bugs; tapping one opens the bug.
 * Who sees what is decided by the database policy on "announcements"; dismissing writes a row to "announcement_seen".
 * New notices arrive live while the app is open (realtime), otherwise on the next open. */
'use strict';
const NOTE = { seen: null, chan: null };

async function renderNotices() {
  const box = $('#notices');
  if (!box || !me) return;
  const [{ data: list }, seen] = await Promise.all([
    sb.from('announcements').select('id,title,body,kind,report_id,created_at').order('created_at', { ascending: false }).limit(20),
    NOTE.seen ? Promise.resolve(NOTE.seen) : sb.from('announcement_seen').select('announcement_id').then(r => (NOTE.seen = new Set((r.data || []).map(x => x.announcement_id)))),
  ]);
  const show = (list || []).filter(n => !seen.has(n.id)).slice(0, 5);
  box.innerHTML = show.map(n => `<div class="notice ${n.kind}" data-id="${n.id}">
      <div class="nt-t">${n.kind === 'alert' ? '<b>Alert</b> · ' : ''}${esc(n.title)}</div>
      ${n.body ? `<div class="nt-b">${esc(n.body)}</div>` : ''}
      <div class="nt-a">${n.report_id && me.role === 'admin' ? `<button data-open="${esc(n.report_id)}">Open bug</button>` : ''}<button data-ok="${n.id}">Got it</button></div>
    </div>`).join('');
  box.querySelectorAll('[data-ok]').forEach(b => b.onclick = async () => {
    const id = +b.dataset.ok; NOTE.seen.add(id); b.closest('.notice').remove();
    await sb.from('announcement_seen').insert({ announcement_id: id });
  });
  box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openReview(b.dataset.open));
  if (!NOTE.chan) NOTE.chan = sb.channel('notices').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, () => renderNotices()).subscribe();
}
window.renderNotices = renderNotices;

// Show notices whenever the home screen renders.
{ const base = renderHome; renderHome = (...a) => { renderNotices().catch(() => {}); return base(...a); }; }

/* ---------- Admin > Notices ---------- */
const AUD = [['all', 'Everyone'], ['reporters', 'Reporters only'], ['staff', 'RMs and admin'], ['admin', 'Admin only']];
async function renderNoticesAdmin() {
  const { data, error } = await sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  const { data: seen } = await sb.rpc('announcement_counts');
  const cnt = new Map((seen || []).map(x => [x.announcement_id, x.seen]));
  $('#adm').innerHTML = `<button class="cta static" id="ntNew">Write a notice</button>
    <p class="muted small">Shows as a banner on the home screen for the people you pick, live if the app is open. AI alerts for urgent and women safety bugs also land here (admin only).</p>
    ${(data || []).map(n => `<div class="log"><div class="muted">${fmt(n.created_at)} · ${esc((AUD.find(a => a[0] === n.audience) || [0, n.audience])[1])}${n.ac_no ? ` · area ${n.ac_no}` : ''} · ${esc(n.created_by)} · seen by ${cnt.get(n.id) || 0}</div>
      <b>${esc(n.title)}</b>${n.body ? `<div>${esc(n.body)}</div>` : ''}<button class="link small" data-del="${n.id}">Remove</button></div>`).join('') || '<div class="empty">No notices yet.</div>'}`;
  $('#ntNew').onclick = async () => {
    const v = await form('Write a notice', [
      { key: 'title', label: 'Headline', required: true, hint: 'e.g. Bug hunt this Saturday, 9 am' },
      { key: 'body', label: 'Details (optional)', type: 'area' },
      { key: 'audience', label: 'Who sees it', type: 'select', options: AUD, value: 'all' },
      { key: 'ac_no', label: 'Only one area? Constituency number (optional)', type: 'number' },
      { key: 'days', label: 'Show for how many days', type: 'number', value: '7' },
    ], 'Send');
    if (!v) return;
    const d = Math.max(1, Math.min(60, +v.days || 7));
    const { error: e } = await sb.from('announcements').insert({ title: v.title.slice(0, 120), body: v.body ? v.body.slice(0, 600) : null, audience: v.audience,
      ac_no: v.ac_no ? +v.ac_no : null, created_by: me.email || 'admin', expires_at: new Date(Date.now() + d * 864e5).toISOString() });
    if (e) return fail(e);
    toast('Notice sent'); renderNoticesAdmin();
  };
  $('#adm').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const { error: e } = await sb.from('announcements').delete().eq('id', +b.dataset.del);
    if (e) return fail(e); renderNoticesAdmin();
  });
}

/* ---------- Admin > AI log ---------- */
async function renderAiLog() {
  const { data, error } = await sb.from('ai_jobs').select('*').order('started_at', { ascending: false }).limit(100);
  if (error) throw error;
  const tin = (data || []).reduce((t, j) => t + (j.tokens_in || 0), 0), tout = (data || []).reduce((t, j) => t + (j.tokens_out || 0), 0);
  const line = j => { const s = j.summary || {};
    if (j.job === 'triage') return `${esc(j.ref || '')}: <b>${esc(s.priority || '?')}</b>${s.women_safety ? ' · women safety' : ''}${s.alerted ? ' · alert sent' : ''}<br><span class="muted">${esc(s.reason || '')}</span>`;
    if (j.job === 'news-pull') return `Collected ${s.collected ?? '?'}, new ${s.fresh ?? '?'}, kept ${s.kept ?? '?'}, saved ${s.saved ?? '?'}`;
    if (j.job === 'news-retag') return `Re-tagged people on ${s.looked ?? '?'} stories, ${s.changed ?? 0} changed`;
    return esc(JSON.stringify(s).slice(0, 200)); };
  $('#adm').innerHTML = `<p class="muted small">Every AI call the app makes: what it did, the model, and tokens used. Last ${data.length} jobs: ${tin.toLocaleString('en-IN')} tokens in, ${tout.toLocaleString('en-IN')} out.</p>
    ${(data || []).map(j => `<div class="log"><div class="muted">${fmt(j.started_at)} · ${esc(j.job)} · ${esc(j.model || '')} · ${j.ok === null ? 'running' : j.ok ? 'ok' : '<span class="danger">failed</span>'} · ${(j.tokens_in || 0) + (j.tokens_out || 0)} tokens</div>
      <div>${line(j)}</div>${j.error ? `<div class="danger small">${esc(j.error)}</div>` : ''}</div>`).join('') || '<div class="empty">No AI jobs yet.</div>'}`;
}
